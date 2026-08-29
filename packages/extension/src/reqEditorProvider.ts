import * as vscode from "vscode";
import { DocumentSyncController } from "./documentSync";
import { SidecarService, readEditorConfig } from "./sidecars";
import { publishDiagnostics, clearDiagnostics } from "./diagnostics";
import { updateStatusBarFor } from "./statusBar";
import type { ExportKind, WebviewMessage } from "./protocol";

/** The most recently focused requirements editor (for palette commands). */
export interface ActiveEditor {
  webview: vscode.Webview;
  document: vscode.TextDocument;
}
let activeEditor: ActiveEditor | null = null;
export function getActiveEditor(): ActiveEditor | null {
  return activeEditor;
}

const EXPORT_SUFFIX: Record<ExportKind, string> = {
  reviewCsv: "-review.csv",
  traceabilityCsv: "-traceability.csv",
};

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
    const docDir = document.uri.with({
      path: document.uri.path.replace(/\/[^/]*$/, ""),
    });
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        docDir,
        ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
      ],
    };
    panel.webview.html = this.buildHtml(panel.webview);

    const sync = new DocumentSyncController(document, panel.webview);
    activeEditor = { webview: panel.webview, document };
    updateStatusBarFor(document);
    const viewStateSub = panel.onDidChangeViewState(() => {
      if (panel.active) {
        activeEditor = { webview: panel.webview, document };
        updateStatusBarFor(document);
      } else if (activeEditor?.webview === panel.webview) {
        updateStatusBarFor(null);
      }
    });
    const sidecars = new SidecarService(document, (m) => void panel.webview.postMessage(m));

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
        sync.onDocumentChanged();
        if (activeEditor?.webview === panel.webview) updateStatusBarFor(document);
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
          sync.sendInit(
            readEditorConfig(),
            document.uri.path.split("/").pop() ?? "document.md",
            panel.webview.asWebviewUri(docDir).toString(),
          );
          void sidecars.sendAll();
          break;
        case "edit":
          void sync.onWebviewEdit(msg.markdown, msg.baseVersion);
          break;
        case "sidecarEdit":
          void sidecars.write(msg.kind, msg.json);
          break;
        case "exportResult": {
          if (msg.empty) {
            void vscode.window.showInformationMessage("Nothing to export yet.");
            break;
          }
          const base = document.uri.path.replace(/\.md$/i, "");
          void vscode.window
            .showSaveDialog({
              defaultUri: document.uri.with({ path: base + EXPORT_SUFFIX[msg.kind] }),
              filters: { CSV: ["csv"] },
            })
            .then(async (uri) => {
              if (!uri) return;
              await vscode.workspace.fs.writeFile(uri, Buffer.from(msg.csv, "utf8"));
              void vscode.window.showInformationMessage(`Exported ${uri.path.split("/").pop()}`);
            });
          break;
        }
        case "diagnostics":
          publishDiagnostics(document, msg.issues);
          break;
        case "forwardKey": {
          const command = FORWARDED_COMMANDS[msg.command];
          if (command) void vscode.commands.executeCommand(command);
          break;
        }
      }
    });

    panel.onDidDispose(() => {
      clearDiagnostics(document);
      if (activeEditor?.webview === panel.webview) {
        activeEditor = null;
        updateStatusBarFor(null);
      }
      viewStateSub.dispose();
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
