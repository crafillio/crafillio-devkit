/** Public surface of @crafillio/core. The Electron shell talks only to this. */

export * from './types.js';
export * from './vars.js';

export { sendRest, closeRestAgents } from './protocols/rest.js';
export { invokeGrpc, describeGrpc, clearSchemaCache, type GrpcCall } from './protocols/grpc.js';
export { statusName } from './protocols/grpc-target.js';

export * as s3 from './protocols/s3.js';
export type { MetadataUpdate, UploadOptions } from './protocols/s3.js';

export * as collections from './store/collections.js';
export * as environments from './store/environments.js';
export * as connections from './store/connections.js';
export * as history from './store/history.js';
export * as settings from './store/settings.js';

export { PATHS, CRAFILLIO_HOME, ensureHome } from './store/paths.js';
export {
  registerSecretProvider,
  setPreferredSecretBackend,
  preferredSecretBackend,
  secretsAvailable,
  type SecretProvider,
  type SecretBackend,
} from './store/secrets.js';
export { createKeyfileProvider, verifyProvider } from './store/keyfile.js';
export type { SavedConnection } from './store/connections.js';
export type { Settings } from './store/settings.js';

export { createUnaryInvoker } from './protocols/grpc.js';

export * as perf from './perf/runner.js';
export { DEFAULT_PROFILE } from './perf/types.js';
export type {
  LoadProfile,
  LoadTarget,
  LoadProgress,
  LoadReport,
  LatencyStats,
  TimeBucket,
} from './perf/types.js';

export * as workflows from './store/workflows.js';
export { runWorkflow, orderSteps, type WorkflowRun } from './workflow/engine.js';
export { renderReport } from './workflow/report.js';
export { getPath, suggestPaths, stringifyValue } from './workflow/extract.js';
export type {
  Workflow,
  WorkflowStep,
  WorkflowEdge,
  WorkflowEvent,
  StepInput,
  StepOutput,
  StepRecord,
  StepStatus,
  InputSource,
  RunResult,
} from './workflow/types.js';

export { importCurl, exportCurl } from './interop/curl.js';
export { importPostmanCollection } from './interop/postman.js';
export type { PostmanImportResult } from './interop/postman.js';
