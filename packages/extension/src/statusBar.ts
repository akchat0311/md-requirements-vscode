import * as vscode from "vscode";

/** Word count + reading time for the active requirements editor. */

let item: vscode.StatusBarItem | null = null;

function getItem(): vscode.StatusBarItem {
  if (!item) {
    item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  }
  return item;
}

export function updateStatusBarFor(document: vscode.TextDocument | null): void {
  const bar = getItem();
  if (!document) {
    bar.hide();
    return;
  }
  const words = document.getText().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  bar.text = `$(book) ${words.toLocaleString()} words · ${minutes} min read`;
  bar.tooltip = "Requirements Editor — word count and estimated reading time";
  bar.show();
}

export function disposeStatusBar(): void {
  item?.dispose();
  item = null;
}
