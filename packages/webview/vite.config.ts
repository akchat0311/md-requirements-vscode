import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the editor webview as a single IIFE bundle into the extension's
// media/ directory, from which ReqEditorProvider serves it via asWebviewUri.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "../engine/src"),
    },
  },
  build: {
    outDir: path.resolve(dirname, "../extension/media"),
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(dirname, "src/main.ts"),
      output: {
        format: "esm",
        inlineDynamicImports: true,
        entryFileNames: "editor.js",
        assetFileNames: "editor[extname]",
      },
    },
  },
});
