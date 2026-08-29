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
      const file = path.join(MEDIA, path.basename(req.url));
      if (!fs.existsSync(file)) return void res.writeHead(404).end();
      res.setHeader(
        "content-type",
        file.endsWith(".js") ? "text/javascript" : "text/css",
      );
      res.end(fs.readFileSync(file));
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

async function openEditor(browser, port, markdown) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__messages.some((m) => m.type === "ready"));
  await page.evaluate(
    (md) => window.postMessage({ type: "init", protocol: 1, text: md, version: 1 }, "*"),
    markdown,
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

  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
})();
