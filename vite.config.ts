import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  /* The Arena preview proxies the dev server under an e2b.app host —
   * Vite 7 blocks unknown Host headers by default. */
  server: {
    allowedHosts: true,
    /* The squad rig is 6.3 MB of skinned animation and React StrictMode mounts the
     * match tree twice in dev, so with no cache header one reload pulled the whole
     * model through the preview proxy twice — which is what a "very slow session"
     * looks like from the outside. Five minutes survives a reload storm and leaves a
     * regenerated asset (tools/fetch_mixamo.mjs) stale for a coffee break at worst.
     * Production is a single inlined HTML file, so this is dev-only by nature. */
    headers: {
      '/assets/models/rugby_player.glb': 'Cache-Control: public, max-age=300',
      '/assets/models/tackle_pair.glb': 'Cache-Control: public, max-age=300',
    },
  },
});
