import type { Editor, Range } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { useConfigStore } from "@/stores/configStore";
import { deriveOutline, flattenOutline } from "@/editor/utils/deriveOutline";
import { compileRequirementPattern, analyzeRequirements, nextAvailableId, nextAvailableIdForStem, insertRequirementAfter } from "@/editor/utils/requirementOps";
import { getSectionRange } from "@/editor/utils/outlineOps";

export interface SlashCommandItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  keywords: string[];
  command: (editor: Editor, range: Range) => void;
}

function makeRequirementSlashItem(): SlashCommandItem | null {
  const { requirementPattern } = useConfigStore.getState();
  // Regex-mode patterns can match IDs but can't *generate* a new one (a
  // regex describes matching, not construction), so this command — which
  // needs to synthesize the next ID — is only offered in simple mode.
  // Simple mode can always generate the next ID; regex mode can generate
  // within an existing ID's stem group (per-feature numbering), so the item
  // shows whenever a pattern is configured — the command itself bails when
  // no stem is derivable (e.g. an empty document in regex mode).
  if (!compileRequirementPattern(requirementPattern)) return null;

  return {
    id: "requirement",
    label: "New Requirement",
    description: "Insert requirement after current position",
    icon: ">H#",
    keywords: ["req", "requirement", "new req", "insert req"],
    command: (editor: Editor, range: Range) => {
      const { requirementPattern: pattern } = useConfigStore.getState();
      const compiled = compileRequirementPattern(pattern);
      if (!compiled) return;

      // Capture cursor position before deleting the slash text
      const cursorPos = range.from;

      // Regex mode pre-check on the CURRENT doc (headings are unaffected by
      // the slash text): a new ID needs a stem to extend — the nearest
      // requirement before the cursor. Bail before deleting the "/" so a
      // no-op leaves the user's typing intact.
      if (!compiled.supportsNumbering) {
        const flat0 = flattenOutline(deriveOutline(editor));
        const analysis0 = analyzeRequirements(
          flat0,
          editor.state.doc.content.toJSON() as JSONContent[],
          pattern,
        );
        const reqs0 = analysis0?.requirements ?? [];
        const before0 = reqs0.filter((r) => r.node.pmPos <= cursorPos);
        const anchor0 = before0.length > 0 ? before0[before0.length - 1] : reqs0[0];
        if (!anchor0 || nextAvailableIdForStem(reqs0, anchor0.id) === null) return;
      }

      // Remove the "/" and any filter text the user typed
      editor.chain().deleteRange(range).run();

      // Re-read doc state after deletion
      const docContent = editor.state.doc.content.toJSON() as JSONContent[];
      const flat = flattenOutline(deriveOutline(editor));
      const analysis = analyzeRequirements(flat, docContent, pattern);
      const existingReqs = analysis?.requirements ?? [];

      // ID context: the nearest requirement before the cursor (any section)
      // supplies the stem in regex mode and the heading level to mirror.
      const reqsBefore = existingReqs.filter((r) => r.node.pmPos <= cursorPos);
      const idAnchor =
        reqsBefore.length > 0 ? reqsBefore[reqsBefore.length - 1] : existingReqs[0];

      // Simple mode: next number document-wide. Regex mode: next number
      // within the anchor's stem group (per-feature numbering).
      const newId = compiled.supportsNumbering
        ? nextAvailableId(existingReqs, compiled.prefix ?? "", compiled.digits ?? 3)
        : idAnchor
          ? nextAvailableIdForStem(existingReqs, idAnchor.id)
          : null;
      if (!newId) return;

      // POSITION: only anchor to the preceding requirement when the cursor is
      // still inside that requirement's own section — a heading of the same
      // or shallower level between them means the cursor has moved on (e.g.
      // into a later section with no requirements yet), and the insert must
      // follow the CURSOR, not jump back to an earlier section.
      const posCandidate = reqsBefore.length > 0 ? reqsBefore[reqsBefore.length - 1] : null;
      const cursorInsideAnchorSection =
        posCandidate !== null &&
        !flat.some(
          (n) =>
            n.pmPos > posCandidate.node.pmPos &&
            n.pmPos <= cursorPos &&
            (n.level ?? 1) <= (posCandidate.node.level ?? 3),
        );

      let nodeIndex: number;
      let nodeLevel: number;

      if (posCandidate && cursorInsideAnchorSection) {
        nodeIndex = posCandidate.node.index;
        nodeLevel = posCandidate.node.level ?? 3;
      } else {
        // Insert after whichever top-level node holds the cursor, at the
        // document's requirement heading level (mirroring the nearest one).
        let fallback = 0;
        editor.state.doc.forEach((_n, offset, idx) => {
          if (offset <= cursorPos) fallback = idx;
        });
        nodeIndex = fallback;
        nodeLevel = idAnchor?.node.level ?? 3;
      }

      const [, insertedAtIndex] = getSectionRange(docContent, nodeIndex, nodeLevel);
      const newContent = insertRequirementAfter(docContent, nodeIndex, nodeLevel, newId);

      // Use setTimeout to avoid React's flushSync conflict (same pattern as OutlinePanel)
      setTimeout(() => {
        editor.commands.setContent({ type: "doc", content: newContent });

        let targetPmPos = -1;
        editor.state.doc.forEach((_n, offset, idx) => {
          if (idx === insertedAtIndex) targetPmPos = offset;
        });

        if (targetPmPos >= 0) {
          const insertedNode = editor.state.doc.nodeAt(targetPmPos);
          const isContainer =
            insertedNode?.type.name === "blockquote" ||
            insertedNode?.type.name === "callout";
          const innerOffset = isContainer ? 2 : 1;
          editor
            .chain()
            .focus()
            .setTextSelection(targetPmPos + innerOffset + newId.length)
            .scrollIntoView()
            .run();
        }
      }, 0);
    },
  };
}

export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    id: "heading1",
    label: "Heading 1",
    description: "Big section heading",
    icon: "H1",
    keywords: ["h1", "heading", "title"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium section heading",
    icon: "H2",
    keywords: ["h2", "heading", "subtitle"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small section heading",
    icon: "H3",
    keywords: ["h3", "heading"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    id: "heading4",
    label: "Heading 4",
    description: "Sub-section heading",
    icon: "H4",
    keywords: ["h4", "heading"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 4 }).run(),
  },
  {
    id: "heading5",
    label: "Heading 5",
    description: "Minor heading",
    icon: "H5",
    keywords: ["h5", "heading"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 5 }).run(),
  },
  {
    id: "heading6",
    label: "Heading 6",
    description: "Smallest heading",
    icon: "H6",
    keywords: ["h6", "heading"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 6 }).run(),
  },
  {
    id: "bulletList",
    label: "Bullet list",
    description: "Unordered list",
    icon: "•",
    keywords: ["bullet", "list", "ul"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "orderedList",
    label: "Numbered list",
    description: "Ordered list",
    icon: "1.",
    keywords: ["ordered", "number", "list", "ol"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "checklist",
    label: "Checklist",
    description: "Task list with checkboxes",
    icon: "☑",
    keywords: ["task", "todo", "checklist", "checkbox"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "table",
    label: "Table",
    description: "Insert a 3x3 table",
    icon: "▦",
    keywords: ["table", "grid"],
    command: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 4, withHeaderRow: true })
        .run(),
  },
  {
    id: "image",
    label: "Image",
    description: "Insert an image from a URL",
    icon: "🖼",
    keywords: ["image", "picture", "img"],
    command: (editor, range) => {
      const src = window.prompt("Image URL");
      const chain = editor.chain().focus().deleteRange(range);
      if (src) chain.setImage({ src }).run();
      else chain.run();
    },
  },
  {
    id: "code",
    label: "Code block",
    description: "Fenced code block",
    icon: "</>",
    keywords: ["code", "snippet", "fence"],
    command: (editor, range) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    id: "mermaid",
    label: "Mermaid diagram",
    description: "Flowchart, sequence, Gantt, and more",
    icon: "⬡",
    keywords: ["mermaid", "diagram", "flowchart", "chart", "graph", "sequence", "gantt"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCodeBlock({ language: "mermaid" }).run(),
  },
  {
    id: "math",
    label: "Math block",
    description: "LaTeX display equation (KaTeX)",
    icon: "∑",
    keywords: ["math", "latex", "equation", "katex", "formula"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCodeBlock({ language: "$$" }).run(),
  },
  {
    id: "blockquote",
    label: "Quote",
    description: "Blockquote",
    icon: "❝",
    keywords: ["quote", "blockquote"],
    command: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "callout",
    label: "Callout",
    description: "Info / warning / success / danger box",
    icon: "▣",
    keywords: ["callout", "info", "warning", "note", "alert"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCallout({ type: "info" }).run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Horizontal rule",
    icon: "—",
    keywords: ["divider", "hr", "rule", "separator"],
    command: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

export function filterSlashCommandItems(query: string): SlashCommandItem[] {
  const reqItem = makeRequirementSlashItem();
  const allItems = reqItem ? [reqItem, ...SLASH_COMMAND_ITEMS] : SLASH_COMMAND_ITEMS;

  const q = query.trim().toLowerCase();
  if (!q) return allItems;
  return allItems.filter(
    (item) =>
      item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)),
  );
}
