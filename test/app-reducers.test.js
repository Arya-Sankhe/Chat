import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Phase-0 structural validation of the client stream-reducer fixtures.
 *
 * IMPORTANT: this file is NOT behavioral coverage of the reducers.
 * `public/js/app.js` runs DOM side effects at module top level, so the
 * reducers cannot be imported and replayed today. This suite only
 * (a) validates the fixture file's structure so it cannot rot silently,
 * and (b) confirms the five reducer functions still exist in app.js at
 * their expected names, so a rename cannot orphan the fixtures.
 *
 * Phase 3 extracts the reducers into an importable module and replays
 * every fixture as a real unit test (see the fixture file's description
 * for the replay protocol).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "stream-reducer-fixtures.json");
const appJsPath = path.join(here, "..", "public", "js", "app.js");

const REDUCERS = [
  "applyStreamEvent",
  "applyToolEvent",
  "applyCompareStreamEvent",
  "applyCouncilStreamEvent",
  "ensureToolState"
];

test("reducer fixture file is well-formed and replayable", () => {
  const doc = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

  assert.equal(typeof doc.description, "string");
  assert.ok(Array.isArray(doc.ignoreFields) && doc.ignoreFields.length, "volatile fields are declared");
  assert.ok(Array.isArray(doc.fixtures) && doc.fixtures.length >= 8, "fixture set is non-trivial");

  const names = new Set();
  for (const fixture of doc.fixtures) {
    assert.equal(typeof fixture.name, "string", "fixture has a name");
    assert.ok(!names.has(fixture.name), `fixture name is unique: ${fixture.name}`);
    names.add(fixture.name);
    assert.ok(REDUCERS.includes(fixture.reducer), `${fixture.name}: reducer '${fixture.reducer}' is one of the five`);
    assert.equal(typeof fixture.initial, "object", `${fixture.name}: has an initial state`);
    assert.ok(Array.isArray(fixture.events) && fixture.events.length, `${fixture.name}: has input events`);
    assert.equal(typeof fixture.expected, "object", `${fixture.name}: has an expected state`);
    /* Expected states must never contain volatile timestamp fields. */
    const serialized = JSON.stringify(fixture.expected);
    for (const field of doc.ignoreFields) {
      assert.ok(!serialized.includes(`"${field}"`), `${fixture.name}: expected state omits volatile '${field}'`);
    }
  }
});

test("the five stream reducers still exist in app.js under their fixture names", () => {
  const source = fs.readFileSync(appJsPath, "utf8");
  for (const reducer of REDUCERS) {
    assert.ok(
      source.includes(`function ${reducer}(`),
      `public/js/app.js defines ${reducer} — if it moved or was renamed, update test/fixtures/stream-reducer-fixtures.json`
    );
  }
});
