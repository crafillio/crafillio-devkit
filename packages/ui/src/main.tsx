import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Fonts are bundled, not fetched — the app must work with no network at all,
// and the renderer's CSP blocks external origins outright. All three are
// OFL-1.1 variable fonts, so one file per family covers every weight.
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/jetbrains-mono';

import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing from index.html');

async function start(): Promise<void> {
  // Browser preview mode: no Electron preload, so stand in a mock bridge.
  // The dynamic import keeps the mock out of the production bundle.
  if (import.meta.env.VITE_CRAFILLIO_MOCK && !window.crafillio) {
    const { installMockBridge } = await import('./dev/mockBridge');
    installMockBridge();
  }

  createRoot(container!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
