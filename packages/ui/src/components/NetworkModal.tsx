import { useEffect, useState } from 'react';
import { FileKey, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import type { ClientCertificate, Settings } from '@crafillio/core';
import { Modal } from './Modal';
import { useStore } from '../state/store';
import { uid } from '../lib/defaults';
import { useT } from '../i18n';

/**
 * Proxy and TLS configuration.
 *
 * These are application-wide rather than per-request: a corporate proxy or a
 * private CA applies to everything you send, and duplicating it on every
 * request would be tedious and easy to get inconsistent.
 */
export function NetworkModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const refreshSettings = useStore((s) => s.refreshSettings);
  const toast = useStore((s) => s.toast);

  const [tab, setTab] = useState<'proxy' | 'tls'>('proxy');
  const [proxy, setProxy] = useState<Settings['proxy'] | null>(null);
  const [tls, setTls] = useState<Settings['tls'] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setProxy(settings.proxy);
    setTls(settings.tls);
  }, [settings]);

  if (!proxy || !tls) return null;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await window.crafillio.settings.save({ proxy, tls });
      await refreshSettings();
      toast('success', t.network.saved);
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const pickFile = async (
    filters: Array<{ name: string; extensions: string[] }>,
  ): Promise<string | null> => {
    const [file] = await window.crafillio.dialog.openFiles({ filters });
    return file?.path ?? null;
  };

  const updateCert = (id: string, next: Partial<ClientCertificate>): void =>
    setTls({
      ...tls,
      certificates: tls.certificates.map((c) => (c.id === id ? { ...c, ...next } : c)),
    });

  return (
    <Modal
      title={t.network.title}
      width={680}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {t.common.save}
          </button>
        </>
      }
    >
      <div className="subtabs" style={{ margin: '-17px -17px 0', paddingInline: 17 }}>
        <button
          className={`subtab ${tab === 'proxy' ? 'active' : ''}`}
          onClick={() => setTab('proxy')}
        >
          {t.network.proxy}
          {proxy.enabled ? <span className="count">on</span> : null}
        </button>
        <button className={`subtab ${tab === 'tls' ? 'active' : ''}`} onClick={() => setTab('tls')}>
          {t.network.tls}
          {!tls.verify ? <span className="count">off</span> : null}
        </button>
      </div>

      {tab === 'proxy' && (
        <>
          <label className="inline-check">
            <input
              type="checkbox"
              className="checkbox"
              checked={proxy.enabled}
              onChange={(e) => setProxy({ ...proxy, enabled: e.target.checked })}
            />
            {t.network.useProxy}
          </label>

          <div className="field-row">
            <div className="field">
              <label>{t.network.proxyProtocol}</label>
              <select
                className="select"
                value={proxy.protocol}
                disabled={!proxy.enabled}
                onChange={(e) =>
                  setProxy({ ...proxy, protocol: e.target.value as typeof proxy.protocol })
                }
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
                <option value="socks4">SOCKS4</option>
              </select>
            </div>
            <div className="field">
              <label>{t.network.port}</label>
              <input
                className="input input-mono"
                type="number"
                min={1}
                max={65535}
                value={proxy.port}
                disabled={!proxy.enabled}
                onChange={(e) => setProxy({ ...proxy, port: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="field">
            <label>{t.network.proxyHost}</label>
            <input
              className="input input-mono"
              value={proxy.host}
              placeholder="proxy.corp.example.com"
              disabled={!proxy.enabled}
              onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
            />
          </div>

          {(proxy.protocol === 'socks4' || proxy.protocol === 'socks5') && (
            <span className="hint">
              SOCKS tunnels the whole TCP connection, so HTTP and HTTPS both go through it.
              {proxy.protocol === 'socks4' && ' SOCKS4 has no password support — only a user id.'}
            </span>
          )}

          {!proxy.protocol.startsWith('socks') && (
          <div className="field">
            <label>{t.network.useProxyFor}</label>
            <div style={{ display: 'flex', gap: 18 }}>
              <label className="inline-check">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={proxy.forHttp}
                  disabled={!proxy.enabled}
                  onChange={(e) => setProxy({ ...proxy, forHttp: e.target.checked })}
                />
                HTTP
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={proxy.forHttps}
                  disabled={!proxy.enabled}
                  onChange={(e) => setProxy({ ...proxy, forHttps: e.target.checked })}
                />
                HTTPS
              </label>
            </div>
          </div>
          )}

          <label className="inline-check">
            <input
              type="checkbox"
              className="checkbox"
              checked={proxy.auth.enabled}
              disabled={!proxy.enabled}
              onChange={(e) =>
                setProxy({ ...proxy, auth: { ...proxy.auth, enabled: e.target.checked } })
              }
            />
            {t.network.proxyAuth}
          </label>

          {proxy.auth.enabled && (
            <div className="field-row">
              <div className="field">
                <label>{t.network.username}</label>
                <input
                  className="input"
                  value={proxy.auth.username}
                  disabled={!proxy.enabled}
                  onChange={(e) =>
                    setProxy({ ...proxy, auth: { ...proxy.auth, username: e.target.value } })
                  }
                />
              </div>
              <div className="field">
                <label>{t.network.password}</label>
                <input
                  className="input"
                  type="password"
                  value={proxy.auth.password}
                  disabled={!proxy.enabled}
                  onChange={(e) =>
                    setProxy({ ...proxy, auth: { ...proxy.auth, password: e.target.value } })
                  }
                />
              </div>
            </div>
          )}

          <div className="field">
            <label>{t.network.bypass}</label>
            <input
              className="input input-mono"
              value={proxy.bypass.join(', ')}
              placeholder="localhost, 127.0.0.1, *.internal"
              disabled={!proxy.enabled}
              onChange={(e) =>
                setProxy({
                  ...proxy,
                  bypass: e.target.value.split(',').map((h) => h.trim()).filter(Boolean),
                })
              }
            />
            <span className="hint">
              Comma separated. A leading <code>*.</code> matches subdomains, so{' '}
              <code>*.internal</code> covers <code>api.internal</code> and{' '}
              <code>internal</code> itself.
            </span>
          </div>
        </>
      )}

      {tab === 'tls' && (
        <>
          {/* Stated as what it does rather than what it turns off: people come
              to this screen looking for "ignore TLS", not for a verification
              switch to uncheck. */}
          <label className="inline-check inline-check-lead">
            <input
              type="checkbox"
              className="checkbox"
              checked={!tls.verify}
              onChange={(e) => setTls({ ...tls, verify: !e.target.checked })}
            />
            {t.network.ignoreTls}
          </label>
          <p className="field-note" style={{ marginTop: -6, marginLeft: 24 }}>
            Applies to every host, every request — REST, gRPC and S3 alike.
          </p>

          {!tls.verify && (
            <div className="warn-box" style={{ margin: 0 }}>
              <ShieldAlert size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              Certificates are not checked for anything. Every response can be read and altered in
              transit by whatever sits between you and the server, including hosts you did not mean
              to include. If it is really one staging box, name it below instead and leave the rest
              protected.
            </div>
          )}

          <div className="field">
            <label>Or ignore only these hosts</label>
            <input
              className="input input-mono"
              value={(tls.ignoreHosts ?? []).join(', ')}
              placeholder="staging.internal, *.dev.local, localhost"
              disabled={!tls.verify}
              onChange={(e) =>
                setTls({
                  ...tls,
                  ignoreHosts: e.target.value.split(',').map((h) => h.trim()).filter(Boolean),
                })
              }
            />
            <span className="hint">
              Comma separated, same matching as the proxy bypass list: a leading <code>*.</code>{' '}
              covers subdomains. These hosts skip certificate checks while everything else stays
              protected — usually what you actually want, rather than turning checks off globally
              because one staging box has a self-signed certificate.
              {!tls.verify && ' Not in use while everything is being ignored above.'}
            </span>
          </div>

          {(tls.ignoreHosts ?? []).length > 0 && tls.verify && (
            <div className="warn-box" style={{ margin: 0 }}>
              <ShieldAlert size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              Traffic to {(tls.ignoreHosts ?? []).join(', ')} is not verified and can be read or
              altered in transit. Everything else is still checked.
            </div>
          )}

          <div className="field">
            <label>{t.network.trustCa}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  const path = await pickFile([
                    { name: 'Certificate', extensions: ['pem', 'crt', 'cer', 'ca-bundle'] },
                  ]);
                  if (path) setTls({ ...tls, caPath: path });
                }}
              >
                <FileKey size={12} /> {t.network.chooseCa}
              </button>
              <span className="meta" style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
                {tls.caPath || 'None — system roots only'}
              </span>
              {tls.caPath && (
                <button className="btn btn-ghost btn-sm" onClick={() => setTls({ ...tls, caPath: '' })}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <span className="hint">
              A PEM bundle for a private root. Lets you keep verification on inside a corporate
              network.
            </span>
          </div>

          <div className="field">
            <label>{t.network.clientCerts}</label>
            <span className="hint" style={{ marginBottom: 4 }}>
              Sent when a server asks for mutual TLS. Matched by host — an exact name wins over a{' '}
              <code>*.</code> wildcard.
            </span>
          </div>

          {tls.certificates.map((cert) => (
            <div key={cert.id} className="wf-binding">
              <div className="wf-binding-head">
                <input
                  className="input input-mono"
                  style={{ flex: 1, minWidth: 140 }}
                  value={cert.host}
                  placeholder="api.example.com"
                  onChange={(e) => updateCert(cert.id, { host: e.target.value })}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setTls({ ...tls, certificates: tls.certificates.filter((c) => c.id !== cert.id) })
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>

              <div className="wf-binding-body" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <CertFile
                  label="CRT / PEM"
                  path={cert.certPath}
                  disabled={Boolean(cert.pfxPath)}
                  onPick={async () => {
                    const path = await pickFile([{ name: 'Certificate', extensions: ['pem', 'crt', 'cer'] }]);
                    if (path) updateCert(cert.id, { certPath: path });
                  }}
                  onClear={() => updateCert(cert.id, { certPath: '' })}
                />
                <CertFile
                  label="Key"
                  path={cert.keyPath}
                  disabled={Boolean(cert.pfxPath)}
                  onPick={async () => {
                    const path = await pickFile([{ name: 'Private key', extensions: ['pem', 'key'] }]);
                    if (path) updateCert(cert.id, { keyPath: path });
                  }}
                  onClear={() => updateCert(cert.id, { keyPath: '' })}
                />
                <CertFile
                  label="PFX / P12"
                  path={cert.pfxPath}
                  hint="A PKCS#12 bundle replaces the separate CRT and key."
                  onPick={async () => {
                    const path = await pickFile([{ name: 'PKCS#12', extensions: ['pfx', 'p12'] }]);
                    if (path) updateCert(cert.id, { pfxPath: path });
                  }}
                  onClear={() => updateCert(cert.id, { pfxPath: '' })}
                />
                <div className="field">
                  <label>{t.network.passphrase}</label>
                  <input
                    className="input"
                    type="password"
                    value={cert.passphrase}
                    placeholder="Leave blank if the key is not encrypted"
                    onChange={(e) => updateCert(cert.id, { passphrase: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            className="btn btn-sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={() =>
              setTls({
                ...tls,
                certificates: [
                  ...tls.certificates,
                  { id: uid('cert'), host: '', certPath: '', keyPath: '', pfxPath: '', passphrase: '' },
                ],
              })
            }
          >
            <Plus size={12} /> {t.network.addClientCert}
          </button>
        </>
      )}
    </Modal>
  );
}

function CertFile({
  label,
  path,
  hint,
  disabled,
  onPick,
  onClear,
}: {
  label: string;
  path: string;
  hint?: string;
  disabled?: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-sm" onClick={onPick} disabled={disabled}>
          Choose
        </button>
        <span className="meta" style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
          {path || (disabled ? 'Not needed with a PFX bundle' : 'None')}
        </span>
        {path && (
          <button className="btn btn-ghost btn-sm" onClick={onClear}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
