import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Agent, request as undiciRequest } from 'undici';
import type {
  Auth,
  KeyValue,
  RestBody,
  RestRequest,
  RestResponse,
} from '../types.js';

/** Agents are pooled per TLS policy so we don't rebuild a connection pool per send. */
const agents = new Map<string, Agent>();

function agentFor(insecureTls: boolean, timeoutMs: number): Agent {
  const key = `${insecureTls}:${timeoutMs}`;
  let agent = agents.get(key);
  if (!agent) {
    agent = new Agent({
      connect: { rejectUnauthorized: !insecureTls },
      // 0 means "no timeout" to us, but undici wants undefined for that.
      headersTimeout: timeoutMs || undefined,
      bodyTimeout: timeoutMs || undefined,
    });
    agents.set(key, agent);
  }
  return agent;
}

/** Release pooled sockets. Called when the app quits. */
export async function closeRestAgents(): Promise<void> {
  await Promise.all([...agents.values()].map((a) => a.close()));
  agents.clear();
}

function enabled(rows: KeyValue[]): KeyValue[] {
  return rows.filter((r) => r.enabled && r.key.trim() !== '');
}

/**
 * Builds the final URL. Query rows are appended to whatever the URL literally
 * contains, so a hand-typed `?a=1` and a query row both survive.
 */
function buildUrl(rawUrl: string, query: KeyValue[], auth: Auth): URL {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)
    ? rawUrl
    : `https://${rawUrl}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Not a valid URL: ${rawUrl}`);
  }

  for (const row of enabled(query)) url.searchParams.append(row.key, row.value);
  if (auth.kind === 'apiKey' && auth.in === 'query' && auth.key) {
    url.searchParams.append(auth.key, auth.value);
  }
  return url;
}

function applyAuth(headers: Record<string, string>, auth: Auth): void {
  switch (auth.kind) {
    case 'bearer':
      if (auth.token) headers['authorization'] = `Bearer ${auth.token}`;
      break;
    case 'basic': {
      const raw = `${auth.username}:${auth.password}`;
      headers['authorization'] = `Basic ${Buffer.from(raw).toString('base64')}`;
      break;
    }
    case 'apiKey':
      if (auth.in === 'header' && auth.key) headers[auth.key.toLowerCase()] = auth.value;
      break;
    case 'none':
      break;
  }
}

interface PreparedBody {
  payload: Buffer | string | undefined;
  /** Only set when the body kind implies a content type the user didn't give. */
  contentType?: string;
}

async function prepareBody(body: RestBody): Promise<PreparedBody> {
  switch (body.kind) {
    case 'none':
      return { payload: undefined };

    case 'json':
      return { payload: body.text, contentType: 'application/json' };

    case 'text':
      return { payload: body.text, contentType: body.contentType || 'text/plain' };

    case 'form': {
      const params = new URLSearchParams();
      for (const row of enabled(body.fields)) params.append(row.key, row.value);
      return {
        payload: params.toString(),
        contentType: 'application/x-www-form-urlencoded',
      };
    }

    case 'binary': {
      if (!body.filePath) throw new Error('Binary body selected but no file was chosen.');
      return {
        payload: await readFile(body.filePath),
        contentType: 'application/octet-stream',
      };
    }

    case 'multipart': {
      // Built by hand rather than via FormData so the boundary is knowable and
      // file parts keep their on-disk filename.
      const boundary = `----CrafillioBoundary${Math.random().toString(16).slice(2)}`;
      const chunks: Buffer[] = [];

      for (const field of body.fields) {
        if (!field.enabled || !field.key.trim()) continue;
        chunks.push(Buffer.from(`--${boundary}\r\n`));

        if (field.type === 'file') {
          if (!field.filePath) throw new Error(`No file chosen for part "${field.key}".`);
          const contents = await readFile(field.filePath);
          chunks.push(
            Buffer.from(
              `Content-Disposition: form-data; name="${field.key}"; ` +
                `filename="${basename(field.filePath)}"\r\n` +
                `Content-Type: application/octet-stream\r\n\r\n`,
            ),
          );
          chunks.push(contents);
        } else {
          chunks.push(
            Buffer.from(`Content-Disposition: form-data; name="${field.key}"\r\n\r\n`),
          );
          chunks.push(Buffer.from(field.value));
        }
        chunks.push(Buffer.from('\r\n'));
      }

      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      return {
        payload: Buffer.concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }
  }
}

/** A body may only accompany methods that permit one. */
function methodAllowsBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

function decodeBody(buf: Buffer): { body: string; bodyEncoding: 'utf8' | 'base64' } {
  try {
    // `fatal` makes this throw on invalid UTF-8 rather than inserting U+FFFD,
    // which is how we tell text from binary.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { body: text, bodyEncoding: 'utf8' };
  } catch {
    return { body: buf.toString('base64'), bodyEncoding: 'base64' };
  }
}

function flattenHeaders(raw: Record<string, string | string[] | undefined>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

/**
 * Sends one REST request, following redirects manually so the hop chain can be
 * reported back to the user.
 */
export async function sendRest(req: RestRequest): Promise<RestResponse> {
  const started = process.hrtime.bigint();
  const redirects: string[] = [];

  const headers: Record<string, string> = {};
  for (const row of enabled(req.headers)) headers[row.key.toLowerCase()] = row.value;
  applyAuth(headers, req.auth);

  const prepared = methodAllowsBody(req.method)
    ? await prepareBody(req.body)
    : { payload: undefined as Buffer | string | undefined };

  // An explicit content-type header always wins over the body kind's default.
  if (prepared.contentType && !headers['content-type']) {
    headers['content-type'] = prepared.contentType;
  }

  let url = buildUrl(req.url, req.query, req.auth);
  let method = req.method;
  let payload = prepared.payload;
  let hop = 0;

  const maxHops = req.followRedirects ? Math.max(0, req.maxRedirects) : 0;

  for (;;) {
    const controller = new AbortController();
    const timer =
      req.timeoutMs > 0
        ? setTimeout(() => controller.abort(), req.timeoutMs)
        : undefined;

    let res;
    try {
      res = await undiciRequest(url, {
        method: method as never,
        headers,
        body: payload,
        signal: controller.signal,
        dispatcher: agentFor(req.insecureTls, req.timeoutMs),
        // undici does not follow redirects unless a RedirectHandler is attached,
        // which is what we want — the hop chain is walked manually below so it
        // can be reported back to the user.
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      const e = err as Error & { code?: string };
      if (e.name === 'AbortError' || e.code === 'UND_ERR_ABORTED') {
        throw new Error(`Request timed out after ${req.timeoutMs}ms`);
      }
      throw new Error(describeNetworkError(e, url));
    }

    const firstByteMs = Number(process.hrtime.bigint() - started) / 1e6;
    const isRedirect = res.statusCode >= 300 && res.statusCode < 400;
    const location = res.headers['location'];

    if (isRedirect && location && hop < maxHops) {
      // Drain so the socket can be reused.
      await res.body.dump();
      if (timer) clearTimeout(timer);

      const next = new URL(Array.isArray(location) ? location[0]! : location, url);
      redirects.push(next.toString());

      // 303 always downgrades to GET; 301/302 do so for POST by convention.
      if (res.statusCode === 303 || (method === 'POST' && res.statusCode !== 307 && res.statusCode !== 308)) {
        method = 'GET';
        payload = undefined;
        delete headers['content-type'];
        delete headers['content-length'];
      }
      // Credentials must not leak to a different origin.
      if (next.origin !== url.origin) delete headers['authorization'];

      url = next;
      hop += 1;
      continue;
    }

    const buf = Buffer.from(await res.body.arrayBuffer());
    if (timer) clearTimeout(timer);

    const totalMs = Number(process.hrtime.bigint() - started) / 1e6;
    const { body, bodyEncoding } = decodeBody(buf);

    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      statusText: '',
      headers: flattenHeaders(res.headers),
      body,
      bodyEncoding,
      size: buf.byteLength,
      timing: { totalMs, firstByteMs },
      redirects,
    };
  }
}

/** Turns opaque socket errors into something a developer can act on. */
function describeNetworkError(err: Error & { code?: string }, url: URL): string {
  switch (err.code) {
    case 'ENOTFOUND':
      return `Host not found: ${url.hostname}`;
    case 'ECONNREFUSED':
      return `Connection refused by ${url.host}`;
    case 'ECONNRESET':
      return `Connection reset by ${url.host}`;
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `TLS certificate not trusted for ${url.host}. Enable "Ignore TLS errors" to continue anyway.`;
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return `TLS certificate does not match ${url.hostname}.`;
    default:
      return err.message || String(err);
  }
}
