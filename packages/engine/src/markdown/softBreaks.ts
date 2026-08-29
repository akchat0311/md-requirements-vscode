import type { PMNode } from "./types";

/**
 * Webview-side transforms between the parser/serializer representation of
 * soft line breaks (raw `\n` inside text nodes — what parseMarkdownToDoc
 * emits and serializeDocToMarkdown expects) and the editor representation
 * (explicit `softBreak` inline nodes — safe in Chromium contentEditable).
 * See SoftBreak.ts for why raw `\n` cannot live in the editable DOM.
 *
 * Both transforms are pure and return new trees; marks carry across so a
 * wrap inside e.g. bold stays inside the bold group when serialized.
 */

export function expandSoftBreaks(node: PMNode): PMNode {
  const out: PMNode = { ...node };
  if (node.content) {
    const children: PMNode[] = [];
    for (const child of node.content) {
      if (child.type === "text" && typeof child.text === "string" && child.text.includes("\n")) {
        const segments = child.text.split("\n");
        segments.forEach((segment, i) => {
          if (segment.length > 0) children.push({ ...child, text: segment });
          if (i < segments.length - 1) {
            children.push({ type: "softBreak", ...(child.marks ? { marks: child.marks } : {}) });
          }
        });
      } else {
        children.push(expandSoftBreaks(child));
      }
    }
    out.content = children;
  }
  return out;
}

export function collapseSoftBreaks(node: PMNode): PMNode {
  const out: PMNode = { ...node };
  if (node.content) {
    out.content = node.content.map((child) =>
      child.type === "softBreak"
        ? ({ type: "text", text: "\n", ...(child.marks ? { marks: child.marks } : {}) } as PMNode)
        : collapseSoftBreaks(child),
    );
  }
  return out;
}
