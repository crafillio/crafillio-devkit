/**
 * cURL import and export.
 *
 * Pasting a curl command is how most people move a request out of browser
 * devtools or a colleague's message, so it is the single highest-value import
 * path in a request client.
 */

import type { HttpMethod, KeyValue, RestRequest } from '../types.js';

let seq = 0;
function row(key: string, value: string): KeyValue {
  seq += 1;
  return { id: `curl${seq}`, key, value, enabled: true };
}

/**
 * Splits a shell command into argv, honouring quotes, escapes and line
 * continuations. A naive `split(' ')` breaks on every header value with a
 * space in it, which is nearly all of them.
 */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;

    if (quote) {
      if (char === '\\' && quote === '"' && i + 1 < command.length) {
        current += command[++i];
      } else if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }

    // A backslash before a newline is a line continuation, not content.
    if (char === '\\' && (command[i + 1] === '\n' || command[i + 1] === '\r')) {
      i++;
      if (command[i] === '\r' && command[i + 1] === '\n') i++;
      continue;
    }

    if (char === '\\' && i + 1 < command.length) {
      current += command[++i];
      started = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (current || started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }

    current += char;
    started = true;
  }

  if (current || started) tokens.push(current);
  return tokens;
}

const METHODS = new Set<HttpMethod>([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
]);

export function importCurl(command: string): RestRequest {
  const trimmed = command.trim().replace(/^\$\s*/, '');
  const tokens = tokenize(trimmed);

  if (tokens[0] !== 'curl') {
    throw new Error('That does not look like a curl command — it should start with "curl".');
  }

  const request: RestRequest = {
    method: 'GET',
    url: '',
    headers: [],
    query: [],
    body: { kind: 'none' },
    auth: { kind: 'none' },
    timeoutMs: 30_000,
    followRedirects: false,
    maxRedirects: 5,
    insecureTls: false,
  };

  const dataParts: string[] = [];
  const formParts: KeyValue[] = [];
  let explicitMethod: HttpMethod | null = null;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    const next = (): string => tokens[++i] ?? '';

    switch (true) {
      case token === '-X' || token === '--request': {
        const value = next().toUpperCase() as HttpMethod;
        if (METHODS.has(value)) explicitMethod = value;
        break;
      }

      case token === '-H' || token === '--header': {
        const header = next();
        const split = header.indexOf(':');
        if (split > 0) {
          const key = header.slice(0, split).trim();
          const value = header.slice(split + 1).trim();
          // curl sends these itself; carrying them over causes duplicates.
          if (!/^(content-length|host)$/i.test(key)) request.headers.push(row(key, value));
        }
        break;
      }

      case token === '-d' || token === '--data' || token === '--data-raw' ||
           token === '--data-binary' || token === '--data-ascii':
        dataParts.push(next());
        break;

      case token === '--data-urlencode': {
        const value = next();
        const split = value.indexOf('=');
        if (split > 0) {
          formParts.push(row(value.slice(0, split), value.slice(split + 1)));
        } else {
          dataParts.push(value);
        }
        break;
      }

      case token === '-F' || token === '--form': {
        const value = next();
        const split = value.indexOf('=');
        if (split > 0) formParts.push(row(value.slice(0, split), value.slice(split + 1)));
        break;
      }

      case token === '-u' || token === '--user': {
        const value = next();
        const split = value.indexOf(':');
        request.auth = {
          kind: 'basic',
          username: split >= 0 ? value.slice(0, split) : value,
          password: split >= 0 ? value.slice(split + 1) : '',
        };
        break;
      }

      case token === '-k' || token === '--insecure':
        request.insecureTls = true;
        break;

      case token === '-L' || token === '--location':
        request.followRedirects = true;
        break;

      case token === '-I' || token === '--head':
        explicitMethod = 'HEAD';
        break;

      case token === '--url':
        request.url = next();
        break;

      case token === '-m' || token === '--max-time':
        request.timeoutMs = Math.round(Number(next() || '30') * 1000);
        break;

      // Flags that take a value we do not model — consume the value so it is
      // not mistaken for the URL.
      case token === '-o' || token === '--output' || token === '-A' ||
           token === '--user-agent' || token === '-e' || token === '--referer' ||
           token === '-x' || token === '--proxy' || token === '-b' || token === '--cookie':
        next();
        break;

      case token.startsWith('-'):
        // Remaining boolean flags (--compressed, -s, -v …) need no handling.
        break;

      default:
        if (!request.url) request.url = token;
        break;
    }
  }

  if (!request.url) throw new Error('No URL found in that curl command.');

  // Pull any query string out of the URL into editable rows.
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(request.url) ? request.url : `https://${request.url}`);
    for (const [key, value] of parsed.searchParams) request.query.push(row(key, value));
    parsed.search = '';
    request.url = parsed.toString().replace(/\/$/, parsed.pathname === '/' ? '/' : '');
  } catch {
    // Leave a non-parseable URL as typed; the user can fix it in the bar.
  }

  const bearer = request.headers.find(
    (h) => h.key.toLowerCase() === 'authorization' && /^Bearer\s+/i.test(h.value),
  );
  if (bearer) {
    request.auth = { kind: 'bearer', token: bearer.value.replace(/^Bearer\s+/i, '') };
    request.headers = request.headers.filter((h) => h !== bearer);
  }

  const contentType =
    request.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';

  if (formParts.length > 0) {
    request.body = /multipart/i.test(contentType)
      ? {
          kind: 'multipart',
          fields: formParts.map((f) => ({
            id: f.id, key: f.key, enabled: true, type: 'text' as const, value: f.value,
          })),
        }
      : { kind: 'form', fields: formParts };
  } else if (dataParts.length > 0) {
    const data = dataParts.join('&');
    if (/json/i.test(contentType) || /^\s*[[{]/.test(data)) {
      request.body = { kind: 'json', text: data };
    } else if (/x-www-form-urlencoded/i.test(contentType) || /^[^=&]+=[^&]*(&|$)/.test(data)) {
      const fields = data.split('&').map((pair) => {
        const split = pair.indexOf('=');
        return split >= 0
          ? row(decodeURIComponent(pair.slice(0, split)), decodeURIComponent(pair.slice(split + 1)))
          : row(pair, '');
      });
      request.body = { kind: 'form', fields };
    } else {
      request.body = { kind: 'text', text: data, contentType: contentType || 'text/plain' };
    }
  }

  // curl implies POST when data is present and no method was given.
  request.method = explicitMethod ?? (request.body.kind === 'none' ? 'GET' : 'POST');
  return request;
}

/** Renders a request as a runnable curl command. */
export function exportCurl(request: RestRequest): string {
  const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
  const lines: string[] = [`curl -X ${request.method} ${quote(buildUrl(request))}`];

  for (const header of request.headers) {
    if (header.enabled && header.key.trim()) {
      lines.push(`  -H ${quote(`${header.key}: ${header.value}`)}`);
    }
  }

  switch (request.auth.kind) {
    case 'bearer':
      lines.push(`  -H ${quote(`Authorization: Bearer ${request.auth.token}`)}`);
      break;
    case 'basic':
      lines.push(`  -u ${quote(`${request.auth.username}:${request.auth.password}`)}`);
      break;
    case 'apiKey':
      if (request.auth.in === 'header' && request.auth.key) {
        lines.push(`  -H ${quote(`${request.auth.key}: ${request.auth.value}`)}`);
      }
      break;
    case 'none':
      break;
  }

  const body = request.body;
  if (body.kind === 'json') {
    lines.push(`  -H ${quote('Content-Type: application/json')}`);
    lines.push(`  -d ${quote(body.text)}`);
  } else if (body.kind === 'text') {
    lines.push(`  -H ${quote(`Content-Type: ${body.contentType}`)}`);
    lines.push(`  -d ${quote(body.text)}`);
  } else if (body.kind === 'form') {
    for (const field of body.fields) {
      if (field.enabled && field.key.trim()) {
        lines.push(`  --data-urlencode ${quote(`${field.key}=${field.value}`)}`);
      }
    }
  } else if (body.kind === 'multipart') {
    for (const field of body.fields) {
      if (!field.enabled || !field.key.trim()) continue;
      const value = field.type === 'file' ? `@${field.filePath ?? ''}` : field.value;
      lines.push(`  -F ${quote(`${field.key}=${value}`)}`);
    }
  } else if (body.kind === 'binary' && body.filePath) {
    lines.push(`  --data-binary ${quote(`@${body.filePath}`)}`);
  }

  if (request.followRedirects) lines.push('  -L');
  if (request.insecureTls) lines.push('  -k');

  return lines.join(' \\\n');
}

function buildUrl(request: RestRequest): string {
  const active = request.query.filter((q) => q.enabled && q.key.trim());
  const apiKeyInQuery =
    request.auth.kind === 'apiKey' && request.auth.in === 'query' && request.auth.key
      ? [{ key: request.auth.key, value: request.auth.value }]
      : [];

  const all = [...active, ...apiKeyInQuery];
  if (all.length === 0) return request.url;

  const query = all
    .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
    .join('&');
  return request.url.includes('?') ? `${request.url}&${query}` : `${request.url}?${query}`;
}
