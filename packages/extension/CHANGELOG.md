# Changelog

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
