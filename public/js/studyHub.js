import { kluiSvgMarkup } from "./klui.js";
import { copyText } from "./platform/index.js";
import { renderMindMap } from "./mindMap.js";
import { createStudySourceDialog } from "./studySources.js";
import { DECK_LAYOUTS, citePills, deckBodyMarkup, deckViewMarkup, noteViewMarkup, quizViewMarkup, typingCardMarkup, visibleDeckCards } from "./studyStudio.js";
import { answeredCount, formatClock, isAnswered, sessionElapsed, testMarkup } from "./studyTest.js";
import { PLAYER_ICONS, activeLine, createPodcastAudio, formatTime, lengthOf, podcastMeta, podcastOptionsMarkup, podcastViewMarkup, speedLabel, styleOf, voiceOf } from "./studyPodcast.js";
import { createTutorCall, syncTutorOptions, tutorMeta, tutorOptionsMarkup, tutorViewMarkup } from "./studyTutor.js";

export function createStudyHubController({
  state,
  els,
  escapeHtml,
  renderContent,
  showToast,
  requireAuth,
  blockChatNavigationWhileRunning,
  parkActiveConversationRun,
  clearClarification,
  closeDocumentViewer,
  openDocumentViewer,
  renderShell,
  renderImages,
  openConversation,
  openDeleteConfirm,
  openTitleRename,
  isSupportedDocumentFile,
  fetchProject,
  createProject,
  updateProject,
  updateConversation,
  presignUpload,
  putUploadContent,
  completeUpload,
  deleteAttachment,
  fetchDocumentStatus,
  fetchStudyMaterials,
  generateStudyContent,
  deleteStudyMaterial,
  fetchStudyPractice,
  fetchStudyQueue,
  createStudyCard,
  updateStudyCard,
  deleteStudyCard,
  updateStudyDeck,
  deleteStudyDeck,
  fetchStudyQuiz,
  updateStudyQuiz,
  deleteStudyQuiz,
  fetchStudyPodcast,
  updateStudyPodcast,
  deleteStudyPodcast,
  prepareStudyTutor,
  fetchStudyTutor,
  updateStudyTutor,
  deleteStudyTutor,
  transcribeTutorAudio,
  streamTutorTurn,
  endStudyTutor,
  submitStudyQuizAttempt,
  exportStudyNote,
  deleteStudyNote,
  fetchDocumentJobStatus,
  downloadAttachment,
  flashCopySuccess,
  syncStudyUrl,
  loadProjects,
  canUseSideChat,
  openSideChat,
  closeSideChat
}) {
  const TABS = ["materials", "chat", "practice"];
  const CREATE_FILE_CAP = 5;

  let pendingUploads = [];
  let cacheCourseId = "";
  let projectsAt = Date.now();
  const inflight = new Map();
  /** @type {Map<string, object>} in-memory generation cards; survives SPA nav while page stays open */
  const generations = new Map();
  let elapsedTimer = null;
  let quizMenuKey = "";
  let reviewSession = null;
  let quizSession = null;
  let testClock = null;
  let podcastAudio = null;
  // The one live tutor call; it outlives repaints and survives leaving its view (paused).
  let tutorCall = null;
  let voicePreview = null;
  // Transcript follows playback unless the reader scrolled it recently.
  let transcriptScrolledAt = 0;
  let studyNote = null;
  let createType = "";
  let sourceSort = "recent";
  let sourcesCollapsed = false;
  let panelResizeAnimation = null;
  let studioCollapsed = false;
  let sourcePreviewId = "";
  // A deck, note, or test opened inside the Create panel (widens it like a source preview).
  let studioView = null;
  // Entrance animations play once per item; later repaints of the same item stay still.
  const shownEntrances = new Set();
  const deckLayoutKey = "klui.dojo.deckLayout.v1";
  let sourceListScrollTop = 0;
  let collectionScrollTop = 0;
  const pinnedCollectionKey = "klui.dojo.collectionPins.v1";
  const pinnedCollection = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(pinnedCollectionKey) || "[]");
    if (Array.isArray(saved)) saved.filter(key => typeof key === "string").forEach(key => pinnedCollection.add(key));
  } catch { /* Browsers without storage still keep pins for this session. */ }
  const createSelected = new Set();
  const sourceDialog = createStudySourceDialog({
    state, uploadFiles: uploadCourseFiles, showToast,
    onCreated(courseId, doc) {
      if (state.activeCourseId !== courseId) return;
      state.studyMaterials = {
        ...state.studyMaterials,
        documents: [...(state.studyMaterials?.documents || []), doc]
      };
      render();
    }
  });

  function collectionPinId(kind, id) {
    return `${state.activeCourseId}:${kind}:${id}`;
  }

  function collectionPinMarkup(kind, id) {
    const pinned = pinnedCollection.has(collectionPinId(kind, id));
    return `<button class="study-menu-item" type="button" role="menuitem" data-collection-pin-kind="${kind}" data-collection-pin-id="${escapeHtml(id)}">${pinned ? "Unpin" : "Pin to top"}</button>`;
  }

  function toggleCollectionPin(kind, id) {
    const key = collectionPinId(kind, id);
    if (pinnedCollection.has(key)) pinnedCollection.delete(key);
    else pinnedCollection.add(key);
    try { localStorage.setItem(pinnedCollectionKey, JSON.stringify([...pinnedCollection])); } catch { /* Keep the in-memory pin. */ }
    quizMenuKey = "";
    const collectionList = els.studyView.querySelector(".dojo-artifacts");
    if (collectionList) collectionList.scrollTop = 0;
    collectionScrollTop = 0;
    render();
  }

  const sound = createSounds(reducedMotion);

  function coursesFromProjects() {
    return (state.projects || []).filter((project) => project.kind === "course");
  }

  function courseMeta(project) {
    return project?.meta && typeof project.meta === "object" ? project.meta : {};
  }

  function courseName() {
    return state.studyProjectDetail?.project?.name
      || coursesFromProjects().find((item) => item.id === state.activeCourseId)?.name
      || "Course";
  }

  function reducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  function parkComposer() {
    if (els.composerHomeAnchor && els.composerArea?.parentElement !== els.composerHomeAnchor.parentElement) {
      els.composerHomeAnchor.after(els.composerArea);
    }
  }

  function studyVisible() {
    return Boolean(state.studyOpen);
  }

  function isStudyFile(file) {
    return String(file?.type || "").startsWith("image/") || isSupportedDocumentFile(file);
  }

  function documentDisplayName(doc) {
    const attachment = Array.isArray(doc?.attachments) ? doc.attachments[0] : doc?.attachments;
    return doc?.source_title || doc?.metadata?.title || attachment?.file_name || doc?.file_name || "Document";
  }

  function isMindMap(note) {
    return String(note?.content || "").startsWith("<!--klui:mindmap-->");
  }

  function mindMapMarkup(note) {
    return renderMindMap(note.title, noteBody(note), escapeHtml);
  }

  function isDetailedNote(note) {
    return note?.kind === "detailed" || String(note?.content || "").startsWith("<!--klui:detailed-->");
  }

  function noteBody(note) {
    const text = String(note?.content || "");
    return text.replace(/^<!--klui:(?:detailed|mindmap)-->\n?/, "");
  }

  function noteKindLabel(note) {
    if (isMindMap(note)) return "Mind map";
    if (note?.kind === "image_transcript") return "Image transcript";
    if (isDetailedNote(note)) return "Detailed";
    return "Summary";
  }

  function materialMenu(kind, id) {
    const key = `material:${kind}:${id}`;
    const open = quizMenuKey === key;
    const del = kind === "note" ? `data-delete-note="${escapeHtml(id)}"` : `data-delete-doc="${escapeHtml(id)}"`;
    const cardMode = state.studyMaterials?.flashcardModes?.[`note:${id}`] || "";
    const generate = kind === "note" ? [
      ["flashcards", "rapid", "Create flashcards"],
      ["flashcards", "deep", "Create deep flashcards"],
      ["quiz", "", "Create practice test"]
    ].map(([type, mode, label]) => {
      const busy = [...generations.values()].some(job => job.courseId === state.activeCourseId && job.noteId === id && job.type === type && job.status === "running");
      const done = type === "flashcards" && (cardMode === "deep" || (mode === "rapid" && cardMode === "rapid"));
      return `<button class="study-menu-item" type="button" role="menuitem" data-study-generate="${type}" data-gen-kind="note" data-gen-id="${escapeHtml(id)}" data-mode="${mode}"${busy || done ? " disabled" : ""}>${label}</button>`;
    }).join("") : "";
    return `
      <div class="study-card-menu-wrap">
        <button class="study-icon-btn" type="button" data-toggle-material-menu="${escapeHtml(key)}" aria-label="Material options" aria-haspopup="menu" aria-expanded="${open ? "true" : "false"}">
          ${kebabIcon()}
        </button>
        <div class="study-menu${open ? "" : " hidden"}" role="menu">
          ${kind === "note" ? collectionPinMarkup(kind, id) : ""}
          ${generate}
          <button class="study-menu-item study-menu-danger" type="button" role="menuitem" ${del}>Delete</button>
        </div>
      </div>`;
  }

  function practiceMenu(kind, id) {
    const key = `${kind}:${id}`;
    const open = quizMenuKey === key;
    const toggle = kind === "deck"
      ? `data-toggle-deck-menu="${escapeHtml(id)}"`
      : `data-toggle-quiz-menu="${escapeHtml(key)}"`;
    const rename = kind === "deck" ? `data-rename-deck="${escapeHtml(id)}"` : kind === "podcast" ? `data-rename-podcast="${escapeHtml(id)}"` : kind === "tutor" ? `data-rename-tutor="${escapeHtml(id)}"` : `data-rename-quiz="${escapeHtml(id)}"`;
    const del = kind === "deck" ? `data-delete-deck="${escapeHtml(id)}"` : kind === "podcast" ? `data-delete-podcast="${escapeHtml(id)}"` : kind === "tutor" ? `data-delete-tutor="${escapeHtml(id)}"` : `data-delete-quiz="${escapeHtml(id)}"`;
    return `
      <div class="study-card-menu-wrap">
        <button class="study-icon-btn" type="button" ${toggle} aria-label="${kind === "deck" ? "Deck options" : kind === "podcast" ? "Podcast options" : kind === "tutor" ? "Session options" : "Quiz options"}" aria-haspopup="menu" aria-expanded="${open ? "true" : "false"}">
          ${kebabIcon()}
        </button>
        <div class="study-menu${open ? "" : " hidden"}" role="menu">
          ${collectionPinMarkup(kind, id)}
          <button class="study-menu-item" type="button" role="menuitem" ${rename}>Rename</button>
          <button class="study-menu-item study-menu-danger" type="button" role="menuitem" ${del}>Delete</button>
        </div>
      </div>`;
  }

  function materialStatus(doc) {
    if (doc?.text_ready_at || doc?.usable || doc?.processing_status === "ready") return "ready";
    if (doc?.processing_status === "failed") return "failed";
    return "reading";
  }

  function statusLabel(status) {
    if (status === "uploading") return "Uploading";
    if (status === "reading") return "Reading";
    if (status === "failed") return "Failed";
    return "Ready";
  }

  function kebabIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;
  }

  function starIcon(filled) {
    return filled
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3.2 2.5 5.9 6.4.6-4.9 4.2 1.5 6.3L12 16.8 6.5 20.2l1.5-6.3-4.9-4.2 6.4-.6z"/></svg>`
      : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.2 2.5 5.9 6.4.6-4.9 4.2 1.5 6.3L12 16.8 6.5 20.2l1.5-6.3-4.9-4.2 6.4-.6z"/></svg>`;
  }

  function icon(name) {
    const paths = {
      course: '<path d="m2 9 10-5 10 5-10 5-10-5ZM6 11v6c4 3 8 3 12 0v-6M22 9v7"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>',
      flashcards: '<rect x="7" y="5" width="13" height="16" rx="3"/><path d="M15 2H5a2 2 0 0 0-2 2v12M13 9l-2 4h5l-2 4"/>',
      mindmap: '<rect x="9" y="2" width="6" height="5" rx="1.5"/><rect x="2" y="17" width="6" height="5" rx="1.5"/><rect x="16" y="17" width="6" height="5" rx="1.5"/><path d="M12 7v5M5 17v-5h14v5"/>',
      notes: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>',
      quiz: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 8 1 1 2-2m-3 8 1 1 2-2m3-6h2m-2 7h2"/>',
      podcast: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21m-3.5 0h7"/>',
      tutor: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z"/><path d="m12 6.5.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z"/>',
      pin: '<path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6Zm4 11v7"/>',
      chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 10h8M7 14h5"/>',
      recent: '<path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5m4-2v5l3 2"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
      sort: '<path d="M4 6h16M4 12h10M4 18h4"/>',
      sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m7-11-3 3 3 3"/>',
      expand: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m4-11 3 3-3 3"/>',
      arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>'
    };
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  }

  function folderSvg(index = 0, add = false) {
    const tones = ["sage", "clay", "blue", "lilac"];
    return `<svg class="dojo-folder dojo-folder--${tones[index % tones.length]}" viewBox="0 0 240 180" fill="none" aria-hidden="true">
      <ellipse cx="121" cy="158" rx="76" ry="8" class="dojo-folder-shadow"/>
      <path d="M32 57a12 12 0 0 1 12-12h47l17 16h88a12 12 0 0 1 12 12v65a12 12 0 0 1-12 12H44a12 12 0 0 1-12-12Z" class="dojo-folder-back"/>
      <g class="dojo-folder-sheet dojo-folder-sheet--one"><rect x="56" y="48" width="104" height="88" rx="5"/><path d="M70 65h39M70 76h66M70 84h58M70 92h65"/></g>
      <g class="dojo-folder-sheet dojo-folder-sheet--two"><rect x="79" y="43" width="104" height="94" rx="5"/><path d="M94 59h32M94 71h70M94 80h61M94 89h68M94 98h43"/></g>
      <g class="dojo-folder-sheet dojo-folder-sheet--three"><rect x="49" y="64" width="119" height="78" rx="5"/><path d="M63 80h29M63 92h85M63 101h70M63 110h78"/></g>
      <path class="dojo-folder-front" d="M26 87a10 10 0 0 1 10-11h66l14 9h88a10 10 0 0 1 10 11l-8 46a12 12 0 0 1-12 10H46a12 12 0 0 1-12-10Z"/>
      <path class="dojo-folder-rim" d="M38 79h63l14 9h87"/>
      ${add ? '<circle cx="123" cy="117" r="16" class="dojo-folder-badge"/><path d="M123 110v14m-7-7h14" class="dojo-folder-plus"/>' : '<path d="M52 129h24" class="dojo-folder-label"/>'}
    </svg>`;
  }

  function statusLine(status, kindLabel = "") {
    const mark = status === "ready" ? "✓ " : status === "failed" ? "✕ " : "";
    const kind = kindLabel ? `${kindLabel} ` : "";
    return `<span class="study-status is-${escapeHtml(status)}">${status === "uploading" || status === "reading" ? spinner() : ""}${escapeHtml(kind)}${mark}${escapeHtml(String(statusLabel(status) || "").toLowerCase())}</span>`;
  }

  function deckSourceOf(deck) {
    if (deck.deckKey) return { deckKey: deck.deckKey };
    if (deck.manual) return { manual: true };
    if (deck.documentFileId) return { documentFileId: deck.documentFileId };
    return { noteId: deck.noteId };
  }

  function findDeck(deckId) {
    return (state.studyPractice?.decks || []).find((deck) => deck.id === deckId) || null;
  }

  function findQuiz(quizId) {
    return (state.studyPractice?.quizzes || []).find((quiz) => quiz.id === quizId) || null;
  }

  function findPodcast(podcastId) {
    return (state.studyPractice?.podcasts || []).find((podcast) => podcast.id === podcastId) || null;
  }

  function findTutor(sessionId) {
    return (state.studyPractice?.tutors || []).find((item) => item.id === sessionId) || null;
  }

  function spinner() {
    return `<span class="study-spin" aria-hidden="true"></span>`;
  }

  function emptyState(title, body, action = "") {
    return `<div class="study-empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p>${action}</div>`;
  }

  function tabReady() {
    if (state.activeCourseTab === "practice") return state.studyPractice != null;
    if (state.activeCourseTab === "chat") return state.studyProjectDetail != null;
    return state.studyMaterials != null;
  }

  function boardLoadingMarkup() {
    return `<div class="study-empty" role="status">${spinner()}<p>Getting your course ready…</p></div>`;
  }

  function courseListMarkup() {
    const courses = coursesFromProjects();
    const cards = courses.map((course, index) => {
      const menuOpen = quizMenuKey === `course:${course.id}`;
      return `<article class="study-course-card">
        <button class="study-course-open" type="button" data-open-course-id="${escapeHtml(course.id)}">
          ${folderSvg(index)}<span class="dojo-course-label"><strong>${escapeHtml(course.name)}</strong><small>${escapeHtml(courseMeta(course).term || "Your study space")}</small></span><span class="dojo-course-enter">${icon("arrow")}</span>
        </button>
        <div class="study-card-menu-wrap">
          <button class="study-icon-btn" type="button" data-toggle-course-menu="${escapeHtml(course.id)}" aria-label="Options for ${escapeHtml(course.name)}" aria-haspopup="menu" aria-expanded="${menuOpen}">${kebabIcon()}</button>
          <div class="study-menu${menuOpen ? "" : " hidden"}" role="menu">
            <button class="study-menu-item" type="button" role="menuitem" data-rename-course="${escapeHtml(course.id)}">Rename</button>
            <button class="study-menu-item study-menu-danger" type="button" role="menuitem" data-delete-course="${escapeHtml(course.id)}">Delete</button>
          </div>
        </div>
      </article>`;
    }).join("");
    return `<div class="study-page">
      <header class="study-page-header"><div><p class="dojo-section-label">${icon("course")} Dojo</p><h1>What are we learning?</h1><p class="dojo-intro">Pick a course. Bring your questions. Let’s figure it out.</p></div><div class="dojo-library-mascot" aria-hidden="true">${kluiSvgMarkup("dojo-library", { greeting: true })}</div></header>
      <div class="dojo-library-heading"><h2>Your courses</h2><span>${courses.length} ${courses.length === 1 ? "course" : "courses"}</span></div>
      <div class="study-course-grid">${cards}<button class="study-course-card study-course-new" type="button" data-create-course>
        ${folderSvg(courses.length, true)}<span class="dojo-course-label"><strong>New course</strong><small>Give your next idea a home</small></span>
      </button></div>
      ${!courses.length ? '<p class="dojo-first-hint">One folder for every subject. Add your sources, ask questions, and turn what you learn into practice.</p>' : ""}
    </div>`;
  }

  function jobTypeLabel(type) {
    if (type === "flashcards") return "Flashcards";
    if (type === "quiz") return "Practice test";
    if (type === "mindmap") return "Mind map";
    if (type === "notes") return "Notes";
    if (type === "podcast") return "Podcast";
    if (type === "tutor") return "AI tutor";
    return "Generation";
  }

  function jobStatusLabel(status) {
    if (status === "running") return "Running";
    if (status === "succeeded") return "Ready";
    if (status === "failed") return "Failed";
    return statusLabel(status);
  }

  function jobSourceName(job) {
    const ids = Array.isArray(job?.documentFileIds) ? job.documentFileIds : [];
    if (ids.length > 1) {
      const names = ids.map((id) => {
        const doc = (state.studyMaterials?.documents || []).find((item) => item.id === id);
        return doc ? documentDisplayName(doc) : "";
      }).filter(Boolean);
      if (names.length) return names.join(", ");
    }
    if (job?.documentFileId) {
      const doc = (state.studyMaterials?.documents || []).find((item) => item.id === job.documentFileId);
      if (doc) return documentDisplayName(doc);
    }
    if (job?.noteId) {
      const note = (state.studyMaterials?.notes || []).find((item) => item.id === job.noteId);
      if (note) return note.title || noteKindLabel(note);
    }
    return job?.result?.title || "Material";
  }

  function formatElapsed(job) {
    const start = Date.parse(job?.createdAt || "");
    if (!Number.isFinite(start)) return "";
    const terminal = job.status === "succeeded" || job.status === "failed";
    const end = terminal
      ? (Date.parse(job.finishedAt || "") || Date.now())
      : Date.now();
    const sec = Math.max(0, Math.floor((end - start) / 1000));
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  function jobMetaLine(job) {
    const bits = [];
    if (job.mode) bits.push(job.mode === "deep" ? "Deep" : job.mode === "detailed" ? "Detailed" : job.mode === "rapid" ? "Rapid" : job.mode === "summary" ? "Summary" : String(job.mode));
    if (job.type === "quiz" && job.count) bits.push(`${job.count} questions`);
    if (job.type === "podcast") {
      bits.length = 0;
      bits.push(`~${lengthOf(job.body?.length).minutes} min`);
    }
    const out = job.result && typeof job.result === "object" ? job.result : null;
    if (out?.count != null && job.type === "flashcards") bits.push(`${out.count} cards`);
    if (out?.partial) bits.push("partial");
    if (out?.warning) bits.push(String(out.warning));
    if (out?.visualPageWarning) bits.push(out.visualPageCount != null ? `${out.visualPageCount} visual pages skipped` : "visual pages skipped");
    return bits.join(" · ");
  }

  function courseGenerationCards() {
    if (!state.activeCourseId) return [];
    return [...generations.values()]
      .filter((job) => (
        job.courseId === state.activeCourseId
        && job.status !== "succeeded"
      ))
      .sort((a, b) => (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0));
  }

  function generationCardsMarkup() {
    const cards = courseGenerationCards();
    if (!cards.length) return "";
    return `<div class="study-generation-list">${cards.map((job) => {
      const active = job.status === "running";
      const pillClass = job.status === "failed" ? "failed" : "reading";
      const stage = job.stage ? ` · ${job.stage}` : "";
      const elapsed = formatElapsed(job);
      const meta = jobMetaLine(job);
      const failed = job.status === "failed";
      const error = job.error || "Generation failed.";
      const icon = active ? spinner() : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>`;
      const action = active
        ? `<button class="study-gen-action" type="button" data-cancel-generation="${escapeHtml(job.id)}" aria-label="Cancel" title="Cancel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>`
        : failed
          ? `<button class="study-gen-action is-retry" type="button" data-retry-generation="${escapeHtml(job.id)}" aria-label="Retry" title="Retry"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg></button>`
          : "";
      const status = `${jobStatusLabel(job.status)}${stage}`;
      return `
        <article class="study-gen-card is-${escapeHtml(job.status || "running")}" data-gen-id="${escapeHtml(job.id)}">
          ${active ? `<span class="study-gen-wave" style="animation-delay: -${(Date.now() % 2400) / 1000}s" aria-hidden="true"></span>` : ""}
          <span class="study-gen-icon">${icon}</span>
          <div class="study-gen-body">
            <strong title="${escapeHtml(`${jobTypeLabel(job.type)} · ${jobSourceName(job)}`)}">${escapeHtml(jobTypeLabel(job.type))} · ${escapeHtml(jobSourceName(job))}</strong>
            <span class="study-gen-line" aria-live="polite">${meta ? `<span>${escapeHtml(meta)}</span>` : ""}<span class="study-status is-${escapeHtml(pillClass)}">${escapeHtml(status)}</span>${elapsed ? `<span class="study-gen-elapsed">${escapeHtml(elapsed)}</span>` : ""}</span>
            ${failed ? `<span class="study-gen-error" title="${escapeHtml(error)}">${escapeHtml(error)}</span>` : ""}
          </div>
          ${action}
        </article>`;
    }).join("")}</div>`;
  }

  function sourceFileIcon(doc) {
    if (doc?.kind === "website") return `<span class="dojo-file-icon is-website" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg></span>`;
    const ext = documentDisplayName(doc).split(".").pop().toLowerCase();
    const kind = ["pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx", "csv", "png", "jpg", "jpeg", "webp"].includes(ext) ? ext : String(doc?.kind || ext).toLowerCase();
    const type = ["pdf"].includes(kind) ? "pdf" : ["ppt", "pptx"].includes(kind) ? "slides" : ["doc", "docx"].includes(kind) ? "word" : ["xls", "xlsx", "csv"].includes(kind) ? "sheet" : ["png", "jpg", "jpeg", "webp", "image"].includes(kind) ? "image" : "file";
    const marks = {
      pdf: '<path d="M8 16c4-7 3-9 2-7-2 4 1 6 6 6-2-2-6-1-8 1Z"/>',
      slides: '<rect x="7" y="10" width="10" height="7" rx="1"/><path d="M12 17v2m-3 0h6"/>',
      word: '<path d="m7 11 2 7 3-5 3 5 2-7"/>',
      sheet: '<path d="M7 11h10M7 15h10M10 10v8m4-8v8"/>',
      image: '<circle cx="9" cy="11" r="1"/><path d="m7 18 4-4 2 2 2-3 3 5"/>',
      file: '<path d="M8 12h8M8 16h5"/>'
    };
    return `<span class="dojo-file-icon is-${type}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6"/>${marks[type]}</svg></span>`;
  }

  // Compact type tag for the create picker, so file names can drop their extension.
  function sourceBadge(doc) {
    if (doc?.kind === "website") return `<span class="dojo-source-badge is-website" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.6" ry="8.5"/><path d="M3.5 12h17"/></svg></span>`;
    const ext = documentDisplayName(doc).split(".").pop().toLowerCase();
    const [label, type] = doc?.kind === "text" ? ["TXT", "text"]
      : ext === "pdf" ? ["PDF", "pdf"]
        : ["ppt", "pptx"].includes(ext) ? ["PPT", "slides"]
          : ["doc", "docx"].includes(ext) ? ["DOC", "word"]
            : ["xls", "xlsx", "csv"].includes(ext) ? [ext === "csv" ? "CSV" : "XLS", "sheet"]
              : ["png", "jpg", "jpeg", "webp"].includes(ext) ? ["IMG", "image"]
                : ["FILE", "file"];
    return `<span class="dojo-source-badge is-${type}" aria-hidden="true">${label}</span>`;
  }

  function sourceShortName(doc) {
    const name = documentDisplayName(doc);
    if (doc?.kind === "website" || doc?.kind === "text") return name;
    return name.replace(/\.(pdf|pptx?|docx?|xlsx?|csv|png|jpe?g|webp|txt|md)$/i, "") || name;
  }

  function sortedSources() {
    return [...(state.studyMaterials?.documents || [])].sort((a, b) => sourceSort === "recent"
      ? (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
      : documentDisplayName(a).localeCompare(documentDisplayName(b), undefined, { numeric: true, sensitivity: "base" }) * (sourceSort === "desc" ? -1 : 1));
  }

  function sourcesHeaderMarkup() {
    return `<header class="dojo-panel-header"><h2>Sources</h2><div class="dojo-source-actions">
      <details class="dojo-source-sort"><summary class="study-icon-btn" aria-label="Sort sources" title="Sort sources">${icon("sort")}</summary><div class="dojo-sort-menu" role="group" aria-label="Source order">${[["recent", "Recently added"], ["asc", "Name · A–Z"], ["desc", "Name · Z–A"]].map(([value, label]) => `<button type="button" data-source-sort="${value}" aria-pressed="${sourceSort === value}">${label}<span aria-hidden="true">${sourceSort === value ? "✓" : ""}</span></button>`).join("")}</div></details>
      <button class="study-icon-btn dojo-collapse-sources" type="button" data-collapse-sources aria-expanded="${!sourcesCollapsed}" aria-label="Collapse sources" title="Collapse sources">${icon("sidebar")}</button>
    </div></header>`;
  }

  function sourcesRailMarkup() {
    const docs = sortedSources();
    return `<div class="dojo-source-rail"><button class="study-icon-btn" type="button" data-collapse-sources aria-expanded="false" aria-label="Expand sources" title="Expand sources">${icon("expand")}</button><span class="dojo-rail-label">Sources</span><span class="dojo-rail-count">${docs.length}</span><button class="study-icon-btn" type="button" data-study-add-files aria-label="Add sources" title="Add sources">${icon("plus")}</button><div class="dojo-rail-files">${docs.slice(0, 6).map(doc => `<button type="button" data-view-source="${escapeHtml(doc.id)}" aria-label="Open ${escapeHtml(documentDisplayName(doc))}" title="${escapeHtml(documentDisplayName(doc))}">${sourceFileIcon(doc)}</button>`).join("")}</div></div>`;
  }

  function materialsMarkup() {
    if (sourcePreviewId) return '<div class="dojo-source-preview-slot"></div>';
    const docs = sortedSources();
    return `<div class="study-materials" data-study-drop>
      <div class="dojo-add-source-row"><svg class="dojo-source-nudge" viewBox="0 0 36 30" fill="none" aria-hidden="true"><path d="M2 4c15 0 16 18 31 18m-8-7 8 7-9 4"/></svg><button class="study-dropzone" type="button" data-study-add-files>${icon("plus")}<span>Add sources</span></button><svg class="dojo-source-nudge dojo-source-nudge--right" viewBox="0 0 36 30" fill="none" aria-hidden="true"><path d="M2 4c15 0 16 18 31 18m-8-7 8 7-9 4"/></svg></div>
      <div class="dojo-source-caption">Course material <span>${docs.length}</span></div>
      <div class="study-material-board">
        ${pendingUploads.map(item => `<article class="study-material-card">${sourceFileIcon({ file_name: item.name })}<div class="study-material-copy"><strong>${escapeHtml(item.name)}</strong>${statusLine(item.status)}</div></article>`).join("")}
        ${docs.map(doc => `<article class="study-material-card"><button class="dojo-source-open" type="button" data-view-source="${escapeHtml(doc.id)}" title="${escapeHtml(documentDisplayName(doc))}">${sourceFileIcon(doc)}<span class="study-material-copy"><strong>${escapeHtml(documentDisplayName(doc))}</strong>${materialStatus(doc) === "ready" ? (["website", "text"].includes(doc.kind) ? `<small class="dojo-source-kind">${doc.kind === "website" ? "Website" : "Pasted text"}</small>` : "") : statusLine(materialStatus(doc))}</span></button>${materialMenu("doc", doc.id)}</article>`).join("")}
        ${!docs.length && !pendingUploads.length ? emptyState("Bring your knowledge", "Add files, a website, or pasted text. This is where your course begins.") : ""}
      </div>
    </div>`;
  }

  function togglePanel(panel, event) {
    const workspace = els.studyView.querySelector(".dojo-workspace");
    if (!workspace) return;
    const start = getComputedStyle(workspace).gridTemplateColumns;
    panelResizeAnimation?.cancel();
    if (panel === "sources") sourcesCollapsed = !sourcesCollapsed;
    else studioCollapsed = !studioCollapsed;
    const collapsed = panel === "sources" ? sourcesCollapsed : studioCollapsed;
    workspace.dataset[`${panel}Collapsed`] = String(collapsed);
    workspace.querySelectorAll(`[data-collapse-${panel}]`).forEach(button => button.setAttribute("aria-expanded", String(!collapsed)));
    workspace.dataset.sourceMotion = event.detail && !reducedMotion() ? "on" : "off";
    const end = getComputedStyle(workspace).gridTemplateColumns;
    if (workspace.dataset.sourceMotion === "on" && start !== end) {
      panelResizeAnimation = workspace.animate([
        { gridTemplateColumns: start }, { gridTemplateColumns: end }
      ], { duration: 270, easing: "cubic-bezier(.77, 0, .175, 1)" });
      panelResizeAnimation.onfinish = () => { panelResizeAnimation = null; };
    }
    workspace.querySelector(`.dojo-${panel === "sources" ? (collapsed ? "source-rail" : "sources-expanded") : (collapsed ? "studio-rail" : "studio-expanded")} [data-collapse-${panel}]`)?.focus({ preventScroll: true });
  }

  function animatePreviewResize(start, event) {
    const workspace = els.studyView.querySelector(".dojo-workspace");
    if (!workspace || !event?.detail || reducedMotion()) return;
    const end = getComputedStyle(workspace).gridTemplateColumns;
    if (start === end) return;
    panelResizeAnimation?.cancel();
    panelResizeAnimation = workspace.animate([{ gridTemplateColumns: start }, { gridTemplateColumns: end }], {
      duration: 280, easing: "cubic-bezier(.77, 0, .175, 1)"
    });
    panelResizeAnimation.onfinish = () => { panelResizeAnimation = null; };
  }

  function openSource(id, event, page = 1) {
    const doc = (state.studyMaterials?.documents || []).find(item => item.id === id);
    const attachment = Array.isArray(doc?.attachments) ? doc.attachments[0] : doc?.attachments;
    const attachmentId = doc?.attachment_id || attachment?.id;
    if (!attachmentId) { showToast("This source has no file preview."); return; }
    const start = getComputedStyle(els.studyView.querySelector(".dojo-workspace")).gridTemplateColumns;
    sourcePreviewId = id;
    sourcesCollapsed = false;
    quizMenuKey = "";
    render();
    animatePreviewResize(start, event);
    void openDocumentViewer({
      attachmentId,
      fileName: documentDisplayName(doc),
      format: doc.kind || "",
      page,
      container: els.studyView.querySelector(".dojo-source-preview-slot"),
      onClose: (closeEvent) => {
        if (sourcePreviewId !== id) return;
        const before = getComputedStyle(els.studyView.querySelector(".dojo-workspace")).gridTemplateColumns;
        sourcePreviewId = "";
        render();
        animatePreviewResize(before, closeEvent);
        els.studyView.querySelector(`[data-view-source="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      }
    });
  }

  function openStudioView(kind, id, event) {
    if (quizSession?.host === "panel") endPanelTest();
    const workspace = els.studyView.querySelector(".dojo-workspace");
    const start = workspace ? getComputedStyle(workspace).gridTemplateColumns : "";
    let layout = "column";
    try { layout = localStorage.getItem(deckLayoutKey) || layout; } catch { /* Storage is optional. */ }
    studioView = kind === "deck"
      ? { kind, id, cards: null, error: "", layout: DECK_LAYOUTS.some(([value]) => value === layout) ? layout : "column", query: "", searchOpen: false, sort: "original", flipIndex: 0, flipped: false, typed: {}, checked: new Set(), open: new Set() }
      : kind === "quiz" ? { kind, id, questions: null, error: "", open: new Set() }
        : kind === "podcast" ? { kind, id, podcast: null, error: "", speedOpen: false }
          : kind === "tutor" ? { kind, id, session: null, error: "" } : { kind, id };
    if (kind !== "podcast" || podcastAudio?.id !== id) podcastAudio?.pause();
    if (tutorCall && (kind !== "tutor" || tutorCall.id !== id)) tutorCall.pause();
    quizMenuKey = "";
    studioCollapsed = false;
    render();
    animatePreviewResize(start, event);
    els.studyView.querySelector(".dojo-studio-view [data-studio-back]")?.focus({ preventScroll: true });
    if (kind === "deck") void loadStudioCards();
    if (kind === "quiz") void loadStudioQuiz();
    if (kind === "podcast") void loadStudioPodcast();
    if (kind === "tutor") void loadStudioTutor();
  }

  function closeStudioView(event) {
    if (!studioView) return;
    const { kind, id } = studioView;
    if (quizSession?.host === "panel") endPanelTest();
    if (kind === "podcast") podcastAudio?.pause();
    if (kind === "tutor") tutorCall?.pause();
    const start = getComputedStyle(els.studyView.querySelector(".dojo-workspace")).gridTemplateColumns;
    studioView = null;
    for (const key of shownEntrances) if (key.startsWith("studio:")) shownEntrances.delete(key);
    render();
    animatePreviewResize(start, event);
    const attr = kind === "deck" ? "data-open-deck" : kind === "quiz" ? "data-open-quiz" : kind === "podcast" ? "data-open-podcast" : kind === "tutor" ? "data-open-tutor" : "data-open-note";
    els.studyView.querySelector(`[${attr}="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }

  function endPanelTest() {
    stopTestClock();
    quizSession = null;
  }

  async function loadStudioCards() {
    const view = studioView;
    const deck = findDeck(view?.id);
    if (!deck) return;
    try {
      const payload = await fetchStudyQueue(state.session, state.activeCourseId, deckSourceOf(deck));
      if (studioView !== view) return;
      view.cards = (payload?.cards || []).map(card => ({ ...card, starred: card.starred === true, sources: Array.isArray(card.sources) ? card.sources : [] }));
      view.error = "";
    } catch (error) {
      if (studioView !== view) return;
      view.error = error.message || "Please try again.";
    }
    patchStudio();
  }

  async function loadStudioQuiz() {
    const view = studioView;
    try {
      const payload = await fetchStudyQuiz(state.session, view.id);
      if (studioView !== view) return;
      view.questions = (payload?.quiz || payload)?.questions || [];
    } catch (error) {
      if (studioView !== view) return;
      view.error = error.message || "Please try again.";
    }
    patchStudio();
  }

  function ensurePodcastAudio() {
    podcastAudio ||= createPodcastAudio({
      onUpdate: patchPodcast,
      refreshUrl: async (id) => (await fetchStudyPodcast(state.session, id))?.podcast?.audioUrl || ""
    });
    return podcastAudio;
  }

  function podcastState() {
    const player = ensurePodcastAudio().state();
    return podcastAudio.id === studioView?.id ? player : { ...player, time: 0, playing: false, waiting: false };
  }

  async function loadStudioPodcast() {
    const view = studioView;
    try {
      const payload = await fetchStudyPodcast(state.session, view.id);
      if (studioView !== view) return;
      if (!payload?.podcast) throw new Error("This podcast is no longer available.");
      view.podcast = payload.podcast;
      ensurePodcastAudio().load(view.id, view.podcast.audioUrl);
    } catch (error) {
      if (studioView !== view) return;
      view.error = error.message || "Please try again.";
    }
    patchStudio({ keepScroll: false });
  }

  function podcastRoot() {
    if (studioView?.kind !== "podcast" || !studioView.podcast || podcastAudio?.id !== studioView.id) return null;
    return els.studyView?.querySelector('.dojo-studio-view[data-studio-kind="podcast"]') || null;
  }

  // Controls repaint for view changes such as the speed menu (never during a slider drag).
  function repaintPodcastPlayer(focusSelector = "") {
    const root = podcastRoot();
    const section = root?.querySelector(".dojo-pod-player");
    if (!section) return;
    const template = document.createElement("template");
    template.innerHTML = podcastViewMarkup(studioView, studioItem(), { escapeHtml, player: podcastState() });
    const next = template.content.querySelector(".dojo-pod-player");
    section.replaceWith(next);
    if (focusSelector) next.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  // Audio events patch the live DOM in place so playback, drags, and scroll are never disturbed.
  function patchPodcast(kind) {
    const root = podcastRoot();
    if (!root) return;
    if (kind === "error") {
      showToast("This episode could not play. Try opening it again.");
      return;
    }
    const player = podcastAudio.state();
    const section = root.querySelector(".dojo-pod-player");
    if (!section) return;
    if (kind === "state") {
      section.classList.toggle("is-playing", player.playing);
      section.classList.toggle("is-waiting", player.waiting);
      const toggle = section.querySelector("[data-pod-toggle]");
      const label = player.playing ? "Pause" : "Play";
      if (toggle && toggle.getAttribute("aria-label") !== label) {
        toggle.innerHTML = player.playing ? PLAYER_ICONS.pause : PLAYER_ICONS.play;
        toggle.setAttribute("aria-label", label);
        toggle.title = `${label} (Space)`;
      }
      const speed = section.querySelector("[data-pod-speed-toggle]");
      if (speed) {
        speed.querySelector("span").textContent = speedLabel(player.rate);
        speed.classList.toggle("is-on", player.rate !== 1);
        speed.setAttribute("aria-label", `Playback speed ${speedLabel(player.rate)}`);
      }
    }
    if (kind === "volume") {
      const wrap = section.querySelector(".dojo-pod-volume");
      const value = player.muted ? 0 : player.volume;
      wrap?.style.setProperty("--v", `${Math.round(value * 100)}%`);
      const range = wrap?.querySelector("[data-pod-volume]");
      if (range && document.activeElement !== range) range.value = String(value);
      const mute = wrap?.querySelector("[data-pod-mute]");
      if (mute) {
        mute.innerHTML = value === 0 ? PLAYER_ICONS.muted : PLAYER_ICONS.volume;
        mute.setAttribute("aria-label", player.muted ? "Unmute" : "Mute");
        mute.title = player.muted ? "Unmute" : "Mute";
      }
      return;
    }
    patchPodcastTime(root, player);
  }

  function patchPodcastTime(root, player) {
    const podcast = studioView.podcast;
    const duration = podcast.durationSeconds || 0;
    const time = studioView.scrubbing ?? player.time;
    const scrub = root.querySelector(".dojo-pod-scrub");
    const seek = scrub?.querySelector("[data-pod-seek]");
    if (seek) {
      if (studioView.scrubbing == null) seek.value = Math.min(time, duration).toFixed(2);
      scrub.style.setProperty("--p", `${duration ? Math.min(100, (time / duration) * 100).toFixed(3) : 0}%`);
      seek.setAttribute("aria-valuetext", `${formatTime(time)} of ${formatTime(duration)}`);
    }
    const now = root.querySelector("[data-pod-time]");
    if (now) now.textContent = formatTime(time);
    const left = root.querySelector("[data-pod-left]");
    if (left) left.textContent = `-${formatTime(Math.max(0, duration - time))}`;
    const index = activeLine(podcast.transcript, time);
    const list = root.querySelector("[data-pod-transcript]");
    if (!list || list.dataset.active === String(index)) return;
    list.dataset.active = String(index);
    let current = null;
    list.querySelectorAll("[data-pod-line]").forEach((line) => {
      const at = Number(line.dataset.podLine);
      line.classList.toggle("is-active", at === index);
      line.classList.toggle("is-past", at < index);
      if (at === index) current = line;
    });
    if (current && player.playing && Date.now() - transcriptScrolledAt > 4000) {
      const top = current.offsetTop - list.offsetTop - list.clientHeight * 0.28;
      list.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }

  function handlePodcastClick(event) {
    const audio = podcastAudio;
    if (!audio || !studioView.podcast || audio.id !== studioView.id) return false;
    if (studioView.speedOpen && !event.target.closest(".dojo-pod-speed")) {
      studioView.speedOpen = false;
      repaintPodcastPlayer();
    }
    if (event.target.closest("[data-pod-toggle]")) { void audio.toggle(); return true; }
    const skip = event.target.closest("[data-pod-skip]");
    if (skip) { audio.skip(Number(skip.dataset.podSkip)); return true; }
    if (event.target.closest("[data-pod-mute]")) { audio.toggleMute(); return true; }
    if (event.target.closest("[data-pod-speed-toggle]")) {
      studioView.speedOpen = !studioView.speedOpen;
      repaintPodcastPlayer(studioView.speedOpen ? `[data-pod-speed="${audio.state().rate}"]` : "[data-pod-speed-toggle]");
      return true;
    }
    const speed = event.target.closest("[data-pod-speed]");
    if (speed) {
      studioView.speedOpen = false;
      audio.setRate(Number(speed.dataset.podSpeed));
      repaintPodcastPlayer("[data-pod-speed-toggle]");
      return true;
    }
    const line = event.target.closest("[data-pod-line]");
    if (line) {
      transcriptScrolledAt = 0;
      audio.seek(Number(line.dataset.start), { play: true });
      return true;
    }
    return false;
  }

  function handlePodcastKey(event) {
    if (studioView?.kind !== "podcast" || !podcastAudio || podcastAudio.id !== studioView.id) return false;
    if (!event.target.closest?.('[data-studio-kind="podcast"]') || event.metaKey || event.ctrlKey || event.altKey) return false;
    const onRange = event.target.matches?.("input[type=range]");
    if (event.key === "Escape" && studioView.speedOpen) {
      studioView.speedOpen = false;
      repaintPodcastPlayer("[data-pod-speed-toggle]");
      return true;
    }
    if (event.key === " " && !event.target.matches?.("[data-pod-toggle], textarea, input:not([type=range])")) {
      event.preventDefault();
      void podcastAudio.toggle();
      return true;
    }
    if (!onRange && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      podcastAudio.skip(event.key === "ArrowRight" ? 10 : -10);
      return true;
    }
    if (event.key === "," || event.key === "<" || event.key === "." || event.key === ">") {
      podcastAudio.stepRate(event.key === "," || event.key === "<" ? -1 : 1);
      return true;
    }
    if (event.key === "m" || event.key === "M") {
      podcastAudio.toggleMute();
      return true;
    }
    return false;
  }

  // Repaint only the Create panel so the chat and source preview keep their state.
  function patchStudio({ keepScroll = true } = {}) {
    const current = els.studyView?.querySelector(".dojo-studio-expanded > .dojo-studio-content");
    if (!current) return;
    if (studioView && !studioItem()) { render(); return; }
    const scroll = current.querySelector(".dojo-view-body")?.scrollTop || 0;
    const template = document.createElement("template");
    template.innerHTML = practiceMarkup().trim();
    const next = template.content.firstElementChild;
    current.replaceWith(next);
    settleEntrances();
    mountTutorCall();
    const body = next.querySelector(".dojo-view-body");
    if (body && keepScroll) body.scrollTop = scroll;
  }

  function settle(node, key) {
    if (shownEntrances.has(key)) node.classList.add("is-settled");
    else shownEntrances.add(key);
  }

  function settleEntrances() {
    for (const card of els.studyView.querySelectorAll(".study-gen-card[data-gen-id]")) settle(card, `gen:${card.dataset.genId}`);
    const view = els.studyView.querySelector(".dojo-studio-view");
    if (!view || !studioView) return;
    const key = `studio:${studioView.kind}:${studioView.id}`;
    settle(view, key);
    const body = view.querySelector(".dojo-view-body");
    const ready = studioView.kind === "deck" ? studioView.cards : studioView.kind === "quiz" ? studioView.questions : studioView.kind === "podcast" ? studioView.podcast : studioView.kind === "tutor" ? studioView.session : true;
    if (body) settle(body, `${key}:${studioView.layout || ""}:${Boolean(ready || studioView.error)}`);
  }

  function patchDeckBody() {
    const root = els.studyView.querySelector(".dojo-studio-view[data-studio-kind=deck]");
    if (!root || !studioView?.cards) return;
    const body = root.querySelector("[data-deck-body]");
    body.classList.remove("is-settled");
    body.innerHTML = deckBodyMarkup(studioView, studioHelpers());
    const shown = root.querySelector("[data-deck-shown]");
    if (shown) shown.textContent = `${visibleDeckCards(studioView).length} / ${studioView.cards.length}`;
  }

  function currentFlipCard() {
    const cards = visibleDeckCards(studioView);
    return cards[Math.min(studioView.flipIndex, cards.length - 1)] || null;
  }

  function flipStudioCard(el) {
    studioView.flipped = !studioView.flipped;
    el.classList.toggle("is-flipped", studioView.flipped);
    el.setAttribute("aria-label", studioView.flipped ? "Show question" : "Show answer");
  }

  function navStudioFlip(delta) {
    const total = visibleDeckCards(studioView).length;
    const next = Math.max(0, Math.min(total - 1, studioView.flipIndex + delta));
    if (next === studioView.flipIndex) return;
    studioView.flipIndex = next;
    studioView.flipped = false;
    patchDeckBody();
    els.studyView.querySelector("[data-studio-flip]")?.focus({ preventScroll: true });
  }

  function patchTypingCard(id, focus) {
    const card = studioView.cards.find(item => item.id === id);
    const el = els.studyView.querySelector(`.dojo-qa.is-typing[data-card-id="${CSS.escape(id)}"]`);
    if (!card || !el) return;
    el.outerHTML = typingCardMarkup(card, studioView, studioHelpers());
    els.studyView.querySelector(`.dojo-qa.is-typing[data-card-id="${CSS.escape(id)}"] ${focus}`)?.focus({ preventScroll: true });
  }

  async function toggleDeckStar(button) {
    const card = studioView.cards?.find(item => item.id === button.dataset.deckStar);
    if (!card) return;
    const paint = () => {
      button.classList.toggle("is-on", card.starred);
      button.setAttribute("aria-pressed", String(card.starred));
      button.setAttribute("aria-label", card.starred ? "Unstar card" : "Star card");
      button.innerHTML = starIcon(card.starred);
    };
    card.starred = !card.starred;
    paint();
    try {
      await updateStudyCard(state.session, card.id, { starred: card.starred });
    } catch (error) {
      card.starred = !card.starred;
      paint();
      showToast(error.message || "Could not update the star.");
    }
  }

  function handleStudioClick(event) {
    if (!studioView) return false;
    const cite = event.target.closest("[data-cite-doc]");
    if (cite) {
      openSource(cite.dataset.citeDoc, event, Number(cite.dataset.citePage) || 1);
      return true;
    }
    if (!event.target.closest(".dojo-studio-view")) return false;
    if (handleTestClick(event)) return true;
    if (event.target.closest("[data-studio-back]")) { closeStudioView(event); return true; }
    if (studioView.kind === "podcast" && handlePodcastClick(event)) return true;
    if (studioView.kind === "tutor" && event.target.closest("[data-tutor-start]")) { void startTutorCall(); return true; }
    const full = event.target.closest("[data-studio-full], [data-studio-learn]");
    if (full) {
      if (studioView.kind === "note") openNote(studioView.id);
      else if (studioView.kind === "quiz") void startQuiz(studioView.id, full.matches("[data-studio-full]") ? "full" : "panel");
      else {
        const startId = full.matches("[data-studio-full]") && studioView.layout === "flip" ? currentFlipCard()?.id : "";
        void startReview(findDeck(studioView.id), { startId });
      }
      return true;
    }
    const layout = event.target.closest("[data-deck-layout]");
    if (layout) {
      studioView.layout = layout.dataset.deckLayout;
      studioView.flipped = false;
      try { localStorage.setItem(deckLayoutKey, studioView.layout); } catch { /* Storage is optional. */ }
      patchStudio({ keepScroll: false });
      els.studyView.querySelector(`[data-deck-layout="${CSS.escape(studioView.layout)}"]`)?.focus({ preventScroll: true });
      return true;
    }
    if (event.target.closest("[data-deck-search]")) {
      studioView.searchOpen = !studioView.searchOpen;
      if (!studioView.searchOpen) studioView.query = "";
      studioView.flipIndex = 0;
      patchStudio({ keepScroll: false });
      els.studyView.querySelector(studioView.searchOpen ? "[data-deck-query]" : "[data-deck-search]")?.focus();
      return true;
    }
    const sort = event.target.closest("[data-deck-sort]");
    if (sort) {
      studioView.sort = sort.dataset.deckSort;
      studioView.flipIndex = 0;
      studioView.flipped = false;
      patchStudio({ keepScroll: false });
      els.studyView.querySelector(".dojo-deck-sort summary")?.focus();
      return true;
    }
    const star = event.target.closest("[data-deck-star]");
    if (star) { void toggleDeckStar(star); return true; }
    const flip = event.target.closest("[data-studio-flip]");
    if (flip) { flipStudioCard(flip); return true; }
    const nav = event.target.closest("[data-flip-nav]");
    if (nav) { navStudioFlip(Number(nav.dataset.flipNav)); return true; }
    const typing = event.target.closest(".dojo-qa.is-typing");
    if (typing && event.target.closest("[data-typing-check]")) {
      studioView.checked.add(typing.dataset.cardId);
      patchTypingCard(typing.dataset.cardId, "[data-typing-retry]");
      return true;
    }
    if (typing && event.target.closest("[data-typing-retry]")) {
      studioView.checked.delete(typing.dataset.cardId);
      studioView.typed[typing.dataset.cardId] = "";
      patchTypingCard(typing.dataset.cardId, "textarea");
      return true;
    }
    return false;
  }

  function courseConversations() {
    const courseId = state.activeCourseId;
    const byId = new Map();
    for (const conv of state.studyProjectDetail?.conversations || []) {
      if (conv?.id) byId.set(conv.id, conv);
    }
    for (const conv of state.conversations || []) {
      if (!conv?.id || conv.project_id !== courseId) continue;
      const prev = byId.get(conv.id);
      byId.set(conv.id, prev ? { ...prev, ...conv } : conv);
    }
    return [...byId.values()].sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
  }

  function chatMarkup() {
    return `<div class="dojo-chat-content">
      <div class="dojo-messages-slot"></div>
      <div class="dojo-chat-welcome${state.activeConversationId || state.messages?.length ? " hidden" : ""}">
        <h2>What would you like to learn?</h2>
        <div class="dojo-prompts">${[["Course overview", "Give me an overview of this course"], ["Key concepts", "Explain the key concepts"], ["Study plan", "Help me make a study plan"]].map(([label, prompt]) => `<button type="button" data-dojo-prompt="${escapeHtml(prompt)}">${label}</button>`).join("")}</div>
      </div>
      <div class="study-composer-slot"></div>
    </div>`;
  }

  function recentChatsMarkup() {
    const conversations = courseConversations();
    return `<details class="dojo-chat-recent"><summary class="study-icon-btn" aria-label="Recent chats" title="Recent chats">${icon("recent")}</summary><div class="dojo-chat-recent-menu"><label class="dojo-chat-recent-search">${icon("search")}<input type="search" placeholder="Search history..." aria-label="Search chat history" autocomplete="off"></label><div class="dojo-chat-recent-list">${conversations.map(c => {
      const current = c.id === state.activeConversationId;
      return `<button type="button" data-open-chat-id="${escapeHtml(c.id)}" title="${escapeHtml(c.title || "New chat")}"${current ? ' class="is-current" aria-current="page"' : ""}><span class="dojo-chat-recent-title">${escapeHtml(c.title || "New chat")}</span>${current ? '<span class="dojo-chat-current-label">Current chat</span>' : ""}</button>`;
    }).join("") || '<p>No chats yet</p>'}<p class="dojo-chat-no-match" hidden>No matching chats</p></div></div></details>`;
  }

  function citeSourceName(id) {
    const doc = (state.studyMaterials?.documents || []).find(item => item.id === id);
    return doc ? documentDisplayName(doc).replace(/\.[a-z0-9]{2,5}$/i, "") : "";
  }

  function studioHelpers(interactive = true) {
    return { escapeHtml, starIcon, sourceName: citeSourceName, interactive };
  }

  function studioItem() {
    if (!studioView) return null;
    if (studioView.kind === "deck") return findDeck(studioView.id);
    if (studioView.kind === "quiz") return findQuiz(studioView.id);
    if (studioView.kind === "podcast") return findPodcast(studioView.id);
    if (studioView.kind === "tutor") return findTutor(studioView.id) || studioView.placeholder || null;
    return (state.studyMaterials?.notes || []).find(note => note.id === studioView.id) || null;
  }

  function studioViewMarkup(item) {
    if (studioView.kind === "deck") return deckViewMarkup(studioView, item, studioHelpers());
    if (studioView.kind === "podcast") return podcastViewMarkup(studioView, item, { escapeHtml, player: podcastState() });
    if (studioView.kind === "tutor") return tutorViewMarkup(studioView, item, { escapeHtml, callActive: Boolean(tutorCall?.active && tutorCall.id === studioView.id) });
    if (studioView.kind === "quiz") {
      if (quizSession?.host === "panel" && quizSession.quiz.id === studioView.id) {
        return `<div class="dojo-studio-content dojo-studio-view is-test" data-studio-kind="quiz">${testMarkup(quizSession, testHelpers("panel"))}</div>`;
      }
      return quizViewMarkup(studioView, item, { escapeHtml });
    }
    let body;
    try {
      body = isMindMap(item) ? mindMapMarkup(item) : renderContent(noteBody(item)) || `<pre>${escapeHtml(noteBody(item))}</pre>`;
    } catch {
      body = `<pre>${escapeHtml(noteBody(item))}</pre>`;
    }
    return noteViewMarkup(item, body, { escapeHtml, label: noteKindLabel(item) });
  }

  function practiceMarkup() {
    const openItem = studioItem();
    if (openItem) return studioViewMarkup(openItem);
    const decks = state.studyPractice?.decks || [];
    const quizzes = state.studyPractice?.quizzes || [];
    const notes = state.studyMaterials?.notes || [];
    const podcasts = state.studyPractice?.podcasts || [];
    const tutors = state.studyPractice?.tutors || [];
    const tools = [["flashcards", "Flashcards"], ["mindmap", "Mind map"], ["notes", "Notes"], ["quiz", "Practice test"], ["podcast", "Podcast"], ["tutor", "AI tutor"]];
    const artifacts = [
      ...decks.map(d => ({ ...d, pinKind: "deck", type: "flashcards", action: "data-open-deck", meta: `${d.cardCount || 0} cards`, menu: practiceMenu("deck", d.id) })),
      ...quizzes.map(q => ({ ...q, pinKind: "quiz", type: "quiz", action: "data-open-quiz", meta: `${q.questionCount || 0} questions`, menu: practiceMenu("quiz", q.id) })),
      ...podcasts.map(p => ({ ...p, pinKind: "podcast", type: "podcast", action: "data-open-podcast", meta: podcastMeta(p), menu: practiceMenu("podcast", p.id) })),
      ...tutors.map(t => ({ ...t, pinKind: "tutor", type: "tutor", action: "data-open-tutor", meta: tutorMeta(t), menu: t.status === "preparing" ? "" : practiceMenu("tutor", t.id) })),
      ...notes.map(n => ({ ...n, pinKind: "note", type: isMindMap(n) ? "mindmap" : "notes", action: "data-open-note", meta: isMindMap(n) ? "Mind map" : noteKindLabel(n), menu: materialMenu("note", n.id) }))
    ];
    artifacts.forEach(a => { a.pinned = pinnedCollection.has(collectionPinId(a.pinKind, a.id)); });
    artifacts.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return `<div class="dojo-studio-content">
      <div class="dojo-tools">${tools.map(([type, label]) => `<button class="dojo-tool dojo-tool--${type}" type="button" data-practice-create="${type}"><span class="dojo-tool-icon">${icon(type)}</span><span class="dojo-tool-arrow">${icon("plus")}</span><strong>${label}</strong></button>`).join("")}</div>
      ${generationCardsMarkup()}
      <div class="dojo-source-caption">Your collection <span>${artifacts.length}</span></div>
      <div class="dojo-artifacts">${artifacts.map(a => `<article class="study-practice-card"><button class="study-practice-open" type="button" ${a.action}="${escapeHtml(a.id)}"><span class="dojo-artifact-icon dojo-tool--${a.type}">${icon(a.type)}</span><span><strong>${a.pinned ? `<span class="dojo-pin-mark" title="Pinned">${icon("pin")}</span>` : ""}${escapeHtml(a.title || jobTypeLabel(a.type))}</strong><small>${escapeHtml(a.meta)}</small></span></button>${a.menu}</article>`).join("") || emptyState("Good things take practice", "Your flashcards, maps, notes, tests, podcasts, and tutor sessions will find a home here.")}</div>
    </div>`;
  }

  function tabMarkup() {
    const labels = { materials: "Sources", chat: "Ask", practice: "Create" };
    return `<div class="study-tabs" role="tablist" aria-label="Course sections">${TABS.map(tab => `<button class="${state.activeCourseTab === tab ? "active" : ""}" type="button" role="tab" aria-selected="${state.activeCourseTab === tab}" data-study-tab="${tab}">${labels[tab]}</button>`).join("")}</div>`;
  }

  function courseBodyMarkup() {
    if (studioView && !studioItem()) studioView = null;
    return `<div class="dojo-workspace" data-mobile-panel="${state.activeCourseTab}" data-sources-collapsed="${sourcesCollapsed}" data-studio-collapsed="${studioCollapsed}" data-source-preview="${Boolean(sourcePreviewId)}" data-studio-view="${Boolean(studioView)}">
      <section class="dojo-panel dojo-sources" aria-label="Sources">${sourcesRailMarkup()}<div class="dojo-sources-expanded">${sourcesHeaderMarkup()}${materialsMarkup()}</div></section>
      <section class="dojo-panel dojo-chat" aria-label="Ask"><header class="dojo-panel-header"><h2>Ask</h2><div class="dojo-chat-actions"><button class="study-icon-btn" type="button" data-dojo-new-chat aria-label="New course chat" title="New chat">${icon("plus")}</button>${recentChatsMarkup()}</div></header>${chatMarkup()}</section>
      <section class="dojo-panel dojo-studio" aria-label="Create">
        <div class="dojo-studio-rail"><button class="study-icon-btn" type="button" data-collapse-studio aria-expanded="false" aria-label="Expand create" title="Expand create">${icon("sidebar")}</button><span class="dojo-rail-label">Create</span><div class="dojo-rail-files">${["flashcards", "mindmap", "notes", "quiz", "podcast", "tutor"].map(type => `<button class="dojo-artifact-icon dojo-tool--${type}" type="button" data-practice-create="${type}" aria-label="Create ${type === "tutor" ? "an AI tutor session" : jobTypeLabel(type).toLowerCase()}" title="Create ${type === "tutor" ? "an AI tutor session" : jobTypeLabel(type).toLowerCase()}">${icon(type)}</button>`).join("")}</div></div>
        <div class="dojo-studio-expanded"><header class="dojo-panel-header"><h2>Create</h2><button class="study-icon-btn dojo-collapse-studio" type="button" data-collapse-studio aria-expanded="${!studioCollapsed}" aria-label="Collapse create" title="Collapse create">${icon("expand")}</button></header>${practiceMarkup()}</div>
      </section>
    </div>`;
  }

  function courseDetailMarkup() {
    return `<div class="study-detail" data-course-id="${escapeHtml(state.activeCourseId)}"><header class="study-detail-header">
      <div class="dojo-breadcrumb"><button class="study-back-btn" type="button" data-study-back>${icon("course")} Dojo</button><span>/</span><input class="study-title-input" value="${escapeHtml(courseName())}" maxlength="80" aria-label="Course name"></div>
      ${tabMarkup()}</header><div class="study-detail-body">${courseBodyMarkup()}</div></div>`;
  }

  function closeNoteDownloadMenu() {
    els.studyNoteDownloadMenu?.classList.add("hidden");
    els.studyNoteDownload?.setAttribute("aria-expanded", "false");
  }

  function noteFileName(ext) {
    const base = String(studyNote?.title || "summary").replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim() || "summary";
    return `${base}.${ext}`;
  }

  function setNoteDownloadBusy(busy) {
    const btn = els.studyNoteDownload;
    if (!btn) return;
    btn.disabled = busy;
    btn.classList.toggle("is-busy", busy);
    const spin = btn.querySelector(":scope > .study-spin");
    if (busy && !spin) {
      const next = document.createElement("span");
      next.className = "study-spin";
      next.setAttribute("aria-hidden", "true");
      btn.insertBefore(next, btn.firstChild);
    } else if (!busy) spin?.remove();
  }

  function renderNoteOverlay() {
    if (!els.studyNoteOverlay) return;
    const open = Boolean(studyNote);
    els.studyNoteOverlay.classList.toggle("hidden", !open);
    els.studyNoteOverlay.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) {
      if (els.studyNoteOverlay.open) els.studyNoteOverlay.close();
      closeNoteDownloadMenu();
      return;
    }
    if (!els.studyNoteOverlay.open) els.studyNoteOverlay.showModal();
    if (els.studyNoteTitle) els.studyNoteTitle.textContent = studyNote.title || "Note";
    if (els.studyNoteBody) {
      try {
        els.studyNoteBody.innerHTML = isMindMap(studyNote) ? mindMapMarkup(studyNote) : renderContent(noteBody(studyNote)) || `<pre>${escapeHtml(noteBody(studyNote))}</pre>`;
      } catch {
        els.studyNoteBody.innerHTML = `<pre>${escapeHtml(noteBody(studyNote))}</pre>`;
      }
    }
  }

  function bindMaterialsDnD() {
    const panel = els.studyView?.querySelector("[data-study-drop]");
    if (!panel) return;
    const zone = panel.querySelector(".study-dropzone");
    const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
    panel.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      zone?.classList.add("is-dragover");
    });
    panel.addEventListener("dragleave", (event) => {
      if (panel.contains(event.relatedTarget)) return;
      zone?.classList.remove("is-dragover");
    });
    panel.addEventListener("drop", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      zone?.classList.remove("is-dragover");
      zone?.classList.add("is-dropped");
      window.setTimeout(() => zone?.classList.remove("is-dropped"), 420);
      void uploadCourseFiles(event.dataTransfer?.files || []);
    });
  }

  function patchCourseChrome(detail) {
    detail.querySelectorAll("[data-study-tab]").forEach((btn) => {
      const on = btn.dataset.studyTab === state.activeCourseTab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
    });
  }

  function patchGenerationElapsed(root = els.studyView) {
    if (!root) return;
    for (const job of courseGenerationCards()) {
      const node = root.querySelector(`[data-gen-id="${job.id}"] .study-gen-elapsed`);
      const text = formatElapsed(job);
      if (node && text) node.textContent = text;
    }
  }

  function finishCoursePaint() {
    const preview = els.studyView.querySelector(".dojo-source-preview-slot");
    if (preview && sourcePreviewId && els.documentViewer && !document.body.classList.contains("document-viewer-fullscreen")) preview.append(els.documentViewer);
    const slot = els.studyView.querySelector(".study-composer-slot");
    if (slot && els.composerArea) { slot.append(els.composerArea); els.composerArea.classList.remove("hidden"); }
    const messagesSlot = els.studyView.querySelector(".dojo-messages-slot");
    if (messagesSlot && els.messages) {
      messagesSlot.append(els.messages);
      els.messages.classList.toggle("hidden", !state.activeConversationId && !state.messages?.length);
    }
    mountTutorCall();
    bindMaterialsDnD();
    renderNoteOverlay();
  }

  function parkMessages() {
    if (els.documentViewer && els.studyView?.contains(els.documentViewer)) els.studyView.after(els.documentViewer);
    if (els.messages && els.studyView?.contains(els.messages)) els.studyView.after(els.messages);
  }

  function visibleComposer() {
    return Boolean(els.composerArea);
  }

  function render() {
    if (!els.studyView) return;
    if (!state.session) {
      if (generations.size) abortAllGenerations();
    } else {
      pruneDeletedCourseGenerations();
    }
    const visible = studyVisible();
    if (podcastAudio && (!visible || !state.activeCourseId || studioView?.kind !== "podcast" || !studioItem())) podcastAudio.pause();
    if (tutorCall?.active && (!visible || !state.activeCourseId)) tutorCall.pause();
    els.studyView.classList.toggle("hidden", !visible);
    els.studyView.classList.toggle("study-view--detail", Boolean(visible && state.activeCourseId));
    els.studyHubButton?.classList.toggle("active", state.studyOpen);
    document.body.classList.toggle("study-open", visible);
    if (visible) {
      els.messages?.classList.add("hidden");
      els.chatPromptNav?.classList.add("hidden");
    }
    const chatReady = Boolean(visible && state.activeCourseId);
    if (visible) els.composerArea?.classList.toggle("hidden", !chatReady);
    if (!visible) {
      parkMessages();
      parkComposer();
      renderNoteOverlay();
      return;
    }
    if (!state.activeCourseId) {
      parkComposer();
      parkMessages();
      els.studyView.innerHTML = courseListMarkup();
      renderNoteOverlay();
      return;
    }
    const currentSourceScroll = els.studyView.querySelector(".study-material-board")?.scrollTop;
    const currentCollectionScroll = els.studyView.querySelector(".dojo-artifacts")?.scrollTop;
    const studioScroll = els.studyView.querySelector(".dojo-studio-view .dojo-view-body")?.scrollTop;
    if (currentSourceScroll != null) sourceListScrollTop = currentSourceScroll;
    if (currentCollectionScroll != null) collectionScrollTop = currentCollectionScroll;
    parkComposer();
    parkMessages();
    const detail = els.studyView.querySelector(".study-detail");
    if (!detail || detail.dataset.courseId !== state.activeCourseId) {
      els.studyView.innerHTML = courseDetailMarkup();
    } else {
      patchCourseChrome(detail);
      const body = detail.querySelector(".study-detail-body");
      if (body) body.innerHTML = courseBodyMarkup();
      else els.studyView.innerHTML = courseDetailMarkup();
    }
    finishCoursePaint();
    settleEntrances();
    const sourceList = els.studyView.querySelector(".study-material-board");
    const collectionList = els.studyView.querySelector(".dojo-artifacts");
    if (sourceList) sourceList.scrollTop = sourceListScrollTop;
    if (collectionList) collectionList.scrollTop = collectionScrollTop;
    const studioBody = els.studyView.querySelector(".dojo-studio-view .dojo-view-body");
    if (studioBody && studioScroll) studioBody.scrollTop = studioScroll;
    collectionList?.querySelector(".study-menu:not(.hidden)")?.scrollIntoView({ block: "nearest" });
  }

  function activeGenerationJobs() {
    return [...generations.values()].filter((job) => job.status === "running");
  }

  function stopElapsedTimer() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  function ensureElapsedTimer() {
    if (!activeGenerationJobs().length) {
      stopElapsedTimer();
      return;
    }
    if (elapsedTimer) return;
    elapsedTimer = setInterval(() => {
      if (!activeGenerationJobs().length) {
        stopElapsedTimer();
        return;
      }
      if (studyVisible() && state.activeCourseId) patchGenerationElapsed();
    }, 1000);
  }

  function abortAllGenerations() {
    for (const job of generations.values()) {
      try { job.controller?.abort(); } catch { /* ignore */ }
    }
    generations.clear();
    stopElapsedTimer();
  }

  function pruneDeletedCourseGenerations() {
    const courseIds = new Set(coursesFromProjects().map((course) => course.id));
    let changed = false;
    for (const [id, job] of [...generations.entries()]) {
      if (courseIds.has(job.courseId)) continue;
      try { job.controller?.abort(); } catch { /* ignore */ }
      generations.delete(id);
      changed = true;
    }
    if (changed) ensureElapsedTimer();
  }

  function toastForGeneration(job) {
    if (job.status === "failed") {
      showToast(job.error || "Could not generate.");
      return;
    }
    if (job.status !== "succeeded") return;
    const out = job.result && typeof job.result === "object" ? job.result : {};
    if (job.type === "flashcards") {
      const n = Number(out.count) || 0;
      showToast(n ? `${n} card${n === 1 ? "" : "s"} created` : "Flashcards ready");
    } else if (job.type === "quiz") {
      showToast("Quiz ready");
    } else if (job.type === "mindmap") {
      showToast("Mind map ready");
    } else if (job.type === "podcast") {
      showToast("Podcast ready");
    } else if (job.type === "notes") {
      showToast(job.mode === "detailed" ? "Detailed review ready" : "Summary ready");
    }
  }

  function requestKeyFor(kind, id, type, { count, mode } = {}) {
    return `${kind}:${id}:${type}:${mode || ""}:${count || ""}`;
  }

  function newGenerationId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function generationMatchesRequest(job, requestKey) {
    return job.requestKey === requestKey && job.status === "running";
  }

  async function pumpGeneration(job) {
    const courseId = job.courseId;
    try {
      let result = null;
      let completed = false;
      await generateStudyContent(state.session, courseId, job.body, {
        signal: job.controller.signal,
        onEvent(event) {
          if (event.type === "status") {
            job.stage = event.stage ? String(event.stage) : "";
            if (studyVisible() && state.activeCourseId === courseId) render();
            return;
          }
          if (event.type === "complete") {
            result = event.result ?? null;
            completed = true;
          }
        }
      });
      if (job.controller.signal.aborted || !generations.has(job.id)) return;
      if (!completed) throw new Error("Generation ended unexpectedly.");
      job.status = "succeeded";
      job.stage = "";
      job.result = result;
      job.finishedAt = new Date().toISOString();
      toastForGeneration(job);
      generations.delete(job.id);
      if (studyVisible() && state.activeCourseId === courseId) render();
      if (state.activeCourseId === courseId) {
        await Promise.all([
          loadMaterials(true).catch(() => {}),
          loadPractice(true).catch(() => {})
        ]);
      }
    } catch (error) {
      if (error?.name === "AbortError" || job.controller.signal.aborted) {
        generations.delete(job.id);
        return;
      }
      if (!generations.has(job.id)) return;
      job.status = "failed";
      job.stage = "";
      job.error = error?.message || "Could not generate.";
      job.finishedAt = new Date().toISOString();
      toastForGeneration(job);
    } finally {
      ensureElapsedTimer();
      if (studyVisible() && state.activeCourseId === courseId) render();
    }
  }

  function startGeneration({ kind, id, type, count, mode, body, requestKey, courseId }) {
    const job = {
      id: newGenerationId(),
      requestKey,
      courseId,
      type,
      mode: mode || "",
      count: type === "quiz" ? (Number(count) || 10) : undefined,
      documentFileId: kind === "doc" ? id : "",
      noteId: kind === "note" ? id : "",
      documentFileIds: Array.isArray(body.documentFileIds) ? body.documentFileIds : [],
      body,
      status: "running",
      stage: "",
      createdAt: new Date().toISOString(),
      finishedAt: "",
      result: null,
      error: "",
      controller: new AbortController()
    };
    generations.set(job.id, job);
    ensureElapsedTimer();
    void pumpGeneration(job);
    return job;
  }

  async function loadOnce(kind, hasCache, assign, force = false) {
    const id = state.activeCourseId;
    if (!id) return;
    if (!force && cacheCourseId === id && hasCache()) return;
    const key = `${kind}:${id}`;
    const pending = inflight.get(key);
    if (pending) {
      await pending;
      if (!force) return;
    }
    const promise = assign(id).finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  async function loadMaterials(force = false) {
    return loadOnce("materials", () => state.studyMaterials, async (id) => {
      const payload = await fetchStudyMaterials(state.session, id);
      if (state.activeCourseId !== id) return;
      state.studyMaterials = payload;
      cacheCourseId = id;
    }, force);
  }

  async function loadPractice(force = false) {
    return loadOnce("practice", () => state.studyPractice, async (id) => {
      const payload = await fetchStudyPractice(state.session, id);
      if (state.activeCourseId !== id) return;
      state.studyPractice = payload;
      cacheCourseId = id;
    }, force);
  }

  async function loadCourseDetail() {
    return loadOnce("detail", () => state.studyProjectDetail, async (id) => {
      const payload = await fetchProject(state.session, id);
      if (state.activeCourseId !== id) return;
      state.studyProjectDetail = payload;
      cacheCourseId = id;
    });
  }

  function prefetchCourse(id) {
    const jobs = [];
    if (!state.studyMaterials) jobs.push(loadMaterials());
    if (!state.studyPractice) jobs.push(loadPractice());
    if (!state.studyProjectDetail) jobs.push(loadCourseDetail());
    if (!jobs.length) return;
    Promise.all(jobs.map((job) => job.catch(() => {})));
  }

  async function loadCourse() {
    if (!state.activeCourseId) return;
    const id = state.activeCourseId;
    if (cacheCourseId && cacheCourseId !== id) {
      state.studyMaterials = null;
      state.studyPractice = null;
      state.studyProjectDetail = null;
      cacheCourseId = "";
    }
    await Promise.all([loadMaterials(), loadPractice(), loadCourseDetail()]);
    if (state.activeCourseId !== id) return;
    cacheCourseId = id;
    prefetchCourse(id);
  }

  function resetCourseCaches() {
    sourceDialog.close();
    sourcePreviewId = "";
    studioView = null;
    sourceListScrollTop = 0;
    collectionScrollTop = 0;
    sourcesCollapsed = false;
    cacheCourseId = "";
    state.studyMaterials = null;
    state.studyPractice = null;
    state.studyProjectDetail = null;
    pendingUploads = [];
    quizMenuKey = "";
    studyNote = null;
    closeCreateDialog();
  }

  async function openCourses({ replace = false } = {}) {
    if (!requireAuth() || blockChatNavigationWhileRunning()) return;
    if (state.images.some((item) => item.category === "document" && !item.attachmentId)) {
      showToast("Wait for the document upload to finish before opening Dojo.");
      return;
    }
    parkActiveConversationRun();
    clearClarification();
    closeSession();
    state.temporaryChat = false;
    state.studyOpen = true;
    state.projectsOpen = false;
    state.activeProjectId = "";
    state.activeProject = null;
    state.activeCourseId = "";
    state.activeCourseTab = "materials";
    state.activeConversationId = "";
    state.messages = [];
    state.images = [];
    renderImages();
    closeDocumentViewer();
    document.body.classList.remove("sidebar-open");
    syncStudyUrl({ replace });
    renderShell();
    const now = Date.now();
    if (now - projectsAt < 20000 && Array.isArray(state.projects)) return;
    loadProjects().then(() => {
      projectsAt = Date.now();
      if (studyVisible() && !state.activeCourseId) render();
    }).catch((error) => {
      showToast(error.message || "Could not load courses.");
    });
  }

  async function openCourse(courseId, { replace = false, tab } = {}) {
    if (!courseId || !requireAuth() || blockChatNavigationWhileRunning()) return;
    if (state.images.some((item) => item.category === "document" && !item.attachmentId)) {
      showToast("Wait for the document upload to finish before opening a course.");
      return;
    }
    parkActiveConversationRun();
    clearClarification();
    closeSession();
    state.temporaryChat = false;
    state.studyOpen = true;
    state.projectsOpen = false;
    state.activeProjectId = "";
    state.activeProject = null;
    if (cacheCourseId !== courseId) resetCourseCaches();
    state.activeCourseId = courseId;
    state.activeCourseTab = TABS.includes(tab) ? tab : "chat";
    state.activeConversationId = "";
    state.messages = [];
    state.images = [];
    renderImages();
    closeDocumentViewer();
    document.body.classList.remove("sidebar-open");
    syncStudyUrl({ replace });
    renderShell();
    try {
      await loadCourse();
      renderShell();
      if (state.activeCourseTab === "chat") els.promptInput?.focus();
    } catch (error) {
      state.activeCourseId = "";
      showToast(error.message || "Course could not be loaded.");
      await openCourses({ replace: true });
    }
  }

  function openCreateDialog() {
    if (!requireAuth()) return;
    if (els.courseNameInput) els.courseNameInput.value = "";
    if (els.courseTermInput) els.courseTermInput.value = "";
    els.courseCreateDialog?.showModal();
    window.requestAnimationFrame(() => els.courseNameInput?.focus());
  }

  function courseById(id) {
    return coursesFromProjects().find((item) => item.id === id)
      || (state.studyProjectDetail?.project?.id === id ? state.studyProjectDetail.project : null);
  }

  function openRenameDialog(courseId) {
    const course = courseById(courseId);
    if (!course || !els.courseRenameDialog) return;
    els.courseRenameDialog.dataset.courseId = courseId;
    if (els.courseRenameNameInput) els.courseRenameNameInput.value = course.name || "";
    if (els.courseRenameTermInput) els.courseRenameTermInput.value = courseMeta(course).term || "";
    els.courseRenameDialog.showModal();
    window.requestAnimationFrame(() => els.courseRenameNameInput?.focus());
  }

  async function submitCreate(event) {
    event.preventDefault();
    const name = els.courseNameInput?.value.trim();
    if (!name) return;
    const term = els.courseTermInput?.value.trim() || "";
    try {
      const meta = {};
      if (term) meta.term = term;
      const payload = await createProject(state.session, name, { kind: "course", meta });
      state.projects = [payload.project, ...state.projects];
      els.courseCreateDialog?.close();
      await openCourse(payload.project.id);
    } catch (error) {
      showToast(error.message || "Course could not be created.");
    }
  }

  async function submitRename(event) {
    event.preventDefault();
    const id = els.courseRenameDialog?.dataset.courseId;
    const name = els.courseRenameNameInput?.value.trim();
    if (!id || !name) return;
    const term = els.courseRenameTermInput?.value.trim() || "";
    try {
      const payload = await updateProject(state.session, id, { name, meta: { ...courseMeta(courseById(id)), term } });
      state.projects = state.projects.map((item) => item.id === payload.project.id ? payload.project : item);
      if (state.studyProjectDetail?.project?.id === id) state.studyProjectDetail.project = payload.project;
      els.courseRenameDialog.close();
      render();
      showToast("Course renamed.");
    } catch (error) {
      showToast(error.message || "Course could not be renamed.");
    }
  }

  async function saveCourseName(name) {
    if (!state.activeCourseId || !name || name === courseName()) return;
    try {
      const payload = await updateProject(state.session, state.activeCourseId, { name });
      state.projects = state.projects.map((item) => item.id === payload.project.id ? payload.project : item);
      if (state.studyProjectDetail?.project) state.studyProjectDetail.project = payload.project;
      render();
      showToast("Course renamed.");
    } catch (error) {
      showToast(error.message || "Course could not be renamed.");
    }
  }

  function findCourseChat(id) {
    return courseConversations().find((item) => item.id === id);
  }

  function patchCourseChat(id, patch) {
    const apply = (list) => (list || []).map((item) => item.id === id ? { ...item, ...patch } : item);
    const index = (state.conversations || []).findIndex((item) => item.id === id);
    if (index >= 0) state.conversations[index] = { ...state.conversations[index], ...patch };
    else state.conversations.unshift({ id, project_id: state.activeCourseId, ...patch });
    if (state.studyProjectDetail?.conversations) {
      const has = state.studyProjectDetail.conversations.some((item) => item.id === id);
      state.studyProjectDetail = {
        ...state.studyProjectDetail,
        conversations: has
          ? apply(state.studyProjectDetail.conversations)
          : [{ id, project_id: state.activeCourseId, ...patch }, ...state.studyProjectDetail.conversations]
      };
    }
  }

  function openRenameCourseChat(id) {
    const conversation = findCourseChat(id);
    if (!conversation) return;
    quizMenuKey = "";
    render();
    openTitleRename({
      title: "Rename chat",
      value: conversation.title || "New chat",
      onSave: (title) => saveCourseChatTitle(id, title)
    });
  }

  async function saveCourseChatTitle(id, title) {
    const payload = await updateConversation(state.session, id, { title });
    patchCourseChat(id, payload?.conversation || { title });
    render();
    showToast("Chat renamed.");
  }

  function confirmDeleteCourseChat(id) {
    const conversation = findCourseChat(id);
    if (!conversation) return;
    quizMenuKey = "";
    render();
    if (!state.conversations.some((item) => item.id === id)) state.conversations.unshift(conversation);
    openDeleteConfirm({
      title: "Delete chat?",
      body: `Delete "${conversation.title || "New chat"}" from your account?`,
      chatId: id
    });
  }

  function confirmDeleteCourse(courseId) {
    const course = courseById(courseId);
    openDeleteConfirm({
      title: "Delete course?",
      body: `Delete "${course?.name || "this course"}", its chats, and its study material?`,
      projectId: courseId
    });
  }

  function practiceCardEl(attr, id) {
    const nodes = els.studyView?.querySelectorAll(`[${attr}]`) || [];
    for (const node of nodes) {
      if (node.getAttribute(attr) === id) return node.closest(".study-practice-card") || node;
    }
    return null;
  }

  function leavePracticeCard(el) {
    if (!el || reducedMotion()) return Promise.resolve();
    el.classList.add("is-leaving");
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      el.addEventListener("animationend", finish, { once: true });
      setTimeout(finish, 280);
    });
  }

  function dropPractice(listKey, id) {
    if (!state.studyPractice?.[listKey]) return;
    state.studyPractice = {
      ...state.studyPractice,
      [listKey]: state.studyPractice[listKey].filter((item) => item.id !== id)
    };
  }

  function patchPracticeTitle(listKey, id, title) {
    if (!state.studyPractice?.[listKey]) return;
    state.studyPractice = {
      ...state.studyPractice,
      [listKey]: state.studyPractice[listKey].map((item) => item.id === id ? { ...item, title } : item)
    };
  }

  function openRenameDeckDialog(deckId) {
    const deck = findDeck(deckId);
    if (!deck) return;
    quizMenuKey = "";
    render();
    openTitleRename({
      title: "Rename deck",
      value: deck.title || "",
      onSave: (title) => saveDeckTitle(deck.id, title)
    });
  }

  async function saveDeckTitle(deckId, title) {
    const deck = findDeck(deckId);
    if (!deck || !state.activeCourseId) return;
    const payload = await updateStudyDeck(state.session, state.activeCourseId, {
      ...deckSourceOf(deck),
      title
    });
    patchPracticeTitle("decks", deckId, payload?.title || title);
    render();
    showToast("Deck renamed.");
  }

  function confirmDeleteDeck(deckId) {
    const deck = findDeck(deckId);
    if (!deck) return;
    quizMenuKey = "";
    render();
    const count = Number(deck.cardCount) || 0;
    openDeleteConfirm({
      title: "Delete deck?",
      body: `Delete "${deck.title || "this deck"}" and its ${count} card${count === 1 ? "" : "s"}?`,
      onConfirm: () => deleteDeck(deck)
    });
  }

  async function deleteDeck(deck) {
    if (!state.activeCourseId) return;
    try {
      await deleteStudyDeck(state.session, state.activeCourseId, deckSourceOf(deck));
      if (reviewSession?.deckId === deck.id) closeSession();
      await leavePracticeCard(practiceCardEl("data-open-deck", deck.id));
      dropPractice("decks", deck.id);
      render();
      showToast("Deck deleted.");
      loadPractice(true).catch(() => {});
    } catch (error) {
      showToast(error.message || "Deck could not be deleted.");
    }
  }

  function openRenameQuizDialog(quizId) {
    const quiz = findQuiz(quizId);
    if (!quiz) return;
    quizMenuKey = "";
    render();
    openTitleRename({
      title: "Rename quiz",
      value: quiz.title || "",
      onSave: (title) => saveQuizTitle(quiz.id, title)
    });
  }

  async function saveQuizTitle(quizId, title) {
    const quiz = findQuiz(quizId);
    if (!quiz) return;
    const payload = await updateStudyQuiz(state.session, quizId, { title });
    const nextTitle = payload?.title || title;
    patchPracticeTitle("quizzes", quizId, nextTitle);
    if (quizSession?.quiz?.id === quizId) quizSession.quiz.title = nextTitle;
    render();
    showToast("Quiz renamed.");
  }

  function confirmDeleteQuiz(quizId) {
    const quiz = findQuiz(quizId);
    if (!quiz) return;
    quizMenuKey = "";
    render();
    const count = Number(quiz.questionCount) || 0;
    openDeleteConfirm({
      title: "Delete quiz?",
      body: `Delete "${quiz.title || "this quiz"}" and its ${count} question${count === 1 ? "" : "s"}?`,
      onConfirm: () => deleteQuiz(quiz)
    });
  }

  async function deleteQuiz(quiz) {
    if (!state.activeCourseId) return;
    try {
      await deleteStudyQuiz(state.session, quiz.id);
      if (quizSession?.quiz?.id === quiz.id) closeSession();
      await leavePracticeCard(practiceCardEl("data-open-quiz", quiz.id));
      dropPractice("quizzes", quiz.id);
      render();
      showToast("Quiz deleted.");
      loadPractice(true).catch(() => {});
    } catch (error) {
      showToast(error.message || "Quiz could not be deleted.");
    }
  }

  function openRenamePodcastDialog(podcastId) {
    const podcast = findPodcast(podcastId);
    if (!podcast) return;
    quizMenuKey = "";
    render();
    openTitleRename({
      title: "Rename podcast",
      value: podcast.title || "",
      onSave: (title) => savePodcastTitle(podcast.id, title)
    });
  }

  async function savePodcastTitle(podcastId, title) {
    const payload = await updateStudyPodcast(state.session, podcastId, { title });
    const nextTitle = payload?.title || title;
    patchPracticeTitle("podcasts", podcastId, nextTitle);
    if (studioView?.kind === "podcast" && studioView.id === podcastId && studioView.podcast) studioView.podcast.title = nextTitle;
    render();
    showToast("Podcast renamed.");
  }

  /* ---------- AI tutor ---------- */

  let tutorCallSession = null;
  const tutorRecapRetried = new Set();

  function mountTutorCall() {
    const slot = els.studyView?.querySelector(".dojo-tutor-slot");
    if (!slot || !tutorCall?.active) return;
    slot.append(tutorCall.root);
    tutorCall.mounted();
  }

  function tutorListItem(session) {
    return { id: session.id, title: session.title, style: session.style, voice: session.voice, status: session.status, activeSeconds: session.activeSeconds || 0, createdAt: session.createdAt };
  }

  function upsertTutor(item) {
    const list = state.studyPractice?.tutors || [];
    const exists = list.some((entry) => entry.id === item.id);
    state.studyPractice = {
      ...(state.studyPractice || {}),
      tutors: exists ? list.map((entry) => entry.id === item.id ? { ...entry, ...item } : entry) : [item, ...list]
    };
  }

  // The lesson is planned before any call starts; the view shows each stage as it happens.
  async function prepareTutor(ids, options) {
    const courseId = state.activeCourseId;
    const documentFileIds = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!courseId || !state.session || !documentFileIds.length) return;
    const placeholder = { id: `preparing-${newGenerationId()}`, title: "New tutor session", style: options.style, status: "preparing", createdAt: new Date().toISOString() };
    upsertTutor(placeholder);
    openStudioView("tutor", placeholder.id);
    Object.assign(studioView, { preparing: true, stage: "reading", placeholder });
    patchStudio({ keepScroll: false });
    const isMine = () => studioView?.kind === "tutor" && studioView.id === placeholder.id;
    try {
      const result = await prepareStudyTutor(state.session, courseId, {
        documentFileIds,
        style: options.style,
        voice: options.voice,
        instructions: options.instructions || ""
      }, {
        onEvent: (event) => {
          if (event.type !== "status" || !isMine()) return;
          studioView.stage = event.stage;
          patchStudio();
        }
      });
      dropPractice("tutors", placeholder.id);
      if (state.activeCourseId === courseId) upsertTutor(tutorListItem(result.session));
      if (isMine()) studioView = { kind: "tutor", id: result.session.id, session: result.session, error: "" };
      else showToast("Your lesson plan is ready.");
      if (result.warning) showToast(result.warning);
      render();
    } catch (error) {
      dropPractice("tutors", placeholder.id);
      if (isMine()) studioView.error = error.message || "Please try again.";
      else showToast(error.message || "Could not plan the lesson.");
      render();
    }
  }

  async function loadStudioTutor() {
    const view = studioView;
    if (!view || view.kind !== "tutor" || String(view.id).startsWith("preparing-")) return;
    if (tutorCall?.active && tutorCall.id === view.id) {
      view.session = tutorCallSession;
      patchStudio({ keepScroll: false });
      return;
    }
    try {
      const payload = await fetchStudyTutor(state.session, view.id);
      if (studioView !== view) return;
      if (!payload?.session) throw new Error("This session is no longer available.");
      view.session = payload.session;
      const talked = payload.session.transcript.some((line) => line.role === "student");
      // A call cut off mid-way (a closed tab) or a recap that failed is wrapped up here, once.
      if (payload.session.status === "live" || (payload.session.status === "ended" && !payload.session.summary && talked && !tutorRecapRetried.has(view.id))) {
        tutorRecapRetried.add(view.id);
        view.finishing = true;
        patchStudio({ keepScroll: false });
        const ended = await endStudyTutor(state.session, view.id, {});
        if (ended?.session) upsertTutor(tutorListItem(ended.session));
        if (studioView !== view) return;
        view.session = ended?.session || view.session;
        view.finishing = false;
        render();
        return;
      }
    } catch (error) {
      if (studioView !== view) return;
      view.finishing = false;
      view.error = error.message || "Please try again.";
    }
    patchStudio({ keepScroll: false });
  }

  async function startTutorCall() {
    const session = studioView?.kind === "tutor" ? studioView.session : null;
    if (!session || session.status !== "ready") return;
    if (tutorCall?.active) {
      if (tutorCall.id !== session.id) showToast("Finish your other tutor call first.");
      return;
    }
    tutorCallSession = session;
    tutorCall = createTutorCall({
      session,
      escapeHtml,
      reducedMotion: reducedMotion(),
      onToast: showToast,
      api: {
        turn: (id, body, options) => streamTutorTurn(state.session, id, body, options),
        transcribe: (id, blob, options) => transcribeTutorAudio(state.session, id, blob, options),
        end: (id, body) => endStudyTutor(state.session, id, body)
      },
      onFinished: (ended) => finishTutorCall(session.id, ended)
    });
    upsertTutor({ ...tutorListItem(session), status: "live" });
    render();
    await tutorCall.start();
  }

  function finishTutorCall(id, ended) {
    tutorCall = null;
    tutorCallSession = null;
    if (ended) upsertTutor(tutorListItem(ended));
    if (studioView?.kind === "tutor" && studioView.id === id) {
      studioView.session = ended || { ...studioView.session, status: "ended" };
    }
    render();
  }

  function openRenameTutorDialog(sessionId) {
    const item = findTutor(sessionId);
    if (!item) return;
    quizMenuKey = "";
    render();
    openTitleRename({
      title: "Rename session",
      value: item.title || "",
      onSave: (title) => saveTutorTitle(item.id, title)
    });
  }

  async function saveTutorTitle(sessionId, title) {
    const payload = await updateStudyTutor(state.session, sessionId, { title });
    const nextTitle = payload?.title || title;
    patchPracticeTitle("tutors", sessionId, nextTitle);
    if (studioView?.kind === "tutor" && studioView.id === sessionId && studioView.session) studioView.session.title = nextTitle;
    render();
    showToast("Session renamed.");
  }

  function confirmDeleteTutor(sessionId) {
    const item = findTutor(sessionId);
    if (!item) return;
    quizMenuKey = "";
    render();
    if (tutorCall?.active && tutorCall.id === sessionId) {
      showToast("End the call before deleting it.");
      return;
    }
    openDeleteConfirm({
      title: "Delete tutor session?",
      body: `Delete "${item.title || "this session"}" with its lesson plan, transcript, and recap?`,
      onConfirm: () => deleteTutor(item)
    });
  }

  async function deleteTutor(item) {
    if (!state.activeCourseId) return;
    try {
      await deleteStudyTutor(state.session, item.id);
      if (studioView?.kind === "tutor" && studioView.id === item.id) studioView = null;
      await leavePracticeCard(practiceCardEl("data-open-tutor", item.id));
      dropPractice("tutors", item.id);
      render();
      showToast("Session deleted.");
    } catch (error) {
      showToast(error.message || "Session could not be deleted.");
    }
  }

  function confirmDeletePodcast(podcastId) {
    const podcast = findPodcast(podcastId);
    if (!podcast) return;
    quizMenuKey = "";
    render();
    openDeleteConfirm({
      title: "Delete podcast?",
      body: `Delete "${podcast.title || "this podcast"}" and its audio?`,
      onConfirm: () => deletePodcast(podcast)
    });
  }

  async function deletePodcast(podcast) {
    if (!state.activeCourseId) return;
    try {
      await deleteStudyPodcast(state.session, podcast.id);
      if (podcastAudio?.id === podcast.id) podcastAudio.unload();
      await leavePracticeCard(practiceCardEl("data-open-podcast", podcast.id));
      dropPractice("podcasts", podcast.id);
      render();
      showToast("Podcast deleted.");
      loadPractice(true).catch(() => {});
    } catch (error) {
      showToast(error.message || "Podcast could not be deleted.");
    }
  }

  function confirmDeleteDoc(docId) {
    const doc = (state.studyMaterials?.documents || []).find((item) => item.id === docId);
    if (!doc) return;
    quizMenuKey = "";
    render();
    openDeleteConfirm({
      title: "Remove file?",
      body: `Remove "${documentDisplayName(doc)}" from materials? Notes, flashcards, and quizzes you made from it will stay.`,
      onConfirm: () => deleteDoc(doc)
    });
  }

  async function deleteDoc(doc) {
    if (!state.activeCourseId) return;
    try {
      await deleteStudyMaterial(state.session, state.activeCourseId, doc.id);
      if (state.studyMaterials) {
        state.studyMaterials = {
          ...state.studyMaterials,
          documents: (state.studyMaterials.documents || []).filter((item) => item.id !== doc.id)
        };
      }
      await Promise.all([loadMaterials(), loadPractice().catch(() => {})]);
      render();
      showToast("File removed.");
    } catch (error) {
      showToast(error.message || "File could not be removed.");
    }
  }

  function confirmDeleteNote(noteId) {
    const note = (state.studyMaterials?.notes || []).find((item) => item.id === noteId);
    if (!note) return;
    quizMenuKey = "";
    render();
    openDeleteConfirm({
      title: "Delete note?",
      body: `Delete "${note.title || noteKindLabel(note)}"? This will also delete its flashcard decks and quizzes.`,
      onConfirm: () => deleteNote(note)
    });
  }

  async function deleteNote(note) {
    if (!state.activeCourseId) return;
    try {
      await deleteStudyNote(state.session, note.id);
      if (studyNote?.id === note.id) closeNote();
      if (state.studyMaterials) {
        state.studyMaterials = {
          ...state.studyMaterials,
          notes: (state.studyMaterials.notes || []).filter((item) => item.id !== note.id)
        };
      }
      await Promise.all([loadMaterials(), loadPractice().catch(() => {})]);
      render();
      showToast("Note deleted.");
    } catch (error) {
      showToast(error.message || "Note could not be deleted.");
    }
  }

  async function waitForDocument(attachmentId, fileName) {
    while (state.session) {
      const payload = await fetchDocumentStatus(state.session, attachmentId);
      const doc = payload.document || {};
      if (doc.usable) return doc;
      if (doc.status === "failed" && !doc.usable) {
        throw new Error(doc.error?.message || `${fileName || "Document"} could not be processed.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    throw new Error(`${fileName || "Document"} processing stopped because the session ended.`);
  }

  async function uploadCourseFiles(files) {
    const accepted = [...files].filter(isStudyFile);
    if (!accepted.length) {
      showToast("Choose a PDF, Word, Excel, PowerPoint, CSV, or image file.");
      return;
    }
    if (!state.activeCourseId) return;
    const courseId = state.activeCourseId;
    state.studyUploading = true;
    const locals = accepted.map((file) => ({
      id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      status: "uploading",
      file
    }));
    pendingUploads = [...pendingUploads, ...locals];
    render();
    try {
      const results = await Promise.allSettled(locals.map(async (item) => {
        const category = String(item.file.type || "").startsWith("image/") ? "image" : "document";
        const { upload: presigned, file: uploadFile } = await presignUpload(state.session, item.file, category, { projectId: courseId });
        try {
          await putUploadContent(state.session, presigned, uploadFile, category);
          const completed = await completeUpload(state.session, presigned.uploadId);
          if (category === "image") {
            // The transcript note is available immediately, so the placeholder
            // is swapped for the note card in a single render.
            if (state.activeCourseId === courseId) {
              pendingUploads = pendingUploads.filter((row) => row.id !== item.id);
              if (completed?.note && state.studyMaterials) {
                state.studyMaterials = {
                  ...state.studyMaterials,
                  notes: [completed.note, ...(state.studyMaterials.notes || [])]
                };
              }
              if (!completed?.note) {
                showToast("Image uploaded, but transcription failed — try re-uploading.");
              }
              render();
            }
            return;
          }
          // Keep the placeholder visible (now "Reading") until the refreshed
          // material list can take its place; removing it early makes the file
          // vanish and reappear.
          item.status = "reading";
          if (state.activeCourseId === courseId) render();
          if (!completed?.document?.usable) {
            await waitForDocument(completed.id, item.name);
          }
        } catch (error) {
          await deleteAttachment(state.session, presigned.uploadId).catch(() => {});
          throw error;
        }
      }));
      const failures = results
        .map((result, index) => result.status === "rejected" ? {
          name: locals[index].name,
          error: result.reason?.message || "Upload failed."
        } : null)
        .filter(Boolean);
      if (state.studyOpen && state.activeCourseId === courseId && results.some((result) => result.status === "fulfilled")) {
        state.studyMaterials = null;
        await loadMaterials();
      }
      if (failures.length) {
        const detail = failures.map(({ name, error }) => `${name}: ${error}`).join("; ");
        showToast(failures.length === locals.length
          ? `Files could not be uploaded. ${detail}`
          : `Some files could not be uploaded. ${detail}`);
      }
    } catch (error) {
      showToast(error.message || "Files could not be uploaded.");
    } finally {
      pendingUploads = pendingUploads.filter((row) => !locals.some((item) => item.id === row.id));
      state.studyUploading = false;
      if (state.activeCourseId === courseId) render();
    }
  }

  async function runGenerate(kind, id, type, { count, mode, ...options } = {}) {
    if (!state.activeCourseId || !state.session) return;
    const courseId = state.activeCourseId;
    const requestKey = requestKeyFor(kind, id, type, { count, mode });
    if ([...generations.values()].some((job) => job.courseId === courseId && generationMatchesRequest(job, requestKey))) {
      return;
    }
    if (type === "flashcards") {
      const flashBusy = [...generations.values()].some((job) => (
        job.courseId === courseId
        && job.status === "running"
        && job.type === "flashcards"
        && (kind === "doc" ? job.documentFileId === id : job.noteId === id)
      ));
      if (flashBusy) return;
    }
    const body = { type, ...options };
    if (kind === "doc") body.documentFileId = id;
    else body.noteId = id;
    if (type === "quiz") body.count = Number(count) || 10;
    if (type === "flashcards") body.mode = mode === "deep" ? "deep" : "rapid";
    if (type === "notes") body.mode = mode === "detailed" ? "detailed" : "summary";
    quizMenuKey = "";
    startGeneration({
      kind,
      id,
      type,
      count: body.count,
      mode: body.mode || "",
      body,
      requestKey,
      courseId
    });
    render();
  }

  function cancelGeneration(jobId) {
    const job = generations.get(jobId);
    if (!job || job.status !== "running") return;
    try { job.controller.abort(); } catch { /* ignore */ }
    generations.delete(jobId);
    ensureElapsedTimer();
    render();
  }

  function retryGeneration(jobId) {
    const job = generations.get(jobId);
    if (!job || job.status !== "failed" || !state.session) return;
    const ids = Array.isArray(job.body?.documentFileIds) ? job.body.documentFileIds : job.documentFileIds;
    generations.delete(jobId);
    if (ids?.length) {
      void runGenerateFromMaterials(ids, job.type, { ...job.body, count: job.count, mode: job.mode });
      return;
    }
    const kind = job.documentFileId ? "doc" : "note";
    const id = job.documentFileId || job.noteId;
    if (!id || !job.type) return;
    void runGenerate(kind, id, job.type, { ...job.body, count: job.count, mode: job.mode });
  }

  function runGenerateFromMaterials(ids, type, { count, mode, ...options } = {}) {
    const documentFileIds = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!state.activeCourseId || !state.session || !documentFileIds.length) return;
    if (documentFileIds.length === 1 && type !== "flashcards") {
      return runGenerate("doc", documentFileIds[0], type, { count, mode, ...options });
    }
    const courseId = state.activeCourseId;
    const requestKey = `docs:${documentFileIds.slice().sort().join(",")}:${type}:${mode || ""}:${count || ""}`;
    if ([...generations.values()].some((job) => job.courseId === courseId && generationMatchesRequest(job, requestKey))) {
      return;
    }
    const body = { type, documentFileIds, ...options };
    if (type === "notes") body.mode = mode === "detailed" ? "detailed" : "summary";
    if (type === "quiz") body.count = Number(count) || 10;
    if (type === "flashcards") body.mode = mode === "deep" ? "deep" : "rapid";
    quizMenuKey = "";
    startGeneration({
      kind: "docs",
      id: "",
      type,
      count: body.count,
      mode: body.mode || "",
      body,
      requestKey,
      courseId
    });
    render();
  }

  function readyCreateDocs() {
    return (state.studyMaterials?.documents || []).filter((doc) => materialStatus(doc) === "ready");
  }

  function renderCreateList() {
    const list = els.studyCreateList;
    if (!list) return;
    const query = String(els.studyCreateSearch?.value || "").trim().toLowerCase();
    const docs = readyCreateDocs().filter((doc) => {
      if (!query) return true;
      return documentDisplayName(doc).toLowerCase().includes(query);
    });
    const atCap = createSelected.size >= CREATE_FILE_CAP;
    const count = document.getElementById("studyCreateCount");
    if (count) count.textContent = createSelected.size ? `${createSelected.size} of ${CREATE_FILE_CAP}` : `Up to ${CREATE_FILE_CAP}`;
    if (!docs.length) {
      list.innerHTML = `<p class="study-create-empty">${readyCreateDocs().length ? "No matching files." : "Add a source to this course first."}</p>`;
      renderCreateActions();
      return;
    }
    list.innerHTML = docs.map((doc) => {
      const id = doc.id;
      const checked = createSelected.has(id);
      const disabled = !checked && atCap;
      const name = documentDisplayName(doc);
      return `<label class="study-create-item" title="${escapeHtml(name)}">
        <input type="checkbox" value="${escapeHtml(id)}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}>
        ${sourceBadge(doc)}<span><strong>${escapeHtml(sourceShortName(doc))}</strong></span>
      </label>`;
    }).join("");
    renderCreateActions();
  }

  function renderCreateActions() {
    const wrap = els.studyCreateActions;
    if (!wrap) return;
    const enabled = createSelected.size > 0;
    const disable = enabled ? "" : " disabled";
    const label = createType === "tutor" ? "Plan my session" : `Generate ${jobTypeLabel(createType).toLowerCase()}`;
    wrap.innerHTML = `<button type="button" class="project-dialog-primary" data-study-create-go${disable}>${label}</button>`;
  }

  function optionPreview(kind) {
    const lines = '<i></i><i></i><i></i>';
    const previews = {
      basic: '<span class="dojo-demo-question">What is active recall?</span><i></i><span class="dojo-demo-answer">Flip to remember ↻</span>',
      mcq: '<span class="dojo-demo-question">Choose the right idea</span><span class="dojo-demo-choices"><i>A</i><i>B</i><i>C</i></span>',
      cloze: '<span class="dojo-demo-question">Learning starts with</span><span class="dojo-demo-blank">the missing piece</span><i></i>',
      mixed: '<span class="dojo-demo-question">01 &nbsp; Explain the idea</span><i></i><span class="dojo-demo-choices"><i>A</i><i>B</i><i>C</i></span>',
      short: '<span class="dojo-demo-question">Explain it in your words</span>' + lines,
      summary: '<span class="dojo-demo-question">The key ideas</span>' + lines,
      detailed: '<span class="dojo-demo-question">The full picture</span>' + lines + '<span class="dojo-demo-section">Examples & connections</span><i></i>'
    };
    return `<span class="dojo-option-preview is-${kind}" aria-hidden="true"><span class="dojo-demo-sheet">${previews[kind] || ""}</span></span>`;
  }

  // The optional text boxes only show a character count once the writer nears the limit.
  function syncFocusCount(textarea) {
    const field = textarea.closest(".dojo-focus-field");
    const max = Number(textarea.maxLength) || 0;
    if (!field || max <= 0) return;
    let count = field.querySelector(".dojo-focus-count");
    const length = textarea.value.length;
    if (length < max * 0.9) {
      count?.remove();
      return;
    }
    if (!count) {
      count = document.createElement("span");
      count.className = "dojo-focus-count";
      count.setAttribute("aria-live", "polite");
      textarea.before(count);
    }
    count.textContent = `${length}/${max}`;
    count.classList.toggle("is-full", length >= max);
  }

  function createOptionsMarkup(type) {
    if (type === "podcast") return podcastOptionsMarkup({ escapeHtml });
    if (type === "tutor") return tutorOptionsMarkup({ escapeHtml });
    const field = (label, name, choices, selected, variant = "") => `<fieldset class="dojo-option-group ${variant}"><legend>${label}</legend><div class="dojo-option-grid">${choices.map(([value, title, description, preview]) => `<label class="dojo-option" data-value="${value}"><input type="radio" name="${name}" value="${value}"${value === selected ? " checked" : ""}><span class="dojo-option-face">${preview ? optionPreview(preview) : ""}${name === "difficulty" ? '<span class="dojo-difficulty-bars" aria-hidden="true"><i></i><i></i><i></i></span>' : ""}<span class="dojo-option-copy"><strong>${title}</strong>${description ? `<small>${description}</small>` : ""}</span><span class="dojo-option-check" aria-hidden="true">✓</span></span></label>`).join("")}</div></fieldset>`;
    return `${type === "flashcards" ? field("Card type", "cardType", [["basic", "Basic", "Question & answer", "basic"], ["mcq", "Multiple choice", "Pick the right answer", "mcq"], ["cloze", "Fill in the blank", "Find the missing piece", "cloze"]], "basic", "is-illustrated") + field("Coverage", "mode", [["rapid", "Standard", "The key concepts"], ["deep", "Deep dive", "More detail, broader coverage"]], "rapid", "is-pair") : ""}
      ${type === "quiz" ? field("Test format", "examType", [["mixed", "Mixed", "A little of both", "mixed"], ["short", "Short answer", "Write, then self-assess", "short"], ["mcq", "Multiple choice", "Choose your answer", "mcq"]], "mixed", "is-illustrated") + field("Questions", "count", [["5", "5", "Quick"], ["10", "10", "Standard"], ["15", "15", "Extended"], ["20", "20", "Full"], ["25", "25", "Extra"]], "10", "is-count") : ""}
      ${type === "notes" ? field("Detail", "mode", [["summary", "The essentials", "A clear, focused summary", "summary"], ["detailed", "Detailed review", "Ideas, examples & explanations", "detailed"]], "summary", "is-illustrated is-pair") : ""}
      ${type === "flashcards" || type === "quiz" ? field("Difficulty", "difficulty", [["easy", "Easy", "Facts & recall"], ["medium", "Medium", "Apply your knowledge"], ["hard", "Hard", "Analyze & connect"]], "medium", "is-difficulty") : ""}
      ${field("Style", "style", [["", "Default", "Balanced"], ["concise", "Concise", "Short & direct"], ["exam", "Exam prep", "Applied scenarios"], ["conceptual", "Connections", "The bigger picture"]], "", "is-style")}
      <label class="dojo-focus-field">Focus area <span>Optional</span><textarea name="focus" maxlength="1000" placeholder="A topic, chapter, or question to focus on…" rows="2"></textarea></label>`;
  }

  const voiceClips = new Map();

  function stopVoicePreview() {
    if (!voicePreview) return;
    voicePreview.audio.pause();
    els.studyCreateDialog?.querySelectorAll(".dojo-voice-play.is-playing").forEach((button) => button.classList.remove("is-playing"));
    voicePreview = null;
  }

  // Samples are small static clips; load them as blobs so every browser can play them.
  async function previewVoice(button) {
    const id = button.dataset.voicePreview;
    const same = voicePreview?.id === id;
    stopVoicePreview();
    if (same || !voiceOf(id)) return;
    const audio = new Audio();
    voicePreview = { id, audio };
    els.studyCreateDialog.querySelectorAll(`[data-voice-preview="${CSS.escape(id)}"]`).forEach((node) => node.classList.add("is-playing"));
    audio.addEventListener("ended", () => { if (voicePreview?.audio === audio) stopVoicePreview(); });
    try {
      if (!voiceClips.has(id)) {
        const response = await fetch(`/audio/voices/${id}.mp3`);
        if (!response.ok) throw new Error("missing");
        voiceClips.set(id, URL.createObjectURL(await response.blob()));
      }
      if (voicePreview?.audio !== audio) return;
      audio.src = voiceClips.get(id);
      await audio.play();
    } catch {
      if (voicePreview?.audio === audio) stopVoicePreview();
      showToast("Could not play this voice.");
    }
  }

  // Keep the two voice rows distinct, match role names to the style, and refresh the summary.
  function syncPodcastOptions() {
    const form = els.studyCreateForm;
    const options = document.getElementById("dojoCreateOptions");
    if (!form || !options || createType !== "podcast") return;
    const data = new FormData(form);
    const roles = styleOf(data.get("style")).roles;
    const picked = [data.get("voiceA"), data.get("voiceB")];
    [0, 1].forEach((slot) => {
      const row = options.querySelector(`[data-voice-slot="${slot}"]`);
      if (!row) return;
      row.querySelector("[data-voice-role]").textContent = roles[slot];
      row.querySelector(".dojo-voice-list")?.setAttribute("aria-label", `${roles[slot]} voice`);
      const voice = voiceOf(picked[slot]);
      row.querySelector("[data-voice-note]").textContent = voice ? `${voice.tone} · ${voice.accent}` : "";
      row.querySelectorAll("[data-voice-chip]").forEach((chip) => {
        const input = chip.querySelector("input");
        input.disabled = chip.dataset.voiceChip === picked[slot ? 0 : 1];
        chip.classList.toggle("is-picked", input.checked);
      });
    });
  }

  function closeCreateDialog() {
    stopVoicePreview();
    createType = "";
    createSelected.clear();
    if (els.studyCreateSearch) els.studyCreateSearch.value = "";
    els.studyCreateDialog?.close();
  }

  async function openCreatePicker(type, event) {
    if (!state.activeCourseId || !["flashcards", "quiz", "notes", "mindmap", "podcast", "tutor"].includes(type)) return;
    createType = type;
    els.studyCreateDialog.dataset.createType = type;
    els.studyCreateDialog.dataset.motion = event?.detail && !reducedMotion() ? "on" : "off";
    createSelected.clear();
    if (els.studyCreateTitle) els.studyCreateTitle.textContent = type === "tutor" ? "Start a tutor session" : `Create ${jobTypeLabel(type).toLowerCase()}`;
    const options = document.getElementById("dojoCreateOptions");
    if (options) options.innerHTML = createOptionsMarkup(type);
    if (els.studyCreateHint) {
      els.studyCreateHint.textContent = type === "podcast"
        ? "Turn your sources into a two-host episode you can learn from anywhere."
        : type === "tutor"
          ? "Talk it through with a voice tutor. We'll plan the lesson from your sources before the call."
          : "Make it yours. Choose a format and a few sources.";
    }
    if (els.studyCreateSearch) els.studyCreateSearch.value = "";
    try {
      if (!state.studyMaterials) await loadMaterials();
    } catch (error) {
      showToast(error.message || "Could not load materials.");
      return;
    }
    renderCreateList();
    els.studyCreateDialog?.showModal();
    window.requestAnimationFrame(() => els.studyCreateSearch?.focus());
  }

  function submitCreatePicker(event) {
    const button = event.target.closest("[data-study-create-go]");
    if (!button || button.disabled) return;
    const ids = [...createSelected];
    if (!ids.length) return;
    const type = createType;
    const options = Object.fromEntries(new FormData(els.studyCreateForm));
    if (type === "podcast") options.mode = `${options.style || "casual"}:${options.length || "standard"}`;
    closeCreateDialog();
    if (type === "tutor") return prepareTutor(ids, options);
    runGenerateFromMaterials(ids, type, options);
  }

  async function setTab(tab) {
    if (!TABS.includes(tab) || tab === state.activeCourseTab) return;
    state.activeCourseTab = tab;
    quizMenuKey = "";
    const ready = tabReady();
    render();
    if (ready) {
      if (tab === "chat") els.promptInput?.focus();
      return;
    }
    try {
      if (tab === "materials" && !state.studyMaterials) await loadMaterials();
      if (tab === "practice" && !state.studyPractice) await loadPractice();
      if (tab === "chat") {
        if (!state.studyProjectDetail) await loadCourseDetail();
        if (!state.studyMaterials) await loadMaterials().catch(() => {});
      }
    } catch (error) {
      showToast(error.message || "Could not load this tab.");
    }
    render();
    if (tab === "chat") els.promptInput?.focus();
  }

  function sessionRoot() {
    return els.studySession;
  }

  function closeSessionLayer() {
    const root = sessionRoot();
    if (root) {
      root.classList.add("hidden");
      root.innerHTML = "";
      root.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("study-session-open");
  }

  function closeSession() {
    const reviewed = Boolean(reviewSession);
    const panelTest = quizSession?.host === "panel";
    clearTimeout(reviewSession?.animTimer);
    reviewSession = null;
    stopTestClock();
    quizSession = null;
    if (quizMenuKey === "review") quizMenuKey = "";
    closeSessionLayer();
    closeSideChat?.();
    closeNote();
    if (reviewed) render();
    else if (panelTest) patchStudio({ keepScroll: false });
    // Full-screen review can star, edit, or delete cards; refresh the open deck.
    if (reviewed && studioView?.kind === "deck") void loadStudioCards();
  }

  function openSessionShell(html) {
    const root = sessionRoot();
    if (!root) return;
    root.innerHTML = html;
    root.classList.remove("hidden");
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("study-session-open");
  }

  function reviewMarkLabel(mark) {
    return mark === 3 ? "Got it" : mark === 1 ? "Missed" : "";
  }

  function reviewFace(card, session, side) {
    const mark = session.marks[card.id];
    const markClass = mark === 3 ? " is-good" : mark === 1 ? " is-bad" : "";
    return `
      <span class="study-flip-face study-flip-${side}">

        <span class="study-review-top">
          <span class="study-review-count">${escapeHtml(String(session.index + 1))} / ${escapeHtml(String(session.cards.length))}</span>
          <span class="study-review-mark${markClass}">${reviewMarkLabel(mark)}</span>
          <span class="study-review-kebab" aria-hidden="true"></span>
        </span>
        ${side === "front" ? citePills(card, studioHelpers(false)) : ""}
        <span class="study-review-text"><span>${escapeHtml((side === "front" ? card.front : card.back) || "").replaceAll("___", '<span class="study-blank" aria-label="blank"></span>')}</span></span>
        <span class="study-review-see">${side === "front" ? "See answer" : "See question"}</span>
      </span>`;
  }

  function starredToggleMarkup(session) {
    const on = Boolean(session.starredOnly);
    return `
      <button class="study-chip-btn study-starred-toggle${on ? " is-on" : ""}" type="button" data-starred-only aria-pressed="${on ? "true" : "false"}">
        ${starIcon(on)}<span class="study-chip-label">Starred</span>
      </button>`;
  }

  function askMarkup() {
    if (!canUseSideChat?.()) return "";
    return `
      <form class="study-ask" data-study-ask>
        <input class="study-ask-input" type="text" maxlength="2000" placeholder="Ask any doubts." autocomplete="off" spellcheck="true">
        <button class="study-ask-send" type="submit" aria-label="Send">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/></svg>
        </button>
      </form>`;
  }

  function reviewEditMarkup(card) {
    return `
      <div class="study-edit">
        <div class="study-edit-pair">
          <div class="study-edit-card">

            <span class="study-kicker">Question</span>
            <div class="study-edit-text" contenteditable="true" role="textbox" data-edit-side="front" spellcheck="true">${escapeHtml(card.front || "")}</div>
          </div>
          <div class="study-edit-card">

            <span class="study-kicker">Answer</span>
            <div class="study-edit-text" contenteditable="true" role="textbox" data-edit-side="back" spellcheck="true">${escapeHtml(card.back || "")}</div>
          </div>
        </div>
        <div class="study-edit-actions">
          <button class="study-chip-btn" type="button" data-edit-cancel><span class="study-chip-label">Cancel</span></button>
          <button class="study-primary-btn" type="button" data-edit-save><span class="study-chip-label">Save</span></button>
        </div>
      </div>`;
  }

  function reviewCardMarkup(session) {
    const emptyLabel = session.starredOnly ? "No starred cards" : "No cards left";
    const emptyKicker = session.starredOnly ? "Starred" : "Deck empty";
    if (!session.cards.length) {
      return `
        <button class="study-session-close" type="button" data-close-session aria-label="Close review">×</button>
        ${starredToggleMarkup(session)}
        <div class="study-session-end">
          <p class="study-kicker">${emptyKicker}</p>
          <strong>${emptyLabel}</strong>
          <button class="study-primary-btn" type="button" data-close-session>Close</button>
        </div>`;
    }
    const card = session.cards[session.index];
    if (session.editing) {
      return `
        <button class="study-session-close" type="button" data-close-session aria-label="Close review">×</button>
        ${reviewEditMarkup(card)}`;
    }
    const menuOpen = quizMenuKey === "review";
    const atStart = session.index === 0;
    const atEnd = session.index >= session.cards.length - 1;
    const starred = Boolean(card.starred);
    return `
      <button class="study-session-close" type="button" data-close-session aria-label="Close review">×</button>
      ${starredToggleMarkup(session)}
      <p class="study-review-hint">Press “Space” to flip, “← / →” to navigate</p>
      <div class="study-review">
        <div class="study-review-glow" aria-hidden="true"></div>
        <div class="study-review-stage">
          <button class="study-flip${session.flipped ? " is-flipped" : ""}" type="button" data-study-flip aria-label="${session.flipped ? "Show question" : "Show answer"}">
            <span class="study-flip-inner">
              ${reviewFace(card, session, "front")}
              ${reviewFace(card, session, "back")}
            </span>
          </button>
          <div class="study-review-tools">
            <button class="study-icon-btn study-review-star${starred ? " is-on" : ""}" type="button" data-review-star aria-pressed="${starred ? "true" : "false"}" aria-label="${starred ? "Unstar card" : "Star card"}">
              ${starIcon(starred)}
            </button>
            <div class="study-card-menu-wrap study-review-menu">
              <button class="study-icon-btn" type="button" data-toggle-review-menu aria-label="Set options" aria-haspopup="menu" aria-expanded="${menuOpen ? "true" : "false"}">
                ${kebabIcon()}
              </button>
              <div class="study-menu${menuOpen ? "" : " hidden"}" role="menu">
                <button class="study-menu-item" type="button" role="menuitem" data-review-edit>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  Edit card
                </button>
                <button class="study-menu-item" type="button" role="menuitem" data-review-restart>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/></svg>
                  Restart set
                </button>
                <button class="study-menu-item" type="button" role="menuitem" data-review-shuffle>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>
                  Shuffle set
                </button>
                <hr class="study-menu-sep">
                <button class="study-menu-item study-menu-danger" type="button" role="menuitem" data-review-delete>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                  Delete flashcard
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="study-review-controls">
          <button class="study-review-nav" type="button" data-study-nav="-1" aria-label="Previous card"${atStart ? " disabled" : ""}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button class="study-review-grade is-miss" type="button" data-study-grade="1" aria-label="Missed">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            <span class="study-review-n">${escapeHtml(String(session.counts[1] || 0))}</span>
          </button>
          <button class="study-review-grade is-got" type="button" data-study-grade="3" aria-label="Got it">
            <span class="study-review-n">${escapeHtml(String(session.counts[3] || 0))}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>
          </button>
          <button class="study-review-nav is-next" type="button" data-study-nav="1" aria-label="Next card"${atEnd ? " disabled" : ""}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
        ${askMarkup()}
      </div>`;
  }

  function renderReview() {
    if (!reviewSession) return;
    openSessionShell(`<div class="study-session-frame is-review">${reviewCardMarkup(reviewSession)}</div>`);
  }

  async function startReview(deck, { startId = "" } = {}) {
    if (!state.activeCourseId || !deck) return;
    try {
      const payload = await fetchStudyQueue(state.session, state.activeCourseId, deckSourceOf(deck));
      const cards = payload?.cards || [];
      if (!cards.length) {
        showToast("This deck has no cards yet.");
        return;
      }
      const list = (cards || []).map((card) => ({ ...card, starred: card.starred === true }));
      reviewSession = {
        cards: list.slice(),
        original: list.slice(),
        index: Math.max(0, list.findIndex((card) => card.id === startId)),
        flipped: false,
        reviewed: 0,
        counts: { 1: 0, 2: 0, 3: 0, 4: 0 },
        marks: {},
        deckId: deck?.id || "",
        starredOnly: false,
        editing: false
      };
      renderReview();
    } catch (error) {
      showToast(error.message || "Could not start review.");
    }
  }

  function visibleReviewCards() {
    return reviewSession.starredOnly
      ? reviewSession.original.filter((card) => card.starred)
      : reviewSession.original.slice();
  }

  function syncVisibleCards(keepId) {
    const next = visibleReviewCards();
    reviewSession.cards = next;
    const found = keepId ? next.findIndex((card) => card.id === keepId) : -1;
    reviewSession.index = found >= 0 ? found : Math.min(reviewSession.index, Math.max(0, next.length - 1));
    if (reviewSession.index < 0) reviewSession.index = 0;
  }

  function patchReviewCard(id, patch) {
    for (const list of [reviewSession.cards, reviewSession.original]) {
      const card = list.find((item) => item.id === id);
      if (card) Object.assign(card, patch);
    }
  }

  function cardAskContext(card) {
    return `Question: ${card.front || ""}\n\nAnswer: ${card.back || ""}`;
  }

  function resetCardAsk() {
    closeSideChat?.();
  }

  async function saveCardPatch(card, patch) {
    const payload = await updateStudyCard(state.session, card.id, patch);
    const next = payload?.card || {};
    patchReviewCard(card.id, {
      front: next.front ?? patch.front ?? card.front,
      back: next.back ?? patch.back ?? card.back,
      starred: next.starred ?? patch.starred ?? card.starred
    });
  }

  function toggleStarredOnly() {
    if (!reviewSession) return;
    const keepId = reviewSession.cards[reviewSession.index]?.id;
    reviewSession.starredOnly = !reviewSession.starredOnly;
    reviewSession.flipped = false;
    reviewSession.editing = false;
    closeReviewMenu();
    resetCardAsk();
    syncVisibleCards(keepId);
    renderReview();
  }

  function paintReviewStar(card) {
    const btn = sessionRoot()?.querySelector("[data-review-star]");
    if (!btn || !card) return;
    const on = Boolean(card.starred);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Unstar card" : "Star card");
    btn.innerHTML = starIcon(on);
  }

  async function toggleReviewStar() {
    const card = reviewSession?.cards[reviewSession.index];
    if (!card) return;
    const starred = !card.starred;
    card.starred = starred;
    paintReviewStar(card);
    try {
      await saveCardPatch(card, { starred });
      if (reviewSession.starredOnly && !starred) {
        reviewSession.flipped = false;
        syncVisibleCards();
        renderReview();
      }
    } catch (error) {
      card.starred = !starred;
      paintReviewStar(card);
      showToast(error.message || "Could not star card.");
    }
  }

  function openReviewEdit() {
    if (!reviewSession?.cards.length) return;
    closeReviewMenu();
    resetCardAsk();
    reviewSession.editing = true;
    renderReview();
  }

  function cancelReviewEdit() {
    if (!reviewSession) return;
    reviewSession.editing = false;
    renderReview();
  }

  function editSideText(side) {
    return String(sessionRoot()?.querySelector(`[data-edit-side="${side}"]`)?.innerText || "").trim();
  }

  async function saveReviewEdit() {
    const card = reviewSession?.cards[reviewSession.index];
    if (!card) return;
    const front = editSideText("front");
    const back = editSideText("back");
    if (!front || !back) {
      showToast("Question and answer can’t be empty.");
      return;
    }
    if (front.length > 2000 || back.length > 2000) {
      showToast("That card is too long.");
      return;
    }
    try {
      await saveCardPatch(card, { front, back });
      reviewSession.editing = false;
      renderReview();
      showToast("Card saved.");
    } catch (error) {
      showToast(error.message || "Could not save card.");
    }
  }

  function sendCardAsk() {
    if (!canUseSideChat?.() || !openSideChat) return;
    const card = reviewSession?.cards[reviewSession.index];
    const form = sessionRoot()?.querySelector("[data-study-ask]");
    const input = form?.querySelector(".study-ask-input");
    const text = input?.value.trim();
    if (!card || !text) return;
    const rect = (form || sessionRoot()?.querySelector(".study-review-stage"))?.getBoundingClientRect();
    input.value = "";
    openSideChat(cardAskContext(card), rect, {
      flashcard: true,
      role: "think",
      initialText: text,
      send: true,
      onAddToCard: addReplyToCard
    });
  }

  async function addReplyToCard(text) {
    const card = reviewSession?.cards[reviewSession.index];
    const note = String(text || "").trim();
    if (!card || !note) return false;
    const back = card.back?.trim() ? `${card.back.trim()}\n\n${note}` : note;
    if (back.length > 2000) {
      showToast("That note is too long for this card.");
      return false;
    }
    try {
      await saveCardPatch(card, { back });
      if (!reviewSession?.editing) renderReview();
      showToast("Added to card");
      return true;
    } catch (error) {
      showToast(error.message || "Could not add to card.");
      return false;
    }
  }

  function confirmOpen() {
    return Boolean(document.getElementById("confirmDialog")?.classList.contains("open"));
  }

  function flipReview() {
    if (!reviewSession?.cards.length || reviewSession.animating || reviewSession.editing || confirmOpen()) return;
    reviewSession.flipped = !reviewSession.flipped;
    sound.flip();
    const root = sessionRoot();
    const flip = root?.querySelector(".study-flip");
    if (!flip) return renderReview();
    flip.classList.toggle("is-flipped", reviewSession.flipped);
    flip.setAttribute("aria-label", reviewSession.flipped ? "Show question" : "Show answer");
  }

  function toggleReviewMenu() {
    quizMenuKey = quizMenuKey === "review" ? "" : "review";
    const wrap = sessionRoot()?.querySelector(".study-review-menu");
    const btn = wrap?.querySelector("[data-toggle-review-menu]");
    const menu = wrap?.querySelector(".study-menu");
    if (!btn || !menu) return renderReview();
    menu.classList.toggle("hidden", quizMenuKey !== "review");
    btn.setAttribute("aria-expanded", String(quizMenuKey === "review"));
  }

  function closeReviewMenu() {
    if (quizMenuKey !== "review") return;
    quizMenuKey = "";
    const wrap = sessionRoot()?.querySelector(".study-review-menu");
    wrap?.querySelector(".study-menu")?.classList.add("hidden");
    wrap?.querySelector("[data-toggle-review-menu]")?.setAttribute("aria-expanded", "false");
  }

  function patchReviewChrome() {
    const root = sessionRoot();
    const card = reviewSession?.cards[reviewSession.index];
    if (!root || !card) return false;
    const mark = reviewSession.marks[card.id];
    root.querySelectorAll(".study-review-mark").forEach((el) => {
      el.textContent = reviewMarkLabel(mark);
      el.classList.toggle("is-good", mark === 3);
      el.classList.toggle("is-bad", mark === 1);
    });
    const miss = root.querySelector("[data-study-grade='1'] .study-review-n");
    const got = root.querySelector("[data-study-grade='3'] .study-review-n");
    if (miss) miss.textContent = String(reviewSession.counts[1] || 0);
    if (got) got.textContent = String(reviewSession.counts[3] || 0);
    return true;
  }

  function navReview(delta) {
    if (!reviewSession?.cards.length || reviewSession.animating || reviewSession.editing) return;
    const next = reviewSession.index + Number(delta);
    if (next < 0 || next >= reviewSession.cards.length) return;
    reviewSession.index = next;
    reviewSession.flipped = false;
    closeReviewMenu();
    resetCardAsk();
    renderReview();
  }

  function restartReview() {
    if (!reviewSession) return;
    clearTimeout(reviewSession.animTimer);
    reviewSession.animating = false;
    reviewSession.editing = false;
    closeReviewMenu();
    resetCardAsk();
    reviewSession.cards = visibleReviewCards();
    reviewSession.index = 0;
    reviewSession.flipped = false;
    reviewSession.reviewed = 0;
    reviewSession.counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    reviewSession.marks = {};
    renderReview();
  }

  function shuffleReview() {
    if (!reviewSession?.cards.length || reviewSession.editing) return;
    clearTimeout(reviewSession.animTimer);
    reviewSession.animating = false;
    closeReviewMenu();
    resetCardAsk();
    const cards = reviewSession.cards.slice();
    for (let i = cards.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    reviewSession.cards = cards;
    reviewSession.index = 0;
    reviewSession.flipped = false;
    renderReview();
  }

  function confirmDeleteCard() {
    const card = reviewSession?.cards[reviewSession.index];
    if (!card) return;
    closeReviewMenu();
    void deleteReviewCard(card);
  }

  async function deleteReviewCard(card) {
    if (!reviewSession || !card) return;
    try {
      await deleteStudyCard(state.session, card.id);
      resetCardAsk();
      const mark = reviewSession.marks[card.id];
      if (mark) {
        reviewSession.counts[mark] -= 1;
        reviewSession.reviewed = Math.max(0, reviewSession.reviewed - 1);
        delete reviewSession.marks[card.id];
      }
      reviewSession.cards = reviewSession.cards.filter((item) => item.id !== card.id);
      reviewSession.original = reviewSession.original.filter((item) => item.id !== card.id);
      if (reviewSession.index >= reviewSession.cards.length) {
        reviewSession.index = Math.max(0, reviewSession.cards.length - 1);
      }
      reviewSession.flipped = false;
      if (state.studyPractice?.decks && reviewSession.deckId) {
        const deckId = reviewSession.deckId;
        state.studyPractice = {
          ...state.studyPractice,
          decks: state.studyPractice.decks.flatMap((deck) => {
            if (deck.id !== deckId) return [deck];
            const cardCount = Math.max(0, Number(deck.cardCount || 0) - 1);
            return cardCount ? [{ ...deck, cardCount }] : [];
          })
        };
      }
      if (!reviewSession.cards.length) {
        closeSession();
        render();
        return;
      }
      renderReview();
    } catch (error) {
      showToast(error.message || "Could not delete card.");
    }
  }

  function playGradeAnim(value) {
    const advance = () => {
      if (!reviewSession) return;
      reviewSession.animating = false;
      if (reviewSession.index >= reviewSession.cards.length - 1) {
        sessionRoot()?.querySelector(".study-review-stage")?.classList.remove("is-got", "is-miss");
        return;
      }
      navReview(1);
    };
    if (reducedMotion()) return advance();
    const stage = sessionRoot()?.querySelector(".study-review-stage");
    if (!stage) return advance();
    reviewSession.animating = true;
    stage.classList.remove("is-got", "is-miss");
    void stage.offsetWidth;
    stage.classList.add(value === 3 ? "is-got" : "is-miss");
    clearTimeout(reviewSession.animTimer);
    reviewSession.animTimer = setTimeout(advance, 520);
  }

  function gradeReview(rating) {
    if (!reviewSession?.cards.length || reviewSession.animating || reviewSession.editing) return;
    const card = reviewSession.cards[reviewSession.index];
    const value = Number(rating);
    if (!card || (value !== 1 && value !== 3)) return;
    const prev = reviewSession.marks[card.id] || 0;
    if (prev !== value) {
      if (prev) reviewSession.counts[prev] -= 1;
      else reviewSession.reviewed += 1;
      reviewSession.counts[value] += 1;
      reviewSession.marks[card.id] = value;
      if (value === 3) sound.tick();
      if (!patchReviewChrome()) renderReview();
    }
    playGradeAnim(value);
  }

  function addedQuestionIndexes(questions, fronts) {
    const have = new Set((fronts || []).map((front) => String(front || "").trim()).filter(Boolean));
    const added = new Set();
    (questions || []).forEach((question, index) => {
      if (have.has(String(question.q || "").trim())) added.add(index);
    });
    return added;
  }

  function quizPanelReady(quizId) {
    return Boolean(els.studyView?.querySelector(".dojo-studio-expanded")) && studioView?.kind === "quiz" && studioView.id === quizId;
  }

  function testHelpers(host) {
    return { escapeHtml, spinner, host };
  }

  function tickTestClock() {
    if (!quizSession) return;
    const text = formatClock(sessionElapsed(quizSession));
    for (const clock of document.querySelectorAll("[data-test-clock]")) clock.textContent = text;
  }

  function stopTestClock() {
    clearInterval(testClock);
    testClock = null;
  }

  function startTestClock() {
    stopTestClock();
    testClock = setInterval(tickTestClock, 1000);
  }

  // Paint the test wherever it lives: the Create panel, or the full-screen session layer.
  function renderQuiz({ scrollTop = false } = {}) {
    if (!quizSession) return;
    if (quizSession.host === "panel") {
      const root = sessionRoot();
      if (root && !reviewSession && !root.classList.contains("hidden")) closeSessionLayer();
      patchStudio({ keepScroll: !scrollTop });
    } else {
      const scroll = sessionRoot()?.querySelector(".study-test-scroll");
      const keep = scrollTop ? 0 : scroll?.scrollTop || 0;
      openSessionShell(`<div class="study-session-frame is-test">${testMarkup(quizSession, testHelpers("full"))}</div>`);
      const next = sessionRoot()?.querySelector(".study-test-scroll");
      if (next) next.scrollTop = keep;
    }
    quizSession.enter = false;
  }

  function focusTest(selector) {
    const scope = quizSession?.host === "full" ? sessionRoot() : els.studyView;
    scope?.querySelector(selector)?.focus({ preventScroll: true });
  }

  async function startQuiz(quizId, host = "panel") {
    try {
      const payload = await fetchStudyQuiz(state.session, quizId);
      const quiz = payload?.quiz || payload;
      if (!quiz?.questions?.length) {
        showToast("This test has no questions yet.");
        return;
      }
      const existingFronts = Array.isArray(payload?.existingFronts) ? payload.existingFronts : [];
      quizSession = newQuizSession(quiz, {
        host: host === "panel" && !quizPanelReady(quiz.id) ? "full" : host,
        courseId: state.activeCourseId,
        existingFronts
      });
      startTestClock();
      renderQuiz({ scrollTop: true });
      focusTest(".study-test-card [data-test-pick], .study-test-card textarea");
    } catch (error) {
      showToast(error.message || "Could not open this test.");
    }
  }

  function newQuizSession(quiz, { host, courseId, existingFronts }) {
    return {
      quiz,
      host,
      courseId,
      index: 0,
      answers: quiz.questions.map(() => null),
      phase: "test",
      startedAt: Date.now(),
      elapsedMs: 0,
      report: null,
      reviewFilter: "all",
      enter: true,
      adding: null,
      existingFronts,
      added: addedQuestionIndexes(quiz.questions, existingFronts)
    };
  }

  function retakeQuiz() {
    if (!quizSession?.quiz) return;
    const { quiz, host, courseId, existingFronts } = quizSession;
    quizSession = newQuizSession(quiz, { host, courseId, existingFronts: existingFronts || [] });
    startTestClock();
    renderQuiz({ scrollTop: true });
  }

  function goToQuestion(index) {
    if (!quizSession || quizSession.phase !== "test") return;
    const next = Math.max(0, Math.min(quizSession.quiz.questions.length - 1, index));
    if (next === quizSession.index) return;
    quizSession.index = next;
    quizSession.enter = true;
    renderQuiz({ scrollTop: true });
    focusTest(`[data-test-go="${next}"].study-test-dot`);
  }

  function pickAnswer(choice) {
    if (!quizSession || quizSession.phase !== "test") return;
    const question = quizSession.quiz.questions[quizSession.index];
    if (!question || question.type === "short" || !Number.isInteger(choice) || choice < 0 || choice >= (question.choices?.length || 0)) return;
    quizSession.answers[quizSession.index] = quizSession.answers[quizSession.index] === choice ? null : choice;
    renderQuiz();
    focusTest(`[data-test-pick="${choice}"]`);
  }

  // Typing only touches the counters so the textarea keeps focus and caret.
  function writeAnswer(textarea) {
    if (!quizSession || quizSession.phase !== "test") return;
    quizSession.answers[quizSession.index] = textarea.value;
    const scope = textarea.closest("[data-test]");
    const words = textarea.value.trim().split(/\s+/).filter(Boolean).length;
    const counter = scope.querySelector("[data-test-words]");
    if (counter) counter.textContent = `${words} word${words === 1 ? "" : "s"}`;
    const done = isAnswered(quizSession.quiz.questions[quizSession.index], textarea.value);
    scope.querySelector(".study-test-dot.is-current")?.classList.toggle("is-answered", done);
    const answered = answeredCount(quizSession);
    const count = scope.querySelector("[data-test-answered]");
    if (count) count.textContent = String(answered);
    const left = scope.querySelector("[data-test-left]");
    const remaining = quizSession.quiz.questions.length - answered;
    if (left) left.textContent = remaining ? `${remaining} unanswered` : "All answered";
  }

  async function submitQuiz() {
    if (!quizSession || quizSession.phase !== "test") return;
    const session = quizSession;
    session.elapsedMs = Date.now() - session.startedAt;
    session.phase = "marking";
    session.enter = true;
    stopTestClock();
    renderQuiz({ scrollTop: true });
    try {
      const answers = session.quiz.questions.map((question, index) => {
        const value = session.answers[index];
        return question.type === "short" ? String(value || "").trim() : Number.isInteger(value) ? value : -1;
      });
      const report = await submitStudyQuizAttempt(state.session, session.quiz.id, answers);
      if (quizSession !== session) return;
      session.report = report;
      session.phase = "results";
      session.enter = true;
      sound.chime();
    } catch (error) {
      if (quizSession !== session) return;
      session.phase = "test";
      session.enter = true;
      session.startedAt = Date.now() - session.elapsedMs;
      startTestClock();
      showToast(error.message || "Could not mark this test. Try again.");
    }
    renderQuiz({ scrollTop: true });
  }

  function endQuizSession() {
    stopTestClock();
    const wasPanel = quizSession?.host === "panel";
    quizSession = null;
    if (wasPanel) patchStudio({ keepScroll: false });
  }

  function leaveQuiz() {
    if (!quizSession) return;
    const finish = () => (quizSession?.host === "full" ? closeSession() : endQuizSession());
    if (quizSession.phase === "test" && answeredCount(quizSession)) {
      openDeleteConfirm({
        title: "Leave this test?",
        body: "Your answers so far won't be kept.",
        confirmLabel: "Leave test",
        onConfirm: finish
      });
      return;
    }
    finish();
  }

  function moveQuiz(host) {
    if (!quizSession || quizSession.host === host) return;
    quizSession.enter = true;
    if (host === "panel") {
      if (!els.studyView?.querySelector(".dojo-workspace")) return;
      if (studioView?.kind !== "quiz" || studioView.id !== quizSession.quiz.id) {
        studioView = { kind: "quiz", id: quizSession.quiz.id, questions: quizSession.quiz.questions, error: "", open: new Set() };
      }
      studioCollapsed = false;
      quizSession.host = "panel";
      closeSessionLayer();
      render();
      quizSession.enter = false;
    } else {
      quizSession.host = "full";
      patchStudio({ keepScroll: false });
      renderQuiz();
    }
    focusTest(".study-test-top [data-test-host]");
  }

  function showReview(index = null) {
    if (!quizSession?.report) return;
    quizSession.phase = "review";
    quizSession.enter = true;
    if (index != null && quizSession.report.results[index]?.status === "full") quizSession.reviewFilter = "all";
    renderQuiz({ scrollTop: true });
    if (index != null) {
      const scope = quizSession.host === "full" ? sessionRoot() : els.studyView;
      scope?.querySelector(`#study-answer-${index}`)?.scrollIntoView({ block: "start" });
    }
  }

  async function addMissedCard(index) {
    if (!quizSession || quizSession.phase !== "review") return;
    if (quizSession.added?.has(index)) return;
    const row = quizSession.report?.results?.[index];
    const question = quizSession.quiz.questions[index];
    if (!row || !question || !quizSession.courseId) return;
    const correct = question.choices?.[row.answer] || "";
    const back = [correct, question.explanation].filter(Boolean).join("\n\n");
    quizSession.adding = index;
    renderQuiz();
    try {
      await createStudyCard(state.session, quizSession.courseId, {
        front: question.q || "",
        back,
        quizId: quizSession.quiz.id
      });
      quizSession.existingFronts = [...(quizSession.existingFronts || []), question.q || ""];
      quizSession.added = addedQuestionIndexes(quizSession.quiz.questions, quizSession.existingFronts);
      showToast("Added to flashcards");
    } catch (error) {
      showToast(error.message || "Could not add flashcard.");
    } finally {
      if (quizSession) {
        quizSession.adding = null;
        renderQuiz();
      }
    }
  }

  // Shared by the panel and full screen; returns true when the click belonged to the test.
  function handleTestClick(event) {
    if (!quizSession || !event.target.closest("[data-test]")) return false;
    if (event.target.closest("[data-test-exit]")) { leaveQuiz(); return true; }
    const host = event.target.closest("[data-test-host]");
    if (host) { moveQuiz(host.dataset.testHost); return true; }
    const go = event.target.closest("[data-test-go]");
    if (go) { goToQuestion(Number(go.dataset.testGo)); return true; }
    const pick = event.target.closest("[data-test-pick]");
    if (pick) { pickAnswer(Number(pick.dataset.testPick)); return true; }
    if (event.target.closest("[data-test-submit]")) { void submitQuiz(); return true; }
    if (event.target.closest("[data-quiz-lookback]")) { showReview(); return true; }
    const jump = event.target.closest("[data-test-review]");
    if (jump) { showReview(Number(jump.dataset.testReview)); return true; }
    if (event.target.closest("[data-quiz-recap]")) {
      quizSession.phase = "results";
      quizSession.enter = true;
      renderQuiz({ scrollTop: true });
      return true;
    }
    const filter = event.target.closest("[data-test-filter]");
    if (filter) {
      quizSession.reviewFilter = filter.dataset.testFilter;
      quizSession.enter = true;
      renderQuiz({ scrollTop: true });
      return true;
    }
    if (event.target.closest("[data-quiz-retake]")) { retakeQuiz(); return true; }
    if (event.target.closest("[data-test-finish]")) {
      if (quizSession.host === "full") closeSession();
      else endQuizSession();
      return true;
    }
    const miss = event.target.closest("[data-add-missed]");
    if (miss) { void addMissedCard(Number(miss.dataset.addMissed)); return true; }
    return true;
  }

  function handleTestKey(event) {
    if (!quizSession || quizSession.phase !== "test" || event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.target.closest?.("input, textarea, select, [contenteditable=true]")) return false;
    const question = quizSession.quiz.questions[quizSession.index];
    const letter = "abcd".indexOf(event.key.toLowerCase());
    const number = ["1", "2", "3", "4"].indexOf(event.key);
    const choice = number >= 0 ? number : letter;
    if (choice >= 0 && question?.type !== "short") {
      event.preventDefault();
      pickAnswer(choice);
      return true;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      goToQuestion(quizSession.index + (event.key === "ArrowRight" ? 1 : -1));
      return true;
    }
    return false;
  }

  function handleSessionClick(event) {
    if (event.target.closest("[data-close-session]")) {
      closeSession();
      return;
    }
    if (reviewSession) {
      if (event.target.closest("[data-starred-only]")) return toggleStarredOnly();
      if (event.target.closest("[data-review-star]")) return void toggleReviewStar();
      if (event.target.closest("[data-review-edit]")) return openReviewEdit();
      if (event.target.closest("[data-edit-cancel]")) return cancelReviewEdit();
      if (event.target.closest("[data-edit-save]")) return void saveReviewEdit();
      if (event.target.closest("[data-toggle-review-menu]")) {
        toggleReviewMenu();
        return;
      }
      if (event.target.closest("[data-review-restart]")) return restartReview();
      if (event.target.closest("[data-review-shuffle]")) return shuffleReview();
      if (event.target.closest("[data-review-delete]")) return confirmDeleteCard();
      if (quizMenuKey === "review" && !event.target.closest(".study-review-menu")) closeReviewMenu();
      if (reviewSession.editing) return;
      if (event.target.closest("[data-study-ask]")) return;
      if (event.target.closest("[data-study-flip]")) {
        flipReview();
        return;
      }
      const nav = event.target.closest("[data-study-nav]");
      if (nav) {
        navReview(nav.dataset.studyNav);
        return;
      }
      const grade = event.target.closest("[data-study-grade]");
      if (grade) gradeReview(grade.dataset.studyGrade);
      return;
    }
    handleTestClick(event);
  }

  function handleSessionKey(event) {
    if (event.target.closest?.("input, textarea, [contenteditable=true]")) return;
    if (reviewSession?.cards.length) {
      if (confirmOpen()) return;
      if (event.target.closest?.("input, textarea, [contenteditable=true]")) return;
      if (reviewSession.editing) return;
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        flipReview();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navReview(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        navReview(1);
      }
      return;
    }
    if (quizSession?.host === "full" && !confirmOpen()) handleTestKey(event);
  }

  function closeNote() {
    studyNote = null;
    setNoteDownloadBusy(false);
    renderNoteOverlay();
  }

  async function copyNote() {
    if (!studyNote) return;
    const text = [studyNote.title, els.studyNoteBody?.innerText || noteBody(studyNote)].filter(Boolean).join("\n\n");
    try {
      await copyText(text);
      flashCopySuccess(els.studyNoteCopy);
    } catch {
      showToast("Could not copy.");
    }
  }

  function downloadNoteMarkdown() {
    const url = URL.createObjectURL(new Blob([noteBody(studyNote)], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = noteFileName("md");
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function waitForNoteExport(jobId) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const payload = await fetchDocumentJobStatus(state.session, jobId);
      if (payload?.job?.status === "succeeded" && payload.artifact?.attachment_id) return payload.artifact;
      if (["failed", "expired"].includes(payload?.job?.status)) {
        throw new Error(payload.job.error?.message || "Export failed.");
      }
    }
    throw new Error("Export is still processing. Try again shortly.");
  }

  async function exportNote(format) {
    if (!studyNote) return;
    if (format === "md") {
      downloadNoteMarkdown();
      return;
    }
    if (!state.session?.access_token) return showToast("Please sign in to download.");
    setNoteDownloadBusy(true);
    try {
      const result = await exportStudyNote(state.session, studyNote.id, format);
      const artifact = result.artifact || (result.jobId ? await waitForNoteExport(result.jobId) : null);
      if (!artifact?.attachment_id) throw new Error("Export did not return a file.");
      setNoteDownloadBusy(false);
      await downloadAttachment(state.session, artifact.attachment_id, artifact.file_name || noteFileName(format));
    } catch (error) {
      setNoteDownloadBusy(false);
      throw error;
    }
  }

  function openNote(id) {
    const note = (state.studyMaterials?.notes || []).find((item) => item.id === id);
    if (!note) return;
    studyNote = note;
    renderNoteOverlay();
  }

  function handleEscape() {
    if (reviewSession && quizMenuKey === "review") {
      closeReviewMenu();
      return true;
    }
    if (reviewSession?.editing) {
      cancelReviewEdit();
      return true;
    }
    if (confirmOpen()) return false;
    if (quizSession?.host === "panel") {
      if (document.activeElement?.matches?.("[data-test] textarea")) document.activeElement.blur();
      else leaveQuiz();
      return true;
    }
    if (quizSession && els.studyView?.querySelector(".dojo-workspace")) {
      moveQuiz("panel");
      return true;
    }
    if (reviewSession || quizSession) {
      closeSession();
      return true;
    }
    if (els.studyNoteDownloadMenu && !els.studyNoteDownloadMenu.classList.contains("hidden")) {
      closeNoteDownloadMenu();
      return true;
    }
    if (studyNote) {
      closeNote();
      return true;
    }
    if (quizMenuKey) {
      quizMenuKey = "";
      render();
      return true;
    }
    if (els.studyCreateDialog?.open) {
      closeCreateDialog();
      return true;
    }
    if (sourceDialog.dismiss()) return true;
    if (studioView && !document.activeElement?.matches?.("input, textarea")) {
      closeStudioView();
      return true;
    }
    return false;
  }

  async function handleViewClick(event) {
    if (event.target.closest("#documentViewer")) return;
    els.studyView.querySelectorAll(".dojo-source-sort[open]").forEach(menu => { if (!menu.contains(event.target)) menu.removeAttribute("open"); });
    if (!event.target.closest(".dojo-chat-recent")) els.studyView.querySelector(".dojo-chat-recent")?.removeAttribute("open");
    if (handleStudioClick(event)) return;
    const sort = event.target.closest("[data-source-sort]");
    if (sort) {
      if (!["recent", "asc", "desc"].includes(sort.dataset.sourceSort)) return;
      sourceSort = sort.dataset.sourceSort;
      render();
      els.studyView.querySelector(".dojo-source-sort summary")?.focus();
      return;
    }
    if (event.target.closest("[data-collapse-sources]")) return togglePanel("sources", event);
    if (event.target.closest("[data-collapse-studio]")) return togglePanel("studio", event);
    const source = event.target.closest("[data-view-source]");
    if (source) return openSource(source.dataset.viewSource, event);
    const menuBtn = event.target.closest("[data-toggle-course-menu]");
    if (menuBtn) {
      const id = menuBtn.dataset.toggleCourseMenu;
      quizMenuKey = quizMenuKey === `course:${id}` ? "" : `course:${id}`;
      render();
      return;
    }
    const deckMenuBtn = event.target.closest("[data-toggle-deck-menu]");
    if (deckMenuBtn) {
      event.stopPropagation();
      const id = deckMenuBtn.dataset.toggleDeckMenu;
      quizMenuKey = quizMenuKey === `deck:${id}` ? "" : `deck:${id}`;
      render();
      return;
    }
    const chatMenuBtn = event.target.closest("[data-toggle-chat-menu]");
    if (chatMenuBtn) {
      event.stopPropagation();
      const id = chatMenuBtn.dataset.toggleChatMenu;
      quizMenuKey = quizMenuKey === `chat:${id}` ? "" : `chat:${id}`;
      render();
      return;
    }
    const materialMenuBtn = event.target.closest("[data-toggle-material-menu]");
    if (materialMenuBtn) {
      event.stopPropagation();
      const key = materialMenuBtn.dataset.toggleMaterialMenu;
      quizMenuKey = quizMenuKey === key ? "" : key;
      render();
      return;
    }
    const quizToggle = event.target.closest("[data-toggle-quiz-menu]");
    if (quizToggle) {
      event.stopPropagation();
      const key = quizToggle.dataset.toggleQuizMenu;
      quizMenuKey = quizMenuKey === key ? "" : key;
      render();
      return;
    }
    const pin = event.target.closest("[data-collection-pin-kind]");
    if (pin && ["deck", "quiz", "note", "podcast", "tutor"].includes(pin.dataset.collectionPinKind)) {
      event.stopPropagation();
      return toggleCollectionPin(pin.dataset.collectionPinKind, pin.dataset.collectionPinId);
    }
    if (!event.target.closest(".study-card-menu-wrap") && !event.target.closest(".study-quiz-wrap")) {
      if (quizMenuKey) {
        quizMenuKey = "";
        render();
      }
    }
    if (event.target.closest("[data-create-course]")) return openCreateDialog();
    const open = event.target.closest("[data-open-course-id]");
    if (open) return openCourse(open.dataset.openCourseId);
    if (event.target.closest("[data-study-back]")) return openCourses();
    const tab = event.target.closest("[data-study-tab]");
    if (tab) return setTab(tab.dataset.studyTab);
    const openDeck = event.target.closest("[data-open-deck]");
    if (openDeck) {
      if (findDeck(openDeck.dataset.openDeck)) openStudioView("deck", openDeck.dataset.openDeck, event);
      return;
    }
    const quiz = event.target.closest("[data-open-quiz]");
    if (quiz) return openStudioView("quiz", quiz.dataset.openQuiz, event);
    const podcast = event.target.closest("[data-open-podcast]");
    if (podcast) return openStudioView("podcast", podcast.dataset.openPodcast, event);
    const tutor = event.target.closest("[data-open-tutor]");
    if (tutor) return openStudioView("tutor", tutor.dataset.openTutor, event);
    if (event.target.closest("[data-study-add-files]")) {
      sourceDialog.open(event);
      return;
    }
    const practiceCreate = event.target.closest("[data-practice-create]");
    if (practiceCreate) {
      event.stopPropagation();
      return openCreatePicker(practiceCreate.dataset.practiceCreate, event);
    }
    const gen = event.target.closest("[data-study-generate]");
    if (gen) {
      event.stopPropagation();
      if (gen.disabled) return;
      return runGenerate(gen.dataset.genKind, gen.dataset.genId, gen.dataset.studyGenerate, {
        count: gen.dataset.count,
        mode: gen.dataset.mode
      });
    }
    const retryGen = event.target.closest("[data-retry-generation]");
    if (retryGen) {
      event.stopPropagation();
      return retryGeneration(retryGen.dataset.retryGeneration);
    }
    const cancelGen = event.target.closest("[data-cancel-generation]");
    if (cancelGen) {
      event.stopPropagation();
      return cancelGeneration(cancelGen.dataset.cancelGeneration);
    }
    const note = event.target.closest("[data-open-note]");
    if (note && !event.target.closest(".study-material-actions") && !event.target.closest(".study-card-menu-wrap")) {
      return openStudioView("note", note.dataset.openNote, event);
    }
    const prompt = event.target.closest("[data-dojo-prompt]");
    if (prompt && els.promptInput) {
      if ("value" in els.promptInput) els.promptInput.value = prompt.dataset.dojoPrompt;
      else els.promptInput.textContent = prompt.dataset.dojoPrompt;
      els.promptInput.dispatchEvent(new Event("input", { bubbles: true }));
      els.promptInput.focus();
      return;
    }
    if (event.target.closest("[data-dojo-new-chat]")) return openCourse(state.activeCourseId, { tab: "chat" });
    const chat = event.target.closest("[data-open-chat-id]");
    if (chat) return openConversation(chat.dataset.openChatId);
    const rename = event.target.closest("[data-rename-course]");
    if (rename) return openRenameDialog(rename.dataset.renameCourse);
    const remove = event.target.closest("[data-delete-course]");
    if (remove) return confirmDeleteCourse(remove.dataset.deleteCourse);
    const renameDeck = event.target.closest("[data-rename-deck]");
    if (renameDeck) return openRenameDeckDialog(renameDeck.dataset.renameDeck);
    const removeDeck = event.target.closest("[data-delete-deck]");
    if (removeDeck) return confirmDeleteDeck(removeDeck.dataset.deleteDeck);
    const renameTutor = event.target.closest("[data-rename-tutor]");
    if (renameTutor) return openRenameTutorDialog(renameTutor.dataset.renameTutor);
    const removeTutor = event.target.closest("[data-delete-tutor]");
    if (removeTutor) return confirmDeleteTutor(removeTutor.dataset.deleteTutor);
    const renamePodcast = event.target.closest("[data-rename-podcast]");
    if (renamePodcast) return openRenamePodcastDialog(renamePodcast.dataset.renamePodcast);
    const removePodcast = event.target.closest("[data-delete-podcast]");
    if (removePodcast) return confirmDeletePodcast(removePodcast.dataset.deletePodcast);
    const renameQuiz = event.target.closest("[data-rename-quiz]");
    if (renameQuiz) return openRenameQuizDialog(renameQuiz.dataset.renameQuiz);
    const removeQuiz = event.target.closest("[data-delete-quiz]");
    if (removeQuiz) return confirmDeleteQuiz(removeQuiz.dataset.deleteQuiz);
    const renameChat = event.target.closest("[data-rename-chat]");
    if (renameChat) {
      event.stopPropagation();
      return openRenameCourseChat(renameChat.dataset.renameChat);
    }
    const removeChat = event.target.closest("[data-delete-chat]");
    if (removeChat) {
      event.stopPropagation();
      return confirmDeleteCourseChat(removeChat.dataset.deleteChat);
    }
    const removeDoc = event.target.closest("[data-delete-doc]");
    if (removeDoc) {
      event.stopPropagation();
      return confirmDeleteDoc(removeDoc.dataset.deleteDoc);
    }
    const removeNote = event.target.closest("[data-delete-note]");
    if (removeNote) {
      event.stopPropagation();
      return confirmDeleteNote(removeNote.dataset.deleteNote);
    }
  }

  function handleViewChange(event) {
    const input = event.target.closest(".study-title-input");
    if (!input) return;
    void saveCourseName(input.value.trim());
  }

  function handleViewKey(event) {
    if (quizSession?.host === "panel" && event.target.closest?.("[data-test]") && handleTestKey(event)) return;
    if (handlePodcastKey(event)) return;
    if (event.key === "Enter" && !event.shiftKey && event.target.matches?.("[data-typing-answer]")) {
      event.preventDefault();
      event.target.closest(".dojo-qa")?.querySelector("[data-typing-check]:not(:disabled)")?.click();
      return;
    }
    if (studioView?.layout === "flip" && event.target.closest?.(".dojo-studio-view") && !event.target.matches?.("input, textarea, button")) {
      if (event.key === " " || event.key === "Enter") {
        const flip = event.target.closest("[data-studio-flip]") || els.studyView.querySelector("[data-studio-flip]");
        if (flip) { event.preventDefault(); flipStudioCard(flip); }
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        navStudioFlip(event.key === "ArrowRight" ? 1 : -1);
        return;
      }
    }
    if (event.key === "Enter" && event.target.matches?.(".study-title-input")) {
      event.preventDefault();
      event.target.blur();
      return;
    }
    if (!event.target.closest?.(".study-tabs")) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.indexOf(state.activeCourseTab);
    const next = event.key === "ArrowRight"
      ? TABS[(index + 1) % TABS.length]
      : TABS[(index - 1 + TABS.length) % TABS.length];
    void setTab(next);
  }

  function bindEvents() {
    els.studyView?.addEventListener("click", (event) => { void handleViewClick(event); });
    els.studyView?.addEventListener("input", (event) => {
      if (quizSession && event.target.matches?.("[data-test-written]")) {
        writeAnswer(event.target);
        return;
      }
      if (studioView?.kind === "podcast" && event.target.matches?.("[data-pod-seek]")) {
        studioView.scrubbing = Number(event.target.value);
        patchPodcast("time");
        return;
      }
      if (studioView?.kind === "podcast" && event.target.matches?.("[data-pod-volume]")) {
        podcastAudio?.setVolume(event.target.value);
        return;
      }
      if (studioView && event.target.matches?.("[data-deck-query]")) {
        studioView.query = event.target.value;
        studioView.flipIndex = 0;
        studioView.flipped = false;
        patchDeckBody();
        return;
      }
      if (studioView && event.target.matches?.("[data-typing-answer]")) {
        const article = event.target.closest(".dojo-qa");
        studioView.typed[article.dataset.cardId] = event.target.value;
        const check = article.querySelector("[data-typing-check]");
        if (check) check.disabled = !event.target.value.trim();
        return;
      }
      if (!event.target.matches?.(".dojo-chat-recent-search input")) return;
      const list = event.target.closest(".dojo-chat-recent-menu").querySelector(".dojo-chat-recent-list");
      const query = event.target.value.trim().toLocaleLowerCase();
      let matches = 0;
      list.querySelectorAll("[data-open-chat-id]").forEach((button) => {
        button.hidden = !button.querySelector(".dojo-chat-recent-title").textContent.toLocaleLowerCase().includes(query);
        if (!button.hidden) matches += 1;
      });
      list.querySelector(".dojo-chat-no-match").hidden = !query || matches > 0;
    });
    els.studyView?.addEventListener("change", (event) => {
      if (studioView?.kind === "podcast" && event.target.matches?.("[data-pod-seek]")) {
        const target = Number(event.target.value);
        studioView.scrubbing = null;
        transcriptScrolledAt = 0;
        podcastAudio?.seek(target);
        return;
      }
      void handleViewChange(event);
    });
    // A reader scrolling the transcript pauses auto-follow for a few seconds.
    for (const type of ["wheel", "touchmove"]) {
      els.studyView?.addEventListener(type, (event) => {
        if (event.target.closest?.("[data-pod-transcript]")) transcriptScrolledAt = Date.now();
      }, { passive: true });
    }
    els.studyView?.addEventListener("keydown", handleViewKey);
    // <details> toggles don't bubble; remember which answers are open across repaints.
    els.studyView?.addEventListener("toggle", (event) => {
      const item = event.target.closest?.(".dojo-studio-view details.dojo-qa");
      if (!item || !studioView?.open) return;
      const key = item.dataset.cardId ?? Number(item.dataset.questionIndex);
      if (item.open) studioView.open.add(key);
      else studioView.open.delete(key);
    }, true);
    els.studyFileInput?.addEventListener("change", (event) => {
      if (!event.target.files?.length) return;
      sourceDialog.close();
      void uploadCourseFiles(event.target.files || []);
      event.target.value = "";
    });
    els.courseCreateForm?.addEventListener("submit", (event) => { void submitCreate(event); });
    els.courseCreateCancel?.addEventListener("click", () => els.courseCreateDialog?.close());
    els.studyCreateClose?.addEventListener("click", closeCreateDialog);
    els.studyCreateForm?.addEventListener("submit", (event) => event.preventDefault());
    els.studyCreateSearch?.addEventListener("input", () => renderCreateList());
    els.studyCreateList?.addEventListener("change", (event) => {
      const input = event.target.closest("input[type=checkbox]");
      if (!input) return;
      const id = String(input.value || "").trim();
      if (!id) return;
      if (input.checked) {
        if (createSelected.size >= CREATE_FILE_CAP) {
          input.checked = false;
          return;
        }
        createSelected.add(id);
      } else {
        createSelected.delete(id);
      }
      renderCreateList();
    });
    els.studyCreateActions?.addEventListener("click", (event) => submitCreatePicker(event));
    document.getElementById("dojoCreateOptions")?.addEventListener("change", () => {
      syncPodcastOptions();
      if (createType === "tutor") syncTutorOptions(document.getElementById("dojoCreateOptions"));
    });
    document.getElementById("dojoCreateOptions")?.addEventListener("input", (event) => {
      if (event.target.matches?.(".dojo-focus-field textarea")) syncFocusCount(event.target);
    });
    document.getElementById("dojoCreateOptions")?.addEventListener("click", (event) => {
      const preview = event.target.closest("[data-voice-preview]");
      if (preview) void previewVoice(preview);
    });
    els.studyCreateDialog?.addEventListener("click", (event) => {
      if (event.target !== els.studyCreateDialog) return;
      const bounds = els.studyCreateDialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeCreateDialog();
    });
    els.studyCreateDialog?.addEventListener("close", () => {
      stopVoicePreview();
      createType = "";
      createSelected.clear();
    });
    els.courseRenameForm?.addEventListener("submit", (event) => { void submitRename(event); });
    els.courseRenameCancel?.addEventListener("click", () => els.courseRenameDialog?.close());
    els.studyNoteClose?.addEventListener("click", closeNote);
    els.studyNoteOverlay?.addEventListener("cancel", closeNote);
    els.studyNoteCopy?.addEventListener("click", () => { void copyNote(); });
    els.studyNoteDownload?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!els.studyNoteDownloadMenu) return;
      const open = els.studyNoteDownloadMenu.classList.toggle("hidden") === false;
      els.studyNoteDownload.setAttribute("aria-expanded", String(open));
    });
    els.studyNoteDownloadMenu?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-study-note-export]");
      if (!button) return;
      closeNoteDownloadMenu();
      try {
        await exportNote(button.dataset.studyNoteExport);
      } catch (error) {
        showToast(error.message || "Export failed.");
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!els.studyNoteDownloadMenu || els.studyNoteDownloadMenu.classList.contains("hidden")) return;
      if (els.studyNoteDownload?.contains(event.target) || els.studyNoteDownloadMenu.contains(event.target)) return;
      closeNoteDownloadMenu();
    });
    els.studyNoteOverlay?.addEventListener("click", (event) => {
      if (event.target === els.studyNoteOverlay) closeNote();
    });
    els.studySession?.addEventListener("click", (event) => { void handleSessionClick(event); });
    els.studySession?.addEventListener("input", (event) => {
      if (quizSession && event.target.matches?.("[data-test-written]")) writeAnswer(event.target);
    });
    els.studySession?.addEventListener("submit", (event) => {
      if (!event.target.closest("[data-study-ask]")) return;
      event.preventDefault();
      sendCardAsk();
    });
    document.addEventListener("keydown", (event) => {
      if (!reviewSession && !quizSession) return;
      handleSessionKey(event);
    });
  }

  return {
    render,
    openCourses,
    openCourse,
    bindEvents,
    handleEscape,
    closeSession,
    loadCourse,
    resetCourseCaches,
    isSessionOpen: () => Boolean(reviewSession || quizSession?.host === "full")
  };
}

function createSounds(reducedMotion) {
  let ctx = null;
  function play(fn) {
    if (!reducedMotion?.()) fn();
  }
  function ac() {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      if (!ctx) ctx = new Ctor();
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }
  function tone(freq, dur, type, delay, gainVal) {
    try {
      const audio = ac();
      if (!audio) return;
      const t0 = audio.currentTime + (delay || 0);
      const osc = audio.createOscillator();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1800, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(gainVal ?? 0.12, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch {}
  }
  return {
    flip() { play(() => tone(430, 0.055, "triangle", 0, 0.08)); },
    tick() { play(() => tone(880, 0.035, "sine", 0, 0.07)); },
    chime() {
      play(() => {
        tone(523.25, 0.11, "sine", 0, 0.11);
        tone(659.25, 0.16, "sine", 0.11, 0.11);
      });
    }
  };
}
