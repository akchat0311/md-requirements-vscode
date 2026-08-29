import { useEffect, useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { createEditorExtensions } from "@/editor/extensions";
import { SoftBreak } from "@/editor/extensions/SoftBreak";
import { EditorToolbar } from "@/editor/Toolbar";
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

  if (!editor) return null;

  return (
    <div className="w-full py-8">
      <EditorToolbar editor={editor} />
      <div className="doc-page">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
