/** Workflow chaining, live events and report generation, against a real server. */

import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { runWorkflow, renderReport, getPath, suggestPaths, closeRestAgents } = require('../dist/index.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

/* ---- Path extraction ---- */

const doc = { data: { items: [{ id: 'a1', tags: ['x', 'y'] }, { id: 'b2' }] }, 'content-type': 'json', n: 0 };
check('path: nested', getPath(doc, 'data.items[0].id') === 'a1');
check('path: array index', getPath(doc, 'data.items[1].id') === 'b2');
check('path: negative index takes the last', getPath(doc, 'data.items[-1].id') === 'b2');
check('path: bracketed awkward key', getPath(doc, '["content-type"]') === 'json');
check('path: leading $ tolerated', getPath(doc, '$.data.items[0].id') === 'a1');
check('path: missing returns undefined', getPath(doc, 'data.nope.deep') === undefined);
check('path: zero is preserved, not treated as missing', getPath(doc, 'n') === 0);
check('suggestPaths finds leaves', suggestPaths(doc).includes('data.items[0].id'), JSON.stringify(suggestPaths(doc)));

/* ---- Test server ---- */

const work = mkdtempSync(join(tmpdir(), 'ck-wf-'));
const uploadFile = join(work, 'payload.txt');
writeFileSync(uploadFile, 'file-contents-here');

let created = 0;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/auth') {
      res.writeHead(200, { 'content-type': 'application/json', 'x-session': 'sess-42' });
      return res.end(JSON.stringify({ token: 'tok_abc123', user: { id: 77, name: 'Ada' } }));
    }
    if (url.pathname === '/orders') {
      if (req.headers.authorization !== 'Bearer tok_abc123') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      created++;
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ orderId: 'ord_' + created, echo: JSON.parse(body || '{}') }));
    }
    if (url.pathname.startsWith('/invoice/')) {
      // A binary artifact the report should offer as a download.
      res.writeHead(200, { 'content-type': 'application/pdf' });
      return res.end(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x00, 0xff, 0xfe]));
    }
    if (url.pathname === '/boom') {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'kaboom' }));
    }
    res.writeHead(404); res.end('{}');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const rest = (method, url, body) => ({
  method, url, headers: [], query: [],
  body: body === undefined ? { kind: 'none' } : { kind: 'json', text: body },
  auth: { kind: 'none' }, timeoutMs: 5000, followRedirects: false, maxRedirects: 0, insecureTls: false,
});

const run = (workflow, env = {}) => new Promise((resolve) => {
  const events = [];
  const handle = runWorkflow(workflow, env, (e) => events.push(e));
  handle.done.then((result) => resolve({ result, events }));
});

/* ---- Happy path: auth → create order → fetch invoice ---- */

const wf = {
  id: 'wf1', name: 'Order pipeline', description: '', createdAt: '', updatedAt: '',
  steps: [
    {
      id: 's1', name: 'Authenticate', kind: 'rest', continueOnError: false,
      request: rest('POST', `${base}/auth`, '{"user":"ada"}'),
      inputs: [],
      outputs: [
        { id: 'o1', name: 'token', path: 'token' },
        { id: 'o2', name: 'userId', path: 'user.id' },
      ],
    },
    {
      id: 's2', name: 'Create order', kind: 'rest', continueOnError: false,
      request: {
        ...rest('POST', `${base}/orders`, '{"customer":"{{userId}}","note":"{{fileNote}}"}'),
        headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
      },
      inputs: [
        { id: 'i1', name: 'fileNote', source: { from: 'file', path: uploadFile, as: 'text' } },
      ],
      outputs: [{ id: 'o3', name: 'orderId', path: 'orderId' }],
    },
    {
      id: 's3', name: 'Download invoice', kind: 'rest', continueOnError: false,
      request: rest('GET', `${base}/invoice/{{orderId}}`),
      inputs: [], outputs: [],
    },
  ],
};

const { result, events } = await run(wf);

check('run succeeded', result.status === 'success', JSON.stringify(result.steps.map((s) => [s.name, s.status, s.error])));
check('all three steps ran', result.steps.length === 3);

// The chaining itself: token from step 1 authorised step 2.
const step2 = result.steps[1];
check('CHAINING: token flowed into the next request header',
  step2.request.headers.some(([k, v]) => k === 'Authorization' && v === 'Bearer tok_abc123'),
  JSON.stringify(step2.request.headers));
check('CHAINING: extracted id substituted into the body',
  step2.request.body.includes('"customer":"77"'), step2.request.body);
check('CHAINING: file contents fed into the request',
  step2.request.body.includes('file-contents-here'), step2.request.body);
check('file input recorded with its source',
  step2.resolvedInputs.some((i) => i.name === 'fileNote' && i.source.includes('file')),
  JSON.stringify(step2.resolvedInputs));
check('step 2 published orderId', step2.extractedOutputs.some((o) => o.name === 'orderId' && o.value === 'ord_1'),
  JSON.stringify(step2.extractedOutputs));

const step3 = result.steps[2];
check('CHAINING: orderId substituted into the URL', step3.request.url.endsWith('/invoice/ord_1'), step3.request.url);
check('binary response captured as a downloadable artifact',
  step3.artifacts.length === 1 && step3.artifacts[0].contentType === 'application/pdf',
  JSON.stringify(step3.artifacts.map((a) => [a.name, a.contentType])));

/* ---- Live events ---- */

check('emitted run-start', events[0].type === 'run-start' && events[0].totalSteps === 3);
check('emitted a step-start per step', events.filter((e) => e.type === 'step-start').length === 3);
check('emitted a step-finish per step', events.filter((e) => e.type === 'step-finish').length === 3);
check('emitted run-finish last', events[events.length - 1].type === 'run-finish');
check('step-start precedes its step-finish',
  events.findIndex((e) => e.type === 'step-start' && e.index === 1) <
  events.findIndex((e) => e.type === 'step-finish' && e.record.index === 1));
check('LIVE: finish events carry the full record for inspection',
  events.filter((e) => e.type === 'step-finish').every((e) => e.record.request && e.record.response),
  'a record was missing request/response');

/* ---- Failure handling ---- */

const failing = {
  ...wf, id: 'wf2', name: 'Failing pipeline',
  steps: [
    { id: 'f1', name: 'Boom', kind: 'rest', continueOnError: false, request: rest('GET', `${base}/boom`), inputs: [], outputs: [] },
    { id: 'f2', name: 'Never runs', kind: 'rest', continueOnError: false, request: rest('GET', `${base}/auth`), inputs: [], outputs: [] },
  ],
};
const failed = await run(failing);
check('failing step marked failed', failed.result.steps[0].status === 'failed');
check('FAILURE: response still captured for inspection',
  failed.result.steps[0].response && failed.result.steps[0].response.status === 500,
  JSON.stringify(failed.result.steps[0].response));
check('FAILURE: error message recorded', failed.result.steps[0].error.includes('500'), failed.result.steps[0].error);
check('later step marked skipped, not silently dropped', failed.result.steps[1].status === 'skipped');
check('run status is failed', failed.result.status === 'failed');
check('skipped steps still emit finish events so the UI can grey them',
  failed.events.filter((e) => e.type === 'step-finish').length === 2);

/* continueOnError keeps going */
const tolerant = {
  ...failing, id: 'wf3',
  steps: [
    { ...failing.steps[0], continueOnError: true },
    { ...failing.steps[1], name: 'Runs anyway' },
  ],
};
const partial = await run(tolerant);
check('continueOnError lets the run proceed', partial.result.steps[1].status === 'success', JSON.stringify(partial.result.steps.map((s) => s.status)));
check('run reported as partial', partial.result.status === 'partial', partial.result.status);

/* Unresolved variable is reported, not sent blank */
const unresolved = {
  ...wf, id: 'wf4',
  steps: [{ id: 'u1', name: 'Missing var', kind: 'rest', continueOnError: false, request: rest('GET', `${base}/auth?x={{nope}}`), inputs: [], outputs: [] }],
};
const un = await run(unresolved);
check('unresolved variable fails the step with a clear message',
  un.result.steps[0].status === 'failed' && un.result.steps[0].error.includes('{{nope}}'),
  un.result.steps[0].error);

/* Environment variables seed the context */
const envWf = {
  ...wf, id: 'wf5',
  steps: [{ id: 'e1', name: 'Env', kind: 'rest', continueOnError: false, request: rest('GET', `{{baseUrl}}/auth`), inputs: [], outputs: [] }],
};
const envRun = await run(envWf, { baseUrl: base });
check('environment variables usable in steps', envRun.result.steps[0].status === 'success', envRun.result.steps[0].error);

/* runIf guard */
const guarded = {
  ...wf, id: 'wf6',
  steps: [{ id: 'g1', name: 'Guarded', kind: 'rest', continueOnError: false, runIf: '', request: rest('GET', `${base}/auth`), inputs: [], outputs: [] }],
};
const guardedRun = await run(guarded);
check('empty runIf does not skip', guardedRun.result.steps[0].status === 'success');

/* ---- Report ---- */

const html = renderReport(result);
const reportPath = join(work, 'report.html');
writeFileSync(reportPath, html);

check('report is a full HTML document', html.startsWith('<!doctype html>'));
check('report names the workflow', html.includes('Order pipeline'));
check('report embeds an SVG diagram', html.includes('<svg') && html.includes('class="diagram"'));
check('diagram has a node per step', (html.match(/class="node"/g) || []).length === 3);
check('report shows the request URL', html.includes('/orders'));
check('report shows inputs used', html.includes('fileNote'));
check('report shows published outputs', html.includes('orderId'));
check('report embeds the file as a download link', html.includes('href="data:application/pdf;base64,'));
check('download link has a filename', html.includes('download="download-invoice.pdf"'), 'expected slugged artifact name');
check('report has no external references', !/src="http|href="http|url\(http/.test(html));
check('report is self-contained and reasonably sized', html.length > 4000, String(html.length));

// A failed run must still produce a useful report.
const failHtml = renderReport(failed.result);
check('failed run still renders a report', failHtml.includes('Failed') && failHtml.includes('kaboom'));

/* ---- Canvas graph ordering ---- */

const { orderSteps } = require('../dist/index.js');
const node = (id) => ({ id, name: id, kind: 'rest', continueOnError: false, inputs: [], outputs: [], request: rest('GET', base + '/auth') });
const order = (steps, edges) => orderSteps({ id: 'g', name: 'g', description: '', createdAt: '', updatedAt: '', steps, edges }).map((s) => s.id);

check('order: no edges keeps array order', order([node('a'), node('b'), node('c')], []).join('') === 'abc');
check('order: follows the wires, not the array',
  order([node('c'), node('b'), node('a')], [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'b', to: 'c' }]).join('') === 'abc',
  order([node('c'), node('b'), node('a')], [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'b', to: 'c' }]).join(''));
check('order: a node waits for every parent',
  (() => { const o = order([node('a'), node('b'), node('c'), node('d')],
    [{ id: '1', from: 'a', to: 'c' }, { id: '2', from: 'b', to: 'c' }, { id: '3', from: 'c', to: 'd' }]);
    return o.indexOf('c') > o.indexOf('a') && o.indexOf('c') > o.indexOf('b') && o.indexOf('d') === 3; })());
check('order: parallel branches both included',
  order([node('a'), node('b'), node('c')], [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'a', to: 'c' }]).length === 3);
check('order: a cycle does not hang or drop nodes',
  order([node('a'), node('b')], [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'b', to: 'a' }]).length === 2);
check('order: edges referencing removed nodes are ignored',
  order([node('a'), node('b')], [{ id: '1', from: 'a', to: 'ghost' }]).join('') === 'ab');

/* The renderer keeps its own copy of this function because core is Node-only.
   Assert the two stay in step. */
const uiSource = readFileSync(new URL('../../ui/src/lib/graph.ts', import.meta.url), 'utf8');
const coreSource = readFileSync(new URL('../src/workflow/engine.ts', import.meta.url), 'utf8');
const normalise = (src) => {
  const start = src.indexOf('const edges = workflow.edges ?? [];');
  const end = src.indexOf('return ordered;', start);
  return src.slice(start, end).replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();
};
check('UI and core ordering implementations agree', normalise(uiSource) === normalise(coreSource),
  'graph.ts has drifted from engine.ts — keep them identical');

console.log(`\nWorkflow: ${pass} passed, ${fail} failed`);
console.log(`  sample report: ${reportPath}`);
await closeRestAgents();
server.close();
process.exit(fail ? 1 : 0);
