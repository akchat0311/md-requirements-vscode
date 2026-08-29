import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Map VS Code's theme (class on <body>) onto the app's `.dark` convention
// (class on <html>, which the design tokens in styles/index.css key off).
function syncTheme(): void {
  const dark =
    document.body.classList.contains("vscode-dark") ||
    document.body.classList.contains("vscode-high-contrast");
  document.documentElement.classList.toggle("dark", dark);
}
syncTheme();
new MutationObserver(syncTheme).observe(document.body, {
  attributes: true,
  attributeFilter: ["class"],
});

createRoot(document.getElementById("editor")!).render(<App />);

// Debug/e2e handle: lets the Playwright suite drive and inspect the stores.
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { useCommentDrawerStore } from "@/stores/commentDrawerStore";
(window as unknown as Record<string, unknown>).__mdreqStores = {
  review: useReviewCommentsStore,
  traceability: useTraceabilityStore,
  commentDrawer: useCommentDrawerStore,
};
