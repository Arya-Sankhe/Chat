import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { protectCurrencyDollars } from "../public/js/documentEditor.js";

test("document editor exposes formatting, table, math, save, and export paths", async () => {
  const [editor, viewer, routes] = await Promise.all([
    readFile(new URL("../public/js/documentEditor.js", import.meta.url), "utf8"),
    readFile(new URL("../public/js/documentViewer.js", import.meta.url), "utf8"),
    readFile(new URL("../server/routes.js", import.meta.url), "utf8")
  ]);
  for (const command of ["undo", "redo", "toggleBold", "insertTable", "addColumnBefore", "addRowAfter", "deleteTable", "insertBlockMath"]) {
    assert.match(editor, new RegExp(command));
  }
  assert.match(viewer, /saveEditableDocument/);
  assert.match(viewer, /exportEditableDocument/);
  assert.match(routes, /parts\[3\] === "editor"/);
});

test("document editor uses inline floating controls instead of browser dialogs", async () => {
  const editor = await readFile(new URL("../public/js/documentEditor.js", import.meta.url), "utf8");
  assert.match(editor, /data-table-toolbar/);
  assert.match(editor, /data-formula-popover/);
  assert.match(editor, /closest\("td, th"\)/);
  assert.doesNotMatch(editor, /window\.prompt|\bprompt\(/);
});

test("document editor keeps currency ranges editable instead of parsing them as math", () => {
  assert.equal(protectCurrencyDollars("Costs $7 to $10 and $3,500 to $5,000."), "Costs \\$7 to \\$10 and \\$3,500 to \\$5,000.");
  assert.equal(protectCurrencyDollars("Keep $x^2$ as math."), "Keep $x^2$ as math.");
});

test("editable viewer supports fullscreen and closes its export menu outside", async () => {
  const [html, viewer, styles] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/js/documentViewer.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles/chat-panel-topbar.css", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="documentViewerFullscreen"/);
  assert.ok(html.indexOf('data-document-export="pdf"') < html.indexOf('data-document-export="docx"'));
  assert.ok(html.indexOf('data-document-export="docx"') < html.indexOf('data-document-export="md"'));
  assert.match(viewer, /document\.addEventListener\("pointerdown"/);
  assert.match(viewer, /document-viewer-fullscreen/);
  assert.match(viewer, /prefers-reduced-motion/);
  assert.match(viewer, /function animateViewer\(opening\)/);
  assert.match(viewer, /opening \? 220 : 160/);
  assert.match(styles, /inset:\s*0 0 0 var\(--sidebar-active-w\)/);
});
