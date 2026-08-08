/** Keyfile secret storage — the prompt-free encryption backend. */

import { createRequire } from 'node:module';
import { mkdtempSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createKeyfileProvider, verifyProvider } = require('../dist/index.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const dir = mkdtempSync(join(tmpdir(), 'ck-key-'));
const keyPath = join(dir, 'secret.key');

const provider = createKeyfileProvider(keyPath);
check('provider reports available without any OS support', provider.available === true);

const secret = 'sk_live_51H8xY2z';
const sealed = provider.encrypt(secret);
check('ciphertext differs from plaintext', !sealed.includes(secret), sealed.slice(0, 24));
check('round trips', provider.decrypt(sealed) === secret);
check('self-test passes', verifyProvider(provider) === true);

// Key file is created lazily on first use, with owner-only permissions.
const mode = statSync(keyPath).mode & 0o777;
check('key file is 0600', mode === 0o600, '0' + mode.toString(8));
check('key is 32 bytes (AES-256)', readFileSync(keyPath).length === 32, String(readFileSync(keyPath).length));

// Same key file => same plaintext recoverable from a fresh provider instance,
// which is what makes secrets survive a restart.
const reopened = createKeyfileProvider(keyPath);
check('a new instance reads values written by the old one', reopened.decrypt(sealed) === secret);

// Nonce must be random, or identical secrets would be linkable on disk.
check('same plaintext encrypts differently each time', provider.encrypt(secret) !== provider.encrypt(secret));

// GCM authentication must reject tampering rather than return garbage.
const raw = Buffer.from(sealed, 'base64');
raw[raw.length - 1] ^= 0xff;
try {
  provider.decrypt(raw.toString('base64'));
  check('tampered ciphertext rejected', false);
} catch {
  check('tampered ciphertext rejected', true);
}

// A different key must not decrypt another key file's data.
const otherPath = join(dir, 'other.key');
const other = createKeyfileProvider(otherPath);
other.encrypt('warm up');
try {
  other.decrypt(sealed);
  check('wrong key cannot decrypt', false);
} catch {
  check('wrong key cannot decrypt', true);
}

// A corrupt key file must fail loudly, not silently mint a new key and lose data.
const badPath = join(dir, 'bad.key');
writeFileSync(badPath, Buffer.alloc(7));
try {
  createKeyfileProvider(badPath).encrypt('x');
  check('malformed key file reports clearly', false);
} catch (e) {
  check('malformed key file reports clearly', e.message.includes('expected 32'), e.message);
}

console.log(`\nKeyfile: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
