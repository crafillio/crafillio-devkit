import { useMemo, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { formatBytes, formatMs, languageFor, statusClass, tryPrettyJson } from '../lib/format';
import { useStore, type RestTab } from '../state/store';

type View = 'body' | 'headers' | 'raw';

export function ResponsePanel({ tab }: { tab: RestTab }) {
  const [view, setView] = useState<View>('body');
  const toast = useStore((s) => s.toast);
  const res = tab.response;

  const pretty = useMemo(() => {
    if (!res || res.bodyEncoding === 'base64') return '';
    return tryPrettyJson(res.body);
  }, [res]);

  if (tab.error) {
    return (
      <div className="response">
        <div className="error-box">{tab.error}</div>
      </div>
    );
  }

  if (!res) {
    return (
      <div className="response">
        <div className="placeholder">
          <div>No response yet</div>
          <div>
            Press <kbd>⌘</kbd> <kbd>↵</kbd> or hit Send
          </div>
        </div>
      </div>
    );
  }

  const contentType = res.headers['content-type'] ?? '';
  const headerRows = Object.entries(res.headers).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="response">
      <div className="response-status">
        <span className={`status-pill ${statusClass(res.status)}`}>{res.status}</span>
        <span className="meta">
          <strong>{formatMs(res.timing.totalMs)}</strong> total
        </span>
        <span className="meta">
          <strong>{formatMs(res.timing.firstByteMs)}</strong> to first byte
        </span>
        <span className="meta">
          <strong>{formatBytes(res.size)}</strong>
        </span>
        {res.redirects.length > 0 && (
          <span className="meta">
            <strong>{res.redirects.length}</strong> redirect
            {res.redirects.length === 1 ? '' : 's'}
          </span>
        )}

        <div style={{ flex: 1 }} />

        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void navigator.clipboard.writeText(res.body);
            toast('success', 'Response body copied');
          }}
          title="Copy body"
        >
          <Copy size={13} />
        </button>
        <button
          className="btn btn-ghost btn-sm"
          title="Save body to a file"
          onClick={async () => {
            const name = /json/i.test(contentType) ? 'response.json' : 'response.txt';
            const path = await window.crafillio.dialog.saveTextFile(name, res.body);
            if (path) toast('success', `Saved to ${path}`);
          }}
        >
          <Download size={13} />
        </button>
      </div>

      <div className="subtabs">
        <button
          className={`subtab ${view === 'body' ? 'active' : ''}`}
          onClick={() => setView('body')}
        >
          Body
        </button>
        <button
          className={`subtab ${view === 'headers' ? 'active' : ''}`}
          onClick={() => setView('headers')}
        >
          Headers<span className="count">{headerRows.length}</span>
        </button>
        <button className={`subtab ${view === 'raw' ? 'active' : ''}`} onClick={() => setView('raw')}>
          Raw
        </button>

        {tab.missingVars.length > 0 && (
          <div className="subtabs-right" style={{ color: 'var(--amber)' }}>
            Undefined variables: {tab.missingVars.join(', ')}
          </div>
        )}
      </div>

      <div className="tab-body">
        {view === 'body' &&
          (res.bodyEncoding === 'base64' ? (
            <div className="placeholder">
              <div>Binary response — {formatBytes(res.size)}</div>
              <div className="meta">{contentType || 'unknown content type'}</div>
            </div>
          ) : (
            <CodeEditor value={pretty} readOnly language={languageFor(contentType)} />
          ))}

        {view === 'headers' && (
          <table className="kv">
            <tbody>
              {headerRows.map(([key, value]) => (
                <tr key={key}>
                  <td style={{ width: '35%' }}>
                    <div className="kv-input" style={{ color: 'var(--text-muted)' }}>
                      {key}
                    </div>
                  </td>
                  <td>
                    <div className="kv-input" style={{ wordBreak: 'break-all' }}>
                      {value}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {view === 'raw' && (
          <CodeEditor
            value={res.bodyEncoding === 'base64' ? '(binary body, base64)\n\n' + res.body : res.body}
            readOnly
            language="text"
            wrap={false}
          />
        )}
      </div>
    </div>
  );
}
