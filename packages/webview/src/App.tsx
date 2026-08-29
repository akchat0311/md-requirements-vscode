import { useEffect, useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { createEditorExtensions } from "@/editor/extensions";
import { SoftBreak } from "@/editor/extensions/SoftBreak";
import { EditorToolbar } from "@/editor/Toolbar";
import { CommentDrawer } from "@/layout/CommentDrawer";
import { TraceabilityDrawer } from "@/layout/TraceabilityDrawer";
import { useCommentDrawerStore } from "@/stores/commentDrawerStore";
import { useTraceabilityPanelStore } from "@/stores/traceabilityPanelStore";
import type { RequirementRecord } from "@/editor/utils/requirementOps";
import { bridgeHandleUpdate, initBridge } from "./bridge";

export function App() {
  // Full product extension set. undoRedo off: the TextDocument owns the
  // single undo stack (D5). SoftBreak keeps raw \n out of the editable DOM.
  const extensions = useMemo(
    () => [...createEditorExtensions({ undoRedo: false }), SoftBreak],
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
    <div className="flex h-screen w-full overflow-hidden">
      <div className="min-w-0 flex-1 overflow-y-auto">
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
    </div>
  );
}
