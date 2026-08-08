/**
 * A stand-in for the Electron preload bridge, used only when the renderer runs
 * in a plain browser (`VITE_CRAFILLIO_MOCK=1 npm run dev`).
 *
 * It exists so the UI can be developed and visually reviewed without launching
 * Electron. It is never bundled into the production build — `main.tsx` guards
 * the import behind the env flag, so Rollup drops it.
 */

import type { CrafillioApi } from '@crafillio/desktop/src/api';
import type {
  Collection,
  LoadProgress,
  LoadReport,
  Settings,
  RestResponse,
  S3ListResult,
  S3ObjectDetail,
  SavedConnection,
} from '@crafillio/core';

const now = new Date().toISOString();

const sampleCollection: Collection = {
  id: 'c1',
  name: 'Payments API',
  folders: [],
  createdAt: now,
  updatedAt: now,
  requests: [
    {
      id: 'r1',
      name: 'List charges',
      protocol: 'rest',
      folderId: null,
      createdAt: now,
      updatedAt: now,
      rest: {
        method: 'GET',
        url: '{{baseUrl}}/v1/charges',
        headers: [{ id: 'h1', key: 'Accept', value: 'application/json', enabled: true }],
        query: [{ id: 'q1', key: 'limit', value: '10', enabled: true }],
        body: { kind: 'none' },
        auth: { kind: 'bearer', token: '{{apiKey}}' },
        timeoutMs: 30_000,
        followRedirects: true,
        maxRedirects: 5,
        insecureTls: false,
      },
    },
    {
      id: 'r2',
      name: 'Create charge',
      protocol: 'rest',
      folderId: null,
      createdAt: now,
      updatedAt: now,
      rest: {
        method: 'POST',
        url: '{{baseUrl}}/v1/charges',
        headers: [],
        query: [],
        body: { kind: 'json', text: '{\n  "amount": 2500,\n  "currency": "gbp"\n}' },
        auth: { kind: 'bearer', token: '{{apiKey}}' },
        timeoutMs: 30_000,
        followRedirects: true,
        maxRedirects: 5,
        insecureTls: false,
      },
    },
    {
      id: 'r3',
      name: 'Greeter.SayHello',
      protocol: 'grpc',
      folderId: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
};

const sampleConnection: SavedConnection = {
  id: 'conn1',
  name: 'Local MinIO',
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  forcePathStyle: true,
  insecureTls: false,
};

const sampleResponse: RestResponse = {
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-request-id': 'req_8fA2kQ',
  },
  body: JSON.stringify(
    {
      object: 'list',
      has_more: false,
      data: [
        { id: 'ch_3PqA1', amount: 2500, currency: 'gbp', status: 'succeeded', paid: true },
        { id: 'ch_3PqA2', amount: 1200, currency: 'gbp', status: 'pending', paid: false },
      ],
    },
    null,
    2,
  ),
  bodyEncoding: 'utf8',
  size: 284,
  timing: { totalMs: 142.7, firstByteMs: 118.2 },
  redirects: [],
};

const sampleListing: S3ListResult = {
  prefixes: ['invoices/', 'avatars/'],
  objects: [
    { key: 'report-2026-q1.pdf', size: 248_113, lastModified: now, etag: 'a1b2c3' },
    { key: 'export.csv', size: 15_402, lastModified: now, etag: 'd4e5f6' },
    { key: 'logo.png', size: 8_211, lastModified: now, etag: '778899' },
  ],
  isTruncated: false,
};

const sampleDetail: S3ObjectDetail = {
  key: 'report-2026-q1.pdf',
  size: 248_113,
  lastModified: now,
  etag: 'a1b2c3',
  contentType: 'application/pdf',
  cacheControl: 'max-age=3600',
  storageClass: 'STANDARD',
  metadata: { owner: 'finance', reviewed: 'yes' },
};

const notImplemented = async (): Promise<never> => {
  throw new Error('Not available in browser preview — run the desktop app.');
};

export function installMockBridge(): void {
  const api: CrafillioApi = {
    rest: { send: async () => sampleResponse },

    grpc: {
      describe: async () => [
        {
          name: 'demo.v1.Greeter',
          methods: [
            {
              name: 'SayHello',
              path: '/demo.v1.Greeter/SayHello',
              callType: 'unary',
              inputType: 'demo.v1.HelloRequest',
              outputType: 'demo.v1.HelloReply',
              inputExample: '{\n  "name": ""\n}',
            },
            {
              name: 'Countdown',
              path: '/demo.v1.Greeter/Countdown',
              callType: 'server_stream',
              inputType: 'demo.v1.HelloRequest',
              outputType: 'demo.v1.HelloReply',
              inputExample: '{\n  "name": "",\n  "times": 0\n}',
            },
          ],
        },
      ],
      invoke: async () => 'call1',
      cancel: async () => {},
      onEvent: () => () => {},
    },

    s3: {
      listBuckets: async () => [
        { name: 'crafillio-demo', createdAt: now },
        { name: 'media-assets', createdAt: now },
      ],
      createBucket: notImplemented,
      deleteBucket: notImplemented,
      listObjects: async () => sampleListing,
      head: async () => sampleDetail,
      updateMetadata: async () => sampleDetail,
      upload: notImplemented,
      putText: notImplemented,
      download: notImplemented,
      preview: async () => ({ text: 'preview', truncated: false, binary: false }),
      deleteObject: notImplemented,
      deleteObjects: notImplemented,
      deletePrefix: notImplemented,
      presign: async () => 'https://example.invalid/signed',
      onProgress: () => () => {},
    },

    connections: {
      list: async () => [sampleConnection],
      save: async () => [sampleConnection],
      remove: async () => [],
    },

    collections: {
      list: async () => [sampleCollection],
      create: async () => sampleCollection,
      rename: async () => sampleCollection,
      remove: async () => {},
      saveRequest: async () => sampleCollection,
      removeRequest: async () => sampleCollection,
      createFolder: async () => sampleCollection,
      removeFolder: async () => sampleCollection,
      moveRequest: async () => sampleCollection,
      exportToFile: async () => null,
      importFromFile: async () => null,
    },

    environments: {
      load: async () => ({
        activeId: 'e1',
        environments: [
          {
            id: 'e1',
            name: 'Staging',
            variables: [
              {
                id: 'v1',
                key: 'baseUrl',
                value: 'https://api.staging.example.com',
                enabled: true,
                secret: false,
              },
              { id: 'v2', key: 'apiKey', value: 'sk_test_123', enabled: true, secret: true },
            ],
          },
          { id: 'e2', name: 'Production', variables: [] },
        ],
      }),
      save: async (file) => file,
      create: async () => ({ activeId: 'e1', environments: [] }),
      remove: async () => ({ activeId: null, environments: [] }),
      setActive: async () => ({ activeId: 'e1', environments: [] }),
      active: async () => ({ baseUrl: 'https://api.staging.example.com', apiKey: 'sk_test_123' }),
    },

    history: {
      list: async () => [
        { id: 'h1', protocol: 'rest', label: 'GET /v1/charges', at: now, status: '200' },
        { id: 'h2', protocol: 'grpc', label: 'Greeter/SayHello', at: now, status: 'OK' },
      ],
      record: async () => [],
      clear: async () => [],
    },

    settings: (() => {
      // Stateful so the preview persists a theme switch the way the real app
      // does; a fixed `load()` would immediately revert every change.
      let current: Settings = {
        theme: 'dark',
        defaultTimeoutMs: 30_000,
        wrapResponses: true,
        fontSize: 13,
        keepHistory: true,
        secretStorage: 'keyfile',
        locale: 'en',
        proxy: {
          enabled: false, protocol: 'http', host: '', port: 8080,
          forHttp: true, forHttps: true,
          auth: { enabled: false, username: '', password: '' },
          bypass: ['localhost', '127.0.0.1', '::1'],
        },
        tls: { verify: true, caPath: '', certificates: [] },
      };
      return {
        load: async () => current,
        save: async (patch: Partial<Settings>) => {
          current = { ...current, ...patch };
          return current;
        },
      };
    })(),

    perf: (() => {
      // Simulates a run so the load-test UI can be reviewed in the browser.
      const progressListeners = new Set<(p: LoadProgress) => void>();
      const completeListeners = new Set<(r: LoadReport) => void>();

      const buckets = Array.from({ length: 18 }, (_unused, second) => {
        const ramp = Math.min(1, (second + 1) / 6);
        const requests = Math.round(120 * ramp + Math.sin(second) * 12);
        return {
          second,
          requests,
          errors: second > 12 ? Math.round((second - 12) * 1.6) : 0,
          meanLatencyMs: 24 + second * 1.4 + Math.sin(second * 1.7) * 4,
          p95LatencyMs: 48 + second * 3.1 + Math.cos(second) * 8,
        };
      });
      const latency = { min: 11.2, max: 412.8, mean: 38.6, stdDev: 22.4,
        p50: 31.5, p75: 44.2, p90: 68.9, p95: 96.4, p99: 214.7 };

      return {
        start: async () => {
          const runId = 'preview-run';
          setTimeout(() => {
            for (const listener of completeListeners) {
              listener({
                runId, target: 'rest', label: 'GET https://api.example.com/v1/charges',
                startedAt: now, durationMs: 18_000,
                total: 1984, successful: 1951, failed: 33, errorRate: 1.66,
                requestsPerSecond: 110.2, latency,
                bytesReceived: 1_284_112, throughputBytesPerSecond: 71_339,
                statusCounts: { '200': 1951, '503': 33 },
                errorCounts: { 'HTTP 503': 33 },
                buckets, profile: {
                  concurrency: 10, mode: 'duration', durationSeconds: 18, iterations: 1000,
                  rampUpSeconds: 5, targetRps: 0, timeoutMs: 10_000, abortOnErrorRate: 0,
                },
              });
            }
          }, 150);
          return runId;
        },
        stop: async () => {},
        onProgress: (listener: (p: LoadProgress) => void) => {
          progressListeners.add(listener);
          return () => progressListeners.delete(listener);
        },
        onComplete: (listener: (r: LoadReport) => void) => {
          completeListeners.add(listener);
          return () => completeListeners.delete(listener);
        },
        exportReport: async () => '/tmp/report.csv',
      };
    })(),

    workflow: {
      list: async () => [],
      create: notImplemented,
      save: async (w) => w,
      remove: async () => {},
      export: async () => null,
      import: async () => null,
      checkCondition: async () => null,
      run: notImplemented,
      cancel: async () => {},
      onEvent: () => () => {},
      exportReport: async () => null,
      exportPdf: async () => null,
      openReport: async () => '/tmp/report.html',
    },

    interop: {
      importCurl: notImplemented,
      exportCurl: async () => "curl -X GET 'https://api.example.com'",
      importPostman: async () => null,
      importOpenApi: async () => null,
      importHoppscotch: async () => null,
      importBruno: async () => null,
    },

    dialog: {
      openFiles: async () => [],
      openDirectory: async () => null,
      saveFile: async () => null,
      saveTextFile: async () => null,
    },

    app: {
      version: async () => '0.1.0-preview',
      dataDirectory: async () => '~/.crafillio',
      revealDataDirectory: async () => {},
      secretsAvailable: async () => true,
      secretBackend: async () => 'keyfile' as const,
      setSecretBackend: async (b: 'keyfile' | 'os') => b,
      openExternal: async (url: string) => {
        console.info('[preview] would open externally:', url);
      },
    },
  };

  window.crafillio = api;
}
