import * as vscode from "vscode";

export interface WireIssue {
  message: string;
  severity: "error" | "warning";
  targetId: string | null;
  rule: string;
}

let collection: vscode.DiagnosticCollection | null = null;

function getCollection(): vscode.DiagnosticCollection {
  if (!collection) collection = vscode.languages.createDiagnosticCollection("mdreq");
  return collection;
}

/**
 * Publish quality-engine findings as native VS Code diagnostics.
 *
 * Anchoring is heading-line-accurate (v1): an issue with a targetId maps to
 * the first heading line containing that ID; issues without one map to the
 * document's first line. Character-precise ranges are a later refinement
 * (ValidationIssue.range exists but nothing populates it document-wide yet).
 */
export function publishDiagnostics(document: vscode.TextDocument, issues: WireIssue[]): void {
  const diags: vscode.Diagnostic[] = [];
  const lineOfTarget = new Map<string, number>();

  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    if (!/^#{1,6}\s/.test(text)) continue;
    for (const issue of issues) {
      if (issue.targetId && !lineOfTarget.has(issue.targetId) && text.includes(issue.targetId)) {
        lineOfTarget.set(issue.targetId, i);
      }
    }
  }

  for (const issue of issues) {
    const line = issue.targetId ? (lineOfTarget.get(issue.targetId) ?? 0) : 0;
    const range = document.lineAt(Math.min(line, document.lineCount - 1)).range;
    const diag = new vscode.Diagnostic(
      range,
      issue.message,
      issue.severity === "error"
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning,
    );
    diag.source = "mdreq";
    diag.code = issue.rule;
    diags.push(diag);
  }

  getCollection().set(document.uri, diags);
}

export function clearDiagnostics(document: vscode.TextDocument): void {
  collection?.delete(document.uri);
}
