import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { PRODUCTION_CSP } from "./src/main/csp";

/** Strict CSP meta in built HTML only; the dev server needs React refresh's inline preamble. */
function productionCsp(): Plugin {
  return {
    name: "vesta:production-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`);
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/main/index.ts"),
          // The search extraction worker thread (006 research §2), loaded by src/main/search/pool.ts.
          "search-worker": resolve(import.meta.dirname, "src/main/search/worker.ts"),
        },
        external: ["better-sqlite3"],
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads run as one classic script, not an ES module (research.md §9).
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: {
        input: { index: resolve(import.meta.dirname, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    build: {
      // No data: URLs for fonts or images; CSP allows only 'self' for fonts (research.md §9).
      assetsInlineLimit: 0,
      rolldownOptions: {
        input: { index: resolve(import.meta.dirname, "src/renderer/index.html") },
      },
    },
    plugins: [react(), productionCsp()],
  },
});
