/**
 * The IPC contract.
 *
 * This is the only surface the renderer can reach. It is imported by the
 * preload (to build the bridge), by main (to type the handlers) and by the UI
 * (types only), so the three can never drift apart.
 */

import type {
  Collection,
  Environment,
  GrpcEvent,
  GrpcRequest,
  GrpcServiceDescriptor,
  GrpcSource,
  GrpcTarget,
  HistoryEntry,
  LoadProfile,
  LoadProgress,
  LoadReport,
  LoadTarget,
  Protocol,
  RestRequest,
  RestResponse,
  S3Bucket,
  S3Connection,
  S3ListResult,
  S3ObjectDetail,
  SavedConnection,
  SavedRequest,
  Settings,
  Workflow,
  WorkflowEvent,
  RunResult,
} from '@crafillio/core';

export interface EnvFile {
  environments: Environment[];
  activeId: string | null;
}

export interface PickedFile {
  path: string;
  name: string;
  size: number;
}

/** Everything exposed on `window.crafillio`. */
export interface CrafillioApi {
  rest: {
    send(request: RestRequest): Promise<RestResponse>;
  };

  grpc: {
    describe(
      source: GrpcSource,
      target: GrpcTarget,
      refresh?: boolean,
    ): Promise<GrpcServiceDescriptor[]>;
    /** Resolves with the call id; events arrive via `onEvent`. */
    invoke(request: GrpcRequest): Promise<string>;
    cancel(callId: string): Promise<void>;
    onEvent(listener: (callId: string, event: GrpcEvent) => void): () => void;
  };

  s3: {
    listBuckets(conn: S3Connection): Promise<S3Bucket[]>;
    createBucket(conn: S3Connection, bucket: string): Promise<void>;
    deleteBucket(conn: S3Connection, bucket: string): Promise<void>;
    listObjects(
      conn: S3Connection,
      bucket: string,
      prefix: string,
      token?: string,
    ): Promise<S3ListResult>;
    head(conn: S3Connection, bucket: string, key: string): Promise<S3ObjectDetail>;
    updateMetadata(
      conn: S3Connection,
      bucket: string,
      key: string,
      update: {
        metadata: Record<string, string>;
        contentType?: string;
        cacheControl?: string;
        contentDisposition?: string;
        contentEncoding?: string;
      },
    ): Promise<S3ObjectDetail>;
    upload(
      conn: S3Connection,
      bucket: string,
      key: string,
      filePath: string,
      options?: { contentType?: string; cacheControl?: string; metadata?: Record<string, string> },
    ): Promise<{ key: string; size: number; etag?: string }>;
    putText(
      conn: S3Connection,
      bucket: string,
      key: string,
      content: string,
      contentType?: string,
    ): Promise<void>;
    download(
      conn: S3Connection,
      bucket: string,
      key: string,
    ): Promise<{ path: string; size: number } | null>;
    preview(
      conn: S3Connection,
      bucket: string,
      key: string,
    ): Promise<{ text: string; truncated: boolean; binary: boolean }>;
    deleteObject(conn: S3Connection, bucket: string, key: string): Promise<void>;
    deleteObjects(
      conn: S3Connection,
      bucket: string,
      keys: string[],
    ): Promise<{ deleted: string[]; errors: Array<{ key: string; message: string }> }>;
    deletePrefix(
      conn: S3Connection,
      bucket: string,
      prefix: string,
    ): Promise<{ deleted: string[]; errors: Array<{ key: string; message: string }> }>;
    presign(
      conn: S3Connection,
      bucket: string,
      key: string,
      operation: 'get' | 'put',
      expiresInSeconds: number,
    ): Promise<string>;
    /** Progress for the active upload/download, keyed by an operation id. */
    onProgress(listener: (id: string, loaded: number, total: number) => void): () => void;
  };

  connections: {
    list(): Promise<SavedConnection[]>;
    save(conn: Omit<SavedConnection, 'id'> & { id?: string }): Promise<SavedConnection[]>;
    remove(id: string): Promise<SavedConnection[]>;
  };

  collections: {
    list(): Promise<Collection[]>;
    create(name: string): Promise<Collection>;
    rename(id: string, name: string): Promise<Collection>;
    remove(id: string): Promise<void>;
    saveRequest(collectionId: string, request: SavedRequest): Promise<Collection>;
    removeRequest(collectionId: string, requestId: string): Promise<Collection>;
    createFolder(collectionId: string, name: string, parentId: string | null): Promise<Collection>;
    removeFolder(collectionId: string, folderId: string): Promise<Collection>;
    moveRequest(
      collectionId: string,
      requestId: string,
      folderId: string | null,
    ): Promise<Collection>;
    exportToFile(collectionId: string): Promise<string | null>;
    importFromFile(): Promise<Collection | null>;
  };

  environments: {
    load(): Promise<EnvFile>;
    save(file: EnvFile): Promise<EnvFile>;
    create(name: string): Promise<EnvFile>;
    remove(id: string): Promise<EnvFile>;
    setActive(id: string | null): Promise<EnvFile>;
    /** Resolved variables of the active environment. */
    active(): Promise<Record<string, string>>;
  };

  history: {
    list(): Promise<HistoryEntry[]>;
    record(entry: {
      protocol: Protocol;
      label: string;
      status?: string;
      durationMs?: number;
    }): Promise<HistoryEntry[]>;
    clear(): Promise<HistoryEntry[]>;
  };

  settings: {
    load(): Promise<Settings>;
    save(patch: Partial<Settings>): Promise<Settings>;
  };

  /** Load testing for REST and unary gRPC. */
  perf: {
    /** Resolves with the run id; progress arrives via `onProgress`. */
    start(target: LoadTarget, profile: LoadProfile): Promise<string>;
    stop(runId: string): Promise<void>;
    onProgress(listener: (progress: LoadProgress) => void): () => void;
    onComplete(listener: (report: LoadReport) => void): () => void;
    /** Writes a finished run to CSV for sharing or archiving. */
    exportReport(report: LoadReport): Promise<string | null>;
  };

  /** Chained multi-step API workflows. */
  workflow: {
    list(): Promise<Workflow[]>;
    create(name: string): Promise<Workflow>;
    save(workflow: Workflow): Promise<Workflow>;
    remove(id: string): Promise<void>;
    /** Resolves with the run id; stage events arrive via `onEvent`. */
    run(workflow: Workflow): Promise<string>;
    cancel(runId: string): Promise<void>;
    onEvent(listener: (event: WorkflowEvent) => void): () => void;
    /** Writes the HTML report and returns its path. Null when cancelled. */
    exportReport(result: RunResult, workflow?: Workflow): Promise<string | null>;
    /** Renders the report to PDF via the print engine. Null when cancelled. */
    exportPdf(result: RunResult, workflow?: Workflow): Promise<string | null>;
    /** Opens a finished report in the system browser. */
    openReport(result: RunResult, workflow?: Workflow): Promise<string>;
  };

  /** Import and export in formats other tools speak. */
  interop: {
    importCurl(command: string): Promise<RestRequest>;
    exportCurl(request: RestRequest): Promise<string>;
    /** Opens a file picker for a Postman v2.1 export. Null when cancelled. */
    importPostman(): Promise<{ collection: Collection; requestCount: number; skipped: string[] } | null>;
  };

  dialog: {
    /** Returns [] when the user cancels. */
    openFiles(options?: {
      filters?: Array<{ name: string; extensions: string[] }>;
      multiple?: boolean;
    }): Promise<PickedFile[]>;
    openDirectory(): Promise<string | null>;
    saveFile(defaultName: string): Promise<string | null>;
    /** Prompts for a location and writes `content` there. Null when cancelled. */
    saveTextFile(defaultName: string, content: string): Promise<string | null>;
  };

  app: {
    version(): Promise<string>;
    /** Absolute path of the data directory, for the "your data lives here" note. */
    dataDirectory(): Promise<string>;
    revealDataDirectory(): Promise<void>;
    secretsAvailable(): Promise<boolean>;
    /** Which backend encrypts secret values right now. */
    secretBackend(): Promise<'keyfile' | 'os'>;
    /** Switches backend and re-wires encryption. Returns the effective backend. */
    setSecretBackend(backend: 'keyfile' | 'os'): Promise<'keyfile' | 'os'>;
    /** Opens a URL in the system browser. Only https: and mailto: are allowed. */
    openExternal(url: string): Promise<void>;
  };
}

declare global {
  interface Window {
    crafillio: CrafillioApi;
  }
}
