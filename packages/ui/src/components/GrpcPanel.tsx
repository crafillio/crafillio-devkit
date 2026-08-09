import { useState } from 'react';
import {
  ClipboardCopy,
  Camera, FileCode2, Gauge, Loader2, RefreshCw, Send, Square, Plus, Trash2 } from 'lucide-react';
import type { GrpcEvent, GrpcRequest, GrpcSource } from '@crafillio/core';
import { CodeEditor } from './CodeEditor';
import { Split } from './Split';
import { captureForGrpc } from '../lib/capture';
import { KeyValueTable } from './KeyValueTable';
import { formatMs } from '../lib/format';
import { PerfPanel } from './PerfPanel';
import { useStore, type GrpcTab } from '../state/store';

type SubTab = 'message' | 'metadata' | 'settings' | 'perf';

interface Props {
  tab: GrpcTab;
  onSend: () => void;
}

export function GrpcPanel({ tab, onSend }: Props) {
  const [sub, setSub] = useState<SubTab>('message');
  const patchTab = useStore((s) => s.patchTab);
  const toast = useStore((s) => s.toast);

  const req = tab.request;
  const patch = (partial: Partial<GrpcRequest>): void => {
    patchTab(tab.id, { request: { ...req, ...partial }, dirty: true } as Partial<GrpcTab>);
  };

  const [methodFilter, setMethodFilter] = useState('');

  const service = tab.services.find((s) => s.name === req.service);
  const method = service?.methods.find((m) => m.name === req.method);

  /**
   * Services with their methods narrowed by the filter.
   *
   * Matching either the service or the method name means "Greeter" finds
   * everything on that service, and "SayHello" finds it without knowing which
   * service it is on — which is the whole point of the filter. The current
   * selection is always kept, so filtering never blanks the picker.
   */
  const visibleServices = (() => {
    const needle = methodFilter.trim().toLowerCase();
    if (!needle) return tab.services;
    return tab.services
      .map((s) => ({
        ...s,
        methods: s.methods.filter(
          (m) =>
            `${s.name}/${m.name}`.toLowerCase().includes(needle) ||
            (s.name === req.service && m.name === req.method),
        ),
      }))
      .filter((s) => s.methods.length > 0);
  })();
  const isStreamingRequest =
    method?.callType === 'client_stream' || method?.callType === 'bidi';

  const discover = async (): Promise<void> => {
    if (!req.target.address.trim()) {
      toast('error', 'Enter a server address first.');
      return;
    }
    patchTab(tab.id, { discovering: true, error: undefined } as Partial<GrpcTab>);
    try {
      const services = await window.crafillio.grpc.describe(req.source, req.target, true);
      patchTab(tab.id, { services, discovering: false } as Partial<GrpcTab>);

      // Select the first method automatically so the editor is usable at once.
      const first = services[0];
      if (first && !req.service) {
        selectMethod(first.name, first.methods[0]?.name ?? '', services);
      }
      toast('success', `Found ${services.length} service${services.length === 1 ? '' : 's'}`);
    } catch (err) {
      patchTab(tab.id, {
        discovering: false,
        error: (err as Error).message,
      } as Partial<GrpcTab>);
    }
  };

  const selectMethod = (
    serviceName: string,
    methodName: string,
    services = tab.services,
  ): void => {
    const svc = services.find((s) => s.name === serviceName);
    const m = svc?.methods.find((x) => x.name === methodName);
    patchTab(tab.id, {
      request: {
        ...req,
        service: serviceName,
        method: methodName,
        // Prefill from the schema so the user starts from a valid shape.
        messages: [m?.inputExample ?? '{}'],
      },
      dirty: true,
    } as Partial<GrpcTab>);
  };

  const chooseProtos = async (): Promise<void> => {
    const files = await window.crafillio.dialog.openFiles({
      filters: [{ name: 'Protocol buffers', extensions: ['proto'] }],
      multiple: true,
    });
    if (files.length === 0) return;

    // Default the include path to each file's own directory, which covers the
    // common case of imports that sit alongside the chosen files.
    const includeDirs = [...new Set(files.map((f) => f.path.replace(/\/[^/]+$/, '')))];
    patch({ source: { kind: 'proto', files: files.map((f) => f.path), includeDirs } });
  };

  return (
    <div className="pane">
      <div className="grpc-toolbar">
        <input
          className="input input-mono"
          style={{ flex: 1, minWidth: 200 }}
          value={req.target.address}
          placeholder="localhost:50051"
          spellCheck={false}
          onChange={(e) => patch({ target: { ...req.target, address: e.target.value } })}
        />

        <label className="inline-check">
          <input
            type="checkbox"
            className="checkbox"
            checked={req.target.tls}
            onChange={(e) => patch({ target: { ...req.target, tls: e.target.checked } })}
          />
          TLS
        </label>

        <select
          className="select"
          value={req.source.kind}
          onChange={(e) => {
            const kind = e.target.value as GrpcSource['kind'];
            patch({
              source: kind === 'reflection' ? { kind: 'reflection' } : { kind: 'proto', files: [], includeDirs: [] },
            });
            patchTab(tab.id, { services: [] } as Partial<GrpcTab>);
          }}
        >
          <option value="reflection">Server reflection</option>
          <option value="proto">.proto files</option>
        </select>

        {req.source.kind === 'proto' && (
          <button className="btn" onClick={chooseProtos}>
            <FileCode2 size={14} />
            {req.source.files.length > 0
              ? `${req.source.files.length} file${req.source.files.length === 1 ? '' : 's'}`
              : 'Choose .proto'}
          </button>
        )}

        <button className="btn" onClick={discover} disabled={tab.discovering}>
          {tab.discovering ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          Discover
        </button>
      </div>

      <div className="grpc-toolbar" style={{ paddingTop: 0 }}>
        {/* One picker, grouped by service, instead of two dependent ones.
            A method belongs to exactly one service, so making the user choose
            the service first was asking for information the choice already
            implies — and left the method list disabled until they did. */}
        <input
          className="input"
          style={{ flex: '0 1 170px', minWidth: 110 }}
          value={methodFilter}
          placeholder="Filter methods…"
          spellCheck={false}
          title="Narrows the list below. Useful when reflection returns hundreds of methods."
          onChange={(e) => setMethodFilter(e.target.value)}
        />

        <select
          className="select"
          style={{ flex: 1, minWidth: 220 }}
          value={req.service && req.method ? `${req.service}/${req.method}` : ''}
          title="Every method, grouped by the service it belongs to"
          onChange={(e) => {
            const [svc, ...rest] = e.target.value.split('/');
            if (svc && rest.length) selectMethod(svc, rest.join('/'));
          }}
        >
          <option value="">
            {tab.services.length ? 'Select a method…' : 'No services — run Discover'}
          </option>
          {visibleServices.map((s) => (
            <optgroup key={s.name} label={s.name}>
              {s.methods.map((m) => (
                <option key={`${s.name}/${m.name}`} value={`${s.name}/${m.name}`}>
                  {m.name}
                  {m.callType === 'unary' ? '' : `  · ${m.callType.replace('_', ' ')}`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {method && <span className="meta">{method.callType.replace('_', ' ')}</span>}

        {tab.running ? (
          <button
            className="btn btn-danger"
            onClick={() => {
              if (tab.callId) void window.crafillio.grpc.cancel(tab.callId);
              patchTab(tab.id, { running: false } as Partial<GrpcTab>);
            }}
          >
            <Square size={13} /> Cancel
          </button>
        ) : (
          <>
            <button
              className="btn btn-icon"
              title="Copy a screenshot of this call and response to the clipboard"
              onClick={async () => {
                try {
                  await window.crafillio.tools.capture(captureForGrpc(tab, true), 'clipboard');
                  toast('success', 'Screenshot copied');
                } catch (err) {
                  toast('error', (err as Error).message);
                }
              }}
            >
              <ClipboardCopy size={14} />
            </button>

            <button
              className="btn btn-icon"
              title="Save a screenshot of this call and its response"
              onClick={async () => {
                try {
                  const path = await window.crafillio.tools.capture(captureForGrpc(tab, true), 'file');
                  if (path) toast('success', `Saved ${path}`);
                } catch (err) {
                  toast('error', (err as Error).message);
                }
              }}
            >
              <Camera size={14} />
            </button>

            <button className="btn btn-primary" onClick={onSend} disabled={!req.method}>
              <Send size={14} /> Invoke
            </button>
          </>
        )}
      </div>

      {sub === 'perf' ? (
        <>
          <div className="subtabs">
            <button className="subtab" onClick={() => setSub('message')}>Message</button>
            <button className="subtab" onClick={() => setSub('metadata')}>Metadata</button>
            <button className="subtab" onClick={() => setSub('settings')}>Settings</button>
            <button className="subtab subtab-perf active">
              <Gauge size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              Load test
            </button>
          </div>
          <PerfPanel tab={tab} />
        </>
      ) : (
      <Split
        id="grpc"
        top={
        <div className="pane">
          <div className="subtabs">
            <button
              className={`subtab ${sub === 'message' ? 'active' : ''}`}
              onClick={() => setSub('message')}
            >
              Message
              {req.messages.length > 1 && <span className="count">{req.messages.length}</span>}
            </button>
            <button
              className={`subtab ${sub === 'metadata' ? 'active' : ''}`}
              onClick={() => setSub('metadata')}
            >
              Metadata
            </button>
            <button
              className={`subtab ${sub === 'settings' ? 'active' : ''}`}
              onClick={() => setSub('settings')}
            >
              Settings
            </button>
            {/* Never the active tab in this branch — the perf view replaces it. */}
            <button className="subtab subtab-perf" onClick={() => setSub('perf')}>
              <Gauge size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              Load test
            </button>

            {method && (
              <div className="subtabs-right">
                <span className="meta">{method.inputType}</span>
              </div>
            )}
          </div>

          <div className="tab-body">
            {sub === 'message' && (
              <MessageEditor
                messages={req.messages}
                streaming={isStreamingRequest}
                onChange={(messages) => patch({ messages })}
              />
            )}

            {sub === 'metadata' && (
              <KeyValueTable
                rows={req.metadata}
                onChange={(metadata) => patch({ metadata })}
                keyPlaceholder="metadata-key"
              />
            )}

            {sub === 'settings' && (
              <div
                style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520 }}
              >
                <div className="field">
                  <label>Timeout (ms) — 0 for no deadline</label>
                  <input
                    className="input input-mono"
                    type="number"
                    min={0}
                    value={req.timeoutMs}
                    onChange={(e) => patch({ timeoutMs: Number(e.target.value) })}
                  />
                </div>

                <label className="inline-check">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={req.target.insecureTls}
                    onChange={(e) =>
                      patch({ target: { ...req.target, insecureTls: e.target.checked } })
                    }
                  />
                  Ignore TLS certificate errors
                </label>

                <div className="field">
                  <label>Server name override (SNI)</label>
                  <input
                    className="input input-mono"
                    value={req.target.serverNameOverride ?? ''}
                    placeholder="Leave blank to use the address"
                    onChange={(e) =>
                      patch({ target: { ...req.target, serverNameOverride: e.target.value } })
                    }
                  />
                </div>

                {req.source.kind === 'proto' && (
                  <div className="field">
                    <label>Import paths</label>
                    <span className="hint">
                      {req.source.includeDirs.join('\n') || 'None — imports resolve alongside each file.'}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        }
        bottom={<EventTimeline tab={tab} />}
      />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MessageEditor({
  messages,
  streaming,
  onChange,
}: {
  messages: string[];
  streaming: boolean;
  onChange: (messages: string[]) => void;
}) {
  if (!streaming) {
    return (
      <CodeEditor
        value={messages[0] ?? '{}'}
        language="json"
        onChange={(text) => onChange([text])}
      />
    );
  }

  // Client-streaming and bidi calls send a sequence, so each message gets its
  // own editor rather than being crammed into one document.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', alignItems: 'center' }}>
        <span className="meta">{messages.length} message(s) will be streamed in order</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => onChange([...messages, '{}'])}>
          <Plus size={12} /> Add message
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {messages.map((message, index) => (
          <div key={index} style={{ borderBottom: '1px solid var(--border)' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 12px',
                background: 'var(--surface)',
              }}
            >
              <span className="meta">#{index + 1}</span>
              <div style={{ flex: 1 }} />
              {messages.length > 1 && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onChange(messages.filter((_, i) => i !== index))}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <div style={{ height: 180 }}>
              <CodeEditor
                value={message}
                language="json"
                onChange={(text) =>
                  onChange(messages.map((m, i) => (i === index ? text : m)))
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventTimeline({ tab }: { tab: GrpcTab }) {
  if (tab.error) {
    return (
      <div className="response">
        <div className="error-box">{tab.error}</div>
      </div>
    );
  }

  if (tab.events.length === 0) {
    return (
      <div className="response">
        <div className="placeholder">
          <div>No events yet</div>
          <div>Discover a service, pick a method, then Invoke.</div>
        </div>
      </div>
    );
  }

  const messageCount = tab.events.filter((e) => e.type === 'message').length;
  const status = tab.events.find((e) => e.type === 'status');

  return (
    <div className="response">
      <div className="response-status">
        {status?.type === 'status' && (
          <span className={`status-pill ${status.code === 0 ? 'status-2xx' : 'status-5xx'}`}>
            {status.codeName}
          </span>
        )}
        {tab.running && <span className="meta">streaming…</span>}
        <span className="meta">
          <strong>{messageCount}</strong> message{messageCount === 1 ? '' : 's'}
        </span>
        {status?.type === 'status' && (
          <span className="meta">
            <strong>{formatMs(status.totalMs)}</strong>
          </span>
        )}
      </div>

      <div className="tab-body">
        <div className="event-list">
          {tab.events.map((event, index) => (
            <EventCard key={index} event={event} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EventCard({ event }: { event: GrpcEvent }) {
  if (event.type === 'metadata' || event.type === 'trailers') {
    const entries = Object.entries(event.metadata);
    if (entries.length === 0) return null;
    return (
      <div className="event">
        <div className="event-head">
          <span className="event-kind metadata">{event.type}</span>
        </div>
        <pre>{entries.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
      </div>
    );
  }

  if (event.type === 'message') {
    return (
      <div className="event">
        <div className="event-head">
          <span className="event-kind message">message #{event.index + 1}</span>
          <span>{formatMs(event.atMs)}</span>
        </div>
        <pre>{event.json}</pre>
      </div>
    );
  }

  if (event.type === 'error') {
    return (
      <div className="event">
        <div className="event-head">
          <span className="event-kind status-err">{event.codeName ?? 'error'}</span>
        </div>
        <pre style={{ color: 'var(--red)' }}>{event.message}</pre>
      </div>
    );
  }

  return (
    <div className="event">
      <div className="event-head">
        <span className={`event-kind ${event.code === 0 ? 'status-ok' : 'status-err'}`}>
          status {event.codeName}
        </span>
        <span>{formatMs(event.totalMs)}</span>
      </div>
      {event.details && event.details !== 'OK' && <pre>{event.details}</pre>}
    </div>
  );
}
