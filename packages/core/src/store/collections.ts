/**
 * Collection storage.
 *
 * One JSON file per collection under `~/.crafillio/collections`, so a developer can
 * put a collection in their own git repo, diff it, or hand it to a teammate as a
 * file. Nothing is shared unless they choose to share the file themselves.
 */

import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Collection, Folder, SavedRequest } from '../types.js';
import { PATHS, ensureHome, readJson, writeJson } from './paths.js';

const FILE_SUFFIX = '.collection.json';

/** Keeps a collection id usable as a filename across platforms. */
function fileFor(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(PATHS.collections, `${safe}${FILE_SUFFIX}`);
}

function now(): string {
  return new Date().toISOString();
}

export async function listCollections(): Promise<Collection[]> {
  await ensureHome();
  const entries = await readdir(PATHS.collections).catch(() => [] as string[]);

  const collections = await Promise.all(
    entries
      .filter((name) => name.endsWith(FILE_SUFFIX))
      .map((name) => readJson<Collection | null>(join(PATHS.collections, name), null)),
  );

  return collections
    .filter((c): c is Collection => c !== null && typeof c.id === 'string')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCollection(id: string): Promise<Collection | null> {
  return readJson<Collection | null>(fileFor(id), null);
}

export async function createCollection(name: string): Promise<Collection> {
  await ensureHome();
  const collection: Collection = {
    id: randomUUID(),
    name: name.trim() || 'Untitled collection',
    folders: [],
    requests: [],
    createdAt: now(),
    updatedAt: now(),
  };
  await writeJson(fileFor(collection.id), collection);
  return collection;
}

export async function saveCollection(collection: Collection): Promise<Collection> {
  await ensureHome();
  const updated = { ...collection, updatedAt: now() };
  await writeJson(fileFor(collection.id), updated);
  return updated;
}

export async function deleteCollection(id: string): Promise<void> {
  await unlink(fileFor(id)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

export async function renameCollection(id: string, name: string): Promise<Collection> {
  const collection = await requireCollection(id);
  return saveCollection({ ...collection, name: name.trim() || collection.name });
}

/* ------------------------------------------------------------------ */
/* Requests & folders                                                  */
/* ------------------------------------------------------------------ */

async function requireCollection(id: string): Promise<Collection> {
  const collection = await getCollection(id);
  if (!collection) throw new Error(`Collection ${id} no longer exists.`);
  return collection;
}

export async function upsertRequest(
  collectionId: string,
  request: Omit<SavedRequest, 'createdAt' | 'updatedAt'> & Partial<Pick<SavedRequest, 'createdAt'>>,
): Promise<Collection> {
  const collection = await requireCollection(collectionId);
  const index = collection.requests.findIndex((r) => r.id === request.id);

  const saved: SavedRequest = {
    ...request,
    createdAt: request.createdAt ?? collection.requests[index]?.createdAt ?? now(),
    updatedAt: now(),
  };

  if (index >= 0) collection.requests[index] = saved;
  else collection.requests.push(saved);

  return saveCollection(collection);
}

export async function deleteRequest(
  collectionId: string,
  requestId: string,
): Promise<Collection> {
  const collection = await requireCollection(collectionId);
  collection.requests = collection.requests.filter((r) => r.id !== requestId);
  return saveCollection(collection);
}

export async function createFolder(
  collectionId: string,
  name: string,
  parentId: string | null = null,
): Promise<Collection> {
  const collection = await requireCollection(collectionId);
  const folder: Folder = { id: randomUUID(), name: name.trim() || 'New folder', parentId };
  collection.folders.push(folder);
  return saveCollection(collection);
}

/**
 * Removes a folder, its descendants, and every request inside them.
 */
export async function deleteFolder(
  collectionId: string,
  folderId: string,
): Promise<Collection> {
  const collection = await requireCollection(collectionId);

  const doomed = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of collection.folders) {
      if (folder.parentId && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
        doomed.add(folder.id);
        grew = true;
      }
    }
  }

  collection.folders = collection.folders.filter((f) => !doomed.has(f.id));
  collection.requests = collection.requests.filter(
    (r) => r.folderId === null || !doomed.has(r.folderId),
  );
  return saveCollection(collection);
}

export async function moveRequest(
  collectionId: string,
  requestId: string,
  folderId: string | null,
): Promise<Collection> {
  const collection = await requireCollection(collectionId);
  const request = collection.requests.find((r) => r.id === requestId);
  if (!request) throw new Error('That request no longer exists.');
  request.folderId = folderId;
  request.updatedAt = now();
  return saveCollection(collection);
}

/* ------------------------------------------------------------------ */
/* Portability                                                         */
/* ------------------------------------------------------------------ */

/** Exports a collection as pretty JSON for check-in or hand-off. */
export async function exportCollection(id: string): Promise<string> {
  const collection = await requireCollection(id);
  return JSON.stringify(collection, null, 2);
}

/** Imports an exported collection, always under a fresh id to avoid clobbering. */
export async function importCollection(json: string): Promise<Collection> {
  let parsed: Collection;
  try {
    parsed = JSON.parse(json) as Collection;
  } catch (err) {
    throw new Error(`Not a valid collection file: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed.requests)) {
    throw new Error('Not a Crafillio DevKit collection — no "requests" array found.');
  }

  const collection: Collection = {
    ...parsed,
    id: randomUUID(),
    name: parsed.name ? `${parsed.name} (imported)` : 'Imported collection',
    folders: parsed.folders ?? [],
    createdAt: now(),
    updatedAt: now(),
  };

  await ensureHome();
  await writeJson(fileFor(collection.id), collection);
  return collection;
}
