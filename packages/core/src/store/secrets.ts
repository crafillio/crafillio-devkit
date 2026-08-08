/**
 * Secret handling.
 *
 * Core does not import Electron, so the encryption backends are injected by
 * the shell at startup. Two are supported:
 *
 *   'keyfile' — a local AES-256-GCM key file. Never prompts, works everywhere.
 *   'os'      — the OS keychain (Electron safeStorage). Stronger, but on macOS
 *               it shows a keychain prompt the first time it is used.
 *
 * Sealed values record which backend produced them, so switching backends
 * leaves previously stored secrets readable as long as the old one is still
 * registered.
 */

export interface SecretProvider {
  available: boolean;
  /** Returns base64 ciphertext. */
  encrypt(plaintext: string): string;
  decrypt(ciphertextBase64: string): string;
}

export type SecretBackend = 'keyfile' | 'os';

const providers = new Map<SecretBackend, SecretProvider>();
let preferred: SecretBackend = 'keyfile';

/**
 * Registers a backend. Defaults to 'os' so existing callers (and tests) that
 * inject a single provider keep working unchanged.
 */
export function registerSecretProvider(
  provider: SecretProvider,
  backend: SecretBackend = 'os',
): void {
  providers.set(backend, provider);
}

export function setPreferredSecretBackend(backend: SecretBackend): void {
  preferred = backend;
}

export function preferredSecretBackend(): SecretBackend {
  return preferred;
}

export function secretsAvailable(): boolean {
  return providers.get(preferred)?.available ?? false;
}

/** Marker shape written to disk in place of a secret value. */
export interface SealedValue {
  __sealed: true;
  data: string;
  /** Which backend sealed this. Absent on files written before backends existed. */
  backend?: SecretBackend;
}

export function isSealed(value: unknown): value is SealedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as SealedValue).__sealed === true &&
    typeof (value as SealedValue).data === 'string'
  );
}

export function seal(plaintext: string): SealedValue {
  const provider = providers.get(preferred);
  if (!provider?.available) {
    throw new Error(
      `Secret storage backend "${preferred}" is unavailable, so this value cannot be stored ` +
        'as a secret. Untick "secret" to store it in plain text, or switch backend in About.',
    );
  }
  return { __sealed: true, data: provider.encrypt(plaintext), backend: preferred };
}

/** Returns the plaintext, or empty string when the value can no longer be decrypted. */
export function unseal(value: SealedValue): string {
  // Untagged values predate multi-backend support and came from the keychain.
  const backend = value.backend ?? 'os';

  const tryWith = (id: SecretBackend): string | null => {
    const provider = providers.get(id);
    if (!provider?.available) return null;
    try {
      return provider.decrypt(value.data);
    } catch {
      return null;
    }
  };

  const direct = tryWith(backend);
  if (direct !== null) return direct;

  // Fall back to the other backend: an untagged value may in fact have been
  // written by the keyfile, and a migrated file may be tagged either way.
  const other: SecretBackend = backend === 'os' ? 'keyfile' : 'os';
  const fallback = tryWith(other);
  if (fallback !== null) return fallback;

  // Happens when the keychain entry is gone or the key file was replaced —
  // e.g. after restoring config onto a different machine. Blanking the field
  // is better than crashing the app on load.
  return '';
}
