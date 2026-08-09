/**
 * S3 engine. Works against AWS proper and any S3-compatible gateway
 * (MinIO, Ceph, R2, Wasabi) via a custom endpoint + path-style addressing.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Agent as HttpsAgent } from 'node:https';
import { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  S3Bucket,
  S3Connection,
  S3ListResult,
  S3Object,
  S3ObjectDetail,
} from '../types.js';

/** Clients are cached per connection so the SDK can reuse sockets. */
const clients = new Map<string, S3Client>();

function connectionKey(conn: S3Connection): string {
  return [
    conn.endpoint ?? 'aws',
    conn.region,
    conn.accessKeyId,
    conn.forcePathStyle,
    conn.insecureTls,
  ].join('|');
}

function clientFor(conn: S3Connection): S3Client {
  const key = connectionKey(conn);
  const cached = clients.get(key);
  if (cached) return cached;

  const client = new S3Client({
    region: conn.region || 'us-east-1',
    endpoint: conn.endpoint || undefined,
    forcePathStyle: conn.forcePathStyle,
    credentials: {
      accessKeyId: conn.accessKeyId,
      secretAccessKey: conn.secretAccessKey,
      sessionToken: conn.sessionToken || undefined,
    },
    requestHandler: conn.insecureTls
      ? new NodeHttpHandler({
          httpsAgent: new HttpsAgent({ rejectUnauthorized: false }),
        })
      : undefined,
  });

  clients.set(key, client);
  return client;
}

/** Drops cached clients; call after credentials change. */
export function resetS3Clients(): void {
  for (const client of clients.values()) client.destroy();
  clients.clear();
}

/** SDK errors are verbose and bury the cause; surface the useful part. */
/**
 * Turns an SDK or socket error into something that says what to do.
 *
 * Two classes arrive here and only one used to be handled. AWS returns named
 * errors — NoSuchBucket, AccessDenied — which mapped cleanly. But a wrong
 * endpoint never reaches AWS at all: it fails at the socket, and those came
 * through as raw Node text like "connect ECONNREFUSED 127.0.0.1:1", which
 * names a port and explains nothing. Those are now translated too, and the
 * endpoint is quoted so it is obvious what was actually contacted.
 */
function rethrow(err: unknown, action: string, conn?: S3Connection): never {
  const e = err as Error & {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
    cause?: { code?: string; message?: string };
  };
  const status = e.$metadata?.httpStatusCode;
  const where = conn?.endpoint ? ` at ${conn.endpoint}` : '';

  // Socket-level failures: the request never got as far as S3.
  const socket = e.code ?? e.cause?.code ?? '';
  const socketHint: Record<string, string> = {
    ECONNREFUSED:
      `Nothing is listening${where}. Check the endpoint and port, and that the service is running.`,
    ENOTFOUND: `That host could not be resolved${where}. Check the endpoint for a typo.`,
    EHOSTUNREACH: `That host is unreachable${where}. Check the network or a VPN.`,
    ECONNRESET: `The connection was reset${where}. An HTTPS endpoint reached over http:// does this.`,
    ETIMEDOUT: `Timed out reaching the endpoint${where}. A firewall or the wrong port will do this.`,
    EPROTO: `TLS handshake failed${where}. Check whether the endpoint is http:// rather than https://.`,
    DEPTH_ZERO_SELF_SIGNED_CERT:
      `The endpoint${where} presents a self-signed certificate. Tick "Ignore TLS" on the ` +
      'connection, or trust the CA under Network settings.',
    SELF_SIGNED_CERT_IN_CHAIN:
      `The certificate chain${where} is self-signed. Trust the CA under Network settings, or ` +
      'tick "Ignore TLS" on the connection.',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:
      `The certificate${where} could not be verified. Trust the CA under Network settings.`,
    ERR_TLS_CERT_ALTNAME_INVALID:
      `The certificate${where} is for a different host name. Path-style addressing usually fixes ` +
      'this for MinIO and other S3-compatible servers.',
  };
  if (socketHint[socket]) {
    throw new Error(`${action} failed: ${socketHint[socket]}`);
  }

  const hint: Record<string, string> = {
    NoSuchBucket: 'That bucket does not exist, or it is in a different region.',
    NoSuchKey: 'That object does not exist.',
    AccessDenied:
      'Access denied. The credentials are valid but the policy does not allow this action ' +
      'on this bucket.',
    InvalidAccessKeyId: 'That access key ID is not recognised.',
    SignatureDoesNotMatch: 'Signature mismatch — check the secret access key.',
    InvalidBucketName:
      'That is not a valid bucket name: lower case, 3–63 characters, no underscores.',
    BucketAlreadyOwnedByYou: 'You already own a bucket with that name.',
    BucketAlreadyExists: 'That bucket name is taken — S3 bucket names are globally unique.',
    BucketNotEmpty: 'That bucket still contains objects. Delete them first.',
    NotFound: 'Not found — check the bucket name and the key.',
    NetworkingError: `Could not reach the endpoint${where}.`,
    TimeoutError: `Timed out reaching the endpoint${where}.`,
    PermanentRedirect:
      'Wrong region for this bucket, or path-style addressing is required. Check the region ' +
      'on the connection, and try turning path-style on.',
    AuthorizationHeaderMalformed:
      'The region on this connection does not match the bucket\'s region.',
    IllegalLocationConstraintException:
      'The region on this connection does not match the bucket\'s region.',
  };

  const detail = hint[e.name ?? ''] ?? `${e.message}${where}`;
  throw new Error(`${action} failed${status ? ` (HTTP ${status})` : ''}: ${detail}`);
}

/* ------------------------------------------------------------------ */
/* Buckets                                                             */
/* ------------------------------------------------------------------ */

export async function listBuckets(conn: S3Connection): Promise<S3Bucket[]> {
  try {
    const res = await clientFor(conn).send(new ListBucketsCommand({}));
    return (res.Buckets ?? []).map((b) => ({
      name: b.Name ?? '',
      createdAt: b.CreationDate?.toISOString(),
    }));
  } catch (err) {
    return rethrow(err, 'Listing buckets', conn);
  }
}

export async function createBucket(conn: S3Connection, bucket: string): Promise<void> {
  try {
    await clientFor(conn).send(
      new CreateBucketCommand({
        Bucket: bucket,
        // us-east-1 must NOT carry a location constraint; every other region must.
        CreateBucketConfiguration:
          conn.region && conn.region !== 'us-east-1'
            ? { LocationConstraint: conn.region as never }
            : undefined,
      }),
    );
  } catch (err) {
    rethrow(err, `Creating bucket "${bucket}"`, conn);
  }
}

export async function deleteBucket(conn: S3Connection, bucket: string): Promise<void> {
  try {
    await clientFor(conn).send(new DeleteBucketCommand({ Bucket: bucket }));
  } catch (err) {
    rethrow(err, `Deleting bucket "${bucket}"`, conn);
  }
}

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

export async function listObjects(
  conn: S3Connection,
  bucket: string,
  prefix = '',
  continuationToken?: string,
  pageSize = 500,
): Promise<S3ListResult> {
  try {
    const res = await clientFor(conn).send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        // The delimiter is what turns flat keys into browsable folders.
        Delimiter: '/',
        ContinuationToken: continuationToken,
        MaxKeys: pageSize,
      }),
    );

    const objects: S3Object[] = (res.Contents ?? [])
      // A key identical to the prefix is the folder marker itself, not a file.
      .filter((o) => o.Key && o.Key !== prefix)
      .map((o) => ({
        key: o.Key!,
        size: o.Size ?? 0,
        lastModified: o.LastModified?.toISOString(),
        etag: o.ETag?.replace(/"/g, ''),
        storageClass: o.StorageClass,
      }));

    return {
      prefixes: (res.CommonPrefixes ?? []).map((p) => p.Prefix!).filter(Boolean),
      objects,
      continuationToken: res.NextContinuationToken,
      isTruncated: Boolean(res.IsTruncated),
    };
  } catch (err) {
    return rethrow(err, `Listing "${bucket}"`, conn);
  }
}

/* ------------------------------------------------------------------ */
/* Object metadata                                                     */
/* ------------------------------------------------------------------ */

export async function headObject(
  conn: S3Connection,
  bucket: string,
  key: string,
): Promise<S3ObjectDetail> {
  try {
    const res = await clientFor(conn).send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      key,
      size: res.ContentLength ?? 0,
      lastModified: res.LastModified?.toISOString(),
      etag: res.ETag?.replace(/"/g, ''),
      contentType: res.ContentType,
      cacheControl: res.CacheControl,
      contentDisposition: res.ContentDisposition,
      contentEncoding: res.ContentEncoding,
      storageClass: res.StorageClass,
      metadata: res.Metadata ?? {},
    };
  } catch (err) {
    return rethrow(err, `Reading metadata for "${key}"`, conn);
  }
}

export interface MetadataUpdate {
  metadata: Record<string, string>;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
}

/**
 * Updates an object's metadata.
 *
 * S3 has no in-place metadata call — the only way is to copy the object onto
 * itself with `MetadataDirective: REPLACE`. That directive replaces the *whole*
 * metadata set, so any system header the caller omits is dropped from the
 * object. We read the current head first and pass unspecified fields through.
 */
export async function updateMetadata(
  conn: S3Connection,
  bucket: string,
  key: string,
  update: MetadataUpdate,
): Promise<S3ObjectDetail> {
  const current = await headObject(conn, bucket, key);

  try {
    await clientFor(conn).send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: key,
        // CopySource is `bucket/key` and must be URL-encoded, or keys with
        // spaces and `+` resolve to the wrong object.
        CopySource: `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
        MetadataDirective: 'REPLACE',
        Metadata: update.metadata,
        ContentType: update.contentType ?? current.contentType,
        CacheControl: update.cacheControl ?? current.cacheControl,
        ContentDisposition: update.contentDisposition ?? current.contentDisposition,
        ContentEncoding: update.contentEncoding ?? current.contentEncoding,
      }),
    );
  } catch (err) {
    rethrow(err, `Updating metadata for "${key}"`, conn);
  }

  return headObject(conn, bucket, key);
}

/* ------------------------------------------------------------------ */
/* Transfer                                                            */
/* ------------------------------------------------------------------ */

export interface UploadOptions {
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

/**
 * Uploads a local file. Uses the managed uploader so large files go up as a
 * multipart transfer with progress rather than one buffered PUT.
 */
export async function uploadFile(
  conn: S3Connection,
  bucket: string,
  key: string,
  filePath: string,
  options: UploadOptions = {},
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ key: string; size: number; etag?: string }> {
  const info = await stat(filePath);
  const finalKey = key.endsWith('/') || key === '' ? `${key}${basename(filePath)}` : key;

  try {
    const upload = new Upload({
      client: clientFor(conn),
      params: {
        Bucket: bucket,
        Key: finalKey,
        Body: createReadStream(filePath),
        ContentType: options.contentType || guessContentType(filePath),
        CacheControl: options.cacheControl,
        Metadata: options.metadata,
      },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
    });

    if (onProgress) {
      upload.on('httpUploadProgress', (p) => onProgress(p.loaded ?? 0, p.total ?? info.size));
    }

    const res = await upload.done();
    return { key: finalKey, size: info.size, etag: res.ETag?.replace(/"/g, '') };
  } catch (err) {
    return rethrow(err, `Uploading "${finalKey}"`, conn);
  }
}

/** Writes small inline content (from the editor) straight to a key. */
export async function putText(
  conn: S3Connection,
  bucket: string,
  key: string,
  content: string,
  contentType = 'text/plain',
): Promise<void> {
  try {
    await clientFor(conn).send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: content, ContentType: contentType }),
    );
  } catch (err) {
    rethrow(err, `Writing "${key}"`, conn);
  }
}

export async function downloadFile(
  conn: S3Connection,
  bucket: string,
  key: string,
  destPath: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ path: string; size: number }> {
  try {
    const res = await clientFor(conn).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const total = res.ContentLength ?? 0;
    const body = res.Body as Readable;

    let loaded = 0;
    if (onProgress) {
      body.on('data', (chunk: Buffer) => {
        loaded += chunk.length;
        onProgress(loaded, total);
      });
    }

    await pipeline(body, createWriteStream(destPath));
    return { path: destPath, size: total || loaded };
  } catch (err) {
    return rethrow(err, `Downloading "${key}"`, conn);
  }
}

/** Reads an object into memory for the preview pane. Capped to stay lightweight. */
export async function previewObject(
  conn: S3Connection,
  bucket: string,
  key: string,
  maxBytes = 1024 * 1024,
): Promise<{ text: string; truncated: boolean; binary: boolean }> {
  try {
    const res = await clientFor(conn).send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${maxBytes - 1}` }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as Readable) chunks.push(chunk as Buffer);
    const buf = Buffer.concat(chunks);

    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      return { text, truncated: buf.byteLength >= maxBytes, binary: false };
    } catch {
      return { text: buf.toString('base64'), truncated: buf.byteLength >= maxBytes, binary: true };
    }
  } catch (err) {
    return rethrow(err, `Previewing "${key}"`, conn);
  }
}

/* ------------------------------------------------------------------ */
/* Deletion                                                            */
/* ------------------------------------------------------------------ */

export async function deleteObject(
  conn: S3Connection,
  bucket: string,
  key: string,
): Promise<void> {
  try {
    await clientFor(conn).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    rethrow(err, `Deleting "${key}"`, conn);
  }
}

/** Batch delete. Returns per-key errors rather than failing the whole call. */
export async function deleteObjects(
  conn: S3Connection,
  bucket: string,
  keys: string[],
): Promise<{ deleted: string[]; errors: Array<{ key: string; message: string }> }> {
  const deleted: string[] = [];
  const errors: Array<{ key: string; message: string }> = [];

  // DeleteObjects caps at 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      const res = await clientFor(conn).send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: false },
        }),
      );
      for (const d of res.Deleted ?? []) if (d.Key) deleted.push(d.Key);
      for (const e of res.Errors ?? []) {
        errors.push({ key: e.Key ?? '?', message: e.Message ?? e.Code ?? 'unknown' });
      }
    } catch (err) {
      // Some gateways reject the batch API entirely; fall back to one at a time.
      for (const key of batch) {
        try {
          await deleteObject(conn, bucket, key);
          deleted.push(key);
        } catch (inner) {
          errors.push({ key, message: (inner as Error).message });
        }
      }
    }
  }

  return { deleted, errors };
}

/** Recursively deletes everything under a prefix (a "folder"). */
export async function deletePrefix(
  conn: S3Connection,
  bucket: string,
  prefix: string,
): Promise<{ deleted: string[]; errors: Array<{ key: string; message: string }> }> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const res = await clientFor(conn).send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        // No delimiter here — we want every key beneath the prefix, not one level.
        ContinuationToken: token,
      }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  if (keys.length === 0) return { deleted: [], errors: [] };
  return deleteObjects(conn, bucket, keys);
}

/* ------------------------------------------------------------------ */
/* Presigning                                                          */
/* ------------------------------------------------------------------ */

export async function presign(
  conn: S3Connection,
  bucket: string,
  key: string,
  operation: 'get' | 'put',
  expiresInSeconds = 3600,
): Promise<string> {
  try {
    const command =
      operation === 'get'
        ? new GetObjectCommand({ Bucket: bucket, Key: key })
        : new PutObjectCommand({ Bucket: bucket, Key: key });
    return await getSignedUrl(clientFor(conn), command, { expiresIn: expiresInSeconds });
  } catch (err) {
    return rethrow(err, `Signing URL for "${key}"`, conn);
  }
}

/* ------------------------------------------------------------------ */

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  xml: 'application/xml',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  zip: 'application/zip',
  gz: 'application/gzip',
  mp4: 'video/mp4',
  wasm: 'application/wasm',
};

function guessContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}
