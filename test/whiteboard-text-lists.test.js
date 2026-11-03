import test from "node:test";
import assert from "node:assert/strict";
import { continueList, isList, pastedBlocks, toggleBullets, typedBullet } from "../whiteboard/src/text-lists.js";

test("typing a dash or star at the start of a line makes a bullet, keeping its indent", () => {
  assert.equal(typedBullet("- "), "• ");
  assert.equal(typedBullet("    * "), "    • ");
  assert.equal(typedBullet("a - "), null);
  assert.equal(typedBullet("-- "), null);
});

test("Enter carries a bullet or number on, and an empty item ends the list", () => {
  assert.deepEqual(continueList("• milk", ""), { remove: 0, insert: "\n• " });
  assert.deepEqual(continueList("    • eggs", ""), { remove: 0, insert: "\n    • " });
  assert.deepEqual(continueList("9. step", ""), { remove: 0, insert: "\n10. " });
  assert.deepEqual(continueList("2) step", ""), { remove: 0, insert: "\n3) " });
  assert.deepEqual(continueList("• ", ""), { remove: 2, insert: "" });
  // The caret right after the marker of a filled item splits it rather than ending the list.
  assert.deepEqual(continueList("• ", "milk"), { remove: 0, insert: "\n• " });
  assert.equal(continueList("plain text", ""), null);
});

test("the bullet shortcut adds bullets to the lines, or takes them off when all have one", () => {
  assert.deepEqual(toggleBullets(["a", "", "  b"]), ["• a", "", "  • b"]);
  assert.deepEqual(toggleBullets(["• a", "  1. b"]), ["a", "  b"]);
  assert.deepEqual(toggleBullets(["• a", "b"]), ["• a", "• b"]);
  // The button shows as pressed only when every line with words on it is already a list item.
  assert.equal(isList(["• a", "", "2. b"]), true);
  assert.equal(isList(["• a", "b"]), false);
  assert.equal(isList(["", " "]), false);
});

test("a paste becomes one text box with bullets, split only when it is longer than a box holds", () => {
  assert.deepEqual(pastedBlocks("Title\r\n- one\n  * two\n-not a bullet", 100), ["Title\n• one\n  • two\n-not a bullet"]);
  const paragraphs = ["a".repeat(40), "b".repeat(40), "c".repeat(40)].join("\n\n");
  assert.deepEqual(pastedBlocks(paragraphs, 90), [`${"a".repeat(40)}\n\n${"b".repeat(40)}`, "c".repeat(40)]);
  const long = pastedBlocks("x".repeat(250), 100);
  assert.deepEqual(long.map((block) => block.length), [100, 100, 50]);
});
