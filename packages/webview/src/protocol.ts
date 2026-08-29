/**
 * Host ↔ webview message protocol (architecture §6, Phase 0 subset).
 *
 * NOTE: packages/extension/src/protocol.ts is a mirror of this file (the
 * extension compiles as CommonJS and cannot import across package roots).
 * Any change here must be applied there too — both carry PROTOCOL_VERSION,
 * and the webview refuses to run against a mismatched host.
 */

export const PROTOCOL_VERSION = 1;

/** Host → webview. All text payloads are LF-normalized. */
export type HostMessage =
  | { type: "init"; protocol: number; text: string; version: number }
  | { type: "docChanged"; text: string; version: number }
  | { type: "ack"; version: number };

/** Webview → host. `markdown` is LF-normalized (host restores document EOL). */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "edit"; markdown: string; baseVersion: number }
  | { type: "forwardKey"; command: "undo" | "redo" | "save" };
