import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
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

test("photo transcript menus generate flashcards and practice tests from the note", async () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const functions = ["materialMenu", "practiceMarkup", "handleViewClick", "runGenerate", "requestKeyFor", "generationMatchesRequest"].map(name => {
    const source = hub.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`))?.[0];
    assert.ok(source, `${name} not found`);
    return source;
  }).join("\n");
  const jobs = [];
  const ctx = {
    state: { session: {}, activeCourseId: "course-1", studyMaterials: {
      documents: [], notes: [{ id: "photo-1", kind: "image_transcript", title: "Handwritten notes" }], flashcardModes: {}
    } },
    els: { studyView: { querySelector: () => null, querySelectorAll: () => [] } },
    generations: new Map(), quizMenuKey: "", pinnedCollection: new Set(), handleStudioClick: () => false,
    collapsedGroups: new Set(), collectionGroupId: type => type, COLLECTION_GROUPS: { notes: "Notes" },
    escapeHtml: String, kebabIcon: () => "", collectionPinMarkup: () => "", collectionPinId: (kind, id) => `${kind}:${id}`,
    isMindMap: () => false, noteKindLabel: () => "Image transcript", icon: () => "", generationCardsMarkup: () => "", render() {},
    startGeneration: job => jobs.push(job), studioItem: () => null, handleAudioCardClick: () => false
  };
  runInNewContext(functions, ctx);
  const markup = ctx.practiceMarkup();
  assert.match(markup, /Handwritten notes/);
  const buttons = [...markup.matchAll(/<button\b[^>]*data-study-generate="[^"]+"[^>]*>/g)].map(match => match[0]);
  assert.equal(buttons.length, 3);
  for (const html of buttons) {
    const attr = name => html.match(new RegExp(`${name}="([^"]*)"`))?.[1];
    const button = { dataset: { studyGenerate: attr("data-study-generate"), genKind: attr("data-gen-kind"), genId: attr("data-gen-id"), mode: attr("data-mode") } };
    await ctx.handleViewClick({ stopPropagation() {}, target: { closest: selector => selector === "[data-study-generate]" ? button : selector === ".study-card-menu-wrap" ? {} : null } });
  }
  assert.deepEqual(jobs.map(job => ({ ...job.body })), [
    { type: "flashcards", noteId: "photo-1", mode: "rapid" },
    { type: "flashcards", noteId: "photo-1", mode: "deep" },
    { type: "quiz", noteId: "photo-1", count: 10 }
  ]);
  ctx.state.studyMaterials.flashcardModes["note:photo-1"] = "rapid";
  assert.match(ctx.materialMenu("note", "photo-1"), /data-mode="rapid" disabled/);
  assert.doesNotMatch(ctx.materialMenu("note", "photo-1"), /data-mode="deep" disabled/);
  ctx.generations.set("job-1", { courseId: "course-1", noteId: "photo-1", type: "flashcards", status: "running" });
  assert.match(ctx.materialMenu("note", "photo-1"), /data-mode="deep" disabled/);
  assert.doesNotMatch(ctx.materialMenu("doc", "doc-1"), /data-gen-kind="note"/);
});

test("duplicate note and photo-transcript decks open the existing deck", async () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const functions = ["existingGeneration", "openExistingGeneration"].map(name =>
    hub.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`))[0]
  ).join("\n");
  const opened = [];
  const documentDeck = { id: "doc:file-1", documentFileId: "file-1" };
  const ctx = {
    state: { activeCourseId: "course-1", studyPractice: { decks: [documentDeck] } },
    generations: new Map(), showToast() {}, studyVisible: () => true,
    loadMaterials: async () => {},
    loadPractice: async () => {
      ctx.state.studyPractice.decks = [documentDeck, { id: "note:photo-1", noteId: "photo-1" }];
    },
    openStudioView: (kind, id) => opened.push({ kind, id })
  };
  runInNewContext(functions, ctx);
  assert.equal(ctx.existingGeneration({ type: "flashcards", documentFileId: "file-1" }).id, documentDeck.id);
  assert.equal(ctx.existingGeneration({ type: "flashcards" }), null);
  for (const noteId of ["note-1", "photo-1"]) {
    if (noteId === "note-1") ctx.state.studyPractice.decks.push({ id: `note:${noteId}`, noteId });
    const job = { id: noteId, courseId: "course-1", type: "flashcards", noteId };
    ctx.generations.set(job.id, job);
    assert.equal(await ctx.openExistingGeneration(job, "Deep deck already created."), true);
    assert.deepEqual(opened.at(-1), { kind: "deck", id: `note:${noteId}` });
    assert.equal(ctx.generations.has(job.id), false);
  }
});

test("practice can create multi-file decks and quizzes", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const html = readFileSync(resolve(publicDir, "index.html"), "utf8");
  const api = readFileSync(resolve(publicDir, "js/api.js"), "utf8");
  const schema = readFileSync(resolve(here, "../supabase/schema.sql"), "utf8");
  const routes = readFileSync(resolve(here, "../server/routes/study.js"), "utf8");
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  assert.match(hub, /data-practice-create=/);
  assert.match(hub, /\["flashcards", "Flashcards"/);
  assert.match(hub, /\["quiz", "Test", "Practice test"\]/);
  assert.match(hub, /function openCreatePicker\(/);
  assert.match(hub, /documentFileIds/);
  assert.match(hub, /CREATE_FILE_CAP = 10/);
  assert.match(html, /id="studyCreateDialog"/);
  assert.match(api, /params\.deckKey/);
  assert.match(schema, /study_cards \([\s\S]*deck_key text/);
  assert.match(schema, /study_quizzes \([\s\S]*deck_key text/);
  assert.match(routes, /source\.documentFiles/);
  assert.match(generate, /function comboDeckKey\(/);
});

test("practice decks are openable and have rename/delete menus", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const api = readFileSync(resolve(publicDir, "js/api.js"), "utf8");
  const html = readFileSync(resolve(publicDir, "index.html"), "utf8");
  const css = readFileSync(resolve(publicDir, "styles/study-hub.css"), "utf8");
  assert.match(hub, /const TABS = \["materials", "chat", "practice"\]/);
  assert.doesNotMatch(hub, /"overview"/);
  assert.match(hub, /data-open-deck/);
  assert.match(hub, /data-toggle-deck-menu=/);
  assert.match(hub, /data-rename-deck=/);
  assert.match(hub, /data-delete-deck=/);
  assert.match(hub, /data-rename-quiz=/);
  assert.match(hub, /data-delete-quiz=/);
  assert.match(hub, /function startReview\(deck, \{ startId = "", only = null, fresh = false \} = \{\}\)/);
  assert.match(hub, /openTitleRename/);
  assert.match(hub, /updateStudyDeck/);
  assert.match(hub, /deleteStudyDeck/);
  assert.match(hub, /updateStudyQuiz/);
  assert.match(hub, /deleteStudyQuiz/);
  assert.match(hub, /await deleteStudyDeck[\s\S]*loadPractice\(true\)/);
  assert.match(hub, /dropPractice\("decks"/);
  assert.match(hub, /classList.add\("is-leaving"\)/);
  assert.match(api, /\/api\/study\/courses\/\$\{encodeURIComponent\(courseId\)\}\/decks/);
  assert.match(api, /export async function updateStudyQuiz/);
  assert.match(api, /export async function deleteStudyQuiz/);
  assert.match(css, /study-card-leave/);
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
  assert.doesNotMatch(hub, /Delete this card from the deck\?/);
  assert.doesNotMatch(hub, /reviewStudyCard/);
  assert.match(hub, /function playGradeAnim\(/);
  assert.match(hub, /classList.add\(value === 3 \? "is-got" : "is-miss"\)/);
  assert.doesNotMatch(hub, /data-study-grade="2"/);
  assert.doesNotMatch(hub, /data-study-grade="4"/);
  assert.doesNotMatch(hub, /Download set/);
  assert.doesNotMatch(hub, /Add new flashcard/);
  assert.match(hub, /data-review-edit/);
  assert.match(hub, /Edit card/);
  assert.match(api, /\/api\/study\/cards\/\$\{encodeURIComponent\(cardId\)\}/);
});

test("review can star cards in the current deck and edit both sides", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const api = readFileSync(resolve(publicDir, "js/api.js"), "utf8");
  const schema = readFileSync(resolve(here, "../supabase/schema.sql"), "utf8");
  const routes = readFileSync(resolve(here, "../server/routes/study.js"), "utf8");
  const css = readFileSync(resolve(publicDir, "styles/study-hub.css"), "utf8");
  assert.match(schema, /starred boolean not null default false/);
  assert.match(routes, /req\.method !== "DELETE" && req\.method !== "PATCH"/);
  assert.match(routes, /patch\.starred = body\.starred/);
  assert.match(api, /method: "PATCH"/);
  assert.match(hub, /data-review-star/);
  assert.match(hub, /data-starred-only/);
  assert.match(hub, /function paintReviewStar\(/);
  assert.match(hub, /function toggleStarredOnly\(/);
  assert.match(hub, /data-edit-side="front"/);
  assert.match(hub, /data-edit-side="back"/);
  assert.match(hub, /data-card-chat/);
  assert.match(hub, /docked: true/);
  assert.match(hub, /canUseSideChat\?/);
  assert.match(hub, /role: "think"/);
  assert.match(hub, /onAddToCard: addReplyToCard/);
  assert.match(css, /study-starred-toggle/);
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*?\.study-review-hint \{\s*display:\s*none;/);
  assert.match(css, /body\.capacitor-native \.study-review-hint \{\s*display:\s*none;/);
  assert.match(css, /body\.capacitor-native \.study-ask/);
  assert.match(css, /study-session \.study-ask-input:focus-visible/);
  assert.match(css, /study-edit-card \.study-sketch-stroke/);
});

test("flashcard side chat uses the Study Hub paper theme without its generic title", () => {
  const css = readFileSync(resolve(publicDir, "styles/study-hub.css"), "utf8");
  assert.match(css, /body\.study-session-open \.side-chat-panel\s*\{[^}]*var\(--study-stroke\)[^}]*var\(--study-board\)[^}]*var\(--study-font\)/s);
  assert.match(css, /body\.study-session-open \.side-chat-header > div\s*\{\s*display:\s*none/);
  assert.match(css, /body\.study-session-open \.side-chat-context\s*\{[^}]*var\(--study-blue\)/s);
  assert.match(css, /body\.study-session-open \.side-chat-composer\s*\{[^}]*var\(--study-paper\)/s);
  assert.match(css, /body\.study-session-open \.side-chat-message\.user\s*\{[^}]*var\(--study-orange\)/s);
});

test("Studio practice tests offer bounded question counts", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  assert.match(hub, /field\("Questions", "count"/);
  assert.match(generate, /clampPick\(count, \[10, 5, 15, 20, 25\]\)/);

});

test("flashcards use Rapid then Deep, never a fixed count", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  assert.match(hub, /\["rapid", "Standard/);
  assert.match(hub, /\["deep", "Deep dive/);
  assert.match(hub, /body\.mode = mode === "deep" \? "deep" : "rapid"/);


  assert.match(hub, /data-toggle-quiz-menu=/);
  assert.doesNotMatch(hub, /countMenu\("flashcards"/);
  assert.doesNotMatch(hub, /if \(cardMode === "deep"\) return ""/);
  assert.match(generate, /normalizeFlashcardMode/);
  assert.match(generate, /FLASHCARD_CAPS = \{ rapid: 50, deep: 250 \}/);
  assert.match(generate, /cleanCards\(parsed\.value, cardCap, options\.cardType\)/);
  assert.match(generate, /First plan the complete relevant coverage, then fit it into no more than \$\{cardCap\} cards/);
  assert.match(generate, /First identify and rank the most important concepts/);
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

test("completed Study Hub generation force-refreshes visible course data", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  assert.match(hub, /loadMaterials\(true\)\.catch/);
  assert.match(hub, /loadPractice\(true\)\.catch/);
  assert.match(hub, /if \(!force && cacheCourseId === id && hasCache\(\)\) return/);
});

test("Dojo shows generation status in Studio", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const css = readFileSync(resolve(publicDir, "styles/study-hub.css"), "utf8");
  assert.match(hub, /dojo-studio-content/);
  assert.match(hub, /\$\{generationCardsMarkup\(\)\}/);
  assert.match(css, /\.study-gen-card\s*\{[\s\S]*?border-radius: 999px/s);
  assert.doesNotMatch(css, /var\(--home-wallpaper-image, none\)/);
});

test("practice cards keep their outlines closed around long titles", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const css = readFileSync(resolve(publicDir, "styles/study-hub.css"), "utf8");
  assert.doesNotMatch(hub, /sketchStroke\("is-stack-/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.study-practice-open strong \{[^}]*text-overflow: ellipsis/s);
});

test("Dojo collapses to accessible section tabs on narrow screens", () => {
  const css = readFileSync(resolve(publicDir, "styles/study-hub.css"), "utf8");
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /data-mobile-panel="materials"/);
  assert.match(css, /data-mobile-panel="chat"/);
  assert.match(css, /data-mobile-panel="practice"/);
  assert.match(hub, /role="tablist"/);
});

test("materials Notes uses Summary and Detailed, each once", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  assert.match(hub, /field\("Detail", "mode"/);
  assert.match(hub, /\["summary", "The essentials",/);
  assert.match(hub, /\["detailed", "Detailed review",/);
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

test("deleting a note warns that linked practice content is also deleted", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  assert.match(hub, /This will also delete its flashcard decks and quizzes\./);
});

test("practice tests run full screen and end with a marked report", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const test = readFileSync(resolve(publicDir, "js/studyTest.js"), "utf8");
  const css = readFileSync(resolve(publicDir, "styles/study-hub.css"), "utf8");
  assert.match(hub, /void startQuiz\(studioView\.id\)/);
  assert.doesNotMatch(hub, /function moveQuiz\(/);
  assert.doesNotMatch(test, /data-test-host/, "no side-panel toggle in the test header");
  assert.match(test, /data-test-mic/, "written answers can be spoken");
  assert.match(hub, /function submitQuiz\(/);
  assert.match(hub, /function retakeQuiz\(/);
  assert.match(hub, /quizId:\s*quizSession\.quiz\.id/);
  assert.match(hub, /function addedQuestionIndexes\(/);
  assert.match(test, /data-test-clock/);
  assert.match(test, /Submit for marking/);
  assert.match(test, /Strengths/);
  assert.match(test, /Room to grow/);
  assert.match(test, /What to study next/);
  assert.match(test, /data-quiz-lookback>Review answers/);
  assert.match(test, /data-test-finish>Finish/);
  assert.match(test, /data-quiz-retake>Retake test/);
  assert.match(test, /already \? "Added" : "Add to flashcards"/);
  // Results stay encouraging: no failing grades or scolding copy.
  assert.doesNotMatch(test, /See me after class|"F"|Wrong|Incorrect|Failed/);
  assert.doesNotMatch(css, /\.study-session-progress/);
  assert.match(css, /\.study-test\.is-full/);
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
  assert.match(hub, /const generations = new Map\(\)/);
  assert.match(hub, /AbortController/);
  assert.match(hub, /data-cancel-generation=/);
  assert.match(hub, /data-retry-generation=/);
  assert.match(hub, /aria-live="polite"/);
  assert.doesNotMatch(hub, /scaffoldBusyKey/);
  assert.doesNotMatch(hub, /Import syllabus dates/);
  assert.doesNotMatch(hub, /overviewMarkup/);
  assert.doesNotMatch(hub, /computeStreak/);
  assert.match(hub, /dojo-studio-content/);
  assert.match(hub, /if \(flashBusy\) return/);
  assert.match(hub, /abortAllGenerations/);
  assert.doesNotMatch(hub, /let generatingKey/);
  assert.doesNotMatch(hub, /EventSource/);
});

test("study hub schema drops reviews, attempts, due_at, and FSRS columns", () => {
  const schema = readFileSync(resolve(here, "../supabase/schema.sql"), "utf8");
  const css = readFileSync(resolve(publicDir, "styles/study-hub.css"), "utf8");
  const dropReviews = readFileSync(resolve(here, "../supabase/migrations/20260822120000_drop_study_reviews_attempts_and_due_at.sql"), "utf8");
  const dropFsrs = readFileSync(resolve(here, "../supabase/migrations/20260822133000_drop_study_card_fsrs_columns.sql"), "utf8");
  assert.doesNotMatch(schema, /study_reviews/);
  assert.doesNotMatch(schema, /study_quiz_attempts/);
  assert.doesNotMatch(schema, /due_at timestamptz/);
  assert.doesNotMatch(schema, /last_reviewed_at/);
  assert.doesNotMatch(schema, /stability real/);
  assert.match(dropReviews, /drop table if exists public\.study_reviews/);
  assert.match(dropReviews, /drop column if exists due_at/);
  assert.match(dropFsrs, /drop column if exists state/);
  assert.match(dropFsrs, /drop column if exists last_reviewed_at/);
  assert.doesNotMatch(css, /study-overview-top/);
  assert.doesNotMatch(css, /study-streak-chip/);
  assert.doesNotMatch(css, /study-deadline-list/);
  assert.doesNotMatch(css, /study-due-badge/);
});

test("Dojo replaces the board with animated folders and three persistent panels", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const css = readFileSync(resolve(publicDir, "styles/study-hub.css"), "utf8");
  const html = readFileSync(resolve(publicDir, "index.html"), "utf8");
  assert.doesNotMatch(hub, /sketchStroke|sketchTape|sketchPin|Today's board/);
  assert.doesNotMatch(css, /study-wobble|Shantell|study-grid/);
  assert.match(hub, /dojo-folder-sheet--one/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /prefers-reduced-motion/);
  for (const panel of ["Sources", "Ask", "Create"]) assert.ok(hub.includes(`aria-label="${panel}"`));
  assert.match(hub, /messagesSlot.append\(els.messages\)/);
  assert.match(hub, /parkMessages\(\)/);
  assert.match(html, /aria-label="Dojo"/);
});

test("study hub paints before refetching and reuses course payloads", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const app = readFileSync(resolve(publicDir, "js/app.js"), "utf8");
  assert.match(hub, /let cacheCourseId = ""/);
  assert.match(hub, /function prefetchCourse\(/);
  assert.match(hub, /function loadOnce\(/);
  assert.match(hub, /function courseBodyMarkup\(/);
  assert.match(hub, /study-detail-body/);
  assert.match(hub, /patchGenerationElapsed/);
  assert.match(hub, /const ready = tabReady\(\)/);
  assert.match(hub, /if \(cacheCourseId !== courseId\) resetCourseCaches\(\)/);
  assert.match(hub, /syncStudyUrl\(\{ replace \}\);\s*renderShell\(\);/);
  assert.match(hub, /now - projectsAt < 20000/);
  assert.doesNotMatch(hub, /resetCourseCaches\(\);\s*state\.activeConversationId/);
  assert.match(app, /renderShell\(\);\s*if \(state\.activeCourseId\)/);
});

test("course uploads replace the reading placeholder with fresh materials", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  assert.match(hub, /const results = await Promise\.allSettled\(/);
  assert.match(hub, /Some files could not be uploaded/);
  assert.match(hub, /pendingUploads = pendingUploads\.filter\(\(row\) => !locals\.some\(\(item\) => item\.id === row\.id\)\)/);
  assert.match(hub, /await waitForDocument\(completed\.id, item\.name\);/);
  assert.doesNotMatch(hub, /waitForDocument\(completed\.id, item\.name\)\.catch/);
  assert.match(hub, /state\.studyMaterials = null;\s*await loadMaterials\(\);/);
});

test("course chat list includes newly created course conversations without a refetch", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const app = readFileSync(resolve(publicDir, "js/app.js"), "utf8");
  assert.match(hub, /function courseConversations\(/);
  assert.match(hub, /conv\.project_id !== courseId/);
  assert.match(hub, /const conversations = courseConversations\(\)/);
  assert.match(app, /studyHub\.openCourse\(courseId, \{ tab: "chat" \}\)/);
  assert.match(app, /projectId: state\.activeProjectId \|\| \(state\.studyOpen \? state\.activeCourseId : ""\) \|\| null/);
  assert.match(hub, /dojo-chat-recent/);
  assert.match(hub, /function openRenameCourseChat\(/);
  assert.match(hub, /function confirmDeleteCourseChat\(/);
  assert.match(app, /state\.studyProjectDetail\.conversations = state\.studyProjectDetail\.conversations\.filter/);
});

test("study hub overlays dismiss on leave paths", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const app = readFileSync(resolve(publicDir, "js/app.js"), "utf8");
  assert.match(hub, /function closeSession\(\) \{[\s\S]*?closeNote\(\);/);
  assert.match(hub, /async function openCourses\(\{ replace = false \} = \{\}\) \{[\s\S]*?closeSession\(\);/);
  assert.match(app, /async function openProjects\(\{ replace = false \} = \{\}\) \{[\s\S]*?studyHub\.closeSession\(\);/);
  assert.match(app, /async function openProject\(projectId, \{ replace = false \} = \{\}\) \{[\s\S]*?studyHub\.closeSession\(\);/);
  assert.match(app, /function openNewChat\(\{ replaceUrl = false \} = \{\}\) \{[\s\S]*?studyHub\.closeSession\(\);/);
  assert.match(app, /async function openConversation\(conversationId\) \{[\s\S]*?studyHub\.closeSession\(\);/);
  assert.match(app, /addEventListener\("popstate"[\s\S]*?studyHub\.closeSession\(\);/);
});

test("successful generation cards remove themselves immediately", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  assert.match(
    hub,
    /function courseGenerationCards\(\) \{[\s\S]*?job\.status !== "succeeded"/
  );
  assert.match(
    hub,
    /toastForGeneration\(job\);\s*generations\.delete\(job\.id\);\s*if \(studyVisible\(\) && state\.activeCourseId === courseId\) render\(\);\s*if \(state\.activeCourseId === courseId\) \{\s*await Promise\.all\(/
  );
  assert.doesNotMatch(hub, /Ready in Materials/);
  assert.doesNotMatch(hub, /Available in Practice/);
  assert.match(hub, /const failed = job\.status === "failed";/);
  assert.match(hub, /data-retry-generation=/);
});

test("flashcard rounds end on a results screen and save what to revisit", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const { deckBuckets, deckProgressSummary, readDeckProgress, writeDeckProgress, clearDeckProgress } = await import("../public/js/deckProgress.js");
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const buckets = deckBuckets(cards, { a: 3, b: 1 });
  assert.deepEqual(buckets.got.map((c) => c.id), ["a"]);
  assert.deepEqual(buckets.missed.map((c) => c.id), ["b"]);
  assert.deepEqual(buckets.skipped.map((c) => c.id), ["c", "d"]);
  writeDeckProgress("deck1", { order: ["a", "b", "c", "d"], index: 2, marks: { a: 3, b: 1 }, round: 1, done: false });
  assert.deepEqual(deckProgressSummary(readDeckProgress("deck1"), ["a", "b", "c", "d"]), { state: "resume", seen: 3, total: 4, got: 1, missed: 1, round: 1 });
  writeDeckProgress("deck1", { order: ["a", "b", "c", "d"], index: 3, marks: { a: 3, b: 1 }, round: 1, done: true });
  assert.equal(deckProgressSummary(readDeckProgress("deck1"), ["a", "b", "c"]).revisit, 2);
  clearDeckProgress("deck1");
  assert.equal(readDeckProgress("deck1"), null);
  delete globalThis.localStorage;
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  assert.match(hub, /function reviewDoneMarkup\(session\)/);
  assert.match(hub, /data-review-again="revisit"/);
  assert.match(hub, /if \(next >= reviewSession\.cards\.length\) return finishReview\(\);/);
});

test("review progress is per course, revisit rounds keep their pool and failed generations clear themselves", () => {
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  assert.match(hub, /return `\$\{state\.activeCourseId\}:\$\{deckId\}`;/);
  assert.doesNotMatch(hub, /(read|write|clear)DeckProgress\((studioView\.id|deck\.id|session\.deckId|reviewSession\.deckId)\)/);
  assert.match(hub, /\(!pool \|\| pool\.has\(card\.id\)\) && \(!reviewSession\.starredOnly \|\| card\.starred\)/);
  assert.match(hub, /dismissFailedGeneration\(job\);/);
  assert.match(hub, /const FAILED_GENERATION_MS = 3000;/);
  assert.match(hub, /type === "flashcards" \|\| type === "mindmap" \? \[\] : \[\["conceptual"/);
  assert.match(hub, /await spoken\.finished;/);
  const resize = readFileSync(resolve(publicDir, "js/dojoPanelResize.js"), "utf8");
  assert.match(resize, /window\.addEventListener\("pointerup", endDrag\)/);
  assert.match(resize, /new ResizeObserver\(schedule\)/);
});

test("flip preview grades cards, counts ticks and crosses, and revisits the misses", async () => {
  const { deckBodyMarkup, visibleDeckCards } = await import("../public/js/studyStudio.js");
  const helpers = { escapeHtml: (value) => String(value), starIcon: () => "", sourceName: () => "" };
  const cards = [1, 2, 3].map((n) => ({ id: `c${n}`, front: `Q${n}`, back: `A${n}`, sources: [] }));
  const view = { cards, layout: "flip", query: "", sort: "original", flipIndex: 1, flipped: false, marks: { c1: 3 }, pool: null };
  const html = deckBodyMarkup(view, helpers);
  assert.match(html, /data-flip-grade="1"[^>]*aria-pressed="false"[^>]*>.*?<span>0<\/span>/);
  assert.match(html, /data-flip-grade="3"[^>]*><span>1<\/span>/);
  assert.match(html, /data-flip-nav="-1"(?![^>]*disabled)/);
  assert.match(html, /data-flip-nav="1"(?![^>]*disabled)/);
  const done = deckBodyMarkup({ ...view, marks: { c1: 3, c2: 1, c3: 3 } }, helpers);
  assert.match(done, /Round done/);
  assert.match(done, /data-flip-round="revisit"[^>]*>.*Revisit 1/);
  assert.deepEqual(visibleDeckCards({ ...view, pool: ["c2"] }).map((card) => card.id), ["c2"]);
  assert.equal(visibleDeckCards({ ...view, layout: "list", pool: ["c2"] }).length, 3);
});

test("flip preview keeps grading after a completed search is cleared", async () => {
  const { deckBodyMarkup, visibleDeckCards } = await import("../public/js/studyStudio.js");
  const hub = readFileSync(resolve(publicDir, "js/studyHub.js"), "utf8");
  const grade = hub.match(/function gradeStudioFlip\([\s\S]*?\n  \}/)[0];
  const helpers = { escapeHtml: String, starIcon: () => "", sourceName: () => "" };
  const view = {
    cards: [{ id: "a", front: "Alpha" }, { id: "b", front: "Beta" }],
    layout: "flip", query: "Alpha", sort: "original", flipIndex: 0, marks: {}
  };
  const ctx = { studioView: view, visibleDeckCards, patchDeckBody() {}, els: { studyView: { querySelector: () => null } } };
  runInNewContext(grade, ctx);
  ctx.gradeStudioFlip(3);
  assert.match(deckBodyMarkup(view, helpers), /All right\. Nice\./);
  view.query = "";
  view.flipIndex = 1;
  assert.match(deckBodyMarkup(view, helpers), /data-flip-grade/);
  ctx.gradeStudioFlip(1);
  assert.deepEqual(view.marks, { a: 3, b: 1 });
  assert.match(deckBodyMarkup(view, helpers), /Round done/);
});

test("message and resize renders keep the global prompt timeline hidden in Dojo", () => {
  const app = readFileSync(resolve(publicDir, "js/app.js"), "utf8");
  const render = app.match(/function renderChatPromptNavigator\([\s\S]*?\n\}/)[0];
  const classes = new Set();
  const ctx = {
    state: { studyOpen: false }, renderedChatPromptSignature: "",
    desktopChatNavigationEnabled: () => true,
    userPromptItems: () => [{ id: "a", label: "First question" }, { id: "b", label: "Second question" }],
    escapeHtml: String,
    els: {
      chatPromptNav: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } },
      chatPromptMarkers: { querySelector: () => null, innerHTML: "" },
      chatPromptList: { innerHTML: "" }
    }
  };
  runInNewContext(render, ctx);
  ctx.renderChatPromptNavigator();
  assert.equal(classes.has("hidden"), false);
  ctx.state.studyOpen = true;
  classes.add("hidden"); // Dojo's initial paint hides the global timeline.
  ctx.renderChatPromptNavigator();
  ctx.renderChatPromptNavigator(); // Another message or resize must not bring it back.
  assert.equal(classes.has("hidden"), true);
  assert.equal(ctx.renderedChatPromptSignature, "");
  ctx.state.studyOpen = false;
  ctx.renderChatPromptNavigator();
  assert.equal(classes.has("hidden"), false);
  assert.match(ctx.els.chatPromptList.innerHTML, /First question/);
});
