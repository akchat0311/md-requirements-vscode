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
window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__messages.push(JSON.parse(JSON.stringify(m))) });
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
        { type: "init", protocol: 2, text: md, version: 1, config: cfg },
        "*",
      ),
    {
      md: markdown,
      cfg: config ?? { requirementPattern: { mode: "simple", example: "REQ_001" } },
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

  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
})();
