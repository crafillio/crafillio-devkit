import { useEffect, useState } from 'react';
import { Plus, Trash2, ShieldCheck } from 'lucide-react';
import type { EnvVariable, Environment } from '@crafillio/core';
import { Modal } from './Modal';
import { useStore } from '../state/store';
import { uid } from '../lib/defaults';
import { askConfirm, askName } from '../state/dialogs';

export function EnvironmentsModal({ onClose }: { onClose: () => void }) {
  const refresh = useStore((s) => s.refreshEnvironments);
  const toast = useStore((s) => s.toast);

  const [envs, setEnvs] = useState<Environment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secretsOk, setSecretsOk] = useState(true);

  useEffect(() => {
    void (async () => {
      const file = await window.crafillio.environments.load();
      setEnvs(file.environments);
      setActiveId(file.activeId);
      setSelectedId(file.activeId ?? file.environments[0]?.id ?? null);
      setSecretsOk(await window.crafillio.app.secretsAvailable());
    })();
  }, []);

  const selected = envs.find((e) => e.id === selectedId);

  const patchSelected = (variables: EnvVariable[]): void => {
    setEnvs(envs.map((e) => (e.id === selectedId ? { ...e, variables } : e)));
  };

  const save = async (): Promise<void> => {
    try {
      await window.crafillio.environments.save({ environments: envs, activeId });
      await refresh();
      toast('success', 'Environments saved');
      onClose();
    } catch (err) {
      // Sealing a secret fails when the OS keychain is unavailable; the message
      // from core explains the remedy, so surface it verbatim.
      toast('error', (err as Error).message);
    }
  };

  const addEnv = async (): Promise<void> => {
    const name = await askName({
      title: 'New environment',
      label: 'Environment name',
      placeholder: 'Staging',
      defaultValue: 'Local',
    });
    if (!name) return;
    const env: Environment = { id: uid('env'), name, variables: [] };
    setEnvs([...envs, env]);
    setSelectedId(env.id);
    if (!activeId) setActiveId(env.id);
  };

  return (
    <Modal
      title="Environments"
      width={780}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      {!secretsOk && (
        <div className="warn-box" style={{ margin: 0 }}>
          OS-backed encryption is unavailable on this session, so variables cannot be marked
          secret. Values will be stored in plain text.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 14, minHeight: 300 }}>
        <div style={{ borderRight: '1px solid var(--border)', paddingRight: 10 }}>
          {envs.map((env) => (
            <div
              key={env.id}
              className={`tree-row ${selectedId === env.id ? 'active' : ''}`}
              onClick={() => setSelectedId(env.id)}
            >
              <input
                type="radio"
                className="checkbox"
                checked={activeId === env.id}
                onChange={() => setActiveId(env.id)}
                onClick={(e) => e.stopPropagation()}
                title="Make active"
              />
              <span className="row-label">{env.name}</span>
              <button
                className="row-action"
                title="Delete this environment"
                onClick={(e) => {
                  e.stopPropagation();
                  setEnvs(envs.filter((x) => x.id !== env.id));
                  if (activeId === env.id) setActiveId(null);
                  if (selectedId === env.id) setSelectedId(null);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          <button className="btn btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => void addEnv()}>
            <Plus size={12} /> Add
          </button>
        </div>

        <div>
          {!selected ? (
            <div className="placeholder">Select or create an environment.</div>
          ) : (
            <>
              <table className="kv">
                <thead>
                  <tr>
                    <th style={{ width: 30 }} />
                    <th>Variable</th>
                    <th>Value</th>
                    <th style={{ width: 46 }} title="Encrypt with the OS keychain">
                      Secret
                    </th>
                    <th style={{ width: 30 }} />
                  </tr>
                </thead>
                <tbody>
                  {selected.variables.map((variable) => (
                    <tr
                      key={variable.id}
                      className={`kv-row ${variable.enabled ? '' : 'disabled'}`}
                    >
                      <td className="kv-check">
                        <input
                          type="checkbox"
                          className="checkbox"
                          checked={variable.enabled}
                          onChange={(e) =>
                            patchSelected(
                              selected.variables.map((v) =>
                                v.id === variable.id ? { ...v, enabled: e.target.checked } : v,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="kv-input"
                          value={variable.key}
                          placeholder="baseUrl"
                          onChange={(e) =>
                            patchSelected(
                              selected.variables.map((v) =>
                                v.id === variable.id ? { ...v, key: e.target.value } : v,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="kv-input"
                          type={variable.secret ? 'password' : 'text'}
                          value={variable.value}
                          placeholder="https://api.example.com"
                          onChange={(e) =>
                            patchSelected(
                              selected.variables.map((v) =>
                                v.id === variable.id ? { ...v, value: e.target.value } : v,
                              ),
                            )
                          }
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          className="checkbox"
                          checked={variable.secret}
                          disabled={!secretsOk}
                          onChange={(e) =>
                            patchSelected(
                              selected.variables.map((v) =>
                                v.id === variable.id ? { ...v, secret: e.target.checked } : v,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="kv-remove">
                        <button
                          className="row-action"
                          style={{ opacity: 1 }}
                          title="Remove this variable"
                          onClick={() =>
                            patchSelected(selected.variables.filter((v) => v.id !== variable.id))
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button
                className="btn btn-sm"
                style={{ margin: 10 }}
                onClick={() =>
                  patchSelected([
                    ...selected.variables,
                    { id: uid('var'), key: '', value: '', enabled: true, secret: false },
                  ])
                }
              >
                <Plus size={12} /> Add variable
              </button>

              <div className="hint" style={{ padding: '0 10px 10px', display: 'flex', gap: 6 }}>
                <ShieldCheck size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Reference variables anywhere as <code>{'{{name}}'}</code>. Collections store the
                  placeholder, not the value, so they stay safe to share.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
