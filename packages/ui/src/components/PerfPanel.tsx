import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Gauge, Loader2, Play, Square } from 'lucide-react';
import type { LoadProfile, LoadProgress, LoadReport, TimeBucket } from '@crafillio/core';
import { formatBytes, formatMs } from '../lib/format';
import { useStore, type GrpcTab, type RestTab } from '../state/store';

const DEFAULTS: LoadProfile = {
  concurrency: 10,
  mode: 'duration',
  durationSeconds: 30,
  iterations: 1000,
  rampUpSeconds: 5,
  targetRps: 0,
  timeoutMs: 10_000,
  abortOnErrorRate: 0,
};

interface Props {
  tab: RestTab | GrpcTab;
}

/**
 * Load testing for the request in the current tab. REST hits the URL as
 * configured; gRPC is limited to unary methods, since requests-per-second has
 * no meaning for a stream.
 */
export function PerfPanel({ tab }: Props) {
  const toast = useStore((s) => s.toast);
  const [profile, setProfile] = useState<LoadProfile>(DEFAULTS);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [report, setReport] = useState<LoadReport | null>(null);
  const [running, setRunning] = useState(false);
  const runId = useRef<string | null>(null);

  useEffect(() => {
    const offProgress = window.crafillio.perf.onProgress((update) => {
      if (update.runId === runId.current) setProgress(update);
    });
    const offComplete = window.crafillio.perf.onComplete((finished) => {
      if (finished.runId !== runId.current) return;
      setReport(finished);
      setRunning(false);
      runId.current = null;
      if (finished.abortedReason) toast('error', finished.abortedReason);
    });
    return () => {
      offProgress();
      offComplete();
    };
  }, [toast]);

  const set = <K extends keyof LoadProfile>(key: K, value: LoadProfile[K]): void =>
    setProfile((p) => ({ ...p, [key]: value }));

  const start = async (): Promise<void> => {
    setReport(null);
    setProgress(null);
    setRunning(true);
    try {
      const vars = await window.crafillio.environments.active();
      const target =
        tab.protocol === 'rest'
          ? { protocol: 'rest' as const, request: interpolate(tab.request, vars) }
          : { protocol: 'grpc' as const, request: interpolate(tab.request, vars) };

      runId.current = await window.crafillio.perf.start(target, profile);
    } catch (err) {
      setRunning(false);
      runId.current = null;
      toast('error', (err as Error).message);
    }
  };

  const stop = (): void => {
    if (runId.current) void window.crafillio.perf.stop(runId.current);
  };

  const ready =
    tab.protocol === 'rest' ? tab.request.url.trim().length > 0 : tab.request.method.length > 0;

  const buckets = report?.buckets ?? progress?.buckets ?? [];
  const latency = report?.latency ?? progress?.latency;

  return (
    <div className="pane">
      <div className="perf-toolbar">
        <div className="perf-field">
          <label>Mode</label>
          <select
            className="select"
            value={profile.mode}
            disabled={running}
            onChange={(e) => set('mode', e.target.value as LoadProfile['mode'])}
          >
            <option value="duration">For a duration</option>
            <option value="iterations">Fixed requests</option>
          </select>
        </div>

        {profile.mode === 'duration' ? (
          <div className="perf-field">
            <label>Duration (s)</label>
            <input
              className="input input-mono"
              type="number"
              min={1}
              value={profile.durationSeconds}
              disabled={running}
              onChange={(e) => set('durationSeconds', Math.max(1, Number(e.target.value)))}
            />
          </div>
        ) : (
          <div className="perf-field">
            <label>Requests</label>
            <input
              className="input input-mono"
              type="number"
              min={1}
              value={profile.iterations}
              disabled={running}
              onChange={(e) => set('iterations', Math.max(1, Number(e.target.value)))}
            />
          </div>
        )}

        <div className="perf-field">
          <label>Concurrency</label>
          <input
            className="input input-mono"
            type="number"
            min={1}
            max={1000}
            value={profile.concurrency}
            disabled={running}
            onChange={(e) => set('concurrency', Math.max(1, Number(e.target.value)))}
          />
        </div>

        <div className="perf-field">
          <label>Ramp-up (s)</label>
          <input
            className="input input-mono"
            type="number"
            min={0}
            value={profile.rampUpSeconds}
            disabled={running}
            onChange={(e) => set('rampUpSeconds', Math.max(0, Number(e.target.value)))}
          />
        </div>

        <div className="perf-field">
          <label>Max RPS (0 = off)</label>
          <input
            className="input input-mono"
            type="number"
            min={0}
            value={profile.targetRps}
            disabled={running}
            onChange={(e) => set('targetRps', Math.max(0, Number(e.target.value)))}
          />
        </div>

        <div style={{ flex: 1 }} />

        {running ? (
          <button className="btn btn-danger" onClick={stop}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button className="btn btn-primary" onClick={start} disabled={!ready}>
            <Play size={14} /> Run load test
          </button>
        )}
      </div>

      {running && progress && (
        <div className="perf-live">
          <div className="progress">
            <div
              className="progress-bar"
              style={{
                width: `${Math.round((progress.fraction ?? 0) * 100)}%`,
                background: 'var(--accent)',
              }}
            />
          </div>
          <div className="perf-live-stats">
            <span>
              <Loader2 size={12} className="spin" /> {progress.activeWorkers} virtual users
            </span>
            <span>{progress.completed.toLocaleString()} sent</span>
            <span>{progress.currentRps.toFixed(1)} rps</span>
            <span style={{ color: progress.errors ? 'var(--red)' : undefined }}>
              {progress.errors} errors
            </span>
            <span>p95 {formatMs(progress.latency.p95)}</span>
          </div>
        </div>
      )}

      <div className="tab-body">
        {!report && !running && (
          <div className="placeholder">
            <Gauge size={26} style={{ color: 'var(--text-dim)' }} />
            <div>No load test run yet</div>
            <div className="meta" style={{ maxWidth: 420, lineHeight: 1.6 }}>
              {tab.protocol === 'grpc'
                ? 'Pick a unary method above, then run. Streaming methods have no meaningful requests-per-second, so they are rejected.'
                : 'Configure the request on the other tabs, then run it under load here.'}
            </div>
          </div>
        )}

        {(report || progress) && (
          <div className="perf-results">
            {latency && (
              <>
                <div className="stat-row">
                  <Stat
                    label="Requests"
                    value={(report?.total ?? progress?.completed ?? 0).toLocaleString()}
                  />
                  <Stat
                    label="Throughput"
                    value={`${(report?.requestsPerSecond ?? progress?.currentRps ?? 0).toFixed(1)}`}
                    unit="req/s"
                    accent
                  />
                  <Stat
                    label="Error rate"
                    value={`${report?.errorRate ?? pct(progress)}`}
                    unit="%"
                    danger={(report?.errorRate ?? pct(progress)) > 0}
                  />
                  <Stat label="Mean" value={latency.mean.toFixed(1)} unit="ms" />
                  <Stat label="p95" value={latency.p95.toFixed(1)} unit="ms" />
                  <Stat label="p99" value={latency.p99.toFixed(1)} unit="ms" />
                </div>

                <Chart buckets={buckets} />

                <div className="perf-tables">
                  <div>
                    <div className="detail-title">Latency distribution</div>
                    <table className="kv">
                      <tbody>
                        {(
                          [
                            ['min', latency.min],
                            ['p50 (median)', latency.p50],
                            ['p75', latency.p75],
                            ['p90', latency.p90],
                            ['p95', latency.p95],
                            ['p99', latency.p99],
                            ['max', latency.max],
                            ['std dev', latency.stdDev],
                          ] as const
                        ).map(([label, value]) => (
                          <tr key={label}>
                            <td>
                              <div className="kv-input" style={{ color: 'var(--text-muted)' }}>
                                {label}
                              </div>
                            </td>
                            <td>
                              <div className="kv-input">{value.toFixed(2)} ms</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <div className="detail-title">Responses</div>
                    <table className="kv">
                      <tbody>
                        {Object.entries(report?.statusCounts ?? {}).map(([status, count]) => (
                          <tr key={status}>
                            <td>
                              <div
                                className="kv-input"
                                style={{
                                  color:
                                    status === 'OK' || status.startsWith('2')
                                      ? 'var(--green)'
                                      : 'var(--red)',
                                }}
                              >
                                {status}
                              </div>
                            </td>
                            <td>
                              <div className="kv-input">{count.toLocaleString()}</div>
                            </td>
                          </tr>
                        ))}
                        {report && Object.keys(report.errorCounts).length > 0 && (
                          <>
                            {Object.entries(report.errorCounts)
                              .slice(0, 5)
                              .map(([message, count]) => (
                                <tr key={message}>
                                  <td colSpan={2}>
                                    <div
                                      className="kv-input"
                                      style={{ color: 'var(--red)', fontSize: 11.5 }}
                                    >
                                      {count}× {message}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {report && (
                  <div className="perf-footer">
                    <span className="meta">
                      {report.label} · {formatMs(report.durationMs)} ·{' '}
                      {report.profile.concurrency} concurrent
                      {report.bytesReceived > 0 && ` · ${formatBytes(report.bytesReceived)} received`}
                    </span>
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        const path = await window.crafillio.perf.exportReport(report);
                        if (path) toast('success', `Report saved to ${path}`);
                      }}
                    >
                      <Download size={12} /> Export CSV
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function pct(progress: LoadProgress | null): number {
  if (!progress || progress.completed === 0) return 0;
  return Math.round((progress.errors / progress.completed) * 10000) / 100;
}

function Stat({
  label,
  value,
  unit,
  accent,
  danger,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div
        className="stat-value"
        style={{ color: danger ? 'var(--red)' : accent ? 'var(--accent)' : undefined }}
      >
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
    </div>
  );
}

/**
 * Throughput and p95 latency over time, drawn as inline SVG.
 *
 * A charting library would add far more weight than two polylines justify, and
 * this keeps the app dependency-light.
 */
function Chart({ buckets }: { buckets: TimeBucket[] }) {
  const geometry = useMemo(() => {
    if (buckets.length < 2) return null;

    const width = 1000;
    const height = 200;
    const padding = { top: 12, right: 8, bottom: 20, left: 8 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const maxRps = Math.max(1, ...buckets.map((b) => b.requests));
    const maxLatency = Math.max(1, ...buckets.map((b) => b.p95LatencyMs));
    const stepX = innerWidth / (buckets.length - 1);

    const toPoints = (pick: (b: TimeBucket) => number, max: number): string =>
      buckets
        .map((bucket, i) => {
          const x = padding.left + i * stepX;
          const y = padding.top + innerHeight - (pick(bucket) / max) * innerHeight;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');

    const rpsPoints = toPoints((b) => b.requests, maxRps);

    return {
      width,
      height,
      maxRps,
      maxLatency,
      rpsPoints,
      latencyPoints: toPoints((b) => b.p95LatencyMs, maxLatency),
      // Closes the RPS line into a shape so it can be filled.
      area: `${padding.left},${padding.top + innerHeight} ${rpsPoints} ${(
        padding.left + (buckets.length - 1) * stepX
      ).toFixed(1)},${padding.top + innerHeight}`,
      errorBars: buckets
        .map((bucket, i) => ({
          x: padding.left + i * stepX,
          height: bucket.errors ? (bucket.errors / maxRps) * innerHeight : 0,
        }))
        .filter((bar) => bar.height > 0),
      baseline: padding.top + innerHeight,
      duration: buckets[buckets.length - 1]!.second,
    };
  }, [buckets]);

  if (!geometry) {
    return (
      <div className="chart-empty meta">Collecting data — the chart appears after a few seconds.</div>
    );
  }

  return (
    <div className="chart">
      <div className="chart-legend">
        <span>
          <i style={{ background: 'var(--accent)' }} /> requests/s (peak {geometry.maxRps})
        </span>
        <span>
          <i style={{ background: 'var(--amber)' }} /> p95 latency (peak{' '}
          {geometry.maxLatency.toFixed(0)} ms)
        </span>
        <span>
          <i style={{ background: 'var(--red)' }} /> errors
        </span>
        <span style={{ marginLeft: 'auto' }}>{geometry.duration}s</span>
      </div>

      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        preserveAspectRatio="none"
        className="chart-svg"
      >
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={geometry.width}
            y1={geometry.baseline * fraction + 12 * (1 - fraction)}
            y2={geometry.baseline * fraction + 12 * (1 - fraction)}
            stroke="var(--border)"
            strokeWidth="1"
          />
        ))}

        {geometry.errorBars.map((bar, i) => (
          <rect
            key={i}
            x={bar.x - 2}
            y={geometry.baseline - bar.height}
            width="4"
            height={bar.height}
            fill="var(--red)"
            opacity="0.55"
          />
        ))}

        {/* Flat translucent fill — the design uses no gradients. */}
        <polygon points={geometry.area} fill="var(--accent)" fillOpacity="0.14" />
        <polyline
          points={geometry.rpsPoints}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={geometry.latencyPoints}
          fill="none"
          stroke="var(--amber)"
          strokeWidth="2"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/** Substitutes `{{vars}}` before handing the request to the load generator. */
function interpolate<T>(node: T, vars: Record<string, string>): T {
  if (typeof node === 'string') {
    return node.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? vars[name]! : match,
    ) as T;
  }
  if (Array.isArray(node)) return node.map((child) => interpolate(child, vars)) as T;
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = interpolate(value, vars);
    return out as T;
  }
  return node;
}
