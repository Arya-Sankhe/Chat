import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { protectCurrencyDollars } from "../public/js/documentEditor.js";
import { escapeHtml } from "../public/js/render.js";

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
  assert.match(styles, /body\.document-viewer-fullscreen \.app-shell\s*\{\s*visibility:\s*hidden/);
  assert.match(styles, /body\.document-viewer-fullscreen \.document-viewer\s*\{[\s\S]*?inset:\s*0;/);
});

test("document viewer closes after its animation without waiting for the server save", async () => {
  const viewer = await readFile(new URL("../public/js/documentViewer.js", import.meta.url), "utf8");
  const close = viewer.match(/async function closeDocumentViewer\(event\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(close, /saveEditorNow\(\)/);
  assert.match(close, /await exitAnimation/);
  assert.doesNotMatch(close, /await .*save/);
});

test("preview refresh cannot detach an editable document or its pending edits", async () => {
  class Element {
    constructor() {
      this.dataset = {};
      this.innerHTML = "";
      this.children = new Map();
      this.listeners = {};
      this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    }
    querySelector(key) {
      if (!this.children.has(key)) this.children.set(key, new Element());
      return this.children.get(key);
    }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    setAttribute() {} toggleAttribute() {} before() {} after() {}
  }
  let toolbar, onChange, mounts = 0, destroys = 0, fetches = 0;
  const source = await readFile(new URL("../public/js/documentViewer.js", import.meta.url), "utf8");
  const factory = runInNewContext(source.replace(/^import .*\n/, "").replace("export function", "function") + "\ncreateDocumentViewer", {
    document: {
      createElement: () => (toolbar = new Element()), createComment: () => new Element(),
      body: new Element(), addEventListener() {}
    },
    setTimeout: () => 0, clearTimeout() {},
    mountDocumentEditor: async options => {
      mounts++;
      onChange = options.onChange;
      options.container.innerHTML = "Mounted editor";
      return { destroy() { destroys++; } };
    }
  });
  const elements = Object.fromEntries(["documentViewer", "documentViewerBody", "documentViewerTitle", "documentViewerMeta", "documentViewerDownload", "documentViewerDownloadMenu", "documentViewerFullscreen"].map(key => [key, new Element()]));
  const state = { session: { access_token: "stub" }, viewer: { open: true, attachmentId: "doc-1", kind: "editable", markdown: "Original", revision: 1 } };
  const viewer = factory({ elements, state, escapeHtml, fetchAttachmentView: async () => { fetches++; return { kind: "pdf", markdown: "Preview" }; } });
  viewer.renderDocumentViewer();
  await new Promise(resolve => setImmediate(resolve));
  onChange("Unsaved edits");
  const refresh = toolbar.querySelector("[data-preview-refresh]");
  assert.equal(refresh.hidden, true);
  const clickRefresh = () => toolbar.listeners.click({ target: { closest: selector => selector === "[data-preview-refresh]" ? refresh : null } });
  clickRefresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 0);
  assert.equal(mounts, 1);
  assert.equal(destroys, 0);
  assert.equal(elements.documentViewerBody.innerHTML, "Mounted editor");
  assert.match(elements.documentViewerMeta.textContent, /UNSAVED/);

  viewer.setDocumentViewerState({ kind: "pdf" });
  assert.equal(refresh.hidden, false);
  clickRefresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 1, "non-editable previews can still refresh");
  assert.equal(state.viewer.loading, false);
  viewer.setDocumentViewerState({ kind: "text", markdown: '<script>alert("untrusted")</script>', sourceUrl: "javascript:alert(1)" });
  assert.match(elements.documentViewerBody.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(elements.documentViewerBody.innerHTML, /<script>|href=/);
  viewer.setDocumentViewerState({ sourceUrl: "https://example.com/article" });
  assert.match(elements.documentViewerBody.innerHTML, /rel="noopener noreferrer"/);
});
