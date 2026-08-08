/** cURL import/export and Postman collection import. */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { importCurl, exportCurl, importPostmanCollection } = require('../dist/index.js');

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

/* ---- cURL import ---- */

let r = importCurl(`curl 'https://api.example.com/v1/users?page=2' -H 'Accept: application/json'`);
check('curl: url parsed', r.url === 'https://api.example.com/v1/users', r.url);
check('curl: query pulled out of url', r.query.length === 1 && r.query[0].key === 'page' && r.query[0].value === '2', JSON.stringify(r.query));
check('curl: header imported', r.headers.some((h) => h.key === 'Accept'), JSON.stringify(r.headers));
check('curl: defaults to GET', r.method === 'GET', r.method);

r = importCurl(`curl -X POST https://api.example.com/charges -H "Content-Type: application/json" -d '{"amount":100}'`);
check('curl: explicit method', r.method === 'POST', r.method);
check('curl: json body detected', r.body.kind === 'json' && r.body.text === '{"amount":100}', JSON.stringify(r.body));

r = importCurl(`curl https://x.test/a -d 'name=bob&age=3'`);
check('curl: data implies POST', r.method === 'POST', r.method);
check('curl: urlencoded body parsed', r.body.kind === 'form' && r.body.fields.length === 2, JSON.stringify(r.body));

r = importCurl(`curl https://x.test -H 'Authorization: Bearer abc123'`);
check('curl: bearer promoted to auth', r.auth.kind === 'bearer' && r.auth.token === 'abc123', JSON.stringify(r.auth));
check('curl: bearer header removed', !r.headers.some((h) => h.key.toLowerCase() === 'authorization'));

r = importCurl(`curl -u admin:s3cret https://x.test -k -L`);
check('curl: basic auth', r.auth.kind === 'basic' && r.auth.username === 'admin' && r.auth.password === 's3cret', JSON.stringify(r.auth));
check('curl: -k sets insecure', r.insecureTls === true);
check('curl: -L follows redirects', r.followRedirects === true);

// A header value containing spaces must survive tokenizing.
r = importCurl(`curl https://x.test -H 'User-Agent: My Client/1.0 (test)'`);
check('curl: spaces inside quoted header', r.headers[0].value === 'My Client/1.0 (test)', JSON.stringify(r.headers));

// Multi-line command with backslash continuations (how people paste them).
r = importCurl(`curl 'https://x.test/y' \\\n  -X PUT \\\n  -H 'X-A: 1' \\\n  -d '{"k":1}'`);
check('curl: line continuations handled', r.method === 'PUT' && r.headers.some((h) => h.key === 'X-A'), JSON.stringify({ m: r.method, h: r.headers }));

r = importCurl(`curl -F 'file=@/tmp/a.png' -F 'note=hi' https://x.test/upload`);
check('curl: -F becomes multipart', r.body.kind === 'multipart' || r.body.kind === 'form', r.body.kind);

try { importCurl('wget https://x.test'); check('curl: rejects non-curl', false); }
catch (e) { check('curl: rejects non-curl', e.message.includes('curl'), e.message); }

/* ---- cURL export ---- */

const out = exportCurl({
  method: 'POST', url: 'https://api.example.com/v1/charges',
  headers: [{ id: '1', key: 'X-Trace', value: 'abc', enabled: true },
            { id: '2', key: 'X-Off', value: 'no', enabled: false }],
  query: [{ id: '3', key: 'dry', value: 'true', enabled: true }],
  body: { kind: 'json', text: '{"amount":100}' },
  auth: { kind: 'bearer', token: 'tok' },
  timeoutMs: 0, followRedirects: true, maxRedirects: 5, insecureTls: false,
});
check('export: method and url', out.includes("curl -X POST 'https://api.example.com/v1/charges?dry=true'"), out.split('\n')[0]);
check('export: enabled header included', out.includes('X-Trace: abc'));
check('export: disabled header excluded', !out.includes('X-Off'));
check('export: bearer rendered', out.includes('Authorization: Bearer tok'));
check('export: body rendered', out.includes(`-d '{"amount":100}'`));
check('export: -L for redirects', out.includes('-L'));

// Round trip: export then import should preserve the essentials.
const round = importCurl(exportCurl({
  method: 'PATCH', url: 'https://x.test/item', headers: [], query: [],
  body: { kind: 'json', text: '{"a":1}' }, auth: { kind: 'none' },
  timeoutMs: 0, followRedirects: false, maxRedirects: 0, insecureTls: false,
}));
check('round trip: method preserved', round.method === 'PATCH', round.method);
check('round trip: body preserved', round.body.kind === 'json' && round.body.text === '{"a":1}', JSON.stringify(round.body));

/* ---- Postman import ---- */

const postman = JSON.stringify({
  info: { name: 'Payments', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{apiKey}}' }] },
  item: [
    {
      name: 'Charges',
      item: [
        {
          name: 'List charges',
          request: {
            method: 'GET',
            header: [{ key: 'Accept', value: 'application/json' }],
            url: { raw: '{{baseUrl}}/v1/charges?limit=10', host: ['{{baseUrl}}'], path: ['v1', 'charges'],
                   query: [{ key: 'limit', value: '10' }, { key: 'off', value: '1', disabled: true }] },
          },
        },
        {
          name: 'Create charge',
          request: {
            method: 'POST',
            body: { mode: 'raw', raw: '{"amount":100}', options: { raw: { language: 'json' } } },
            url: { raw: '{{baseUrl}}/v1/charges' },
          },
        },
      ],
    },
    {
      name: 'Health',
      request: { method: 'GET', url: { raw: '{{baseUrl}}/health' } },
    },
  ],
});

const result = importPostmanCollection(postman);
check('postman: collection named', result.collection.name === 'Payments', result.collection.name);
check('postman: 3 requests imported', result.requestCount === 3, String(result.requestCount));
check('postman: folder created', result.collection.folders.length === 1 && result.collection.folders[0].name === 'Charges', JSON.stringify(result.collection.folders));

const listCharges = result.collection.requests.find((x) => x.name === 'List charges');
check('postman: request nested in folder', listCharges.folderId === result.collection.folders[0].id);
check('postman: query string stripped from raw url', listCharges.rest.url === '{{baseUrl}}/v1/charges', listCharges.rest.url);
check('postman: enabled query kept', listCharges.rest.query.some((q) => q.key === 'limit' && q.enabled));
check('postman: disabled query marked disabled', listCharges.rest.query.some((q) => q.key === 'off' && !q.enabled));
check('postman: collection auth inherited', listCharges.rest.auth.kind === 'bearer' && listCharges.rest.auth.token === '{{apiKey}}', JSON.stringify(listCharges.rest.auth));
check('postman: variables extracted', result.variables.some((v) => v.key === 'baseUrl'), JSON.stringify(result.variables));

const create = result.collection.requests.find((x) => x.name === 'Create charge');
check('postman: raw json body', create.rest.body.kind === 'json' && create.rest.body.text === '{"amount":100}', JSON.stringify(create.rest.body));

const health = result.collection.requests.find((x) => x.name === 'Health');
check('postman: root-level request has no folder', health.folderId === null);

try { importPostmanCollection('{"not":"postman"}'); check('postman: rejects non-collection', false); }
catch (e) { check('postman: rejects non-collection', e.message.includes('Postman'), e.message); }

console.log(`\nInterop: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
