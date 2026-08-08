/** Workflow storage — one JSON file each, alongside collections. */

import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Workflow } from '../workflow/types.js';
import { PATHS, ensureHome, readJson, writeJson } from './paths.js';

const SUFFIX = '.workflow.json';

function fileFor(id: string): string {
  return join(PATHS.workflows, `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}${SUFFIX}`);
}

export async function listWorkflows(): Promise<Workflow[]> {
  await ensureHome();
  const entries = await readdir(PATHS.workflows).catch(() => [] as string[]);
  const loaded = await Promise.all(
    entries
      .filter((n) => n.endsWith(SUFFIX))
      .map((n) => readJson<Workflow | null>(join(PATHS.workflows, n), null)),
  );
  return loaded
    .filter((w): w is Workflow => w !== null && typeof w.id === 'string')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  return readJson<Workflow | null>(fileFor(id), null);
}

export async function createWorkflow(name: string): Promise<Workflow> {
  await ensureHome();
  const now = new Date().toISOString();
  const workflow: Workflow = {
    id: randomUUID(),
    name: name.trim() || 'Untitled workflow',
    description: '',
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(fileFor(workflow.id), workflow);
  return workflow;
}

export async function saveWorkflow(workflow: Workflow): Promise<Workflow> {
  await ensureHome();
  const updated = { ...workflow, updatedAt: new Date().toISOString() };
  await writeJson(fileFor(workflow.id), updated);
  return updated;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await unlink(fileFor(id)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}
