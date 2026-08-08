/**
 * Load generator for REST and gRPC.
 *
 * A pool of virtual users each loops "send, record, repeat" until the stop
 * condition. Latency is measured around the request only, so queueing inside
 * the generator never inflates the reported numbers.
 */

import { randomUUID } from 'node:crypto';
import { sendRest } from '../protocols/rest.js';
import { createUnaryInvoker } from '../protocols/grpc.js';
import { LatencyReservoir, EMPTY_STATS, percentile } from './stats.js';
import type {
  LoadProfile,
  LoadProgress,
  LoadReport,
  LoadTarget,
  TimeBucket,
} from './types.js';

export { DEFAULT_PROFILE } from './types.js';

interface BucketAccumulator {
  requests: number;
  errors: number;
  latencies: number[];
}

export interface LoadRun {
  runId: string;
  stop(): void;
  done: Promise<LoadReport>;
}

const PROGRESS_INTERVAL_MS = 500;

/** Caps how many samples one second's bucket keeps, so a fast run stays bounded. */
const BUCKET_SAMPLE_CAP = 10_000;

export function startLoadTest(
  target: LoadTarget,
  profile: LoadProfile,
  onProgress: (progress: LoadProgress) => void,
): LoadRun {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  const reservoir = new LatencyReservoir();
  const statusCounts: Record<string, number> = {};
  const errorCounts: Record<string, number> = {};
  const buckets = new Map<number, BucketAccumulator>();

  let completed = 0;
  let successful = 0;
  let failed = 0;
  let bytesReceived = 0;
  let activeWorkers = 0;
  let stopped = false;
  let abortedReason: string | undefined;

  const started = process.hrtime.bigint();
  const elapsedMs = (): number => Number(process.hrtime.bigint() - started) / 1e6;

  /* ---------------------------------------------------------------- */

  const record = (latencyMs: number, ok: boolean, status: string, bytes = 0): void => {
    completed += 1;
    if (ok) successful += 1;
    else failed += 1;
    bytesReceived += bytes;

    reservoir.add(latencyMs);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;

    const second = Math.floor(elapsedMs() / 1000);
    let bucket = buckets.get(second);
    if (!bucket) {
      bucket = { requests: 0, errors: 0, latencies: [] };
      buckets.set(second, bucket);
    }
    bucket.requests += 1;
    if (!ok) bucket.errors += 1;
    if (bucket.latencies.length < BUCKET_SAMPLE_CAP) bucket.latencies.push(latencyMs);
  };

  const recordError = (message: string): void => {
    // Collapse near-identical messages so the summary stays readable.
    const key = message.length > 120 ? `${message.slice(0, 120)}…` : message;
    errorCounts[key] = (errorCounts[key] ?? 0) + 1;
  };

  const snapshotBuckets = (): TimeBucket[] =>
    [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([second, bucket]) => {
        const sorted = [...bucket.latencies].sort((a, b) => a - b);
        const mean = sorted.length
          ? sorted.reduce((total, value) => total + value, 0) / sorted.length
          : 0;
        return {
          second,
          requests: bucket.requests,
          errors: bucket.errors,
          meanLatencyMs: Math.round(mean * 100) / 100,
          p95LatencyMs: Math.round(percentile(sorted, 0.95) * 100) / 100,
        };
      });

  /* ---------------------------------------------------------------- */

  const shouldContinue = (): boolean => {
    if (stopped) return false;
    if (profile.mode === 'duration') return elapsedMs() < profile.durationSeconds * 1000;
    return completed + activeWorkers <= profile.iterations;
  };

  /**
   * Throttle gate. With a target RPS we pace by comparing requests issued so
   * far against the ideal count for the elapsed time.
   */
  let issued = 0;
  const waitForRate = async (): Promise<void> => {
    if (profile.targetRps <= 0) return;
    for (;;) {
      const ideal = (elapsedMs() / 1000) * profile.targetRps;
      if (issued < ideal || stopped) return;
      const waitMs = Math.max(1, ((issued + 1 - ideal) / profile.targetRps) * 1000);
      await sleep(Math.min(waitMs, 50));
    }
  };

  /* ---------------------------------------------------------------- */

  const run = async (): Promise<LoadReport> => {
    let grpcInvoker: Awaited<ReturnType<typeof createUnaryInvoker>> | undefined;
    if (target.protocol === 'grpc') {
      // Built once, before the clock starts, so channel setup is excluded.
      grpcInvoker = await createUnaryInvoker({ ...target.request, timeoutMs: profile.timeoutMs });
    }

    const restRequest =
      target.protocol === 'rest'
        ? { ...target.request, timeoutMs: profile.timeoutMs }
        : undefined;

    const fireOne = async (): Promise<void> => {
      const requestStarted = process.hrtime.bigint();
      try {
        if (restRequest) {
          const response = await sendRest(restRequest);
          const latency = Number(process.hrtime.bigint() - requestStarted) / 1e6;
          // A 4xx/5xx is a real answer from the server, but for load testing it
          // is a failure — reporting it as success would hide a broken target.
          record(latency, response.ok, String(response.status), response.size);
          if (!response.ok) recordError(`HTTP ${response.status}`);
        } else {
          const result = await grpcInvoker!.invoke();
          const latency = Number(process.hrtime.bigint() - requestStarted) / 1e6;
          record(latency, true, result.statusName);
        }
      } catch (err) {
        const latency = Number(process.hrtime.bigint() - requestStarted) / 1e6;
        const error = err as Error & { statusName?: string };
        record(latency, false, error.statusName ?? 'ERROR');
        recordError(error.message);
      }
    };

    const worker = async (index: number): Promise<void> => {
      // Ramp-up: stagger each virtual user's start across the ramp window.
      if (profile.rampUpSeconds > 0 && profile.concurrency > 1) {
        const delay = (profile.rampUpSeconds * 1000 * index) / profile.concurrency;
        await sleep(delay);
      }
      if (stopped) return;

      activeWorkers += 1;
      try {
        while (shouldContinue()) {
          await waitForRate();
          if (!shouldContinue()) break;
          issued += 1;
          await fireOne();

          if (
            profile.abortOnErrorRate > 0 &&
            completed >= 20 &&
            (failed / completed) * 100 > profile.abortOnErrorRate
          ) {
            abortedReason = `Error rate exceeded ${profile.abortOnErrorRate}% — run stopped early.`;
            stopped = true;
            break;
          }
        }
      } finally {
        activeWorkers -= 1;
      }
    };

    const ticker = setInterval(() => {
      const total = elapsedMs();
      onProgress({
        runId,
        elapsedMs: total,
        fraction:
          profile.mode === 'duration'
            ? Math.min(1, total / (profile.durationSeconds * 1000))
            : Math.min(1, completed / Math.max(1, profile.iterations)),
        completed,
        errors: failed,
        currentRps: total > 0 ? completed / (total / 1000) : 0,
        activeWorkers,
        latency: reservoir.count ? reservoir.stats() : EMPTY_STATS,
        buckets: snapshotBuckets(),
      });
    }, PROGRESS_INTERVAL_MS);

    try {
      await Promise.all(
        Array.from({ length: Math.max(1, profile.concurrency) }, (_unused, i) => worker(i)),
      );
    } finally {
      clearInterval(ticker);
      grpcInvoker?.close();
    }

    const durationMs = elapsedMs();
    const sortedErrors = Object.fromEntries(
      Object.entries(errorCounts).sort(([, a], [, b]) => b - a),
    );

    return {
      runId,
      target: target.protocol,
      label:
        target.protocol === 'rest'
          ? `${target.request.method} ${target.request.url}`
          : `${target.request.service}/${target.request.method}`,
      startedAt,
      durationMs,
      total: completed,
      successful,
      failed,
      errorRate: completed ? Math.round((failed / completed) * 10000) / 100 : 0,
      requestsPerSecond: durationMs > 0 ? Math.round((completed / (durationMs / 1000)) * 100) / 100 : 0,
      latency: reservoir.count ? reservoir.stats() : EMPTY_STATS,
      bytesReceived,
      throughputBytesPerSecond:
        durationMs > 0 ? Math.round(bytesReceived / (durationMs / 1000)) : 0,
      statusCounts,
      errorCounts: sortedErrors,
      buckets: snapshotBuckets(),
      profile,
      abortedReason,
    };
  };

  return {
    runId,
    stop: () => {
      stopped = true;
    },
    done: run(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
