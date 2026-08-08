/**
 * Keyfile secret storage — encryption with no OS keychain and no prompts.
 *
 * A random 256-bit key is generated once and kept in a file next to the data,
 * readable only by the owning user (mode 0600). Values are sealed with
 * AES-256-GCM, so the ciphertext is authenticated as well as encrypted.
 *
 * The honest trade-off: because the key sits beside the data, anyone who can
 * read your home directory can read your secrets. It protects against the
 * realistic accidents — committing a config file, syncing it to cloud storage,
 * handing someone an export, or a backup landing somewhere shared — but it is
 * not a defence against an attacker who already has your user account. The OS
 * keychain is stronger precisely because it can prompt; that is what this
 * avoids.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SecretProvider } from './secrets.js';

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

/** Reads the key, creating it on first use. */
function loadOrCreateKey(keyPath: string): Buffer {
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath);
    if (key.length === KEY_BYTES) {
      // Re-assert permissions in case the file was restored or copied with
      // looser ones.
      try {
        chmodSync(keyPath, 0o600);
      } catch {
        /* Non-POSIX filesystems may refuse; the key is still usable. */
      }
      return key;
    }
    throw new Error(
      `Secret key at ${keyPath} is ${key.length} bytes, expected ${KEY_BYTES}. ` +
        'Move it aside to have a new one generated — previously stored secrets will need re-entering.',
    );
  }

  const key = randomBytes(KEY_BYTES);
  mkdirSync(dirname(keyPath), { recursive: true });
  // The mode argument covers the create; chmod covers a pre-existing inode.
  writeFileSync(keyPath, key, { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* See above. */
  }
  return key;
}

/**
 * Builds a provider backed by a local key file.
 *
 * The key is read lazily on first use so that merely constructing this never
 * touches the disk — the app can offer the option without committing to it.
 */
export function createKeyfileProvider(keyPath: string): SecretProvider {
  let cached: Buffer | null = null;

  const key = (): Buffer => {
    if (!cached) cached = loadOrCreateKey(keyPath);
    return cached;
  };

  return {
    // Always usable: it depends on nothing but the filesystem.
    available: true,

    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key(), iv);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      // iv || ciphertext || tag
      return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
    },

    decrypt(ciphertextBase64: string): string {
      const raw = Buffer.from(ciphertextBase64, 'base64');
      if (raw.length < IV_BYTES + TAG_BYTES) {
        throw new Error('Secret is truncated or not keyfile-encrypted.');
      }

      const iv = raw.subarray(0, IV_BYTES);
      const tag = raw.subarray(raw.length - TAG_BYTES);
      const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);

      const decipher = createDecipheriv('aes-256-gcm', key(), iv);
      decipher.setAuthTag(tag);
      // `final()` throws if the tag does not verify, which is how tampering
      // and a wrong key both surface.
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    },
  };
}

/** Exported for the self-test below and for callers that want to verify setup. */
export function verifyProvider(provider: SecretProvider): boolean {
  const probe = `crafillio-self-test-${randomBytes(8).toString('hex')}`;
  try {
    const roundTripped = provider.decrypt(provider.encrypt(probe));
    return timingSafeEqual(Buffer.from(roundTripped), Buffer.from(probe));
  } catch {
    return false;
  }
}
