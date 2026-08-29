import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createCoreExtensions } from "@/editor/extensions/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { expandSoftBreaks, collapseSoftBreaks } from "@/markdown/softBreaks";
import corpus from "../fixtures/corpus.md?raw";
import type { PMNode } from "@/markdown/types";

/**
 * Soft line breaks (plain \n inside a paragraph — "lazy wrapping").
 *
 * In the editor they must exist as explicit softBreak nodes, NEVER as raw
 * \n inside text nodes: Chromium's contentEditable rewrites raw newlines
 * into <br> during ordinary edits elsewhere in the paragraph, and the DOM
 * re-read maps those to hardBreak (serialized as trailing backslashes).
 * Confirmed in a real-Chromium Playwright repro, 2026-08-30. The webview
 * therefore expands \n → softBreak after parsing and collapses back before
 * serializing; these tests pin that round trip.
 */
describe("soft break handling through the live editor", () => {
  const md =
    "Wrapped paragraph with `code` inline; the proven\nround-trip engine runs here; a layer owns all\nplatform integration.\n";

  function liveRoundTrip(markdown: string): { serialized: string; kinds: string[] } {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createCoreExtensions(),
      content: expandSoftBreaks(parseMarkdownToDoc(markdown)),
    });
    const json = editor.getJSON() as PMNode;
    const kinds: string[] = [];
    const walk = (n: PMNode): void => {
      kinds.push(n.type ?? "");
      for (const c of n.content ?? []) walk(c);
    };
    walk(json);
    const serialized = serializeDocToMarkdown(collapseSoftBreaks(json));
    editor.destroy();
    return { serialized, kinds };
  }

  it("represents soft breaks as softBreak nodes, no raw \\n in text", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createCoreExtensions(),
      content: expandSoftBreaks(parseMarkdownToDoc(md)),
    });
    const para = editor.getJSON().content?.[0];
    const types = (para?.content ?? []).map((n: { type?: string }) => n.type);
    expect(types).toContain("softBreak");
    expect(types).not.toContain("hardBreak");
    for (const n of (para?.content ?? []) as PMNode[]) {
      if (n.type === "text") expect(n.text).not.toContain("\n");
    }
    editor.destroy();
  });

  it("round-trips soft-wrapped paragraphs byte-exact through the live editor", () => {
    expect(liveRoundTrip(md).serialized).toBe(md);
  });

  it("keeps hard breaks (backslash) as hardBreak nodes", () => {
    const hard = "line one\\\nline two\n";
    const { serialized, kinds } = liveRoundTrip(hard);
    expect(kinds).toContain("hardBreak");
    expect(kinds).not.toContain("softBreak");
    expect(serialized).toBe(hard);
  });

  it("round-trips the corpus byte-exact with soft-break expansion active", () => {
    expect(liveRoundTrip(corpus).serialized).toBe(corpus);
  });

  it("expand/collapse preserves marks across a wrap inside bold", () => {
    const bold = "before **bold start\nbold end** after\n";
    expect(liveRoundTrip(bold).serialized).toBe(bold);
  });

  it("never touches code blocks — their newlines are literal content", () => {
    // Regression: expansion used to descend into code fences, where the
    // schema drops softBreak nodes — mermaid/code sources lost all newlines.
    const code = "```mermaid\ngraph TD\n  A --> B\n```\n\npara after\n";
    const { serialized, kinds } = liveRoundTrip(code);
    expect(serialized).toBe(code);
    expect(kinds.filter((k) => k === "softBreak")).toHaveLength(0);
  });
});
