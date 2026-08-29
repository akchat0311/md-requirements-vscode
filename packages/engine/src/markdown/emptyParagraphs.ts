import type { PMNode } from "./types";

/**
 * Drop empty top-level paragraphs before serialization.
 *
 * An empty paragraph is real to ProseMirror (pressing Enter creates one) but
 * has no markdown representation: serializing it produces stray blank lines
 * that disappear again on re-parse. Letting them through desynchronizes the
 * editor from the file (invisible-in-editor blank lines on disk) and breaks
 * the D9 merge's fixed-point assumption. Treat them as ephemeral UI state:
 * the editor keeps the node (the caret needs somewhere to sit), the file
 * never sees it; the paragraph starts serializing the moment it gets text.
 *
 * Top-level only, and never the last remaining block: nested empties (inside
 * list items, callouts, table cells) participate in their parents' own
 * serialization rules and are left untouched.
 */
export function stripEmptyTopLevelParagraphs(doc: PMNode): PMNode {
  if (!doc.content) return doc;
  const kept = doc.content.filter(
    (child) =>
      !(
        child.type === "paragraph" &&
        (child.content === undefined || child.content.length === 0)
      ),
  );
  if (kept.length === doc.content.length) return doc;
  return {
    ...doc,
    content: kept.length > 0 ? kept : [{ type: "paragraph" }],
  };
}
