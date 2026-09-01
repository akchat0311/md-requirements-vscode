/**
 * Real-Chromium e2e for the webview bundle.
 *
 * Loads the built editor (packages/extension/media/) into actual Chromium
 * with a stubbed acquireVsCodeApi, performs real keyboard edits, and asserts
 * the serialized markdown the webview would send to the host.
 *
 * Exists because of a bug class jsdom cannot reproduce: Chromium's
 * contentEditable rewrites raw \n text newlines into <br> during ordinary
 * edits, which the DOM re-read turned into hard breaks (trailing
 * backslashes) until soft breaks became explicit nodes (SoftBreak.ts).
 *
 * Run: npm run build && npm run e2e   (requires `npx playwright install chromium`)
 */
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MEDIA = path.join(__dirname, "..", "packages", "extension", "media");
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/editor.css">
<script>
window.__messages = [];
window.__docVersion = 1;
// Faithful host stub: a real VS Code host acks every applied edit — without
// the ack the bridge's one-in-flight slot stays occupied and no later edit
// can ever send (found via scenario 20, the first multi-edit scenario).
window.acquireVsCodeApi = () => ({
  postMessage: (m) => {
    window.__messages.push(JSON.parse(JSON.stringify(m)));
    if (m.type === "edit") {
      setTimeout(() => window.postMessage({ type: "ack", version: ++window.__docVersion }, "*"), 10);
    }
  },
});
</script>
</head><body><div id="editor"></div><script type="module" src="/editor.js"></script></body></html>`;

const PARAGRAPH = [
  "Typora-style editable preview for markdown requirements documents, migrated",
  "from the browser-based MD_Editor per the Engine & Chassis architecture.",
  "The markdown \`TextDocument\` is the single source of truth; the proven",
  "round-trip engine runs in a webview; a thin extension-host layer owns all",
  "platform integration.",
  "",
].join("\n");

function serve() {
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end(HTML);
    } else {
      const rel = decodeURIComponent((req.url || "").split("?")[0]).replace(/^\/+/, "");
      const file = path.normalize(path.join(MEDIA, rel));
      if (!file.startsWith(MEDIA) || !fs.existsSync(file)) {
        return void res.writeHead(404).end();
      }
      const types = {
        ".js": "text/javascript",
        ".css": "text/css",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".ttf": "font/ttf",
        ".map": "application/json",
      };
      res.setHeader("content-type", types[path.extname(file)] ?? "application/octet-stream");
      res.end(fs.readFileSync(file));
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

async function openEditor(browser, port, markdown, config) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "ready"));
  await page.evaluate(
    ({ md, cfg }) =>
      window.postMessage(
        { type: "init", protocol: 3, text: md, version: 1, config: cfg, docName: "e2e-doc.md", docBaseUri: "https://doc-base.example/docs" },
        "*",
      ),
    {
      md: markdown,
      cfg: {
        enterMode: "line",
        ...(config ?? { requirementPattern: { mode: "simple", example: "REQ_001" } }),
      },
    },
  );
  await page.waitForSelector(".ProseMirror p");
  // Wait until the editor is editable and actually holds focus — a keyboard
  // event dispatched before focus settles is silently lost.
  await page.waitForFunction(
    () => document.querySelector(".ProseMirror")?.getAttribute("contenteditable") === "true",
  );
  await page.click(".ProseMirror p");
  await page.waitForFunction(
    () => document.activeElement?.closest?.(".ProseMirror") !== null,
  );
  return page;
}

async function lastEdit(page) {
  // The webview debounces 250ms; wait for the edit message itself so slow
  // first-run serialization can't flake the assertion.
  await page
    .waitForFunction(() => window.__messages.some((m) => m.type === "edit"), null, {
      timeout: 4000,
    })
    .catch(() => {});
  const edits = await page.evaluate(() => window.__messages.filter((m) => m.type === "edit"));
  if (edits.length === 0) {
    console.error(
      "      no edit message; messages =",
      await page.evaluate(() => window.__messages.map((m) => m.type).join(",")),
      "| paragraph tail =",
      JSON.stringify(
        await page.evaluate(() =>
          document.querySelector(".ProseMirror p").textContent.slice(-30),
        ),
      ),
      "| selection =",
      await page.evaluate(() => {
        const s = window.getSelection();
        return `${s.anchorNode?.nodeName}@${s.anchorOffset}`;
      }),
    );
    return null;
  }
  return edits[edits.length - 1].markdown;
}

function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
    return true;
  }
  console.error(`FAIL  ${name}\n      ${detail}`);
  return false;
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch();
  // page console passthrough for BUTTONS debug

  let ok = true;

  {
    // Scenario 1: replace the trailing period of a soft-wrapped paragraph.
    // Uses the insertText input path (select the "." and type over it) —
    // reliable under synthetic CDP input, unlike collapsed-caret native
    // Backspace deletion, and verified to reproduce the pre-SoftBreak
    // corruption on the old bundle.
    const page = await openEditor(browser, port, PARAGRAPH);
    await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.querySelector(".ProseMirror p"),
        NodeFilter.SHOW_TEXT,
      );
      let node;
      let target = null;
      while ((node = walker.nextNode())) {
        if (node.textContent.includes("platform integration.")) target = node;
      }
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(target, target.textContent.length - 1);
      range.setEnd(target, target.textContent.length);
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.keyboard.type("!");
    const md = await lastEdit(page);
    ok =
      check(
        "editing at paragraph end keeps soft breaks",
        md !== null && !md.includes("\\\n") && md.includes("the proven\nround-trip"),
        JSON.stringify(md),
      ) && ok;
    ok = check(
      "only the period changed",
      md === PARAGRAPH.replace("platform integration.", "platform integration!"),
      JSON.stringify(md),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 2: type text directly at a soft-wrap boundary.
    const page = await openEditor(browser, port, PARAGRAPH);
    await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.querySelector(".ProseMirror p"),
        NodeFilter.SHOW_TEXT,
      );
      let node;
      let target = null;
      let offset = 0;
      while ((node = walker.nextNode())) {
        const idx = node.textContent.indexOf("proven");
        if (idx >= 0) {
          target = node;
          offset = idx + "proven".length;
          break;
        }
      }
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(target, offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.type(" and tested", { delay: 20 });
    const md = await lastEdit(page);
    ok =
      check(
        "typing at a wrap boundary keeps soft breaks",
        md !== null && !md.includes("\\\n") && md.includes("proven and tested\nround-trip"),
        JSON.stringify(md),
      ) && ok;
    await page.close();
  }

  {
    // Scenario 3: rich rendering — mermaid diagram, KaTeX math, callout,
    // toolbar, and VS Code dark-theme sync. Exercises the lazy chunks
    // (mermaid/katex load via dynamic import) and the Tailwind build.
    const RICH = [
      "# Rendering check",
      "",
      "Inline math: $e^{i\\pi} + 1 = 0$ here.",
      "",
      "> \\[!INFO]",
      ">",
      "> Callout body text",
      "",
      "```mermaid",
      "graph TD",
      "  A[Start] --> B[End]",
      "```",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, RICH);
    const waitFor = async (name, selector) => {
      const found = await page
        .waitForSelector(selector, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      ok = check(name, found, `selector not found: ${selector}`) && ok;
    };
    await waitFor("callout renders", '.ProseMirror [data-callout-type]');
    await waitFor("KaTeX math renders", ".ProseMirror .katex");
    await waitFor("mermaid diagram renders", ".ProseMirror svg");
    // The toolbar is a selection bubble menu: select a paragraph first.
    await page.click(".ProseMirror p", { clickCount: 3 });
    await waitFor("bubble toolbar appears on selection", "button");
    await page.evaluate(() => document.body.classList.add("vscode-dark"));
    await page.waitForTimeout(100);
    ok =
      check(
        "dark theme syncs from VS Code body class",
        await page.evaluate(() => document.documentElement.classList.contains("dark")),
        "documentElement missing .dark after body got vscode-dark",
      ) && ok;
    await page.close();
  }

  {
    // Scenario 4: Enter then Backspace must leave the file byte-identical —
    // an empty paragraph is ephemeral UI state, never file content, and its
    // appearance must not canonicalize untouched blocks elsewhere (the
    // 2026-08-30 incident: whole-file rewrite via the D9 safety gate).
    const NONCANON = [
      "Put the cursor after this colon:",
      "",
      "* star bullet untouched",
      "   * three-space nested",
      "",
      "1) paren ordered untouched",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, NONCANON);
    await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.querySelector(".ProseMirror p"),
        NodeFilter.SHOW_TEXT,
      );
      const target = walker.nextNode();
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(target, target.textContent.length);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(600);
    const edits = await page.evaluate(() =>
      window.__messages.filter((m) => m.type === "edit"),
    );
    const finalText = edits.length ? edits[edits.length - 1].markdown : NONCANON;
    ok = check(
      "Enter then Backspace leaves the file byte-identical",
      finalText === NONCANON,
      JSON.stringify({ edits: edits.length, finalText }),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 5: review-comment pipeline — sidecar data in, badge rendered,
    // drawer opens on badge click, store mutation posts a sidecarEdit with
    // the serialized .review.json body.
    const REQDOC = [
      "## Introduction",
      "",
      "Plain heading — must be reviewable too (section target).",
      "",
      "## REQ_001 The system shall respond within 2 seconds",
      "",
      "Body of the requirement.",
      "",
      "## REQ_002 The system shall log all requests",
      "",
      "More body.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, REQDOC);
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "sidecarChanged",
          kind: "review",
          data: {
            _version: 1,
            REQ_001: [
              {
                id: "c_1",
                author: "Reviewer",
                text: "Please quantify the load profile.",
                createdAt: "2026-08-30T10:00:00Z",
                status: "open",
              },
            ],
          },
        },
        "*",
      );
    });
    const badge = await page
      .waitForSelector(".req-comment-badge--open", { timeout: 8000 })
      .catch(() => null);
    ok = check("open-comment badge renders on the requirement", badge !== null, "no badge") && ok;

    if (badge) {
      await badge.click();
      const opened = await page
        .waitForFunction(
          () => window.__mdreqStores.commentDrawer.getState().reqId === "REQ_001",
          null,
          { timeout: 4000 },
        )
        .then(() => true)
        .catch(() => false);
      ok = check("badge click opens the comment drawer for REQ_001", opened, "drawer not open") && ok;
      const drawerShowsComment = await page
        .waitForFunction(
          () => document.body.textContent.includes("Please quantify the load profile."),
          null,
          { timeout: 4000 },
        )
        .then(() => true)
        .catch(() => false);
      ok = check("drawer shows the loaded comment", drawerShowsComment, "comment text missing") && ok;
    }

    await page.evaluate(() => {
      window.__mdreqStores.review
        .getState()
        .addComment("REQ_002", "Tester", "New comment from the editor.");
    });
    const wrote = await page
      .waitForFunction(
        () =>
          window.__messages.some(
            (m) => m.type === "sidecarEdit" && m.kind === "review" && m.json.includes("New comment from the editor."),
          ),
        null,
        { timeout: 4000 },
      )
      .then(() => true)
      .catch(() => false);
    ok = check("store mutation persists via sidecarEdit", wrote, "no sidecarEdit message") && ok;

    // Every heading is reviewable: the unnumbered "Introduction" heading gets
    // an (empty-state) badge whose click opens the drawer on its section id.
    const introBadgeFound = await page.evaluate(() => {
      const badges = [...document.querySelectorAll(".req-comment-badge")];
      const intro = badges.find((b) =>
        b.closest("h1,h2,h3,h4,h5,h6")?.textContent.startsWith("Introduction"),
      );
      if (!intro) return false;
      // The badge acts on mousedown (it must beat ProseMirror's own handling).
      intro.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      return true;
    });
    const sectionOpened = introBadgeFound
      ? await page
          .waitForFunction(
            () => window.__mdreqStores.commentDrawer.getState().reqId === "section:Introduction",
            null,
            { timeout: 4000 },
          )
          .then(() => true)
          .catch(() => false)
      : false;
    ok = check(
      "plain (non-requirement) heading is reviewable as a section target",
      sectionOpened,
      introBadgeFound ? "drawer did not open on section id" : "NO BADGE ON PLAIN HEADING",
    ) && ok;
    if (wrote) {
      const json = await page.evaluate(
        () => window.__messages.filter((m) => m.type === "sidecarEdit").pop().json,
      );
      const parsed = JSON.parse(json);
      ok = check(
        "sidecar body keeps the browser-app schema",
        parsed._version === 1 &&
          Array.isArray(parsed.REQ_001) &&
          Array.isArray(parsed.REQ_002) &&
          parsed.REQ_002[0].status === "open",
        json.slice(0, 200),
      ) && ok;
    }
    await page.close();
  }

  {
    // Scenario 6: regex-mode requirement pattern — TRANS_<Feature>_001 style
    // IDs with a variable feature segment (mdreq.requirementPatternRegex).
    const TRANSDOC = [
      "## TRANS_Parking_001 The transmission shall engage park within 500 ms",
      "",
      "Body.",
      "",
      "## TRANS_Reverse_002 The transmission shall inhibit reverse above 5 km/h",
      "",
      "Body.",
      "",
      "## REQ_001 Wrong convention — must NOT match in regex mode",
      "",
      "Body.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, TRANSDOC, {
      requirementPattern: {
        mode: "regex",
        source: "(TRANS_[A-Za-z0-9]+_\\d{3})",
        flags: "",
      },
    });
    const ids = await page.evaluate(() => {
      const badges = [...document.querySelectorAll(".req-comment-badge")];
      const first = badges.find((b) =>
        b.closest("h1,h2,h3,h4,h5,h6")?.textContent.startsWith("TRANS_Parking_001"),
      );
      if (first) first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      return badges.length;
    });
    const regexOpened = await page
      .waitForFunction(
        () => window.__mdreqStores.commentDrawer.getState().reqId === "TRANS_Parking_001",
        null,
        { timeout: 4000 },
      )
      .then(() => true)
      .catch(() => false);
    ok = check(
      "regex pattern matches TRANS_<Feature>_NNN requirement IDs",
      regexOpened,
      `drawer reqId not TRANS_Parking_001 (badges seen: ${ids})`,
    ) && ok;
    const wrongConventionIsSection = await page.evaluate(() => {
      const badges = [...document.querySelectorAll(".req-comment-badge")];
      const req = badges.find((b) =>
        b.closest("h1,h2,h3,h4,h5,h6")?.textContent.startsWith("REQ_001"),
      );
      if (!req) return "no badge";
      req.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      return "clicked";
    });
    const reqAsSection = await page
      .waitForFunction(
        () =>
          window.__mdreqStores.commentDrawer
            .getState()
            .reqId?.startsWith("section:REQ_001"),
        null,
        { timeout: 4000 },
      )
      .then(() => true)
      .catch(() => false);
    ok = check(
      "non-matching convention falls back to a section target in regex mode",
      reqAsSection,
      String(wrongConventionIsSection),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 7: traceability pipeline — sidecar data in, trace badge, panel
    // opens on badge click, store mutation posts serialized sidecar body.
    const TDOC = [
      "## REQ_001 The system shall respond within 2 seconds",
      "",
      "Body.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, TDOC);
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "sidecarChanged",
          kind: "traceability",
          data: {
            version: 1,
            testCases: [{ id: "TC_100", title: "Response time under nominal load" }],
            links: [{ tc: "TC_100", req: "REQ_001" }],
            coverage: { REQ_001: "PARTIAL" },
          },
        },
        "*",
      );
    });
    const traceBadge = await page
      .waitForSelector(".req-trace-badge:not(.req-trace-badge--empty)", { timeout: 8000 })
      .catch(() => null);
    ok = check("trace badge renders with linked test case", traceBadge !== null, "no badge") && ok;
    if (traceBadge) {
      await page.evaluate(() =>
        document
          .querySelector(".req-trace-badge:not(.req-trace-badge--empty)")
          .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })),
      );
      const opened = await page
        .waitForFunction(
          () => window.__mdreqStores.traceabilityPanel.getState().reqId === "REQ_001",
          null,
          { timeout: 4000 },
        )
        .then(() => true)
        .catch(() => false);
      ok = check("trace badge opens the traceability panel", opened, "panel not open") && ok;
      const showsTc = await page
        .waitForFunction(
          () => document.body.textContent.includes("TC_100"),
          null,
          { timeout: 4000 },
        )
        .then(() => true)
        .catch(() => false);
      ok = check("traceability drawer lists the linked test case", showsTc, "TC_100 missing") && ok;
    }
    await page.evaluate(() => {
      window.__mdreqStores.traceability.getState().addTestCase("TC_200", "Added from editor");
    });
    const traceWrote = await page
      .waitForFunction(
        () =>
          window.__messages.some(
            (m) => m.type === "sidecarEdit" && m.kind === "traceability" && m.json.includes("TC_200"),
          ),
        null,
        { timeout: 4000 },
      )
      .then(() => true)
      .catch(() => false);
    ok = check("traceability mutation persists via sidecarEdit", traceWrote, "no write") && ok;
    if (traceWrote) {
      const parsed = JSON.parse(
        await page.evaluate(
          () => window.__messages.filter((m) => m.type === "sidecarEdit" && m.kind === "traceability").pop().json,
        ),
      );
      ok = check(
        "traceability sidecar keeps the browser-app schema",
        Array.isArray(parsed.testCases) && Array.isArray(parsed.links) && parsed.coverage.REQ_001 === "PARTIAL",
        JSON.stringify(parsed).slice(0, 150),
      ) && ok;
    }

    // Scenario 8 (same page): host-triggered CSV exports.
    await page.evaluate(() =>
      window.postMessage({ type: "requestExport", kind: "traceabilityCsv" }, "*"),
    );
    const traceCsv = await page
      .waitForFunction(
        () => window.__messages.find((m) => m.type === "exportResult" && m.kind === "traceabilityCsv"),
        null,
        { timeout: 4000 },
      )
      .then(() => page.evaluate(() => window.__messages.find((m) => m.type === "exportResult" && m.kind === "traceabilityCsv")))
      .catch(() => null);
    ok = check(
      "traceability CSV export includes the linked requirement row",
      traceCsv !== null && !traceCsv.empty && traceCsv.csv.includes("REQ_001") && traceCsv.csv.includes("TC_100"),
      JSON.stringify(traceCsv).slice(0, 150),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 9: dashboard view — opens on host command, tabs render from
    // live editor state, row navigation returns to the editor.
    const DDOC = [
      "## REQ_001 The system shall respond within 2 seconds",
      "",
      "Body.",
      "",
      "## REQ_002 The system shall log all requests",
      "",
      "Body two.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, DDOC);
    await page.evaluate(() => window.postMessage({ type: "showDashboard" }, "*"));
    const dashOpen = await page
      .waitForSelector('[data-view="dashboard"]', { timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    ok = check("dashboard opens on host command", dashOpen, "no dashboard view") && ok;

    const tabsPresent = await page.evaluate(() => {
      const t = document.body.textContent;
      return t.includes("Overview") && t.includes("Reviews") && t.includes("Traceability") && t.includes("Quality");
    });
    ok = check("dashboard tabs render", tabsPresent, "tab labels missing") && ok;

    const clickedTab = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "Requirements",
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    const reqListed = clickedTab
      ? await page
          .waitForFunction(() => document.body.textContent.includes("REQ_002"), null, { timeout: 4000 })
          .then(() => true)
          .catch(() => false)
      : false;
    ok = check("requirements tab lists document requirements", reqListed, "REQ_002 not listed") && ok;

    // The requirement index debounces ~300ms after the tab mounts — wait for
    // the actual row cell rather than sampling immediately.
    await page
      .waitForFunction(
        () => [...document.querySelectorAll("td")].some((el) => el.textContent.trim() === "REQ_002"),
        null,
        { timeout: 5000 },
      )
      .catch(() => {});
    const navigated = await page.evaluate(() => {
      const target = [...document.querySelectorAll("td")].find(
        (el) => el.textContent.trim() === "REQ_002",
      );
      if (!target) return false;
      target.click();
      return true;
    });
    const backInEditor = navigated
      ? await page
          .waitForSelector('[data-view="editor"]', { timeout: 4000 })
          .then(() => true)
          .catch(() => false)
      : false;
    if (!backInEditor) {
      console.error(
        "      diag:",
        await page.evaluate(() => ({
          navigatedClicked: undefined,
          tds: [...document.querySelectorAll("td")].map((t) => t.textContent.trim()).slice(0, 12),
          dashText: document.querySelector('[data-testid="requirements-tab"]')?.innerText?.slice(0, 300) ?? "NO requirements-tab NODE",
          view: document.querySelector("[data-view]")?.getAttribute("data-view"),
          activeTab: [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Requirements").length,
        })),
      );
    }
    ok = check("clicking a requirement navigates back to the editor", backInEditor, `navigated=${navigated}`) && ok;
    await page.close();
  }

  {
    // Scenario 10: quality engine — findings for defective requirements are
    // posted to the host as diagnostics (duplicate IDs, missing status).
    const QDOC = [
      "## REQ_001 The system shall respond quickly",
      "",
      "Body.",
      "",
      "## REQ_001 The system shall also do something else",
      "",
      "Body.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, QDOC);
    const diag = await page
      .waitForFunction(
        () => {
          const d = window.__messages.filter((m) => m.type === "diagnostics").pop();
          return d && d.issues.length > 0 ? d : undefined;
        },
        null,
        { timeout: 8000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "diagnostics").pop()))
      .catch(() => null);
    ok = check(
      "quality engine posts diagnostics for defective requirements",
      diag !== null && diag.issues.length > 0,
      "no diagnostics message with issues",
    ) && ok;
    if (diag) {
      const hasDuplicate = diag.issues.some(
        (i) => i.targetId === "REQ_001" && /duplicate/i.test(i.message + i.rule),
      );
      ok = check(
        "duplicate requirement ID is reported against REQ_001",
        hasDuplicate,
        JSON.stringify(diag.issues.slice(0, 4)),
      ) && ok;
    }
    await page.close();
  }

  {
    // Scenario 11: relative images resolve against the document base URI
    // (rendering only — the node attrs keep the relative path for fidelity);
    // absolute URLs pass through untouched. Plus: Cmd/Ctrl+F opens the
    // find-replace bar scoped to the preview.
    const IDOC = [
      "# Images",
      "",
      "![local](images/pic.png)",
      "",
      "![absolute](https://example.com/x.png)",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, IDOC);
    const srcs = await page.evaluate(() =>
      [...document.querySelectorAll(".ProseMirror img")].map((i) => i.getAttribute("src")),
    );
    ok = check(
      "relative image src resolves against the document base",
      srcs.includes("https://doc-base.example/docs/images/pic.png"),
      JSON.stringify(srcs),
    ) && ok;
    ok = check(
      "absolute image src passes through untouched",
      srcs.includes("https://example.com/x.png"),
      JSON.stringify(srcs),
    ) && ok;

    const fidelity = await lastEdit(page);
    ok = check(
      "image mapping never leaks into the markdown",
      fidelity === null, // no edit at all: attrs kept the relative path
      JSON.stringify(fidelity),
    ) && ok;

    await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
    const findOpen = await page
      .waitForSelector('input[placeholder*="ind" i], input[type="text"]', { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    ok = check("Cmd/Ctrl+F opens the in-preview find bar", findOpen, "no find input") && ok;
    await page.close();
  }

  {
    // Scenario 12: outline sidebar — lists headings, click navigates.
    const ODOC = [
      "# Title",
      "",
      "Intro.",
      "",
      "## Alpha Section",
      "",
      "Alpha body.",
      "",
      "## Omega Section",
      "",
      "Omega body.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, ODOC);
    const outlineHas = await page
      .waitForFunction(
        () => document.querySelector("#outline-panel")?.textContent.includes("Omega Section"),
        null,
        { timeout: 6000 },
      )
      .then(() => true)
      .catch(() => false);
    ok = check("outline panel lists document headings", outlineHas, "Omega Section missing") && ok;

    const before = await page.evaluate(() => window.__mdreqEditor.state.selection.from);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("#outline-panel *")].find(
        (n) => n.children.length === 0 && n.textContent.trim() === "Omega Section",
      );
      el?.closest("button, [role=button], li, div")?.click();
      el?.click();
    });
    const moved = await page
      .waitForFunction(
        (b) => window.__mdreqEditor.state.selection.from !== b,
        before,
        { timeout: 4000 },
      )
      .then(() => true)
      .catch(() => false);
    ok = check("clicking an outline entry moves the selection", moved, `selection stayed at ${before}`) && ok;
    await page.close();
  }

  {
    // Scenario 13: discoverable import/export + renumber.
    // (a) Dashboard file sections expose working Load/Save As buttons that
    //     route to host dialogs (sidecarAction messages).
    // (b) The in-tab CSV export button routes through the host saveFile hook
    //     (webview sandbox blocks <a download>).
    // (c) Duplicate requirement IDs surface the outline's Renumber button.
    const RDOC = [
      "## REQ_001 The system shall respond",
      "",
      "Body.",
      "",
      "## REQ_001 The system shall log (duplicate on purpose)",
      "",
      "Body.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, RDOC);

    // (c) outline renumber button appears for duplicate IDs
    const renumberVisible = await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("#outline-panel button")].some((b) =>
            /renumber/i.test(b.textContent),
          ),
        null,
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    ok = check("outline shows Renumber for duplicate IDs", renumberVisible, "no renumber button") && ok;

    // (a) dashboard Reviews tab file section: Load Review… posts sidecarAction
    await page.evaluate(() => window.postMessage({ type: "showDashboard" }, "*"));
    await page.waitForSelector('[data-view="dashboard"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Reviews");
      btn?.click();
    });
    const loadClicked = await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll('[data-testid="review-file-section"] button')].some((b) =>
            /load/i.test(b.textContent),
          ),
        null,
        { timeout: 5000 },
      )
      .then(() =>
        page.evaluate(() => {
          const b = [...document.querySelectorAll('[data-testid="review-file-section"] button')].find(
            (x) => /load/i.test(x.textContent),
          );
          b?.click();
          return Boolean(b);
        }),
      )
      .catch(() => false);
    const importPosted = loadClicked
      ? await page
          .waitForFunction(
            () =>
              window.__messages.some(
                (m) => m.type === "sidecarAction" && m.kind === "review" && m.action === "import",
              ),
            null,
            { timeout: 4000 },
          )
          .then(() => true)
          .catch(() => false)
      : false;
    ok = check("dashboard Load Review button posts a host import action", importPosted, `clicked=${loadClicked}`) && ok;

    // (b) traceability tab CSV export → saveFile message
    await page.evaluate(() => {
      window.postMessage(
        {
          type: "sidecarChanged",
          kind: "traceability",
          data: { version: 1, testCases: [{ id: "TC_1", title: "t" }], links: [{ tc: "TC_1", req: "REQ_001" }], coverage: {} },
        },
        "*",
      );
    });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Traceability");
      btn?.click();
    });
    const csvClicked = await page
      .waitForFunction(
        () => [...document.querySelectorAll("button")].some((b) => /export csv/i.test(b.textContent)),
        null,
        { timeout: 5000 },
      )
      .then(() =>
        page.evaluate(() => {
          const b = [...document.querySelectorAll("button")].find((x) => /export csv/i.test(x.textContent));
          b?.click();
          return Boolean(b);
        }),
      )
      .catch(() => false);
    const savePosted = csvClicked
      ? await page
          .waitForFunction(
            () => window.__messages.some((m) => m.type === "saveFile" && m.name.endsWith(".csv")),
            null,
            { timeout: 4000 },
          )
          .then(() => true)
          .catch(() => false)
      : false;
    ok = check("in-tab CSV export routes through the host save dialog", savePosted, `clicked=${csvClicked}`) && ok;
    await page.close();
  }

  {
    // Scenario 14: per-stem renumbering in regex mode — TRANS_<Feature>_NNN
    // groups renumber independently (duplicates resolved, gaps compacted),
    // and the resulting markdown carries the corrected IDs.
    const NDOC = [
      "## TRANS_Parking_004 Engage park within 500 ms",
      "",
      "Body.",
      "",
      "## TRANS_Parking_004 Duplicate on purpose",
      "",
      "Body.",
      "",
      "## TRANS_Reverse_009 Inhibit reverse above 5 km/h",
      "",
      "Body.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, NDOC, {
      requirementPattern: { mode: "regex", source: "(TRANS_[A-Za-z0-9]+_\\d{3})", flags: "" },
    });
    const renumberBtn = await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("#outline-panel button")].find((b) =>
            /renumber/i.test(b.textContent),
          )
            ? true
            : undefined,
        null,
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    ok = check("regex mode shows the Renumber button for duplicates", renumberBtn, "no button") && ok;

    if (renumberBtn) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("#outline-panel button")].find((x) =>
          /renumber/i.test(x.textContent),
        );
        b?.click();
      });
      // Confirm dialog → confirm button
      const confirmed = await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll("button")].some(
              (b) => b.textContent.trim().toLowerCase() === "renumber",
            ),
          null,
          { timeout: 4000 },
        )
        .then(() =>
          page.evaluate(() => {
            const b = [...document.querySelectorAll("button")]
              .reverse()
              .find((x) => x.textContent.trim().toLowerCase() === "renumber");
            b?.click();
            return Boolean(b);
          }),
        )
        .catch(() => false);
      const md = confirmed
        ? await page
            .waitForFunction(
              () => {
                const e = window.__messages.filter((m) => m.type === "edit").pop();
                return e && e.markdown.includes("TRANS_Parking_002") ? e.markdown : undefined;
              },
              null,
              { timeout: 6000 },
            )
            .then(() =>
              page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown),
            )
            .catch(() => null)
        : null;
      ok = check(
        "per-stem renumbering resolves duplicates and compacts groups",
        md !== null &&
          md.includes("TRANS_Parking_001 Engage park") &&
          md.includes("TRANS_Parking_002 Duplicate") &&
          md.includes("TRANS_Reverse_001 Inhibit reverse") &&
          !md.includes("TRANS_Reverse_009"),
        md === null ? "no renumbered edit observed" : md.slice(0, 300),
      ) && ok;
    }
    await page.close();
  }

  {
    // Scenario 15: "/" → New Requirement works in regex mode — the generated
    // ID extends the nearest preceding requirement's stem group.
    const SDOC = [
      "## TRANS_Parking_002 Engage park within 500 ms",
      "",
      "Body of the requirement.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, SDOC, {
      requirementPattern: { mode: "regex", source: "(TRANS_[A-Za-z0-9]+_\\d{3})", flags: "" },
    });
    // Cursor to end of the body paragraph, new line, type "/"
    await page.evaluate(() => {
      const e = window.__mdreqEditor;
      e.chain().focus().setTextSelection(e.state.doc.content.size - 1).run();
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type("/", { delay: 30 });
    const itemShown = await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("[role=option]")].some((el) =>
            el.textContent.includes("New Requirement"),
          ),
        null,
        { timeout: 5000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!itemShown) {
      console.error(
        "      diag:",
        await page.evaluate(() => ({
          listbox: Boolean(document.querySelector("[role=listbox]")),
          options: [...document.querySelectorAll("[role=option]")].map((o) => o.textContent.slice(0, 40)),
          paraTail: document.querySelector(".ProseMirror").textContent.slice(-20),
        })),
      );
    }
    ok = check("slash menu offers New Requirement in regex mode", itemShown, "item missing") && ok;

    if (itemShown) {
      await page.keyboard.type("req", { delay: 30 });
      await page.keyboard.press("Enter");
      const md = await page
        .waitForFunction(
          () => {
            const e = window.__messages.filter((m) => m.type === "edit").pop();
            return e && e.markdown.includes("TRANS_Parking_003") ? true : undefined;
          },
          null,
          { timeout: 6000 },
        )
        .then(() =>
          page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown),
        )
        .catch(() => null);
      ok = check(
        "inserted requirement extends the anchor's stem group",
        md !== null && md.includes("TRANS_Parking_003"),
        md === null ? "no edit with TRANS_Parking_003" : md.slice(0, 200),
      ) && ok;
      ok = check(
        "inserted status is italic by default ([*Draft*])",
        md !== null && md.includes("TRANS_Parking_003 [*Draft*]"),
        md === null ? "no md" : md.slice(0, 300),
      ) && ok;
    }
    await page.close();
  }

  {
    // Scenario 16 (regression, user report 2026-08-30): inserting a new
    // requirement with the cursor in a LATER section that has no
    // requirements must insert at the cursor's section — not jump back to
    // the previous section's last requirement.
    const SECDOC = [
      "# 1. Parking",
      "",
      "## TRANS_Parking_001 The transmission shall engage park",
      "",
      "Parking body.",
      "",
      "# 3. Diagnostics",
      "",
      "Section three body paragraph.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, SECDOC, {
      requirementPattern: { mode: "regex", source: "(TRANS_[A-Za-z0-9]+_\\d{3})", flags: "" },
    });
    // Cursor into the section-three paragraph, then new line + slash insert.
    await page.evaluate(() => {
      const e = window.__mdreqEditor;
      let pos = -1;
      e.state.doc.descendants((node, p) => {
        if (node.isText && node.text.includes("Section three body")) pos = p + node.nodeSize;
      });
      e.chain().focus().setTextSelection(pos).run();
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type("/req", { delay: 30 });
    await page.waitForFunction(
      () => [...document.querySelectorAll("[role=option]")].some((el) => el.textContent.includes("New Requirement")),
      null,
      { timeout: 5000 },
    ).catch(() => {});
    await page.keyboard.press("Enter");
    const md = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && e.markdown.includes("TRANS_Parking_002") ? true : undefined;
        },
        null,
        { timeout: 6000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    const inSectionThree =
      md !== null &&
      md.includes("Section three body paragraph.\n\n## TRANS_Parking_002");
    ok = check(
      "new requirement lands in the cursor's section, not an earlier one",
      inSectionThree,
      md === null ? "no insert observed" : md.slice(0, 400),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 17: resizable side panels + relocated dashboard button.
    const page = await openEditor(browser, port, "# T\n\nBody.\n\n## REQ_001 Something [draft]\n\nB.\n");
    const before = await page.evaluate(
      () => document.querySelector("#outline-panel").getBoundingClientRect().width,
    );
    const handle = page.locator(".cursor-col-resize").first();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + 1, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 121, box.y + 200, { steps: 5 });
    await page.mouse.up();
    const after = await page.evaluate(
      () => document.querySelector("#outline-panel").getBoundingClientRect().width,
    );
    ok = check(
      "outline panel resizes by dragging its handle",
      after > before + 100,
      `before=${before} after=${after}`,
    ) && ok;

    // Lowercase status resolves (case-insensitive): badge chip shows DRAFT.
    const chipDraft = await page.evaluate(() =>
      /draft/i.test(
        [...document.querySelectorAll(".ProseMirror h2 button, .ProseMirror h2 span")]
          .map((e) => e.textContent)
          .join(" "),
      ),
    );
    ok = check("lowercase [draft] resolves to the Draft status chip", chipDraft, "no chip") && ok;

    // Dashboard button lives bottom-right — clear of the drawer close and find bar.
    const btnBox = await page.evaluate(() => {
      const b = document.querySelector("#open-dashboard").getBoundingClientRect();
      return { top: b.top, vh: window.innerHeight };
    });
    ok = check(
      "dashboard button sits in the bottom half of the viewport",
      btnBox.top > btnBox.vh / 2,
      JSON.stringify(btnBox),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 18 (regression, user report 2026-09-01): pressing Enter at a
    // soft-wrap boundary and typing must produce exactly ONE paragraph break
    // — no phantom blank line above the new line.
    const WDOC = "aaa first line\nbbb second line\nccc third line\n";
    const page = await openEditor(browser, port, WDOC);
    // Place the caret via the editor API (PM-state selection — DOM ranges
    // race PM's selection sync; see scenario 16).
    await page.evaluate(() => {
      const e = window.__mdreqEditor;
      let pos = -1;
      e.state.doc.descendants((node, p) => {
        if (node.isText && node.text.includes("aaa first line")) pos = p + node.nodeSize;
      });
      e.chain().focus().setTextSelection(pos).run();
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type("xxx new text", { delay: 20 });
    const md = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && e.markdown.includes("xxx new text") ? true : undefined;
        },
        null,
        { timeout: 6000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    ok = check(
      "Enter at a soft-wrap inserts one line (line mode, no phantom line)",
      md === "aaa first line\nxxx new text\nbbb second line\nccc third line\n",
      JSON.stringify(md),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 19 (regression, user report 2026-09-01): after a slash-insert
    // the caret sits before " [Draft]". Pressing Enter there must NOT split
    // the heading (which dragged the status into the body text) — it opens a
    // paragraph below, and typed text lands there.
    const HDOC = [
      "### TRANS_feat_010 Existing requirement [*Draft*]",
      "",
      "Existing body.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, HDOC, {
      requirementPattern: { mode: "regex", source: "(TRANS_[A-Za-z0-9]+_\\d{3})", flags: "" },
    });
    // Caret mid-heading: right after the ID (before " Existing requirement").
    await page.evaluate(() => {
      const e = window.__mdreqEditor;
      let pos = -1;
      e.state.doc.descendants((node, p) => {
        if (node.isText && node.text.includes("TRANS_feat_010")) {
          pos = p + node.text.indexOf("TRANS_feat_010") + "TRANS_feat_010".length;
        }
      });
      e.chain().focus().setTextSelection(pos).run();
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type("some text", { delay: 20 });
    const md = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && e.markdown.includes("some text") ? true : undefined;
        },
        null,
        { timeout: 6000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    ok = check(
      "Enter in a heading opens a paragraph below — heading stays intact",
      md === "### TRANS_feat_010 Existing requirement [*Draft*]\n\nsome text\n\nExisting body.\n",
      JSON.stringify(md),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 20 (design change, user request 2026-09-01): Enter = one
    // newline in the file; double-Enter = paragraph break. Replays the
    // user's exact case (hgfhjhg. / line2).
    const page = await openEditor(browser, port, "hgfhjhg.\n");
    await page.evaluate(() => {
      const e = window.__mdreqEditor;
      let pos = -1;
      e.state.doc.descendants((n, p) => {
        if (n.isText && n.text.includes("hgfhjhg.")) pos = p + n.nodeSize;
      });
      e.chain().focus().setTextSelection(pos).run();
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type("line2", { delay: 20 });
    let md = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && e.markdown.includes("line2") ? true : undefined;
        },
        null,
        { timeout: 6000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    ok = check(
      "Enter writes exactly one newline (no blank line)",
      md === "hgfhjhg.\nline2\n",
      JSON.stringify(md),
    ) && ok;

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("para2", { delay: 20 });
    md = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && e.markdown.includes("para2") ? true : undefined;
        },
        null,
        { timeout: 6000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    if (md !== "hgfhjhg.\nline2\n\npara2\n") {
      console.error("      all edits:", await page.evaluate(() => JSON.stringify(window.__messages.filter((m) => m.type === "edit").map((m) => m.markdown))));
    }
    ok = check(
      "double Enter makes a paragraph break (blank line)",
      md === "hgfhjhg.\nline2\n\npara2\n",
      JSON.stringify(md),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 21 (regression, user report 2026-09-01): the full sequence —
    // heading, Enter, "line2", Enter at line2's start (push down), slash-
    // insert a requirement on the freed line. The heading must be standalone
    // (no swallowed text, no newline inside it, no &#xA;, no repeated
    // [Draft]), with line2 intact below.
    const SDOC2 = "### TRANS_feat_012 [*Draft*]\n\nline2\n";
    const page = await openEditor(browser, port, SDOC2, {
      requirementPattern: { mode: "regex", source: "(TRANS_[A-Za-z0-9]+_\\d{3})", flags: "" },
    });
    // Caret at the START of "line2"
    await page.evaluate(() => {
      const e = window.__mdreqEditor;
      let pos = -1;
      e.state.doc.descendants((n, p) => {
        if (n.isText && n.text.includes("line2")) pos = p + n.text.indexOf("line2");
      });
      e.chain().focus().setTextSelection(pos).run();
    });
    await page.keyboard.press("Enter"); // push line2 down; caret on empty line
    await page.keyboard.type("/req", { delay: 30 });
    await page
      .waitForFunction(
        () => [...document.querySelectorAll("[role=option]")].some((el) => el.textContent.includes("New Requirement")),
        null,
        { timeout: 5000 },
      )
      .catch(() => {});
    await page.keyboard.press("Enter");
    const md = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && e.markdown.includes("TRANS_feat_013") ? true : undefined;
        },
        null,
        { timeout: 8000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    const draftCount = md === null ? 0 : (md.match(/\[\*Draft\*\]/g) ?? []).length;
    ok = check(
      "slash-insert before existing text yields a standalone heading",
      md !== null &&
        md.includes("### TRANS_feat_013 [*Draft*]\n\nline2") &&
        !md.includes("&#xA;") &&
        draftCount === 2,
      JSON.stringify({ md, draftCount }),
    ) && ok;

    // Give the auto-inserter time to run amok if it were going to.
    await page.waitForTimeout(1200);
    const finalDrafts = await page.evaluate(
      () => (window.__mdreqEditor.state.doc.textContent.match(/\[Draft\]/g) ?? []).length,
    );
    ok = check(
      "no runaway [Draft] repetition",
      finalDrafts === 2,
      `found ${finalDrafts} [Draft] occurrences`,
    ) && ok;
    await page.close();
  }

  {
    // Scenario 22 (user report, 2026-09-01): inserting an item in an ordered
    // list must renumber the FILE's markers ("1. 2. 2. 4. 5." bug). The
    // all-ones convention survives edits as all-ones.
    // A paragraph separates the lists: same-delimiter lists across a bare
    // blank line are ONE loose list per CommonMark.
    const LDOC = "1. alpha\n2. beta\n3. gamma\n\nseparator paragraph\n\n1. one\n1. one again\n1. once more\n";
    const page = await openEditor(browser, port, LDOC);
    await page.evaluate(() => {
      const e = window.__mdreqEditor;
      let pos = -1;
      e.state.doc.descendants((n, p) => {
        if (n.isText && n.text.includes("alpha")) pos = p + n.nodeSize;
      });
      e.chain().focus().setTextSelection(pos).run();
    });
    await page.keyboard.press("Enter"); // new list item after alpha
    await page.keyboard.type("inserted", { delay: 20 });
    const md = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && e.markdown.includes("inserted") ? true : undefined;
        },
        null,
        { timeout: 6000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    ok = check(
      "inserting a list item renumbers the file's markers",
      md !== null && md.includes("1. alpha\n2. inserted\n3. beta\n4. gamma"),
      JSON.stringify(md),
    ) && ok;
    ok = check(
      "untouched all-ones list keeps its style",
      md !== null && md.includes("1. one\n1. one again\n1. once more"),
      JSON.stringify(md),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 23 (user report, 2026-09-01): deleting a mid-list item's text
    // and backspacing it out of the list splits the list — the tail must
    // renumber from 1 in the FILE, not keep its stale source values
    // ("1." followed by "3) 4) 5)").
    const LDOC = "1. canonical ordered list\n2. ghgj\n3. tyui\n4. qwert\n5. try pressing Enter\n";
    const page = await openEditor(browser, port, LDOC);
    await page.evaluate(() => {
      const e = window.__mdreqEditor;
      let from = -1;
      let to = -1;
      e.state.doc.descendants((n, p) => {
        if (n.isText && n.text === "ghgj") {
          from = p;
          to = p + n.nodeSize;
        }
      });
      e.chain().focus().setTextSelection({ from, to }).run();
    });
    await page.keyboard.press("Backspace"); // clear the item's text
    await page.keyboard.press("Backspace"); // lift the empty item out of the list
    const md = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && !e.markdown.includes("ghgj") && !e.markdown.includes("2.") ? true : undefined;
        },
        null,
        { timeout: 6000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    ok = check(
      "deleting a mid-list item renumbers the split-off tail from 1",
      md !== null && md.includes("1. canonical ordered list") && md.includes("1) tyui\n2) qwert\n3) try pressing Enter"),
      JSON.stringify(md),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 24 (variant feature, design D10–D13): a heading with
    // "[*Draft*] [V2]" renders a status chip AND a variant chip; changing
    // the status via the dropdown rewrites ONLY the status bracket in the
    // file — the variant survives byte-exact. A pre-variant heading in the
    // same doc keeps its exact bytes.
    const VDOC = [
      "# Doc",
      "",
      "### TRANS_feat_001 Login flow [*Draft*] [V2]",
      "",
      "Body one.",
      "",
      "### TRANS_feat_002 Old style [*Draft*]",
      "",
      "Body two.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, VDOC, {
      requirementPattern: { mode: "regex", source: "(TRANS_[A-Za-z0-9]+_\\d{3})", flags: "" },
    });
    await page.waitForSelector(".req-variant-btn", { timeout: 6000 }).catch(() => {});
    const chips = await page.evaluate(() => ({
      variant: [...document.querySelectorAll(".req-variant-btn")].map((b) => b.textContent),
      statuses: [...document.querySelectorAll(".req-status-btn")].length,
    }));
    ok = check(
      "variant chip renders with the variant text",
      chips.variant.includes("V2"),
      JSON.stringify(chips),
    ) && ok;

    // Change TRANS_feat_001's status Draft → Approved via the dropdown.
    await page.evaluate(() => {
      const h = [...document.querySelectorAll(".ProseMirror h3")].find((el) =>
        el.textContent.includes("TRANS_feat_001"),
      );
      const btn = h.querySelector(".req-status-btn");
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    await page.waitForSelector(".req-status-menu:not([style*='none']) .req-status-option");
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll(".req-status-option")].find(
        (el) => el.textContent === "Approved",
      );
      opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    const md = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && e.markdown.includes("Approved") ? true : undefined;
        },
        null,
        { timeout: 6000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    ok = check(
      "status change rewrites only the status — variant survives byte-exact",
      md !== null && md.includes("### TRANS_feat_001 Login flow [*Approved*] [V2]"),
      JSON.stringify(md),
    ) && ok;
    ok = check(
      "pre-variant heading in the same doc keeps its exact bytes",
      md !== null && md.includes("### TRANS_feat_002 Old style [*Draft*]"),
      JSON.stringify(md),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 25 (user request, 2026-09-02): variant inheritance. In a doc
    // whose requirements use exactly one variant, "/" -> New Requirement
    // produces a heading that already carries that variant. In a doc with
    // TWO variants nothing is guessed, and the "+ Variant" ghost chip opens
    // a menu listing both document variants plus "New variant…".
    const IDOC = [
      "## TRANS_Park_001 Engage [*Draft*] [V2]",
      "",
      "Body of the requirement.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, IDOC, {
      requirementPattern: { mode: "regex", source: "(TRANS_[A-Za-z0-9]+_\\d{3})", flags: "" },
    });
    await page.evaluate(() => {
      const e = window.__mdreqEditor;
      e.chain().focus().setTextSelection(e.state.doc.content.size - 1).run();
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type("/req", { delay: 30 });
    await page.waitForFunction(
      () => [...document.querySelectorAll("[role=option]")].some((el) => el.textContent.includes("New Requirement")),
      null,
      { timeout: 5000 },
    );
    await page.keyboard.press("Enter");
    const md = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && e.markdown.includes("TRANS_Park_002") ? true : undefined;
        },
        null,
        { timeout: 6000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    ok = check(
      "slash-inserted requirement inherits the document's single variant",
      md !== null && md.includes("TRANS_Park_002 [*Draft*] [V2]"),
      JSON.stringify(md),
    ) && ok;
    await page.close();
  }

  {
    // Scenario 25b: two variants in use -> no inheritance; the ghost
    // "+ Variant" menu lists both document variants and "New variant…".
    const MDOC = [
      "## TRANS_Park_001 One [*Draft*] [V1]",
      "",
      "## TRANS_Park_002 Two [*Draft*] [V2]",
      "",
      "## TRANS_Park_003 Three [*Draft*]",
      "",
      "Body.",
      "",
    ].join("\n");
    const page = await openEditor(browser, port, MDOC, {
      requirementPattern: { mode: "regex", source: "(TRANS_[A-Za-z0-9]+_\\d{3})", flags: "" },
    });
    await page.waitForSelector(".req-variant-btn--add", { timeout: 6000 });
    await page.evaluate(() => {
      const h = [...document.querySelectorAll(".ProseMirror h2")].find((el) =>
        el.textContent.includes("TRANS_Park_003"),
      );
      h.querySelector(".req-variant-btn--add").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    const menu = await page
      .waitForFunction(
        () => {
          const opts = [...document.querySelectorAll(".req-variant-widget .req-status-option")].map(
            (o) => o.textContent,
          );
          return opts.length > 0 ? opts : undefined;
        },
        null,
        { timeout: 5000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => null);
    ok = check(
      "ghost + Variant menu lists both document variants and New variant…",
      menu !== null && menu.includes("V1") && menu.includes("V2") && menu.some((t) => t.includes("New variant")),
      JSON.stringify(menu),
    ) && ok;
    // Pick V1 from the menu -> the heading gains [V1] in the file.
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll(".req-variant-widget .req-status-option")].find(
        (o) => o.textContent === "V1",
      );
      opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    const md2 = await page
      .waitForFunction(
        () => {
          const e = window.__messages.filter((m) => m.type === "edit").pop();
          return e && e.markdown.includes("TRANS_Park_003 Three [*Draft*] [V1]") ? true : undefined;
        },
        null,
        { timeout: 6000 },
      )
      .then(() => page.evaluate(() => window.__messages.filter((m) => m.type === "edit").pop().markdown))
      .catch(() => null);
    ok = check(
      "picking a variant from the ghost menu writes it to the file",
      md2 !== null && md2.includes("## TRANS_Park_003 Three [*Draft*] [V1]"),
      JSON.stringify(md2),
    ) && ok;
    await page.close();
  }

  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
})();
