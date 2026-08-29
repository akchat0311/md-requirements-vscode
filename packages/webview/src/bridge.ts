import type { Editor } from "@tiptap/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { mergePreservingUnchangedBlocks } from "@/markdown/sourcePreservation";
import { expandSoftBreaks, collapseSoftBreaks } from "@/markdown/softBreaks";
import { stripEmptyTopLevelParagraphs } from "@/markdown/emptyParagraphs";
import { ensureKatex } from "@/editor/utils/katexLoader";
import { useConfigStore } from "@/stores/configStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { initSidecars, onSidecarChanged } from "./sidecars";
import { buildCsv } from "./exports";
import type { EditorConfig, HostMessage, WebviewMessage } from "./protocol";
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
let docName = "document.md";
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
  // Empty top-level paragraphs are ephemeral UI state and never serialize.
  const canonical = serializeDocToMarkdown(
    stripEmptyTopLevelParagraphs(collapseSoftBreaks(editor.getJSON() as never)) as never,
  );
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

function applyConfig(config: EditorConfig): void {
  const store = useConfigStore.getState();
  const pattern = config.requirementPattern;
  if (pattern === null) {
    store.clearRequirementPattern();
  } else if (pattern.mode === "regex") {
    // An invalid regex is stored as typed; compileRequirementPattern treats
    // it as unconfigured (the engine's single choke point for validity).
    store.setRequirementRegexPattern(pattern.source, pattern.flags);
  } else {
    store.setRequirementPattern(pattern.example);
  }
}

function handleHostMessage(msg: HostMessage): void {
  if (!editor) return;
  switch (msg.type) {
    case "configChanged":
      applyConfig(msg.config);
      return;
    case "sidecarChanged":
      onSidecarChanged(msg.kind, msg.data);
      return;
    case "requestExport": {
      const result = buildCsv(msg.kind, editor, docName);
      vscode.postMessage({ type: "exportResult", kind: msg.kind, ...result });
      return;
    }
    case "showDashboard":
      window.dispatchEvent(new CustomEvent("mdreq:showDashboard"));
      return;
    default:
      break;
  }
  switch (msg.type) {
    case "init": {
      if (msg.protocol !== PROTOCOL_VERSION) {
        document.getElementById("editor")!.textContent =
          "Requirements Editor: extension and webview versions do not match. Reinstall the extension.";
        return;
      }
      applyConfig(msg.config);
      version = msg.version;
      lastSyncedText = msg.text;
      docName = msg.docName;
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
  (window as unknown as Record<string, unknown>).__mdreqEditor = liveEditor;

  window.addEventListener("message", (event: MessageEvent<HostMessage>) =>
    handleHostMessage(event.data),
  );

  initSidecars((msg) => vscode.postMessage(msg));

  // Load requirement statuses (fetch of the config JSON fails inside the
  // webview CSP; the service falls back to its built-in default set — the
  // store must still be populated for the dashboard/status UI).
  void useStatusConfigStore.getState().load();

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
