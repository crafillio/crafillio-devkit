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

/**
 * Re-runs a step until its answer settles.
 *
 * Long-running work is usually exposed as a status endpoint that returns
 * "queued", then "running", then "completed" — polling it is not an edge case
 * but the normal way to consume that kind of API. The step's outputs are
 * republished after every attempt, so `until` reads the newest response.
 */
export interface StepRepeat {
  /**
   * Keep going until this holds, e.g. `{{status}} == "completed"`.
   * Evaluated after each attempt, once the step's outputs are published.
   */
  until: string;
  /**
   * Wait this long before the very first call.
   *
   * Work kicked off by the previous step is rarely ready immediately, so
   * polling straight away just burns an attempt on a certain "queued".
   */
  initialDelayMs?: number;
  /** Wait between attempts, in milliseconds. */
  intervalMs: number;
  /** Give up after this many attempts. */
  maxAttempts: number;
  /**
   * Give up after this long overall, whichever comes first. Guards against a
   * slow endpoint turning `maxAttempts × intervalMs` into a much longer wait.
   */
  timeoutMs?: number;
  /**
   * Stop early and fail when this holds, e.g. `{{status}} == "failed"`.
   * Without it, a job that has permanently failed is polled until the attempts
   * run out.
   */
  failIf?: string;
  /**
   * Multiplies the interval after each attempt. 1 (or absent) polls at a fixed
   * rate; 2 backs off exponentially.
   */
  backoff?: number;
  /**
   * Treat a failed attempt as "not settled yet" and retry, instead of failing
   * the step. For a status endpoint that occasionally 503s, this is what you
   * want; for one that should always answer, it hides a real problem.
   */
  retryOnError?: boolean;
}

/** Everything a step carries regardless of which protocol it speaks. */
interface WorkflowStepBase {
  id: string;
  name: string;
  inputs: StepInput[];
  outputs: StepOutput[];
  /** Keep going when this step fails, rather than stopping the run. */
  continueOnError: boolean;
  /** Skip the step unless this expression holds, e.g. "{{userId}}". */
  runIf?: string;
  /** Poll this step until a condition is met. Absent means run it once. */
  repeat?: StepRepeat;
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
  /**
   * How many times the step ran. Absent or 1 for an ordinary step; higher when
   * it polled. The request/response above are the final attempt's.
   */
  attempts?: number;
  /**
   * One line per polling attempt, so a run that waited four minutes shows what
   * it was seeing the whole time rather than only how it ended.
   */
  pollLog?: Array<{
    attempt: number;
    /** Milliseconds from the start of the step. */
    elapsedMs: number;
    /** The step's outputs at that attempt, as `name=value` pairs. */
    summary: string;
    /** Whether `until` held on this attempt. */
    settled: boolean;
    /** Present when the attempt itself failed and was retried. */
    error?: string;
  }>;
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
