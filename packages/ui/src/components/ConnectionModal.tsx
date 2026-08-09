import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { SavedConnection } from '@crafillio/core';
import { Modal } from './Modal';
import { useStore } from '../state/store';

interface Props {
  /** Null means "create new". */
  connectionId: string | null;
  onClose: () => void;
}

const BLANK: Omit<SavedConnection, 'id'> = {
  name: '',
  endpoint: '',
  region: 'us-east-1',
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: false,
  insecureTls: false,
};

export function ConnectionModal({ connectionId, onClose }: Props) {
  const connections = useStore((s) => s.connections);
  const refresh = useStore((s) => s.refreshConnections);
  const toast = useStore((s) => s.toast);

  const existing = connections.find((c) => c.id === connectionId);
  const [form, setForm] = useState<Omit<SavedConnection, 'id'>>(existing ?? BLANK);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]): void =>
    setForm((f) => ({ ...f, [key]: value }));

  const test = async (): Promise<void> => {
    setTesting(true);
    try {
      const buckets = await window.crafillio.s3.listBuckets({ ...form });
      toast('success', `Connected — ${buckets.length} bucket(s) visible`);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      toast('error', 'Give the connection a name.');
      return;
    }
    setSaving(true);
    try {
      await window.crafillio.connections.save({ ...form, id: connectionId ?? undefined });
      await refresh();
      toast('success', 'Connection saved');
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={existing ? `Edit ${existing.name}` : 'New S3 connection'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={test} disabled={testing}>
            {testing && <Loader2 size={13} className="spin" />}
            Test connection
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input
          className="input"
          value={form.name}
          placeholder="Production media bucket"
          onChange={(e) => set('name', e.target.value)}
        />
      </div>

      <div className="field">
        <label>Default bucket (optional)</label>
        <input
          className="input input-mono"
          value={form.defaultBucket ?? ''}
          placeholder="my-application-uploads"
          spellCheck={false}
          onChange={(e) => set('defaultBucket', e.target.value)}
        />
        <span className="hint">
          Opened when you start an S3 tab on this connection, and shown beside the name in the
          sidebar so two connections to the same endpoint are told apart. It is not a
          restriction — any bucket can still be typed.
        </span>
      </div>

      <div className="field">
        <label>Endpoint</label>
        <input
          className="input input-mono"
          value={form.endpoint ?? ''}
          placeholder="Leave blank for AWS · http://localhost:9000 for MinIO"
          onChange={(e) => set('endpoint', e.target.value)}
        />
        <span className="hint">
          Set this for MinIO, Ceph, Cloudflare R2, Wasabi or any S3-compatible gateway.
        </span>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Region</label>
          <input
            className="input input-mono"
            value={form.region}
            onChange={(e) => set('region', e.target.value)}
          />
        </div>
        <div className="field">
          <label>Access key ID</label>
          <input
            className="input input-mono"
            value={form.accessKeyId}
            onChange={(e) => set('accessKeyId', e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label>Secret access key</label>
        <input
          className="input input-mono"
          type="password"
          value={form.secretAccessKey}
          onChange={(e) => set('secretAccessKey', e.target.value)}
        />
        <span className="hint">
          Encrypted with your OS keychain before it touches disk — never stored in plain text.
        </span>
      </div>

      <div className="field">
        <label>Session token (optional)</label>
        <input
          className="input input-mono"
          type="password"
          value={form.sessionToken ?? ''}
          placeholder="For temporary STS credentials"
          onChange={(e) => set('sessionToken', e.target.value)}
        />
      </div>

      <label className="inline-check">
        <input
          type="checkbox"
          className="checkbox"
          checked={form.forcePathStyle}
          onChange={(e) => set('forcePathStyle', e.target.checked)}
        />
        Force path-style addressing
      </label>
      <span className="hint" style={{ marginTop: -8 }}>
        Required by MinIO and most self-hosted gateways.
      </span>

      <label className="inline-check">
        <input
          type="checkbox"
          className="checkbox"
          checked={form.insecureTls}
          onChange={(e) => set('insecureTls', e.target.checked)}
        />
        Ignore TLS certificate errors
      </label>
    </Modal>
  );
}
