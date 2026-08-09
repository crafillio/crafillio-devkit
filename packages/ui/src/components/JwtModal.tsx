import { useEffect, useState } from 'react';
import { AlertTriangle, Clipboard, KeyRound, ShieldAlert } from 'lucide-react';
import type { DecodedJwt } from '@crafillio/core';
import { Modal } from './Modal';
import { CodeEditor } from './CodeEditor';
import { useStore } from '../state/store';

/**
 * A JWT decoder.
 *
 * Decodes, never verifies. Verifying needs the issuer's signing key, which
 * this app has no way to obtain, and a green tick that only meant "the base64
 * parsed" would be actively misleading — anyone can mint a token whose payload
 * claims to be an admin. So the panel shows what the token asserts, and flags
 * the things that are checkable without a key: expiry, not-before, and an
 * absent or "none" signature.
 */
export function JwtModal({ initial = '', onClose }: { initial?: string; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const [token, setToken] = useState(initial);
  const [decoded, setDecoded] = useState<DecodedJwt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token.trim()) {
      setDecoded(null);
      setError(null);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      void (async () => {
        try {
          const result = await window.crafillio.tools.decodeJwt(token);
          if (live) {
            setDecoded(result);
            setError(null);
          }
        } catch (err) {
          if (live) {
            setDecoded(null);
            setError((err as Error).message);
          }
        }
      })();
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [token]);

  const paste = async (): Promise<void> => {
    try {
      setToken(await navigator.clipboard.readText());
    } catch {
      toast('error', 'Could not read the clipboard.');
    }
  };

  return (
    <Modal
      title="JWT decoder"
      width={760}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="field">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label>Token</label>
          <button className="btn btn-sm" onClick={() => void paste()}>
            <Clipboard size={12} /> Paste
          </button>
        </div>
        <textarea
          className="input input-mono jwt-input"
          rows={4}
          spellCheck={false}
          value={token}
          placeholder="eyJhbGciOi… — a Bearer prefix, quotes and line breaks are fine"
          onChange={(e) => setToken(e.target.value)}
        />
      </div>

      {error && (
        <div className="warn-box" style={{ margin: 0 }}>
          <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
          {error}
        </div>
      )}

      {decoded && (
        <>
          <div className="jwt-summary">
            <span className={`jwt-chip ${decoded.expired ? 'bad' : decoded.expired === false ? 'good' : ''}`}>
              {decoded.expired === undefined
                ? 'no expiry'
                : decoded.expired
                  ? 'expired'
                  : 'not expired'}
            </span>
            <span className="jwt-chip">alg {decoded.algorithm}</span>
            {decoded.notYetValid && <span className="jwt-chip bad">not valid yet</span>}
            <span className="jwt-chip muted">signature not checked</span>
          </div>

          {decoded.warnings.map((w) => (
            <div key={w} className="warn-box" style={{ margin: 0 }}>
              <ShieldAlert size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              {w}
            </div>
          ))}

          <div className="field">
            <label>Claims</label>
            <table className="kv-table jwt-claims">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Claim</th>
                  <th>Value</th>
                  <th style={{ width: 150 }}>When</th>
                </tr>
              </thead>
              <tbody>
                {decoded.claims.map((c) => (
                  <tr key={c.name}>
                    <td className="mono">
                      {c.name}
                      {c.meaning && <span className="jwt-meaning">{c.meaning}</span>}
                    </td>
                    <td className="mono jwt-value">{c.value}</td>
                    <td className="jwt-when">{c.relative ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="field">
            <label>Header</label>
            <CodeEditor value={decoded.headerJson} language="json" readOnly onChange={() => {}} />
          </div>

          <div className="field">
            <label>Payload</label>
            <CodeEditor value={decoded.payloadJson} language="json" readOnly onChange={() => {}} />
          </div>

          <p className="field-note">
            <KeyRound size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            The signature is shown but not verified — that needs the issuer's key. Treat the
            contents as a claim, not proof.
          </p>
        </>
      )}
    </Modal>
  );
}
