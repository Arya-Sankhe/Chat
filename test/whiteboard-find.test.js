import test from "node:test";
import assert from "node:assert/strict";
import { findMatches } from "../whiteboard/src/find-matches.js";

test("Find measures every exact occurrence with Excalidraw's helper, including wrapped words", () => {
  const element = { id: "note", type: "text", text: "I like\nice", originalText: "I like ice" };
  const calls = [];
  const measure = (el, query, index) => { calls.push([el.id, query, index]); return [{ offsetX: index * 5, offsetY: 0, width: query.length * 5, height: 20 }]; };
  const matches = findMatches([element, { ...element, id: "deleted", isDeleted: true }, { id: "shape", type: "rectangle" }], "i", measure);
  assert.deepEqual(calls.map((call) => call[2]), [0, 3, 7]);
  assert.equal(matches.length, 1);
  assert.ok(matches[0].matchedLines.every((line) => line.width === 5));
  calls.length = 0;
  findMatches([element], "like ice", measure);
  assert.deepEqual(calls, [["note", "like ice", 2]]);
  assert.deepEqual(findMatches([element], " ", measure), []);
});

test("Find treats punctuation literally and highlights complete words", () => {
  const element = { id: "note", type: "text", text: "a.b a+b a.b" };
  const matches = findMatches([element], "a.b", (_el, query, index) => [{ offsetX: index, width: query.length }]);
  assert.deepEqual(matches[0].matchedLines, [{ offsetX: 0, width: 3 }, { offsetX: 8, width: 3 }]);
});
