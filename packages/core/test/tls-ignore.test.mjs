/**
 * The per-host TLS ignore list, against a real self-signed HTTPS server.
 * A mock cannot show that verification was genuinely bypassed.
 */

import { createRequire } from 'node:module';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { sendRest, setNetworkPolicy, closeRestAgents } = require('../dist/index.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

// A self-signed certificate for "localhost" — untrusted by design.
const dir = mkdtempSync(join(tmpdir(), 'ck-tls-'));
const key = join(dir, 'k.pem'), cert = join(dir, 'c.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', key, '-out', cert, '-days', '2',
  '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
  { stdio: 'ignore' });

const server = https.createServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); },
);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const req = (over = {}) => ({
  method: 'GET', url: `https://localhost:${port}/`, headers: [], query: [],
  body: { kind: 'none' }, auth: { kind: 'none' }, timeoutMs: 8000,
  followRedirects: false, maxRedirects: 0, insecureTls: false, ...over,
});
const attempt = async (o) => {
  try { const r = await sendRest(req(o)); return { ok: true, status: r.status }; }
  catch (e) { return { ok: false, error: e.message }; }
};

/* ---- Verification on: a self-signed cert must be refused ---- */
setNetworkPolicy({ tls: { verify: true, ignoreHosts: [], caPath: '', certificates: [] } });
closeRestAgents();
let r = await attempt();
check('self-signed cert is rejected when verification is on', !r.ok, JSON.stringify(r));
check('  ...and the error names the certificate problem',
  /self[- ]signed|unable to verify|certificate/i.test(r.error ?? ''), r.error);

/* ---- The host is on the ignore list ---- */
setNetworkPolicy({ tls: { verify: true, ignoreHosts: ['localhost'], caPath: '', certificates: [] } });
closeRestAgents();
r = await attempt();
check('an ignored host connects despite the bad cert', r.ok && r.status === 200, JSON.stringify(r));

/* ---- A different host on the list must not help ---- */
setNetworkPolicy({ tls: { verify: true, ignoreHosts: ['other.example'], caPath: '', certificates: [] } });
closeRestAgents();
r = await attempt();
check('ignoring a different host does not weaken this one', !r.ok, JSON.stringify(r));

/* ---- Wildcards ---- */
setNetworkPolicy({ tls: { verify: true, ignoreHosts: ['*.localhost'], caPath: '', certificates: [] } });
closeRestAgents();
r = await attempt();
check('a *.host wildcard also covers the bare host', r.ok, JSON.stringify(r));

/* ---- Per-request override still wins ---- */
setNetworkPolicy({ tls: { verify: true, ignoreHosts: [], caPath: '', certificates: [] } });
closeRestAgents();
r = await attempt({ insecureTls: true });
check('a per-request override still bypasses verification', r.ok && r.status === 200, JSON.stringify(r));

/* ---- Global off still works ---- */
setNetworkPolicy({ tls: { verify: false, ignoreHosts: [], caPath: '', certificates: [] } });
closeRestAgents();
r = await attempt();
check('turning verification off globally still works', r.ok, JSON.stringify(r));

server.close();
closeRestAgents();
console.log(`\nTLS ignore: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
