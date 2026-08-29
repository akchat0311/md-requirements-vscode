/**
 * Host ↔ webview message protocol (architecture §6).
 *
 * NOTE: mirror of packages/webview/src/protocol.ts — keep both in sync — both carry PROTOCOL_VERSION,
 * and the webview refuses to run against a mismatched host.
 */

export const PROTOCOL_VERSION = 2;

export type SidecarKind = "review" | "traceability";

export interface EditorConfig {
  /** Simple-mode requirement ID example (e.g. "REQ_001"), or null for none. */
  requirementPatternExample: string | null;
}

/** Host → webview. All text payloads are LF-normalized. */
export type HostMessage =
  | {
      type: "init";
      protocol: number;
      text: string;
      version: number;
      config: EditorConfig;
    }
  | { type: "docChanged"; text: string; version: number }
  | { type: "ack"; version: number }
  | { type: "configChanged"; config: EditorConfig }
  /** Sidecar file content (parsed JSON), or null when the file is absent. */
  | { type: "sidecarChanged"; kind: SidecarKind; data: unknown };

/** Webview → host. `markdown` is LF-normalized (host restores document EOL). */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "edit"; markdown: string; baseVersion: number }
  | { type: "forwardKey"; command: "undo" | "redo" | "save" }
  /** Serialized sidecar file body to persist verbatim (webview owns format). */
  | { type: "sidecarEdit"; kind: SidecarKind; json: string };
