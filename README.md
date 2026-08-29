# Markdown Requirements Editor — VS Code Extension

Typora-style **editable preview** for markdown requirements documents:
edit rendered text directly, while the file on disk stays clean,
diff-friendly markdown. Review comments, test traceability, and quality
checks ride along in sidecar files — the same formats as the original
browser-based MD_Editor, fully interoperable.

## Features

- **Editable WYSIWYG preview** for `.md` files (Open With… → Requirements
  Editor), synced live with VS Code's plain text editor — open both side
  by side, type in either.
- **Fidelity guarantee:** saving rewrites only the blocks you edited.
  Untouched lines — including non-canonical styles like `*` bullets,
  3-space nesting, `1)` numbering, trailing-double-space hard breaks —
  stay byte-identical. A no-edit save is a no-op.
- **Rendering:** mermaid diagrams, KaTeX math, callouts
  (`> \[!INFO]` / `WARNING` / `SUCCESS` / `DANGER`), tables, task lists,
  slash-command menu (`/`), selection bubble toolbar, VS Code theme sync.
- **Requirements:** headings matching your ID convention (simple example
  or regex — see settings) get status brackets, review-comment badges,
  and traceability badges. Every other heading is reviewable as a section.
- **Review comments:** `<doc>.review.json` auto-loads, auto-saves, and is
  watched for external changes. Full add → respond → close workflow.
- **Test traceability:** `<doc>.test-traceability.json` — test cases,
  links, coverage status, broken-link preservation.
- **Dashboard** (button top-right, or command *Requirements: Open
  Dashboard*): Overview, Requirements, Reviews, Traceability, Quality.
- **Quality engine:** 17 requirement-writing rules published as native
  diagnostics in the Problems panel.
- **CSV exports:** *Requirements: Export Review Comments / Traceability
  as CSV* commands.
- Find & replace inside the preview (⌘F / Ctrl+F), word count in the
  status bar, workspace-relative images.

## Settings

| Setting | Purpose |
| - | - |
| `mdreq.requirementPattern` | Example requirement ID (simple mode), e.g. `REQ_001` |
| `mdreq.requirementPatternRegex` | Advanced: regex with the ID in group 1, e.g. `(TRANS_[A-Za-z0-9]+_\d{3})`; takes precedence |
| `mdreq.requirementPatternRegexFlags` | Regex flags, e.g. `i` |

## Develop

```bash
npm install
npm run build        # webview bundle + extension compile
npm test             # engine suite + sync-controller unit tests
npm run e2e          # real-Chromium end-to-end suite (npx playwright install chromium)
```

Open this folder in VS Code and press F5 ("Run Extension"), or package with
`npx @vscode/vsce package --no-dependencies` in `packages/extension/`.

## Layout

```
packages/
├── engine/      # markdown round-trip pipeline, TipTap extensions,
│                # validation rules, services, types — plus the full test
│                # suite (copied from MD_Editor; chassis modules pruned
│                # as later phases land).
├── webview/     # webview app: React + TipTap + engine + postMessage
│                # bridge. Builds ESM bundles into packages/extension/media/.
└── extension/   # extension host: provider, DocumentSyncController,
                 # SidecarService, diagnostics, protocol.
```

## Sync-loop rules (architecture §5)

- Webview edits: debounce 250 ms → serialize (with per-block source
  preservation — D9) → host applies a minimal single-range `WorkspaceEdit`;
  the echoed change event is swallowed and acknowledged.
- External edits (source view, git, undo): forwarded to the webview as full
  LF-normalized text; the webview re-parses with a loop guard.
- One edit in flight at a time, version-stamped; stale edits are dropped and
  rebased.
- EOL: LF inside the engine, the document's own EOL on disk.
- Undo/redo/save are forwarded to the host — the TextDocument owns the only
  undo stack (TipTap history is disabled).
- Soft line-wraps are explicit `softBreak` nodes (raw `\n` in contentEditable
  gets mangled by Chromium); empty top-level paragraphs never serialize.

## Publishing

See [PUBLISHING.md](PUBLISHING.md).
