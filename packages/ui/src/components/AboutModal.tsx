import { useEffect, useState } from 'react';
import { ExternalLink, FolderOpen, Github, Heart, ShieldCheck, WifiOff } from 'lucide-react';
import { Modal } from './Modal';
import { Wordmark } from './Logo';
import { useStore } from '../state/store';
import { useT } from '../i18n';
import { AUTHOR_AVATAR } from '../assets/avatar';

const PROFILE_URL = 'https://github.com/crafillio';
const REPO_URL = 'https://github.com/crafillio/crafillio-devkit';

export function AboutModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const [version, setVersion] = useState('');
  const [dataDir, setDataDir] = useState('');
  const [secrets, setSecrets] = useState(true);
  const [backend, setBackend] = useState<'keyfile' | 'os'>('keyfile');

  useEffect(() => {
    void (async () => {
      setVersion(await window.crafillio.app.version());
      setDataDir(await window.crafillio.app.dataDirectory());
      setSecrets(await window.crafillio.app.secretsAvailable());
      setBackend(await window.crafillio.app.secretBackend());
    })();
  }, []);

  const open = async (url: string): Promise<void> => {
    try {
      await window.crafillio.app.openExternal(url);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  return (
    <Modal title={t.about.title} width={560} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Wordmark size={44} />
        <div className="meta" style={{ marginTop: 10 }}>
          Version {version || '—'} · MIT licensed · Free and open source
        </div>
      </div>

      <div className="about-author">
        {/* Photo and name are one group: the row is space-between, so a third
            top-level child would strand the photo away from the name it
            belongs to. */}
        <div className="about-identity">
          <img className="about-avatar" src={AUTHOR_AVATAR} alt="" width="44" height="44" />
          <div>
            <div style={{ fontWeight: 650 }}>Amit Singh</div>
            <div className="meta">{t.about.creator}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => open(REPO_URL)}>
            <ExternalLink size={13} /> {t.about.repository}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => open(PROFILE_URL)}>
            <Github size={13} /> {t.about.viewProfile}
          </button>
        </div>
      </div>

      <div className="about-grid">
        <div className="about-card">
          <WifiOff size={16} style={{ color: 'var(--s3)' }} />
          <div>
            <strong>{t.about.offline}</strong>
            <p>
              No telemetry, no analytics, no update pings. The only network traffic is the requests
              you make.
            </p>
          </div>
        </div>
        <div className="about-card">
          <ShieldCheck size={16} style={{ color: 'var(--accent)' }} />
          <div>
            <strong>{t.about.yourData}</strong>
            <p>
              Collections are plain files on this machine.{' '}
              {secrets
                ? backend === 'keyfile'
                  ? 'Secrets are encrypted with a local key file — no keychain, no prompts.'
                  : 'Secrets are encrypted with the OS keychain.'
                : 'Secret storage is unavailable on this machine.'}
            </p>
          </div>
        </div>
      </div>

      <div className="field">
        <label>{t.about.dataFolder}</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code
            style={{ flex: 1, fontSize: 11.5, color: 'var(--text-muted)', wordBreak: 'break-all' }}
          >
            {dataDir}
          </code>
          <button
            className="btn btn-sm"
            onClick={() => void window.crafillio.app.revealDataDirectory()}
          >
            <FolderOpen size={12} /> Open
          </button>
        </div>
      </div>

      <div className="field">
        <label>{t.about.secretStorage}</label>
        <select
          className="select"
          value={backend}
          onChange={async (e) => {
            const next = e.target.value as 'keyfile' | 'os';
            try {
              const effective = await window.crafillio.app.setSecretBackend(next);
              setBackend(effective);
              setSecrets(await window.crafillio.app.secretsAvailable());
              toast(
                'success',
                effective === 'keyfile'
                  ? 'Using a local key file — nothing will prompt you.'
                  : 'Using the OS keychain.',
              );
            } catch (err) {
              toast('error', (err as Error).message);
            }
          }}
        >
          <option value="keyfile">Local key file — no prompts (recommended)</option>
          <option value="os">OS keychain — stronger, may prompt</option>
        </select>
        <span className="hint">
          {backend === 'keyfile' ? (
            <>
              Secret values are encrypted with AES-256-GCM using a key at{' '}
              <code>secret.key</code> in the folder above, readable only by you. Nothing ever asks
              for a password. The trade-off: the key sits beside the data, so anyone who can read
              your home folder can read your secrets — it protects against a leaked export, a
              synced config or a shared backup, not against someone already on your account.
            </>
          ) : (
            <>
              Secret values are sealed by the operating system keychain. Stronger, but macOS shows
              a keychain prompt the first time, and machines without a usable keychain cannot store
              secrets at all.
            </>
          )}
        </span>
      </div>

      <div className="field">
        <label>{t.about.builtWith}</label>
        <span className="hint">
          Electron, React, grpc-js, protobuf.js, AWS SDK for JavaScript, undici and CodeMirror — all
          under permissive open-source licences. Run <code>npm run licenses</code> for the full
          report.
        </span>
      </div>

      <div
        className="meta"
        style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
      >
        Made with <Heart size={12} style={{ color: 'var(--red)' }} /> for developers
      </div>
    </Modal>
  );
}
