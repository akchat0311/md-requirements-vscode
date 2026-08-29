import type * as vscode from "vscode";
import { ReqEditorProvider } from "./reqEditorProvider";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(ReqEditorProvider.register(context));
}

export function deactivate(): void {}
