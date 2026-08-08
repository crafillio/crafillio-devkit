import type { LatencyStats } from './types.js';

export const EMPTY_STATS: LatencyStats = {
  min: 0,
  max: 0,
  mean: 0,
  stdDev: 0,
  p50: 0,
  p75: 0,
  p90: 0,
  p95: 0,
  p99: 0,
};

/**
 * Collects latencies and computes percentiles.
 *
 * A long run can produce millions of samples, so once the reservoir is full we
 * switch to reservoir sampling (Vitter's Algorithm R). That keeps memory flat
 * while leaving the percentile estimates statistically sound, rather than
 * either exhausting memory or silently dropping the tail — which is exactly
 * where the interesting latency lives.
 */
export class LatencyReservoir {
  private samples: number[] = [];
  private seen = 0;
  private sum = 0;
  private sumSquares = 0;
  private minimum = Number.POSITIVE_INFINITY;
  private maximum = 0;

  constructor(private readonly capacity = 200_000) {}

  add(ms: number): void {
    this.seen += 1;
    this.sum += ms;
    this.sumSquares += ms * ms;
    if (ms < this.minimum) this.minimum = ms;
    if (ms > this.maximum) this.maximum = ms;

    if (this.samples.length < this.capacity) {
      this.samples.push(ms);
      return;
    }
    // Each later sample replaces a random existing one with probability
    // capacity/seen, which keeps the reservoir uniformly representative.
    const index = Math.floor(Math.random() * this.seen);
    if (index < this.capacity) this.samples[index] = ms;
  }

  get count(): number {
    return this.seen;
  }

  stats(): LatencyStats {
    if (this.seen === 0) return EMPTY_STATS;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const mean = this.sum / this.seen;
    const variance = Math.max(0, this.sumSquares / this.seen - mean * mean);

    return {
      min: round(this.minimum),
      max: round(this.maximum),
      mean: round(mean),
      stdDev: round(Math.sqrt(variance)),
      p50: round(percentile(sorted, 0.5)),
      p75: round(percentile(sorted, 0.75)),
      p90: round(percentile(sorted, 0.9)),
      p95: round(percentile(sorted, 0.95)),
      p99: round(percentile(sorted, 0.99)),
    };
  }
}

/** Nearest-rank percentile over an ascending array. */
export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index]!;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
