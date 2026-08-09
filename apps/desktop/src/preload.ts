/**
 * Preload bridge.
 *
 * Runs with context isolation on, so the renderer gets exactly the functions
 * below and no access to Node. Every method is a thin `invoke` — no logic here,
 * because anything in this file is reachable from page content.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { CrafillioApi } from './api.js';

/** Wraps a channel as a promise-returning function. */
const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>;

/** Subscribes to a push channel and returns an unsubscribe function. */
function subscribe(channel: string, listener: (...args: never[]) => void): () => void {
  const handler = (_event: unknown, ...args: unknown[]): void => {
    (listener as (...a: unknown[]) => void)(...args);
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: CrafillioApi = {
  rest: {
    send: call('rest:send'),
  },

  grpc: {
    describe: call('grpc:describe'),
    invoke: call('grpc:invoke'),
    cancel: call('grpc:cancel'),
    onEvent: (listener) => subscribe('grpc:event', listener as never),
  },

  s3: {
    listBuckets: call('s3:listBuckets'),
    createBucket: call('s3:createBucket'),
    deleteBucket: call('s3:deleteBucket'),
    listObjects: call('s3:listObjects'),
    head: call('s3:head'),
    updateMetadata: call('s3:updateMetadata'),
    upload: call('s3:upload'),
    putText: call('s3:putText'),
    download: call('s3:download'),
    preview: call('s3:preview'),
    deleteObject: call('s3:deleteObject'),
    deleteObjects: call('s3:deleteObjects'),
    deletePrefix: call('s3:deletePrefix'),
    presign: call('s3:presign'),
    onProgress: (listener) => subscribe('s3:progress', listener as never),
  },

  connections: {
    list: call('connections:list'),
    save: call('connections:save'),
    remove: call('connections:remove'),
  },

  collections: {
    list: call('collections:list'),
    create: call('collections:create'),
    rename: call('collections:rename'),
    remove: call('collections:remove'),
    saveRequest: call('collections:saveRequest'),
    removeRequest: call('collections:removeRequest'),
    createFolder: call('collections:createFolder'),
    removeFolder: call('collections:removeFolder'),
    moveRequest: call('collections:moveRequest'),
    exportToFile: call('collections:export'),
    importFromFile: call('collections:import'),
  },

  environments: {
    load: call('environments:load'),
    save: call('environments:save'),
    create: call('environments:create'),
    remove: call('environments:remove'),
    setActive: call('environments:setActive'),
    active: call('environments:active'),
  },

  history: {
    list: call('history:list'),
    record: call('history:record'),
    clear: call('history:clear'),
  },

  settings: {
    load: call('settings:load'),
    save: call('settings:save'),
  },

  perf: {
    start: call('perf:start'),
    stop: call('perf:stop'),
    onProgress: (listener) => subscribe('perf:progress', listener as never),
    onComplete: (listener) => subscribe('perf:complete', listener as never),
    exportReport: call('perf:exportReport'),
  },

  tools: {
    decodeJwt: call('tools:decodeJwt'),
    capture: call('tools:capture'),
  },

  workflow: {
    list: call('workflow:list'),
    create: call('workflow:create'),
    save: call('workflow:save'),
    remove: call('workflow:remove'),
    export: call('workflow:export'),
    import: call('workflow:import'),
    checkCondition: call('workflow:checkCondition'),
    run: call('workflow:run'),
    cancel: call('workflow:cancel'),
    onEvent: (listener) => subscribe('workflow:event', listener as never),
    exportReport: call('workflow:exportReport'),
    exportPdf: call('workflow:exportPdf'),
    openReport: call('workflow:openReport'),
  },

  interop: {
    importCurl: call('interop:importCurl'),
    exportCurl: call('interop:exportCurl'),
    importPostman: call('interop:importPostman'),
    importOpenApi: call('interop:importOpenApi'),
    importHoppscotch: call('interop:importHoppscotch'),
    importBruno: call('interop:importBruno'),
  },

  dialog: {
    openFiles: call('dialog:openFiles'),
    openDirectory: call('dialog:openDirectory'),
    saveFile: call('dialog:saveFile'),
    saveTextFile: call('dialog:saveTextFile'),
  },

  app: {
    version: call('app:version'),
    dataDirectory: call('app:dataDirectory'),
    revealDataDirectory: call('app:revealDataDirectory'),
    secretsAvailable: call('app:secretsAvailable'),
    secretBackend: call('app:secretBackend'),
    setSecretBackend: call('app:setSecretBackend'),
    openExternal: call('app:openExternal'),
  },
};

contextBridge.exposeInMainWorld('crafillio', api);
