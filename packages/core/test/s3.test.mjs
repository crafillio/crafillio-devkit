import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const S3rver = require('s3rver');
const { s3 } = require('../dist/index.js');

const dataDir = mkdtempSync(join(tmpdir(), 's3rver-'));
const server = new S3rver({
  port: 0,
  address: '127.0.0.1',
  silent: true,
  directory: dataDir,
});
const { port } = await server.run();

const conn = {
  endpoint: `http://127.0.0.1:${port}`,
  region: 'us-east-1',
  accessKeyId: 'S3RVER',
  secretAccessKey: 'S3RVER',
  forcePathStyle: true,
  insecureTls: false,
};

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

const work = mkdtempSync(join(tmpdir(), 'crafillio-'));
const localFile = join(work, 'hello.json');
writeFileSync(localFile, JSON.stringify({ greeting: 'hi' }));

// ---- Buckets
await s3.createBucket(conn, 'crafillio-test');
let buckets = await s3.listBuckets(conn);
check('bucket created and listed', buckets.some((b) => b.name === 'crafillio-test'), JSON.stringify(buckets));

// ---- Upload (add file)
const up = await s3.uploadFile(conn, 'crafillio-test', 'docs/hello.json', localFile, {
  metadata: { owner: 'crafillio', stage: 'draft' },
});
check('upload returns key', up.key === 'docs/hello.json', up.key);
check('upload returns size', up.size > 0, String(up.size));

// upload with trailing-slash key uses the local basename
// (into its own prefix, so it does not overwrite the object under test above)
const up2 = await s3.uploadFile(conn, 'crafillio-test', 'dropbox/', localFile);
check('upload to prefix keeps filename', up2.key === 'dropbox/hello.json', up2.key);

// ---- Inline write
await s3.putText(conn, 'crafillio-test', 'notes/readme.txt', 'plain text body', 'text/plain');
await s3.putText(conn, 'crafillio-test', 'notes/second.txt', 'another');

// ---- Listing with folder semantics
let list = await s3.listObjects(conn, 'crafillio-test', '');
check('root listing shows prefixes', list.prefixes.includes('docs/') && list.prefixes.includes('notes/'), JSON.stringify(list.prefixes));
check('root listing has no keys', list.objects.length === 0, JSON.stringify(list.objects.map(o => o.key)));

list = await s3.listObjects(conn, 'crafillio-test', 'notes/');
check('prefix listing returns 2 objects', list.objects.length === 2, JSON.stringify(list.objects.map((o) => o.key)));
check('object size reported', list.objects.every((o) => o.size > 0));
check('lastModified reported', list.objects.every((o) => !!o.lastModified));

// ---- Metadata read
let detail = await s3.headObject(conn, 'crafillio-test', 'docs/hello.json');
check('metadata read back', detail.metadata.owner === 'crafillio', JSON.stringify(detail.metadata));
check('content-type guessed from extension', detail.contentType === 'application/json', String(detail.contentType));

// ---- Metadata update (the CopyObject REPLACE path)
const updated = await s3.updateMetadata(conn, 'crafillio-test', 'docs/hello.json', {
  metadata: { owner: 'crafillio', stage: 'published', reviewed: 'yes' },
});
check('metadata updated', updated.metadata.stage === 'published', JSON.stringify(updated.metadata));
check('metadata key added', updated.metadata.reviewed === 'yes', JSON.stringify(updated.metadata));
check('content-type preserved through REPLACE', updated.contentType === 'application/json', String(updated.contentType));

// changing only content-type must not wipe user metadata
const retyped = await s3.updateMetadata(conn, 'crafillio-test', 'docs/hello.json', {
  metadata: updated.metadata,
  cacheControl: 'max-age=60',
});
check('cacheControl set', retyped.cacheControl === 'max-age=60', String(retyped.cacheControl));
check('user metadata survived second update', retyped.metadata.reviewed === 'yes', JSON.stringify(retyped.metadata));

// ---- Preview
const preview = await s3.previewObject(conn, 'crafillio-test', 'notes/readme.txt');
check('preview returns text', preview.text === 'plain text body' && !preview.binary, JSON.stringify(preview));

// ---- Download
const dest = join(work, 'downloaded.json');
const dl = await s3.downloadFile(conn, 'crafillio-test', 'docs/hello.json', dest);
check('download writes file', readFileSync(dest, 'utf8').includes('greeting'), dl.path);

// ---- Presign
const url = await s3.presign(conn, 'crafillio-test', 'docs/hello.json', 'get', 900);
check('presigned url signed', url.includes('X-Amz-Signature') && url.includes('docs/hello.json'), url.slice(0, 120));

// ---- Delete single
await s3.deleteObject(conn, 'crafillio-test', 'notes/second.txt');
list = await s3.listObjects(conn, 'crafillio-test', 'notes/');
check('single delete removed key', list.objects.length === 1, JSON.stringify(list.objects.map((o) => o.key)));

// ---- Delete prefix (recursive)
await s3.putText(conn, 'crafillio-test', 'bulk/a.txt', 'a');
await s3.putText(conn, 'crafillio-test', 'bulk/b.txt', 'b');
await s3.putText(conn, 'crafillio-test', 'bulk/deep/c.txt', 'c');
const removed = await s3.deletePrefix(conn, 'crafillio-test', 'bulk/');
check('prefix delete removed all 3', removed.deleted.length === 3, JSON.stringify(removed));
list = await s3.listObjects(conn, 'crafillio-test', 'bulk/');
check('prefix now empty', list.objects.length === 0 && list.prefixes.length === 0);

// ---- Error surface
try {
  await s3.headObject(conn, 'crafillio-test', 'does/not/exist');
  check('missing key throws', false);
} catch (e) {
  check('missing key friendly error', /Reading metadata/.test(e.message), e.message);
}

// NOTE: s3rver does not verify signatures, so a wrong-secret test is not
// meaningful against this double. Exercise the missing-bucket path instead.
try {
  await s3.listObjects(conn, 'no-such-bucket-here', '');
  check('missing bucket throws', false);
} catch (e) {
  check('missing bucket friendly error', e.message.includes('bucket does not exist'), e.message);
}

console.log(`\nS3: ${pass} passed, ${fail} failed`);
await server.close();
process.exit(fail ? 1 : 0);
