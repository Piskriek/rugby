import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The new simulation reads its content database from the design-corpus repo
// root (../src/game/data.ts — the single source of truth, zero imports).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      design: fileURLToPath(new URL('../src/game', import.meta.url)),
    },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    host: '0.0.0.0',
    // dev previews arrive on per-sandbox hostnames; vite 7 blocks unknown
    // Host headers by default
    allowedHosts: true,
  },
  build: { outDir: 'dist', sourcemap: false },
});
