import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { ReflectionService } = require('@grpc/reflection');
const { invokeGrpc, describeGrpc, clearSchemaCache } = require('../dist/index.js');

const PROTO = fileURLToPath(new URL('./fixtures/demo.proto', import.meta.url));

const pkgDef = protoLoader.loadSync(PROTO, { keepCase: true, defaults: true });
const loaded = grpc.loadPackageDefinition(pkgDef);

const server = new grpc.Server();
server.addService(loaded.demo.v1.Greeter.service, {
  SayHello: (call, cb) => cb(null, { message: `Hello ${call.request.name}`, counter: 1 }),
  Countdown: (call) => {
    const n = call.request.times || 3;
    for (let i = n; i > 0; i--) call.write({ message: `tick ${i}`, counter: i });
    call.end();
  },
  Collect: (call, cb) => {
    const names = [];
    call.on('data', (m) => names.push(m.name));
    call.on('end', () => cb(null, { message: names.join(','), counter: names.length }));
  },
  Chat: (call) => {
    call.on('data', (m) => call.write({ message: `echo:${m.name}`, counter: 0 }));
    call.on('end', () => call.end());
  },
  Fail: (call, cb) =>
    cb({ code: grpc.status.PERMISSION_DENIED, details: 'nope, not allowed' }),
});

// Serve reflection so the reflection path gets exercised for real.
new ReflectionService(pkgDef).addToServer(server);

const port = await new Promise((resolve, reject) =>
  server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) =>
    e ? reject(e) : resolve(p),
  ),
);
const address = `127.0.0.1:${port}`;

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

const target = { address, tls: false, insecureTls: false };
const protoSource = { kind: 'proto', files: [PROTO], includeDirs: [] };
const reflectSource = { kind: 'reflection' };

async function run(source, service, method, messages, metadata = []) {
  const events = [];
  const call = await invokeGrpc(
    { target, source, service, method, messages, metadata, timeoutMs: 8000 },
    (e) => events.push(e),
  );
  await call.done;
  return events;
}

// ---- Schema discovery via .proto files
let services = await describeGrpc(protoSource, target);
const greeter = services.find((s) => s.name === 'demo.v1.Greeter');
check('proto: Greeter discovered', !!greeter, JSON.stringify(services.map(s => s.name)));
check('proto: 5 methods found', greeter?.methods.length === 5, String(greeter?.methods.length));
const types = Object.fromEntries(greeter.methods.map((m) => [m.name, m.callType]));
check('proto: unary classified', types.SayHello === 'unary', types.SayHello);
check('proto: server_stream classified', types.Countdown === 'server_stream', types.Countdown);
check('proto: client_stream classified', types.Collect === 'client_stream', types.Collect);
check('proto: bidi classified', types.Chat === 'bidi', types.Chat);

const skeleton = JSON.parse(greeter.methods.find((m) => m.name === 'SayHello').inputExample);
check('proto: skeleton has scalar fields', skeleton.name === '' && skeleton.times === 0, JSON.stringify(skeleton));
check('proto: skeleton enum uses name', skeleton.tone === 'TONE_UNSPECIFIED', String(skeleton.tone));
check('proto: skeleton repeated is array', Array.isArray(skeleton.tags), JSON.stringify(skeleton.tags));
check('proto: skeleton nested message', typeof skeleton.nested === 'object' && skeleton.nested.note === '', JSON.stringify(skeleton.nested));
check('proto: int64 skeleton is string', skeleton.nested.big === '0', JSON.stringify(skeleton.nested.big));

// ---- Schema discovery via reflection
clearSchemaCache();
services = await describeGrpc(reflectSource, target);
const rGreeter = services.find((s) => s.name === 'demo.v1.Greeter');
check('reflection: Greeter discovered', !!rGreeter, JSON.stringify(services.map((s) => s.name)));
check('reflection: 5 methods found', rGreeter?.methods.length === 5, String(rGreeter?.methods.length));
check('reflection: no grpc.reflection service leaked', !services.some((s) => s.name.startsWith('grpc.reflection')), JSON.stringify(services.map(s=>s.name)));

// ---- Unary
let events = await run(protoSource, 'demo.v1.Greeter', 'SayHello', ['{"name":"World"}']);
let msgs = events.filter((e) => e.type === 'message');
let status = events.find((e) => e.type === 'status');
check('unary: one message', msgs.length === 1, String(msgs.length));
check('unary: payload correct', JSON.parse(msgs[0].json).message === 'Hello World', msgs[0]?.json);
check('unary: status OK', status?.codeName === 'OK', JSON.stringify(status));
check('unary: int64 as string', JSON.parse(msgs[0].json).counter === '1', msgs[0]?.json);

// ---- Server streaming
events = await run(protoSource, 'demo.v1.Greeter', 'Countdown', ['{"name":"x","times":4}']);
msgs = events.filter((e) => e.type === 'message');
check('server_stream: 4 messages', msgs.length === 4, String(msgs.length));
check('server_stream: ordered indices', msgs.every((m, i) => m.index === i));
check('server_stream: status OK', events.find((e) => e.type === 'status')?.codeName === 'OK');

// ---- Client streaming
events = await run(protoSource, 'demo.v1.Greeter', 'Collect', ['{"name":"a"}', '{"name":"b"}', '{"name":"c"}']);
msgs = events.filter((e) => e.type === 'message');
check('client_stream: single reply', msgs.length === 1, String(msgs.length));
check('client_stream: all messages sent', JSON.parse(msgs[0].json).message === 'a,b,c', msgs[0]?.json);

// ---- Bidi
events = await run(protoSource, 'demo.v1.Greeter', 'Chat', ['{"name":"one"}', '{"name":"two"}']);
msgs = events.filter((e) => e.type === 'message');
check('bidi: 2 echoes', msgs.length === 2, String(msgs.length));
check('bidi: echo content', JSON.parse(msgs[0].json).message === 'echo:one', msgs[0]?.json);

// ---- Error status propagation
events = await run(protoSource, 'demo.v1.Greeter', 'Fail', ['{"name":"x"}']);
const err = events.find((e) => e.type === 'error');
check('error: PERMISSION_DENIED surfaced', err?.codeName === 'PERMISSION_DENIED', JSON.stringify(err));
check('error: details included', err?.message.includes('not allowed'), err?.message);

// ---- Invoking via reflection-loaded schema
events = await run(reflectSource, 'demo.v1.Greeter', 'SayHello', ['{"name":"Reflect"}']);
msgs = events.filter((e) => e.type === 'message');
check('reflection: unary invoke works', JSON.parse(msgs[0]?.json ?? '{}').message === 'Hello Reflect', msgs[0]?.json);

// ---- Metadata round trip
events = await run(protoSource, 'demo.v1.Greeter', 'SayHello', ['{"name":"m"}'],
  [{ id: '1', key: 'x-trace', value: 'abc', enabled: true }]);
check('metadata: call still succeeds', events.some((e) => e.type === 'message'));

// ---- Bad method name
try {
  await run(protoSource, 'demo.v1.Greeter', 'NoSuchMethod', ['{}']);
  check('bad method rejected', false);
} catch (e) {
  check('bad method names alternatives', e.message.includes('SayHello'), e.message);
}

// ---- Invalid JSON body
try {
  await run(protoSource, 'demo.v1.Greeter', 'SayHello', ['{not json']);
  check('invalid JSON rejected', false);
} catch (e) {
  check('invalid JSON reports position', e.message.includes('not valid JSON'), e.message);
}


/* ---- Enums by name, as the prefilled editor writes them ---- */

// The skeleton renders enums as names for readability, so the message the app
// hands you must be sendable as-is. It was not: validation ran before
// name-to-number conversion and rejected every enum field with
// "enum value expected" — including the app's own generated skeleton.
{
  const send = (payload) =>
    run(protoSource, 'demo.v1.Greeter', 'SayHello', [JSON.stringify(payload)]);
  const ok = (ev) => ev.find((e) => e.type === 'status')?.codeName === 'OK';
  const errs = (ev) => JSON.stringify(ev.filter((e) => e.type === 'error'));

  let ev = await send(JSON.parse(greeter.methods.find((m) => m.name === 'SayHello').inputExample));
  check('the generated skeleton sends as-is', ok(ev), errs(ev));

  ev = await send({ name: 'Ada', tone: 'TONE_FORMAL' });
  check('an enum given by name is accepted', ok(ev), errs(ev));

  ev = await send({ name: 'Ada', tone: 1 });
  check('  ...and a numeric enum still works', ok(ev), errs(ev));

  let bogus;
  try {
    bogus = errs(await send({ name: 'Ada', tone: 'NOT_A_TONE' }));
  } catch (e) { bogus = e.message; }
  check('  ...while a bogus enum name is still rejected', /NOT_A_TONE|enum|invalid/i.test(bogus), bogus);

  ev = await send({ name: 'Ada', nested: { note: 'x', big: '9007199254740993' } });
  check('  ...and a 64-bit int given as a string is accepted', ok(ev), errs(ev));
}

console.log(`\ngRPC: ${pass} passed, ${fail} failed`);
server.forceShutdown();
process.exit(fail ? 1 : 0);
