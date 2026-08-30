import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { createEditorExtensions } from "@/editor/extensions";
import { SoftBreak } from "@/editor/extensions/SoftBreak";
import { WebviewImage } from "./WebviewImage";
import { EditorToolbar } from "@/editor/Toolbar";
import { EditorContext } from "@/editor/EditorContext";
import { CommentDrawer } from "@/layout/CommentDrawer";
import { TraceabilityDrawer } from "@/layout/TraceabilityDrawer";
import { Dashboard } from "@/layout/Dashboard";
import { FindReplaceBar } from "@/layout/FindReplaceBar";
import { OutlinePanel } from "@/layout/OutlinePanel";
import { useCommentDrawerStore } from "@/stores/commentDrawerStore";
import { useTraceabilityPanelStore } from "@/stores/traceabilityPanelStore";
import { useConfigStore } from "@/stores/configStore";
import { useValidationStore } from "@/stores/validationStore";
import { useDocumentValidation } from "@/editor/utils/useDocumentValidation";
import type { RequirementRecord } from "@/editor/utils/requirementOps";
import { Toaster } from "@/layout/Toast";
import { useToastStore } from "@/stores/toastStore";
import { bridgeHandleUpdate, initBridge, postDiagnostics, postSidecarAction } from "./bridge";

const autoSaveToast = (): void => {
  useToastStore.getState().show("Sidecars save automatically in VS Code.", "info");
};

export function App() {
  // Full product extension set. undoRedo off: the TextDocument owns the
  // single undo stack (D5). SoftBreak keeps raw \n out of the editable DOM.
  const extensions = useMemo(
    () => [
      ...createEditorExtensions({ undoRedo: false }).filter((e) => e.name !== "image"),
      WebviewImage,
      SoftBreak,
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    editable: false, // until init arrives
    onUpdate: () => {
      // queueMicrotask breaks any synchronous call path during render
      queueMicrotask(bridgeHandleUpdate);
    },
    editorProps: {
      attributes: { spellcheck: "true" },
    },
  });

  useEffect(() => {
    if (editor) initBridge(editor);
  }, [editor]);

  // ── View switching: editor ⟷ dashboard ────────────────────────────────────
  // The dashboard renders in the SAME webview (deviation from architecture
  // §7.2's separate panel): its tabs derive live data from the editor via
  // EditorContext, so a second webview would need its own parsed document.
  // The editor stays mounted (hidden) while the dashboard is shown.
  const [view, setView] = useState<"editor" | "dashboard">("editor");
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [findShowReplace, setFindShowReplace] = useState(false);
  useEffect(() => {
    const onFind = (e: Event) => {
      setView("editor");
      setFindShowReplace(Boolean((e as CustomEvent<{ replace?: boolean }>).detail?.replace));
      setFindOpen(true);
    };
    window.addEventListener("mdreq:find", onFind);
    return () => window.removeEventListener("mdreq:find", onFind);
  }, []);
  useEffect(() => {
    const show = () => setView("dashboard");
    window.addEventListener("mdreq:showDashboard", show);
    return () => window.removeEventListener("mdreq:showDashboard", show);
  }, []);

  const navigateToEditor = useCallback(
    (pmPos: number) => {
      setView("editor");
      requestAnimationFrame(() => {
        if (!editor) return;
        const max = editor.state.doc.content.size;
        editor
          .chain()
          .focus()
          .setTextSelection(Math.max(1, Math.min(pmPos, max - 1)))
          .scrollIntoView()
          .run();
      });
    },
    [editor],
  );

  // ── Document validation (feeds the dashboard's Quality tab) ───────────────
  const requirementPattern = useConfigStore((s) => s.requirementPattern);
  const setValidationIssues = useValidationStore((s) => s.setIssues);
  const validationIssues = useDocumentValidation(editor, requirementPattern);
  useEffect(() => {
    setValidationIssues(validationIssues);
    postDiagnostics(validationIssues);
  }, [validationIssues, setValidationIssues]);

  // ── Contextual right panels (browser-app pattern: one at a time) ──────────
  const drawerReqId = useCommentDrawerStore((s) => s.reqId);
  const drawerStatus = useCommentDrawerStore((s) => s.status);
  const closeDrawer = useCommentDrawerStore((s) => s.close);
  const tracePanelReqId = useTraceabilityPanelStore((s) => s.reqId);
  const closeTracePanel = useTraceabilityPanelStore((s) => s.close);

  useEffect(() => {
    if (drawerReqId) closeTracePanel();
  }, [drawerReqId, closeTracePanel]);

  const drawerRecord: RequirementRecord | null = drawerReqId
    ? { id: drawerReqId, status: drawerStatus, section: "", pmPos: 0, title: "" }
    : null;

  if (!editor) return null;

  return (
    <EditorContext.Provider value={editor}>
      <div className="flex h-screen w-full overflow-hidden" data-view={view}>
        <div className={view === "editor" ? "flex min-w-0 flex-1" : "hidden"}>
          {outlineOpen && (
            <div
              id="outline-panel"
              className="h-full w-[260px] shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-paper)]"
            >
              <OutlinePanel width={260} noWidthStyle />
            </div>
          )}
          <div className="min-w-0 flex-1 overflow-y-auto">
            <FindReplaceBar
              open={findOpen}
              showReplace={findShowReplace}
              onClose={() => setFindOpen(false)}
            />
            <div id="editor-scroll" className="w-full py-8">
              <EditorToolbar editor={editor} />
              <div className="doc-page">
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
          {drawerRecord && (
            <div className="h-full w-[380px] shrink-0 overflow-hidden border-l border-[var(--color-border)]">
              <CommentDrawer record={drawerRecord} onClose={closeDrawer} />
            </div>
          )}
          {!drawerRecord && tracePanelReqId && (
            <div className="h-full w-[380px] shrink-0 overflow-hidden border-l border-[var(--color-border)]">
              <TraceabilityDrawer reqId={tracePanelReqId} onClose={closeTracePanel} />
            </div>
          )}
          <button
            type="button"
            id="toggle-outline"
            title="Toggle outline"
            className="fixed bottom-6 left-4 z-40 rounded-md border border-[var(--color-border)] bg-[var(--color-paper)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)] shadow-sm hover:border-[var(--color-accent)]"
            onClick={() => setOutlineOpen((o) => !o)}
          >
            ☰
          </button>
          <button
            type="button"
            id="open-dashboard"
            className="fixed right-4 top-3 z-40 rounded-md border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-1 text-xs font-medium text-[var(--color-text)] shadow-sm hover:border-[var(--color-accent)]"
            onClick={() => setView("dashboard")}
          >
            Dashboard
          </button>
        </div>

        {view === "dashboard" && (
          <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-page-bg)]">
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
              <span className="text-sm font-semibold text-[var(--color-text)]">Dashboard</span>
              <button
                type="button"
                id="back-to-editor"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-1 text-xs font-medium text-[var(--color-text)] hover:border-[var(--color-accent)]"
                onClick={() => setView("editor")}
              >
                ← Editor
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Dashboard
                onNavigateToEditor={navigateToEditor}
                onLoadReview={() => postSidecarAction("review", "import")}
                onSaveReview={autoSaveToast}
                onSaveReviewAs={() => postSidecarAction("review", "saveAs")}
                onLoadTraceability={() => postSidecarAction("traceability", "import")}
                onSaveTraceability={autoSaveToast}
                onSaveTraceabilityAs={() => postSidecarAction("traceability", "saveAs")}
              />
            </div>
          </div>
        )}
        <Toaster />
      </div>
    </EditorContext.Provider>
  );
}
