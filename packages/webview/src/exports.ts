import type { Editor } from "@tiptap/core";
import { deriveOutline, flattenOutline } from "@/editor/utils/deriveOutline";
import { compileRequirementPattern, matchRequirementId } from "@/editor/utils/requirementOps";
import {
  collectReviewExportRows,
  generateReviewCsv,
} from "@/services/reviewExportService";
import {
  collectTraceabilityCsvRows,
  generateTraceabilityCsv,
} from "@/services/traceabilityExportService";
import { useConfigStore } from "@/stores/configStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import type { ExportKind } from "./protocol";

/**
 * CSV builders for host-triggered exports (mdreq.exportReviewCsv /
 * mdreq.exportTraceabilityCsv). Same recipes as the browser app's export
 * call sites; the host owns the save dialog and file write.
 */
export function buildCsv(
  kind: ExportKind,
  editor: Editor,
  docName: string,
): { csv: string; empty: boolean } {
  const { requirementPattern } = useConfigStore.getState();

  if (kind === "reviewCsv") {
    const { statuses } = useStatusConfigStore.getState();
    const { comments } = useReviewCommentsStore.getState();
    const flat = flattenOutline(deriveOutline(editor));
    const docContent = editor.state.doc.content.toJSON();
    const rows = collectReviewExportRows(
      flat,
      docContent,
      docName,
      requirementPattern,
      statuses,
      comments,
    );
    return { csv: rows.length ? generateReviewCsv(rows) : "", empty: rows.length === 0 };
  }

  const { testCases, links, coverage } = useTraceabilityStore.getState();
  const compiled = compileRequirementPattern(requirementPattern);
  const freshIds = compiled
    ? flattenOutline(deriveOutline(editor))
        .map((n) => matchRequirementId(n.label, compiled)?.id)
        .filter((id): id is string => id !== undefined)
    : [];
  const rows = collectTraceabilityCsvRows(freshIds, testCases, links, coverage);
  return { csv: generateTraceabilityCsv(rows), empty: rows.length === 0 };
}
