/**
 * Shared types for every API Devkit protocol engine and the storage layer.
 *
 * These are deliberately plain data — they cross the IPC boundary as JSON, so
 * nothing here may hold a class instance, a stream, or a Buffer.
 */

export type Protocol = 'rest' | 'grpc' | 's3';

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export type Auth =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | { kind: 'basic'; username: string; password: string }
  | { kind: 'apiKey'; key: string; value: string; in: 'header' | 'query' };

/* ------------------------------------------------------------------ */
/* REST                                                                */
/* ------------------------------------------------------------------ */

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/** A header/query/form row. Disabled rows are kept so the UI can toggle them. */
export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export type RestBody =
  | { kind: 'none' }
  | { kind: 'json'; text: string }
  | { kind: 'text'; text: string; contentType: string }
  | { kind: 'form'; fields: KeyValue[] }
  /** `filePath` entries are read from disk at send time. */
  | { kind: 'multipart'; fields: MultipartField[] }
  | { kind: 'binary'; filePath: string };

export interface MultipartField {
  id: string;
  key: string;
  enabled: boolean;
  /** `text` sends the literal value; `file` reads `filePath` from disk. */
  type: 'text' | 'file';
  value: string;
  filePath?: string;
}

export interface RestRequest {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  query: KeyValue[];
  body: RestBody;
  auth: Auth;
  /** Milliseconds. 0 disables the timeout. */
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  /** Accept self-signed / mismatched certs. Off by default. */
  insecureTls: boolean;
}

export interface RestResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Base64 when the payload is not valid UTF-8 text. */
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  /** Bytes on the wire, decompressed. */
  size: number;
  timing: { totalMs: number; firstByteMs: number };
  redirects: string[];
}

/* ------------------------------------------------------------------ */
/* gRPC                                                                */
/* ------------------------------------------------------------------ */

export type GrpcCallType = 'unary' | 'server_stream' | 'client_stream' | 'bidi';

export interface GrpcMethodDescriptor {
  name: string;
  /** Fully qualified: `pkg.Service/Method`. */
  path: string;
  callType: GrpcCallType;
  inputType: string;
  outputType: string;
  /** A JSON skeleton of the request message, for prefilling the editor. */
  inputExample: string;
}

export interface GrpcServiceDescriptor {
  name: string;
  methods: GrpcMethodDescriptor[];
}

/** Where the service definitions come from. */
export type GrpcSource =
  | { kind: 'reflection' }
  | { kind: 'proto'; files: string[]; includeDirs: string[] };

export interface GrpcTarget {
  /** `host:port`, no scheme. */
  address: string;
  tls: boolean;
  insecureTls: boolean;
  /** Overrides the TLS SNI / authority header. */
  serverNameOverride?: string;
}

export interface GrpcRequest {
  target: GrpcTarget;
  source: GrpcSource;
  service: string;
  method: string;
  /** JSON body. For client-streaming calls, one JSON document per message. */
  messages: string[];
  metadata: KeyValue[];
  timeoutMs: number;
}

/** Streamed back to the renderer over an IPC channel, one per event. */
export type GrpcEvent =
  | { type: 'metadata'; metadata: Record<string, string> }
  | { type: 'message'; index: number; json: string; atMs: number }
  | { type: 'trailers'; metadata: Record<string, string> }
  | { type: 'status'; code: number; codeName: string; details: string; totalMs: number }
  | { type: 'error'; message: string; code?: number; codeName?: string };

/* ------------------------------------------------------------------ */
/* S3                                                                  */
/* ------------------------------------------------------------------ */

export interface S3Connection {
  /** Blank for AWS proper; set for MinIO/R2/Ceph/etc. */
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** MinIO and most self-hosted gateways need this on. */
  forcePathStyle: boolean;
  insecureTls: boolean;
}

export interface S3Bucket {
  name: string;
  createdAt?: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
  storageClass?: string;
}

export interface S3ListResult {
  /** Synthetic folders derived from the `/` delimiter. */
  prefixes: string[];
  objects: S3Object[];
  continuationToken?: string;
  isTruncated: boolean;
}

export interface S3ObjectDetail {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  storageClass?: string;
  /** User-defined `x-amz-meta-*` pairs, without the prefix. */
  metadata: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Collections & environments                                          */
/* ------------------------------------------------------------------ */

export interface SavedRequest {
  id: string;
  name: string;
  protocol: Protocol;
  /** Parent folder id, or null when it sits at the collection root. */
  folderId: string | null;
  rest?: RestRequest;
  grpc?: GrpcRequest;
  s3?: S3RequestState;
  createdAt: string;
  updatedAt: string;
}

/** The S3 browser's persisted position — a saved "place", not a one-shot call. */
export interface S3RequestState {
  connectionId: string;
  bucket: string;
  prefix: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface Collection {
  id: string;
  name: string;
  folders: Folder[];
  requests: SavedRequest[];
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  name: string;
  /** Values flagged secret are stored via the OS keychain, not in plaintext. */
  variables: EnvVariable[];
}

export interface EnvVariable {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  secret: boolean;
}

export interface HistoryEntry {
  id: string;
  protocol: Protocol;
  label: string;
  at: string;
  status?: string;
  durationMs?: number;
}
