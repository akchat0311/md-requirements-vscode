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
/** Sidecar file URIs for a markdown document (D7 frozen naming). */
export function sidecarUris(document: vscode.TextDocument): Record<SidecarKind, vscode.Uri> {
  const base = document.uri.path.replace(/\.md$/i, "");
  return {
    review: document.uri.with({ path: `${base}.review.json` }),
    traceability: document.uri.with({ path: `${base}.test-traceability.json` }),
  };
}

export class SidecarService {
  private readonly uris: Record<SidecarKind, vscode.Uri>;
  private readonly lastWritten: Partial<Record<SidecarKind, string>> = {};
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    document: vscode.TextDocument,
    private readonly post: (msg: HostMessage) => void,
  ) {
    this.uris = sidecarUris(document);

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

const SIDECAR_LABEL: Record<SidecarKind, string> = {
  review: "review comments",
  traceability: "traceability",
};

/**
 * Import a sidecar JSON from anywhere: validate, then copy it over the
 * document's own sidecar file — the SidecarService watcher picks up the
 * change and the editor updates live.
 */
export async function importSidecar(
  document: vscode.TextDocument,
  kind: SidecarKind,
): Promise<void> {
  const target = sidecarUris(document)[kind];
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
}

/** Save a copy of the document's sidecar JSON to a chosen location. */
export async function saveSidecarAs(
  document: vscode.TextDocument,
  kind: SidecarKind,
): Promise<void> {
  const source = sidecarUris(document)[kind];
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
}

/**
 * Read the extension's editor-facing configuration. A non-empty regex takes
 * precedence over the simple example. A syntactically invalid regex is
 * surfaced once and ignored (fall through to simple/none) rather than
 * silently disabling requirement detection.
 */
let warnedInvalidRegex: string | null = null;

export function readEditorConfig(): import("./protocol").EditorConfig {
  const cfg = vscode.workspace.getConfiguration("mdreq");
  const variantVocabulary = cfg
    .get<string[]>("variantVocabulary", [])
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  const regexSource = cfg.get<string>("requirementPatternRegex", "").trim();
  const regexFlags = cfg.get<string>("requirementPatternRegexFlags", "").trim();
  if (regexSource.length > 0) {
    try {
      // Surface syntax errors here; the engine additionally requires a capture
      // group and treats any invalid pattern as unconfigured.
      new RegExp(regexSource, regexFlags);
      return {
        requirementPattern: { mode: "regex", source: regexSource, flags: regexFlags },
        enterMode:
          cfg.get<string>("newlineBehavior", "line") === "paragraph" ? "paragraph" : "line",
        variantVocabulary,
      };
    } catch (e) {
      if (warnedInvalidRegex !== regexSource) {
        warnedInvalidRegex = regexSource;
        void vscode.window.showWarningMessage(
          `Requirements Editor: mdreq.requirementPatternRegex is not a valid regular expression (${
            e instanceof Error ? e.message : String(e)
          }). Falling back to the simple pattern.`,
        );
      }
    }
  }
  const example = cfg.get<string>("requirementPattern", "").trim();
  const enterMode = cfg.get<string>("newlineBehavior", "line") === "paragraph" ? "paragraph" as const : "line" as const;
  return {
    requirementPattern: example.length > 0 ? { mode: "simple", example } : null,
    enterMode,
    variantVocabulary,
  };
}
