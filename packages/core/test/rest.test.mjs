import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sendRest, closeRestAgents } = require('../dist/index.js');

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url.startsWith('/redirect')) {
      res.writeHead(302, { location: '/landed' });
      return res.end();
    }
    if (req.url.startsWith('/landed')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ landed: true, method: req.method }));
    }
    if (req.url.startsWith('/slow')) {
      return setTimeout(() => res.end('too late'), 2000);
    }
    if (req.url.startsWith('/binary')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        url: req.url,
        method: req.method,
        auth: req.headers.authorization ?? null,
        ctype: req.headers['content-type'] ?? null,
        body: body.toString('utf8').slice(0, 200),
        len: body.length,
      }),
    );
  });
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const baseReq = {
  method: 'GET',
  url: base,
  headers: [],
  query: [],
  body: { kind: 'none' },
  auth: { kind: 'none' },
  timeoutMs: 5000,
  followRedirects: true,
  maxRedirects: 5,
  insecureTls: false,
};

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

// 1. GET with query params + bearer auth
let r = await sendRest({
  ...baseReq,
  url: `${base}/hello`,
  query: [{ id: '1', key: 'q', value: 'search term', enabled: true },
          { id: '2', key: 'skip', value: 'x', enabled: false }],
  auth: { kind: 'bearer', token: 'tok123' },
});
let j = JSON.parse(r.body);
check('GET status 200', r.status === 200);
check('query param encoded', j.url.includes('q=search+term'), j.url);
check('disabled row omitted', !j.url.includes('skip'), j.url);
check('bearer auth header', j.auth === 'Bearer tok123', j.auth);
check('timing recorded', r.timing.totalMs > 0);

// 2. POST JSON
r = await sendRest({
  ...baseReq, method: 'POST', url: `${base}/p`,
  body: { kind: 'json', text: '{"a":1}' },
});
j = JSON.parse(r.body);
check('POST json content-type', j.ctype === 'application/json', j.ctype);
check('POST json body', j.body === '{"a":1}', j.body);

// 3. Basic auth
r = await sendRest({ ...baseReq, auth: { kind: 'basic', username: 'u', password: 'p' } });
check('basic auth header', JSON.parse(r.body).auth === `Basic ${Buffer.from('u:p').toString('base64')}`);

// 4. Form body
r = await sendRest({
  ...baseReq, method: 'POST',
  body: { kind: 'form', fields: [{ id: '1', key: 'a', value: 'b c', enabled: true }] },
});
j = JSON.parse(r.body);
check('form urlencoded', j.ctype === 'application/x-www-form-urlencoded' && j.body === 'a=b+c', j.body);

// 5. Multipart
r = await sendRest({
  ...baseReq, method: 'POST',
  body: { kind: 'multipart', fields: [{ id: '1', key: 'field', enabled: true, type: 'text', value: 'val' }] },
});
j = JSON.parse(r.body);
check('multipart boundary', j.ctype.startsWith('multipart/form-data; boundary='), j.ctype);
check('multipart body carries field', j.body.includes('name="field"') && j.body.includes('val'));

// 6. Redirect following + POST->GET downgrade
r = await sendRest({ ...baseReq, method: 'POST', url: `${base}/redirect`, body: { kind: 'json', text: '{}' } });
j = JSON.parse(r.body);
check('redirect followed', j.landed === true);
check('302 POST downgraded to GET', j.method === 'GET', j.method);
check('redirect chain recorded', r.redirects.length === 1, JSON.stringify(r.redirects));

// 7. Redirects disabled
r = await sendRest({ ...baseReq, url: `${base}/redirect`, followRedirects: false });
check('redirect not followed when disabled', r.status === 302, String(r.status));

// 8. Timeout
try {
  await sendRest({ ...baseReq, url: `${base}/slow`, timeoutMs: 300 });
  check('timeout throws', false);
} catch (e) {
  check('timeout throws with message', e.message.includes('timed out'), e.message);
}

// 9. Binary response detection
r = await sendRest({ ...baseReq, url: `${base}/binary` });
check('binary body base64-encoded', r.bodyEncoding === 'base64', r.bodyEncoding);
check('binary bytes intact', Buffer.from(r.body, 'base64').length === 4);

// 10. Bad host error message
try {
  await sendRest({ ...baseReq, url: 'http://no-such-host.invalid/' });
  check('bad host throws', false);
} catch (e) {
  check('bad host friendly error', /Host not found|ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(e.message), e.message);
}

console.log(`\nREST: ${pass} passed, ${fail} failed`);
await closeRestAgents();
server.close();
process.exit(fail ? 1 : 0);
