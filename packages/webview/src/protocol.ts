/**
 * Host ↔ webview message protocol (architecture §6).
 *
 * NOTE: packages/extension/src/protocol.ts is a mirror of this file (the
 * extension compiles as CommonJS and cannot import across package roots).
 * Any change here must be applied there too — both carry PROTOCOL_VERSION,
 * and the webview refuses to run against a mismatched host.
 */

export const PROTOCOL_VERSION = 2;

export type SidecarKind = "review" | "traceability";

export interface EditorConfig {
  /**
   * Requirement ID pattern. Simple mode derives prefix + digit width from one
   * example ("REQ_001"); regex mode uses a user regex that must match at the
   * start of the heading text and capture the ID (named group `id` or group 1),
   * e.g. "(TRANS_[A-Za-z0-9]+_\\d{3})". Null disables requirement detection.
   */
  requirementPattern:
    | { mode: "simple"; example: string }
    | { mode: "regex"; source: string; flags: string }
    | null;
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
