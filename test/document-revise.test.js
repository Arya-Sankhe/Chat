import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readPublic(rel) {
  return readFile(new URL(`../public/${rel}`, import.meta.url), "utf8");
}

test("document editor ships ask-for-changes revise pill with shimmer loading", async () => {
  const editor = await readPublic("js/documentEditor.js");
  const viewer = await readPublic("js/documentViewer.js");
  const api = await readPublic("js/api.js");
  const css = await readPublic("styles/chat-panel-topbar.css");

  assert.match(editor, /Ask for changes/);
  assert.match(editor, /Describe changes/);
  assert.match(editor, /doc-revise-pending/);
  assert.match(editor, /ignoreOutsideClickOnce/);
  assert.match(editor, /reviseInput\.value\.trim\(\)/);
  assert.match(editor, /reviseInput\.disabled = false/);
  assert.match(editor, /never block/);
  assert.match(editor, /reviseInput\.focus\(\)/);
  assert.match(editor, /shell\.addEventListener\("pointerup"/);
  assert.match(viewer, /reviseEditableDocument/);
  assert.match(api, /\/editor\/revise/);
  assert.match(css, /\.document-revise-pill/);
  assert.match(css, /doc-revise-shimmer/);
  assert.match(css, /prefers-reduced-motion/);
});
