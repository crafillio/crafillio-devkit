import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';

/**
 * Everything Crafillio DevKit persists lives under one directory in the developer's home.
 * Nothing leaves this machine — there is no sync service and no telemetry.
 */
export const CRAFILLIO_HOME = process.env.CRAFILLIO_HOME || join(homedir(), '.crafillio');

export const PATHS = {
  home: CRAFILLIO_HOME,
  collections: join(CRAFILLIO_HOME, 'collections'),
  workflows: join(CRAFILLIO_HOME, 'workflows'),
  environments: join(CRAFILLIO_HOME, 'environments.json'),
  connections: join(CRAFILLIO_HOME, 'connections.json'),
  history: join(CRAFILLIO_HOME, 'history.json'),
  settings: join(CRAFILLIO_HOME, 'settings.json'),
  /** Local encryption key. Created on demand, mode 0600. */
  secretKey: join(CRAFILLIO_HOME, 'secret.key'),
} as const;

export async function ensureHome(): Promise<void> {
  await mkdir(PATHS.collections, { recursive: true });
  await mkdir(PATHS.workflows, { recursive: true });
}

/** Reads JSON, returning `fallback` when the file is missing or unparseable. */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    // A corrupt file must not take the app down — the user keeps working and
    // the bad file is left in place for them to inspect.
    console.error(`Crafillio DevKit: could not read ${path}:`, (err as Error).message);
    return fallback;
  }
}

/**
 * Writes JSON atomically. A crash mid-write would otherwise leave a truncated
 * collection file, which is a developer's saved work.
 */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}
