import { create } from 'zustand';
import type {
  Collection,
  Environment,
  GrpcEvent,
  GrpcRequest,
  GrpcServiceDescriptor,
  Protocol,
  RestRequest,
  RestResponse,
  SavedConnection,
  SavedRequest,
  Settings,
} from '@crafillio/core';
import { blankGrpc, blankRest, uid } from '../lib/defaults';
import { applyTheme } from '../components/ThemeToggle';
import { useI18n, type LocaleCode } from '../i18n';

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

interface TabCommon {
  id: string;
  name: string;
  dirty: boolean;
  /** Set once the tab has been saved into a collection. */
  savedTo?: { collectionId: string; requestId: string };
}

export interface RestTab extends TabCommon {
  protocol: 'rest';
  request: RestRequest;
  response?: RestResponse;
  error?: string;
  missingVars: string[];
  sending: boolean;
}

export interface GrpcTab extends TabCommon {
  protocol: 'grpc';
  request: GrpcRequest;
  services: GrpcServiceDescriptor[];
  events: GrpcEvent[];
  error?: string;
  callId?: string;
  running: boolean;
  discovering: boolean;
}

export interface S3Tab extends TabCommon {
  protocol: 's3';
  connectionId: string;
  bucket: string;
  prefix: string;
  selectedKey?: string;
}

export interface WorkflowTab extends TabCommon {
  protocol: 'workflow';
}

export type Tab = RestTab | GrpcTab | S3Tab | WorkflowTab;

export interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success';
  message: string;
}

/* ------------------------------------------------------------------ */

interface State {
  tabs: Tab[];
  activeTabId: string | null;

  collections: Collection[];
  environments: Environment[];
  activeEnvId: string | null;
  connections: SavedConnection[];
  settings: Settings | null;

  toasts: Toast[];

  /** Workflow the sidebar has asked the workflow tab to show. */
  activeWorkflowId: string | null;
  openWorkflow(id: string): void;

  /* Tabs */
  newTab(protocol: TabKind): void;
  openSaved(collection: Collection, request: SavedRequest): void;
  closeTab(id: string): void;
  setActiveTab(id: string): void;
  patchTab(id: string, patch: Partial<Tab>): void;
  renameTab(id: string, name: string): void;

  /* Data */
  refreshCollections(): Promise<void>;
  refreshEnvironments(): Promise<void>;
  refreshConnections(): Promise<void>;
  refreshSettings(): Promise<void>;

  /* Toasts */
  toast(kind: Toast['kind'], message: string): void;
  dismissToast(id: string): void;
}

/** Workflow is a UI surface rather than a wire protocol, hence the union. */
export type TabKind = Protocol | 'workflow';

function defaultName(protocol: TabKind): string {
  if (protocol === 'rest') return 'New request';
  if (protocol === 'grpc') return 'New gRPC call';
  if (protocol === 's3') return 'S3 browser';
  return 'Workflows';
}

function makeTab(protocol: TabKind, connectionId = ''): Tab {
  const common = { id: uid('tab'), name: defaultName(protocol), dirty: false };

  if (protocol === 'rest') {
    return { ...common, protocol: 'rest', request: blankRest(), missingVars: [], sending: false };
  }
  if (protocol === 'grpc') {
    return {
      ...common,
      protocol: 'grpc',
      request: blankGrpc(),
      services: [],
      events: [],
      running: false,
      discovering: false,
    };
  }
  if (protocol === 'workflow') return { ...common, protocol: 'workflow' };
  return { ...common, protocol: 's3', connectionId, bucket: '', prefix: '' };
}

export const useStore = create<State>((set, get) => ({
  tabs: [],
  activeTabId: null,

  collections: [],
  environments: [],
  activeEnvId: null,
  connections: [],
  settings: null,
  toasts: [],
  activeWorkflowId: null,

  openWorkflow(id) {
    // Reuse an open workflow tab rather than stacking duplicates.
    const existing = get().tabs.find((t) => t.protocol === 'workflow');
    if (existing) set({ activeTabId: existing.id, activeWorkflowId: id });
    else {
      const tab = makeTab('workflow');
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, activeWorkflowId: id }));
    }
  },

  newTab(protocol) {
    const tab = makeTab(protocol, get().connections[0]?.id ?? '');
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  openSaved(collection, request) {
    // Re-focus rather than opening a duplicate of something already open.
    const existing = get().tabs.find((t) => t.savedTo?.requestId === request.id);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const savedTo = { collectionId: collection.id, requestId: request.id };
    let tab: Tab;

    if (request.protocol === 'rest') {
      tab = {
        id: uid('tab'),
        name: request.name,
        dirty: false,
        savedTo,
        protocol: 'rest',
        request: request.rest ?? blankRest(),
        missingVars: [],
        sending: false,
      };
    } else if (request.protocol === 'grpc') {
      tab = {
        id: uid('tab'),
        name: request.name,
        dirty: false,
        savedTo,
        protocol: 'grpc',
        request: request.grpc ?? blankGrpc(),
        services: [],
        events: [],
        running: false,
        discovering: false,
      };
    } else {
      tab = {
        id: uid('tab'),
        name: request.name,
        dirty: false,
        savedTo,
        protocol: 's3',
        connectionId: request.s3?.connectionId ?? '',
        bucket: request.s3?.bucket ?? '',
        prefix: request.s3?.prefix ?? '',
      };
    }

    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  closeTab(id) {
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      if (s.activeTabId !== id) return { tabs };
      // Focus the neighbour that takes the closed tab's place.
      const next = tabs[Math.min(index, tabs.length - 1)];
      return { tabs, activeTabId: next?.id ?? null };
    });
  },

  setActiveTab(id) {
    set({ activeTabId: id });
  },

  patchTab(id, patch) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)),
    }));
  },

  renameTab(id, name) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, name, dirty: true } : t)),
    }));
  },

  async refreshCollections() {
    set({ collections: await window.crafillio.collections.list() });
  },

  async refreshEnvironments() {
    const file = await window.crafillio.environments.load();
    set({ environments: file.environments, activeEnvId: file.activeId });
  },

  async refreshConnections() {
    set({ connections: await window.crafillio.connections.list() });
  },

  async refreshSettings() {
    const settings = await window.crafillio.settings.load();
    set({ settings });
    applyTheme(settings.theme);
    // Language is applied here so a saved locale is live before first paint.
    void useI18n.getState().setLocale((settings.locale ?? 'en') as LocaleCode);
    document.documentElement.style.setProperty('--font-size', `${settings.fontSize}px`);
  },

  toast(kind, message) {
    const toast: Toast = { id: uid('toast'), kind, message };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    setTimeout(() => get().dismissToast(toast.id), kind === 'error' ? 8000 : 3500);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Narrow the active tab, or null. */
export function useActiveTab(): Tab | null {
  return useStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
}
