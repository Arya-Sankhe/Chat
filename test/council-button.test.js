import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const appJs = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
const listener = appJs.slice(
  appJs.indexOf("  if (els.councilButton) {"),
  appJs.indexOf('  document.addEventListener("click", (e) => {', appJs.indexOf("  if (els.councilButton) {"))
);

function clickCouncil({ activates }) {
  let handler = null;
  const calls = [];
  runInNewContext(listener, {
    els: { councilButton: { addEventListener: (_, fn) => { handler = fn; } } },
    state: { researchMode: false, settings: { compareEnabled: true, compareMode: "compare" } },
    closeActionMenu() {},
    closeModelDropdown() {},
    compareController: { closeCompareDropdown() {}, cancelCompareMode() { calls.push("cancel"); } },
    setResearchMode() {},
    enterCouncilMode() { calls.push("enter"); return activates; },
    homeModesController: { showAnswerModeExplainer() { calls.push("explainer"); }, render() {} }
  });
  handler({ stopPropagation() {} });
  return calls;
}

test("Council explainer opens only when Council actually turns on", () => {
  assert.deepEqual(clickCouncil({ activates: true }), ["enter", "explainer"]);
  // A document blocks Council: the remembered Compare explainer must stay closed.
  assert.deepEqual(clickCouncil({ activates: false }), ["enter"]);
});
