import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The squad rig is 6.3 MB of skinned animation, and React StrictMode mounts the match
 * tree twice in dev, so with no cache header one reload pulls the whole model through
 * the preview proxy twice — which is what a "very slow session" looks like from the
 * outside. Five minutes survives a reload storm and leaves a regenerated asset
 * (tools/fetch_mixamo.mjs) stale for a coffee break at worst. Production is a single
 * inlined HTML file that never asks, so this is dev-only by nature.
 *
 * It is a middleware and not `server.headers`, because `server.headers` is a map of
 * HEADER NAME to value: writing `{ '/assets/models/rugby_player.glb': 'Cache-Control:
 * …' }` makes Vite call `setHeader('/assets/models/rugby_player.glb', …)`, an invalid
 * header name that throws on EVERY request — `/` included — so the dev server answers
 * 500 for the whole app and the boot you just fixed looks broken again. A config file
 * that typechecks is not a config that serves; this one is now checked by asking the
 * running server for both GLBs and the page.
 */
function cacheMatchDayAssets(): Plugin {
  return {
    name: "cache-matchday-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (/^\/assets\/models\/[^?#]+\.glb(\?|$)/.test(req.url ?? "")) {
          res.setHeader("Cache-Control", "public, max-age=300");
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), cacheMatchDayAssets()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  /* The Arena preview proxies the dev server under an e2b.app host —
   * Vite 7 blocks unknown Host headers by default. */
  server: {
    allowedHosts: true,
  },
});
