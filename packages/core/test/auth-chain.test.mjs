/**
 * The common shape: one auth call, then every later step uses the token.
 *
 * The server rejects anything but the real token, so a step that "passed"
 * without actually carrying it would fail here rather than quietly succeed.
 */

import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { runWorkflow, closeRestAgents } = require('../dist/index.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const TOKEN = 'tok_' + Math.random().toString(36).slice(2, 10);
let issued = 0;
const seen = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === '/auth') {
    issued += 1;
    return json(200, { access_token: TOKEN, expires_in: 3600, token_type: 'Bearer' });
  }

  // Every other route demands the token, from a header or the query string.
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const viaQuery = url.searchParams.get('access_token');
  const supplied = bearer || viaQuery;
  seen.push({ path: url.pathname, supplied });
  if (supplied !== TOKEN) return json(401, { error: 'unauthorized', supplied: supplied ?? null });

  if (url.pathname === '/orders') return json(201, { orderId: 'ord_1', state: 'queued' });
  if (url.pathname === '/orders/ord_1') return json(200, { orderId: 'ord_1', state: 'shipped' });
  if (url.pathname === '/audit') return json(200, { ok: true, who: 'me' });
  return json(404, { error: 'not found' });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const rest = (over = {}) => ({
  method: 'GET', url: '', headers: [], query: [], body: { kind: 'none' },
  auth: { kind: 'none' }, timeoutMs: 5000, followRedirects: true, maxRedirects: 5,
  insecureTls: false, ...over,
});
const authHeader = { id: 'h', key: 'Authorization', value: 'Bearer {{token}}', enabled: true };
const step = (o) => ({ id: o.id, name: o.name ?? o.id, kind: 'rest', inputs: [], outputs: [], continueOnError: false, ...o });

const result = await runWorkflow({
  id: 'w', name: 'Auth chain', description: '', edges: [], createdAt: '', updatedAt: '',
  steps: [
    step({
      id: 's1', name: 'Authenticate',
      request: rest({ method: 'POST', url: `${base}/auth` }),
      // A nested-ish field name, as real OAuth responses have.
      outputs: [{ id: 'o', name: 'token', path: 'access_token' }],
    }),
    step({
      id: 's2', name: 'Create order (header)',
      request: rest({ method: 'POST', url: `${base}/orders`, headers: [authHeader] }),
      outputs: [{ id: 'o', name: 'orderId', path: 'orderId' }],
    }),
    step({
      id: 's3', name: 'Poll it (header + earlier output in the URL)',
      request: rest({ url: `${base}/orders/{{orderId}}`, headers: [authHeader] }),
      outputs: [{ id: 'o', name: 'state', path: 'state' }],
      repeat: { until: '{{state}} in [shipped, delivered]', intervalMs: 10, maxAttempts: 5 },
    }),
    step({
      id: 's4', name: 'Fourth step still has the token, via the query string',
      request: rest({ url: `${base}/audit?access_token={{token}}` }),
      outputs: [{ id: 'o', name: 'audited', path: 'ok' }],
    }),
  ],
}, {}, () => {}).done;

check('the whole chain succeeded', result.status === 'success',
  JSON.stringify(result.steps.map((s) => [s.name, s.status, s.error])));
check('the token was issued exactly once', issued === 1, `issued=${issued}`);
check('step 2 carried the token', result.steps[1].status === 'success');
check('step 3 carried it too, two steps later', result.steps[2].status === 'success');
check('step 4 carried it, three steps later', result.steps[3].status === 'success');
check('every protected call saw the real token',
  seen.length > 0 && seen.every((s) => s.supplied === TOKEN),
  JSON.stringify(seen));
check('an earlier output also flowed into a later URL',
  seen.some((s) => s.path === '/orders/ord_1'), JSON.stringify(seen.map((s) => s.path)));
check('the polling step settled on a terminal state', result.context.state === 'shipped');
check('the token is still in the final context', result.context.token === TOKEN);

server.close();
closeRestAgents?.();
console.log(`\nAuth chain: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
