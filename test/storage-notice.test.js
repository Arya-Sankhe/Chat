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

test("chat HTML has a storage notice and does not load Google Fonts or jsDelivr on first paint", () => {
  const head = headOf(html);
  assert.doesNotMatch(head, /fonts\.googleapis\.com|fonts\.gstatic\.com|jsdelivr\.net/);
  assert.match(head, /src="\/vendor\/dompurify\/purify\.min\.js"/);
  assert.match(html, /id="storageNotice"/);
  assert.match(html, /We store settings on this device\./);
  assert.match(html, /id="storageNoticeOk"/);
  assert.doesNotMatch(html, /document\.cookie/);
});

test("settings persist only after the storage notice, and Google Fonts load then", () => {
  assert.match(app, /const STORAGE_NOTICE_KEY = "klui\.storage-notice\.v1"/);
  assert.match(app, /function storageNoticeAccepted\(\)/);
  assert.match(app, /if \(isNative\(\)\) return true;/);
  assert.match(app, /function saveSettings\(\) \{\s*if \(!storageNoticeAccepted\(\)\) return;/);
  assert.match(app, /if \(hadLegacyTheme && storageNoticeAccepted\(\)\) localStorage\.setItem\(SETTINGS_KEY, JSON\.stringify\(loaded\)\)/);
  assert.match(app, /function loadGoogleFonts\(\)/);
  assert.match(app, /Shantell\+Sans/);
  assert.match(app, /initStorageNotice\(\)/);
  assert.doesNotMatch(app, /document\.cookie/);
});

test("DOMPurify is vendored first-party for the mobile copy step", () => {
  assert.match(purify, /DOMPurify 3\.3\.1/);
  assert.match(copyStatic, /"vendor"/);
});
