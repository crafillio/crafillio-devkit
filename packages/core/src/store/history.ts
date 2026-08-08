import { randomUUID } from 'node:crypto';
import type { HistoryEntry, Protocol } from '../types.js';
import { PATHS, readJson, writeJson } from './paths.js';

/** Capped so the file stays small and loading it never becomes a startup cost. */
const MAX_ENTRIES = 500;

export async function loadHistory(): Promise<HistoryEntry[]> {
  return readJson<HistoryEntry[]>(PATHS.history, []);
}

export async function recordHistory(entry: {
  protocol: Protocol;
  label: string;
  status?: string;
  durationMs?: number;
}): Promise<HistoryEntry[]> {
  const history = await loadHistory();
  history.unshift({ ...entry, id: randomUUID(), at: new Date().toISOString() });
  const trimmed = history.slice(0, MAX_ENTRIES);
  await writeJson(PATHS.history, trimmed);
  return trimmed;
}

export async function clearHistory(): Promise<HistoryEntry[]> {
  await writeJson(PATHS.history, []);
  return [];
}
