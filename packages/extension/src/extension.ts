import * as vscode from "vscode";
import { ReqEditorProvider, getActiveEditor } from "./reqEditorProvider";
import type { ExportKind, SidecarKind } from "./protocol";
import { importSidecar, saveSidecarAs } from "./sidecars";
import { disposeStatusBar } from "./statusBar";

function requireActive(): ReturnType<typeof getActiveEditor> {
  const active = getActiveEditor();
  if (!active) {
    void vscode.window.showInformationMessage(
      "Open a document with the Requirements Editor first (right-click a .md file → Open With…).",
    );
  }
  return active;
}

function registerImportCommand(command: string, kind: SidecarKind): vscode.Disposable {
  return vscode.commands.registerCommand(command, async () => {
    const active = requireActive();
    if (active) await importSidecar(active.document, kind);
  });
}

function registerSaveAsCommand(command: string, kind: SidecarKind): vscode.Disposable {
  return vscode.commands.registerCommand(command, async () => {
    const active = requireActive();
    if (active) await saveSidecarAs(active.document, kind);
  });
}

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
    registerImportCommand("mdreq.importReview", "review"),
    registerImportCommand("mdreq.importTraceability", "traceability"),
    registerSaveAsCommand("mdreq.saveReviewJsonAs", "review"),
    registerSaveAsCommand("mdreq.saveTraceabilityJsonAs", "traceability"),
    vscode.commands.registerCommand("mdreq.openDashboard", () => {
      const active = getActiveEditor();
      if (!active) {
        void vscode.window.showInformationMessage(
          "Open a document with the Requirements Editor first (right-click a .md file → Open With…).",
        );
        return;
      }
      void active.webview.postMessage({ type: "showDashboard" });
    }),
  );
}

export function deactivate(): void {
  disposeStatusBar();
}
