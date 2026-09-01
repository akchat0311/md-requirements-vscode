import { create } from "zustand";

/**
 * Editing-behavior switches, settable at runtime (VS Code settings).
 *
 * enterMode:
 * - "line" — Enter inserts a single soft line break (one `\n` in the file);
 *   pressing Enter again on the now-empty line converts it to a paragraph
 *   break (blank line). Matches the mental model "Enter = new line".
 * - "paragraph" — classic markdown/Typora behavior: Enter always starts a
 *   new paragraph (blank line in the file); Shift+Enter for a line break.
 */
export type EnterMode = "line" | "paragraph";

interface EditorBehaviorState {
  enterMode: EnterMode;
  setEnterMode(mode: EnterMode): void;
}

export const useEditorBehaviorStore = create<EditorBehaviorState>((set) => ({
  enterMode: "line",
  setEnterMode: (enterMode) => set({ enterMode }),
}));
