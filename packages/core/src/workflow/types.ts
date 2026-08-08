import type { GrpcRequest, RestRequest, RestResponse } from '../types.js';

/**
 * A workflow chains requests together: each step can pull values out of an
 * earlier step's response (or a file, or a literal) and feed them into its own
 * URL, headers or body.
 */

/** Where a step's input value comes from. */
export type InputSource =
  /** A path into an earlier step's parsed JSON response body. */
  | { from: 'body'; stepId: string; path: string }
  /** A response header from an earlier step. */
  | { from: 'header'; stepId: string; header: string }
  /** An earlier step's HTTP status code. */
  | { from: 'status'; stepId: string }
  /** The whole response body of an earlier step, as text. */
  | { from: 'rawBody'; stepId: string }
  /** A fixed value typed into the workflow. */
  | { from: 'literal'; value: string }
  /** Contents of a local file, read at run time. */
  | { from: 'file'; path: string; as: 'text' | 'base64' };

export interface StepInput {
  id: string;
  /** Referenced inside this step as {{name}}. */
  name: string;
  source: InputSource;
  /** Used when the source resolves to nothing, instead of failing the step. */
  fallback?: string;
}

/** A value lifted out of this step's response for later steps to read. */
export interface StepOutput {
  id: string;
  name: string;
  /** Path into the JSON response body. Empty means the whole body. */
  path: string;
}

/** Everything a step carries regardless of which protocol it speaks. */
interface WorkflowStepBase {
  id: string;
  name: string;
  inputs: StepInput[];
  outputs: StepOutput[];
  /** Keep going when this step fails, rather than stopping the run. */
  continueOnError: boolean;
  /** Skip the step unless this expression is truthy, e.g. "{{userId}}". */
  runIf?: string;
  /** Canvas position. Absent for workflows built before the visual editor. */
  position?: { x: number; y: number };
}

export interface RestStep extends WorkflowStepBase {
  kind: 'rest';
  request: RestRequest;
}

/**
 * A gRPC step. Unary only: a workflow passes one response to the next step,
 * which a stream has no single answer for.
 */
export interface GrpcStep extends WorkflowStepBase {
  kind: 'grpc';
  grpc: GrpcRequest;
}

/** REST and gRPC steps mix freely in one workflow. */
export type WorkflowStep = RestStep | GrpcStep;

/** A connection drawn on the canvas: `from` runs before `to`. */
export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  /** Connections between steps. When empty, steps run in array order. */
  edges?: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

/** Everything observed about one step — enough to debug it after the fact. */
export interface StepRecord {
  stepId: string;
  name: string;
  index: number;
  /** Which protocol this step spoke, so the UI and report can label it. */
  protocol: 'rest' | 'grpc';
  status: StepStatus;
  startedAt: string;
  durationMs: number;

  /** Inputs after resolution, so you can see what actually went in. */
  resolvedInputs: Array<{ name: string; value: string; source: string; truncated: boolean }>;
  /** The request as sent, with variables already substituted. */
  request?: {
    /** HTTP verb, or the gRPC call type. */
    method: string;
    /** URL, or `host service/method` for gRPC. */
    url: string;
    /** Headers, or gRPC metadata. */
    headers: Array<[string, string]>;
    body?: string;
    bodyKind: string;
  };
  response?: {
    /** HTTP status, or the gRPC status code (0 is OK). */
    status: number;
    /** For gRPC, the status name such as OK or PERMISSION_DENIED. */
    statusLabel?: string;
    ok: boolean;
    headers: Array<[string, string]>;
    body: string;
    bodyEncoding: 'utf8' | 'base64';
    size: number;
    timingMs: number;
  };
  /** Values published to later steps. */
  extractedOutputs: Array<{ name: string; value: string; truncated: boolean }>;
  error?: string;
  /** Binary or file-like results offered as downloads in the report. */
  artifacts: Array<{ name: string; contentType: string; base64: string; size: number }>;
}

export interface RunResult {
  runId: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  durationMs: number;
  status: 'success' | 'failed' | 'partial';
  steps: StepRecord[];
  /** Final variable context, for the report's summary. */
  context: Record<string, string>;
}

/** Streamed to the UI so a run can be watched stage by stage. */
export type WorkflowEvent =
  | { type: 'run-start'; runId: string; totalSteps: number }
  | { type: 'step-start'; runId: string; stepId: string; index: number }
  | { type: 'step-finish'; runId: string; record: StepRecord }
  | { type: 'run-finish'; runId: string; result: RunResult };
