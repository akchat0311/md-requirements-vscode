import * as vscode from "vscode";
import { PROTOCOL_VERSION, type EditorConfig, type HostMessage } from "./protocol";
import { applyEol, minimalDiff, toLf } from "./textSync";

/**
 * Host side of the document sync loop (architecture §5).
 *
 * Invariants:
 * - `deliveredVersion` is the document version whose content the webview
 *   currently mirrors (set by init, docChanged, and ack). An incoming edit is
 *   accepted only when its baseVersion matches — otherwise a docChanged is
 *   already in flight and the webview will rebase and re-send.
 * - `expectedText` is the exact post-edit document text of our own pending
 *   WorkspaceEdit; a change event matching it is our echo and is swallowed
 *   (answered with an ack instead of a docChanged).
 */
export class DocumentSyncController {
  private expectedText: string | null = null;
  private deliveredVersion = -1;

  constructor(
    private readonly document: vscode.TextDocument,
    private readonly webview: vscode.Webview,
  ) {}

  private get eol(): "\n" | "\r\n" {
    return this.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  }

  private post(message: HostMessage): void {
    void this.webview.postMessage(message);
  }

  sendInit(config: EditorConfig, docName: string, docBaseUri: string): void {
    this.deliveredVersion = this.document.version;
    this.post({
      type: "init",
      protocol: PROTOCOL_VERSION,
      text: toLf(this.document.getText()),
      version: this.document.version,
      config,
      docName,
      docBaseUri,
    });
  }

  private sendDocChanged(): void {
    this.deliveredVersion = this.document.version;
    this.post({
      type: "docChanged",
      text: toLf(this.document.getText()),
      version: this.document.version,
    });
  }

  async onWebviewEdit(markdownLf: string, baseVersion: number): Promise<void> {
    if (baseVersion !== this.deliveredVersion) return; // stale — webview is rebasing
    const newText = applyEol(markdownLf, this.eol);
    const oldText = this.document.getText();
    const diff = minimalDiff(oldText, newText);
    if (diff === null) {
      // Serialization is already identical to the document (e.g. a formatting
      // no-op) — confirm so the webview releases its in-flight slot.
      this.post({ type: "ack", version: this.document.version });
      this.deliveredVersion = this.document.version;
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      this.document.uri,
      new vscode.Range(
        this.document.positionAt(diff.start),
        this.document.positionAt(diff.endOld),
      ),
      diff.replacement,
    );
    this.expectedText = newText;
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      this.expectedText = null;
      this.sendDocChanged(); // resync; the webview drops its divergent state
    }
  }

  onDocumentChanged(): void {
    const text = this.document.getText();
    if (this.expectedText !== null && text === this.expectedText) {
      // Echo of our own WorkspaceEdit: the webview already has this content.
      this.expectedText = null;
      this.deliveredVersion = this.document.version;
      this.post({ type: "ack", version: this.document.version });
      return;
    }
    // External change (source edit, git, undo/redo, find-replace).
    this.expectedText = null;
    this.sendDocChanged();
  }
}
