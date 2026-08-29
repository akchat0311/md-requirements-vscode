/**
 * Pure text-synchronization helpers for the document sync loop
 * (architecture §5). No vscode imports — unit-tested directly.
 */

export interface TextEdit {
  /** Offset in the old text where the replacement starts. */
  start: number;
  /** Offset in the old text where the replacement ends (exclusive). */
  endOld: number;
  /** Text to insert between start and endOld. */
  replacement: string;
}

/** Normalize any EOL mix to LF (the engine's canonical form). */
export function toLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Restore a document's EOL convention on LF-normalized engine output
 * (architecture §5, EOL normalization at the boundary).
 */
export function applyEol(lfText: string, eol: "\n" | "\r\n"): string {
  return eol === "\n" ? lfText : lfText.replace(/\n/g, "\r\n");
}

/**
 * Minimal single-range diff between two texts: longest common prefix and
 * suffix, one replacement in between. Returns null when the texts are equal.
 *
 * Keeps WorkspaceEdits small so the source-view cursor stays put and each
 * typing burst is one undo step (architecture §5, minimal diff edits).
 */
export function minimalDiff(oldText: string, newText: string): TextEdit | null {
  if (oldText === newText) return null;

  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(oldText.length, newText.length) - prefix;
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    start: prefix,
    endOld: oldText.length - suffix,
    replacement: newText.slice(prefix, newText.length - suffix),
  };
}

/** Apply a TextEdit to a string (test helper / invariant check). */
export function applyTextEdit(oldText: string, edit: TextEdit): string {
  return oldText.slice(0, edit.start) + edit.replacement + oldText.slice(edit.endOld);
}
