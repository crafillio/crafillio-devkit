/** A workflow mixing REST and gRPC steps, against real servers of both kinds. */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const require = createRequire(import.meta.url);
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { runWorkflow, renderReport, closeRestAgents } = require('../dist/index.js');

const PROTO = fileURLToPath(new URL('./fixtures/demo.proto', import.meta.url));

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

/* ---- REST server ---- */
const rest = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/who') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ user: { name: 'Ada', id: 7 } }));
  }
  if (url.pathname === '/record') {
    res.writeHead(201, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ recorded: url.searchParams.get('greeting') }));
  }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => rest.listen(0, '127.0.0.1', r));
const restBase = `http://127.0.0.1:${rest.address().port}`;

/* ---- gRPC server ---- */
const pkgDef = protoLoader.loadSync(PROTO, { keepCase: true, defaults: true });
const loaded = grpc.loadPackageDefinition(pkgDef);
const server = new grpc.Server();
let sawName = null;
server.addService(loaded.demo.v1.Greeter.service, {
  SayHello: (call, cb) => { sawName = call.request.name; cb(null, { message: `Hello ${call.request.name}`, counter: 42 }); },
  Countdown: (call) => { call.write({ message: 'x', counter: 1 }); call.end(); },
  Collect: (call, cb) => call.on('end', () => cb(null, { message: 'ok', counter: 0 })),
  Chat: (call) => call.on('end', () => call.end()),
  Fail: (_c, cb) => cb({ code: grpc.status.PERMISSION_DENIED, details: 'denied' }),
});
const grpcPort = await new Promise((resolve, reject) =>
  server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? reject(e) : resolve(p))));

const restReq = (method, url) => ({
  method, url, headers: [], query: [], body: { kind: 'none' }, auth: { kind: 'none' },
  timeoutMs: 5000, followRedirects: false, maxRedirects: 0, insecureTls: false,
});
const grpcReq = (methodName, message) => ({
  target: { address: `127.0.0.1:${grpcPort}`, tls: false, insecureTls: false },
  source: { kind: 'proto', files: [PROTO], includeDirs: [] },
  service: 'demo.v1.Greeter', method: methodName,
  messages: [message], metadata: [], timeoutMs: 5000,
});

const run = (workflow) => new Promise((resolve) => {
  const events = [];
  runWorkflow(workflow, {}, (e) => events.push(e)).done.then((result) => resolve({ result, events }));
});

/* ---- REST -> gRPC -> REST ---- */

const wf = {
  id: 'mixed', name: 'Mixed pipeline', description: '', createdAt: '', updatedAt: '',
  steps: [
    { id: 'a', name: 'Who am I', kind: 'rest', continueOnError: false, inputs: [],
      outputs: [{ id: 'o1', name: 'userName', path: 'user.name' }],
      request: restReq('GET', `${restBase}/who`) },
    { id: 'b', name: 'Greet over gRPC', kind: 'grpc', continueOnError: false, inputs: [],
      outputs: [{ id: 'o2', name: 'greeting', path: 'message' },
                { id: 'o3', name: 'counter', path: 'counter' }],
      grpc: grpcReq('SayHello', '{"name":"{{userName}}"}') },
    { id: 'c', name: 'Record it', kind: 'rest', continueOnError: false, inputs: [], outputs: [],
      request: restReq('POST', `${restBase}/record?greeting={{greeting}}`) },
  ],
  edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c' }],
};

const { result, events } = await run(wf);

check('mixed workflow succeeded', result.status === 'success',
  JSON.stringify(result.steps.map((s) => [s.name, s.status, s.error])));
check('all three steps ran', result.steps.length === 3);

const [restStep, grpcStep, finalStep] = result.steps;
check('step protocols recorded', restStep.protocol === 'rest' && grpcStep.protocol === 'grpc',
  JSON.stringify(result.steps.map((s) => s.protocol)));

check('CHAINING: REST output reached the gRPC message', sawName === 'Ada', String(sawName));
check('gRPC request snapshot labels the call', grpcStep.request.method === 'gRPC' &&
  grpcStep.request.url.includes('demo.v1.Greeter/SayHello'), JSON.stringify(grpcStep.request));
check('gRPC response captured as JSON', grpcStep.response.body.includes('Hello Ada'), grpcStep.response.body);
check('gRPC status shown by name', grpcStep.response.statusLabel === 'OK', String(grpcStep.response.statusLabel));
check('gRPC step published outputs',
  grpcStep.extractedOutputs.some((o) => o.name === 'greeting' && o.value === 'Hello Ada'),
  JSON.stringify(grpcStep.extractedOutputs));
check('int64 output arrives as a string', grpcStep.extractedOutputs.some((o) => o.name === 'counter' && o.value === '42'),
  JSON.stringify(grpcStep.extractedOutputs));
check('CHAINING: gRPC output reached the next REST call',
  finalStep.request.url.includes('Hello%20Ada') || finalStep.request.url.includes('Hello Ada'),
  finalStep.request.url);
check('final REST step succeeded', finalStep.response.status === 201, String(finalStep.response.status));

/* ---- gRPC failure is captured, not swallowed ---- */

const failing = {
  ...wf, id: 'mixed2', name: 'Failing gRPC',
  steps: [{ id: 'f', name: 'Denied', kind: 'grpc', continueOnError: false, inputs: [], outputs: [],
    grpc: grpcReq('Fail', '{"name":"x"}') }],
  edges: [],
};
const failed = await run(failing);
check('gRPC failure marks the step failed', failed.result.steps[0].status === 'failed');
check('gRPC failure keeps the status name', failed.result.steps[0].response.statusLabel === 'PERMISSION_DENIED',
  String(failed.result.steps[0].response.statusLabel));
check('gRPC failure message is readable', /denied/i.test(failed.result.steps[0].error), failed.result.steps[0].error);

/* ---- Streaming methods are rejected up front ---- */

const streaming = {
  ...wf, id: 'mixed3', name: 'Streaming',
  steps: [{ id: 's', name: 'Stream', kind: 'grpc', continueOnError: false, inputs: [], outputs: [],
    grpc: grpcReq('Countdown', '{"name":"x"}') }],
  edges: [],
};
const streamed = await run(streaming);
check('streaming gRPC method rejected with a clear reason',
  streamed.result.steps[0].status === 'failed' && /streaming/i.test(streamed.result.steps[0].error),
  streamed.result.steps[0].error);

/* ---- Report renders both kinds ---- */

const html = renderReport(result, wf);
check('report labels the gRPC node', html.includes('>gRPC<'), 'expected a gRPC method label');
check('report shows the gRPC status badge', html.includes('gRPC OK'), 'expected a gRPC OK badge');
check('report still shows HTTP badges for REST steps', /HTTP 20[01]/.test(html));
check('report data-flow lists values from both protocols',
  html.includes('userName') && html.includes('greeting'), 'expected both names in the matrix');

console.log(`\nMixed workflow: ${pass} passed, ${fail} failed`);
await closeRestAgents();
rest.close();
server.forceShutdown();
process.exit(fail ? 1 : 0);
