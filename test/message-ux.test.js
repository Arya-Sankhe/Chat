import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { readStylesheet } from "./helpers/styles.js";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

function readPublic(path) {
  return readFileSync(resolve(publicDir, path), "utf8");
}

test("user message footer always offers copy; edit stays gated behind canEditUserMessage", () => {
  const appJs = readPublic("js/app.js");
  const footer = appJs.match(/function renderUserMessageFooter\(msg\)\s*\{[\s\S]*?\n\}/);
  assert.ok(footer, "renderUserMessageFooter not found");
  assert.doesNotMatch(
    footer[0],
    /if\s*\(\s*!canEditUserMessage\(msg\)\s*\)\s*return\s*""/,
    "copy must not be gated behind canEditUserMessage"
  );
  assert.match(footer[0], /messageCopyButton\(msg,\s*\{\s*iconOnly:\s*true\s*\}\)/);
  assert.match(footer[0], /canEditUserMessage\(msg\)/);
  assert.match(footer[0], /if\s*\(\s*!copy\s*&&\s*!edit\s*\)\s*return\s*""/);
});

test("flashCopySuccess swaps the button SVG to a checkmark on success", () => {
  const appJs = readPublic("js/app.js");
  const flash = appJs.match(/function flashCopySuccess\(btn\)\s*\{[\s\S]*?\n\}/);
  assert.ok(flash, "flashCopySuccess not found");
  assert.match(flash[0], /btn\._copyIconHtml\s*\|\|=\s*icon\.outerHTML/);
  assert.match(flash[0], /M20 6L9 17l-5-5/);
  assert.match(flash[0], /current\.outerHTML\s*=\s*btn\._copyIconHtml/);
});

test("thinking status is block-level and omitted once answer text exists", () => {
  const appJs = readPublic("js/app.js");
  const css = readStylesheet();
  const render = appJs.match(/function renderThinkingStatus\(message[\s\S]*?\n\}/);
  assert.ok(render, "renderThinkingStatus not found");
  assert.match(
    render[0],
    /if\s*\(\s*rawTextContent\(message\?\.content\)\.trim\(\)\s*\)\s*return\s*""/,
    "status must return empty once content exists"
  );
  assert.doesNotMatch(appJs, /return\s*"Answering"/);
  assert.match(
    css,
    /\.thinking-status\s*\{[^}]*display:\s*flex/,
    "thinking-status should be display:flex"
  );
  assert.match(css, /\.thinking-status\.is-leaving/);
});

test("message tables are wrapped for horizontal scroll", () => {
  const renderJs = readPublic("js/render.js");
  const css = readStylesheet();
  assert.match(renderJs, /function wrapMessageTables\(/);
  assert.match(renderJs, /class="table-scroll"/);
  assert.match(renderJs, /html\s*=\s*wrapMessageTables\(html\)/);
  assert.match(
    css,
    /\.message-content\s+\.table-scroll\s*\{[^}]*overflow-x:\s*auto/,
    "table-scroll must allow horizontal overflow"
  );
});
