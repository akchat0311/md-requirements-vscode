import * as vscode from "vscode";
import type { HostMessage, SidecarKind } from "./protocol";

/**
 * Sidecar file service (architecture §7.1).
 *
 * Owns all I/O for a document's companion files:
 *   <doc>.review.json              — review comments
 *   <doc>.test-traceability.json   — test cases, links, coverage
 *
 * The on-disk formats are frozen at the browser app's schema (D7); the
 * webview owns serialization (it sends the exact file body), the host owns
 * reading, writing, and watching. External edits to a sidecar (git, another
 * tool) flow into the webview live via a FileSystemWatcher; our own writes
 * are swallowed by comparing against the last written body.
 */
export class SidecarService {
  private readonly uris: Record<SidecarKind, vscode.Uri>;
  private readonly lastWritten: Partial<Record<SidecarKind, string>> = {};
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    document: vscode.TextDocument,
    private readonly post: (msg: HostMessage) => void,
  ) {
    const base = document.uri.path.replace(/\.md$/i, "");
    this.uris = {
      review: document.uri.with({ path: `${base}.review.json` }),
      traceability: document.uri.with({ path: `${base}.test-traceability.json` }),
    };

    for (const kind of ["review", "traceability"] as const) {
      const uri = this.uris[kind];
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          uri.with({ path: uri.path.replace(/\/[^/]*$/, "") }),
          uri.path.split("/").pop()!,
        ),
      );
      const onDiskChange = () => void this.loadAndSend(kind, { skipSelfEcho: true });
      watcher.onDidChange(onDiskChange, null, this.disposables);
      watcher.onDidCreate(onDiskChange, null, this.disposables);
      watcher.onDidDelete(
        () => this.post({ type: "sidecarChanged", kind, data: null }),
        null,
        this.disposables,
      );
      this.disposables.push(watcher);
    }
  }

  /** Read both sidecars and push their current content to the webview. */
  async sendAll(): Promise<void> {
    await this.loadAndSend("review");
    await this.loadAndSend("traceability");
  }

  private async loadAndSend(
    kind: SidecarKind,
    opts?: { skipSelfEcho?: boolean },
  ): Promise<void> {
    let text: string | null = null;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(this.uris[kind])).toString("utf8");
    } catch {
      text = null; // absent file — send null so the webview resets the store
    }
    if (opts?.skipSelfEcho && text !== null && text === this.lastWritten[kind]) return;
    let data: unknown = null;
    if (text !== null) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error(`[mdreq] ${kind} sidecar is not valid JSON:`, e);
        return; // never push a broken payload over good in-memory state
      }
    }
    this.post({ type: "sidecarChanged", kind, data });
  }

  /** Persist a serialized sidecar body sent by the webview. */
  async write(kind: SidecarKind, json: string): Promise<void> {
    this.lastWritten[kind] = json;
    try {
      await vscode.workspace.fs.writeFile(this.uris[kind], Buffer.from(json, "utf8"));
    } catch (e) {
      console.error(`[mdreq] failed to write ${kind} sidecar:`, e);
      void vscode.window.showErrorMessage(
        `Requirements Editor: could not save the ${kind} file (${this.uris[kind].path}).`,
      );
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** Read the extension's editor-facing configuration. */
export function readEditorConfig(): { requirementPatternExample: string | null } {
  const raw = vscode.workspace
    .getConfiguration("mdreq")
    .get<string>("requirementPattern", "");
  const trimmed = raw.trim();
  return { requirementPatternExample: trimmed.length > 0 ? trimmed : null };
}
