import { randomUUID } from 'node:crypto';
import type { EnvVariable, Environment } from '../types.js';
import { PATHS, readJson, writeJson } from './paths.js';
import { isSealed, seal, unseal, type SealedValue } from './secrets.js';

interface EnvFile {
  environments: Environment[];
  activeId: string | null;
}

/** On-disk shape: a secret variable's `value` is a SealedValue, not a string. */
type StoredVariable = Omit<EnvVariable, 'value'> & { value: string | SealedValue };
type StoredEnvironment = Omit<Environment, 'variables'> & { variables: StoredVariable[] };
interface StoredEnvFile {
  environments: StoredEnvironment[];
  activeId: string | null;
}

const EMPTY: StoredEnvFile = { environments: [], activeId: null };

function hydrate(stored: StoredEnvFile): EnvFile {
  return {
    activeId: stored.activeId,
    environments: (stored.environments ?? []).map((env) => ({
      ...env,
      variables: (env.variables ?? []).map((v) => ({
        ...v,
        value: isSealed(v.value) ? unseal(v.value) : String(v.value ?? ''),
      })),
    })),
  };
}

function dehydrate(file: EnvFile): StoredEnvFile {
  return {
    activeId: file.activeId,
    environments: file.environments.map((env) => ({
      ...env,
      variables: env.variables.map((v) => ({
        ...v,
        value: v.secret && v.value ? seal(v.value) : v.value,
      })),
    })),
  };
}

export async function loadEnvironments(): Promise<EnvFile> {
  return hydrate(await readJson<StoredEnvFile>(PATHS.environments, EMPTY));
}

export async function saveEnvironments(file: EnvFile): Promise<EnvFile> {
  await writeJson(PATHS.environments, dehydrate(file));
  return file;
}

export async function createEnvironment(name: string): Promise<EnvFile> {
  const file = await loadEnvironments();
  const env: Environment = {
    id: randomUUID(),
    name: name.trim() || 'New environment',
    variables: [],
  };
  file.environments.push(env);
  file.activeId ??= env.id;
  return saveEnvironments(file);
}

export async function deleteEnvironment(id: string): Promise<EnvFile> {
  const file = await loadEnvironments();
  file.environments = file.environments.filter((e) => e.id !== id);
  if (file.activeId === id) file.activeId = file.environments[0]?.id ?? null;
  return saveEnvironments(file);
}

export async function setActiveEnvironment(id: string | null): Promise<EnvFile> {
  const file = await loadEnvironments();
  file.activeId = id;
  return saveEnvironments(file);
}

/** Flattens the active environment into a plain lookup for interpolation. */
export async function activeVariables(): Promise<Record<string, string>> {
  const file = await loadEnvironments();
  const active = file.environments.find((e) => e.id === file.activeId);
  if (!active) return {};

  const out: Record<string, string> = {};
  for (const v of active.variables) {
    if (v.enabled && v.key.trim()) out[v.key] = v.value;
  }
  return out;
}
