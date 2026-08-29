# Markdown Requirements Editor — VS Code Extension

Typora-style editable preview for markdown requirements documents, migrated
from the browser-based MD_Editor per the Engine & Chassis architecture.
The markdown `TextDocument` is the single source of truth; the proven
round-trip engine runs in a webview; a thin extension-host layer owns all
platform integration.

## Status: Phase 0 — sync spike

| Piece | State |
| - | - |
| Engine copied with full test suite (1710+ tests) | ✅ |
| Schema-complete core extension set (`createCoreExtensions`) | ✅ corpus round-trips byte-exact through a live editor |
| `CustomTextEditorProvider` + webview bundle | ✅ |
| Document sync loop (minimal diff, echo guard, EOL normalization, version stamping) | ✅ unit-tested; e2e validation in progress |
| Undo delegation (single TextDocument undo stack) | ✅ via key forwarding |
| CI (macOS / Windows / Linux) | ✅ |

## Layout

```
packages/
├── engine/      # copied from MD_Editor: markdown pipeline, TipTap extensions,
│                # validation rules, services, types — plus the full test suite.
│                # Chassis modules still inside are pruned as later phases land.
├── webview/     # webview app: TipTap + engine + postMessage bridge.
│                # Builds a single IIFE bundle into packages/extension/media/.
└── extension/   # extension host: provider, DocumentSyncController, protocol.
```

## Develop

```bash
npm install
npm run build        # webview bundle + extension compile
npm test             # engine suite + sync-controller unit tests
```

Then open this folder in VS Code and press F5 (“Run Extension”). In the
Extension Development Host, right-click a `.md` file → **Open With… →
Requirements Editor**. Open the same file normally in a split for the live
source view.

## Sync-loop rules (architecture §5)

- Webview edits: debounce 250 ms → serialize → host applies a minimal
  single-range `WorkspaceEdit`; the echoed change event is swallowed and
  acknowledged.
- External edits (source view, git, undo): forwarded to the webview as full
  LF-normalized text; the webview re-parses with a loop guard.
- One edit in flight at a time, version-stamped; stale edits are dropped and
  rebased.
- EOL: LF inside the engine, the document's own EOL on disk.
- Undo/redo/save are forwarded to the host — the TextDocument owns the only
  undo stack (TipTap history is disabled).
