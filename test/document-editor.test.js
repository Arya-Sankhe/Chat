import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
