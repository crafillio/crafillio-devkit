/** JWT decoding, including the tokens that are wrong in interesting ways. */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { decodeJwt, looksLikeJwt } = require('../dist/index.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const b64 = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const make = (header, payload, sig = 'c2ln') => `${b64(header)}.${b64(payload)}.${sig}`;

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const secs = (ms) => Math.floor(ms / 1000);

/* ---- An ordinary token ---- */
const token = make(
  { alg: 'RS256', typ: 'JWT', kid: 'key-1' },
  {
    iss: 'https://auth.example.com',
    sub: 'user_123',
    aud: 'api://orders',
    exp: secs(NOW + 3600_000),
    iat: secs(NOW - 60_000),
    scope: 'orders:read orders:write',
    email: 'someone@example.com',
    roles: ['admin', 'auditor'],
  },
);
let d = decodeJwt(token, NOW);
check('algorithm read from the header', d.algorithm === 'RS256');
check('kid preserved', d.header.kid === 'key-1');
check('subject decoded', d.payload.sub === 'user_123');
check('payload pretty-printed', d.payloadJson.includes('\n  "sub"'));
check('not expired', d.expired === false);
check('exp rendered as a date', d.claims.find((c) => c.name === 'exp').value.startsWith('2026-01-15T13:00'));
check('exp described relatively', d.claims.find((c) => c.name === 'exp').relative === 'in 1 hour');
check('iat described in the past', d.claims.find((c) => c.name === 'iat').relative === '1 minute ago');
check('registered claims explained', d.claims.find((c) => c.name === 'iss').meaning.includes('Issuer'));
check('array claim JSON-encoded', d.claims.find((c) => c.name === 'roles').value === '["admin","auditor"]');
check('no warnings for a healthy token', d.warnings.length === 0, JSON.stringify(d.warnings));
check('signature kept', d.signature === 'c2ln');

/* ---- Expired ---- */
d = decodeJwt(make({ alg: 'HS256' }, { exp: secs(NOW - 180_000) }), NOW);
check('expiry detected', d.expired === true);
check('  ...and said so', d.warnings.some((w) => /expired/i.test(w)));
check('  ...with how long ago', d.claims.find((c) => c.name === 'exp').relative === '3 minutes ago');

/* ---- Not yet valid ---- */
d = decodeJwt(make({ alg: 'HS256' }, { nbf: secs(NOW + 600_000), exp: secs(NOW + 999_000) }), NOW);
check('nbf in the future is flagged', d.notYetValid === true);
check('  ...and warned about', d.warnings.some((w) => /not valid yet/i.test(w)));

/* ---- Unsigned ---- */
d = decodeJwt(make({ alg: 'none' }, { sub: 'x', exp: secs(NOW + 60_000) }, ''), NOW);
check('alg none is called out', d.warnings.some((w) => /unsigned/i.test(w)), JSON.stringify(d.warnings));

/* ---- No expiry at all ---- */
d = decodeJwt(make({ alg: 'HS256' }, { sub: 'forever' }), NOW);
check('a token with no exp is flagged', d.warnings.some((w) => /does not expire/i.test(w)));
check('expired is undefined rather than false', d.expired === undefined);

/* ---- Tolerating how tokens are actually pasted ---- */
check('a Bearer prefix is stripped', decodeJwt(`Bearer ${token}`, NOW).payload.sub === 'user_123');
check('surrounding quotes are stripped', decodeJwt(`"${token}"`, NOW).payload.sub === 'user_123');
check('wrapped whitespace is ignored',
  decodeJwt(token.slice(0, 20) + '\n  ' + token.slice(20), NOW).payload.sub === 'user_123');
check('leading and trailing space is ignored', decodeJwt(`  ${token}  `, NOW).payload.sub === 'user_123');

/* ---- Rejections, with useful messages ---- */
const bad = (t) => { try { decodeJwt(t, NOW); return null; } catch (e) { return e.message; } };
check('empty input rejected', bad('') !== null);
check('two dots required', /three dot-separated parts/.test(bad('abc') ?? ''), bad('abc'));
check('a JWE is identified rather than mangled',
  /JWE/.test(bad('a.b.c.d.e') ?? ''), bad('a.b.c.d.e'));
check('garbage payload reports which part failed',
  /payload is not readable/.test(bad(`${b64({ alg: 'HS256' })}.!!!!.sig`) ?? ''),
  bad(`${b64({ alg: 'HS256' })}.!!!!.sig`));
check('valid base64 that is not JSON is rejected',
  /not readable/.test(bad(`${b64({ alg: 'HS256' })}.aGVsbG8.sig`) ?? ''),
  bad(`${b64({ alg: 'HS256' })}.aGVsbG8.sig`));

/* ---- Sniffing ---- */
check('looksLikeJwt accepts one', looksLikeJwt(token));
check('looksLikeJwt accepts a Bearer one', looksLikeJwt(`Bearer ${token}`));
check('looksLikeJwt rejects a plain string', !looksLikeJwt('hello world'));
check('looksLikeJwt rejects a URL', !looksLikeJwt('https://example.com/a.b.c'));

/* ---- Unicode survives the round trip ---- */
d = decodeJwt(make({ alg: 'HS256' }, { name: 'Ünïcodé — 名前', exp: secs(NOW + 60_000) }), NOW);
check('non-ASCII claims decode correctly', d.payload.name === 'Ünïcodé — 名前', String(d.payload.name));

console.log(`\nJWT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
