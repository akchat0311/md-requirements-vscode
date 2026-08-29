import type { Editor } from "@tiptap/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { mergePreservingUnchangedBlocks } from "@/markdown/sourcePreservation";
import { expandSoftBreaks, collapseSoftBreaks } from "@/markdown/softBreaks";
import { ensureKatex } from "@/editor/utils/katexLoader";
import type { HostMessage, WebviewMessage } from "./protocol";
import { PROTOCOL_VERSION } from "./protocol";

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
let editor: Editor | null = null;
let version = -1;
let inFlight = false;
let pendingDirty = false;
let applyingExternal = false;
/** LF text the host last confirmed (init/docChanged, or our own acked edit). */
let lastSyncedText = "";
/** LF text of the edit currently in flight (becomes lastSyncedText on ack). */
let lastSentText = "";
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Called from the editor's onUpdate; no-op until the bridge is initialized. */
export function bridgeHandleUpdate(): void {
  if (!editor || applyingExternal) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sendEdit, EDIT_DEBOUNCE_MS);
}

function sendEdit(): void {
  if (!editor) return;
  if (inFlight) {
    pendingDirty = true;
    return;
  }
  // D9: serialize canonically, then re-emit every unchanged block verbatim
  // from the current document text — untouched lines never get rewritten.
  const canonical = serializeDocToMarkdown(collapseSoftBreaks(editor.getJSON() as never) as never);
  const markdown = mergePreservingUnchangedBlocks(lastSyncedText, canonical);
  if (markdown === lastSyncedText) return;
  inFlight = true;
  lastSentText = markdown;
  vscode.postMessage({ type: "edit", markdown, baseVersion: version });
}

function applyExternal(text: string): void {
  if (!editor) return;
  applyingExternal = true;
  try {
    const selection = editor.state.selection.from;
    editor.commands.setContent(expandSoftBreaks(parseMarkdownToDoc(text)) as never);
    // Re-anchor: clamp the previous cursor into the new document. Exact
    // diff-based mapping is a refinement tracked for Phase 1.
    const max = editor.state.doc.content.size;
    editor.commands.setTextSelection(Math.max(1, Math.min(selection, max - 1)));
  } finally {
    applyingExternal = false;
  }
}

function handleHostMessage(msg: HostMessage): void {
  if (!editor) return;
  switch (msg.type) {
    case "init": {
      if (msg.protocol !== PROTOCOL_VERSION) {
        document.getElementById("editor")!.textContent =
          "Requirements Editor: extension and webview versions do not match. Reinstall the extension.";
        return;
      }
      version = msg.version;
      lastSyncedText = msg.text;
      inFlight = false;
      pendingDirty = false;
      // Wait for the (local, lazy) KaTeX chunk before first render: math
      // widgets built before it loads show a plain-source placeholder and
      // only refresh on the next transaction.
      void ensureKatex()
        .catch(() => {})
        .then(() => {
          const e = editor;
          if (!e) return;
          applyExternal(msg.text);
          e.setEditable(true);
          e.commands.focus("start");
        });
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
      // The host confirmed our last sent text verbatim.
      lastSyncedText = lastSentText;
      if (pendingDirty) {
        pendingDirty = false;
        sendEdit();
      }
      break;
    }
  }
}

/**
 * Attach the bridge to the live editor: listen for host messages, forward
 * undo/redo/save chords (architecture §6 / D5 — the TextDocument owns the
 * only undo stack), and announce readiness so the host sends `init`.
 */
export function initBridge(liveEditor: Editor): void {
  if (editor) return; // React StrictMode double-invoke guard
  editor = liveEditor;

  window.addEventListener("message", (event: MessageEvent<HostMessage>) =>
    handleHostMessage(event.data),
  );

  window.addEventListener(
    "keydown",
    (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const forward = (command: "undo" | "redo" | "save") => {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(debounceTimer);
        sendEdit(); // flush so the host acts on the latest state
        vscode.postMessage({ type: "forwardKey", command });
      };
      if (key === "z") forward(e.shiftKey ? "redo" : "undo");
      else if (key === "y" && e.ctrlKey) forward("redo");
      else if (key === "s") forward("save");
    },
    { capture: true },
  );

  vscode.postMessage({ type: "ready" });
}
