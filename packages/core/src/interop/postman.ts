/**
 * Postman Collection v2.1 import.
 *
 * Lets someone move their existing work across in one step rather than
 * re-typing it, which is the practical barrier to switching request clients.
 * Postman's `{{var}}` syntax matches ours, so variables survive untouched.
 */

import { randomUUID } from 'node:crypto';
import type {
  Auth,
  Collection,
  Folder,
  HttpMethod,
  KeyValue,
  RestBody,
  RestRequest,
  SavedRequest,
} from '../types.js';

/* Postman's shape, narrowed to the parts we read. */
interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[] | string;
  path?: string[] | string;
  query?: Array<{ key?: string; value?: string; disabled?: boolean }>;
}

interface PostmanHeader {
  key?: string;
  value?: string;
  disabled?: boolean;
}

interface PostmanAuth {
  type?: string;
  bearer?: Array<{ key?: string; value?: string }>;
  basic?: Array<{ key?: string; value?: string }>;
  apikey?: Array<{ key?: string; value?: string }>;
}

interface PostmanBody {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';
  raw?: string;
  options?: { raw?: { language?: string } };
  urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  formdata?: Array<{ key?: string; value?: string; type?: string; src?: string; disabled?: boolean }>;
  graphql?: { query?: string; variables?: string };
}

interface PostmanRequest {
  method?: string;
  header?: PostmanHeader[];
  url?: PostmanUrl | string;
  body?: PostmanBody;
  auth?: PostmanAuth;
  description?: string;
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
}

interface PostmanCollection {
  info?: { name?: string; schema?: string };
  item?: PostmanItem[];
  auth?: PostmanAuth;
  variable?: Array<{ key?: string; value?: string; disabled?: boolean }>;
}

let seq = 0;
function row(key: string, value: string, enabled = true): KeyValue {
  seq += 1;
  return { id: `pm${seq}`, key, value, enabled };
}

const METHODS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
]);

function readUrl(url: PostmanUrl | string | undefined): { url: string; query: KeyValue[] } {
  if (!url) return { url: '', query: [] };
  if (typeof url === 'string') return { url, query: [] };

  const query = (url.query ?? []).map((q) => row(q.key ?? '', q.value ?? '', !q.disabled));

  if (url.raw) {
    // `raw` already contains the query string; strip it since it is modelled
    // separately, or the parameters would be sent twice.
    const [base] = url.raw.split('?');
    return { url: base ?? url.raw, query };
  }

  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '');
  const path = Array.isArray(url.path) ? url.path.join('/') : (url.path ?? '');
  const protocol = url.protocol ? `${url.protocol}://` : '';
  return { url: `${protocol}${host}${path ? `/${path}` : ''}`, query };
}

function readAuth(auth: PostmanAuth | undefined): Auth {
  if (!auth?.type) return { kind: 'none' };
  const pick = (list: Array<{ key?: string; value?: string }> | undefined, key: string): string =>
    list?.find((entry) => entry.key === key)?.value ?? '';

  switch (auth.type) {
    case 'bearer':
      return { kind: 'bearer', token: pick(auth.bearer, 'token') };
    case 'basic':
      return {
        kind: 'basic',
        username: pick(auth.basic, 'username'),
        password: pick(auth.basic, 'password'),
      };
    case 'apikey':
      return {
        kind: 'apiKey',
        key: pick(auth.apikey, 'key'),
        value: pick(auth.apikey, 'value'),
        in: pick(auth.apikey, 'in') === 'query' ? 'query' : 'header',
      };
    default:
      // OAuth and friends carry no directly reusable secret; leave auth unset
      // rather than inventing one, and let the user fill it in.
      return { kind: 'none' };
  }
}

function readBody(body: PostmanBody | undefined): RestBody {
  if (!body?.mode) return { kind: 'none' };

  switch (body.mode) {
    case 'raw': {
      const text = body.raw ?? '';
      const language = body.options?.raw?.language;
      if (language === 'json' || /^\s*[[{]/.test(text)) return { kind: 'json', text };
      return { kind: 'text', text, contentType: language === 'xml' ? 'application/xml' : 'text/plain' };
    }

    case 'graphql': {
      // GraphQL over HTTP is a JSON POST; render it as one so it is runnable.
      const payload = {
        query: body.graphql?.query ?? '',
        variables: body.graphql?.variables ? safeParse(body.graphql.variables) : undefined,
      };
      return { kind: 'json', text: JSON.stringify(payload, null, 2) };
    }

    case 'urlencoded':
      return {
        kind: 'form',
        fields: (body.urlencoded ?? []).map((f) => row(f.key ?? '', f.value ?? '', !f.disabled)),
      };

    case 'formdata':
      return {
        kind: 'multipart',
        fields: (body.formdata ?? []).map((f) => {
          seq += 1;
          return {
            id: `pm${seq}`,
            key: f.key ?? '',
            enabled: !f.disabled,
            type: f.type === 'file' ? ('file' as const) : ('text' as const),
            value: f.type === 'file' ? (f.src ?? '') : (f.value ?? ''),
            filePath: f.type === 'file' ? f.src : undefined,
          };
        }),
      };

    default:
      return { kind: 'none' };
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toRestRequest(request: PostmanRequest, inherited: Auth): RestRequest {
  const { url, query } = readUrl(request.url);
  const auth = readAuth(request.auth);

  return {
    method: (METHODS.has((request.method ?? 'GET').toUpperCase())
      ? (request.method ?? 'GET').toUpperCase()
      : 'GET') as HttpMethod,
    url,
    query,
    headers: (request.header ?? []).map((h) => row(h.key ?? '', h.value ?? '', !h.disabled)),
    body: readBody(request.body),
    // Postman lets a folder or collection supply auth; fall back to that.
    auth: auth.kind === 'none' ? inherited : auth,
    timeoutMs: 30_000,
    followRedirects: true,
    maxRedirects: 5,
    insecureTls: false,
  };
}

export interface PostmanImportResult {
  collection: Collection;
  /** Collection-level variables, offered as a new environment. */
  variables: Array<{ key: string; value: string }>;
  requestCount: number;
  skipped: string[];
}

/** Parses an exported Postman v2.x collection. */
export function importPostmanCollection(json: string): PostmanImportResult {
  let parsed: PostmanCollection;
  try {
    parsed = JSON.parse(json) as PostmanCollection;
  } catch (err) {
    throw new Error(`Not valid JSON: ${(err as Error).message}`);
  }

  if (!parsed.info || !Array.isArray(parsed.item)) {
    throw new Error(
      'That is not a Postman collection export. Use Export → Collection v2.1 in Postman.',
    );
  }

  const now = new Date().toISOString();
  const folders: Folder[] = [];
  const requests: SavedRequest[] = [];
  const skipped: string[] = [];
  const collectionAuth = readAuth(parsed.auth);

  const walk = (items: PostmanItem[], parentId: string | null, inherited: Auth): void => {
    for (const item of items) {
      if (Array.isArray(item.item)) {
        const folder: Folder = {
          id: randomUUID(),
          name: item.name ?? 'Folder',
          parentId,
        };
        folders.push(folder);
        walk(item.item, folder.id, inherited);
        continue;
      }

      if (!item.request) {
        skipped.push(item.name ?? '(unnamed)');
        continue;
      }

      requests.push({
        id: randomUUID(),
        name: item.name ?? 'Untitled request',
        protocol: 'rest',
        folderId: parentId,
        rest: toRestRequest(item.request, inherited),
        createdAt: now,
        updatedAt: now,
      });
    }
  };

  walk(parsed.item, null, collectionAuth);

  return {
    collection: {
      id: randomUUID(),
      name: parsed.info.name ?? 'Imported collection',
      folders,
      requests,
      createdAt: now,
      updatedAt: now,
    },
    variables: (parsed.variable ?? [])
      .filter((v) => v.key && !v.disabled)
      .map((v) => ({ key: v.key!, value: v.value ?? '' })),
    requestCount: requests.length,
    skipped,
  };
}
