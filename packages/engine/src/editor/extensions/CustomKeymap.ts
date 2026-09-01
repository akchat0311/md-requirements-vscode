import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useEditorBehaviorStore } from "@/stores/editorBehaviorStore";
import { SuggestionPluginKey } from "@tiptap/suggestion";

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

        // The slash-command menu is open: Enter selects the highlighted item.
        if (SuggestionPluginKey.getState(this.editor.state)?.active) return false;

        // Headings never split (any mode): Enter finishes the heading and
        // opens a paragraph below (see 2026-09-01 report — splitting dragged
        // the " [Draft]" status into the body text).
        const headingHandled = this.editor.commands.command(({ state, tr, dispatch }) => {
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
        if (headingHandled) return true;

        // "line" mode (default): in a TOP-LEVEL paragraph, Enter inserts a
        // soft line break — a single \n in the file, no blank line. Enter on
        // the resulting empty line upgrades it to a real paragraph break.
        // Lists, blockquotes, callouts, code keep their native Enter.
        if (useEditorBehaviorStore.getState().enterMode !== "line") return false;
        return this.editor.commands.command(({ state, tr, dispatch }) => {
          const { $from, empty } = state.selection;
          if (!empty || $from.parent.type.name !== "paragraph") return false;
          if ($from.depth !== 1) return false; // only top-level paragraphs
          const parent = $from.parent;
          if (parent.content.size === 0) return false; // empty para → default

          const before = $from.nodeBefore;
          const atLineStartAfterBreak = before?.type.name === "softBreak";
          const atParentEnd = $from.parentOffset === parent.content.size;
          if (atLineStartAfterBreak && atParentEnd) {
            // Second Enter on the empty line: replace the trailing soft
            // break with a real paragraph split.
            if (dispatch) {
              tr.delete($from.pos - 1, $from.pos);
              tr.split(tr.mapping.map($from.pos));
              tr.scrollIntoView();
            }
            return true;
          }
          const softBreak = state.schema.nodes.softBreak;
          if (!softBreak) return false;
          if (dispatch) {
            // Enter at the START of a line means "push this line down" — the
            // caret stays on the new empty line ABOVE (before the inserted
            // break), matching what the user sees and intends.
            const atLineStart =
              $from.parentOffset === 0 || $from.nodeBefore?.type.name === "softBreak";
            const pos = $from.pos;
            tr.replaceSelectionWith(softBreak.create());
            if (atLineStart) {
              tr.setSelection(TextSelection.create(tr.doc, pos));
            }
            tr.scrollIntoView();
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
