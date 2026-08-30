import * as vscode from "vscode";
import { ReqEditorProvider, getActiveEditor } from "./reqEditorProvider";
import type { ExportKind, SidecarKind } from "./protocol";
import { sidecarUris } from "./sidecars";
import { disposeStatusBar } from "./statusBar";

const SIDECAR_LABEL: Record<SidecarKind, string> = {
  review: "review comments",
  traceability: "traceability",
};

function requireActive(): ReturnType<typeof getActiveEditor> {
  const active = getActiveEditor();
  if (!active) {
    void vscode.window.showInformationMessage(
      "Open a document with the Requirements Editor first (right-click a .md file → Open With…).",
    );
  }
  return active;
}

/**
 * Import a sidecar JSON from anywhere: validate, then copy it over the
 * document's own sidecar file — the SidecarService watcher picks up the
 * change and the editor updates live.
 */
function registerImportCommand(command: string, kind: SidecarKind): vscode.Disposable {
  return vscode.commands.registerCommand(command, async () => {
    const active = requireActive();
    if (!active) return;
    const target = sidecarUris(active.document)[kind];
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ["json"] },
      title: `Import ${SIDECAR_LABEL[kind]} JSON`,
    });
    if (!picked?.[0]) return;
    let body: Uint8Array;
    try {
      body = await vscode.workspace.fs.readFile(picked[0]);
      JSON.parse(Buffer.from(body).toString("utf8"));
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Not a valid JSON file: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    let exists = false;
    try {
      await vscode.workspace.fs.stat(target);
      exists = true;
    } catch {
      /* no existing sidecar */
    }
    if (exists) {
      const answer = await vscode.window.showWarningMessage(
        `This document already has ${SIDECAR_LABEL[kind]} data (${target.path.split("/").pop()}). Replace it with the imported file?`,
        { modal: true },
        "Replace",
      );
      if (answer !== "Replace") return;
    }
    await vscode.workspace.fs.writeFile(target, body);
    void vscode.window.showInformationMessage(
      `Imported ${SIDECAR_LABEL[kind]} from ${picked[0].path.split("/").pop()}.`,
    );
  });
}

/** Save a copy of the document's sidecar JSON to a chosen location. */
function registerSaveAsCommand(command: string, kind: SidecarKind): vscode.Disposable {
  return vscode.commands.registerCommand(command, async () => {
    const active = requireActive();
    if (!active) return;
    const source = sidecarUris(active.document)[kind];
    let body: Uint8Array;
    try {
      body = await vscode.workspace.fs.readFile(source);
    } catch {
      void vscode.window.showInformationMessage(
        `This document has no ${SIDECAR_LABEL[kind]} data yet.`,
      );
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: source,
      filters: { JSON: ["json"] },
      title: `Save ${SIDECAR_LABEL[kind]} JSON as`,
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, body);
    void vscode.window.showInformationMessage(`Saved ${uri.path.split("/").pop()}.`);
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
