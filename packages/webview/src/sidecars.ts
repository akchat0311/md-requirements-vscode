import { useReviewCommentsStore, migrateReviewFile } from "@/stores/reviewCommentsStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { serializeTraceability } from "@/persistence/traceabilityFilePersistence";
import type { ReviewFile } from "@/types/reviewComment";
import type { SidecarKind, WebviewMessage } from "./protocol";

/**
 * Webview side of the sidecar pipeline (architecture §7.1).
 *
 * Inbound: `sidecarChanged` payloads load into the existing zustand stores —
 * the drawers, badges, and (later) dashboard all read those stores unchanged
 * from the browser app.
 *
 * Outbound: store subscriptions watch `isDirty`; a debounce later the full
 * serialized file body goes to the host (`sidecarEdit`) and the store is
 * marked saved. The webview owns the byte format (identical to the browser
 * app: D7 frozen schemas); the host writes verbatim and swallows the watcher
 * echo of its own write.
 */

const WRITE_DEBOUNCE_MS = 300;

let applyingRemote = false;
const timers: Partial<Record<SidecarKind, ReturnType<typeof setTimeout>>> = {};

function serializeReview(data: ReviewFile): string {
  return JSON.stringify({ ...data, _version: 1 }, null, 2);
}

export function initSidecars(post: (msg: WebviewMessage) => void): void {
  useReviewCommentsStore.subscribe((s) => {
    if (!s.isDirty || applyingRemote) return;
    clearTimeout(timers.review);
    timers.review = setTimeout(() => {
      const state = useReviewCommentsStore.getState();
      if (!state.isDirty) return;
      post({ type: "sidecarEdit", kind: "review", json: serializeReview(state.comments) });
      state.markSaved();
    }, WRITE_DEBOUNCE_MS);
  });

  useTraceabilityStore.subscribe((s) => {
    if (!s.isDirty || applyingRemote) return;
    clearTimeout(timers.traceability);
    timers.traceability = setTimeout(() => {
      const state = useTraceabilityStore.getState();
      if (!state.isDirty) return;
      post({
        type: "sidecarEdit",
        kind: "traceability",
        json: serializeTraceability(state.getFileData()),
      });
      state.markSaved();
    }, WRITE_DEBOUNCE_MS);
  });
}

export function onSidecarChanged(kind: SidecarKind, data: unknown): void {
  applyingRemote = true;
  try {
    if (kind === "review") {
      const store = useReviewCommentsStore.getState();
      if (data === null) store.reset();
      else store.load(migrateReviewFile(data));
    } else {
      const store = useTraceabilityStore.getState();
      if (data === null) store.reset();
      else store.load(data);
    }
  } finally {
    applyingRemote = false;
  }
}
