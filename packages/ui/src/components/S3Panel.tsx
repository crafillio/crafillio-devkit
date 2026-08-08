import { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  Download,
  File,
  Folder,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import type { S3Bucket, S3ListResult, S3ObjectDetail } from '@crafillio/core';
import { formatBytes, formatDate } from '../lib/format';
import { useStore, type S3Tab } from '../state/store';
import { askConfirm, askName } from '../state/dialogs';

export function S3Panel({ tab }: { tab: S3Tab }) {
  const connections = useStore((s) => s.connections);
  const patchTab = useStore((s) => s.patchTab);
  const toast = useStore((s) => s.toast);

  const [buckets, setBuckets] = useState<S3Bucket[]>([]);
  const [listing, setListing] = useState<S3ListResult | null>(null);
  const [detail, setDetail] = useState<S3ObjectDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<number | null>(null);

  const connection = connections.find((c) => c.id === tab.connectionId);

  const patch = (partial: Partial<S3Tab>): void => patchTab(tab.id, partial as never);

  /* -------------------------------------------------------------- */

  const loadBuckets = useCallback(async () => {
    if (!connection) return;
    setBusy(true);
    setError(null);
    try {
      setBuckets(await window.crafillio.s3.listBuckets(connection));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [connection]);

  const loadObjects = useCallback(async () => {
    if (!connection || !tab.bucket) {
      setListing(null);
      return;
    }
    setBusy(true);
    setError(null);
    setSelected(new Set());
    try {
      setListing(await window.crafillio.s3.listObjects(connection, tab.bucket, tab.prefix));
    } catch (err) {
      setError((err as Error).message);
      setListing(null);
    } finally {
      setBusy(false);
    }
  }, [connection, tab.bucket, tab.prefix]);

  useEffect(() => {
    void loadBuckets();
  }, [loadBuckets]);

  useEffect(() => {
    void loadObjects();
  }, [loadObjects]);

  useEffect(() => {
    return window.crafillio.s3.onProgress((_id, loaded, total) => {
      setProgress(total > 0 ? Math.round((loaded / total) * 100) : null);
    });
  }, []);

  const openDetail = async (key: string): Promise<void> => {
    if (!connection) return;
    patch({ selectedKey: key });
    try {
      setDetail(await window.crafillio.s3.head(connection, tab.bucket, key));
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  /* -------------------------------------------------------------- */

  const upload = async (): Promise<void> => {
    if (!connection || !tab.bucket) return;
    const files = await window.crafillio.dialog.openFiles({ multiple: true });
    if (files.length === 0) return;

    setBusy(true);
    setProgress(0);
    try {
      for (const file of files) {
        await window.crafillio.s3.upload(connection, tab.bucket, tab.prefix, file.path);
      }
      toast('success', `Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`);
      await loadObjects();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const download = async (key: string): Promise<void> => {
    if (!connection) return;
    setProgress(0);
    try {
      const result = await window.crafillio.s3.download(connection, tab.bucket, key);
      if (result) toast('success', `Saved to ${result.path}`);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const removeSelected = async (): Promise<void> => {
    if (!connection || selected.size === 0) return;
    const keys = [...selected];
    // Deletions are not recoverable unless the bucket is versioned, so this
    // always confirms — including the count, which is the part people misjudge.
    const ok = await askConfirm({
      title: 'Delete objects',
      message: `Permanently delete ${keys.length} object${keys.length === 1 ? '' : 's'}?\n\nThis cannot be undone unless the bucket has versioning enabled.`,
      confirmLabel: `Delete ${keys.length}`,
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const result = await window.crafillio.s3.deleteObjects(connection, tab.bucket, keys);
      if (result.errors.length > 0) {
        toast('error', `${result.errors.length} object(s) could not be deleted: ${result.errors[0]?.message}`);
      } else {
        toast('success', `Deleted ${result.deleted.length} object(s)`);
      }
      setDetail(null);
      await loadObjects();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeFolder = async (prefix: string): Promise<void> => {
    if (!connection) return;
    const ok = await askConfirm({
      title: 'Delete folder',
      message: `Permanently delete everything under "${prefix}"?\n\nThis cannot be undone unless the bucket has versioning enabled.`,
      confirmLabel: 'Delete all',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await window.crafillio.s3.deletePrefix(connection, tab.bucket, prefix);
      toast('success', `Deleted ${result.deleted.length} object(s)`);
      await loadObjects();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyPresigned = async (key: string): Promise<void> => {
    if (!connection) return;
    try {
      const url = await window.crafillio.s3.presign(connection, tab.bucket, key, 'get', 3600);
      await navigator.clipboard.writeText(url);
      toast('success', 'Presigned URL copied — valid for 1 hour');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  /* -------------------------------------------------------------- */

  if (connections.length === 0) {
    return (
      <div className="placeholder">
        <div>No S3 connections yet</div>
        <div className="meta">
          Add one from the sidebar to browse buckets, upload files and edit metadata.
        </div>
      </div>
    );
  }

  const crumbs = tab.prefix.split('/').filter(Boolean);

  return (
    <div className="pane">
      <div className="s3-toolbar">
        <select
          className="select"
          value={tab.connectionId}
          onChange={(e) => {
            patch({ connectionId: e.target.value, bucket: '', prefix: '', selectedKey: undefined });
            setDetail(null);
          }}
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          className="select"
          style={{ minWidth: 180 }}
          value={tab.bucket}
          onChange={(e) => {
            patch({ bucket: e.target.value, prefix: '', selectedKey: undefined, dirty: true });
            setDetail(null);
          }}
        >
          <option value="">Select a bucket…</option>
          {buckets.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>

        <button
          className="btn btn-icon"
          onClick={() => void loadObjects()}
          title="Reload this bucket listing"
        >
          {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
        </button>

        <div style={{ flex: 1 }} />

        <button className="btn" onClick={upload} disabled={!tab.bucket || busy}>
          <Upload size={14} /> Upload
        </button>

        <button
          className="btn btn-danger"
          onClick={removeSelected}
          disabled={selected.size === 0 || busy}
        >
          <Trash2 size={14} /> Delete{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>

      {progress !== null && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}

      {tab.bucket && (
        <div className="breadcrumbs">
          <button className="crumb" onClick={() => patch({ prefix: '' })}>
            {tab.bucket}
          </button>
          {crumbs.map((crumb, index) => (
            <span key={index} style={{ display: 'contents' }}>
              <ChevronRight size={12} />
              <button
                className="crumb"
                onClick={() => patch({ prefix: crumbs.slice(0, index + 1).join('/') + '/' })}
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      <div className="s3-layout">
        <div className="s3-main">
          <div className="tab-body">
            {!tab.bucket ? (
              <div className="placeholder">Pick a bucket to start browsing.</div>
            ) : (
              <table className="obj-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Name</th>
                    <th style={{ width: 100, textAlign: 'right' }}>Size</th>
                    <th style={{ width: 180 }}>Modified</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {tab.prefix && (
                    <tr
                      onClick={() =>
                        patch({
                          prefix: tab.prefix.replace(/[^/]+\/$/, ''),
                          selectedKey: undefined,
                        })
                      }
                    >
                      <td />
                      <td className="obj-name" style={{ color: 'var(--text-muted)' }}>
                        <Folder size={14} /> ..
                      </td>
                      <td colSpan={3} />
                    </tr>
                  )}

                  {listing?.prefixes.map((prefix) => (
                    <tr key={prefix} onClick={() => patch({ prefix, selectedKey: undefined })}>
                      <td />
                      <td className="obj-name">
                        <Folder size={14} style={{ color: 'var(--s3)' }} />
                        {prefix.slice(tab.prefix.length).replace(/\/$/, '')}
                      </td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn btn-ghost btn-sm btn-danger"
                          title="Delete folder and contents"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeFolder(prefix);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {listing?.objects.map((object) => {
                    const name = object.key.slice(tab.prefix.length);
                    const isSelected = selected.has(object.key);
                    return (
                      <tr
                        key={object.key}
                        className={tab.selectedKey === object.key ? 'selected' : ''}
                        onClick={() => void openDetail(object.key)}
                      >
                        <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            className="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(object.key);
                              else next.delete(object.key);
                              setSelected(next);
                            }}
                          />
                        </td>
                        <td className="obj-name">
                          <File size={14} style={{ color: 'var(--text-dim)' }} />
                          {name}
                        </td>
                        <td className="num">{formatBytes(object.size)}</td>
                        <td className="num">{formatDate(object.lastModified)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Copy presigned URL"
                            onClick={(e) => {
                              e.stopPropagation();
                              void copyPresigned(object.key);
                            }}
                          >
                            <Link2 size={12} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Download"
                            onClick={(e) => {
                              e.stopPropagation();
                              void download(object.key);
                            }}
                          >
                            <Download size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {listing && listing.objects.length === 0 && listing.prefixes.length === 0 && (
                    <tr>
                      <td colSpan={5}>
                        <div className="placeholder" style={{ padding: 32 }}>
                          This prefix is empty.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {listing?.isTruncated && (
            <div className="warn-box">
              Showing the first page of results. Narrow the prefix to see more.
            </div>
          )}
        </div>

        <MetadataEditor
          detail={detail}
          onSave={async (update) => {
            if (!connection || !detail) return;
            try {
              const next = await window.crafillio.s3.updateMetadata(
                connection,
                tab.bucket,
                detail.key,
                update,
              );
              setDetail(next);
              toast('success', 'Metadata updated');
            } catch (err) {
              toast('error', (err as Error).message);
            }
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface MetadataUpdate {
  metadata: Record<string, string>;
  contentType?: string;
  cacheControl?: string;
}

function MetadataEditor({
  detail,
  onSave,
}: {
  detail: S3ObjectDetail | null;
  onSave: (update: MetadataUpdate) => Promise<void>;
}) {
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>([]);
  const [contentType, setContentType] = useState('');
  const [cacheControl, setCacheControl] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset the form whenever a different object is selected, so edits never
  // carry over onto the wrong key.
  useEffect(() => {
    if (!detail) return;
    setRows(Object.entries(detail.metadata).map(([key, value]) => ({ key, value })));
    setContentType(detail.contentType ?? '');
    setCacheControl(detail.cacheControl ?? '');
  }, [detail?.key, detail]);

  if (!detail) {
    return (
      <div className="s3-detail">
        <div className="placeholder" style={{ padding: 24 }}>
          Select an object to view and edit its metadata.
        </div>
      </div>
    );
  }

  const save = async (): Promise<void> => {
    setSaving(true);
    const metadata: Record<string, string> = {};
    for (const row of rows) {
      if (row.key.trim()) metadata[row.key.trim()] = row.value;
    }
    await onSave({ metadata, contentType, cacheControl });
    setSaving(false);
  };

  return (
    <div className="s3-detail">
      <div className="detail-section">
        <div className="detail-title">Object</div>
        <dl>
          <div className="detail-row">
            <dt>Key</dt>
            <dd>{detail.key}</dd>
          </div>
          <div className="detail-row">
            <dt>Size</dt>
            <dd>{formatBytes(detail.size)}</dd>
          </div>
          <div className="detail-row">
            <dt>Modified</dt>
            <dd>{formatDate(detail.lastModified)}</dd>
          </div>
          <div className="detail-row">
            <dt>ETag</dt>
            <dd>{detail.etag ?? '—'}</dd>
          </div>
          <div className="detail-row">
            <dt>Storage</dt>
            <dd>{detail.storageClass ?? 'STANDARD'}</dd>
          </div>
        </dl>
      </div>

      <div className="detail-section">
        <div className="detail-title">System headers</div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Content-Type</label>
          <input
            className="input input-mono"
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Cache-Control</label>
          <input
            className="input input-mono"
            value={cacheControl}
            placeholder="max-age=3600"
            onChange={(e) => setCacheControl(e.target.value)}
          />
        </div>
      </div>

      <div className="detail-section" style={{ flex: 1 }}>
        <div className="detail-title">User metadata</div>

        {rows.map((row, index) => (
          <div key={index} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              className="input input-mono"
              style={{ flex: 1, minWidth: 0 }}
              value={row.key}
              placeholder="key"
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)))
              }
            />
            <input
              className="input input-mono"
              style={{ flex: 1, minWidth: 0 }}
              value={row.value}
              placeholder="value"
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
              }
            />
            <button
              className="btn btn-ghost btn-icon"
              title="Remove this metadata pair"
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        <button
          className="btn btn-sm"
          style={{ marginTop: 6 }}
          onClick={() => setRows([...rows, { key: '', value: '' }])}
        >
          <Plus size={12} /> Add pair
        </button>

        <div className="hint" style={{ marginTop: 10 }}>
          Saving rewrites the object’s metadata in place via a self-copy. Keys are stored with the
          <code> x-amz-meta-</code> prefix.
        </div>

        <button
          className="btn btn-primary"
          style={{ marginTop: 12, width: '100%' }}
          onClick={save}
          disabled={saving}
        >
          {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
          Save metadata
        </button>
      </div>
    </div>
  );
}
