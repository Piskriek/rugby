import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import type { IncomingMessage, ServerResponse } from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Arena's preview proxy 502s large binaries (player.glb is 4.2 MB). Vite
 * itself serves them fine; the proxy buffers or times out. This plugin:
 *   1. serves /assets/models/*.glb with CORS + a real Content-Length
 *   2. answers ?part=i&of=n with a slice (~500 KB) so the loader can
 *      reassemble under the proxy cap
 */
function serveModelParts(): Plugin {
  const publicDir = path.join(__dirname, "public");
  const send = (res: ServerResponse, body: Buffer, type: string) => {
    res.statusCode = 200;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(body.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(body);
  };
  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const raw = req.url ?? "";
    let u: URL;
    try { u = new URL(raw, "http://vite.local"); } catch { next(); return; }
    const pathname = decodeURIComponent(u.pathname);
    if (!pathname.startsWith("/assets/models/")) { next(); return; }
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.end();
      return;
    }
    /* Path slices: /assets/models/player.glb.p/0/8 — query strings can be
     * stripped by the preview proxy, so the loader prefers this form. */
    const sliced = pathname.match(/^\/assets\/models\/([^/]+\.glb)\.p\/(\d+)\/(\d+)$/);
    const glbName = sliced ? sliced[1] : (pathname.endsWith(".glb") ? pathname.slice("/assets/models/".length) : null);
    if (!glbName) { next(); return; }
    const file = path.join(publicDir, "assets/models", glbName);
    if (!file.startsWith(path.join(publicDir, "assets/models")) || !fs.existsSync(file)) { next(); return; }
    const buf = fs.readFileSync(file);
    const part = sliced ? sliced[2] : u.searchParams.get("part");
    const of = sliced ? sliced[3] : u.searchParams.get("of");
    if (part != null && of != null) {
      const n = Math.max(1, Number(of) | 0);
      const i = Math.max(0, Number(part) | 0);
      if (i >= n) { res.statusCode = 416; res.end(); return; }
      const size = Math.ceil(buf.length / n);
      const slice = buf.subarray(i * size, Math.min(buf.length, (i + 1) * size));
      send(res, slice, "application/octet-stream");
      return;
    }
    send(res, buf, "model/gltf-binary");
  };
  return {
    name: "serve-model-parts",
    configureServer(server) {
      server.middlewares.use((req, res, next) => handle(req, res, next));
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [
    serveModelParts(),
    react(),
    tailwindcss(),
    ...(command === "build"
      ? [
          viteSingleFile({
            useRecommendedBuildConfig: false,
            inlinePattern: ["index-*.js", "*.css"],
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    assetsDir: "",
    rollupOptions: {
      output: {
        manualChunks: {
          rapier: ["@dimforge/rapier3d-compat"],
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    watch: { ignored: ["**/AnimationRef/**", "**/.cache/**"] },
  },
}));
