import { copyText } from "./platform/index.js";

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
  renderShell,
  renderImages,
  openConversation,
  openDeleteConfirm,
  openTitleRename,
  isSupportedDocumentFile,
  fetchProject,
  createProject,
  updateProject,
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
  deleteStudyCard,
  updateStudyDeck,
  deleteStudyDeck,
  fetchStudyQuiz,
  submitStudyQuizAttempt,
  exportStudyNote,
  deleteStudyNote,
  fetchDocumentJobStatus,
  downloadAttachment,
  flashCopySuccess,
  syncStudyUrl,
  loadProjects
}) {
  const TABS = ["materials", "chat", "practice"];

  let pendingUploads = [];
  /** @type {Map<string, object>} in-memory generation cards; survives SPA nav while page stays open */
  const generations = new Map();
  let elapsedTimer = null;
  let quizMenuKey = "";
  let reviewSession = null;
  let quizSession = null;
  let studyNote = null;

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
    return Boolean(state.studyOpen && !state.activeConversationId);
  }

  function isStudyFile(file) {
    return String(file?.type || "").startsWith("image/") || isSupportedDocumentFile(file);
  }

  function documentDisplayName(doc) {
    const attachment = Array.isArray(doc?.attachments) ? doc.attachments[0] : doc?.attachments;
    return attachment?.file_name || doc?.file_name || "Document";
  }

  function isDetailedNote(note) {
    return note?.kind === "detailed" || String(note?.content || "").startsWith("<!--klui:detailed-->");
  }

  function noteBody(note) {
    const text = String(note?.content || "");
    return text.startsWith("<!--klui:detailed-->") ? text.slice("<!--klui:detailed-->".length).replace(/^\n/, "") : text;
  }

  function noteKindLabel(note) {
    if (note?.kind === "image_transcript") return "Image transcript";
    if (isDetailedNote(note)) return "Detailed";
    return "Summary";
  }

  function materialMenu(kind, id) {
    const key = `material:${kind}:${id}`;
    const open = quizMenuKey === key;
    const del = kind === "note" ? `data-delete-note="${escapeHtml(id)}"` : `data-delete-doc="${escapeHtml(id)}"`;
    return `
      <div class="study-card-menu-wrap">
        <button class="study-icon-btn" type="button" data-toggle-material-menu="${escapeHtml(key)}" aria-label="Material options" aria-haspopup="menu" aria-expanded="${open ? "true" : "false"}">
          ${kebabIcon()}
        </button>
        <div class="study-menu${open ? "" : " hidden"}" role="menu">
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

  function iconCap() {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c2.5 2 9.5 2 12 0v-5"/><path d="M22 10v6"/></svg>`;
  }

  function kebabIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;
  }

  function deckSourceOf(deck) {
    if (deck.manual) return { manual: true };
    if (deck.documentFileId) return { documentFileId: deck.documentFileId };
    return { noteId: deck.noteId };
  }

  function findDeck(deckId) {
    return (state.studyPractice?.decks || []).find((deck) => deck.id === deckId) || null;
  }

  function spinner() {
    return `<span class="study-spin" aria-hidden="true"></span>`;
  }

  function emptyState(title, body, action = "") {
    return `<div class="study-empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p>${action}</div>`;
  }

  function courseListMarkup() {
    const courses = coursesFromProjects();
    if (!courses.length) {
      return `
        <div class="study-hero-empty">
          <div class="study-hero-icon">${iconCap()}</div>
          <h1>Create your first course</h1>
          <p>Upload a syllabus, then review flashcards and quizzes from your actual material.</p>
          <button class="study-primary-btn" type="button" data-create-course>New course</button>
        </div>`;
    }
    const cards = courses.map((course) => {
      const meta = courseMeta(course);
      const menuOpen = quizMenuKey === `course:${course.id}`;
      return `
        <article class="study-course-card">
          <button class="study-course-open" type="button" data-open-course-id="${escapeHtml(course.id)}">
            <strong>${escapeHtml(course.name)}</strong>
            <small>${escapeHtml(meta.term || "No term")}</small>
          </button>
          <div class="study-card-menu-wrap">
            <button class="study-icon-btn" type="button" data-toggle-course-menu="${escapeHtml(course.id)}" aria-label="Course options" aria-haspopup="menu" aria-expanded="${menuOpen ? "true" : "false"}">
              ${kebabIcon()}
            </button>
            <div class="study-menu${menuOpen ? "" : " hidden"}" data-course-menu="${escapeHtml(course.id)}" role="menu">
              <button class="study-menu-item" type="button" role="menuitem" data-rename-course="${escapeHtml(course.id)}">Rename</button>
              <button class="study-menu-item study-menu-danger" type="button" role="menuitem" data-delete-course="${escapeHtml(course.id)}">Delete</button>
            </div>
          </div>
        </article>`;
    }).join("");
    return `
      <div class="study-page">
        <header class="study-page-header">
          <div>
            <p class="study-kicker">Study Hub</p>
            <h1>Your courses</h1>
          </div>
        </header>
        <div class="study-course-grid">
          ${cards}
          <button class="study-course-card study-course-new" type="button" data-create-course>
            <span class="study-new-plus" aria-hidden="true">+</span>
            <strong>New course</strong>
            <small>Name it, add a term, start collecting material.</small>
          </button>
        </div>
      </div>`;
  }

  function generateActions(kind, id, ready) {
    if (!ready) return "";
    const base = `${kind}:${id}`;
    const activeFor = (type, mode = "") => [...generations.values()].some((job) => (
      job.courseId === state.activeCourseId
      && job.status === "running"
      && job.type === type
      && (kind === "doc" ? job.documentFileId === id : job.noteId === id)
      && (!mode || job.mode === mode)
    ));
    const countMenu = (type, label, counts) => {
      const key = `${base}:${type}`;
      const open = quizMenuKey === key;
      return `
        <span class="study-quiz-wrap">
          <button class="study-chip-btn" type="button" data-toggle-quiz-menu="${escapeHtml(key)}" aria-haspopup="menu" aria-expanded="${open ? "true" : "false"}">
            ${label}
          </button>
          <div class="study-quiz-menu${open ? "" : " hidden"}">
            ${counts.map((n) => `<button type="button" data-study-generate="${type}" data-gen-kind="${escapeHtml(kind)}" data-gen-id="${escapeHtml(id)}" data-count="${n}">${n}</button>`).join("")}
          </div>
        </span>`;
    };
    const flashcardAction = () => {
      const cardMode = String(state.studyMaterials?.flashcardModes?.[`${kind === "note" ? "note" : "doc"}:${id}`] || "");
      const key = `${base}:flashcards`;
      const open = quizMenuKey === key;
      const rapidDone = cardMode === "rapid" || cardMode === "deep";
      const deepDone = cardMode === "deep";
      const busy = activeFor("flashcards");
      return `
        <span class="study-quiz-wrap">
          <button class="study-chip-btn" type="button" data-toggle-quiz-menu="${escapeHtml(key)}" aria-haspopup="menu" aria-expanded="${open ? "true" : "false"}">
            Flashcards
          </button>
          <div class="study-quiz-menu${open ? "" : " hidden"}">
            <button type="button" data-study-generate="flashcards" data-gen-kind="${escapeHtml(kind)}" data-gen-id="${escapeHtml(id)}" data-mode="rapid" title="Key concepts — a chapter review"${rapidDone || busy ? " disabled" : ""}>Rapid</button>
            <button type="button" data-study-generate="flashcards" data-gen-kind="${escapeHtml(kind)}" data-gen-id="${escapeHtml(id)}" data-mode="deep" title="Every concept in the chapter"${deepDone || busy ? " disabled" : ""}>Deep</button>
          </div>
        </span>`;
    };
    const notesAction = () => {
      if (kind !== "doc") return "";
      const related = (state.studyMaterials?.notes || []).filter((note) => note.document_file_id === id);
      const summaryDone = related.some((note) => note.kind === "summary" && !isDetailedNote(note));
      const detailedDone = related.some((note) => isDetailedNote(note));
      const key = `${base}:notes`;
      const open = quizMenuKey === key;
      return `
        <span class="study-quiz-wrap">
          <button class="study-chip-btn" type="button" data-toggle-quiz-menu="${escapeHtml(key)}" aria-haspopup="menu" aria-expanded="${open ? "true" : "false"}">
            Notes
          </button>
          <div class="study-quiz-menu${open ? "" : " hidden"}">
            <button type="button" data-study-generate="notes" data-gen-kind="${escapeHtml(kind)}" data-gen-id="${escapeHtml(id)}" data-mode="summary" title="Most important concepts"${summaryDone || activeFor("notes", "summary") ? " disabled" : ""}>Summary</button>
            <button type="button" data-study-generate="notes" data-gen-kind="${escapeHtml(kind)}" data-gen-id="${escapeHtml(id)}" data-mode="detailed" title="A thorough chapter review"${detailedDone || activeFor("notes", "detailed") ? " disabled" : ""}>Detailed</button>
          </div>
        </span>`;
    };
    return `
      <div class="study-material-actions">
        ${flashcardAction()}
        ${countMenu("quiz", "Quiz", [10, 15, 25])}
        ${notesAction()}
      </div>`;
  }

  function jobTypeLabel(type) {
    if (type === "flashcards") return "Flashcards";
    if (type === "quiz") return "Quiz";
    if (type === "notes") return "Notes";
    return "Generation";
  }

  function jobStatusLabel(status) {
    if (status === "running") return "Running";
    if (status === "succeeded") return "Ready";
    if (status === "failed") return "Failed";
    return statusLabel(status);
  }

  function jobSourceName(job) {
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
      .filter((job) => job.courseId === state.activeCourseId)
      .sort((a, b) => (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0));
  }

  function generationCardsMarkup() {
    const cards = courseGenerationCards();
    if (!cards.length) return "";
    return cards.map((job) => {
      const active = job.status === "running";
      const pillClass = job.status === "succeeded" ? "ready" : job.status === "failed" ? "failed" : "reading";
      const stage = job.stage ? ` · ${job.stage}` : "";
      const elapsed = formatElapsed(job);
      const meta = jobMetaLine(job);
      const noteId = job.type === "notes" ? (job.result?.noteId || job.result?.id || "") : "";
      const successHint = job.status !== "succeeded" ? ""
        : job.type === "notes"
          ? (noteId
            ? `<button class="study-chip-btn" type="button" data-open-note="${escapeHtml(String(noteId))}">Open note</button>`
            : `<small class="study-gen-hint">Ready in Materials</small>`)
          : `<small class="study-gen-hint">Available in Practice</small>`;
      return `
        <article class="study-material-card study-gen-card is-${escapeHtml(job.status || "running")}" data-gen-id="${escapeHtml(job.id)}">
          <div class="study-material-copy">
            <strong>${escapeHtml(jobTypeLabel(job.type))} · ${escapeHtml(jobSourceName(job))}</strong>
            ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
            <span class="study-status-pill is-${escapeHtml(pillClass)}" aria-live="polite">
              ${active ? spinner() : ""}${escapeHtml(jobStatusLabel(job.status))}${escapeHtml(stage)}
            </span>
            ${elapsed ? `<small class="study-gen-elapsed">${escapeHtml(elapsed)}</small>` : ""}
          </div>
          ${active ? `
            <div class="study-gen-actions">
              <button class="study-chip-btn" type="button" data-cancel-generation="${escapeHtml(job.id)}">Cancel</button>
            </div>` : ""}
          ${job.status === "failed" ? `
            <p class="study-gen-error">${escapeHtml(job.error || "Generation failed.")}</p>
            <div class="study-gen-actions">
              <button class="study-chip-btn" type="button" data-retry-generation="${escapeHtml(job.id)}">Retry</button>
            </div>` : ""}
          ${successHint ? `<div class="study-gen-actions">${successHint}</div>` : ""}
        </article>`;
    }).join("");
  }

  function materialsMarkup() {
    const payload = state.studyMaterials;
    const docs = payload?.documents || [];
    const notes = payload?.notes || [];
    const statusPill = (status) => `<span class="study-status-pill is-${escapeHtml(status)}">${status === "uploading" || status === "reading" ? spinner() : ""}${escapeHtml(statusLabel(status))}</span>`;
    const pending = pendingUploads.map((item) => `
      <article class="study-material-card is-pending">
        <div class="study-material-copy">
          <strong>${escapeHtml(item.name)}</strong>
          ${statusPill(item.status)}
        </div>
      </article>`).join("");
    const docCards = docs.map((doc) => {
      const status = materialStatus(doc);
      const ready = status === "ready";
      return `
        <article class="study-material-card${ready ? " is-ready" : ""}">
          <div class="study-material-copy">
            <strong>${escapeHtml(documentDisplayName(doc))}</strong>
            <small>${escapeHtml(String(doc.kind || "file").toUpperCase())}</small>
            ${statusPill(status)}
          </div>
          ${generateActions("doc", doc.id, ready)}
          ${materialMenu("doc", doc.id)}
        </article>`;
    }).join("");
    const noteCards = notes.map((note) => `
      <article class="study-material-card study-note-card is-ready" data-open-note="${escapeHtml(note.id)}">
        <div class="study-material-copy">
          <strong>${escapeHtml(note.title || (note.kind === "image_transcript" ? "Image notes" : isDetailedNote(note) ? "Detailed review" : "Summary"))}</strong>
          <small>${escapeHtml(noteKindLabel(note))}</small>
          <span class="study-status-pill is-ready">Ready</span>
        </div>
        ${generateActions("note", note.id, true)}
        ${materialMenu("note", note.id)}
      </article>`).join("");
    const hasItems = docs.length || notes.length || pendingUploads.length;
    return `
      <div class="study-materials" data-study-drop>
        <button class="study-dropzone${state.studyUploading ? " is-busy" : ""}" type="button" data-study-add-files>
          <strong>Drop files here</strong>
          <p>PDFs, slides, sheets, or photos of a syllabus and handwritten notes.</p>
          <span>Browse files</span>
        </button>
        ${hasItems ? `<div class="study-material-list">${pending}${docCards}${noteCards}</div>`
          : emptyState("Nothing here yet", "Drop a syllabus or lecture notes to get started.")}
      </div>`;
  }

  function chatMarkup() {
    const conversations = state.studyProjectDetail?.conversations || [];
    const materialCount = Number(state.studyMaterials?.documents?.length || 0);
    const empty = !conversations.length
      ? (materialCount
        ? emptyState("No chats yet", "Ask anything — I’ll ground answers in this course’s files.")
        : emptyState(
          "Upload something first",
          "I’ll answer from your actual course material.",
          `<button class="study-primary-btn" type="button" data-study-tab="materials">Go to Materials</button>`
        ))
      : "";
    const rows = conversations.map((conversation) => `
      <button class="study-chat-row" type="button" data-open-chat-id="${escapeHtml(conversation.id)}">
        <span>${escapeHtml(conversation.title || "New chat")}</span>
      </button>`).join("");
    return `
      <div class="study-chat">
        <div class="study-composer-slot"></div>
        <section class="study-panel">
          <h2>Course chats</h2>
          <div class="study-chat-list">${rows}${empty}</div>
        </section>
      </div>`;
  }

  function practiceMarkup() {
    const payload = state.studyPractice;
    if (!payload) return `<div class="study-loading">Loading practice...</div>`;
    const decks = payload.decks || [];
    const quizzes = payload.quizzes || [];
    const deckCards = decks.length
      ? decks.map((deck) => {
        const id = deck.id;
        const menuOpen = quizMenuKey === `deck:${id}`;
        return `
          <article class="study-practice-card">
            <button class="study-practice-open" type="button" data-open-deck="${escapeHtml(id)}">
              <strong>${escapeHtml(deck.title || "Deck")}</strong>
              <small>${escapeHtml(String(deck.cardCount || 0))} cards</small>
            </button>
            <div class="study-card-menu-wrap">
              <button class="study-icon-btn" type="button" data-toggle-deck-menu="${escapeHtml(id)}" aria-label="Deck options" aria-haspopup="menu" aria-expanded="${menuOpen ? "true" : "false"}">
                ${kebabIcon()}
              </button>
              <div class="study-menu${menuOpen ? "" : " hidden"}" data-deck-menu="${escapeHtml(id)}" role="menu">
                <button class="study-menu-item" type="button" role="menuitem" data-rename-deck="${escapeHtml(id)}">Rename</button>
                <button class="study-menu-item study-menu-danger" type="button" role="menuitem" data-delete-deck="${escapeHtml(id)}">Delete</button>
              </div>
            </div>
          </article>`;
      }).join("")
      : emptyState("No decks yet", "Generate flashcards from a file on Materials.");
    const quizCards = quizzes.length
      ? quizzes.map((quiz) => `
          <button class="study-practice-card" type="button" data-open-quiz="${escapeHtml(quiz.id)}">
            <strong>${escapeHtml(quiz.title || "Quiz")}</strong>
            <small>${escapeHtml(String(quiz.questionCount || 0))} questions</small>
          </button>`).join("")
      : emptyState("No quizzes yet", "Create a 10, 15, or 25 question quiz from Materials.");
    return `
      <div class="study-practice">
        <section class="study-panel">
          <div class="study-section-heading">
            <h2>Decks</h2>
          </div>
          <div class="study-practice-grid">${deckCards}</div>
        </section>
        <section class="study-panel">
          <h2>Quizzes</h2>
          <div class="study-practice-grid">${quizCards}</div>
        </section>
      </div>`;
  }

  function tabMarkup() {
    const labels = { materials: "Materials", chat: "Chat", practice: "Practice" };
    return `<div class="study-tabs" role="tablist" aria-label="Course sections">
      ${TABS.map((tab) => `<button class="${state.activeCourseTab === tab ? "active" : ""}" type="button" role="tab" aria-selected="${state.activeCourseTab === tab ? "true" : "false"}" data-study-tab="${tab}">${labels[tab]}</button>`).join("")}
    </div>`;
  }

  function courseDetailMarkup() {
    const name = courseName();
    const term = courseMeta(state.studyProjectDetail?.project).term || "";
    const body = state.activeCourseTab === "chat" ? chatMarkup()
      : state.activeCourseTab === "practice" ? practiceMarkup()
        : materialsMarkup();
    const menuOpen = quizMenuKey === `course:${state.activeCourseId}`;
    return `
      <button class="study-back-btn" type="button" data-study-back>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        Study Hub
      </button>
      <div class="study-detail">
        <header class="study-detail-header">
          <div class="study-detail-titles">
            <input class="study-title-input" value="${escapeHtml(name)}" maxlength="80" aria-label="Course name">
            ${term ? `<p class="study-term">${escapeHtml(term)}</p>` : ""}
          </div>
          <div class="study-card-menu-wrap">
            <button class="study-icon-btn" type="button" data-toggle-course-menu="${escapeHtml(state.activeCourseId)}" aria-label="Course options" aria-expanded="${menuOpen ? "true" : "false"}">
              ${kebabIcon()}
            </button>
            <div class="study-menu${menuOpen ? "" : " hidden"}" data-course-menu="${escapeHtml(state.activeCourseId)}" role="menu">
              <button class="study-menu-item" type="button" role="menuitem" data-rename-course="${escapeHtml(state.activeCourseId)}">Rename</button>
              <button class="study-menu-item study-menu-danger" type="button" role="menuitem" data-delete-course="${escapeHtml(state.activeCourseId)}">Delete</button>
            </div>
          </div>
        </header>
        ${tabMarkup()}
        ${courseGenerationCards().length ? `<div class="study-material-list study-generation-list">${generationCardsMarkup()}</div>` : ""}
        <div class="study-tab-panel" data-study-tab-panel="${escapeHtml(state.activeCourseTab)}">${body}</div>
      </div>`;
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
      closeNoteDownloadMenu();
      return;
    }
    if (els.studyNoteTitle) els.studyNoteTitle.textContent = studyNote.title || "Note";
    if (els.studyNoteBody) {
      try {
        els.studyNoteBody.innerHTML = renderContent(noteBody(studyNote)) || `<pre>${escapeHtml(noteBody(studyNote))}</pre>`;
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

  function render() {
    if (!els.studyView) return;
    if (!state.session) {
      if (generations.size) abortAllGenerations();
    } else {
      pruneDeletedCourseGenerations();
    }
    const visible = studyVisible();
    if (visible) parkComposer();
    els.studyView.classList.toggle("hidden", !visible);
    els.studyView.classList.toggle("study-view--detail", Boolean(visible && state.activeCourseId));
    els.studyHubButton?.classList.toggle("active", state.studyOpen);
    document.body.classList.toggle("study-open", visible);
    if (visible) {
      els.messages?.classList.add("hidden");
      els.chatPromptNav?.classList.add("hidden");
    }
    const chatReady = Boolean(visible && state.activeCourseId && state.activeCourseTab === "chat");
    if (visible) els.composerArea?.classList.toggle("hidden", !chatReady);
    if (!visible) {
      renderNoteOverlay();
      return;
    }
    els.studyView.innerHTML = state.activeCourseId ? courseDetailMarkup() : courseListMarkup();
    if (chatReady) {
      const slot = els.studyView.querySelector(".study-composer-slot");
      if (slot && els.composerArea) slot.append(els.composerArea);
    }
    if (state.activeCourseTab === "materials") bindMaterialsDnD();
    renderNoteOverlay();
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
      if (studyVisible() && state.activeCourseId) render();
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
      if (state.activeCourseId === courseId) {
        await Promise.all([
          loadMaterials().catch(() => {}),
          loadPractice().catch(() => {})
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

  async function loadMaterials() {
    if (!state.activeCourseId) return;
    const id = state.activeCourseId;
    const payload = await fetchStudyMaterials(state.session, id);
    if (state.activeCourseId !== id) return;
    state.studyMaterials = payload;
  }

  async function loadPractice() {
    if (!state.activeCourseId) return;
    const id = state.activeCourseId;
    const payload = await fetchStudyPractice(state.session, id);
    if (state.activeCourseId !== id) return;
    state.studyPractice = payload;
  }

  async function loadCourseDetail() {
    if (!state.activeCourseId) return;
    const id = state.activeCourseId;
    const payload = await fetchProject(state.session, id);
    if (state.activeCourseId !== id) return;
    state.studyProjectDetail = payload;
  }

  async function loadCourse() {
    await loadCourseDetail();
    if (state.activeCourseTab === "materials") await loadMaterials();
    if (state.activeCourseTab === "practice") await loadPractice();
    if (state.activeCourseTab === "chat" && !state.studyMaterials) {
      await loadMaterials().catch(() => {});
    }
  }

  function resetCourseCaches() {
    state.studyMaterials = null;
    state.studyPractice = null;
    state.studyProjectDetail = null;
    pendingUploads = [];
    quizMenuKey = "";
    studyNote = null;
  }

  async function openCourses({ replace = false } = {}) {
    if (!requireAuth() || blockChatNavigationWhileRunning()) return;
    if (state.images.some((item) => item.category === "document" && !item.attachmentId)) {
      showToast("Wait for the document upload to finish before opening Study Hub.");
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
    resetCourseCaches();
    state.activeConversationId = "";
    state.messages = [];
    state.images = [];
    renderImages();
    closeDocumentViewer();
    document.body.classList.remove("sidebar-open");
    await loadProjects();
    syncStudyUrl({ replace });
    renderShell();
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
    state.activeCourseId = courseId;
    state.activeCourseTab = TABS.includes(tab) ? tab : "materials";
    resetCourseCaches();
    state.activeConversationId = "";
    state.messages = [];
    state.images = [];
    renderImages();
    closeDocumentViewer();
    document.body.classList.remove("sidebar-open");
    renderShell();
    try {
      await loadCourse();
      syncStudyUrl({ replace });
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

  function confirmDeleteCourse(courseId) {
    const course = courseById(courseId);
    openDeleteConfirm({
      title: "Delete course?",
      body: `Delete "${course?.name || "this course"}", its chats, and its study material?`,
      projectId: courseId
    });
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
    const nextTitle = payload?.title || title;
    if (state.studyPractice?.decks) {
      state.studyPractice = {
        ...state.studyPractice,
        decks: state.studyPractice.decks.map((item) => item.id === deckId ? { ...item, title: nextTitle } : item)
      };
    }
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
      await Promise.all([loadPractice().catch(() => {})]);
      render();
      showToast("Deck deleted.");
    } catch (error) {
      showToast(error.message || "Deck could not be deleted.");
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
      body: `Delete "${note.title || noteKindLabel(note)}"?`,
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
      await Promise.all(locals.map(async (item) => {
        const category = String(item.file.type || "").startsWith("image/") ? "image" : "document";
        const presigned = await presignUpload(state.session, item.file, category, { projectId: courseId });
        try {
          await putUploadContent(state.session, presigned, item.file, category);
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
            await waitForDocument(completed.id, item.name).catch(() => null);
          }
        } catch (error) {
          await deleteAttachment(state.session, presigned.uploadId).catch(() => {});
          throw error;
        }
      }));
      if (state.studyOpen && state.activeCourseId === courseId) {
        await Promise.all([loadMaterials()]);
      }
    } catch (error) {
      showToast(error.message || "Files could not be uploaded.");
    } finally {
      pendingUploads = pendingUploads.filter((row) => !locals.some((item) => item.id === row.id));
      state.studyUploading = false;
      if (state.activeCourseId === courseId) render();
    }
  }

  async function runGenerate(kind, id, type, { count, mode } = {}) {
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
    const body = { type };
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
    const kind = job.documentFileId ? "doc" : "note";
    const id = job.documentFileId || job.noteId;
    if (!id || !job.type) return;
    generations.delete(jobId);
    void runGenerate(kind, id, job.type, { count: job.count, mode: job.mode });
  }

  async function setTab(tab) {
    if (!TABS.includes(tab) || tab === state.activeCourseTab) return;
    state.activeCourseTab = tab;
    quizMenuKey = "";
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

  function closeSession() {
    const reviewed = Boolean(reviewSession);
    clearTimeout(reviewSession?.animTimer);
    reviewSession = null;
    quizSession = null;
    if (quizMenuKey === "review") quizMenuKey = "";
    const root = sessionRoot();
    if (root) {
      root.classList.add("hidden");
      root.innerHTML = "";
      root.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("study-session-open");
    if (reviewed) render();
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
        <span class="study-review-text"><span>${escapeHtml((side === "front" ? card.front : card.back) || "").replaceAll("___", '<span class="study-blank" aria-label="blank"></span>')}</span></span>
        <span class="study-review-see">${side === "front" ? "See answer" : "See question"}</span>
      </span>`;
  }

  function reviewCardMarkup(session) {
    if (!session.cards.length) {
      return `
        <div class="study-session-end">
          <p class="study-kicker">Deck empty</p>
          <strong>No cards left</strong>
          <button class="study-primary-btn" type="button" data-close-session>Close</button>
        </div>`;
    }
    const card = session.cards[session.index];
    const menuOpen = quizMenuKey === "review";
    const atStart = session.index === 0;
    const atEnd = session.index >= session.cards.length - 1;
    return `
      <button class="study-session-close" type="button" data-close-session aria-label="Close review">×</button>
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
          <div class="study-card-menu-wrap study-review-menu">
            <button class="study-icon-btn" type="button" data-toggle-review-menu aria-label="Set options" aria-haspopup="menu" aria-expanded="${menuOpen ? "true" : "false"}">
              ${kebabIcon()}
            </button>
            <div class="study-menu${menuOpen ? "" : " hidden"}" role="menu">
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
      </div>`;
  }

  function renderReview() {
    if (!reviewSession) return;
    openSessionShell(`<div class="study-session-frame is-review">${reviewCardMarkup(reviewSession)}</div>`);
  }

  async function startReview(deck) {
    if (!state.activeCourseId || !deck) return;
    try {
      const payload = await fetchStudyQueue(state.session, state.activeCourseId, deckSourceOf(deck));
      const cards = payload?.cards || [];
      if (!cards.length) {
        showToast("This deck has no cards yet.");
        return;
      }
      reviewSession = {
        cards,
        original: cards.slice(),
        index: 0,
        flipped: false,
        reviewed: 0,
        counts: { 1: 0, 2: 0, 3: 0, 4: 0 },
        marks: {},
        deckId: deck?.id || ""
      };
      renderReview();
    } catch (error) {
      showToast(error.message || "Could not start review.");
    }
  }

  function confirmOpen() {
    return Boolean(document.getElementById("confirmDialog")?.classList.contains("open"));
  }

  function flipReview() {
    if (!reviewSession?.cards.length || reviewSession.animating || confirmOpen()) return;
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
    if (!reviewSession?.cards.length || reviewSession.animating) return;
    const next = reviewSession.index + Number(delta);
    if (next < 0 || next >= reviewSession.cards.length) return;
    reviewSession.index = next;
    reviewSession.flipped = false;
    closeReviewMenu();
    renderReview();
  }

  function restartReview() {
    if (!reviewSession) return;
    clearTimeout(reviewSession.animTimer);
    reviewSession.animating = false;
    closeReviewMenu();
    reviewSession.cards = reviewSession.original.slice();
    reviewSession.index = 0;
    reviewSession.flipped = false;
    reviewSession.reviewed = 0;
    reviewSession.counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    reviewSession.marks = {};
    renderReview();
  }

  function shuffleReview() {
    if (!reviewSession?.cards.length) return;
    clearTimeout(reviewSession.animTimer);
    reviewSession.animating = false;
    closeReviewMenu();
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
    openDeleteConfirm({
      title: "Delete flashcard?",
      body: "Delete this card from the deck?",
      onConfirm: () => deleteReviewCard(card)
    });
  }

  async function deleteReviewCard(card) {
    if (!reviewSession || !card) return;
    try {
      await deleteStudyCard(state.session, card.id);
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
        state.studyPractice = {
          ...state.studyPractice,
          decks: state.studyPractice.decks.map((deck) => (
            deck.id === reviewSession.deckId
              ? { ...deck, cardCount: Math.max(0, Number(deck.cardCount || 0) - 1) }
              : deck
          ))
        };
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
    if (!reviewSession?.cards.length || reviewSession.animating) return;
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

  function quizLookbackMarkup(session) {
    const { results, quiz, adding, added } = session;
    const items = (quiz.questions || []).map((question, index) => {
      const row = results?.[index] || {};
      const yours = row.yourAnswer;
      const correct = row.answer;
      const kind = row.correct ? "is-right" : yours < 0 ? "is-skip" : "is-wrong";
      const mark = row.correct ? "Right" : yours < 0 ? "Skipped" : "Wrong";
      const already = added?.has(index);
      return `
        <article class="study-miss ${kind}">
          <p class="study-miss-mark">${mark}</p>
          <p>${escapeHtml(question.q || `Question ${index + 1}`)}</p>
          ${yours >= 0 ? `<p class="study-miss-yours">${escapeHtml(question.choices?.[yours] || "")}</p>` : `<p class="study-miss-yours">Skipped</p>`}
          <p class="study-miss-correct">${escapeHtml(question.choices?.[correct] || "")}</p>
          ${row.explanation ? `<p class="study-miss-explain">${escapeHtml(row.explanation)}</p>` : ""}
          <button class="study-chip-btn" type="button" data-add-missed="${index}" ${already || adding === index ? "disabled" : ""}>
            ${adding === index ? spinner() : already ? "Added" : "Add to flashcards"}
          </button>
        </article>`;
    }).join("");
    return `
      <div class="study-quiz-lookback">
        <button class="study-chip-btn" type="button" data-quiz-recap>Back</button>
        <h2>Review</h2>
        <div class="study-miss-list">${items || `<p class="study-empty-inline">Nothing to review.</p>`}</div>
        <button class="study-chip-btn" type="button" data-quiz-recap>Back</button>
      </div>`;
  }

  function quizLetter(pct) {
    if (pct >= 90) return "A";
    if (pct >= 70) return "B";
    if (pct >= 50) return "C";
    return "F";
  }

  function quizNote(letter) {
    if (letter === "A") return "Excellent — you did well!";
    if (letter === "B") return "Keep it up, you're almost there.";
    if (letter === "C") return "Not bad. One more pass.";
    return "See me after class!";
  }

  function quizRecapMarkup(session) {
    const { score, total, results, quiz } = session;
    const pct = total ? Math.round((score / total) * 100) : 0;
    const skipped = (results || []).filter((row) => row.yourAnswer < 0).length;
    const wrong = (results || []).filter((row) => !row.correct && row.yourAnswer >= 0).length;
    const letter = quizLetter(pct);
    const tone = pct >= 70 ? "good" : pct >= 50 ? "ok" : "bad";
    return `
      <div class="study-quiz-recap is-${tone}">
        <header class="study-quiz-sheet">
          <div class="study-quiz-sheet-copy">
            <h2>Quiz Results</h2>
            <p class="study-quiz-subject">Subject: ${escapeHtml(quiz.title || "Quiz")}</p>
          </div>
          <p class="study-quiz-percent" aria-label="Grade ${letter}, ${escapeHtml(String(pct))} percent">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <ellipse cx="50" cy="50" rx="43" ry="40" transform="rotate(-8 50 50)"/>
              <ellipse cx="51" cy="49" rx="41" ry="38" transform="rotate(5 51 49)"/>
            </svg>
            <strong>${escapeHtml(String(pct))}%</strong>
            <span>${letter}</span>
          </p>
        </header>
        <ul class="study-quiz-marks">
          <li class="is-right"><span aria-hidden="true">✓</span> Correct: ${escapeHtml(String(score))}</li>
          <li class="is-wrong"><span aria-hidden="true">✕</span> Wrong: ${escapeHtml(String(wrong))}</li>
          <li class="is-skip"><span aria-hidden="true">–</span> Skipped: ${escapeHtml(String(skipped))}</li>
        </ul>
        <div class="study-quiz-foot">
          <hr class="study-quiz-rule">
          <div class="study-quiz-links">
            <button type="button" data-quiz-lookback>Review Quiz</button>
            <button type="button" data-close-session>Finish</button>
          </div>
          <button class="study-quiz-retake" type="button" data-quiz-retake>Retake Quiz</button>
          <p class="study-quiz-note">${quizNote(letter)}</p>
        </div>
      </div>`;
  }

  function quizMarkup(session) {
    if (session.phase === "lookback") return quizLookbackMarkup(session);
    if (session.phase === "results") return quizRecapMarkup(session);
    const question = session.quiz.questions[session.index] || {};
    const total = session.quiz.questions.length;
    const revealed = session.phase === "reveal";
    const pct = total ? Math.round(((session.index + (revealed ? 1 : 0)) / total) * 100) : 0;
    const answer = Number(question.answer);
    const selected = session.selected;
    const correctPick = selected === answer;
    const skipped = selected === -1;
    const hasWhys = (question.whys || []).some((why) => String(why || "").trim());
    const fallback = revealed && !hasWhys ? String(question.explanation || "").trim() : "";
    const last = session.index >= total - 1;
    const choices = (question.choices || []).map((choice, index) => {
      const state = !revealed
        ? (selected === index ? " is-selected" : "")
        : index === answer
          ? " is-right"
          : selected === index
            ? " is-wrong"
            : " is-idle";
      const why = revealed && hasWhys ? String(question.whys[index] || "").trim() : "";
      return `
        <button class="study-choice${state}" type="button" data-study-choice="${index}">
          <span>${escapeHtml(String.fromCharCode(65 + index))}</span>
          ${escapeHtml(choice)}
          ${why ? `<span class="study-choice-why">${escapeHtml(why)}</span>` : ""}
        </button>`;
    }).join("");
    const verdict = !revealed
      ? ""
      : skipped
        ? "Passed on this one"
        : correctPick
          ? "That's it"
          : "Not this one";
    return `
      <div class="study-session-progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="study-quiz-stage${revealed ? " is-revealed" : ""}">
        <p class="study-kicker">Question ${escapeHtml(String(session.index + 1))} of ${escapeHtml(String(total))}</p>
        <h2>${escapeHtml(question.q || "")}</h2>
        ${verdict ? `<p class="study-quiz-verdict${skipped ? " is-skip" : correctPick ? " is-right" : " is-wrong"}">${verdict}</p>` : ""}
        <div class="study-choices">${choices}</div>
        ${fallback ? `<p class="study-quiz-explain">${escapeHtml(fallback)}</p>` : ""}
        <div class="study-quiz-nav">
          ${revealed
            ? `<button class="study-primary-btn" type="button" data-study-continue ${session.submitting ? "disabled" : ""}>${session.submitting ? spinner() : last ? "See rundown" : "Continue"}</button>`
            : `<button class="study-chip-btn" type="button" data-study-skip>Skip</button>`}
        </div>
      </div>`;
  }

  function renderQuiz() {
    if (!quizSession) return;
    const extra = quizSession.phase === "results" ? " is-recap" : quizSession.phase === "lookback" ? " is-lookback" : "";
    openSessionShell(`
      <button class="study-session-close" type="button" data-close-session aria-label="Close quiz">×</button>
      <div class="study-session-frame is-quiz${extra}">${quizMarkup(quizSession)}</div>
    `);
  }

  async function startQuiz(quizId) {
    try {
      const payload = await fetchStudyQuiz(state.session, quizId);
      const quiz = payload?.quiz || payload;
      if (!quiz?.questions?.length) {
        showToast("This quiz has no questions yet.");
        return;
      }
      const existingFronts = Array.isArray(payload?.existingFronts) ? payload.existingFronts : [];
      quizSession = {
        quiz,
        index: 0,
        selected: null,
        answers: [],
        phase: "ask",
        adding: null,
        submitting: false,
        existingFronts,
        added: addedQuestionIndexes(quiz.questions, existingFronts),
        courseId: state.activeCourseId
      };
      renderQuiz();
    } catch (error) {
      showToast(error.message || "Could not open quiz.");
    }
  }

  function revealQuizChoice(index) {
    if (!quizSession || quizSession.phase !== "ask") return;
    if (index !== -1 && !Number.isInteger(index)) return;
    quizSession.selected = index;
    quizSession.phase = "reveal";
    const answer = Number(quizSession.quiz.questions[quizSession.index]?.answer);
    if (index === answer) sound.tick();
    renderQuiz();
  }

  async function continueQuiz() {
    if (!quizSession || quizSession.phase !== "reveal" || quizSession.submitting) return;
    const value = quizSession.selected == null ? -1 : quizSession.selected;
    quizSession.answers.push(value);
    quizSession.selected = null;
    if (quizSession.index >= quizSession.quiz.questions.length - 1) {
      quizSession.submitting = true;
      renderQuiz();
      try {
        const payload = await submitStudyQuizAttempt(state.session, quizSession.quiz.id, quizSession.answers);
        quizSession.phase = "results";
        quizSession.score = payload.score;
        quizSession.total = payload.total;
        quizSession.results = payload.results || [];
        quizSession.submitting = false;
        sound.chime();
      } catch (error) {
        quizSession.answers.pop();
        quizSession.selected = value;
        quizSession.submitting = false;
        showToast(error.message || "Could not submit quiz.");
        renderQuiz();
        return;
      }
    } else {
      quizSession.index += 1;
      quizSession.phase = "ask";
    }
    renderQuiz();
  }

  function retakeQuiz() {
    if (!quizSession?.quiz) return;
    quizSession = {
      quiz: quizSession.quiz,
      courseId: quizSession.courseId,
      index: 0,
      selected: null,
      answers: [],
      phase: "ask",
      adding: null,
      submitting: false,
      existingFronts: quizSession.existingFronts || [],
      added: addedQuestionIndexes(quizSession.quiz.questions, quizSession.existingFronts)
    };
    renderQuiz();
  }

  async function addMissedCard(index) {
    if (!quizSession || quizSession.phase !== "lookback") return;
    if (quizSession.added?.has(index)) return;
    const row = quizSession.results[index];
    const question = quizSession.quiz.questions[index];
    if (!row || !question || !quizSession.courseId) return;
    const correct = question.choices?.[row.answer] || "";
    const back = [correct, row.explanation].filter(Boolean).join("\n\n");
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
      quizSession.adding = null;
      renderQuiz();
    }
  }

  function handleSessionClick(event) {
    if (event.target.closest("[data-close-session]")) {
      closeSession();
      return;
    }
    if (reviewSession) {
      if (event.target.closest("[data-toggle-review-menu]")) {
        toggleReviewMenu();
        return;
      }
      if (event.target.closest("[data-review-restart]")) return restartReview();
      if (event.target.closest("[data-review-shuffle]")) return shuffleReview();
      if (event.target.closest("[data-review-delete]")) return confirmDeleteCard();
      if (quizMenuKey === "review" && !event.target.closest(".study-review-menu")) closeReviewMenu();
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
    if (!quizSession) return;
    const choice = event.target.closest("[data-study-choice]");
    if (choice && quizSession.phase === "ask") {
      revealQuizChoice(Number(choice.dataset.studyChoice));
      return;
    }
    if (event.target.closest("[data-study-skip]")) {
      revealQuizChoice(-1);
      return;
    }
    if (event.target.closest("[data-study-continue]")) {
      void continueQuiz();
      return;
    }
    if (event.target.closest("[data-quiz-lookback]")) {
      quizSession.phase = "lookback";
      renderQuiz();
      return;
    }
    if (event.target.closest("[data-quiz-recap]")) {
      quizSession.phase = "results";
      renderQuiz();
      return;
    }
    if (event.target.closest("[data-quiz-retake]")) {
      retakeQuiz();
      return;
    }
    const miss = event.target.closest("[data-add-missed]");
    if (miss) void addMissedCard(Number(miss.dataset.addMissed));
  }

  function handleSessionKey(event) {
    if (reviewSession?.cards.length) {
      if (confirmOpen()) return;
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
    if (quizSession?.phase === "ask" && ["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      revealQuizChoice(Number(event.key) - 1);
      return;
    }
    if (quizSession?.phase === "reveal" && event.key === "Enter") {
      event.preventDefault();
      void continueQuiz();
    }
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
    if (confirmOpen()) return false;
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
    return false;
  }

  async function handleViewClick(event) {
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
      const deck = findDeck(openDeck.dataset.openDeck);
      if (deck) return startReview(deck);
      return;
    }
    const quiz = event.target.closest("[data-open-quiz]");
    if (quiz) return startQuiz(quiz.dataset.openQuiz);
    if (event.target.closest("[data-study-add-files]")) {
      els.studyFileInput?.click();
      return;
    }
    const gen = event.target.closest("[data-study-generate]");
    if (gen) {
      event.stopPropagation();
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
      return openNote(note.dataset.openNote);
    }
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
    els.studyView?.addEventListener("change", (event) => { void handleViewChange(event); });
    els.studyView?.addEventListener("keydown", handleViewKey);
    els.studyFileInput?.addEventListener("change", (event) => {
      void uploadCourseFiles(event.target.files || []);
      event.target.value = "";
    });
    els.courseCreateForm?.addEventListener("submit", (event) => { void submitCreate(event); });
    els.courseCreateCancel?.addEventListener("click", () => els.courseCreateDialog?.close());
    els.courseRenameForm?.addEventListener("submit", (event) => { void submitRename(event); });
    els.courseRenameCancel?.addEventListener("click", () => els.courseRenameDialog?.close());
    els.studyNoteClose?.addEventListener("click", closeNote);
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
    isSessionOpen: () => Boolean(reviewSession || quizSession)
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
