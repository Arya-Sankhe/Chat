import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectFlashcardModes,
  flashcardModeAllowed,
  normalizeFlashcardMode,
  normalizeNoteMode,
  noteModeAllowed,
  noteModesFromNotes,
  resolvedFlashcardMode
} from "../server/study/generate.js";

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

test("materials quiz still uses a count menu", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  assert.match(hub, /countMenu\("quiz", "Quiz", \[10, 15, 25\]\)/);
  assert.doesNotMatch(hub, /data-count="5"/);
  assert.match(generate, /clampPick\(count, \[10, 15, 25\]\)/);
  assert.doesNotMatch(generate, /clampPick\(count, \[10, 20, 30\]\)/);
});

test("flashcards use Rapid then Deep, never a fixed count", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  assert.match(hub, /data-mode="rapid"/);
  assert.match(hub, /data-mode="deep"/);
  assert.match(hub, /body\.mode = mode === "deep" \? "deep" : "rapid"/);
  assert.match(hub, /rapidDone \|\| busy \? " disabled"/);
  assert.match(hub, /deepDone \|\| busy \? " disabled"/);
  assert.match(hub, /data-toggle-quiz-menu=/);
  assert.doesNotMatch(hub, /countMenu\("flashcards"/);
  assert.doesNotMatch(hub, /if \(cardMode === "deep"\) return ""/);
  assert.match(generate, /normalizeFlashcardMode/);
  assert.match(generate, /fill-in-the-blank/);
  assert.doesNotMatch(generate, /Produce exactly \$\{cardCount\} cards/);
  assert.equal(normalizeFlashcardMode("Deep"), "deep");
  assert.equal(resolvedFlashcardMode("", true), "rapid");
  assert.equal(resolvedFlashcardMode("", false), "");
  assert.equal(resolvedFlashcardMode("deep", false), "");
  assert.equal(resolvedFlashcardMode("deep", true), "deep");
  assert.equal(flashcardModeAllowed("", "rapid"), true);
  assert.equal(flashcardModeAllowed("rapid", "rapid"), false);
  assert.equal(flashcardModeAllowed("rapid", "deep"), true);
  assert.equal(flashcardModeAllowed("deep", "deep"), false);
  assert.equal(flashcardModeAllowed("deep", "rapid"), false);
  assert.deepEqual(
    collectFlashcardModes({ "doc:doc-2": "deep" }, [
      { document_file_id: "doc-1", note_id: null },
      { document_file_id: "doc-2", note_id: null }
    ]),
    { "doc:doc-1": "rapid", "doc:doc-2": "deep" }
  );
});

test("materials Notes uses Summary and Detailed, each once", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  assert.match(hub, /data-study-generate="notes"/);
  assert.match(hub, /data-mode="summary"/);
  assert.match(hub, /data-mode="detailed"/);
  assert.match(hub, /summaryDone \|\| activeFor\("notes", "summary"\) \? " disabled"/);
  assert.match(hub, /detailedDone \|\| activeFor\("notes", "detailed"\) \? " disabled"/);
  assert.doesNotMatch(hub, /Summarize/);
  assert.match(generate, /kind: "summary"/);
  assert.match(generate, /DETAILED_NOTE_MARK/);
  assert.equal(normalizeNoteMode("Detailed"), "detailed");
  assert.equal(noteModeAllowed({ summary: false, detailed: false }, "summary"), true);
  assert.equal(noteModeAllowed({ summary: true, detailed: false }, "summary"), false);
  assert.equal(noteModeAllowed({ summary: true, detailed: false }, "detailed"), true);
  assert.equal(noteModeAllowed({ summary: true, detailed: true }, "detailed"), false);
  assert.deepEqual(
    noteModesFromNotes([
      { document_file_id: "doc-1", kind: "summary", content: "short" },
      { document_file_id: "doc-1", kind: "summary", content: "<!--klui:detailed-->\nfull" },
      { document_file_id: "doc-2", kind: "summary", content: "other" }
    ], "doc-1"),
    { summary: true, detailed: true }
  );
});

test("materials cards have a delete menu", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const api = readFileSync(resolve(publicDir, "js/api.js"), "utf8");
  assert.match(hub, /data-toggle-material-menu=/);
  assert.match(hub, /data-delete-doc=/);
  assert.match(hub, /data-delete-note=/);
  assert.match(hub, /function confirmDeleteDoc\(/);
  assert.match(hub, /function confirmDeleteNote\(/);
  assert.match(hub, /will stay/);
  assert.match(hub, /deleteStudyMaterial/);
  assert.match(hub, /deleteStudyNote/);
  assert.match(api, /\/api\/study\/courses\/\$\{encodeURIComponent\(courseId\)\}\/materials/);
  assert.match(api, /\/api\/study\/notes\/\$\{encodeURIComponent\(noteId\)\}/);
});

test("quiz recap is a fixed card with review, retake, and lookback", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const css = readFileSync(resolve(publicDir, "styles/study-hub.css"), "utf8");
  assert.match(hub, /phase === "reveal"/);
  assert.match(hub, /data-study-continue/);
  assert.match(hub, /study-quiz-recap/);
  assert.match(hub, /function quizLetter\(/);
  assert.match(hub, /See me after class/);
  assert.match(hub, /Excellent — you did well/);
  assert.match(hub, /Quiz Results/);
  assert.match(hub, /Review Quiz/);
  assert.match(hub, /Retake Quiz/);
  assert.doesNotMatch(hub, /Topics covered/);
  assert.doesNotMatch(hub, /Quiz complete/);
  assert.match(hub, /study-miss-list[\s\S]*data-quiz-recap/);
  assert.match(hub, /data-quiz-lookback/);
  assert.match(css, /Patrick Hand/);
  assert.match(css, /Caveat/);
  assert.match(hub, /data-quiz-retake/);
  assert.match(hub, /function retakeQuiz\(/);
  assert.match(hub, /phase === "lookback"/);
  assert.match(hub, /Add to flashcards/);
  assert.match(hub, /quizId:\s*quizSession\.quiz\.id/);
  assert.match(hub, /function addedQuestionIndexes\(/);
  assert.match(hub, /already \? "Added" : "Add to flashcards"/);
  assert.doesNotMatch(hub, /data-study-next/);
  assert.doesNotMatch(hub, /Keep learning/);
  assert.match(css, /\.study-session-frame\.is-quiz\.is-recap\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.study-quiz-marks\s*\{/);
  assert.match(css, /\.study-choice-why\s*\{/);
});

test("in-memory generation uses POST SSE without durable job polling", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const api = readFileSync(resolve(publicDir, "js/api.js"), "utf8");
  assert.match(api, /export async function generateStudyContent\(session, courseId, body, \{ signal, onEvent \} = \{\}\)/);
  assert.match(api, /readSseStream\(response/);
  assert.match(api, /event\.type === "error"/);
  assert.match(api, /event\.type === "heartbeat"/);
  assert.doesNotMatch(api, /listStudyGenerationJobs/);
  assert.doesNotMatch(api, /fetchStudyGenerationJob/);
  assert.doesNotMatch(api, /\/api\/study\/courses\/\$\{encodeURIComponent\(courseId\)\}\/generations/);
  assert.doesNotMatch(api, /\/api\/study\/generations\/\$\{encodeURIComponent\(jobId\)\}/);
  assert.doesNotMatch(api, /generateStudyContent[\s\S]{0,400}status !== 202/);
  assert.doesNotMatch(hub, /listStudyGenerationJobs/);
  assert.doesNotMatch(hub, /loadGenerations/);
  assert.doesNotMatch(hub, /GEN_POLL_MS/);
  assert.doesNotMatch(hub, /generationJobs/);
  assert.doesNotMatch(hub, /seenJobStatus/);
  assert.doesNotMatch(hub, /ensureGenerationPoll/);
  assert.doesNotMatch(hub, /acceptGenerationJob/);
  assert.doesNotMatch(hub, /localStorage/);
  assert.match(hub, /const generations = new Map\(\)/);
  assert.match(hub, /AbortController/);
  assert.match(hub, /data-cancel-generation=/);
  assert.match(hub, /data-retry-generation=/);
  assert.match(hub, /aria-live="polite"/);
  assert.match(hub, /scaffoldBusyKey/);
  assert.match(hub, /courseGenerationCards\(\)\.length \? `<div class="study-material-list study-generation-list"/);
  assert.match(hub, /activeFor\("flashcards"\)/);
  assert.match(hub, /abortAllGenerations/);
  assert.doesNotMatch(hub, /let generatingKey/);
  assert.doesNotMatch(hub, /EventSource/);
});
