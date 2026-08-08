/** OpenAPI, Hoppscotch and Bruno import. */

import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { importOpenApi, importHoppscotch, importBrunoFolder, parseBru, parseBlocks, parseDict } =
  require('../dist/index.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

/* ================= OpenAPI 3 (YAML) ================= */

const oas3 = `
openapi: 3.0.3
info:
  title: Petstore
  version: 1.0.0
servers:
  - url: https://api.petstore.test/{basePath}
    variables:
      basePath:
        default: v2
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
  schemas:
    Pet:
      type: object
      required: [name]
      properties:
        id: { type: integer, format: int64 }
        name: { type: string, example: Fluffy }
        tags:
          type: array
          items: { type: string }
        born: { type: string, format: date-time }
security:
  - bearerAuth: []
paths:
  /pets:
    get:
      summary: List pets
      tags: [Pets]
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 20 }
        - name: X-Trace
          in: header
          required: true
          schema: { type: string }
      responses: { '200': { description: ok } }
    post:
      summary: Create a pet
      tags: [Pets]
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Pet' }
      responses: { '201': { description: created } }
  /pets/{petId}:
    get:
      summary: Get a pet
      tags: [Pets]
      parameters:
        - name: petId
          in: path
          required: true
          schema: { type: string }
      responses: { '200': { description: ok } }
`;

let r = importOpenApi(oas3);
check('openapi: parses YAML', r.requestCount === 3, String(r.requestCount));
check('openapi: names the collection from info.title', r.collection.name === 'Petstore', r.collection.name);
check('openapi: groups by tag into folders',
  r.collection.folders.length === 1 && r.collection.folders[0].name === 'Pets',
  JSON.stringify(r.collection.folders.map((f) => f.name)));

const list = r.collection.requests.find((x) => x.name === 'List pets');
check('openapi: server variable substituted from its default',
  list.rest.url === 'https://api.petstore.test/v2/pets', list.rest.url);
check('openapi: query parameter uses its default', list.rest.query.some((q) => q.key === 'limit' && q.value === '20'),
  JSON.stringify(list.rest.query));
check('openapi: header parameter imported', list.rest.headers.some((h) => h.key === 'X-Trace'),
  JSON.stringify(list.rest.headers));
check('openapi: global security becomes bearer auth', list.rest.auth.kind === 'bearer', JSON.stringify(list.rest.auth));

const byId = r.collection.requests.find((x) => x.name === 'Get a pet');
check('openapi: path parameter becomes a variable',
  byId.rest.url.endsWith('/pets/{{petId}}'), byId.rest.url);
check('openapi: path params suggested as environment variables',
  r.variables.some((v) => v.key === 'petId'), JSON.stringify(r.variables));

const create = r.collection.requests.find((x) => x.name === 'Create a pet');
const bodySample = JSON.parse(create.rest.body.text);
check('openapi: $ref body resolved into a sample', create.rest.body.kind === 'json' && 'name' in bodySample,
  create.rest.body.text);
check('openapi: schema example preferred over a placeholder', bodySample.name === 'Fluffy', JSON.stringify(bodySample));
check('openapi: array property sampled as an array', Array.isArray(bodySample.tags), JSON.stringify(bodySample));
check('openapi: date-time format produces a timestamp', /\d{4}-\d{2}-\d{2}T/.test(bodySample.born), String(bodySample.born));

/* ================= Swagger 2.0 (JSON) ================= */

const swagger2 = JSON.stringify({
  swagger: '2.0',
  info: { title: 'Legacy API', version: '1' },
  host: 'legacy.test',
  basePath: '/api',
  schemes: ['https'],
  securityDefinitions: { key: { type: 'apiKey', name: 'X-Api-Key', in: 'header' } },
  security: [{ key: [] }],
  definitions: { Order: { type: 'object', properties: { sku: { type: 'string' } } } },
  paths: {
    '/orders': {
      post: {
        summary: 'Place order',
        tags: ['Orders'],
        parameters: [{ name: 'body', in: 'body', schema: { $ref: '#/definitions/Order' } }],
      },
    },
  },
});

r = importOpenApi(swagger2);
check('swagger2: recognised', r.requestCount === 1);
check('swagger2: host and basePath become the URL',
  r.collection.requests[0].rest.url === 'https://legacy.test/api/orders', r.collection.requests[0].rest.url);
check('swagger2: body parameter becomes a JSON body',
  r.collection.requests[0].rest.body.kind === 'json' && r.collection.requests[0].rest.body.text.includes('sku'),
  r.collection.requests[0].rest.body.text);
check('swagger2: apiKey security imported',
  r.collection.requests[0].rest.auth.kind === 'apiKey' && r.collection.requests[0].rest.auth.key === 'X-Api-Key',
  JSON.stringify(r.collection.requests[0].rest.auth));

try { importOpenApi('{"nope":true}'); check('openapi: rejects a non-spec', false); }
catch (e) { check('openapi: rejects a non-spec', /OpenAPI or Swagger/.test(e.message), e.message); }
try { importOpenApi('openapi: 3.0.0\ninfo:\n  title: Empty\n'); check('openapi: rejects a spec with no paths', false); }
catch (e) { check('openapi: rejects a spec with no paths', /no paths/.test(e.message), e.message); }

/* ================= Hoppscotch ================= */

const hopp = JSON.stringify({
  v: 1,
  name: 'Shop',
  folders: [
    {
      name: 'Auth',
      folders: [],
      requests: [
        {
          name: 'Login',
          method: 'POST',
          endpoint: '<<host>>/login',
          headers: [{ key: 'Accept', value: 'application/json', active: true },
                    { key: 'X-Off', value: '1', active: false }],
          params: [{ key: 'debug', value: '<<dbg>>', active: true }],
          auth: { authType: 'bearer', authActive: true, token: '<<token>>' },
          body: { contentType: 'application/json', body: '{"user":"<<user>>"}' },
        },
      ],
    },
  ],
  requests: [{ name: 'Health', method: 'GET', endpoint: '<<host>>/health' }],
});

r = importHoppscotch(hopp);
check('hoppscotch: collection named', r.collection.name === 'Shop', r.collection.name);
check('hoppscotch: 2 requests imported', r.requestCount === 2, String(r.requestCount));
check('hoppscotch: nested folder created', r.collection.folders.some((f) => f.name === 'Auth'));

const login = r.collection.requests.find((x) => x.name === 'Login');
check('hoppscotch: <<var>> rewritten to {{var}}', login.rest.url === '{{host}}/login', login.rest.url);
check('hoppscotch: body variables rewritten', login.rest.body.text.includes('{{user}}'), login.rest.body.text);
check('hoppscotch: bearer token rewritten', login.rest.auth.kind === 'bearer' && login.rest.auth.token === '{{token}}',
  JSON.stringify(login.rest.auth));
check('hoppscotch: inactive header marked disabled',
  login.rest.headers.some((h) => h.key === 'X-Off' && !h.enabled), JSON.stringify(login.rest.headers));
check('hoppscotch: root-level request kept at the root',
  r.collection.requests.find((x) => x.name === 'Health').folderId === null);

try { importHoppscotch('{"unrelated":1}'); check('hoppscotch: rejects a non-collection', false); }
catch (e) { check('hoppscotch: rejects a non-collection', /Hoppscotch/.test(e.message), e.message); }

/* ================= Bruno ================= */

check('bru: block splitting survives braces in a body',
  parseBlocks('meta {\n name: X\n}\nbody:json {\n  {"a":{"b":1}}\n}').length === 2);
check('bru: dictionary parsing', parseDict(' a: 1\n ~b: 2\n').length === 2);
check('bru: tilde marks disabled', parseDict('~b: 2')[0]?.enabled === false);

const bruSource = `meta {
  name: Get user
  type: http
}

get {
  url: {{host}}/users/1
}

headers {
  Accept: application/json
  ~X-Debug: 1
}

params:query {
  verbose: true
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "nested": { "ok": true }
  }
}
`;

const parsed = parseBru(bruSource, 'fallback');
check('bru: name from meta', parsed.name === 'Get user', parsed.name);
check('bru: method and url', parsed.request.method === 'GET' && parsed.request.url === '{{host}}/users/1',
  `${parsed.request.method} ${parsed.request.url}`);
check('bru: headers with disabled entry', parsed.request.headers.length === 2 &&
  parsed.request.headers.find((h) => h.key === 'X-Debug').enabled === false,
  JSON.stringify(parsed.request.headers));
check('bru: query params', parsed.request.query.some((q) => q.key === 'verbose'), JSON.stringify(parsed.request.query));
check('bru: bearer auth', parsed.request.auth.kind === 'bearer' && parsed.request.auth.token === '{{token}}');
check('bru: JSON body kept intact including nested braces',
  parsed.request.body.kind === 'json' && parsed.request.body.text.includes('"nested"'),
  parsed.request.body.text);

// A real folder tree.
const root = mkdtempSync(join(tmpdir(), 'bruno-'));
writeFileSync(join(root, 'bruno.json'), JSON.stringify({ version: '1', name: 'My Bruno API', type: 'collection' }));
writeFileSync(join(root, 'health.bru'), 'meta {\n  name: Health\n}\n\nget {\n  url: {{host}}/health\n}\n');
mkdirSync(join(root, 'Users'));
writeFileSync(join(root, 'Users', 'get-user.bru'), bruSource);
writeFileSync(join(root, 'Users', 'create.bru'),
  'meta {\n  name: Create\n}\n\npost {\n  url: {{host}}/users\n}\n\nbody:form-urlencoded {\n  name: ada\n}\n');
writeFileSync(join(root, 'notes.txt'), 'ignored');

const bruno = await importBrunoFolder(root);
check('bruno: collection name from bruno.json', bruno.collection.name === 'My Bruno API', bruno.collection.name);
check('bruno: 3 requests found', bruno.requestCount === 3, String(bruno.requestCount));
check('bruno: subdirectory became a folder', bruno.collection.folders.some((f) => f.name === 'Users'));
check('bruno: nested request placed in its folder',
  bruno.collection.requests.find((x) => x.name === 'Get user').folderId ===
  bruno.collection.folders.find((f) => f.name === 'Users').id);
check('bruno: non-.bru files ignored', !bruno.collection.requests.some((x) => x.name === 'notes'));
check('bruno: urlencoded body parsed',
  bruno.collection.requests.find((x) => x.name === 'Create').rest.body.kind === 'form');

const empty = mkdtempSync(join(tmpdir(), 'bruno-empty-'));
try { await importBrunoFolder(empty); check('bruno: empty folder reports clearly', false); }
catch (e) { check('bruno: empty folder reports clearly', /No \.bru files/.test(e.message), e.message); }

console.log(`\nImporters: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
