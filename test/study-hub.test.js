import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

test("practice decks are openable and have rename/delete menus", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const api = readFileSync(resolve(publicDir, "js/api.js"), "utf8");
  const html = readFileSync(resolve(publicDir, "index.html"), "utf8");
  assert.match(hub, /data-open-deck=/);
  assert.match(hub, /data-toggle-deck-menu=/);
  assert.match(hub, /data-rename-deck=/);
  assert.match(hub, /data-delete-deck=/);
  assert.match(hub, /function startReview\(deck\)/);
  assert.match(hub, /openTitleRename/);
  assert.match(hub, /updateStudyDeck/);
  assert.match(hub, /deleteStudyDeck/);
  assert.match(api, /\/api\/study\/courses\/\$\{encodeURIComponent\(courseId\)\}\/decks/);
  assert.doesNotMatch(html, /id="deckRenameDialog"/);
  assert.match(html, /id="renameDialog"/);
});

test("study note overlay has copy and document-style download menu", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const html = readFileSync(resolve(publicDir, "index.html"), "utf8");
  const api = readFileSync(resolve(publicDir, "js/api.js"), "utf8");
  assert.match(html, /id="studyNoteCopy"/);
  assert.match(html, /id="studyNoteDownload"/);
  assert.match(html, /data-study-note-export="pdf"/);
  assert.match(html, /data-study-note-export="docx"/);
  assert.match(html, /data-study-note-export="md"/);
  assert.match(hub, /function copyNote\(/);
  assert.match(hub, /flashCopySuccess\(els\.studyNoteCopy\)/);
  assert.doesNotMatch(hub, /showToast\("Copied"\)/);
  assert.match(hub, /function exportNote\(/);
  assert.match(hub, /setNoteDownloadBusy\(true\)/);
  assert.match(hub, /format === "md"/);
  assert.match(api, /\/api\/study\/notes\/\$\{encodeURIComponent\(noteId\)\}\/export/);
});

test("review session uses tick/x controls and a three-item set menu", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const api = readFileSync(resolve(publicDir, "js/api.js"), "utf8");
  assert.match(hub, /data-study-nav=/);
  assert.match(hub, /data-study-grade="1"/);
  assert.match(hub, /data-study-grade="3"/);
  assert.match(hub, /data-review-restart/);
  assert.match(hub, /data-review-shuffle/);
  assert.match(hub, /data-review-delete/);
  assert.match(hub, /deleteStudyCard/);
  assert.match(hub, /function playGradeAnim\(/);
  assert.match(hub, /classList.add\(value === 3 \? "is-got" : "is-miss"\)/);
  assert.doesNotMatch(hub, /data-study-grade="2"/);
  assert.doesNotMatch(hub, /data-study-grade="4"/);
  assert.doesNotMatch(hub, /Download set/);
  assert.doesNotMatch(hub, /Add new flashcard/);
  assert.doesNotMatch(hub, /Edit flashcard/);
  assert.match(api, /\/api\/study\/cards\/\$\{encodeURIComponent\(cardId\)\}/);
});

test("materials flashcard and quiz buttons open count menus", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  assert.match(hub, /countMenu\("flashcards", "Flashcards", \[10, 20, 30\]\)/);
  assert.match(hub, /countMenu\("quiz", "Quiz", \[10, 15, 25\]\)/);
  assert.match(hub, /type === "quiz" \|\| type === "flashcards"/);
  assert.doesNotMatch(hub, /data-count="5"/);
  assert.match(generate, /clampPick\(count, \[10, 20, 30\]\)/);
  assert.match(generate, /clampPick\(count, \[10, 15, 25\]\)/);
  assert.doesNotMatch(generate, /flashcardTargetCount/);
});
