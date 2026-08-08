import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  const [tab, setTab] = useState<'headers' | 'body' | 'inputs' | 'outputs'>('headers');
  const urlRef = useRef<HTMLInputElement>(null);
  const grpcTab = step.kind === 'grpc';
  // Only earlier steps can be referenced — a later one has not run yet.
  const earlier = allSteps.slice(0, allSteps.findIndex((s) => s.id === step.id));

  /**
   * Everything this step can reference: outputs published by upstream steps,
   * plus its own inputs. Listing them makes chaining discoverable — otherwise
   * you have to remember the name you typed three nodes ago.
   */
  const available = [
    ...earlier.flatMap((s) =>
      s.outputs
        .filter((o) => o.name.trim())
        .map((o) => ({ name: o.name, from: s.name })),
    ),
    ...step.inputs.filter((i) => i.name.trim()).map((i) => ({ name: i.name, from: 'this step' })),
  ];

  /** Inserts {{name}} into the URL at the caret, not just at the end. */
  const insertVariable = (name: string): void => {
    const token = `{{${name}}}`;
    if (step.kind !== 'rest') {
      // gRPC has no URL bar; put it on the clipboard so it can go wherever
      // the user actually needs it.
      void navigator.clipboard.writeText(token);
      return;
    }
    const input = urlRef.current;
    if (!input) {
      setRequest({ url: step.request.url + token });
      return;
    }
    const start = input.selectionStart ?? step.request.url.length;
    const end = input.selectionEnd ?? start;
    const next = step.request.url.slice(0, start) + token + step.request.url.slice(end);
    setRequest({ url: next });
    // Put the caret after what we inserted, so typing continues naturally.
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
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
    <div className="pane">
      <div className="wf-step-head">
        <input
          className="input"
          style={{ flex: 1, fontWeight: 600 }}
          value={step.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <label className="inline-check" title="Carry on even if this step fails">
          <input
            type="checkbox"
            className="checkbox"
            checked={step.continueOnError}
            onChange={(e) => onChange({ continueOnError: e.target.checked })}
          />
          Continue on error
        </label>
        <button className="btn btn-sm btn-danger" onClick={onRemove}>
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

      {available.length > 0 && (
        <div className="wf-vars">
          <span className="wf-vars-label">Available here</span>
          {available.map((v) => (
            <button
              key={v.name}
              className="wf-var"
              onClick={() => insertVariable(v.name)}
              title={`From ${v.from} — click to insert into the URL`}
            >
              {`{{${v.name}}}`}
            </button>
          ))}
          <span className="wf-vars-hint">click to insert · also works in headers and body</span>
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
      </div>
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
      </div>

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
