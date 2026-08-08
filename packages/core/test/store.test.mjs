/**
 * Collections, variable interpolation, secret sealing and licensing.
 *
 * Runs against a throwaway CRAFILLIO_HOME so it never touches the developer's own
 * collections.
 */

import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CRAFILLIO_HOME = mkdtempSync(join(tmpdir(), 'crafillio-home-'));

const require = createRequire(import.meta.url);
const {
  collections,
  environments,
  interpolate,
  referencedVariables,
  registerSecretProvider,
  setPreferredSecretBackend,
  createKeyfileProvider,
} = require('../dist/index.js');

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};

/*
 * Use the real keyfile backend rather than a stub: it needs no OS support, so
 * the test covers the same code path the app actually ships with.
 */
registerSecretProvider(createKeyfileProvider(join(process.env.CRAFILLIO_HOME, 'secret.key')), 'keyfile');
setPreferredSecretBackend('keyfile');

/* ---- Collections ---- */

const collection = await collections.createCollection('My APIs');
check('collection created', collection.name === 'My APIs' && !!collection.id);

await collections.upsertRequest(collection.id, {
  id: 'r1',
  name: 'Get user',
  protocol: 'rest',
  folderId: null,
  rest: {
    method: 'GET',
    url: '{{base}}/users/{{id}}',
    headers: [],
    query: [],
    body: { kind: 'none' },
    auth: { kind: 'none' },
    timeoutMs: 0,
    followRedirects: true,
    maxRedirects: 5,
    insecureTls: false,
  },
});

let loaded = await collections.getCollection(collection.id);
check('request persisted', loaded.requests.length === 1 && loaded.requests[0].name === 'Get user');

const withFolder = await collections.createFolder(collection.id, 'Users');
await collections.moveRequest(collection.id, 'r1', withFolder.folders[0].id);
loaded = await collections.getCollection(collection.id);
check('request moved into folder', loaded.requests[0].folderId === withFolder.folders[0].id);

await collections.deleteFolder(collection.id, withFolder.folders[0].id);
loaded = await collections.getCollection(collection.id);
check(
  'deleting a folder removes its requests',
  loaded.requests.length === 0 && loaded.folders.length === 0,
);

const exported = await collections.exportCollection(collection.id);
const imported = await collections.importCollection(exported);
check('import gets a fresh id', imported.id !== collection.id);
check('import is marked as imported', imported.name.includes('imported'), imported.name);

try {
  await collections.importCollection('{"nope":true}');
  check('malformed import rejected', false);
} catch (err) {
  check('malformed import rejected', err.message.includes('requests'), err.message);
}

/* ---- Variables ---- */

const result = interpolate(
  { url: '{{base}}/users/{{id}}', headers: [{ value: 'Bearer {{token}}' }] },
  { base: 'https://api.test', id: '42' },
);
check('interpolates nested strings', result.value.url === 'https://api.test/users/42', result.value.url);
check('reports missing variables', result.missing.includes('token'), JSON.stringify(result.missing));
check(
  'leaves an undefined token visible rather than blanking it',
  result.value.headers[0].value === 'Bearer {{token}}',
  result.value.headers[0].value,
);
check(
  'referencedVariables finds every name',
  referencedVariables({ a: '{{x}}', b: ['{{y}}'] }).sort().join() === 'x,y',
);

/* ---- Secrets ---- */

const envFile = await environments.createEnvironment('Local');
envFile.environments[0].variables.push({
  id: 'v1',
  key: 'token',
  value: 's3cr3t',
  enabled: true,
  secret: true,
});
await environments.saveEnvironments(envFile);

const onDisk = readFileSync(join(process.env.CRAFILLIO_HOME, 'environments.json'), 'utf8');
check('secret is not written in plaintext', !onDisk.includes('s3cr3t'));
check('secret is stored sealed', onDisk.includes('__sealed'));
check('secret decrypts on read', (await environments.activeVariables()).token === 's3cr3t');

console.log(`\nStore/vars: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
