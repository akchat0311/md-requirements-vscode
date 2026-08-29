import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the editor webview into the extension's media/ directory, from
// which ReqEditorProvider serves it via asWebviewUri:
//   editor.js (entry, ESM) + editor.css + assets/ (lazy chunks: mermaid,
//   katex; katex fonts). base "./" keeps every emitted URL relative so it
//   resolves against the vscode-webview:// URI space.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
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
      input: path.resolve(dirname, "src/main.tsx"),
      output: {
        format: "esm",
        entryFileNames: "editor.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (info) =>
          info.names?.some((n) => n.endsWith(".css"))
            ? "editor[extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
