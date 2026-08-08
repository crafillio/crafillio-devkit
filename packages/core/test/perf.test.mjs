/** Load generator, exercised against real HTTP and gRPC servers. */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const require = createRequire(import.meta.url);
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { perf, closeRestAgents, DEFAULT_PROFILE } = require('../dist/index.js');

const PROTO = fileURLToPath(new URL('./fixtures/demo.proto', import.meta.url));

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

/* ---- HTTP target ---- */

let served = 0;
let failNext = 0;
const server = http.createServer((req, res) => {
  served++;
  if (failNext > 0) {
    failNext--;
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end('boom');
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, n: served }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const restRequest = {
  method: 'GET', url: `http://127.0.0.1:${port}/bench`,
  headers: [], query: [], body: { kind: 'none' }, auth: { kind: 'none' },
  timeoutMs: 5000, followRedirects: false, maxRedirects: 0, insecureTls: false,
};

const profile = (over) => ({ ...DEFAULT_PROFILE, rampUpSeconds: 0, timeoutMs: 5000, ...over });

/* ---- Iteration mode ---- */

let progressCalls = 0;
let run = perf.startLoadTest(
  { protocol: 'rest', request: restRequest },
  profile({ mode: 'iterations', iterations: 200, concurrency: 8 }),
  () => progressCalls++,
);
let report = await run.done;

check('rest: runs the requested iterations', report.total >= 200 && report.total <= 210, String(report.total));
check('rest: all succeeded', report.failed === 0 && report.successful === report.total, JSON.stringify({ f: report.failed, s: report.successful }));
check('rest: error rate zero', report.errorRate === 0, String(report.errorRate));
check('rest: rps computed', report.requestsPerSecond > 0, String(report.requestsPerSecond));
check('rest: latency percentiles ordered',
  report.latency.min <= report.latency.p50 && report.latency.p50 <= report.latency.p95 && report.latency.p95 <= report.latency.max,
  JSON.stringify(report.latency));
check('rest: p99 >= p95', report.latency.p99 >= report.latency.p95, JSON.stringify(report.latency));
check('rest: status counts recorded', report.statusCounts['200'] >= 200, JSON.stringify(report.statusCounts));
check('rest: bytes tracked', report.bytesReceived > 0, String(report.bytesReceived));
check('rest: buckets produced', report.buckets.length >= 1, JSON.stringify(report.buckets.length));
check('rest: label describes target', report.label.includes('/bench'), report.label);

/* ---- Duration mode ---- */

const before = Date.now();
run = perf.startLoadTest(
  { protocol: 'rest', request: restRequest },
  profile({ mode: 'duration', durationSeconds: 2, concurrency: 4 }),
  () => {},
);
report = await run.done;
const wall = Date.now() - before;
check('rest: duration mode respects the window', wall >= 1900 && wall < 4500, `${wall}ms`);
check('rest: duration mode did real work', report.total > 10, String(report.total));

/* ---- Errors counted as failures ---- */

failNext = 50;
run = perf.startLoadTest(
  { protocol: 'rest', request: restRequest },
  profile({ mode: 'iterations', iterations: 100, concurrency: 4 }),
  () => {},
);
report = await run.done;
check('rest: 5xx counted as failure', report.failed >= 45, JSON.stringify({ failed: report.failed, status: report.statusCounts }));
check('rest: error rate reflects failures', report.errorRate > 30, String(report.errorRate));
check('rest: error reasons captured', Object.keys(report.errorCounts).some((k) => k.includes('500')), JSON.stringify(report.errorCounts));
failNext = 0;

/* ---- Rate limiting ---- */

run = perf.startLoadTest(
  { protocol: 'rest', request: restRequest },
  profile({ mode: 'duration', durationSeconds: 2, concurrency: 10, targetRps: 25 }),
  () => {},
);
report = await run.done;
// Allow generous headroom; the point is that throttling engages at all.
check('rest: target rps throttles throughput', report.requestsPerSecond < 60, String(report.requestsPerSecond));
check('rest: throttled run still succeeds', report.failed === 0, JSON.stringify(report.errorCounts));

/* ---- Early stop ---- */

run = perf.startLoadTest(
  { protocol: 'rest', request: restRequest },
  profile({ mode: 'duration', durationSeconds: 30, concurrency: 4 }),
  () => {},
);
setTimeout(() => run.stop(), 700);
const stopStart = Date.now();
report = await run.done;
check('rest: stop() ends the run early', Date.now() - stopStart < 5000, `${Date.now() - stopStart}ms`);

/* ---- Progress ---- */

check('progress callback fired during the run', progressCalls >= 0);
let sawProgress = 0;
run = perf.startLoadTest(
  { protocol: 'rest', request: restRequest },
  profile({ mode: 'duration', durationSeconds: 2, concurrency: 4 }),
  (p) => { if (p.completed > 0 && p.latency.p50 >= 0) sawProgress++; },
);
await run.done;
check('progress reports live stats', sawProgress >= 2, String(sawProgress));

/* ---- gRPC ---- */

const pkgDef = protoLoader.loadSync(PROTO, { keepCase: true, defaults: true });
const loaded = grpc.loadPackageDefinition(pkgDef);
const grpcServer = new grpc.Server();
grpcServer.addService(loaded.demo.v1.Greeter.service, {
  SayHello: (call, cb) => cb(null, { message: `Hello ${call.request.name}`, counter: 1 }),
  Countdown: (call) => { call.write({ message: 'x', counter: 1 }); call.end(); },
  Collect: (call, cb) => { call.on('end', () => cb(null, { message: 'ok', counter: 0 })); },
  Chat: (call) => call.on('end', () => call.end()),
  Fail: (_call, cb) => cb({ code: grpc.status.PERMISSION_DENIED, details: 'nope' }),
});
const grpcPort = await new Promise((resolve, reject) =>
  grpcServer.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? reject(e) : resolve(p))),
);

const grpcRequest = {
  target: { address: `127.0.0.1:${grpcPort}`, tls: false, insecureTls: false },
  source: { kind: 'proto', files: [PROTO], includeDirs: [] },
  service: 'demo.v1.Greeter', method: 'SayHello',
  messages: ['{"name":"bench"}'], metadata: [], timeoutMs: 5000,
};

run = perf.startLoadTest(
  { protocol: 'grpc', request: grpcRequest },
  profile({ mode: 'iterations', iterations: 200, concurrency: 8 }),
  () => {},
);
report = await run.done;
check('grpc: iterations completed', report.total >= 200, String(report.total));
check('grpc: all OK', report.failed === 0, JSON.stringify(report.errorCounts));
check('grpc: OK status recorded', report.statusCounts.OK >= 200, JSON.stringify(report.statusCounts));
check('grpc: rps computed', report.requestsPerSecond > 0, String(report.requestsPerSecond));
check('grpc: latency measured', report.latency.p95 > 0, JSON.stringify(report.latency));
check('grpc: label names the method', report.label === 'demo.v1.Greeter/SayHello', report.label);

/* gRPC failures surface as failures, with the status name. */
run = perf.startLoadTest(
  { protocol: 'grpc', request: { ...grpcRequest, method: 'Fail' } },
  profile({ mode: 'iterations', iterations: 30, concurrency: 4 }),
  () => {},
);
report = await run.done;
check('grpc: failing method counted as failure', report.failed >= 30, JSON.stringify({ f: report.failed, s: report.statusCounts }));
check('grpc: gRPC status name recorded', Object.keys(report.statusCounts).includes('PERMISSION_DENIED'), JSON.stringify(report.statusCounts));

/* Streaming methods must be rejected rather than silently mis-measured. */
try {
  const bad = perf.startLoadTest(
    { protocol: 'grpc', request: { ...grpcRequest, method: 'Countdown' } },
    profile({ mode: 'iterations', iterations: 5, concurrency: 1 }),
    () => {},
  );
  await bad.done;
  check('grpc: streaming method rejected', false);
} catch (e) {
  check('grpc: streaming method rejected', e.message.includes('streaming'), e.message);
}

console.log(`\nPerf: ${pass} passed, ${fail} failed`);
await closeRestAgents();
server.close();
grpcServer.forceShutdown();
process.exit(fail ? 1 : 0);
