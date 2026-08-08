import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Electron loads the built renderer over file://, where absolute asset paths
  // resolve against the filesystem root and 404.
  base: './',
  server: { port: 5273, strictPort: true },
  build: {
    outDir: resolve(__dirname, '../../apps/desktop/dist/renderer'),
    emptyOutDir: true,
    target: 'chrome128',
    sourcemap: false,
  },
});
