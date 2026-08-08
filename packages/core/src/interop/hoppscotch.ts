/**
 * Hoppscotch collection import.
 *
 * Hoppscotch exports either a single collection object or an array of them,
 * each with nested `folders` and `requests`. Its `<<variable>>` syntax is
 * rewritten to `{{variable}}` so environments keep working after the move.
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

interface HoppEntry {
  key?: string;
  value?: string;
  active?: boolean;
}

interface HoppAuth {
  authType?: string;
  authActive?: boolean;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  addTo?: string;
}

interface HoppBody {
  contentType?: string | null;
  body?: string | HoppEntry[] | null;
}

interface HoppRequest {
  v?: string;
  name?: string;
  method?: string;
  endpoint?: string;
  params?: HoppEntry[];
  headers?: HoppEntry[];
  auth?: HoppAuth;
  body?: HoppBody;
  /** Older exports kept these at the top level. */
  contentType?: string;
  rawParams?: string;
}

interface HoppFolder {
  v?: number;
  name?: string;
  folders?: HoppFolder[];
  requests?: HoppRequest[];
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

let seq = 0;
function row(key: string, value: string, enabled = true): KeyValue {
  seq += 1;
  return { id: `hs${seq}`, key, value, enabled };
}

/** Hoppscotch writes `<<name>>`; everything here speaks `{{name}}`. */
export function rewriteVariables(text: string): string {
  return text.replace(/<<\s*([\w.-]+)\s*>>/g, '{{$1}}');
}

function readAuth(auth: HoppAuth | undefined): Auth {
  if (!auth || auth.authActive === false) return { kind: 'none' };

  switch (auth.authType) {
    case 'bearer':
      return { kind: 'bearer', token: rewriteVariables(auth.token ?? '') };
    case 'basic':
      return {
        kind: 'basic',
        username: rewriteVariables(auth.username ?? ''),
        password: rewriteVariables(auth.password ?? ''),
      };
    case 'api-key':
      return {
        kind: 'apiKey',
        key: auth.key ?? '',
        value: rewriteVariables(auth.value ?? ''),
        in: auth.addTo === 'QUERY_PARAMS' ? 'query' : 'header',
      };
    default:
      // OAuth and "inherit" carry nothing directly reusable.
      return { kind: 'none' };
  }
}

function readBody(request: HoppRequest): RestBody {
  const contentType = request.body?.contentType ?? request.contentType ?? null;
  const raw = request.body?.body ?? request.rawParams ?? null;

  if (!contentType || raw === null || raw === undefined || raw === '') return { kind: 'none' };

  if (Array.isArray(raw)) {
    // multipart/form-data arrives as entries.
    const fields = raw.map((entry) => {
      seq += 1;
      return {
        id: `hs${seq}`,
        key: entry.key ?? '',
        enabled: entry.active !== false,
        type: 'text' as const,
        value: rewriteVariables(entry.value ?? ''),
      };
    });
    return { kind: 'multipart', fields };
  }

  const text = rewriteVariables(String(raw));

  if (/json/i.test(contentType)) return { kind: 'json', text };
  if (/x-www-form-urlencoded/i.test(contentType)) {
    const fields = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const split = line.indexOf(':') >= 0 ? line.indexOf(':') : line.indexOf('=');
        return split > 0
          ? row(line.slice(0, split).trim(), line.slice(split + 1).trim())
          : row(line, '');
      });
    return { kind: 'form', fields };
  }
  return { kind: 'text', text, contentType };
}

function toRestRequest(request: HoppRequest): RestRequest {
  const method = (request.method ?? 'GET').toUpperCase();

  return {
    method: (METHODS.has(method) ? method : 'GET') as HttpMethod,
    url: rewriteVariables(request.endpoint ?? ''),
    headers: (request.headers ?? []).map((h) =>
      row(h.key ?? '', rewriteVariables(h.value ?? ''), h.active !== false),
    ),
    query: (request.params ?? []).map((p) =>
      row(p.key ?? '', rewriteVariables(p.value ?? ''), p.active !== false),
    ),
    body: readBody(request),
    auth: readAuth(request.auth),
    timeoutMs: 30_000,
    followRedirects: true,
    maxRedirects: 5,
    insecureTls: false,
  };
}

export interface HoppscotchImportResult {
  collection: Collection;
  requestCount: number;
  skipped: string[];
}

/** Parses a Hoppscotch collection export. */
export function importHoppscotch(json: string): HoppscotchImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Not valid JSON: ${(err as Error).message}`);
  }

  // An export is either one collection or an array of them.
  const roots: HoppFolder[] = Array.isArray(parsed) ? (parsed as HoppFolder[]) : [parsed as HoppFolder];

  const looksRight = roots.some(
    (r) => r && typeof r === 'object' && (Array.isArray(r.requests) || Array.isArray(r.folders)),
  );
  if (!looksRight) {
    throw new Error(
      'That is not a Hoppscotch collection — no "requests" or "folders" array was found.',
    );
  }

  const now = new Date().toISOString();
  const folders: Folder[] = [];
  const requests: SavedRequest[] = [];
  const skipped: string[] = [];

  const walk = (node: HoppFolder, parentId: string | null): void => {
    for (const request of node.requests ?? []) {
      if (!request || typeof request !== 'object') {
        skipped.push('(malformed request)');
        continue;
      }
      requests.push({
        id: randomUUID(),
        name: request.name?.trim() || request.endpoint || 'Untitled request',
        protocol: 'rest',
        folderId: parentId,
        rest: toRestRequest(request),
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const child of node.folders ?? []) {
      const folder: Folder = { id: randomUUID(), name: child.name ?? 'Folder', parentId };
      folders.push(folder);
      walk(child, folder.id);
    }
  };

  // Several roots become sibling folders so nothing is silently merged.
  const multiple = roots.length > 1;
  for (const root of roots) {
    if (multiple) {
      const folder: Folder = { id: randomUUID(), name: root.name ?? 'Collection', parentId: null };
      folders.push(folder);
      walk(root, folder.id);
    } else {
      walk(root, null);
    }
  }

  return {
    collection: {
      id: randomUUID(),
      name: (multiple ? 'Hoppscotch import' : roots[0]?.name?.trim()) || 'Hoppscotch import',
      folders,
      requests,
      createdAt: now,
      updatedAt: now,
    },
    requestCount: requests.length,
    skipped,
  };
}
