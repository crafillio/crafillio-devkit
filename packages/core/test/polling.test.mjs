/**
 * Conditions and polling, against a real server whose status genuinely changes
 * between calls — a mock that returns "completed" immediately would prove
 * nothing about waiting.
 */

import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { runWorkflow, evaluateCondition, checkCondition, closeRestAgents } = require('../dist/index.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

/* ------------------------------------------------------------------ */
/* The condition language                                              */
/* ------------------------------------------------------------------ */

const ctx = {
  status: 'in progress',
  code: '204',
  empty: '',
  name: 'ok-service',
  flag: 'false',
  body: '{"ready":true}',
};
const ev = (expr, c = ctx) => evaluateCondition(expr, c).value;

check('equality on a value with spaces', ev('{{status}} == "in progress"'));
check('inequality', ev('{{status}} != "completed"'));
check('unquoted word literal', ev('{{name}} == ok-service'));
check('numeric comparison is numeric, not lexicographic', ev('{{code}} >= 100'));
check('  ...so 204 > 99 despite "204" < "99" as text', ev('{{code}} > 99'));
check('numeric range with and', ev('{{code}} >= 200 and {{code}} < 300'));
check('and is false when one side is', !ev('{{code}} >= 200 and {{code}} < 204'));
check('or', ev('{{status}} == "done" or {{code}} == 204'));
check('not', ev('not {{flag}}'));
check('parentheses override precedence',
  ev('({{status}} == "done" or {{code}} == 204) and {{name}} == "ok-service"'));
check('in a list', ev('{{status}} in ["queued", "in progress", "running"]'));
check('in a list, absent', !ev('{{status}} in ["completed", "failed"]'));
check('contains substring', ev('{{body}} contains "ready"'));
check('matches a regex', ev('{{name}} matches "^ok-"'));
check('matches is anchored only where you anchor it', !ev('{{name}} matches "^service"'));
check('bare variable falls back to truthiness', ev('{{name}}'));
check('empty string is falsy', !ev('{{empty}}'));
check('the literal "false" is falsy', !ev('{{flag}}'));
check('quotes inside a value survive', ev('{{body}} contains "\\"ready\\""'));

check('unknown variables are reported, not silently empty',
  evaluateCondition('{{nope}} == "x"', ctx).unknown.join() === 'nope');
check('known variables are not reported as unknown',
  evaluateCondition('{{status}} == "x"', ctx).unknown.length === 0);
check('both sides of an or are checked for unknowns',
  evaluateCondition('{{status}} == "in progress" or {{ghost}} == "1"', ctx).unknown.join() === 'ghost');

// Multi-word values without quotes: statuses are routinely phrases, and
// requiring quotes produced a parse error pointing at the second word.
const phrases = { st: 'Access Token', s: 'in progress', v: 'Version 2' };
check('an unquoted two-word value is one literal',
  evaluateCondition('{{st}} == Access Token', phrases).value);
check('  ...and still compares correctly when it should not match',
  !evaluateCondition('{{st}} == Access Denied', phrases).value);
check('unquoted phrase with a number', evaluateCondition('{{v}} == Version 2', phrases).value);
check('a following "and" is still an operator, not part of the value',
  evaluateCondition('{{s}} == in progress and {{st}} == Access Token', phrases).value);
check('a following "or" likewise',
  evaluateCondition('{{s}} == nope or {{st}} == Access Token', phrases).value);
check('phrases work inside a list',
  evaluateCondition('{{s}} in [queued, in progress]', phrases).value);
check('contains takes a phrase too',
  evaluateCondition('{{st}} contains Access', phrases).value);
check('quoting still works and means the same',
  evaluateCondition('{{st}} == "Access Token"', phrases).value);

const bad = (expr) => { try { evaluateCondition(expr, ctx); return null; } catch (e) { return e.message; } };
check('unclosed brace is rejected', bad('{{status == "x"') !== null);
check('unclosed quote is rejected', bad('{{status}} == "x') !== null);
check('missing paren is rejected', bad('({{status}}') !== null);
check('trailing junk is rejected', bad('{{status}} == "x" "y"') !== null);
check('  ...with a message telling you to quote the value',
  (bad('{{status}} == "x" "y"') || '').includes('quotes'), bad('{{status}} == "x" "y"'));
check('a bad regex reports itself clearly', (bad('{{name}} matches "("') || '').includes('regular expression'));
check('checkCondition accepts a good expression', checkCondition('{{a}} == "b" and not {{c}}') === null);
check('checkCondition rejects a bad one', checkCondition('{{a}} ==') !== null);
check('checkCondition ignores an empty expression', checkCondition('   ') === null);

/* ------------------------------------------------------------------ */
/* A server that takes three polls to finish                           */
/* ------------------------------------------------------------------ */

let statusCalls = 0;
let flakyCalls = 0;
let failingCalls = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === '/auth') return json(200, { token: 'tok_xyz' });

  // queued → running → completed, then stays completed.
  if (url.pathname === '/job/status') {
    statusCalls += 1;
    const stages = ['queued', 'running', 'completed'];
    const auth = req.headers.authorization === 'Bearer tok_xyz';
    return json(200, {
      status: stages[Math.min(statusCalls - 1, stages.length - 1)],
      authSeen: auth,
      progress: Math.min(statusCalls * 33, 100),
    });
  }

  // Never finishes — for exhaustion and timeout tests.
  if (url.pathname === '/job/stuck') return json(200, { status: 'running' });

  // Reaches a terminal failure, which failIf should catch.
  if (url.pathname === '/job/doomed') {
    failingCalls += 1;
    return json(200, { status: failingCalls < 2 ? 'running' : 'failed', reason: 'out of credit' });
  }

  // 503s once, then works — for retryOnError.
  if (url.pathname === '/job/flaky') {
    flakyCalls += 1;
    if (flakyCalls === 1) return json(503, { error: 'warming up' });
    return json(200, { status: 'completed' });
  }

  if (url.pathname === '/echo') {
    return json(200, { sawAuth: req.headers.authorization ?? null, url: req.url });
  }

  json(404, { error: 'not found' });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const rest = (over = {}) => ({
  method: 'GET', url: '', headers: [], query: [], body: { kind: 'none' },
  auth: { kind: 'none' }, timeoutMs: 5000, followRedirects: true, maxRedirects: 5,
  insecureTls: false, ...over,
});
const step = (over) => ({
  id: over.id, name: over.name ?? over.id, kind: 'rest',
  inputs: [], outputs: [], continueOnError: false, ...over,
});
const run = (steps) => runWorkflow(
  { id: 'w', name: 'w', description: '', steps, edges: [], createdAt: '', updatedAt: '' },
  {}, () => {},
).done;

/* ---- The user's scenario: one token, used by every later step ---- */

statusCalls = 0;
let res = await run([
  step({
    id: 'login', name: 'Log in',
    request: rest({ method: 'POST', url: `${base}/auth` }),
    outputs: [{ id: 'o1', name: 'token', path: 'token' }],
  }),
  step({
    id: 'a', name: 'Use it in a header',
    request: rest({ url: `${base}/echo`, headers: [{ id: 'h', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }] }),
    outputs: [{ id: 'o2', name: 'sawA', path: 'sawAuth' }],
  }),
  step({
    id: 'b', name: 'Use the same token in a URL',
    request: rest({ url: `${base}/echo?t={{token}}` }),
    outputs: [{ id: 'o3', name: 'urlB', path: 'url' }],
  }),
]);

check('token step succeeded', res.steps[0].status === 'success', res.steps[0].error);
check('token published into the run context', res.context.token === 'tok_xyz');
check('step 2 received the token in a header',
  res.steps[1].extractedOutputs[0]?.value === 'Bearer tok_xyz',
  JSON.stringify(res.steps[1].extractedOutputs));
check('step 3 received the same token in its URL',
  (res.steps[2].extractedOutputs[0]?.value ?? '').includes('t=tok_xyz'),
  JSON.stringify(res.steps[2].extractedOutputs));
check('one capture serves every later step', res.status === 'success');

/* ---- Polling until a status settles ---- */

statusCalls = 0;
res = await run([
  step({
    id: 'login', request: rest({ method: 'POST', url: `${base}/auth` }),
    outputs: [{ id: 'o', name: 'token', path: 'token' }],
  }),
  step({
    id: 'wait', name: 'Wait for the job',
    request: rest({ url: `${base}/job/status`, headers: [{ id: 'h', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }] }),
    outputs: [
      { id: 'o1', name: 'status', path: 'status' },
      { id: 'o2', name: 'progress', path: 'progress' },
      { id: 'o3', name: 'authSeen', path: 'authSeen' },
    ],
    repeat: { until: '{{status}} == "completed"', intervalMs: 20, maxAttempts: 10 },
  }),
]);

const poll = res.steps[1];
check('polling step succeeded', poll.status === 'success', poll.error);
check('it took three attempts', poll.attempts === 3, `attempts=${poll.attempts}`);
check('the final status is the settled one', res.context.status === 'completed');
check('outputs reflect the last attempt, not the first',
  poll.extractedOutputs.find((o) => o.name === 'status')?.value === 'completed');
check('outputs are not accumulated across attempts',
  poll.extractedOutputs.filter((o) => o.name === 'status').length === 1,
  JSON.stringify(poll.extractedOutputs));
check('every attempt is logged', poll.pollLog.length === 3, JSON.stringify(poll.pollLog));
check('the log shows the progression',
  poll.pollLog.map((l) => l.summary.match(/status=(\w+)/)?.[1]).join(',') === 'queued,running,completed',
  JSON.stringify(poll.pollLog.map((l) => l.summary)));
check('only the last attempt is marked settled',
  poll.pollLog.filter((l) => l.settled).length === 1 && poll.pollLog[2].settled);
check('the token still applied on every poll', res.context.authSeen === 'true');
check('elapsed time increases across attempts',
  poll.pollLog[2].elapsedMs > poll.pollLog[0].elapsedMs);

/* ---- Giving up ---- */

res = await run([
  step({
    id: 'stuck', request: rest({ url: `${base}/job/stuck` }),
    outputs: [{ id: 'o', name: 'status', path: 'status' }],
    repeat: { until: '{{status}} == "completed"', intervalMs: 5, maxAttempts: 3 },
  }),
]);
check('a job that never settles fails the step', res.steps[0].status === 'failed');
check('it stopped at maxAttempts', res.steps[0].attempts === 3, `attempts=${res.steps[0].attempts}`);
check('the error says how many attempts and what it saw',
  /3 attempts/.test(res.steps[0].error) && /status=running/.test(res.steps[0].error),
  res.steps[0].error);

/* ---- Overall timeout beats the attempt count ---- */

const startedAt = Date.now();
res = await run([
  step({
    id: 'stuck', request: rest({ url: `${base}/job/stuck` }),
    outputs: [{ id: 'o', name: 'status', path: 'status' }],
    repeat: { until: '{{status}} == "completed"', intervalMs: 1000, maxAttempts: 100, timeoutMs: 300 },
  }),
]);
const tookMs = Date.now() - startedAt;
check('the timeout ends it early', res.steps[0].status === 'failed');
check('it did not sleep past the deadline', tookMs < 1200, `took ${tookMs}ms`);
check('the timeout error names the limit', /300ms/.test(res.steps[0].error), res.steps[0].error);

/* ---- failIf stops on a terminal failure ---- */

failingCalls = 0;
res = await run([
  step({
    id: 'doomed', request: rest({ url: `${base}/job/doomed` }),
    outputs: [
      { id: 'o', name: 'status', path: 'status' },
      { id: 'o2', name: 'reason', path: 'reason' },
    ],
    repeat: {
      until: '{{status}} == "completed"',
      failIf: '{{status}} in ["failed", "cancelled"]',
      intervalMs: 5, maxAttempts: 50,
    },
  }),
]);
check('failIf stops the run early', res.steps[0].status === 'failed');
check('it stopped on attempt 2, not after 50', res.steps[0].attempts === 2, `attempts=${res.steps[0].attempts}`);
check('the error quotes the failIf condition', /failed/.test(res.steps[0].error), res.steps[0].error);
check('the reason from the response is visible', /out of credit/.test(res.steps[0].error), res.steps[0].error);

/* ---- retryOnError rides out a transient 503 ---- */

flakyCalls = 0;
res = await run([
  step({
    id: 'flaky', request: rest({ url: `${base}/job/flaky` }),
    outputs: [{ id: 'o', name: 'status', path: 'status' }],
    repeat: { until: '{{status}} == "completed"', intervalMs: 5, maxAttempts: 5, retryOnError: true },
  }),
]);
check('retryOnError survives a 503', res.steps[0].status === 'success', res.steps[0].error);
check('the failed attempt is still recorded', res.steps[0].pollLog[0].error !== undefined,
  JSON.stringify(res.steps[0].pollLog));
check('it took two attempts', res.steps[0].attempts === 2);

flakyCalls = 0;
res = await run([
  step({
    id: 'flaky', request: rest({ url: `${base}/job/flaky` }),
    outputs: [{ id: 'o', name: 'status', path: 'status' }],
    repeat: { until: '{{status}} == "completed"', intervalMs: 5, maxAttempts: 5 },
  }),
]);
check('without retryOnError a 503 fails the step immediately', res.steps[0].status === 'failed');
check('  ...on the first attempt', res.steps[0].attempts === 1, `attempts=${res.steps[0].attempts}`);

/* ---- An initial delay before the first call ---- */

statusCalls = 0;
const delayStart = Date.now();
res = await run([
  step({
    id: 'wait', request: rest({ url: `${base}/job/status` }),
    outputs: [{ id: 'o', name: 'status', path: 'status' }],
    repeat: {
      until: '{{status}} == "completed"',
      initialDelayMs: 200, intervalMs: 10, maxAttempts: 10,
    },
  }),
]);
const delayMs = Date.now() - delayStart;
check('the initial delay is observed before the first call', delayMs >= 190, `took ${delayMs}ms`);
check('the delayed step still settles', res.steps[0].status === 'success', res.steps[0].error);

// The delay must not buy extra time beyond the overall timeout.
const cappedStart = Date.now();
res = await run([
  step({
    id: 'stuck', request: rest({ url: `${base}/job/stuck` }),
    outputs: [{ id: 'o', name: 'status', path: 'status' }],
    repeat: {
      until: '{{status}} == "completed"',
      initialDelayMs: 5000, intervalMs: 10, maxAttempts: 10, timeoutMs: 250,
    },
  }),
]);
const cappedMs = Date.now() - cappedStart;
check('the initial delay is capped by the overall timeout', cappedMs < 1500, `took ${cappedMs}ms`);

/* ---- Terminal states: retry until it passes or fails ---- */

// The shape the workflow builder generates for "watch X until it settles":
// keep polling while the value is non-terminal, succeed on one set, fail on
// the other. The watched attribute is ordinary — nothing special about
// "status" as a name.
failingCalls = 0;
res = await run([
  step({
    id: 'terminal', request: rest({ url: `${base}/job/doomed` }),
    outputs: [{ id: 'o', name: 'jobState', path: 'status' }],
    repeat: {
      until: '{{jobState}} in ["completed", "passed", "succeeded"]',
      failIf: '{{jobState}} in ["failed", "cancelled", "error"]',
      intervalMs: 5, maxAttempts: 50,
    },
  }),
]);
check('an arbitrary attribute name works, not just "status"',
  res.steps[0].attempts === 2, `attempts=${res.steps[0].attempts}`);
check('it stops the moment the value turns terminal', res.steps[0].status === 'failed');

statusCalls = 0;
res = await run([
  step({
    id: 'terminal2', request: rest({ url: `${base}/job/status` }),
    outputs: [{ id: 'o', name: 'phase', path: 'status' }],
    repeat: {
      until: '{{phase}} in ["completed", "passed"]',
      failIf: '{{phase}} in ["failed", "cancelled"]',
      intervalMs: 10, maxAttempts: 20,
    },
  }),
]);
check('the same shape succeeds when the terminal value is a good one',
  res.steps[0].status === 'success', res.steps[0].error);
check('  ...after waiting out the non-terminal values', res.steps[0].attempts === 3);

/* ---- Backoff lengthens the wait ---- */

const backoffStart = Date.now();
res = await run([
  step({
    id: 'stuck', request: rest({ url: `${base}/job/stuck` }),
    outputs: [{ id: 'o', name: 'status', path: 'status' }],
    repeat: { until: '{{status}} == "completed"', intervalMs: 40, maxAttempts: 4, backoff: 2 },
  }),
]);
const backoffMs = Date.now() - backoffStart;
// 40 + 80 + 160 = 280ms of sleeping across three gaps.
check('backoff lengthens each wait', backoffMs >= 250, `took ${backoffMs}ms`);
check('backoff still respects maxAttempts', res.steps[0].attempts === 4);

/* ---- An until condition referring to something the step never publishes ---- */

res = await run([
  step({
    id: 'typo', request: rest({ url: `${base}/job/stuck` }),
    outputs: [{ id: 'o', name: 'status', path: 'status' }],
    repeat: { until: '{{statsu}} == "completed"', intervalMs: 5, maxAttempts: 3 },
  }),
]);
check('a typo in until fails fast rather than polling to exhaustion',
  res.steps[0].status === 'failed' && res.steps[0].attempts === 1,
  `attempts=${res.steps[0].attempts}`);
check('the error names the missing variable', /statsu/.test(res.steps[0].error), res.steps[0].error);

/* ---- runIf now understands comparisons ---- */

res = await run([
  step({
    id: 'login', request: rest({ method: 'POST', url: `${base}/auth` }),
    outputs: [{ id: 'o', name: 'token', path: 'token' }],
  }),
  step({ id: 'skipped', request: rest({ url: `${base}/echo` }), runIf: '{{token}} == "nope"' }),
  step({ id: 'ran', request: rest({ url: `${base}/echo` }), runIf: '{{token}} matches "^tok_"' }),
]);
check('runIf skips when a comparison is false', res.steps[1].status === 'skipped');
check('runIf runs when a comparison is true', res.steps[2].status === 'success', res.steps[2].error);

/* ---- Cancelling mid-poll ---- */

const handle = runWorkflow(
  { id: 'w', name: 'w', description: '', createdAt: '', updatedAt: '', edges: [], steps: [
    step({
      id: 'stuck', request: rest({ url: `${base}/job/stuck` }),
      outputs: [{ id: 'o', name: 'status', path: 'status' }],
      repeat: { until: '{{status}} == "completed"', intervalMs: 5000, maxAttempts: 100 },
    }),
  ] },
  {}, () => {},
);
setTimeout(() => handle.cancel(), 150);
const cancelStart = Date.now();
const cancelled = await handle.done;
const cancelMs = Date.now() - cancelStart;
check('cancelling wakes the sleep instead of waiting it out', cancelMs < 1500, `took ${cancelMs}ms`);
check('the cancelled step is reported as failed with a reason',
  /cancel/i.test(cancelled.steps[0].error ?? ''), cancelled.steps[0].error);

server.close();
closeRestAgents?.();
console.log(`\nPolling: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
