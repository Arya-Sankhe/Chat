// Composer "Context" pill for course chats: Auto uses every ready source,
// or the learner narrows the chat to chosen sources, or to pages ticked in a
// source's preview. A banner above the prompt says what the answer will use.
const SEARCH_AT = 7;

const ICONS = {
  auto: '<path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  page: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h4"/>',
  pages: '<path d="M8 6h7l4 4v11H8z"/><path d="M15 6v4h4"/><path d="M5 17V3h8"/>'
};

/** "p. 1, 3-5" for a set of page numbers. */
export function pagesLabel(pages) {
  const sorted = [...pages].sort((a, b) => a - b);
  const runs = [];
  for (const page of sorted) {
    const last = runs.at(-1);
    if (last && page === last[1] + 1) last[1] = page;
    else runs.push([page, page]);
  }
  return `${sorted.length === 1 ? "p." : "pp."} ${runs.map(([from, to]) => (from === to ? from : `${from}-${to}`)).join(", ")}`;
}

function svg(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function createCourseContextPicker({ state, escapeHtml, readyDocs, documentDisplayName, sourceBadge, sourceShortName, onChange = () => {}, onOpenPage = () => {} }) {
  const chosenByCourse = new Map();
  // Ticked pages per chosen source; a chosen source with no entry here is used whole.
  const pagesByCourse = new Map();
  // Small page renders handed over by the preview, keyed "docId:page".
  const thumbs = new Map();
  let open = false;
  let query = "";

  const wrap = () => document.getElementById("composerContextWrap");
  const root = wrap;

  function chosen() {
    const courseId = state.activeCourseId;
    if (!courseId) return new Set();
    if (!chosenByCourse.has(courseId)) chosenByCourse.set(courseId, new Set());
    return chosenByCourse.get(courseId);
  }

  function pages() {
    const courseId = state.activeCourseId;
    if (!courseId) return new Map();
    if (!pagesByCourse.has(courseId)) pagesByCourse.set(courseId, new Map());
    return pagesByCourse.get(courseId);
  }

  // Drop ids for sources that were removed or are no longer ready.
  function liveChosen() {
    const set = chosen();
    const ready = new Set(readyDocs().map((doc) => doc.id));
    for (const id of set) if (!ready.has(id)) set.delete(id);
    for (const id of pages().keys()) if (!set.has(id)) pages().delete(id);
    return set;
  }

  function changed() {
    render();
    onChange();
  }

  function forget(id) {
    chosen().delete(id);
    pages().delete(id);
  }

  function clearAll() {
    chosen().clear();
    pages().clear();
  }

  function pillMarkup(set) {
    const count = set.size;
    const only = count === 1 ? pages().get([...set][0]) : null;
    const label = only ? pagesLabel(only) : count ? `${count} source${count === 1 ? "" : "s"}` : "Auto";
    const title = count ? `Chatting about ${label}` : "Chatting about all course sources";
    return `<button class="composer-context-btn${count ? " is-scoped" : ""}" type="button" data-context-toggle aria-haspopup="dialog" aria-expanded="${open}" aria-label="Context: ${label}" title="${title}">${svg("auto", 15)}<span>${label}</span><span class="composer-context-chevron">${svg("chevron", 13)}</span></button>`;
  }

  function listMarkup(docs, set) {
    const q = query.trim().toLowerCase();
    const shown = q ? docs.filter((doc) => documentDisplayName(doc).toLowerCase().includes(q)) : docs;
    if (!docs.length) return '<p class="composer-context-empty">Add sources to this course to pick from them.</p>';
    if (!shown.length) return '<p class="composer-context-empty">No matching sources.</p>';
    return shown.map((doc) => {
      const on = set.has(doc.id);
      const name = documentDisplayName(doc);
      const picked = on ? pages().get(doc.id) : null;
      return `<button class="composer-context-item${on ? " is-on" : ""}" type="button" role="menuitemcheckbox" aria-checked="${on}" data-context-source="${escapeHtml(doc.id)}" title="${escapeHtml(name)}"><span class="composer-context-check">${svg("check", 12)}</span>${sourceBadge(doc)}<span class="composer-context-name">${escapeHtml(sourceShortName(doc))}</span>${picked ? `<span class="composer-context-pages">${pagesLabel(picked)}</span>` : ""}</button>`;
    }).join("");
  }

  function popMarkup(docs, set) {
    const auto = !set.size;
    return `<div class="composer-context-pop" role="dialog" aria-label="Chat context">
      <button class="composer-context-auto${auto ? " is-on" : ""}" type="button" role="menuitemradio" aria-checked="${auto}" data-context-auto>
        <span class="composer-context-auto-icon">${svg("auto", 17)}</span>
        <span class="composer-context-auto-copy"><strong>Auto</strong><small>All ${docs.length || ""} course source${docs.length === 1 ? "" : "s"}</small></span>
        <span class="composer-context-tick">${svg("check", 15)}</span>
      </button>
      <div class="composer-context-head"><span>Only these sources</span>${set.size ? `<button type="button" data-context-clear>Clear</button>` : ""}</div>
      ${docs.length >= SEARCH_AT ? `<label class="composer-context-search">${svg("search", 14)}<input type="search" data-context-search placeholder="Search sources" autocomplete="off" value="${escapeHtml(query)}" aria-label="Search sources"></label>` : ""}
      <div class="composer-context-list" role="menu">${listMarkup(docs, set)}</div>
    </div>`;
  }

  function render() {
    const root = wrap();
    if (!root) return;
    const set = liveChosen();
    if (!state.studyOpen || !state.activeCourseId) open = false;
    const docs = readyDocs();
    root.innerHTML = pillMarkup(set) + (open ? popMarkup(docs, set) : "");
    root.classList.toggle("is-open", open);
    renderTray(docs);
  }

  // Ticked pages sit with the composer's attachments: one page as its own card, several as "7 pages".
  function tray() {
    let el = document.getElementById("composerScopeTray");
    if (el) return el;
    const previews = root()?.closest(".composer")?.querySelector("#imagePreviews");
    if (!previews) return null;
    el = document.createElement("div");
    el.id = "composerScopeTray";
    el.className = "composer-previews composer-scope-tray";
    el.setAttribute("aria-label", "Pages this answer will use");
    el.addEventListener("click", handleClick);
    previews.after(el);
    return el;
  }

  function pageCardMarkup(doc, page) {
    const noun = doc.kind === "pptx" || doc.kind === "ppt" ? "Slide" : "Page";
    const name = documentDisplayName(doc);
    const thumb = thumbs.get(`${doc.id}:${page}`);
    return `<div class="preview-thumb composer-scope-page" data-scope-open="${escapeHtml(doc.id)}" data-scope-page="${page}" title="${escapeHtml(`${name} · ${noun} ${page}`)}">
      ${thumb ? `<img src="${thumb}" alt="">` : `<span class="composer-scope-page-icon">${svg("page", 20)}</span>`}
      <span class="composer-scope-page-label">${noun === "Slide" ? "Slide" : "p."} ${page}</span>
      <button class="preview-remove" type="button" data-scope-unpick="${escapeHtml(doc.id)}" data-scope-page="${page}" aria-label="Remove ${noun.toLowerCase()} ${page}">×</button>
    </div>`;
  }

  function pagesCardMarkup(doc, picked) {
    const noun = doc.kind === "pptx" || doc.kind === "ppt" ? "slides" : "pages";
    const name = documentDisplayName(doc);
    return `<div class="preview-thumb preview-file composer-scope-pages-card" data-scope-open="${escapeHtml(doc.id)}" data-scope-page="${Math.min(...picked)}" title="${escapeHtml(`${name} · ${pagesLabel(picked)}`)}">
      <span class="preview-file-icon composer-scope-stack" aria-hidden="true">${svg("pages", 18)}</span>
      <span class="composer-scope-pages-copy"><strong>${picked.size} ${noun}</strong><small>${escapeHtml(sourceShortName(doc))}</small></span>
      <button class="preview-remove" type="button" data-scope-remove="${escapeHtml(doc.id)}" aria-label="Remove these ${noun}">×</button>
    </div>`;
  }

  function renderTray(docs) {
    const el = tray();
    if (!el) return;
    const inCourse = state.studyOpen && state.activeCourseId;
    el.innerHTML = inCourse ? docs.map((doc) => {
      const picked = pages().get(doc.id);
      if (!picked?.size) return "";
      return picked.size === 1 ? pageCardMarkup(doc, [...picked][0]) : pagesCardMarkup(doc, picked);
    }).join("") : "";
    if (el.innerHTML) root()?.closest(".composer")?.classList.remove("compact");
  }

  function renderList() {
    const list = wrap()?.querySelector(".composer-context-list");
    if (list) list.innerHTML = listMarkup(readyDocs(), liveChosen());
  }

  function setOpen(next) {
    if (open === next) return;
    open = next;
    if (!open) query = "";
    render();
    if (open) wrap()?.querySelector("[data-context-search]")?.focus();
  }

  function handleClick(event) {
    const target = event.target;
    if (target.closest("[data-context-toggle]")) return setOpen(!open);
    const set = chosen();
    if (target.closest("[data-context-auto]") || target.closest("[data-context-clear]")) {
      clearAll();
      return changed();
    }
    const unpick = target.closest("[data-scope-unpick]");
    if (unpick) return togglePage(unpick.dataset.scopeUnpick, Number(unpick.dataset.scopePage), false);
    const remove = target.closest("[data-scope-remove]");
    if (remove) {
      forget(remove.dataset.scopeRemove);
      return changed();
    }
    const card = target.closest("[data-scope-open]");
    if (card) return onOpenPage(card.dataset.scopeOpen, Number(card.dataset.scopePage) || 1, event);
    const item = target.closest("[data-context-source]");
    if (!item) return;
    const id = item.dataset.contextSource;
    // Unticking a source drops its pages too; ticking it here uses it whole.
    if (set.has(id)) forget(id);
    else set.add(id);
    const scroll = wrap()?.querySelector(".composer-context-list")?.scrollTop || 0;
    changed();
    const list = wrap()?.querySelector(".composer-context-list");
    if (list) list.scrollTop = scroll;
    wrap()?.querySelector(`[data-context-source="${CSS.escape(id)}"]`)?.focus();
  }

  function bind() {
    const root = wrap();
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";
    root.addEventListener("click", handleClick);
    root.addEventListener("input", (event) => {
      if (!event.target.matches("[data-context-search]")) return;
      query = event.target.value;
      renderList();
    });
    document.addEventListener("pointerdown", (event) => {
      if (open && !wrap()?.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (!open || event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      wrap()?.querySelector("[data-context-toggle]")?.focus();
    }, true);
  }

  function pageOn(id, page) {
    return Boolean(chosen().has(id) && pages().get(id)?.has(page));
  }

  // Ticking a page in a source's preview scopes the chat to it; the last untick lets the source go.
  function togglePage(id, page, on, thumb = "") {
    if (!state.activeCourseId || !Number.isInteger(page) || page < 1) return;
    if (thumb) thumbs.set(`${id}:${page}`, thumb);
    const set = chosen();
    const picked = pages().get(id) || new Set();
    if (on) picked.add(page);
    else picked.delete(page);
    if (picked.size) {
      pages().set(id, picked);
      set.add(id);
    } else {
      forget(id);
    }
    changed();
  }

  return {
    bind,
    render,
    close: () => setOpen(false),
    pageOn,
    togglePage,
    pageThumb(id, page, thumb) {
      if (!thumb || thumbs.get(`${id}:${page}`) === thumb) return;
      thumbs.set(`${id}:${page}`, thumb);
      renderTray(readyDocs());
    },
    // Chosen source document ids for the next course chat turn; empty means Auto.
    sources: () => (state.studyOpen && state.activeCourseId ? [...liveChosen()] : []),
    // Ticked pages of those sources: { [docId]: [pages] }.
    sourcePages: () => {
      if (!state.studyOpen || !state.activeCourseId) return {};
      const set = liveChosen();
      return Object.fromEntries([...pages()].filter(([id]) => set.has(id)).map(([id, picked]) => [id, [...picked].sort((a, b) => a - b)]));
    }
  };
}
