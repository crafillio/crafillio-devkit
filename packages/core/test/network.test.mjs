/** Proxy routing and TLS policy, against a real proxy and a real TLS server. */

import { createRequire } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { X509Certificate, generateKeyPairSync, createSign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { sendRest, setNetworkPolicy, closeRestAgents, isBypassed, certificateFor } =
  require('../dist/index.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const rest = (url, over = {}) => ({
  method: 'GET', url, headers: [], query: [], body: { kind: 'none' }, auth: { kind: 'none' },
  timeoutMs: 6000, followRedirects: false, maxRedirects: 0, insecureTls: false, ...over,
});

/* ---- Bypass matching (pure) ---- */

check('bypass: exact host', isBypassed('localhost', ['localhost']));
check('bypass: non-match', !isBypassed('api.example.com', ['localhost']));
check('bypass: leading wildcard', isBypassed('api.internal', ['*.internal']));
check('bypass: wildcard matches the bare domain too', isBypassed('internal', ['*.internal']));
check('bypass: case-insensitive', isBypassed('API.Example.COM', ['api.example.com']));
check('bypass: blank entries ignored', !isBypassed('x.test', ['', '   ']));

/* ---- Certificate selection (pure) ---- */

const certs = [
  { id: 'wild', host: '*.example.com', certPath: 'c', keyPath: 'k', pfxPath: '', passphrase: '' },
  { id: 'exact', host: 'api.example.com', certPath: 'c2', keyPath: 'k2', pfxPath: '', passphrase: '' },
];
check('cert: exact host beats wildcard', certificateFor('api.example.com', certs)?.id === 'exact');
check('cert: wildcard used when no exact match', certificateFor('cdn.example.com', certs)?.id === 'wild');
check('cert: no match returns undefined', certificateFor('other.test', certs) === undefined);

/* ---- Origin server ---- */

const origin = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, via: 'origin', host: req.headers.host }));
});
await new Promise((r) => origin.listen(0, '127.0.0.1', r));
const originPort = origin.address().port;

/* ---- Forward proxy ---- */

let proxied = 0;
let lastProxyAuth = null;
const proxy = http.createServer((req, res) => {
  proxied++;
  lastProxyAuth = req.headers['proxy-authorization'] ?? null;
  // Absolute-form request URI is what a forward proxy receives.
  const target = new URL(req.url);
  const upstream = http.request(
    { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => { res.writeHead(502); res.end('proxy upstream error'); });
  req.pipe(upstream);
});
// CONNECT support. undici's ProxyAgent tunnels every request this way, even
// plain HTTP, so this is the path that actually gets exercised.
proxy.on('connect', (req, clientSocket, head) => {
  proxied++;
  lastProxyAuth = req.headers['proxy-authorization'] ?? null;
  const [host, port] = req.url.split(':');
  const server = net.connect(Number(port), host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    server.write(head);
    server.pipe(clientSocket);
    clientSocket.pipe(server);
  });
  server.on('error', () => clientSocket.destroy());
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const proxyPort = proxy.address().port;

/* ---- Direct, no proxy ---- */

setNetworkPolicy({});
let res = await sendRest(rest(`http://127.0.0.1:${originPort}/direct`));
check('direct request works with no policy', res.status === 200 && JSON.parse(res.body).via === 'origin');
check('proxy untouched when disabled', proxied === 0, String(proxied));

/* ---- Through the proxy ---- */

setNetworkPolicy({
  proxy: {
    enabled: true, protocol: 'http', host: '127.0.0.1', port: proxyPort,
    forHttp: true, forHttps: true,
    auth: { enabled: false, username: '', password: '' },
    bypass: [],
  },
});
res = await sendRest(rest(`http://127.0.0.1:${originPort}/viaproxy`));
check('PROXY: request routed through the proxy', proxied === 1, `proxied=${proxied}`);
check('PROXY: response still correct', res.status === 200 && JSON.parse(res.body).ok === true);

/* ---- Proxy auth ---- */

setNetworkPolicy({
  proxy: {
    enabled: true, protocol: 'http', host: '127.0.0.1', port: proxyPort,
    forHttp: true, forHttps: true,
    auth: { enabled: true, username: 'user', password: 'p@ss' },
    bypass: [],
  },
});
await sendRest(rest(`http://127.0.0.1:${originPort}/auth`));
const expected = 'Basic ' + Buffer.from('user:p@ss').toString('base64');
check('PROXY AUTH: credentials sent to the proxy', lastProxyAuth === expected, String(lastProxyAuth));

/* ---- Bypass list ---- */

const before = proxied;
setNetworkPolicy({
  proxy: {
    enabled: true, protocol: 'http', host: '127.0.0.1', port: proxyPort,
    forHttp: true, forHttps: true,
    auth: { enabled: false, username: '', password: '' },
    bypass: ['127.0.0.1'],
  },
});
res = await sendRest(rest(`http://127.0.0.1:${originPort}/bypassed`));
check('BYPASS: host on the bypass list goes direct', proxied === before && res.status === 200,
  `proxied went ${before} -> ${proxied}`);

/* ---- Protocol scoping ---- */

const beforeHttp = proxied;
setNetworkPolicy({
  proxy: {
    enabled: true, protocol: 'http', host: '127.0.0.1', port: proxyPort,
    forHttp: false, forHttps: true,
    auth: { enabled: false, username: '', password: '' },
    bypass: [],
  },
});
await sendRest(rest(`http://127.0.0.1:${originPort}/httpoff`));
check('SCOPE: http skipped when only https is proxied', proxied === beforeHttp, `proxied=${proxied}`);

/* ---- TLS verification ---- */

// A self-signed cert, generated with openssl so the test needs no fixtures.
const work = mkdtempSync(join(tmpdir(), 'ck-tls-'));
const keyPath = join(work, 'key.pem');
const certPath = join(work, 'cert.pem');
let tlsReady = true;
try {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ], { stdio: 'ignore' });
} catch {
  tlsReady = false;
}

if (tlsReady) {
  const tlsServer = https.createServer(
    { key: require('node:fs').readFileSync(keyPath), cert: require('node:fs').readFileSync(certPath) },
    (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"secure":true}'); },
  );
  await new Promise((r) => tlsServer.listen(0, '127.0.0.1', r));
  const tlsPort = tlsServer.address().port;
  const tlsUrl = `https://localhost:${tlsPort}/s`;

  // Verification on: an untrusted self-signed cert must be rejected.
  setNetworkPolicy({ tls: { verify: true, caPath: '', certificates: [] } });
  try {
    await sendRest(rest(tlsUrl));
    check('TLS: self-signed rejected when verification is on', false);
  } catch (e) {
    check('TLS: self-signed rejected when verification is on', /not trusted|self.signed|certificate/i.test(e.message), e.message);
  }

  // Verification off globally — Postman's "SSL certificate verification".
  setNetworkPolicy({ tls: { verify: false, caPath: '', certificates: [] } });
  res = await sendRest(rest(tlsUrl));
  check('TLS: turning verification off allows it through', res.status === 200, String(res.status));

  // Trusting the CA explicitly is the safe route and must also work.
  setNetworkPolicy({ tls: { verify: true, caPath: certPath, certificates: [] } });
  res = await sendRest(rest(tlsUrl));
  check('TLS: trusting a custom CA works without disabling verification', res.status === 200, String(res.status));

  // Per-request override still wins over a strict global policy.
  setNetworkPolicy({ tls: { verify: true, caPath: '', certificates: [] } });
  res = await sendRest(rest(tlsUrl, { insecureTls: true }));
  check('TLS: per-request override beats the global setting', res.status === 200, String(res.status));

  // An unreadable certificate path must say so, not fail obscurely.
  setNetworkPolicy({ tls: { verify: true, caPath: join(work, 'missing.pem'), certificates: [] } });
  try {
    await sendRest(rest(tlsUrl));
    check('TLS: missing CA file reports the path', false);
  } catch (e) {
    check('TLS: missing CA file reports the path', e.message.includes('missing.pem'), e.message);
  }

  tlsServer.close();
} else {
  console.log('  SKIP  TLS checks (openssl unavailable)');
}

setNetworkPolicy({});
console.log(`\nNetwork: ${pass} passed, ${fail} failed`);
await closeRestAgents();
origin.close();
proxy.close();
process.exit(fail ? 1 : 0);
