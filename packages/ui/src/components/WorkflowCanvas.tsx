import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleDashed, Loader2, Trash2 } from 'lucide-react';
import type { StepRecord, StepStatus, Workflow, WorkflowEdge, WorkflowStep } from '@crafillio/core';
import { uid } from '../lib/defaults';
import { formatMs } from '../lib/format';

/**
 * Visual workflow editor.
 *
 * Nodes are DOM elements so their content stays selectable and accessible;
 * the connections behind them are one SVG layer. Dragging a node moves it,
 * dragging from a node's right-hand port to another node's left-hand port
 * wires them together — and that wire is what sets execution order.
 */

const NODE_W = 210;
const NODE_H = 76;
const GRID = 20;

interface Props {
  workflow: Workflow;
  records: Map<string, StepRecord>;
  runningStepId: string | null;
  selectedStepId: string | null;
  onSelect: (stepId: string) => void;
  onChange: (next: Partial<Workflow>) => void;
  onInspect: (stepId: string) => void;
}

/** Lays out any node that has never been positioned, so nothing stacks at 0,0. */
function withPositions(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step, index) =>
    step.position
      ? step
      : { ...step, position: { x: 60 + index * (NODE_W + 70), y: 70 + (index % 2) * 40 } },
  );
}

export function WorkflowCanvas({
  workflow,
  records,
  runningStepId,
  selectedStepId,
  onSelect,
  onChange,
  onInspect,
}: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  /** Node currently being dragged, with the grab offset inside it. */
  const drag = useRef<{ stepId: string; dx: number; dy: number } | null>(null);
  /** In-progress connection from a node's output port. */
  const [linking, setLinking] = useState<{ from: string; x: number; y: number } | null>(null);
  const [hoverPort, setHoverPort] = useState<string | null>(null);

  const steps = useMemo(() => withPositions(workflow.steps), [workflow.steps]);
  const edges = workflow.edges ?? [];

  // Persist any positions we had to invent, so the layout is stable next time.
  useEffect(() => {
    if (workflow.steps.some((s) => !s.position)) onChange({ steps });
    // Runs only when a step genuinely lacks a position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.steps.length]);

  const positionOf = useCallback(
    (stepId: string) => steps.find((s) => s.id === stepId)?.position ?? { x: 0, y: 0 },
    [steps],
  );

  const statusOf = useCallback(
    (stepId: string): StepStatus => {
      if (records.has(stepId)) return records.get(stepId)!.status;
      if (runningStepId === stepId) return 'running';
      return 'pending';
    },
    [records, runningStepId],
  );

  /* ---------------------------------------------------------------- */
  /* Dragging                                                          */
  /* ---------------------------------------------------------------- */

  const pointIn = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: event.clientX - rect.left + (surfaceRef.current?.scrollLeft ?? 0),
      y: event.clientY - rect.top + (surfaceRef.current?.scrollTop ?? 0),
    };
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const point = pointIn(event);

      if (drag.current) {
        const { stepId, dx, dy } = drag.current;
        // Snapping to a grid keeps hand-placed nodes tidy without a layout pass.
        const x = Math.max(0, Math.round((point.x - dx) / GRID) * GRID);
        const y = Math.max(0, Math.round((point.y - dy) / GRID) * GRID);
        onChange({
          steps: steps.map((s) => (s.id === stepId ? { ...s, position: { x, y } } : s)),
        });
        return;
      }

      if (linking) setLinking({ ...linking, x: point.x, y: point.y });
    };

    const onUp = (event: MouseEvent): void => {
      if (linking) {
        // Landing on a node's input port completes the connection.
        const target = (event.target as HTMLElement)?.closest<HTMLElement>('[data-port-in]');
        const toId = target?.dataset.portIn;

        if (toId && toId !== linking.from) {
          const exists = edges.some((e) => e.from === linking.from && e.to === toId);
          // A direct reverse edge would be an immediate cycle.
          const reverse = edges.some((e) => e.from === toId && e.to === linking.from);
          if (!exists && !reverse) {
            onChange({ edges: [...edges, { id: uid('edge'), from: linking.from, to: toId }] });
          }
        }
        setLinking(null);
        setHoverPort(null);
      }
      drag.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [linking, steps, edges, onChange, pointIn]);

  /* ---------------------------------------------------------------- */

  const extent = steps.reduce(
    (acc, s) => ({
      w: Math.max(acc.w, (s.position?.x ?? 0) + NODE_W + 120),
      h: Math.max(acc.h, (s.position?.y ?? 0) + NODE_H + 120),
    }),
    { w: 900, h: 420 },
  );

  /** Bezier between an output port and an input port. */
  const path = (from: { x: number; y: number }, to: { x: number; y: number }): string => {
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const bend = Math.max(45, Math.abs(x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div className="wf-canvas" ref={surfaceRef}>
      <div className="wf-canvas-surface" style={{ width: extent.w, height: extent.h }}>
        <svg className="wf-wires" width={extent.w} height={extent.h}>
          <defs>
            <marker
              id="wf-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="wf-arrow-head" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const from = positionOf(edge.from);
            const to = positionOf(edge.to);
            const done = records.has(edge.from);
            const midX = (from.x + NODE_W + to.x) / 2;
            const midY = (from.y + to.y) / 2 + NODE_H / 2;
            return (
              <g key={edge.id} className={`wf-wire ${done ? 'done' : ''}`}>
                <path d={path(from, to)} className="wf-wire-path" markerEnd="url(#wf-arrow)" />
                {/* A fat invisible path makes the thin wire easy to click. */}
                <path
                  d={path(from, to)}
                  className="wf-wire-hit"
                  onClick={() => onChange({ edges: edges.filter((e) => e.id !== edge.id) })}
                >
                  <title>Click to remove this connection</title>
                </path>
                <circle cx={midX} cy={midY} r="9" className="wf-wire-badge" />
                <text x={midX} y={midY + 3.5} className="wf-wire-x" textAnchor="middle">
                  ×
                </text>
              </g>
            );
          })}

          {linking && (
            <path
              d={path(positionOf(linking.from), {
                x: linking.x,
                y: linking.y - NODE_H / 2,
              })}
              className="wf-wire-path linking"
            />
          )}
        </svg>

        {steps.map((step, index) => {
          const status = statusOf(step.id);
          const record = records.get(step.id);
          const pos = step.position!;
          return (
            <div
              key={step.id}
              className={`wf-node ${status} ${selectedStepId === step.id ? 'selected' : ''}`}
              style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
              onMouseDown={(e) => {
                // Ports and buttons handle their own gestures.
                if ((e.target as HTMLElement).closest('[data-port-out],[data-port-in],button')) return;
                const point = pointIn(e);
                drag.current = { stepId: step.id, dx: point.x - pos.x, dy: point.y - pos.y };
                onSelect(step.id);
              }}
              onDoubleClick={() => record && onInspect(step.id)}
            >
              <span
                className="wf-port in"
                data-port-in={step.id}
                title="Drop a connection here"
                style={{ outline: hoverPort === step.id ? '2px solid var(--accent)' : undefined }}
              />

              <div className="wf-node-head">
                <span className="wf-node-index">{index + 1}</span>
                <StatusDot status={status} />
                <span className="wf-node-name" title={step.name}>
                  {step.name}
                </span>
                <button
                  className="wf-node-del"
                  title="Remove step"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange({
                      steps: workflow.steps.filter((s) => s.id !== step.id),
                      edges: edges.filter((x) => x.from !== step.id && x.to !== step.id),
                    });
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>

              <div className="wf-node-url" title={step.request.url}>
                <span className={`method-chip m-${step.request.method}`}>{step.request.method}</span>
                {step.request.url || 'no URL yet'}
              </div>

              <div className="wf-node-foot">
                {step.outputs.length > 0 && (
                  <span className="wf-node-tag" title="Values published to later steps">
                    ↑ {step.outputs.map((o) => o.name || '?').slice(0, 2).join(', ')}
                    {step.outputs.length > 2 ? '…' : ''}
                  </span>
                )}
                {record?.response && (
                  <span className="wf-node-code">
                    {record.response.status} · {formatMs(record.durationMs)}
                  </span>
                )}
                {record && (
                  <button
                    className="wf-node-inspect"
                    onClick={(e) => {
                      e.stopPropagation();
                      onInspect(step.id);
                    }}
                  >
                    Inspect
                  </button>
                )}
              </div>

              <span
                className="wf-port out"
                data-port-out={step.id}
                title="Drag to another step to connect"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const point = pointIn(e);
                  setLinking({ from: step.id, x: point.x, y: point.y });
                }}
                onMouseEnter={() => setHoverPort(step.id)}
                onMouseLeave={() => setHoverPort(null)}
              />
            </div>
          );
        })}

        {steps.length === 0 && (
          <div className="wf-canvas-empty">
            <p>Nothing on the canvas yet.</p>
            <p className="meta">
              Add a step, then drag from its right-hand dot to another step to connect them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader2 size={12} className="spin" />;
  if (status === 'success') return <CheckCircle2 size={12} />;
  if (status === 'failed') return <AlertCircle size={12} />;
  return <CircleDashed size={12} />;
}
