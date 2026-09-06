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
  /* Set by vite-plugin-singlefile's recommended build config; declared here
   * because we opt that config OUT (see the plugin below) but keep its
   * effect. */
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    /* The plugin's default "recommended build config" forces
     * `output.inlineDynamicImports: true`. That is the one option we must
     * drop: (a) Rollup hard-rejects `output.manualChunks` while it is set
     * ("this option is not supported for output.inlineDynamicImports"),
     * and (b) it welds every module — the ~2 MB @dimforge/rapier3d-compat
     * ESM wrapper around its base64-embedded WASM included — into one
     * entry chunk, which is the largest single object the minify and
     * singlefile-inline phases ever have to hold. We opt out and
     * re-declare everything else it used to set (see `build` below):
     * inline all assets, one CSS file, flat output dir. `inlinePattern`
     * keeps the original single-file behaviour for the entry chunk and
     * its CSS; the rapier chunk is emitted as its own file, which the
     * inlined entry imports by relative URL. (The other half of the OOM
     * story — Tailwind's scanner walking the binary assets — is
     * documented in src/index.css.) */
    viteSingleFile({
      useRecommendedBuildConfig: false,
      inlinePattern: ["index-*.js", "*.css"],
    }),
    cacheMatchDayAssets(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    /* The rest of vite-plugin-singlefile's recommended config, minus
     * `output.inlineDynamicImports` (forbidden with manualChunks below). */
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    assetsDir: "",
    rollupOptions: {
      output: {
        /* Split @dimforge/rapier3d-compat into its own chunk. It is the
         * ~2 MB ESM wrapper around the base64-embedded WASM binary, and
         * with inlineDynamicImports off it is the one module the entry
         * no longer has to carry: the entry chunk (and the minify and
         * singlefile-inline passes over it) drop back to the size of the
         * app itself, and the singlefile plugin only has to inline that.
         * The rapier chunk is emitted as a sibling file in dist, which
         * the inlined entry loads by relative URL. */
        manualChunks: {
          rapier: ["@dimforge/rapier3d-compat"],
        },
      },
    },
  },
  /* The Arena preview proxies the dev server under an e2b.app host —
   * Vite 7 blocks unknown Host headers by default. */
  server: {
    allowedHosts: true,
  },
});
