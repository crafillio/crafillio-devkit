import { useState } from 'react';
import { FileUp, Gauge, Send, Loader2 } from 'lucide-react';
import type { Auth, HttpMethod, RestBody, RestRequest } from '@crafillio/core';
import { KeyValueTable } from './KeyValueTable';
import { CodeEditor } from './CodeEditor';
import { blankMultipart, blankRow, withTrailingBlank } from '../lib/defaults';
import { useStore, type RestTab } from '../state/store';
import { ResponsePanel } from './ResponsePanel';
import { PerfPanel } from './PerfPanel';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
type SubTab = 'params' | 'headers' | 'body' | 'auth' | 'settings' | 'perf';

interface Props {
  tab: RestTab;
  onSend: () => void;
}

export function RestPanel({ tab, onSend }: Props) {
  const [sub, setSub] = useState<SubTab>('params');
  const patchTab = useStore((s) => s.patchTab);

  const patch = (partial: Partial<RestRequest>): void => {
    patchTab(tab.id, { request: { ...tab.request, ...partial }, dirty: true } as Partial<RestTab>);
  };

  const req = tab.request;
  const activeCount = (rows: { key: string; enabled: boolean }[]): number =>
    rows.filter((r) => r.enabled && r.key.trim()).length;

  return (
    <div className="pane">
      <div className="reqbar">
        <select
          className="select method-select"
          value={req.method}
          onChange={(e) => patch({ method: e.target.value as HttpMethod })}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <input
          className="input url"
          value={req.url}
          placeholder="https://api.example.com/v1/users  —  {{variables}} supported"
          spellCheck={false}
          onChange={(e) => patch({ url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
          }}
        />

        <button className="btn btn-primary" onClick={onSend} disabled={tab.sending}>
          {tab.sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          {tab.sending ? 'Sending' : 'Send'}
        </button>
      </div>

      {sub === 'perf' ? (
        <>
          <div className="subtabs">
            <Sub id="params" label="Params" count={activeCount(req.query)} sub={sub} setSub={setSub} />
            <Sub id="headers" label="Headers" count={activeCount(req.headers)} sub={sub} setSub={setSub} />
            <Sub id="body" label="Body" dot={req.body.kind !== 'none'} sub={sub} setSub={setSub} />
            <Sub id="auth" label="Auth" dot={req.auth.kind !== 'none'} sub={sub} setSub={setSub} />
            <Sub id="settings" label="Settings" sub={sub} setSub={setSub} />
            <Sub id="perf" label="Load test" icon sub={sub} setSub={setSub} />
          </div>
          <PerfPanel tab={tab} />
        </>
      ) : (
      <div className="split">
        <div className="pane">
          <div className="subtabs">
            <Sub id="params" label="Params" count={activeCount(req.query)} sub={sub} setSub={setSub} />
            <Sub id="headers" label="Headers" count={activeCount(req.headers)} sub={sub} setSub={setSub} />
            <Sub id="body" label="Body" dot={req.body.kind !== 'none'} sub={sub} setSub={setSub} />
            <Sub id="auth" label="Auth" dot={req.auth.kind !== 'none'} sub={sub} setSub={setSub} />
            <Sub id="settings" label="Settings" sub={sub} setSub={setSub} />
            <Sub id="perf" label="Load test" icon sub={sub} setSub={setSub} />
          </div>

          <div className="tab-body">
            {sub === 'params' && (
              <KeyValueTable
                rows={req.query}
                onChange={(query) => patch({ query })}
                keyPlaceholder="Parameter"
              />
            )}
            {sub === 'headers' && (
              <KeyValueTable
                rows={req.headers}
                onChange={(headers) => patch({ headers })}
                keyPlaceholder="Header"
              />
            )}
            {sub === 'body' && <BodyEditor body={req.body} onChange={(body) => patch({ body })} />}
            {sub === 'auth' && <AuthEditor auth={req.auth} onChange={(auth) => patch({ auth })} />}
            {sub === 'settings' && <SettingsEditor req={req} patch={patch} />}
          </div>
        </div>

        <div className="splitter" />

        <ResponsePanel tab={tab} />
      </div>
      )}
    </div>
  );
}

function Sub({
  id,
  label,
  count,
  dot,
  icon,
  sub,
  setSub,
}: {
  id: SubTab;
  label: string;
  count?: number;
  dot?: boolean;
  icon?: boolean;
  sub: SubTab;
  setSub: (s: SubTab) => void;
}) {
  return (
    <button
      className={`subtab ${sub === id ? 'active' : ''} ${icon ? 'subtab-perf' : ''}`}
      onClick={() => setSub(id)}
    >
      {icon && <Gauge size={12} style={{ verticalAlign: -2, marginRight: 4 }} />}
      {label}
      {count ? <span className="count">{count}</span> : null}
      {dot && !count ? <span className="count">•</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */

const BODY_KINDS: Array<{ value: RestBody['kind']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Raw text' },
  { value: 'form', label: 'Form URL-encoded' },
  { value: 'multipart', label: 'Multipart form' },
  { value: 'binary', label: 'Binary file' },
];

function BodyEditor({ body, onChange }: { body: RestBody; onChange: (b: RestBody) => void }) {
  const switchKind = (kind: RestBody['kind']): void => {
    switch (kind) {
      case 'none':
        return onChange({ kind: 'none' });
      case 'json':
        return onChange({ kind: 'json', text: body.kind === 'json' ? body.text : '{\n  \n}' });
      case 'text':
        return onChange({ kind: 'text', text: '', contentType: 'text/plain' });
      case 'form':
        return onChange({ kind: 'form', fields: [blankRow()] });
      case 'multipart':
        return onChange({ kind: 'multipart', fields: [blankMultipart()] });
      case 'binary':
        return onChange({ kind: 'binary', filePath: '' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', alignItems: 'center' }}>
        <select
          className="select"
          value={body.kind}
          onChange={(e) => switchKind(e.target.value as RestBody['kind'])}
        >
          {BODY_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>

        {body.kind === 'text' && (
          <input
            className="input input-mono"
            style={{ width: 220 }}
            value={body.contentType}
            placeholder="Content-Type"
            onChange={(e) => onChange({ ...body, contentType: e.target.value })}
          />
        )}
      </div>

      {body.kind === 'none' && (
        <div className="placeholder">This request sends no body.</div>
      )}

      {(body.kind === 'json' || body.kind === 'text') && (
        <CodeEditor
          value={body.text}
          language={body.kind === 'json' ? 'json' : 'text'}
          onChange={(text) => onChange({ ...body, text })}
        />
      )}

      {body.kind === 'form' && (
        <KeyValueTable
          rows={body.fields}
          onChange={(fields) => onChange({ ...body, fields })}
          keyPlaceholder="Field"
        />
      )}

      {body.kind === 'multipart' && <MultipartEditor body={body} onChange={onChange} />}

      {body.kind === 'binary' && (
        <div style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn"
            onClick={async () => {
              const [file] = await window.crafillio.dialog.openFiles();
              if (file) onChange({ kind: 'binary', filePath: file.path });
            }}
          >
            <FileUp size={14} /> Choose file
          </button>
          <span className="meta">{body.filePath || 'No file chosen'}</span>
        </div>
      )}
    </div>
  );
}

function MultipartEditor({
  body,
  onChange,
}: {
  body: Extract<RestBody, { kind: 'multipart' }>;
  onChange: (b: RestBody) => void;
}) {
  const rows = withTrailingBlank(body.fields, blankMultipart);

  const update = (id: string, patch: Partial<(typeof rows)[number]>): void => {
    const next = rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    onChange({ ...body, fields: withTrailingBlank(next, blankMultipart) });
  };

  return (
    <table className="kv">
      <thead>
        <tr>
          <th style={{ width: 34 }} />
          <th>Field</th>
          <th style={{ width: 90 }}>Type</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={`kv-row ${row.enabled ? '' : 'disabled'}`}>
            <td className="kv-check">
              <input
                type="checkbox"
                className="checkbox"
                checked={row.enabled}
                onChange={(e) => update(row.id, { enabled: e.target.checked })}
              />
            </td>
            <td>
              <input
                className="kv-input"
                value={row.key}
                placeholder="Name"
                onChange={(e) => update(row.id, { key: e.target.value })}
              />
            </td>
            <td>
              <select
                className="kv-input"
                value={row.type}
                onChange={(e) => update(row.id, { type: e.target.value as 'text' | 'file' })}
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
            </td>
            <td>
              {row.type === 'file' ? (
                <button
                  className="kv-input"
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                  onClick={async () => {
                    const [file] = await window.crafillio.dialog.openFiles();
                    if (file) update(row.id, { filePath: file.path, value: file.name });
                  }}
                >
                  {row.value || 'Choose file…'}
                </button>
              ) : (
                <input
                  className="kv-input"
                  value={row.value}
                  placeholder="Value"
                  onChange={(e) => update(row.id, { value: e.target.value })}
                />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuthEditor({ auth, onChange }: { auth: Auth; onChange: (a: Auth) => void }) {
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
      <div className="field">
        <label>Type</label>
        <select
          className="select"
          value={auth.kind}
          onChange={(e) => {
            const kind = e.target.value as Auth['kind'];
            if (kind === 'none') onChange({ kind: 'none' });
            else if (kind === 'bearer') onChange({ kind: 'bearer', token: '' });
            else if (kind === 'basic') onChange({ kind: 'basic', username: '', password: '' });
            else onChange({ kind: 'apiKey', key: '', value: '', in: 'header' });
          }}
        >
          <option value="none">No auth</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic</option>
          <option value="apiKey">API key</option>
        </select>
      </div>

      {auth.kind === 'bearer' && (
        <div className="field">
          <label>Token</label>
          <input
            className="input input-mono"
            value={auth.token}
            placeholder="{{token}}"
            onChange={(e) => onChange({ ...auth, token: e.target.value })}
          />
          <span className="hint">
            Reference an environment variable so the token never lands in the saved collection.
          </span>
        </div>
      )}

      {auth.kind === 'basic' && (
        <div className="field-row">
          <div className="field">
            <label>Username</label>
            <input
              className="input"
              value={auth.username}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={auth.password}
              onChange={(e) => onChange({ ...auth, password: e.target.value })}
            />
          </div>
        </div>
      )}

      {auth.kind === 'apiKey' && (
        <>
          <div className="field-row">
            <div className="field">
              <label>Key</label>
              <input
                className="input input-mono"
                value={auth.key}
                placeholder="X-API-Key"
                onChange={(e) => onChange({ ...auth, key: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Value</label>
              <input
                className="input input-mono"
                value={auth.value}
                placeholder="{{apiKey}}"
                onChange={(e) => onChange({ ...auth, value: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label>Send in</label>
            <select
              className="select"
              value={auth.in}
              onChange={(e) => onChange({ ...auth, in: e.target.value as 'header' | 'query' })}
            >
              <option value="header">Header</option>
              <option value="query">Query parameter</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsEditor({
  req,
  patch,
}: {
  req: RestRequest;
  patch: (p: Partial<RestRequest>) => void;
}) {
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520 }}>
      <div className="field">
        <label>Timeout (ms) — 0 for no timeout</label>
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
          checked={req.followRedirects}
          onChange={(e) => patch({ followRedirects: e.target.checked })}
        />
        Follow redirects
      </label>

      {req.followRedirects && (
        <div className="field">
          <label>Maximum redirects</label>
          <input
            className="input input-mono"
            type="number"
            min={0}
            style={{ width: 120 }}
            value={req.maxRedirects}
            onChange={(e) => patch({ maxRedirects: Number(e.target.value) })}
          />
        </div>
      )}

      <label className="inline-check">
        <input
          type="checkbox"
          className="checkbox"
          checked={req.insecureTls}
          onChange={(e) => patch({ insecureTls: e.target.checked })}
        />
        Ignore TLS certificate errors
      </label>
      <span className="hint" style={{ marginTop: -8 }}>
        Only for local or staging servers with self-signed certificates.
      </span>
    </div>
  );
}
