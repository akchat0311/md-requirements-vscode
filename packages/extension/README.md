# Markdown Requirements Editor

A Typora-style **editable preview** for markdown requirements documents.
Edit rendered text directly — headings, tables, diagrams, math — while the
file on disk stays clean, diff-friendly markdown. Review comments, test
traceability, and writing-quality checks ride along in JSON sidecar files
next to your document.

Open any `.md` file with **right-click → Open With… → Requirements Editor**.

## Why this editor

- **Your markdown stays yours.** Saving rewrites only the blocks you
  actually edited. Untouched lines — including non-canonical styles like
  `*` bullets, 3-space nesting, `1)` numbering — stay byte-identical, so
  git diffs show exactly what you changed and nothing else. A save with no
  edits is a no-op.
- **Requirements are first-class.** Headings matching your ID convention
  get status brackets (`[Draft]`, `[Approved]`, …), review-comment badges,
  and test-traceability badges. Every other heading is reviewable as a
  section.
- **Works alongside plain VS Code.** Open the same file side by side in
  the text editor — both stay in sync, with one shared undo history, one
  save, one git state.

## Features

- Live rendering: **mermaid** diagrams, **KaTeX** math, callout blocks
  (`> \[!INFO]` / `WARNING` / `SUCCESS` / `DANGER`), tables, task lists
- `/` slash menu — new requirements are created at your cursor with the
  next free ID; selection bubble toolbar for formatting
- **Review workflow**: comment badges on every heading, add → respond →
  close threads, stored in `<doc>.review.json` (auto-saved, watched for
  external changes)
- **Test traceability**: link test cases to requirements, track coverage,
  stored in `<doc>.test-traceability.json`
- **Dashboard** (top-right button): Overview, Requirements, Reviews,
  Traceability, and Quality tabs with click-to-navigate
- **Quality engine**: 17 requirement-writing rules (duplicate IDs, weak
  modal verbs, missing statuses, …) as native Problems-panel diagnostics
- **Renumbering**: fix duplicate/out-of-order IDs in one click — including
  per-feature groups for conventions like `TRANS_<Feature>_001`
- Import/export: review & traceability JSON and CSV, outline sidebar,
  find & replace (⌘F / Ctrl+F), word count in the status bar

## Requirement ID configuration

| Setting | Purpose |
| - | - |
| `mdreq.requirementPattern` | Example ID (simple mode), e.g. `REQ_001` |
| `mdreq.requirementPatternRegex` | Advanced: regex with the ID in group 1, e.g. `(TRANS_[A-Za-z0-9]+_\d{3})` — takes precedence |
| `mdreq.requirementPatternRegexFlags` | Regex flags, e.g. `i` |

## Sidecar files

Review and traceability data live next to your document, in plain JSON you
can commit, diff, and share:

```
spec.md
spec.review.json               ← review comment threads
spec.test-traceability.json    ← test cases, links, coverage
```

External changes to these files (git pull, a teammate's edit) appear in the
open editor live.

## Feedback

Issues and ideas: <https://github.com/akchat0311/md-requirements-vscode/issues>
