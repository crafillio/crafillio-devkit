import { useState } from 'react';
import { Camera, ClipboardCopy, Gauge, Send, Loader2 } from 'lucide-react';
import { captureForRest } from '../lib/capture';
import type { Auth, HttpMethod, RestBody, RestRequest } from '@crafillio/core';
import { KeyValueTable } from './KeyValueTable';
import { BodyEditor } from './BodyEditor';
import { CodeEditor } from './CodeEditor';
import { blankRow } from '../lib/defaults';
import { useStore, type RestTab } from '../state/store';
import { ResponsePanel } from './ResponsePanel';
import { Split } from './Split';
import { useT } from '../i18n';
import { PerfPanel } from './PerfPanel';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
type SubTab = 'params' | 'headers' | 'body' | 'auth' | 'settings' | 'perf';

interface Props {
  tab: RestTab;
  onSend: () => void;
}

export function RestPanel({ tab, onSend }: Props) {
  const toast = useStore((state) => state.toast);
  const t = useT();
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
          placeholder={t.request.urlPlaceholder}
          spellCheck={false}
          onChange={(e) => patch({ url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
          }}
        />

        <button
          className="btn btn-icon"
          title="Copy a screenshot of this request and response to the clipboard"
          onClick={async () => {
            try {
              // Secrets are redacted: a screenshot is the single most likely
              // artefact to end up in a ticket or a chat thread.
              await window.crafillio.tools.capture(captureForRest(tab, true), 'clipboard');
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
          title="Save a screenshot of this request and its response"
          onClick={async () => {
            try {
              const path = await window.crafillio.tools.capture(captureForRest(tab, true), 'file');
              if (path) toast('success', `Saved ${path}`);
            } catch (err) {
              toast('error', (err as Error).message);
            }
          }}
        >
          <Camera size={14} />
        </button>

        <button className="btn btn-primary" onClick={onSend} disabled={tab.sending}>
          {tab.sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          {tab.sending ? t.request.sending : t.common.send}
        </button>
      </div>

      {sub === 'perf' ? (
        <>
          <div className="subtabs">
            <Sub id="params" label={t.request.params} count={activeCount(req.query)} sub={sub} setSub={setSub} />
            <Sub id="headers" label={t.request.headers} count={activeCount(req.headers)} sub={sub} setSub={setSub} />
            <Sub id="body" label={t.request.body} dot={req.body.kind !== 'none'} sub={sub} setSub={setSub} />
            <Sub id="auth" label={t.request.auth} dot={req.auth.kind !== 'none'} sub={sub} setSub={setSub} />
            <Sub id="settings" label={t.request.settings} sub={sub} setSub={setSub} />
            <Sub id="perf" label={t.request.loadTest} icon sub={sub} setSub={setSub} />
          </div>
          <PerfPanel tab={tab} />
        </>
      ) : (
      <Split
        id="rest"
        top={
        <div className="pane">
          <div className="subtabs">
            <Sub id="params" label={t.request.params} count={activeCount(req.query)} sub={sub} setSub={setSub} />
            <Sub id="headers" label={t.request.headers} count={activeCount(req.headers)} sub={sub} setSub={setSub} />
            <Sub id="body" label={t.request.body} dot={req.body.kind !== 'none'} sub={sub} setSub={setSub} />
            <Sub id="auth" label={t.request.auth} dot={req.auth.kind !== 'none'} sub={sub} setSub={setSub} />
            <Sub id="settings" label={t.request.settings} sub={sub} setSub={setSub} />
            <Sub id="perf" label={t.request.loadTest} icon sub={sub} setSub={setSub} />
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
                autocomplete="headers"
              />
            )}
            {sub === 'body' && <BodyEditor body={req.body} onChange={(body) => patch({ body })} />}
            {sub === 'auth' && <AuthEditor auth={req.auth} onChange={(auth) => patch({ auth })} />}
            {sub === 'settings' && <SettingsEditor req={req} patch={patch} />}
          </div>
        </div>

        }
        bottom={<ResponsePanel tab={tab} />}
      />
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
