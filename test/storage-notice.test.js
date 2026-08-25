import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "public/index.html"), "utf8");
const app = readFileSync(resolve(root, "public/js/app.js"), "utf8");
const copyStatic = readFileSync(resolve(root, "scripts/mobile/copy-static.mjs"), "utf8");
const purify = readFileSync(resolve(root, "public/vendor/dompurify/purify.min.js"), "utf8");

function headOf(documentHtml) {
  const match = documentHtml.match(/<head>([\s\S]*?)<\/head>/i);
  assert.ok(match, "index.html is missing <head>");
  return match[1];
}

test("chat has no redundant storage notice and only loads pinned Markdown on first paint", () => {
  const head = headOf(html);
  assert.doesNotMatch(head, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  const externalScripts = [...head.matchAll(/<script\b[^>]*src="(https?:\/\/[^\"]+)"/gi)].map((match) => match[1]);
  assert.deepEqual(externalScripts, ["https://cdn.jsdelivr.net/npm/marked@18.0.3/lib/marked.umd.js"]);
  assert.match(head, /marked\.umd\.js" integrity="sha384-[^"]+" crossorigin="anonymous"/);
  assert.match(head, /src="\/vendor\/dompurify\/purify\.min\.js"/);
  assert.doesNotMatch(html, /id="storageNotice"|We store settings on this device|id="storageNoticeOk"/);
  assert.doesNotMatch(html, /document\.cookie/);
});

test("functional settings persist directly and Google Fonts load after startup", () => {
  assert.doesNotMatch(app, /STORAGE_NOTICE_KEY|storageNoticeAccepted|initStorageNotice/);
  assert.match(app, /function saveSettings\(\) \{\s*const value = JSON\.stringify\(state\.settings\);/);
  assert.match(app, /if \(hadLegacyTheme\) localStorage\.setItem\(SETTINGS_KEY, JSON\.stringify\(loaded\)\)/);
  assert.match(app, /function loadGoogleFonts\(\)/);
  assert.match(app, /Shantell\+Sans/);
  assert.match(app, /loadGoogleFonts\(\);\s*\n\}/);
  assert.doesNotMatch(app, /document\.cookie/);
});

test("DOMPurify is vendored first-party for the mobile copy step", () => {
  assert.match(purify, /DOMPurify 3\.3\.1/);
  assert.match(copyStatic, /"vendor"/);
});
