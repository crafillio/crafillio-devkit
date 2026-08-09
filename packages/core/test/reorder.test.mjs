/** Reordering requests within a collection, including across folders. */

import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CRAFILLIO_HOME = mkdtempSync(join(tmpdir(), 'ck-order-'));

const require = createRequire(import.meta.url);
const { collections: c } = require('../dist/index.js');

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const blank = (name) => ({
  id: name, name, protocol: 'rest', folderId: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  rest: { method: 'GET', url: 'http://x', headers: [], query: [], body: { kind: 'none' },
    auth: { kind: 'none' }, timeoutMs: 1000, followRedirects: false, maxRedirects: 0, insecureTls: false },
});

let col = await c.createCollection('Ordering');
for (const n of ['a', 'b', 'c', 'd']) col = await c.upsertRequest(col.id, blank(n));
const order = (x) => x.requests.map((r) => r.id).join(',');
check('starts in insertion order', order(col) === 'a,b,c,d', order(col));

// Move d to the very front.
col = await c.moveRequest(col.id, 'd', null, 'a');
check('moving to the front', order(col) === 'd,a,b,c', order(col));

// Move d back to the end.
col = await c.moveRequest(col.id, 'd', null, null);
check('moving to the end', order(col) === 'a,b,c,d', order(col));

// Move a to sit before c.
col = await c.moveRequest(col.id, 'a', null, 'c');
check('moving into the middle', order(col) === 'b,a,c,d', order(col));

// A no-op: before itself.
col = await c.moveRequest(col.id, 'a', null, 'a');
check('placing a request before itself does not duplicate or drop it',
  order(col).split(',').length === 4 && order(col).includes('a'), order(col));

// Unknown anchor falls back to the end rather than throwing.
col = await c.moveRequest(col.id, 'b', null, 'does-not-exist');
check('an unknown anchor puts it last', order(col).endsWith('b'), order(col));
check('nothing was lost', order(col).split(',').sort().join('') === 'abcd', order(col));

// Into a folder, keeping position semantics.
col = await c.createFolder(col.id, 'Folder one', null);
const folderId = col.folders[0].id;
col = await c.moveRequest(col.id, 'c', folderId, null);
check('a move can also change folder',
  col.requests.find((r) => r.id === 'c').folderId === folderId);
check('  ...and the others keep their folder',
  col.requests.filter((r) => r.folderId === null).length === 3);

// Reordering survives a reload from disk.
const reloaded = (await c.listCollections()).find((x) => x.id === col.id);
check('the order is persisted', order(reloaded) === order(col), `${order(reloaded)} vs ${order(col)}`);

// A request that no longer exists is a clear error, not a silent no-op.
let msg = null;
try { await c.moveRequest(col.id, 'ghost', null, null); } catch (e) { msg = e.message; }
check('moving a missing request errors clearly', /no longer exists/.test(msg ?? ''), String(msg));

console.log(`\nReorder: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
