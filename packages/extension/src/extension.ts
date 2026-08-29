import * as vscode from "vscode";
import { ReqEditorProvider, getActiveEditor } from "./reqEditorProvider";
import type { ExportKind } from "./protocol";

function registerExportCommand(command: string, kind: ExportKind): vscode.Disposable {
  return vscode.commands.registerCommand(command, () => {
    const active = getActiveEditor();
    if (!active) {
      void vscode.window.showInformationMessage(
        "Open a document with the Requirements Editor first (right-click a .md file → Open With…).",
      );
      return;
    }
    void active.webview.postMessage({ type: "requestExport", kind });
  });
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    ReqEditorProvider.register(context),
    registerExportCommand("mdreq.exportReviewCsv", "reviewCsv"),
    registerExportCommand("mdreq.exportTraceabilityCsv", "traceabilityCsv"),
  );
}

export function deactivate(): void {}
