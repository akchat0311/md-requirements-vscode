# Changelog

## 0.4.3

- Lists: Backspace at the start of a list item that is not the first one now
  joins it into the previous item instead of lifting it out of the list.
  Clearing items from the middle of a numbered list no longer splits it into
  two lists; the remaining items renumber 1..n. Applies to bullet and task
  lists too. Shift+Tab still lifts an item deliberately.
- Requirement statuses are italic (`[*Draft*]`) on every code path: inserting
  a requirement from the outline menu, duplicating a section (status reset to
  Draft, variant kept), and the " Copy" suffix on duplicated sections, which
  previously landed after an italic status bracket and broke detection.

## 0.4.2

- Neutral example IDs in published content.

## 0.4.1

- Variant bracket on requirement headings (`[Status] [Variant]`), variant
  inheritance for new requirements, ordered-list renumbering fixes.

## 0.3.0 — first public release

- Typora-style editable preview for markdown (`Open With… → Requirements
  Editor`), synced live with VS Code's text editor; single shared undo stack
- Fidelity guarantee: only edited blocks are rewritten on save; untouched
  lines stay byte-identical
- Mermaid, KaTeX, callouts, tables, task lists, slash menu, bubble toolbar,
  outline sidebar, find & replace, VS Code theme sync
- Requirement IDs via simple example or regex patterns; status brackets,
  review-comment badges, traceability badges on requirement headings;
  every heading reviewable as a section
- Review comments and test traceability in auto-saved, file-watched JSON
  sidecars (compatible with the original browser-based MD_Editor)
- Dashboard with Overview / Requirements / Reviews / Traceability / Quality
  tabs; quality engine published to the Problems panel
- Renumbering and reassign-duplicate, including per-feature stem groups for
  regex conventions; new requirements created at the cursor
- CSV + JSON import/export commands; word count in the status bar
