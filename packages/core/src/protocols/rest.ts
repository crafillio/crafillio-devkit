import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import tls from 'node:tls';
import { SocksClient } from 'socks';
import type { SocksProxy } from 'socks';
import { Agent, ProxyAgent, request as undiciRequest, type Dispatcher } from 'undici';
import {
  certificateFor,
  isBypassed,
  type ClientCertificate,
  type ProxySettings,
  tlsIgnored,
  type TlsSettings,
} from '../store/settings.js';
import type {
  Auth,
  KeyValue,
  RestBody,
  RestRequest,
  RestResponse,
} from '../types.js';

/**
 * Network policy applied to every request: proxying and TLS trust.
 *
 * Injected by the shell from settings rather than read here, because core must
 * not depend on where configuration lives.
 */
export interface NetworkPolicy {
  proxy?: ProxySettings;
  tls?: TlsSettings;
}

let policy: NetworkPolicy = {};

export function setNetworkPolicy(next: NetworkPolicy): void {
  policy = next;
  // Pooled agents captured the old proxy and trust settings, so they must go.
  void closeRestAgents();
}

export function getNetworkPolicy(): NetworkPolicy {
  return policy;
}

/** Reads a PEM/PFX file, turning an unreadable path into an actionable error. */
function readCertFile(path: string, label: string): Buffer {
  try {
    return readFileSync(path);
  } catch (err) {
    throw new Error(`Could not read ${label} at ${path}: ${(err as Error).message}`);
  }
}

/** TLS material for a host: trust anchors plus any client certificate. */
function tlsOptionsFor(host: string, insecureTls: boolean): Record<string, unknown> {
  const tls = policy.tls;
  // Precedence, most specific first: the request's own override, then the
  // per-host ignore list, then the global setting. Anything else would let a
  // global "verify on" silently override the exception the user added for one
  // staging box.
  const verify = insecureTls
    ? false
    : tlsIgnored(host, tls?.ignoreHosts)
      ? false
      : (tls?.verify ?? true);
  const options: Record<string, unknown> = { rejectUnauthorized: verify };

  if (tls?.caPath) options.ca = readCertFile(tls.caPath, 'CA bundle');

  const cert: ClientCertificate | undefined = certificateFor(host, tls?.certificates ?? []);
  if (cert) {
    if (cert.pfxPath) {
      options.pfx = readCertFile(cert.pfxPath, 'client certificate (PFX)');
    } else {
      if (cert.certPath) options.cert = readCertFile(cert.certPath, 'client certificate');
      if (cert.keyPath) options.key = readCertFile(cert.keyPath, 'client key');
    }
    if (cert.passphrase) options.passphrase = cert.passphrase;
  }

  return options;
}

/** True for the SOCKS variants, which need their own connector. */
function isSocks(protocol: ProxySettings['protocol']): boolean {
  return protocol === 'socks4' || protocol === 'socks5';
}

/**
 * An undici connector that dials through a SOCKS proxy.
 *
 * undici's ProxyAgent only speaks HTTP CONNECT, so SOCKS needs a connector
 * that opens the tunnel itself and then, for https, upgrades the resulting
 * socket to TLS — otherwise the certificate would never be checked.
 */
function socksConnector(
  proxy: ProxySettings,
  tlsOptions: Record<string, unknown>,
): (options: { hostname: string; port?: number | string; protocol: string; servername?: string },
    callback: (err: Error | null, socket?: unknown) => void) => void {
  const type: SocksProxy['type'] = proxy.protocol === 'socks4' ? 4 : 5;

  return (options, callback) => {
    const port = Number(options.port) || (options.protocol === 'https:' ? 443 : 80);

    void SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type,
        userId: proxy.auth.enabled ? proxy.auth.username : undefined,
        password: proxy.auth.enabled ? proxy.auth.password : undefined,
      },
      command: 'connect',
      destination: { host: options.hostname, port },
    })
      .then(({ socket }) => {
        if (options.protocol !== 'https:') {
          callback(null, socket);
          return;
        }

        const secure = tls.connect({
          socket,
          servername: options.servername ?? options.hostname,
          ...(tlsOptions as tls.ConnectionOptions),
        });
        secure.once('secureConnect', () => callback(null, secure));
        secure.once('error', (err) => callback(err));
      })
      .catch((err: Error) => {
        callback(new Error(`SOCKS proxy ${proxy.host}:${proxy.port} — ${err.message}`));
      });
  };
}

/** Whether this URL should be proxied under the current policy. */
function proxyFor(url: URL): ProxySettings | null {
  const proxy = policy.proxy;
  if (!proxy?.enabled || !proxy.host.trim()) return null;
  if (isBypassed(url.hostname, proxy.bypass)) return null;
  if (url.protocol === 'https:' && !proxy.forHttps) return null;
  if (url.protocol === 'http:' && !proxy.forHttp) return null;
  return proxy;
}

/** Agents are pooled per policy so we don't rebuild a connection pool per send. */
const agents = new Map<string, Dispatcher>();

function agentFor(url: URL, insecureTls: boolean, timeoutMs: number): Dispatcher {
  const proxy = proxyFor(url);
  const tls = policy.tls;
  const cert = certificateFor(url.hostname, tls?.certificates ?? []);

  // The key must cover everything that changes how a socket is made, or two
  // different policies would share one pool.
  const key = [
    insecureTls,
    timeoutMs,
    proxy ? `${proxy.protocol}://${proxy.host}:${proxy.port}:${proxy.auth.enabled}` : 'direct',
    tls?.verify ?? true,
    tls?.caPath ?? '',
    cert?.id ?? '',
  ].join('|');

  const existing = agents.get(key);
  if (existing) return existing;

  const connect = tlsOptionsFor(url.hostname, insecureTls);
  // 0 means "no timeout" to us, but undici wants undefined for that.
  const timeouts = {
    headersTimeout: timeoutMs || undefined,
    bodyTimeout: timeoutMs || undefined,
  };

  let agent: Dispatcher;
  if (proxy && isSocks(proxy.protocol)) {
    agent = new Agent({ connect: socksConnector(proxy, connect) as never, ...timeouts });
  } else if (proxy) {
    const token = proxy.auth.enabled
      ? `Basic ${Buffer.from(`${proxy.auth.username}:${proxy.auth.password}`).toString('base64')}`
      : undefined;
    agent = new ProxyAgent({
      uri: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
      token,
      // Applies to the tunnelled connection, i.e. the real destination.
      requestTls: connect as never,
      ...timeouts,
    });
  } else {
    agent = new Agent({ connect, ...timeouts });
  }

  agents.set(key, agent);
  return agent;
}

/** Release pooled sockets. Called when the app quits or policy changes. */
export async function closeRestAgents(): Promise<void> {
  const open = [...agents.values()];
  agents.clear();
  await Promise.all(open.map((a) => a.close().catch(() => undefined)));
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
        dispatcher: agentFor(url, req.insecureTls, req.timeoutMs),
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
    case 'ERR_PROXY_CONNECT':
    case 'UND_ERR_PROXY':
      return `Could not reach the proxy. Check the proxy settings.`;
    case 'ECONNREFUSED_SOCKS':
      return `The SOCKS proxy refused the connection.`;
    default:
      return err.message || String(err);
  }
}
