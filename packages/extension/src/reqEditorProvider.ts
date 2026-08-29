import * as vscode from "vscode";
import { DocumentSyncController } from "./documentSync";
import { SidecarService, readEditorConfig } from "./sidecars";
import type { WebviewMessage } from "./protocol";

const FORWARDED_COMMANDS: Record<string, string> = {
  undo: "undo",
  redo: "redo",
  save: "workbench.action.files.save",
};

export class ReqEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = "mdreq.editor";

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      ReqEditorProvider.viewType,
      new ReqEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    panel.webview.html = this.buildHtml(panel.webview);

    const sync = new DocumentSyncController(document, panel.webview);
    const sidecars = new SidecarService(document, (m) => void panel.webview.postMessage(m));

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
        sync.onDocumentChanged();
      }
    });

    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("mdreq")) {
        void panel.webview.postMessage({ type: "configChanged", config: readEditorConfig() });
      }
    });

    const messageSub = panel.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      switch (msg.type) {
        case "ready":
          sync.sendInit(readEditorConfig());
          void sidecars.sendAll();
          break;
        case "edit":
          void sync.onWebviewEdit(msg.markdown, msg.baseVersion);
          break;
        case "sidecarEdit":
          void sidecars.write(msg.kind, msg.json);
          break;
        case "forwardKey": {
          const command = FORWARDED_COMMANDS[msg.command];
          if (command) void vscode.commands.executeCommand(command);
          break;
        }
      }
    });

    panel.onDidDispose(() => {
      changeSub.dispose();
      configSub.dispose();
      messageSub.dispose();
      sidecars.dispose();
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    const version: string =
      (this.context.extension.packageJSON as { version?: string }).version ?? "dev";
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "editor.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "editor.css"),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Requirements Editor</title>
  <meta name="mdreq-version" content="${version}">
</head>
<body>
  <div id="editor"></div>
  <div id="build-stamp">v${version}</div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
