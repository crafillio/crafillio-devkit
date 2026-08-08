#!/usr/bin/env node
/**
 * Bundles the Electron main and preload scripts with esbuild.
 *
 * Bundling rather than shipping node_modules keeps the packaged app small and
 * sidesteps npm workspace hoisting, which electron-builder handles poorly.
 * Every runtime dependency (grpc-js, the AWS SDK, undici, protobufjs) is pure
 * JavaScript, so it all inlines cleanly.
 */

import { build, context } from 'esbuild';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  // Electron 33 ships Node 20.
  target: 'node20',
  format: 'cjs',
  sourcemap: dev,
  minify: !dev,
  // Provided by the Electron runtime, never bundled.
  external: ['electron'],
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
};

const targets = [
  { ...shared, entryPoints: [join(here, 'src/main.ts')], outfile: join(here, 'dist/main.js') },
  {
    ...shared,
    entryPoints: [join(here, 'src/preload.ts')],
    outfile: join(here, 'dist/preload.js'),
  },
];

if (!dev) {
  await Promise.all(targets.map((t) => build(t)));
  process.exit(0);
}

// Dev: rebuild the shell on change, run Vite for the renderer, and launch
// Electron pointed at the dev server.
const contexts = await Promise.all(targets.map((t) => context(t)));
await Promise.all(contexts.map((c) => c.watch()));

const uiDir = join(here, '../../packages/ui');
const vite = spawn('npm', ['run', 'dev'], { cwd: uiDir, stdio: 'inherit', shell: true });

const DEV_URL = 'http://localhost:5273';
await waitForServer(DEV_URL);

const electronBin = join(here, '../../node_modules/.bin/electron');
const app = spawn(electronBin, [here], {
  stdio: 'inherit',
  env: { ...process.env, CRAFILLIO_DEV_URL: DEV_URL },
});

const shutdown = () => {
  vite.kill();
  app.kill();
  contexts.forEach((c) => c.dispose());
  process.exit(0);
};

app.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Vite did not come up at ${url} within ${timeoutMs}ms`);
}
