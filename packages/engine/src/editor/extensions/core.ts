import StarterKit from "@tiptap/starter-kit";
import CodeBlock from "@tiptap/extension-code-block";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import type { Extensions } from "@tiptap/core";
import { RawHtmlBlock } from "./RawHtmlBlock";
import { SoftBreak } from "./SoftBreak";
import { RawHtmlInline } from "./RawHtmlInline";
import { Callout } from "./Callout";
import { CustomKeymap } from "./CustomKeymap";
import { MathMark } from "./MathMark";
import { Highlight } from "./Highlight";
import { Superscript } from "./Superscript";
import { Subscript } from "./Subscript";
import { TableColumnAlign } from "./TableColumnAlign";
import { LinkDefinition } from "./LinkDefinition";
import {
  SpreadBulletList,
  SpreadOrderedList,
  SpreadListItem,
  SpreadTaskList,
  SpreadTaskItem,
} from "./SpreadLists";

/**
 * Schema-complete extension set with no React, store, or UI-chrome
 * dependencies. Covers every node/mark type the parser can emit, so any
 * document that parses can be loaded and re-serialized losslessly.
 *
 * Used by the VS Code webview (Phase 0/1). Differences from
 * createEditorExtensions():
 * - undoRedo disabled — undo is delegated to the host TextDocument (one
 *   undo stack; see architecture D5)
 * - plain CodeBlock instead of MermaidCodeBlock (same "codeBlock" schema
 *   name; mermaid rendering returns in Phase 1)
 * - plain Image instead of WorkspaceImage (same "image" schema name;
 *   webview-URI resolution lands in Phase 1)
 * - no SlashCommand / Placeholder / badge decorations (UI layers, Phase 1+)
 */
export function createCoreExtensions(): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      undoRedo: false,
      codeBlock: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
    }),
    SpreadBulletList,
    SpreadOrderedList,
    SpreadListItem,
    CodeBlock,
    MathMark,
    Highlight,
    Superscript,
    Subscript,
    TableKit.configure({ table: { resizable: false } }),
    TableColumnAlign,
    SpreadTaskList,
    SpreadTaskItem.configure({ nested: true }),
    Image.configure({ inline: false }),
    RawHtmlBlock,
    RawHtmlInline,
    SoftBreak,
    Callout,
    CustomKeymap,
    LinkDefinition,
  ];
}
