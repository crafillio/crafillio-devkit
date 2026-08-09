import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  AlertCircle,
  ArrowDown,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  FileDown,
  Loader2,
  Play,
  RefreshCw,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { orderSteps } from '../lib/graph';
import type {
  GrpcRequest,
  GrpcServiceDescriptor,
  RestRequest,
  InputSource,
  RunResult,
  StepRecord,
  StepStatus,
  Workflow,
  WorkflowEvent,
  WorkflowStep,
} from '@crafillio/core';
import { CodeEditor } from './CodeEditor';
import { BodyEditor } from './BodyEditor';
import { KeyValueTable } from './KeyValueTable';
import { WorkflowCanvas } from './WorkflowCanvas';
import { formatBytes, formatMs, tryPrettyJson } from '../lib/format';
import { blankGrpc, blankRest, uid } from '../lib/defaults';
import { useStore } from '../state/store';
import { askChoice, askConfirm, askName } from '../state/dialogs';
import { useT } from '../i18n';

/**
 * Workflow builder and runner.
 *
 * The stage rail across the top is the live view: each stage lights up as it
 * runs and settles into success or failure. Every stage stays clickable
 * afterwards — successful ones too, not just failures — because "what did the
 * response actually look like" is the question you have mid-debug regardless
 * of whether the step passed.
 */
export function WorkflowPanel() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const activeWorkflowId = useStore((s) => s.activeWorkflowId);

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [current, setCurrent] = useState<Workflow | null>(null);
  const [dirty, setDirty] = useState(false);

  const [records, setRecords] = useState<Map<string, StepRecord>>(new Map());
  const [runningStepId, setRunningStepId] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const runId = useRef<string | null>(null);

  /* ---------------------------------------------------------------- */

  const refresh = useCallback(async () => {
    const list = await window.crafillio.workflow.list();
    setWorkflows(list);
    setCurrent((existing) => existing ?? list[0] ?? null);
  }, []);

  useEffect(() => {
    void refresh();
    // Picks up workflows created elsewhere (import, another window) without
    // needing a restart.
    const onFocus = (): void => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // The sidebar can point this panel at a specific workflow.
  useEffect(() => {
    if (!activeWorkflowId) return;
    void (async () => {
      const list = await window.crafillio.workflow.list();
      setWorkflows(list);
      const target = list.find((w) => w.id === activeWorkflowId);
      if (target) {
        setCurrent(target);
        setDirty(false);
        setRecords(new Map());
        setResult(null);
        setSelectedStepId(null);
      }
    })();
  }, [activeWorkflowId]);

  /* Live stage events. */
  useEffect(() => {
    return window.crafillio.workflow.onEvent((event: WorkflowEvent) => {
      // Only follow the run this panel started. Without this, a run triggered
      // elsewhere would repaint stages against the wrong workflow's steps.
      if (runId.current !== null && event.runId !== runId.current) return;

      if (event.type === 'run-start') {
        runId.current = event.runId;
        setRecords(new Map());
        setResult(null);
        return;
      }
      if (event.type === 'step-start') {
        setRunningStepId(event.stepId);
        return;
      }
      if (event.type === 'step-finish') {
        setRecords((previous) => new Map(previous).set(event.record.stepId, event.record));
        setRunningStepId(null);
        return;
      }
      if (event.type === 'run-finish') {
        setResult(event.result);
        setRunning(false);
        setRunningStepId(null);
        runId.current = null;
        const { status } = event.result;
        toast(
          status === 'success' ? 'success' : 'error',
          status === 'success'
            ? t.workflow.completed
            : status === 'partial'
              ? t.workflow.finishedWithFailures
              : t.workflow.failed,
        );
      }
    });
  }, [toast, t]);

  /* ---------------------------------------------------------------- */

  const patch = (next: Partial<Workflow>): void => {
    if (!current) return;
    setCurrent({ ...current, ...next });
    setDirty(true);
  };

  const patchStep = (stepId: string, next: Partial<WorkflowStep>): void => {
    if (!current) return;
    patch({
      steps: current.steps.map((s) =>
        // The cast keeps the discriminated union intact: callers only ever
        // patch fields belonging to the step's own kind.
        s.id === stepId ? ({ ...s, ...next } as WorkflowStep) : s,
      ),
    });
  };

  const save = async (): Promise<void> => {
    if (!current) return;
    const saved = await window.crafillio.workflow.save(current);
    setCurrent(saved);
    setDirty(false);
    await refresh();
    toast('success', t.common.save);
  };

  const createWorkflow = async (): Promise<void> => {
    const name = await askName({
      title: 'New workflow',
      label: 'Workflow name',
      placeholder: 'Order pipeline',
      defaultValue: 'New workflow',
    });
    if (!name) return;
    const created = await window.crafillio.workflow.create(name);
    await refresh();
    setCurrent(created);
    setDirty(false);
  };

  const addStep = async (): Promise<void> => {
    if (!current) return;

    const kind = await askChoice({
      title: t.workflow.addStep,
      label: 'Protocol',
      confirmLabel: t.common.add,
      options: [
        { value: 'rest', label: 'REST', hint: 'HTTP request' },
        { value: 'grpc', label: 'gRPC', hint: 'unary call' },
      ],
    });
    if (!kind) return;

    const base = {
      id: uid('step'),
      name: `Step ${current.steps.length + 1}`,
      inputs: [],
      outputs: [],
      continueOnError: false,
    };
    const step: WorkflowStep =
      kind === 'grpc'
        ? { ...base, kind: 'grpc', grpc: blankGrpc() }
        : { ...base, kind: 'rest', request: blankRest() };

    patch({ steps: [...current.steps, step] });
    setSelectedStepId(step.id);
  };

  const run = async (): Promise<void> => {
    if (!current || current.steps.length === 0) return;
    if (dirty) await save();

    setRecords(new Map());
    setResult(null);
    setRunning(true);
    try {
      runId.current = await window.crafillio.workflow.run(current);
    } catch (err) {
      setRunning(false);
      toast('error', (err as Error).message);
    }
  };

  const stop = (): void => {
    if (runId.current) void window.crafillio.workflow.cancel(runId.current);
  };

  /* ---------------------------------------------------------------- */

  const statusOf = useCallback(
    (stepId: string): StepStatus => {
      if (records.has(stepId)) return records.get(stepId)!.status;
      if (runningStepId === stepId) return 'running';
      return 'pending';
    },
    [records, runningStepId],
  );

  // The rail and the input pickers must reflect real execution order, which
  // the canvas wires define.
  const orderedSteps = useMemo(
    () => (current ? orderSteps(current) : []),
    [current],
  );

  const selectedStep = current?.steps.find((s) => s.id === selectedStepId) ?? null;
  const inspected = inspecting ? (records.get(inspecting) ?? null) : null;

  if (!current) {
    return (
      <div className="placeholder">
        <div>No workflows yet</div>
        <div className="meta" style={{ maxWidth: 420, lineHeight: 1.6 }}>
          A workflow chains requests together — take a token from one response and use it in the
          next, or feed a file into an upload.
        </div>
        <button className="btn btn-primary" onClick={createWorkflow}>
          <Plus size={14} /> New workflow
        </button>
      </div>
    );
  }

  return (
    <div className="pane wf">
      {/* Toolbar */}
      <div className="wf-toolbar">
        <select
          className="select"
          style={{ minWidth: 190 }}
          value={current.id}
              title="Which workflow is open"
          onChange={(e) => {
            setCurrent(workflows.find((w) => w.id === e.target.value) ?? null);
            setRecords(new Map());
            setResult(null);
            setDirty(false);
          }}
        >
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>

        <button className="btn btn-sm" onClick={createWorkflow} title="New workflow">
          <Plus size={13} />
        </button>
        <button className="btn btn-sm" onClick={save} disabled={!dirty}>
          Save{dirty ? ' •' : ''}
        </button>
        <button className="btn btn-sm" onClick={() => void addStep()} title="Add a REST or gRPC step">
          <Plus size={12} /> {t.workflow.addStep}
        </button>

        <div style={{ flex: 1 }} />

        {result && (
          <>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const path = await window.crafillio.workflow.exportReport(result, current);
                if (path) toast('success', `Report saved to ${path}`);
              }}
            >
              <FileDown size={13} /> {t.workflow.exportReport}
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  const path = await window.crafillio.workflow.exportPdf(result, current);
                  if (path) toast('success', `PDF saved to ${path}`);
                } catch (err) {
                  toast('error', (err as Error).message);
                }
              }}
            >
              <FileDown size={13} /> {t.workflow.exportPdf}
            </button>

            <button
              className="btn btn-sm"
              title="Save a screenshot of this run — every step, request and response"
              onClick={async () => {
                if (!result) return;
                try {
                  const path = await window.crafillio.tools.capture({
                    title: `${current?.name ?? 'Workflow'} — run`,
                    protocol: 'workflow',
                    subtitle: `${result.steps.length} step${result.steps.length === 1 ? '' : 's'} · ${result.status}`,
                    chips: [
                      { label: result.status, tone: result.status === 'success' ? 'good' : 'bad' },
                      { label: `${Math.round(result.durationMs)} ms` },
                      {
                        label: `${result.steps.filter((s) => s.status === 'success').length}/${result.steps.length} passed`,
                      },
                    ],
                    capturedAt: new Date().toLocaleString(),
                    // One block per step, so the image carries the whole run
                    // rather than whichever stage happened to be selected.
                    sections: result.steps.flatMap((step) => [
                      {
                        label: `${step.index + 1}. ${step.name} — ${step.status}`,
                        kind: 'kv' as const,
                        rows: [
                          ['Protocol', step.protocol],
                          ...(step.request ? ([['Request', `${step.request.method} ${step.request.url}`]] as Array<[string, string]>) : []),
                          ...(step.response
                            ? ([
                                ['Response', `${step.response.statusLabel ?? step.response.status}`],
                                ['Took', `${Math.round(step.response.timingMs)} ms`],
                              ] as Array<[string, string]>)
                            : []),
                          ...(step.attempts && step.attempts > 1
                            ? ([['Attempts', String(step.attempts)]] as Array<[string, string]>)
                            : []),
                          ...step.extractedOutputs.map((o) => [`→ ${o.name}`, o.value] as [string, string]),
                          ...(step.error ? ([['Error', step.error]] as Array<[string, string]>) : []),
                        ],
                      },
                      {
                        label: `${step.index + 1}. Response body`,
                        kind: 'code' as const,
                        text: step.response?.body ?? '',
                        emptyNote: 'No body',
                      },
                    ]),
                  });
                  if (path) toast('success', `Saved ${path}`);
                } catch (err) {
                  toast('error', (err as Error).message);
                }
              }}
            >
              <Camera size={13} /> Screenshot
            </button>
            <button
              className="btn btn-sm"
              onClick={() => void window.crafillio.workflow.openReport(result, current)}
            >
              {t.workflow.openReport}
            </button>
          </>
        )}

        {running ? (
          <button className="btn btn-danger" onClick={stop}>
            <Square size={13} /> {t.common.stop}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={run} disabled={current.steps.length === 0}>
            <Play size={14} /> {t.workflow.runWorkflow}
          </button>
        )}
      </div>

      {/* Live stage rail */}
      <div className="wf-rail" role="list" aria-label="Workflow stages">
        {current.steps.length === 0 && (
          <span className="meta" style={{ padding: '4px 2px' }}>
            Add a step to begin.
          </span>
        )}
        {orderedSteps.map((step, index) => {
          const status = statusOf(step.id);
          const record = records.get(step.id);
          const clickable = Boolean(record);
          return (
            <div key={step.id} className="wf-rail-item" role="listitem">
              {index > 0 && <ChevronRight size={13} className="wf-arrow" />}
              <button
                className={`stage ${status} ${clickable ? 'clickable' : ''}`}
                onClick={() => clickable && setInspecting(step.id)}
                title={
                  clickable
                    ? `${step.name} — click to inspect the request and response`
                    : step.name
                }
                aria-label={`${step.name}: ${status}`}
              >
                <StageIcon status={status} />
                <span className="stage-name">{step.name}</span>
                {record?.response && <span className="stage-code">{record.response.status}</span>}
                {record && record.durationMs > 0 && (
                  <span className="stage-time">{formatMs(record.durationMs)}</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Builder */}
      <div className="wf-body">
        <WorkflowCanvas
          workflow={current}
          records={records}
          runningStepId={runningStepId}
          selectedStepId={selectedStepId}
          onSelect={setSelectedStepId}
          onChange={patch}
          onInspect={setInspecting}
        />

        <div className="wf-editor">
          {selectedStep ? (
            <StepEditor
              step={selectedStep}
              allSteps={orderedSteps}
              record={records.get(selectedStep.id) ?? null}
              onChange={(next) => patchStep(selectedStep.id, next)}
              onRemove={async () => {
                const ok = await askConfirm({
                  title: 'Remove step',
                  message: `Remove "${selectedStep.name}" from this workflow?`,
                  confirmLabel: 'Remove',
                  danger: true,
                });
                if (!ok) return;
                patch({
                  steps: current.steps.filter((s) => s.id !== selectedStep.id),
                  edges: (current.edges ?? []).filter(
                    (e) => e.from !== selectedStep.id && e.to !== selectedStep.id,
                  ),
                });
                setSelectedStepId(null);
              }}
            />
          ) : (
            <div className="placeholder">
              <div>Select a node to edit it</div>
              <div className="meta" style={{ maxWidth: 380, lineHeight: 1.6 }}>
                Drag nodes to arrange them. Drag from a node's right dot onto another node to
                connect them — the wire sets the order data flows in.
              </div>
            </div>
          )}
        </div>
      </div>

      {inspected && <StageInspector record={inspected} onClose={() => setInspecting(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StageIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader2 size={13} className="spin" />;
  if (status === 'success') return <CheckCircle2 size={13} />;
  if (status === 'failed') return <AlertCircle size={13} />;
  return <CircleDashed size={13} />;
}

/* ------------------------------------------------------------------ */

const SOURCE_KINDS: Array<{ value: InputSource['from']; label: string }> = [
  { value: 'body', label: 'Field from a response' },
  { value: 'header', label: 'Response header' },
  { value: 'status', label: 'Response status' },
  { value: 'rawBody', label: 'Whole response body' },
  { value: 'file', label: 'File contents' },
  { value: 'literal', label: 'Fixed value' },
];

function StepEditor({
  step,
  allSteps,
  record,
  onChange,
  onRemove,
}: {
  step: WorkflowStep;
  allSteps: WorkflowStep[];
  record: StepRecord | null;
  onChange: (next: Partial<WorkflowStep>) => void;
  onRemove: () => void;
}) {
  const [tab, setTab] = useState<'headers' | 'body' | 'inputs' | 'outputs' | 'repeat'>('headers');
  const urlRef = useRef<HTMLInputElement>(null);
  const grpcTab = step.kind === 'grpc';
  // Only earlier steps can be referenced — a later one has not run yet.
  const earlier = allSteps.slice(0, allSteps.findIndex((s) => s.id === step.id));

  /**
   * Everything this step can reference: outputs published by upstream steps,
   * plus its own inputs. Listing them makes chaining discoverable — otherwise
   * you have to remember the name you typed three nodes ago.
   */
  // The last text field touched inside this editor, so a variable lands where
  // the user is working rather than always in the URL.
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const available = [
    ...earlier.flatMap((s) =>
      s.outputs
        .filter((o) => o.name.trim())
        .map((o) => ({ name: o.name, from: s.name })),
    ),
    ...step.inputs.filter((i) => i.name.trim()).map((i) => ({ name: i.name, from: 'this step' })),
  ];

  /**
   * Inserts {{name}} wherever the user was last typing.
   *
   * It used to always target the URL, which is the wrong place for the most
   * common case by far: an auth step publishes a token and it belongs in an
   * Authorization header, not the path. Remembering the last focused field
   * makes one control work for the URL, any header value, and the body.
   */
  const insertVariable = (name: string): void => {
    const token = `{{${name}}}`;
    const field = lastField.current;

    if (field && field.isConnected && !field.disabled && !field.readOnly) {
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      const next = field.value.slice(0, start) + token + field.value.slice(end);

      // React tracks the previous value on the DOM node, so assigning `.value`
      // directly is swallowed as a no-op change. Going through the prototype
      // setter updates that bookkeeping, and the dispatched event is what
      // React's onChange actually listens for.
      const proto =
        field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, next);
      field.dispatchEvent(new Event('input', { bubbles: true }));

      requestAnimationFrame(() => {
        field.focus();
        field.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }

    if (step.kind === 'rest') {
      setRequest({ url: step.request.url + token });
      return;
    }
    // gRPC has no URL bar and nothing was focused; the clipboard is the only
    // honest destination left.
    void navigator.clipboard.writeText(token);
  };

  const setRequest = (next: Partial<RestRequest>): void => {
    if (step.kind !== 'rest') return;
    onChange({ request: { ...step.request, ...next } } as Partial<WorkflowStep>);
  };

  const setGrpc = (next: Partial<GrpcRequest>): void => {
    if (step.kind !== 'grpc') return;
    onChange({ grpc: { ...step.grpc, ...next } } as Partial<WorkflowStep>);
  };

  return (
    <div
      className="pane"
      onFocusCapture={(e) => {
        const el = e.target as HTMLElement;
        if (el instanceof HTMLInputElement && el.type !== 'checkbox') lastField.current = el;
        else if (el instanceof HTMLTextAreaElement) lastField.current = el;
      }}
    >
      {/* The header is the step's identity and its two lifecycle switches.
          The "run if" condition moved to the Repeat tab, where the other
          conditions live — squeezed in here it left the name field too narrow
          to read and looked like an unlabelled mystery box. */}
      <div className="wf-step-head">
        <label className="wf-name-field">
          <span className="wf-name-label">Step name</span>
          <input
            className="input"
            value={step.name}
            placeholder="e.g. Authenticate, Create order, Wait for status"
            title="What this step is called. Shown on the canvas and in the run report."
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>

        <label
          className="inline-check"
          title="If this step fails, keep running the steps after it instead of stopping the whole workflow."
        >
          <input
            type="checkbox"
            className="checkbox"
            checked={step.continueOnError}
            onChange={(e) => onChange({ continueOnError: e.target.checked })}
          />
          Continue on error
        </label>

        <button
          className="btn btn-sm btn-danger"
          title="Delete this step"
          onClick={onRemove}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {step.kind === 'rest' ? (
        <div className="reqbar">
          <select
            className="select method-select"
            value={step.request.method}
            title="HTTP method"
            onChange={(e) => setRequest({ method: e.target.value as RestRequest['method'] })}
          >
            {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            ref={urlRef}
            className="input url"
            value={step.request.url}
            placeholder="https://api.example.com/orders/{{orderId}}"
            spellCheck={false}
            onChange={(e) => setRequest({ url: e.target.value })}
          />
        </div>
      ) : (
        <GrpcStepBar step={step} setGrpc={setGrpc} />
      )}

      {available.length === 0 && earlier.length > 0 && (
        <div className="wf-vars">
          <span className="wf-vars-label">Nothing to use yet</span>
          <span className="wf-vars-hint">
            No earlier step publishes a value. Open the step that returns what you need — an auth
            call, say — go to its <strong>Outputs</strong> tab and publish the field (for a token,
            path <code>token</code> named <code>token</code>). It is then available as{' '}
            <code>{'{{token}}'}</code> in <em>every</em> later step, not just the next one.
          </span>
        </div>
      )}

      {available.length > 0 && (
        <div className="wf-vars">
          <span className="wf-vars-label">Available here</span>
          {available.map((v) => (
            <button
              key={v.name}
              className="wf-var"
              onClick={() => insertVariable(v.name)}
              title={`From ${v.from} — click to insert where you last typed`}
            >
              {`{{${v.name}}}`}
            </button>
          ))}
          <span className="wf-vars-hint">
            click a field first, then a variable — it inserts at the caret, in the URL, a header
            value or the body
          </span>
        </div>
      )}

      <div className="subtabs">
        <button
          className={`subtab ${tab === 'headers' ? 'active' : ''}`}
          onClick={() => setTab('headers')}
        >
          {grpcTab ? 'Metadata' : 'Headers'}
          {(grpcTab ? step.grpc.metadata : step.request.headers).filter(
            (h) => h.enabled && h.key.trim(),
          ).length ? (
            <span className="count">
              {(grpcTab ? step.grpc.metadata : step.request.headers).filter(
                (h) => h.enabled && h.key.trim(),
              ).length}
            </span>
          ) : null}
        </button>
        <button
          className={`subtab ${tab === 'body' ? 'active' : ''}`}
          onClick={() => setTab('body')}
        >
          {grpcTab ? 'Message' : 'Body'}
          {(grpcTab ? true : step.request.body.kind !== 'none') ? (
            <span className="count">•</span>
          ) : null}
        </button>
        <button
          className={`subtab ${tab === 'inputs' ? 'active' : ''}`}
          onClick={() => setTab('inputs')}
        >
          Inputs{step.inputs.length ? <span className="count">{step.inputs.length}</span> : null}
        </button>
        <button
          className={`subtab ${tab === 'outputs' ? 'active' : ''}`}
          onClick={() => setTab('outputs')}
        >
          Outputs{step.outputs.length ? <span className="count">{step.outputs.length}</span> : null}
        </button>
        <button
          className={`subtab ${tab === 'repeat' ? 'active' : ''}`}
          onClick={() => setTab('repeat')}
          title="Poll this step until a condition is met"
        >
          Repeat{step.repeat ? <span className="count">•</span> : null}
        </button>
      </div>

      <div className="tab-body">
        {tab === 'headers' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="wf-hint">
              Reference any input or earlier output as <code>{'{{name}}'}</code> — in the
              {grpcTab ? ' address, message or metadata.' : ' URL, a header, or the body.'}
            </div>
            {step.kind === 'grpc' ? (
              <KeyValueTable
                rows={step.grpc.metadata}
                onChange={(metadata) => setGrpc({ metadata })}
                keyPlaceholder="metadata-key"
              />
            ) : (
              <KeyValueTable
                rows={step.request.headers}
                onChange={(headers) => setRequest({ headers })}
                keyPlaceholder="Header"
                autocomplete="headers"
              />
            )}
          </div>
        )}

        {tab === 'body' &&
          (step.kind === 'grpc' ? (
            <CodeEditor
              value={step.grpc.messages[0] ?? '{}'}
              language="json"
              onChange={(text) => setGrpc({ messages: [text] })}
            />
          ) : (
            <BodyEditor body={step.request.body} onChange={(body) => setRequest({ body })} />
          ))}

        {tab === 'inputs' && (
          <InputsEditor step={step} earlier={earlier} onChange={onChange} record={record} />
        )}

        {tab === 'outputs' && <OutputsEditor step={step} onChange={onChange} record={record} />}

        {tab === 'repeat' && <RepeatEditor step={step} onChange={onChange} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Repeat / polling                                                    */
/* ------------------------------------------------------------------ */

/** `{{name}} in ["a", "b"]` — the shape the simple editor writes and reads. */
const MEMBERSHIP = /^\{\{([\w.-]+)\}\}\s+in\s+\[(.*)\]$/;

function parseMembership(expr: string | undefined): { name: string; values: string[] } | null {
  const match = MEMBERSHIP.exec((expr ?? '').trim());
  if (!match) return null;
  const values = match[2]!
    .split(',')
    .map((v) => v.trim().replace(/^["']|["']$/g, ''))
    .filter((v) => v !== '');
  return { name: match[1]!, values };
}

function buildMembership(name: string, values: string[]): string {
  const list = values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(', ');
  return `{{${name}}} in [${list}]`;
}

/** Splits "a, b , c" into values without losing one the user is mid-typing. */
const splitValues = (text: string): string[] =>
  text.split(',').map((v) => v.trim()).filter((v) => v !== '');

function RepeatEditor({
  step,
  onChange,
}: {
  step: WorkflowStep;
  onChange: (next: Partial<WorkflowStep>) => void;
}) {
  const repeat = step.repeat;
  const enabled = repeat !== undefined;

  const [watchPath, setWatchPath] = useState('');
  const [advanced, setAdvanced] = useState(
    () => repeat !== undefined && parseMembership(repeat.until) === null,
  );
  const [errors, setErrors] = useState<{ until?: string | null; failIf?: string | null }>({});

  // Validated in the main process so there is one implementation of the
  // language rather than a copy of the parser living in the renderer.
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      void (async () => {
        const check = window.crafillio.workflow.checkCondition;
        const until = repeat?.until?.trim() ? await check(repeat.until) : null;
        const failIf = repeat?.failIf?.trim() ? await check(repeat.failIf) : null;
        if (live) setErrors({ until, failIf });
      })();
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [repeat?.until, repeat?.failIf]);

  /**
   * Publishes the given response path as an output and points the condition at
   * it. The name comes from the last segment, which is what the field is
   * called in the response and therefore what the user already has in mind.
   */
  const addWatched = (): void => {
    const path = watchPath.trim();
    if (!path) return;

    const leaf = path
      .replace(/\[[^\]]*\]/g, '.')
      .split('.')
      .map((part) => part.replace(/[^\w-]/g, ''))
      .filter(Boolean)
      .pop();
    const name = leaf || 'value';

    // Reuse an existing output for the same path rather than publishing the
    // value twice under two names.
    const existing = step.outputs.find((o) => o.path === path);
    const outputs = existing
      ? step.outputs
      : [...step.outputs, { id: uid('out'), name, path }];

    onChange({
      outputs,
      repeat: {
        ...(repeat ?? { intervalMs: 2000, maxAttempts: 30, until: '' }),
        until: buildMembership(existing?.name ?? name, watched?.values ?? ['completed']),
        failIf: buildMembership(existing?.name ?? name, failed?.values ?? ['failed']),
      },
    } as Partial<WorkflowStep>);
    setWatchPath('');
  };

  const set = (next: Partial<NonNullable<WorkflowStep['repeat']>>): void => {
    if (!repeat) return;
    onChange({ repeat: { ...repeat, ...next } } as Partial<WorkflowStep>);
  };

  const watched = parseMembership(repeat?.until);
  const failed = parseMembership(repeat?.failIf);
  // Default to whatever the step already publishes, so the common case is one click.
  const watchName = watched?.name ?? step.outputs[0]?.name ?? 'status';

  const toggle = (on: boolean): void => {
    onChange({
      repeat: on
        ? {
            until: buildMembership(watchName, ['completed']),
            failIf: buildMembership(watchName, ['failed']),
            initialDelayMs: 0,
            intervalMs: 2000,
            maxAttempts: 30,
          }
        : undefined,
    } as Partial<WorkflowStep>);
  };

  return (
    <div className="wf-repeat">
      <div className="field" style={{ marginBottom: 18 }}>
        <label>Only run this step if…</label>
        <input
          className="input mono"
          value={step.runIf ?? ''}
          spellCheck={false}
          placeholder={'leave empty to always run — e.g. {{status}} == "ready"'}
          onChange={(e) => onChange({ runIf: e.target.value || undefined })}
        />
        <p className="field-note">
          Checked once, before the step runs. When it does not hold the step is skipped and the
          workflow carries on. Uses the same expressions as the conditions below.
        </p>
      </div>

      <div className="wf-hint">
        Calls this step over and over until the answer settles — for status endpoints that
        report <code>queued</code>, then <code>running</code>, then <code>completed</code>.
        The step's outputs are re-read every time, so the condition always sees the newest
        response.
      </div>

      <label className="inline-check" style={{ marginBottom: 12 }}>
        <input type="checkbox" className="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
        Repeat this step until a condition is met
      </label>

      {repeat && (
        <>
          {!advanced ? (
            <div className="wf-repeat-simple">
              <div className="field">
                <label>Watch this output</label>
                <select
                  className="select"
                  value={watchName}
              title="The output this step publishes that decides when polling stops"
                  onChange={(e) => {
                    const name = e.target.value;
                    set({
                      until: buildMembership(name, watched?.values ?? ['completed']),
                      failIf:
                        repeat.failIf === undefined
                          ? undefined
                          : buildMembership(name, failed?.values ?? ['failed']),
                    });
                  }}
                >
                  {step.outputs.length === 0 && <option value={watchName}>{watchName}</option>}
                  {step.outputs.map((o) => (
                    <option key={o.id} value={o.name}>
                      {o.name}
                    </option>
                  ))}
                </select>
                {step.outputs.length === 0 && (
                  <p className="field-note warn">
                    This step publishes nothing yet. Name the field to watch below, or use the
                    Outputs tab.
                  </p>
                )}
              </div>

              {/* A status is rarely at the top level of a response. Rather than
                  sending people to another tab to publish `data.demo.status`
                  first, the path can be given here and the output is created
                  from it. */}
              <div className="field">
                <label>Watch a field from the response</label>
                <div style={{ display: 'flex', gap: 7 }}>
                  <input
                    className="input mono"
                    style={{ flex: 1 }}
                    value={watchPath}
                    spellCheck={false}
                    placeholder="data.demo.status  ·  items[0].state  ·  status"
                    onChange={(e) => setWatchPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addWatched();
                    }}
                  />
                  <button className="btn btn-sm" onClick={addWatched} disabled={!watchPath.trim()}>
                    Use this field
                  </button>
                </div>
                <p className="field-note">
                  Dots for nesting, <code>[0]</code> for arrays, <code>["odd-key"]</code> when a key
                  has dots or dashes in it. This publishes the value as an output and starts
                  watching it. To compare a nested field without publishing it, switch below and
                  write <code>{'{{response.data.demo.status}}'}</code> directly.
                </p>
              </div>

              <div className="field">
                <label>Succeed when it is one of</label>
                <input
                  className="input"
                  value={(watched?.values ?? []).join(', ')}
                  placeholder="completed, succeeded"
                  onChange={(e) => set({ until: buildMembership(watchName, splitValues(e.target.value)) })}
                />
              </div>

              <div className="field">
                <label>Fail when it is one of</label>
                <input
                  className="input"
                  value={(failed?.values ?? []).join(', ')}
                  placeholder="failed, cancelled"
                  onChange={(e) => {
                    const values = splitValues(e.target.value);
                    set({ failIf: values.length ? buildMembership(watchName, values) : undefined });
                  }}
                />
                <p className="field-note">
                  Optional. Without it, a job that has already failed is polled until the
                  attempts run out.
                </p>
              </div>
            </div>
          ) : (
            <div className="wf-repeat-simple">
              <div className="field">
                <label>Keep going until</label>
                <input
                  className={`input mono ${errors.until ? 'invalid' : ''}`}
                  value={repeat.until}
                  spellCheck={false}
                  placeholder={'{{status}} == "completed"'}
                  onChange={(e) => set({ until: e.target.value })}
                />
                {errors.until && <p className="field-note warn">{errors.until}</p>}
              </div>

              <div className="field">
                <label>Stop and fail when</label>
                <input
                  className={`input mono ${errors.failIf ? 'invalid' : ''}`}
                  value={repeat.failIf ?? ''}
                  spellCheck={false}
                  placeholder={'{{status}} in ["failed", "cancelled"]'}
                  onChange={(e) => set({ failIf: e.target.value || undefined })}
                />
                {errors.failIf && <p className="field-note warn">{errors.failIf}</p>}
              </div>

              <p className="field-note">
                Comparisons <code>== != &gt; &lt; &gt;= &lt;=</code>, and{' '}
                <code>contains</code>, <code>matches</code>, <code>in [a, b]</code>, combined
                with <code>and</code>, <code>or</code>, <code>not</code> and parentheses.
              </p>
              <p className="field-note">
                Read any field of the response directly with{' '}
                <code>{'{{response.…}}'}</code> — no output needed. Nesting and array indexes
                both work:{' '}
                <code>{'{{response.data.demo.status}} == "completed"'}</code> or{' '}
                <code>{'{{response.items[0].state}}'}</code>. Names without the prefix refer to
                outputs and earlier steps as before.
              </p>
            </div>
          )}

          <div className="wf-repeat-timing">
            <div className="field">
              <label>Delay before first call</label>
              <input
                type="number"
                className="input"
                min={0}
                value={repeat.initialDelayMs ?? 0}
              title="Milliseconds to wait before the first call. Work that has just started is rarely ready immediately."
                onChange={(e) => set({ initialDelayMs: Math.max(0, Number(e.target.value)) })}
              />
              <p className="field-note">ms — work just started is rarely ready immediately.</p>
            </div>
            <div className="field">
              <label>Delay between tries</label>
              <input
                type="number"
                className="input"
                min={0}
                value={repeat.intervalMs}
              title="Milliseconds to wait between attempts"
                onChange={(e) => set({ intervalMs: Math.max(0, Number(e.target.value)) })}
              />
              <p className="field-note">ms</p>
            </div>
            <div className="field">
              <label>Give up after</label>
              <input
                type="number"
                className="input"
                min={1}
                value={repeat.maxAttempts}
              title="Stop after this many attempts, even if the condition never holds"
                onChange={(e) => set({ maxAttempts: Math.max(1, Number(e.target.value)) })}
              />
              <p className="field-note">tries</p>
            </div>
            <div className="field">
              <label>Or after</label>
              <input
                type="number"
                className="input"
                min={0}
                value={repeat.timeoutMs ?? 0}
              title="Stop after this many milliseconds overall, whichever limit is reached first. 0 means no time limit."
                onChange={(e) => set({ timeoutMs: Number(e.target.value) || undefined })}
              />
              <p className="field-note">ms overall — 0 for no limit.</p>
            </div>
            <div className="field">
              <label>Back off by</label>
              <input
                type="number"
                className="input"
                min={1}
                step={0.5}
                value={repeat.backoff ?? 1}
              title="Multiply the wait after each attempt. 1 polls at a steady rate; 2 doubles each time."
                onChange={(e) => set({ backoff: Number(e.target.value) || undefined })}
              />
              <p className="field-note">×— 1 polls at a steady rate, 2 doubles each wait.</p>
            </div>
          </div>

          <label className="inline-check" style={{ marginTop: 4 }}>
            <input
              type="checkbox"
              className="checkbox"
              checked={repeat.retryOnError ?? false}
              onChange={(e) => set({ retryOnError: e.target.checked || undefined })}
            />
            Retry when the call itself fails
          </label>
          <p className="field-note" style={{ marginTop: 2 }}>
            Rides out a transient 503. Leave off when the endpoint should always answer —
            otherwise a genuinely broken one looks like a slow one.
          </p>

          <button
            className="btn btn-sm"
            style={{ marginTop: 14, alignSelf: 'flex-start' }}
            onClick={() => setAdvanced(!advanced)}
          >
            {advanced ? 'Use the simple form' : 'Write the condition myself'}
          </button>
          {advanced && parseMembership(repeat.until) === null && (
            <p className="field-note" style={{ marginTop: 6 }}>
              The simple form only understands “is one of” conditions, so switching back will
              rewrite what you have here.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Target bar for a gRPC step: where to call, and which method.
 *
 * Discovery reuses the same reflection/proto path as the gRPC tab, so a step
 * can be pointed at a server and its methods listed without leaving the canvas.
 */
function GrpcStepBar({
  step,
  setGrpc,
}: {
  step: Extract<WorkflowStep, { kind: 'grpc' }>;
  setGrpc: (next: Partial<GrpcRequest>) => void;
}) {
  const toast = useStore((s) => s.toast);
  const [services, setServices] = useState<GrpcServiceDescriptor[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const discover = async (): Promise<void> => {
    if (!step.grpc.target.address.trim()) {
      toast('error', 'Enter a server address first.');
      return;
    }
    setDiscovering(true);
    try {
      const found = await window.crafillio.grpc.describe(step.grpc.source, step.grpc.target, true);
      setServices(found);
      const first = found[0];
      // Only unary methods can be a workflow step; a stream has no single
      // response to hand to the next one.
      const unary = first?.methods.filter((m) => m.callType === 'unary') ?? [];
      if (first && !step.grpc.service && unary[0]) {
        setGrpc({ service: first.name, method: unary[0].name, messages: [unary[0].inputExample] });
      }
      toast('success', `Found ${found.length} service${found.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setDiscovering(false);
    }
  };

  const service = services.find((s) => s.name === step.grpc.service);
  const unaryMethods = service?.methods.filter((m) => m.callType === 'unary') ?? [];

  return (
    <>
      <div className="grpc-toolbar">
        <input
          className="input input-mono"
          style={{ flex: 1, minWidth: 180 }}
          value={step.grpc.target.address}
          placeholder="localhost:50051"
          spellCheck={false}
          title="gRPC server address"
          onChange={(e) => setGrpc({ target: { ...step.grpc.target, address: e.target.value } })}
        />
        <label className="inline-check" title="Connect over TLS">
          <input
            type="checkbox"
            className="checkbox"
            checked={step.grpc.target.tls}
            onChange={(e) => setGrpc({ target: { ...step.grpc.target, tls: e.target.checked } })}
          />
          TLS
        </label>
        <select
          className="select"
          value={step.grpc.source.kind}
          title="Where the service definition comes from"
          onChange={(e) =>
            setGrpc({
              source:
                e.target.value === 'reflection'
                  ? { kind: 'reflection' }
                  : { kind: 'proto', files: [], includeDirs: [] },
            })
          }
        >
          <option value="reflection">Server reflection</option>
          <option value="proto">.proto files</option>
        </select>
        {step.grpc.source.kind === 'proto' && (
          <button
            className="btn btn-sm"
            title="Choose .proto files"
            onClick={async () => {
              const files = await window.crafillio.dialog.openFiles({
                filters: [{ name: 'Protocol buffers', extensions: ['proto'] }],
                multiple: true,
              });
              if (files.length === 0) return;
              const includeDirs = [...new Set(files.map((f) => f.path.replace(/\/[^/]+$/, '')))];
              setGrpc({ source: { kind: 'proto', files: files.map((f) => f.path), includeDirs } });
            }}
          >
            {step.grpc.source.files.length
              ? `${step.grpc.source.files.length} file(s)`
              : 'Choose .proto'}
          </button>
        )}
        <button className="btn btn-sm" onClick={discover} disabled={discovering} title="List the services this server exposes">
          {discovering ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          Discover
        </button>
      </div>

      <div className="grpc-toolbar" style={{ paddingTop: 0 }}>
        <select
          className="select"
          style={{ flex: 1, minWidth: 150 }}
          value={step.grpc.service}
          title="Service"
          onChange={(e) => setGrpc({ service: e.target.value, method: '' })}
        >
          <option value="">{services.length ? 'Select a service…' : 'Run Discover, or type below'}</option>
          {services.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>

        {unaryMethods.length > 0 ? (
          <select
            className="select"
            style={{ flex: 1, minWidth: 150 }}
            value={step.grpc.method}
            title="Unary method"
            onChange={(e) => {
              const chosen = unaryMethods.find((m) => m.name === e.target.value);
              setGrpc({
                method: e.target.value,
                messages: chosen ? [chosen.inputExample] : step.grpc.messages,
              });
            }}
          >
            <option value="">Select a method…</option>
            {unaryMethods.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="input input-mono"
            style={{ flex: 1, minWidth: 150 }}
            value={step.grpc.method}
            placeholder="MethodName"
            title="Unary method name"
            onChange={(e) => setGrpc({ method: e.target.value })}
          />
        )}
      </div>

      {!step.grpc.service && (
        <div className="wf-hint">
          Workflow steps call unary methods only — a streaming call has no single response to hand
          to the next step.
        </div>
      )}
    </>
  );
}

function InputsEditor({
  step,
  earlier,
  onChange,
  record,
}: {
  step: WorkflowStep;
  earlier: WorkflowStep[];
  onChange: (next: Partial<WorkflowStep>) => void;
  record: StepRecord | null;
}) {
  const update = (id: string, next: Partial<WorkflowStep['inputs'][number]>): void =>
    onChange({ inputs: step.inputs.map((i) => (i.id === id ? { ...i, ...next } : i)) });

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="wf-hint">
        An input pulls a value from an earlier step, a file, or a fixed string, and makes it
        available in this step as <code>{'{{name}}'}</code>.
      </div>

      {step.inputs.map((input) => (
        <div key={input.id} className="wf-binding">
          <div className="wf-binding-head">
            <input
              className="input input-mono"
              style={{ width: 150 }}
              value={input.name}
              placeholder="token"
              onChange={(e) => update(input.id, { name: e.target.value })}
            />
            <span className="meta">from</span>
            <select
              className="select"
              value={input.source.from}
              title="Where this value comes from: an earlier step, a file, or a fixed value you type"
              onChange={(e) => {
                const from = e.target.value as InputSource['from'];
                const first = earlier[0]?.id ?? '';
                const source: InputSource =
                  from === 'literal'
                    ? { from, value: '' }
                    : from === 'file'
                      ? { from, path: '', as: 'text' }
                      : from === 'header'
                        ? { from, stepId: first, header: '' }
                        : from === 'body'
                          ? { from, stepId: first, path: '' }
                          : { from, stepId: first };
                update(input.id, { source });
              }}
            >
              {SOURCE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <div style={{ flex: 1 }} />
            <button
              className="btn btn-ghost btn-sm"
              title="Remove this input"
              onClick={() => onChange({ inputs: step.inputs.filter((i) => i.id !== input.id) })}
            >
              <Trash2 size={12} />
            </button>
          </div>

          <div className="wf-binding-body">
            {'stepId' in input.source && (
              <select
                className="select"
                value={input.source.stepId}
              title="Which earlier step to take the value from"
                onChange={(e) =>
                  update(input.id, { source: { ...input.source, stepId: e.target.value } as InputSource })
                }
              >
                {earlier.length === 0 && <option value="">No earlier steps</option>}
                {earlier.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    {i + 1}. {s.name}
                  </option>
                ))}
              </select>
            )}

            {input.source.from === 'body' && (
              <input
                className="input input-mono"
                style={{ flex: 1 }}
                value={input.source.path}
                placeholder="data.items[0].id"
                onChange={(e) =>
                  update(input.id, { source: { ...input.source, path: e.target.value } as InputSource })
                }
              />
            )}

            {input.source.from === 'header' && (
              <input
                className="input input-mono"
                style={{ flex: 1 }}
                value={input.source.header}
                placeholder="x-session"
                onChange={(e) =>
                  update(input.id, { source: { ...input.source, header: e.target.value } as InputSource })
                }
              />
            )}

            {input.source.from === 'literal' && (
              <input
                className="input input-mono"
                style={{ flex: 1 }}
                value={input.source.value}
                placeholder="a fixed value"
                onChange={(e) =>
                  update(input.id, { source: { ...input.source, value: e.target.value } as InputSource })
                }
              />
            )}

            {input.source.from === 'file' && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const [file] = await window.crafillio.dialog.openFiles();
                    if (file) {
                      update(input.id, { source: { ...input.source, path: file.path } as InputSource });
                    }
                  }}
                >
                  Choose file
                </button>
                <span className="meta" style={{ flex: 1, minWidth: 0 }}>
                  {input.source.path || 'No file chosen'}
                </span>
                <select
                  className="select"
                  value={input.source.as}
              title="Read the file as text, or as base64 for binary content"
                  onChange={(e) =>
                    update(input.id, {
                      source: { ...input.source, as: e.target.value as 'text' | 'base64' } as InputSource,
                    })
                  }
                >
                  <option value="text">as text</option>
                  <option value="base64">as base64</option>
                </select>
              </>
            )}
          </div>

          {record?.resolvedInputs.find((r) => r.name === input.name) && (
            <div className="wf-resolved">
              resolved to{' '}
              <code>{record.resolvedInputs.find((r) => r.name === input.name)!.value}</code>
            </div>
          )}
        </div>
      ))}

      <button
        className="btn btn-sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() =>
          onChange({
            inputs: [
              ...step.inputs,
              {
                id: uid('in'),
                name: '',
                source: { from: 'body', stepId: earlier[0]?.id ?? '', path: '' },
              },
            ],
          })
        }
      >
        <Plus size={12} /> Add input
      </button>
    </div>
  );
}

function OutputsEditor({
  step,
  onChange,
  record,
}: {
  step: WorkflowStep;
  onChange: (next: Partial<WorkflowStep>) => void;
  record: StepRecord | null;
}) {
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="wf-hint">
        An output lifts a value out of this step's response and publishes it under a name that
        later steps can use. Leave the path empty to publish the whole body.
       Anything published here is available to <strong>every</strong> later step as <code>{'{{name}}'}</code> — not only the next one — so an auth token captured once serves the whole workflow.</div>

      <table className="kv">
        <thead>
          <tr>
            <th>Publish as</th>
            <th>Path in response</th>
            <th style={{ width: 34 }} />
          </tr>
        </thead>
        <tbody>
          {step.outputs.map((output) => (
            <tr key={output.id} className="kv-row">
              <td>
                <input
                  className="kv-input"
                  value={output.name}
                  placeholder="orderId"
                  onChange={(e) =>
                    onChange({
                      outputs: step.outputs.map((o) =>
                        o.id === output.id ? { ...o, name: e.target.value } : o,
                      ),
                    })
                  }
                />
              </td>
              <td>
                <input
                  className="kv-input"
                  value={output.path}
                  placeholder="data.order.id"
                  onChange={(e) =>
                    onChange({
                      outputs: step.outputs.map((o) =>
                        o.id === output.id ? { ...o, path: e.target.value } : o,
                      ),
                    })
                  }
                />
              </td>
              <td className="kv-remove">
                <button
                  className="row-action"
                  style={{ opacity: 1 }}
                  title="Remove this output"
                  onClick={() =>
                    onChange({ outputs: step.outputs.filter((o) => o.id !== output.id) })
                  }
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        className="btn btn-sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() =>
          onChange({ outputs: [...step.outputs, { id: uid('out'), name: '', path: '' }] })
        }
      >
        <Plus size={12} /> Add output
      </button>

      {record?.extractedOutputs.length ? (
        <div className="wf-resolved-block">
          <div className="detail-title">From the last run</div>
          {record.extractedOutputs.map((o) => (
            <div key={o.name} className="detail-row">
              <dt>{o.name}</dt>
              <dd>{o.value}</dd>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Drawer showing everything captured for one stage. */
function StageInspector({ record, onClose }: { record: StepRecord; onClose: () => void }) {
  const [tab, setTab] = useState<'request' | 'response' | 'data'>(
    record.status === 'failed' ? 'response' : 'response',
  );

  const prettyResponse = useMemo(() => {
    if (!record.response) return '';
    if (record.response.bodyEncoding === 'base64') {
      return `(binary — ${formatBytes(record.response.size)}; download it from the report)`;
    }
    return tryPrettyJson(record.response.body);
  }, [record]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="wf-inspector-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="wf-inspector" role="dialog" aria-label={`${record.name} details`}>
        <header className="wf-inspector-head">
          <span className={`badge-status ${record.status}`}>
            <StageIcon status={record.status} />
            {record.status}
          </span>
          <strong style={{ flex: 1 }}>{record.name}</strong>
          {record.response && (
            <span className="meta">
              HTTP {record.response.status} · {formatMs(record.durationMs)} ·{' '}
              {formatBytes(record.response.size)}
            </span>
          )}
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Close (Esc)">
            <X size={15} />
          </button>
        </header>

        {record.error && <div className="error-box">{record.error}</div>}

        <div className="subtabs">
          <button
            className={`subtab ${tab === 'request' ? 'active' : ''}`}
            onClick={() => setTab('request')}
          >
            Request
          </button>
          <button
            className={`subtab ${tab === 'response' ? 'active' : ''}`}
            onClick={() => setTab('response')}
          >
            Response
          </button>
          <button
            className={`subtab ${tab === 'data' ? 'active' : ''}`}
            onClick={() => setTab('data')}
          >
            Data in / out
          </button>
        </div>

        <div className="tab-body">
          {tab === 'request' &&
            (record.request ? (
              <>
                <div className="wf-line">
                  <span className="method-chip m-GET">{record.request.method}</span>
                  <code>{record.request.url}</code>
                </div>
                <table className="kv">
                  <tbody>
                    {record.request.headers.map(([k, v], i) => (
                      <tr key={i}>
                        <td style={{ width: '34%' }}>
                          <div className="kv-input" style={{ color: 'var(--text-muted)' }}>
                            {k}
                          </div>
                        </td>
                        <td>
                          <div className="kv-input">{v}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {record.request.body && (
                  <div style={{ height: 260 }}>
                    <CodeEditor value={tryPrettyJson(record.request.body)} readOnly language="json" />
                  </div>
                )}
              </>
            ) : (
              <div className="placeholder">This step never sent a request.</div>
            ))}

          {tab === 'response' &&
            (record.response ? (
              <>
                <table className="kv">
                  <tbody>
                    {record.response.headers.map(([k, v], i) => (
                      <tr key={i}>
                        <td style={{ width: '34%' }}>
                          <div className="kv-input" style={{ color: 'var(--text-muted)' }}>
                            {k}
                          </div>
                        </td>
                        <td>
                          <div className="kv-input" style={{ wordBreak: 'break-all' }}>
                            {v}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ height: 340 }}>
                  <CodeEditor value={prettyResponse} readOnly language="json" />
                </div>
              </>
            ) : (
              <div className="placeholder">
                {record.status === 'skipped'
                  ? 'This step was skipped, so there is no response.'
                  : 'No response was received.'}
              </div>
            ))}

          {tab === 'data' && (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="detail-title">Inputs used</div>
                {record.resolvedInputs.length === 0 ? (
                  <span className="meta">None.</span>
                ) : (
                  record.resolvedInputs.map((i) => (
                    <div key={i.name} className="wf-data-row">
                      <code className="wf-data-name">{i.name}</code>
                      <code className="wf-data-value">{i.value}</code>
                      <span className="meta">{i.source}</span>
                    </div>
                  ))
                )}
              </div>
              <div>
                <div className="detail-title">Published to later steps</div>
                {record.extractedOutputs.length === 0 ? (
                  <span className="meta">None.</span>
                ) : (
                  record.extractedOutputs.map((o) => (
                    <div key={o.name} className="wf-data-row">
                      <code className="wf-data-name">{o.name}</code>
                      <code className="wf-data-value">{o.value}</code>
                    </div>
                  ))
                )}
              </div>
              {record.artifacts.length > 0 && (
                <div>
                  <div className="detail-title">Files produced</div>
                  {record.artifacts.map((a) => (
                    <div key={a.name} className="wf-data-row">
                      <code className="wf-data-name">{a.name}</code>
                      <span className="meta">
                        {a.contentType} · {formatBytes(a.size)} — downloadable from the report
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
