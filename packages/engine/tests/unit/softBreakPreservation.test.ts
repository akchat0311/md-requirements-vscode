import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createCoreExtensions } from "@/editor/extensions/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";

/**
 * Soft line breaks (plain \n inside a paragraph — "lazy wrapping") must
 * survive the live-editor pipeline as \n inside text nodes, never as
 * hardBreak nodes (which serialize as trailing backslashes).
 *
 * The schema-level guarantee lives here; the DOM-level guarantee is the
 * mandatory `white-space: pre-wrap` on .ProseMirror in the webview CSS —
 * without it, Chromium's contentEditable converts \n to <br> during editing
 * (found in the first real-world edit test, 2026-08-29).
 */
describe("soft break preservation through the live editor", () => {
  const md = "first line of paragraph\nsecond line wraps softly\nthird line ends here\n";

  it("keeps soft breaks as text newlines in the live PM doc", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createCoreExtensions(),
      content: parseMarkdownToDoc(md),
    });
    const para = editor.getJSON().content?.[0];
    const kinds = (para?.content ?? []).map((n: { type?: string }) => n.type);
    expect(kinds).not.toContain("hardBreak");
    expect(serializeDocToMarkdown(editor.getJSON() as never)).toBe(md);
    editor.destroy();
  });

  it("hard breaks (backslash) still round-trip as hardBreak nodes", () => {
    const hard = "line one\\\nline two\n";
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createCoreExtensions(),
      content: parseMarkdownToDoc(hard),
    });
    const para = editor.getJSON().content?.[0];
    const kinds = (para?.content ?? []).map((n: { type?: string }) => n.type);
    expect(kinds).toContain("hardBreak");
    expect(serializeDocToMarkdown(editor.getJSON() as never)).toBe(hard);
    editor.destroy();
  });
});
