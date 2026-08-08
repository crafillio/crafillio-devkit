import type { GrpcRequest, RestRequest } from '../types.js';

/** What the load generator hits. */
export type LoadTarget =
  | { protocol: 'rest'; request: RestRequest }
  /** gRPC load testing covers unary methods; streaming has no comparable RPS. */
  | { protocol: 'grpc'; request: GrpcRequest };

export interface LoadProfile {
  /** Virtual users firing requests concurrently. */
  concurrency: number;
  /** Stop after a wall-clock duration, or after a fixed number of requests. */
  mode: 'duration' | 'iterations';
  durationSeconds: number;
  iterations: number;
  /**
   * Seconds spent ramping concurrency from 1 to `concurrency`. 0 starts every
   * virtual user at once, which is useful for spike tests but unrealistic for
   * capacity planning.
   */
  rampUpSeconds: number;
  /**
   * Optional ceiling on requests per second across all virtual users. 0 means
   * unthrottled — go as fast as the target allows.
   */
  targetRps: number;
  /** Per-request timeout; a request exceeding it counts as an error. */
  timeoutMs: number;
  /** Abort the run early if the error rate exceeds this percentage. 0 disables. */
  abortOnErrorRate: number;
}

export const DEFAULT_PROFILE: LoadProfile = {
  concurrency: 10,
  mode: 'duration',
  durationSeconds: 30,
  iterations: 1000,
  rampUpSeconds: 5,
  targetRps: 0,
  timeoutMs: 10_000,
  abortOnErrorRate: 0,
};

export interface LatencyStats {
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

/** One second of the run, for the live chart. */
export interface TimeBucket {
  /** Seconds since the run started. */
  second: number;
  requests: number;
  errors: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
}

export interface LoadProgress {
  runId: string;
  elapsedMs: number;
  /** 0–1, or null when the run is unbounded. */
  fraction: number | null;
  completed: number;
  errors: number;
  currentRps: number;
  activeWorkers: number;
  latency: LatencyStats;
  buckets: TimeBucket[];
}

export interface LoadReport {
  runId: string;
  target: 'rest' | 'grpc';
  label: string;
  startedAt: string;
  durationMs: number;

  total: number;
  successful: number;
  failed: number;
  /** Percentage, 0–100. */
  errorRate: number;

  /** Achieved throughput over the whole run. */
  requestsPerSecond: number;
  latency: LatencyStats;

  /** Bytes received across all responses (REST only; 0 for gRPC). */
  bytesReceived: number;
  throughputBytesPerSecond: number;

  /** HTTP status code (or gRPC status name) → count. */
  statusCounts: Record<string, number>;
  /** Error message → count, most frequent first. */
  errorCounts: Record<string, number>;

  buckets: TimeBucket[];
  profile: LoadProfile;
  /** Set when the run stopped early. */
  abortedReason?: string;
}
