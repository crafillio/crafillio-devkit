import { PATHS, readJson, writeJson } from './paths.js';

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  /** Default request timeout in ms, applied to new requests. */
  defaultTimeoutMs: number;
  /** Wrap long lines in the response viewer. */
  wrapResponses: boolean;
  fontSize: number;
  /** Persist request history at all. Off means nothing is written to disk. */
  keepHistory: boolean;
  /**
   * Where secret values are encrypted.
   *
   * Defaults to 'keyfile' because the OS keychain shows a system prompt on
   * macOS, which is intrusive for a local dev tool and blocks entirely on
   * machines without a usable keychain.
   */
  secretStorage: 'keyfile' | 'os';
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultTimeoutMs: 30_000,
  wrapResponses: true,
  fontSize: 13,
  keepHistory: true,
  secretStorage: 'keyfile',
};

export async function loadSettings(): Promise<Settings> {
  // Merged over the defaults so a settings file written by an older build never
  // leaves a field undefined.
  return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(PATHS.settings, {})) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await loadSettings()), ...patch };
  await writeJson(PATHS.settings, merged);
  return merged;
}
