/**
 * Saved S3 connections. Secret access keys are sealed with the OS keychain, so
 * `connections.json` never holds a usable credential in plaintext.
 */

import { randomUUID } from 'node:crypto';
import type { S3Connection } from '../types.js';
import { PATHS, readJson, writeJson } from './paths.js';
import { isSealed, seal, unseal, type SealedValue } from './secrets.js';

export interface SavedConnection extends S3Connection {
  id: string;
  name: string;
}

type StoredConnection = Omit<SavedConnection, 'secretAccessKey' | 'sessionToken'> & {
  secretAccessKey: string | SealedValue;
  sessionToken?: string | SealedValue;
};

function hydrate(stored: StoredConnection): SavedConnection {
  return {
    ...stored,
    secretAccessKey: isSealed(stored.secretAccessKey)
      ? unseal(stored.secretAccessKey)
      : String(stored.secretAccessKey ?? ''),
    sessionToken: isSealed(stored.sessionToken)
      ? unseal(stored.sessionToken)
      : (stored.sessionToken as string | undefined),
  };
}

function dehydrate(conn: SavedConnection): StoredConnection {
  return {
    ...conn,
    secretAccessKey: conn.secretAccessKey ? seal(conn.secretAccessKey) : '',
    sessionToken: conn.sessionToken ? seal(conn.sessionToken) : undefined,
  };
}

export async function listConnections(): Promise<SavedConnection[]> {
  const stored = await readJson<StoredConnection[]>(PATHS.connections, []);
  return stored.map(hydrate);
}

export async function getConnection(id: string): Promise<SavedConnection> {
  const conn = (await listConnections()).find((c) => c.id === id);
  if (!conn) throw new Error('That S3 connection no longer exists.');
  return conn;
}

export async function saveConnection(
  conn: Omit<SavedConnection, 'id'> & { id?: string },
): Promise<SavedConnection[]> {
  const all = await listConnections();
  const saved: SavedConnection = { ...conn, id: conn.id ?? randomUUID() };

  const index = all.findIndex((c) => c.id === saved.id);
  if (index >= 0) all[index] = saved;
  else all.push(saved);

  await writeJson(PATHS.connections, all.map(dehydrate));
  return all;
}

export async function deleteConnection(id: string): Promise<SavedConnection[]> {
  const all = (await listConnections()).filter((c) => c.id !== id);
  await writeJson(PATHS.connections, all.map(dehydrate));
  return all;
}
