import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

export const CustomKeymap = Extension.create({
  name: "customKeymap",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList(),

      // Block Enter inside table cells: ProseMirror's default Enter handler
      // (splitBlock) creates a second paragraph inside the cell, which the
      // GFM serializer concatenates without a separator — silent data loss.
      // Shift-Enter (hardBreak) remains the correct path for line breaks in cells.
      //
      // Enter inside a HEADING never splits it: it finishes the heading and
      // opens a paragraph below. Splitting was a trap for requirement
      // headings — the caret sits before the " [Draft]" status after a
      // slash-insert, and Enter dragged the status down into the user's
      // body text (user report, 2026-09-01).
      "Enter": () => {
        if (this.editor.isActive("table")) return true;
        return this.editor.commands.command(({ state, tr, dispatch }) => {
          const { $from, empty } = state.selection;
          if (!empty || $from.parent.type.name !== "heading") return false;
          const paragraph = state.schema.nodes.paragraph.createAndFill();
          if (!paragraph) return false;
          if (dispatch) {
            const after = $from.after();
            tr.insert(after, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
          }
          return true;
        });
      },

      // Mod-Enter inserts a row below while inside a table.
      // Outside tables, Mod-Enter falls through to prosemirror-commands' exitCode
      // which only runs inside code blocks — no conflict.
      "Mod-Enter": () => {
        if (!this.editor.isActive("table")) return false;
        return this.editor.commands.addRowAfter();
      },
    };
  },
});
