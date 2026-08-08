import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Info, Layers, Plus, Save, Terminal, Workflow as WorkflowIcon, X } from 'lucide-react';
import type { GrpcEvent, SavedRequest } from '@crafillio/core';
import { Sidebar } from './components/Sidebar';
import { RestPanel } from './components/RestPanel';
import { GrpcPanel } from './components/GrpcPanel';
import { S3Panel } from './components/S3Panel';
import { WorkflowPanel } from './components/WorkflowPanel';
import { ConnectionModal } from './components/ConnectionModal';
import { EnvironmentsModal } from './components/EnvironmentsModal';
import { AboutModal } from './components/AboutModal';
import { DialogHost } from './components/DialogHost';
import { Logo } from './components/Logo';
import { ThemeToggle } from './components/ThemeToggle';
import { NetworkModal } from './components/NetworkModal';
import { LanguagePicker } from './components/LanguagePicker';
import { Toasts } from './components/Toasts';
import { useActiveTab, useStore, type GrpcTab, type RestTab } from './state/store';
import { uid } from './lib/defaults';
import { askChoice, askName } from './state/dialogs';
import { useT } from './i18n';

export function App() {
  const t = useT();
  const store = useStore();
  const tab = useActiveTab();

  const [showEnvs, setShowEnvs] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showNetwork, setShowNetwork] = useState(false);
  const [connectionModal, setConnectionModal] = useState<{ id: string | null } | null>(null);

  /*
   * Bootstrap: load persisted state and open a first tab.
   *
   * Guarded by a ref because StrictMode runs mount effects twice in
   * development, which would otherwise open two identical starting tabs.
   */
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    const s = useStore.getState();
    void s.refreshCollections();
    void s.refreshEnvironments();
    void s.refreshConnections();
    void s.refreshSettings();

    if (s.tabs.length === 0) s.newTab('rest');
  }, []);

  /* ---------------------------------------------------------------- */
  /* Sending                                                           */
  /* ---------------------------------------------------------------- */

  const sendRest = useCallback(
    async (target: RestTab): Promise<void> => {
      const vars = await window.crafillio.environments.active();
      const { interpolated, missing } = interpolateRequest(target.request, vars);

      store.patchTab(target.id, {
        sending: true,
        error: undefined,
        missingVars: missing,
      } as Partial<RestTab>);

      const started = performance.now();
      try {
        const response = await window.crafillio.rest.send(interpolated);
        store.patchTab(target.id, { sending: false, response } as Partial<RestTab>);
        void window.crafillio.history.record({
          protocol: 'rest',
          label: `${interpolated.method} ${interpolated.url}`,
          status: String(response.status),
          durationMs: response.timing.totalMs,
        });
      } catch (err) {
        store.patchTab(target.id, {
          sending: false,
          response: undefined,
          error: (err as Error).message,
        } as Partial<RestTab>);
        void window.crafillio.history.record({
          protocol: 'rest',
          label: `${interpolated.method} ${interpolated.url}`,
          status: 'error',
          durationMs: performance.now() - started,
        });
      }
    },
    [store],
  );

  const sendGrpc = useCallback(
    async (target: GrpcTab): Promise<void> => {
      const vars = await window.crafillio.environments.active();
      const interpolated = interpolateGrpc(target.request, vars);

      store.patchTab(target.id, {
        running: true,
        events: [],
        error: undefined,
      } as Partial<GrpcTab>);

      try {
        const callId = await window.crafillio.grpc.invoke(interpolated);
        store.patchTab(target.id, { callId } as Partial<GrpcTab>);
        void window.crafillio.history.record({
          protocol: 'grpc',
          label: `${interpolated.service}/${interpolated.method}`,
        });
      } catch (err) {
        store.patchTab(target.id, {
          running: false,
          error: (err as Error).message,
        } as Partial<GrpcTab>);
      }
    },
    [store],
  );

  /* gRPC events stream in outside the request/response cycle. */
  useEffect(() => {
    return window.crafillio.grpc.onEvent((callId, event: GrpcEvent) => {
      const state = useStore.getState();
      const target = state.tabs.find((t) => t.protocol === 'grpc' && t.callId === callId) as
        | GrpcTab
        | undefined;
      if (!target) return;

      const events = [...target.events, event];
      // A status event always terminates the call, successfully or not.
      const finished = event.type === 'status';
      state.patchTab(target.id, {
        events,
        running: finished ? false : target.running,
      } as Partial<GrpcTab>);
    });
  }, []);

  const send = useCallback((): void => {
    if (!tab) return;
    if (tab.protocol === 'rest') void sendRest(tab);
    else if (tab.protocol === 'grpc') void sendGrpc(tab);
  }, [tab, sendRest, sendGrpc]);

  /* Cmd/Ctrl+Enter sends, Cmd/Ctrl+T opens a tab, Cmd/Ctrl+S saves. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      } else if (e.key === 't') {
        e.preventDefault();
        useStore.getState().newTab('rest');
      } else if (e.key === 's') {
        e.preventDefault();
        void saveActive();
      } else if (e.key === 'w' && tab) {
        e.preventDefault();
        useStore.getState().closeTab(tab.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------------------------------------------------------------- */
  /* Saving                                                            */
  /* ---------------------------------------------------------------- */

  const saveActive = async (): Promise<void> => {
    const current = useStore.getState();
    const active = current.tabs.find((t) => t.id === current.activeTabId);
    if (!active) return;
    // Workflows own their own persistence (Save in the workflow toolbar).
    if (active.protocol === 'workflow') return;

    let collectionId = active.savedTo?.collectionId;

    if (!collectionId) {
      if (current.collections.length === 0) {
        const created = await window.crafillio.collections.create('My collection');
        collectionId = created.id;
      } else if (current.collections.length === 1) {
        collectionId = current.collections[0]!.id;
      } else {
        const picked = await askChoice({
          title: 'Save request',
          label: 'Save to collection',
          confirmLabel: 'Save',
          options: current.collections.map((c) => ({
            value: c.id,
            label: c.name,
            hint: `${c.requests.length} request${c.requests.length === 1 ? '' : 's'}`,
          })),
        });
        // Dismissing the chooser cancels the save rather than guessing.
        if (!picked) return;
        collectionId = picked;
      }
    }

    const requestId = active.savedTo?.requestId ?? uid('req');
    const record: SavedRequest = {
      id: requestId,
      name: active.name,
      protocol: active.protocol,
      folderId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(active.protocol === 'rest' ? { rest: active.request } : {}),
      ...(active.protocol === 'grpc' ? { grpc: active.request } : {}),
      ...(active.protocol === 's3'
        ? {
            s3: {
              connectionId: active.connectionId,
              bucket: active.bucket,
              prefix: active.prefix,
            },
          }
        : {}),
    };

    try {
      await window.crafillio.collections.saveRequest(collectionId!, record);
      current.patchTab(active.id, {
        dirty: false,
        savedTo: { collectionId: collectionId!, requestId },
      });
      await current.refreshCollections();
      current.toast('success', `Saved "${active.name}"`);
    } catch (err) {
      current.toast('error', (err as Error).message);
    }
  };

  /**
   * Turns a curl command into a new tab. Reads the clipboard first, since the
   * command is almost always already copied from devtools or a colleague.
   */
  const importFromCurl = async (): Promise<void> => {
    let clipboard = '';
    try {
      clipboard = await navigator.clipboard.readText();
    } catch {
      // Clipboard access can be denied; fall through to an empty prompt.
    }

    const command = await askName({
      title: 'Import from curl',
      label: 'curl command',
      placeholder: "curl 'https://api.example.com/users' -H 'Accept: application/json'",
      defaultValue: clipboard.trim().startsWith('curl') ? clipboard.trim() : '',
      confirmLabel: 'Import',
    });
    if (!command) return;

    try {
      const request = await window.crafillio.interop.importCurl(command);
      const state = useStore.getState();
      state.newTab('rest');

      const created = useStore.getState();
      const tabId = created.activeTabId;
      if (tabId) {
        created.patchTab(tabId, { request, dirty: true } as Partial<RestTab>);
        let name: string;
        try {
          name = new URL(request.url).pathname;
        } catch {
          name = request.url;
        }
        created.renameTab(tabId, `${request.method} ${name || 'imported'}`);
      }
      state.toast('success', 'Imported from curl');
    } catch (err) {
      useStore.getState().toast('error', (err as Error).message);
    }
  };

  /* ---------------------------------------------------------------- */

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <Logo size={22} />
          <span>
            API <span className="brand-accent">Devkit</span>
          </span>
        </div>

        <div className="titlebar-spacer" />

        <button
          className="btn btn-sm"
          onClick={importFromCurl}
          title="Import a curl command from the clipboard — Ctrl/⌘ V it first"
        >
          <Terminal size={13} /> {t.titlebar.importCurl}
        </button>

        <select
          className="select"
          style={{ minWidth: 150 }}
          value={store.activeEnvId ?? ''}
          onChange={async (e) => {
            await window.crafillio.environments.setActive(e.target.value || null);
            await store.refreshEnvironments();
          }}
          title="Active environment"
        >
          <option value="">{t.common.none}</option>
          {store.environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>

        <button className="btn btn-icon" onClick={() => setShowEnvs(true)} title={t.titlebar.environments}>
          <Layers size={15} />
        </button>

        <button
          className="btn btn-icon"
          onClick={() => setShowNetwork(true)}
          title={t.titlebar.network}
        >
          <Globe size={15} />
        </button>

        <LanguagePicker />

        <ThemeToggle />

        <button className="btn btn-icon" onClick={() => setShowAbout(true)} title={t.titlebar.about}>
          <Info size={15} />
        </button>
      </header>

      <div className="body">
        <Sidebar onEditConnection={(id) => setConnectionModal({ id })} />

        <main className="main">
          <div className="tabstrip">
            {store.tabs.map((t) => (
              <button
                key={t.id}
                className={`tab p-${t.protocol} ${t.id === store.activeTabId ? 'active' : ''}`}
                onClick={() => store.setActiveTab(t.id)}
              >
                <span
                  className={`method-chip m-${
                    t.protocol === 'rest' ? t.request.method : t.protocol.toUpperCase()
                  }`}
                  style={{ minWidth: 'auto' }}
                >
                  {t.protocol === 'rest' ? t.request.method : t.protocol === 'workflow' ? 'FLOW' : t.protocol.toUpperCase()}
                </span>
                <span className="tab-label">{t.name}</span>
                {t.dirty && <span className="tab-dirty" title="Unsaved changes" />}
                <span
                  className="tab-close"
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    store.closeTab(t.id);
                  }}
                >
                  <X size={12} />
                </span>
              </button>
            ))}

            <button
              className="tab-new"
              onClick={() => store.newTab('rest')}
              title="New request (⌘T)"
            >
              <Plus size={14} />
            </button>

            <div style={{ flex: 1 }} />

            <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 10px' }}>
              <button
                className="btn btn-sm"
                onClick={() => store.newTab('grpc')}
                title="New gRPC call — reflection or .proto files"
              >
                + gRPC
              </button>
              <button
                className="btn btn-sm"
                onClick={() => store.newTab('s3')}
                title="Browse an S3 bucket — upload, download, edit metadata"
              >
                + S3
              </button>
              <button
                className="btn btn-sm"
                onClick={() => store.newTab('workflow')}
                title="Chain requests together on a canvas"
              >
                <WorkflowIcon size={12} /> + {t.workflow.title}
              </button>
              {tab && (
                <button className="btn btn-sm" onClick={saveActive} title="Save (⌘S)">
                  <Save size={12} /> {t.common.save}
                </button>
              )}
            </div>
          </div>

          {!tab && (
            <div className="placeholder">
              <div>No tabs open</div>
              <div>
                Press <kbd>⌘</kbd> <kbd>T</kbd> for a new request
              </div>
            </div>
          )}

          {tab?.protocol === 'rest' && <RestPanel tab={tab} onSend={send} />}
          {tab?.protocol === 'grpc' && <GrpcPanel tab={tab} onSend={send} />}
          {tab?.protocol === 's3' && <S3Panel tab={tab} />}
          {tab?.protocol === 'workflow' && <WorkflowPanel />}
        </main>
      </div>

      {showEnvs && <EnvironmentsModal onClose={() => setShowEnvs(false)} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showNetwork && <NetworkModal onClose={() => setShowNetwork(false)} />}
      {connectionModal && (
        <ConnectionModal
          connectionId={connectionModal.id}
          onClose={() => setConnectionModal(null)}
        />
      )}

      <DialogHost />
      <Toasts />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interpolation                                                       */
/* ------------------------------------------------------------------ */

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

function substitute(text: string, vars: Record<string, string>, missing: Set<string>): string {
  return text.replace(TOKEN, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name]!;
    missing.add(name);
    return match;
  });
}

/** Walks a request and substitutes every string, reporting undefined names. */
function walk<T>(node: T, vars: Record<string, string>, missing: Set<string>): T {
  if (typeof node === 'string') return substitute(node, vars, missing) as T;
  if (Array.isArray(node)) return node.map((n) => walk(n, vars, missing)) as T;
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = walk(value, vars, missing);
    return out as T;
  }
  return node;
}

function interpolateRequest(
  request: RestTab['request'],
  vars: Record<string, string>,
): { interpolated: RestTab['request']; missing: string[] } {
  const missing = new Set<string>();
  return { interpolated: walk(request, vars, missing), missing: [...missing] };
}

function interpolateGrpc(
  request: GrpcTab['request'],
  vars: Record<string, string>,
): GrpcTab['request'] {
  const missing = new Set<string>();
  return walk(request, vars, missing);
}
