import { FileUp, Trash2 } from 'lucide-react';
import type { RestBody } from '@crafillio/core';
import { CodeEditor } from './CodeEditor';
import { KeyValueTable } from './KeyValueTable';
import { blankMultipart, blankRow, withTrailingBlank } from '../lib/defaults';

/**
 * Request body editor.
 *
 * Shared by the REST panel and workflow steps — a workflow step is a request,
 * so it needs the same body options, file pickers included.
 */

const BODY_KINDS: Array<{ value: RestBody['kind']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Raw text' },
  { value: 'form', label: 'Form URL-encoded' },
  { value: 'multipart', label: 'Multipart form' },
  { value: 'binary', label: 'Binary file' },
];

export function BodyEditor({ body, onChange }: { body: RestBody; onChange: (b: RestBody) => void }) {
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
