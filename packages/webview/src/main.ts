import { Editor } from "@tiptap/core";
import { createCoreExtensions } from "@/editor/extensions/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import type { HostMessage, WebviewMessage } from "./protocol";
import { PROTOCOL_VERSION } from "./protocol";
import "./editor.css";

declare function acquireVsCodeApi(): { postMessage(msg: WebviewMessage): void };

const vscode = acquireVsCodeApi();
const EDIT_DEBOUNCE_MS = 250;

// ── Sync state (webview side of architecture §5) ─────────────────────────────
//
// One edit in flight at a time. `version` is the last document version the
// host delivered (init / docChanged / ack); every outgoing edit carries it as
// baseVersion. If an external docChanged wins a race against our in-flight
// edit, the external content is applied and any keystrokes from the race
// window are re-serialized on the next update (external edit wins, D3).
let version = -1;
let inFlight = false;
let pendingDirty = false;
let applyingExternal = false;
/** LF text the host last confirmed (init/docChanged, or our own acked edit). */
let lastSyncedText = "";
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const mount = document.getElementById("editor")!;
const editor = new Editor({
  element: mount,
  extensions: createCoreExtensions(),
  content: { type: "doc", content: [{ type: "paragraph" }] },
  editable: false, // until init arrives
  onUpdate: () => {
    if (applyingExternal) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendEdit, EDIT_DEBOUNCE_MS);
  },
  editorProps: {
    attributes: { spellcheck: "true" },
  },
});

function sendEdit(): void {
  if (inFlight) {
    pendingDirty = true;
    return;
  }
  const markdown = serializeDocToMarkdown(editor.getJSON() as never);
  if (markdown === lastSyncedText) return;
  inFlight = true;
  vscode.postMessage({ type: "edit", markdown, baseVersion: version });
}

function applyExternal(text: string): void {
  applyingExternal = true;
  try {
    const selection = editor.state.selection.from;
    editor.commands.setContent(parseMarkdownToDoc(text) as never);
    // Re-anchor: clamp the previous cursor into the new document. Exact
    // diff-based mapping is a refinement tracked for Phase 1.
    const max = editor.state.doc.content.size;
    editor.commands.setTextSelection(Math.max(1, Math.min(selection, max - 1)));
  } finally {
    applyingExternal = false;
  }
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      if (msg.protocol !== PROTOCOL_VERSION) {
        mount.textContent =
          "Requirements Editor: extension and webview versions do not match. Reinstall the extension.";
        return;
      }
      version = msg.version;
      lastSyncedText = msg.text;
      inFlight = false;
      pendingDirty = false;
      applyExternal(msg.text);
      editor.setEditable(true);
      editor.commands.focus("start");
      break;
    }
    case "docChanged": {
      version = msg.version;
      lastSyncedText = msg.text;
      inFlight = false;
      pendingDirty = false;
      applyExternal(msg.text);
      break;
    }
    case "ack": {
      version = msg.version;
      inFlight = false;
      // The host confirmed our last serialization verbatim.
      lastSyncedText = serializeDocToMarkdown(editor.getJSON() as never);
      if (pendingDirty) {
        pendingDirty = false;
        sendEdit();
      }
      break;
    }
  }
});

// ── Key forwarding (architecture §6 forwardKey) ──────────────────────────────
// Undo/redo/save must act on the TextDocument's single undo stack (D5), so
// the webview never handles them locally.
window.addEventListener(
  "keydown",
  (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      e.stopPropagation();
      // Flush any pending edit first so undo sees the latest state.
      clearTimeout(debounceTimer);
      sendEdit();
      vscode.postMessage({ type: "forwardKey", command: e.shiftKey ? "redo" : "undo" });
    } else if (key === "y" && e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(debounceTimer);
      sendEdit();
      vscode.postMessage({ type: "forwardKey", command: "redo" });
    } else if (key === "s") {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(debounceTimer);
      sendEdit();
      vscode.postMessage({ type: "forwardKey", command: "save" });
    }
  },
  { capture: true },
);

vscode.postMessage({ type: "ready" });
