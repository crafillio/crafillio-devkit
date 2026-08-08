/**
 * Bruno collection import.
 *
 * Bruno stores each request as a `.bru` file in a folder tree rather than one
 * JSON export, so this parses the `.bru` grammar directly and walks the
 * directory to rebuild the structure.
 *
 * The format is a series of named blocks:
 *
 *   meta { name: Get user }
 *   get { url: {{host}}/users/1 }
 *   headers { Accept: application/json }
 *   body:json { ... raw text ... }
 *
 * Dictionary blocks hold `key: value` lines, where a leading `~` marks the
 * entry as disabled. Body blocks hold raw text and must not be split on `:`.
 */

import { randomUUID } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
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

let seq = 0;
function row(key: string, value: string, enabled = true): KeyValue {
  seq += 1;
  return { id: `br${seq}`, key, value, enabled };
}

export interface BruBlock {
  name: string;
  /** Raw text between the braces. */
  raw: string;
}

/**
 * Splits a .bru document into its top-level blocks.
 *
 * Brace depth is tracked rather than matched with a regex, because body blocks
 * routinely contain JSON with its own braces.
 */
export function parseBlocks(source: string): BruBlock[] {
  const blocks: BruBlock[] = [];
  let i = 0;

  while (i < source.length) {
    // A block header runs up to the opening brace.
    const open = source.indexOf('{', i);
    if (open === -1) break;

    const name = source.slice(i, open).trim();
    if (!name) {
      i = open + 1;
      continue;
    }

    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === '{') depth++;
      else if (source[j] === '}') depth--;
      j++;
    }

    blocks.push({ name, raw: source.slice(open + 1, j - 1) });
    i = j;
  }

  return blocks;
}

/** Reads a dictionary block's `key: value` lines. */
export function parseDict(raw: string): Array<{ key: string; value: string; enabled: boolean }> {
  const entries: Array<{ key: string; value: string; enabled: boolean }> = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // A leading tilde marks a disabled entry.
    const enabled = !trimmed.startsWith('~');
    const body = enabled ? trimmed : trimmed.slice(1).trim();

    const split = body.indexOf(':');
    if (split === -1) continue;

    entries.push({
      key: body.slice(0, split).trim(),
      value: body.slice(split + 1).trim(),
      enabled,
    });
  }

  return entries;
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function readAuth(blocks: BruBlock[]): Auth {
  const bearer = blocks.find((b) => b.name === 'auth:bearer');
  if (bearer) {
    const token = parseDict(bearer.raw).find((e) => e.key === 'token')?.value ?? '';
    return { kind: 'bearer', token };
  }

  const basic = blocks.find((b) => b.name === 'auth:basic');
  if (basic) {
    const entries = parseDict(basic.raw);
    return {
      kind: 'basic',
      username: entries.find((e) => e.key === 'username')?.value ?? '',
      password: entries.find((e) => e.key === 'password')?.value ?? '',
    };
  }

  const apikey = blocks.find((b) => b.name === 'auth:apikey');
  if (apikey) {
    const entries = parseDict(apikey.raw);
    return {
      kind: 'apiKey',
      key: entries.find((e) => e.key === 'key')?.value ?? '',
      value: entries.find((e) => e.key === 'value')?.value ?? '',
      in: entries.find((e) => e.key === 'placement')?.value === 'queryparams' ? 'query' : 'header',
    };
  }

  return { kind: 'none' };
}

function readBody(blocks: BruBlock[]): RestBody {
  const json = blocks.find((b) => b.name === 'body:json');
  if (json) return { kind: 'json', text: json.raw.trim() };

  const text = blocks.find((b) => b.name === 'body:text');
  if (text) return { kind: 'text', text: text.raw.trim(), contentType: 'text/plain' };

  const xml = blocks.find((b) => b.name === 'body:xml');
  if (xml) return { kind: 'text', text: xml.raw.trim(), contentType: 'application/xml' };

  const form = blocks.find((b) => b.name === 'body:form-urlencoded');
  if (form) {
    return {
      kind: 'form',
      fields: parseDict(form.raw).map((e) => row(e.key, e.value, e.enabled)),
    };
  }

  const multipart = blocks.find((b) => b.name === 'body:multipart-form');
  if (multipart) {
    const fields = parseDict(multipart.raw).map((e) => {
      seq += 1;
      // Bruno writes file parts as `@file(path)`.
      const fileMatch = /^@file\((.*)\)$/.exec(e.value);
      return {
        id: `br${seq}`,
        key: e.key,
        enabled: e.enabled,
        type: fileMatch ? ('file' as const) : ('text' as const),
        value: fileMatch ? (fileMatch[1] ?? '') : e.value,
        filePath: fileMatch ? fileMatch[1] : undefined,
      };
    });
    return { kind: 'multipart', fields };
  }

  return { kind: 'none' };
}

/** Parses one `.bru` document into a request. */
export function parseBru(source: string, fallbackName: string): { name: string; request: RestRequest } | null {
  const blocks = parseBlocks(source);
  if (blocks.length === 0) return null;

  const methodBlock = blocks.find((b) => METHODS.has(b.name.split(':')[0]!.toLowerCase()));
  if (!methodBlock) return null;

  const method = methodBlock.name.split(':')[0]!.toUpperCase() as HttpMethod;
  const methodEntries = parseDict(methodBlock.raw);
  const url = methodEntries.find((e) => e.key === 'url')?.value ?? '';

  const meta = blocks.find((b) => b.name === 'meta');
  const name = meta ? (parseDict(meta.raw).find((e) => e.key === 'name')?.value ?? fallbackName) : fallbackName;

  const headersBlock = blocks.find((b) => b.name === 'headers');
  const queryBlock = blocks.find((b) => b.name === 'params:query' || b.name === 'query');

  return {
    name,
    request: {
      method,
      url,
      headers: headersBlock ? parseDict(headersBlock.raw).map((e) => row(e.key, e.value, e.enabled)) : [],
      query: queryBlock ? parseDict(queryBlock.raw).map((e) => row(e.key, e.value, e.enabled)) : [],
      body: readBody(blocks),
      auth: readAuth(blocks),
      timeoutMs: 30_000,
      followRedirects: true,
      maxRedirects: 5,
      insecureTls: false,
    },
  };
}

export interface BrunoImportResult {
  collection: Collection;
  requestCount: number;
  skipped: string[];
}

/** Walks a Bruno collection directory and rebuilds it as a collection. */
export async function importBrunoFolder(root: string): Promise<BrunoImportResult> {
  const now = new Date().toISOString();
  const folders: Folder[] = [];
  const requests: SavedRequest[] = [];
  const skipped: string[] = [];

  let collectionName = basename(root);
  try {
    // bruno.json names the collection; its absence is not fatal.
    const meta = JSON.parse(await readFile(join(root, 'bruno.json'), 'utf8')) as { name?: string };
    if (meta.name) collectionName = meta.name;
  } catch {
    /* Not a Bruno root, or no manifest — fall back to the directory name. */
  }

  const walk = async (dir: string, parentId: string | null, depth: number): Promise<void> => {
    if (depth > 12) return;

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      skipped.push(`${dir}: ${(err as Error).message}`);
      return;
    }

    for (const entry of entries.sort()) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const full = join(dir, entry);

      const info = await stat(full).catch(() => null);
      if (!info) continue;

      if (info.isDirectory()) {
        const folder: Folder = { id: randomUUID(), name: entry, parentId };
        folders.push(folder);
        await walk(full, folder.id, depth + 1);
        continue;
      }

      if (!entry.endsWith('.bru')) continue;

      try {
        const parsed = parseBru(await readFile(full, 'utf8'), entry.replace(/\.bru$/, ''));
        if (!parsed) {
          skipped.push(`${entry}: no request block found`);
          continue;
        }
        requests.push({
          id: randomUUID(),
          name: parsed.name,
          protocol: 'rest',
          folderId: parentId,
          rest: parsed.request,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        skipped.push(`${entry}: ${(err as Error).message}`);
      }
    }
  };

  await walk(root, null, 0);

  if (requests.length === 0) {
    throw new Error(
      `No .bru files were found under ${basename(root)}. Choose the folder that contains the ` +
        'collection, the one holding bruno.json.',
    );
  }

  return {
    collection: {
      id: randomUUID(),
      name: collectionName,
      folders,
      requests,
      createdAt: now,
      updatedAt: now,
    },
    requestCount: requests.length,
    skipped,
  };
}
