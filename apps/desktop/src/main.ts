/**
 * Crafillio DevKit main process.
 *
 * Owns every privileged operation: the protocol engines, disk access and the
 * OS keychain. The renderer reaches none of it directly — only through the
 * handlers registered in `registerHandlers`.
 */

import { app, BrowserWindow, dialog, nativeTheme, safeStorage, shell, Menu } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  closeRestAgents,
  collections,
  connections,
  describeGrpc,
  environments,
  ensureHome,
  history,
  invokeGrpc,
  perf,
  importCurl,
  exportCurl,
  importPostmanCollection,
  workflows,
  runWorkflow,
  renderReport,
  type LoadProfile,
  type LoadReport,
  type LoadTarget,
  registerSecretProvider,
  setPreferredSecretBackend,
  preferredSecretBackend,
  createKeyfileProvider,
  PATHS,
  s3,
  secretsAvailable,
  sendRest,
  settings,
  CRAFILLIO_HOME,
  type GrpcCall,
} from '@crafillio/core';
import { ipcMain } from 'electron';

const DEV_URL = process.env.CRAFILLIO_DEV_URL;

let mainWindow: BrowserWindow | null = null;

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

/** Must track `--bg` in styles.css, or launch flashes the wrong colour. */
const WINDOW_BACKGROUND = { dark: '#0d0e12', light: '#f2f3f6' } as const;

/**
 * Picks the window chrome colour before the renderer paints. Reading the saved
 * theme here is what stops a dark flash when the user runs in light mode.
 */
async function startupBackground(): Promise<string> {
  try {
    const saved = await settings.loadSettings();
    const scheme =
      saved.theme === 'system'
        ? nativeTheme.shouldUseDarkColors
          ? 'dark'
          : 'light'
        : saved.theme;
    return WINDOW_BACKGROUND[scheme];
  } catch {
    return WINDOW_BACKGROUND.dark;
  }
}

function createWindow(background: string): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: background,
    // Keeps the traffic lights but lets the tab strip run to the top edge.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'right' });
  } else {
    void mainWindow.loadFile(join(__dirname, 'renderer/index.html'));
  }

  // Requests belong in the app; anything trying to open a window goes to the
  // real browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ------------------------------------------------------------------ */
/* Secrets                                                             */
/* ------------------------------------------------------------------ */

/**
 * Wires up secret encryption.
 *
 * The keyfile backend is always registered — it needs nothing from the OS and
 * never prompts. `safeStorage` is only touched when the user has explicitly
 * chosen the keychain, because merely calling `isEncryptionAvailable()` is
 * enough to raise the macOS keychain dialog.
 */
async function wireSecretProvider(): Promise<void> {
  registerSecretProvider(createKeyfileProvider(PATHS.secretKey), 'keyfile');

  let choice: 'keyfile' | 'os' = 'keyfile';
  try {
    choice = (await settings.loadSettings()).secretStorage;
  } catch {
    /* Fall back to the prompt-free backend. */
  }

  if (choice === 'os') {
    try {
      registerSecretProvider(
        {
          available: safeStorage.isEncryptionAvailable(),
          encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString('base64'),
          decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
        },
        'os',
      );
      setPreferredSecretBackend('os');
      return;
    } catch (err) {
      // A machine with no usable keychain must still be able to store secrets.
      console.warn('Keychain unavailable, falling back to keyfile:', (err as Error).message);
    }
  }

  setPreferredSecretBackend('keyfile');
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

/** In-flight gRPC calls, so the renderer can cancel one by id. */
const activeCalls = new Map<string, GrpcCall>();

/** In-flight load tests, so a run can be stopped from the UI. */
const activeRuns = new Map<string, { stop(): void }>();

/** In-flight workflow runs, so a run can be cancelled mid-flight. */
const activeWorkflowRuns = new Map<string, { cancel(): void }>();

/**
 * Wraps a handler so thrown errors reach the renderer as a plain message.
 * Electron would otherwise prefix them with the whole IPC stack, which buries
 * the part the developer needs.
 */
function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R> | R,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await fn(...(args as A));
    } catch (err) {
      throw new Error((err as Error).message ?? String(err));
    }
  });
}

function registerHandlers(): void {
  /* REST */
  handle('rest:send', sendRest);

  /* gRPC */
  handle('grpc:describe', describeGrpc);

  handle('grpc:invoke', async (request: Parameters<typeof invokeGrpc>[0]) => {
    const callId = randomUUID();
    const target = mainWindow?.webContents;

    const call = await invokeGrpc(request, (event) => {
      // The window can close mid-stream; dropping the event is correct then.
      if (!target || target.isDestroyed()) return;
      target.send('grpc:event', callId, event);
    });

    activeCalls.set(callId, call);
    void call.done.finally(() => activeCalls.delete(callId));
    return callId;
  });

  handle('grpc:cancel', (callId: string) => {
    activeCalls.get(callId)?.cancel();
    activeCalls.delete(callId);
  });

  /* S3 */
  handle('s3:listBuckets', s3.listBuckets);
  handle('s3:createBucket', s3.createBucket);
  handle('s3:deleteBucket', s3.deleteBucket);
  handle('s3:listObjects', s3.listObjects);
  handle('s3:head', s3.headObject);
  handle('s3:updateMetadata', s3.updateMetadata);
  handle('s3:putText', s3.putText);
  handle('s3:preview', s3.previewObject);
  handle('s3:deleteObject', s3.deleteObject);
  handle('s3:deleteObjects', s3.deleteObjects);
  handle('s3:deletePrefix', s3.deletePrefix);
  handle('s3:presign', s3.presign);

  handle(
    's3:upload',
    async (
      conn: Parameters<typeof s3.uploadFile>[0],
      bucket: string,
      key: string,
      filePath: string,
      options?: Parameters<typeof s3.uploadFile>[4],
    ) => {
      const id = randomUUID();
      return s3.uploadFile(conn, bucket, key, filePath, options, (loaded, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('s3:progress', id, loaded, total);
        }
      });
    },
  );

  handle(
    's3:download',
    async (conn: Parameters<typeof s3.downloadFile>[0], bucket: string, key: string) => {
      const suggested = key.split('/').pop() || 'download';
      const result = await dialog.showSaveDialog({ defaultPath: suggested });
      if (result.canceled || !result.filePath) return null;

      const id = randomUUID();
      return s3.downloadFile(conn, bucket, key, result.filePath, (loaded, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('s3:progress', id, loaded, total);
        }
      });
    },
  );

  /* Saved S3 connections */
  handle('connections:list', connections.listConnections);
  handle('connections:save', connections.saveConnection);
  handle('connections:remove', connections.deleteConnection);

  /* Collections */
  handle('collections:list', collections.listCollections);
  handle('collections:create', collections.createCollection);
  handle('collections:rename', collections.renameCollection);
  handle('collections:remove', collections.deleteCollection);
  handle('collections:saveRequest', collections.upsertRequest);
  handle('collections:removeRequest', collections.deleteRequest);
  handle('collections:createFolder', collections.createFolder);
  handle('collections:removeFolder', collections.deleteFolder);
  handle('collections:moveRequest', collections.moveRequest);

  handle('collections:export', async (collectionId: string) => {
    const json = await collections.exportCollection(collectionId);
    const result = await dialog.showSaveDialog({
      defaultPath: 'collection.crafillio.json',
      filters: [{ name: 'Crafillio DevKit collection', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, json, 'utf8');
    return result.filePath;
  });

  handle('collections:import', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Crafillio DevKit collection', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const { readFile } = await import('node:fs/promises');
    return collections.importCollection(await readFile(result.filePaths[0]!, 'utf8'));
  });

  /* Environments */
  handle('environments:load', environments.loadEnvironments);
  handle('environments:save', environments.saveEnvironments);
  handle('environments:create', environments.createEnvironment);
  handle('environments:remove', environments.deleteEnvironment);
  handle('environments:setActive', environments.setActiveEnvironment);
  handle('environments:active', environments.activeVariables);

  /* History */
  handle('history:list', history.loadHistory);
  handle('history:record', history.recordHistory);
  handle('history:clear', history.clearHistory);

  /* Settings */
  handle('settings:load', settings.loadSettings);
  handle('settings:save', settings.saveSettings);

  /* Load testing */
  handle('perf:start', async (target: LoadTarget, profile: LoadProfile) => {
    const push = (channel: string, payload: unknown): void => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    };

    const run = perf.startLoadTest(target, profile, (progress) => push('perf:progress', progress));
    activeRuns.set(run.runId, run);

    void run.done
      .then((report) => push('perf:complete', report))
      .catch((err: Error) => push('perf:error', err.message))
      .finally(() => activeRuns.delete(run.runId));

    return run.runId;
  });

  handle('perf:stop', (runId: string) => {
    activeRuns.get(runId)?.stop();
  });

  handle('perf:exportReport', async (report: LoadReport) => {
    const result = await dialog.showSaveDialog({
      defaultPath: `load-test-${report.runId.slice(0, 8)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;

    const lines = [
      '# Crafillio DevKit load test report',
      `# target,${report.label}`,
      `# started,${report.startedAt}`,
      `# duration_ms,${Math.round(report.durationMs)}`,
      `# concurrency,${report.profile.concurrency}`,
      `# total,${report.total}`,
      `# successful,${report.successful}`,
      `# failed,${report.failed}`,
      `# error_rate_pct,${report.errorRate}`,
      `# requests_per_second,${report.requestsPerSecond}`,
      `# latency_min_ms,${report.latency.min}`,
      `# latency_mean_ms,${report.latency.mean}`,
      `# latency_p50_ms,${report.latency.p50}`,
      `# latency_p90_ms,${report.latency.p90}`,
      `# latency_p95_ms,${report.latency.p95}`,
      `# latency_p99_ms,${report.latency.p99}`,
      `# latency_max_ms,${report.latency.max}`,
      '',
      'second,requests,errors,mean_latency_ms,p95_latency_ms',
      ...report.buckets.map(
        (b) => `${b.second},${b.requests},${b.errors},${b.meanLatencyMs},${b.p95LatencyMs}`,
      ),
    ];
    await writeFile(result.filePath, lines.join('\n'), 'utf8');
    return result.filePath;
  });

  /* Workflows */
  handle('workflow:list', workflows.listWorkflows);
  handle('workflow:create', workflows.createWorkflow);
  handle('workflow:save', workflows.saveWorkflow);
  handle('workflow:remove', workflows.deleteWorkflow);

  handle('workflow:run', async (workflow: Parameters<typeof runWorkflow>[0]) => {
    const push = (event: unknown): void => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workflow:event', event);
    };
    // Environment variables seed the workflow context, exactly as they do for
    // a single request.
    const env = await environments.activeVariables();
    const run = runWorkflow(workflow, env, push);
    activeWorkflowRuns.set(run.runId, run);
    void run.done.finally(() => activeWorkflowRuns.delete(run.runId));
    return run.runId;
  });

  handle('workflow:cancel', (runId: string) => {
    activeWorkflowRuns.get(runId)?.cancel();
  });

  handle('workflow:exportReport', async (result: Parameters<typeof renderReport>[0], workflow?: Parameters<typeof renderReport>[1]) => {
    const stamp = new Date(result.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const slug = result.workflowName.replace(/[^\w.-]+/g, '-').toLowerCase();
    const dialogResult = await dialog.showSaveDialog({
      defaultPath: `${slug}-${stamp}.html`,
      filters: [{ name: 'HTML report', extensions: ['html'] }],
    });
    if (dialogResult.canceled || !dialogResult.filePath) return null;
    await writeFile(dialogResult.filePath, renderReport(result, workflow), 'utf8');
    return dialogResult.filePath;
  });

  handle(
    'workflow:exportPdf',
    async (result: Parameters<typeof renderReport>[0], workflow?: Parameters<typeof renderReport>[1]) => {
      const stamp = new Date(result.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const slug = result.workflowName.replace(/[^\w.-]+/g, '-').toLowerCase();
      const dialogResult = await dialog.showSaveDialog({
        defaultPath: `${slug}-${stamp}.pdf`,
        filters: [{ name: 'PDF document', extensions: ['pdf'] }],
      });
      if (dialogResult.canceled || !dialogResult.filePath) return null;

      // Rendered in an offscreen window and printed with Chromium's own engine,
      // so the PDF matches the HTML exactly and needs no extra dependency.
      const printer = new BrowserWindow({
        show: false,
        webPreferences: { offscreen: true, javascript: false },
      });

      try {
        const html = renderReport(result, workflow);
        await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        // Give web fonts and layout a moment before snapshotting the page.
        await new Promise((resolve) => setTimeout(resolve, 350));

        const pdf = await printer.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
          preferCSSPageSize: false,
        });
        await writeFile(dialogResult.filePath, pdf);
        return dialogResult.filePath;
      } finally {
        printer.destroy();
      }
    },
  );

  handle('workflow:openReport', async (result: Parameters<typeof renderReport>[0], workflow?: Parameters<typeof renderReport>[1]) => {
    // Written beside the app's data so the browser can open it from disk.
    const path = join(CRAFILLIO_HOME, `report-${result.runId.slice(0, 8)}.html`);
    await writeFile(path, renderReport(result, workflow), 'utf8');
    await shell.openPath(path);
    return path;
  });

  /* Interop */
  handle('interop:importCurl', (command: string) => importCurl(command));
  handle('interop:exportCurl', (request: Parameters<typeof exportCurl>[0]) => exportCurl(request));

  handle('interop:importPostman', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Postman collection', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const { readFile } = await import('node:fs/promises');
    const parsed = importPostmanCollection(await readFile(result.filePaths[0]!, 'utf8'));
    // Persist under a fresh id so it shows up like any other collection.
    const saved = await collections.importCollection(JSON.stringify(parsed.collection));
    return { collection: saved, requestCount: parsed.requestCount, skipped: parsed.skipped };
  });

  /* Dialogs */
  handle(
    'dialog:openFiles',
    async (options?: {
      filters?: Array<{ name: string; extensions: string[] }>;
      multiple?: boolean;
    }) => {
      const result = await dialog.showOpenDialog({
        properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: options?.filters,
      });
      if (result.canceled) return [];
      return result.filePaths.map((path) => ({
        path,
        name: basename(path),
        size: statSync(path).size,
      }));
    },
  );

  handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('dialog:saveFile', async (defaultName: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName });
    return result.canceled ? null : (result.filePath ?? null);
  });

  handle('dialog:saveTextFile', async (defaultName: string, content: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });

  /* App */
  handle('app:version', () => app.getVersion());
  handle('app:dataDirectory', () => CRAFILLIO_HOME);
  handle('app:revealDataDirectory', async () => {
    await ensureHome();
    void shell.openPath(CRAFILLIO_HOME);
  });
  handle('app:secretsAvailable', () => secretsAvailable());
  handle('app:secretBackend', () => preferredSecretBackend());

  handle('app:setSecretBackend', async (backend: 'keyfile' | 'os') => {
    await settings.saveSettings({ secretStorage: backend });
    await wireSecretProvider();
    return preferredSecretBackend();
  });

  handle('app:openExternal', async (target: string) => {
    // Only ever hand the OS a scheme that cannot execute something locally;
    // `file:` or a custom scheme here would be an arbitrary-launch hole.
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new Error(`Not a valid URL: ${target}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
      throw new Error(`Refusing to open a ${parsed.protocol} URL.`);
    }
    await shell.openExternal(parsed.toString());
  });
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function buildMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: 'appMenu' }] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Request',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow?.webContents.send('menu:newRequest'),
        },
        {
          label: 'Send',
          accelerator: 'CmdOrCtrl+Return',
          click: () => mainWindow?.webContents.send('menu:send'),
        },
        { type: 'separator' },
        {
          label: 'Reveal Data Folder',
          click: () => void shell.openPath(CRAFILLIO_HOME),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

// A second instance would fight over the same collection files.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    await ensureHome();
    await wireSecretProvider();
    registerHandlers();
    buildMenu();
    createWindow(await startupBackground());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void startupBackground().then(createWindow);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    for (const call of activeCalls.values()) call.cancel();
    for (const run of activeRuns.values()) run.stop();
    for (const run of activeWorkflowRuns.values()) run.cancel();
    void closeRestAgents();
  });
}
