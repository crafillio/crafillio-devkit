/// <reference types="vite/client" />

// Brings `window.crafillio` into scope for the renderer. The declaration itself
// lives with the IPC contract so the bridge and its consumer cannot drift.
import '@crafillio/desktop/src/api';
