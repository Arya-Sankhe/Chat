// Composer "Context" pill for course chats: Auto uses every ready source,
// or the learner narrows the chat to chosen sources.
const SEARCH_AT = 7;

const ICONS = {
  auto: '<path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'
};

function svg(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function createCourseContextPicker({ state, escapeHtml, readyDocs, documentDisplayName, sourceBadge, sourceShortName }) {
  const chosenByCourse = new Map();
  let open = false;
  let query = "";

  const wrap = () => document.getElementById("composerContextWrap");

  function chosen() {
    const courseId = state.activeCourseId;
    if (!courseId) return new Set();
    if (!chosenByCourse.has(courseId)) chosenByCourse.set(courseId, new Set());
    return chosenByCourse.get(courseId);
  }

  // Drop ids for sources that were removed or are no longer ready.
  function liveChosen() {
    const set = chosen();
    const ready = new Set(readyDocs().map((doc) => doc.id));
    for (const id of set) if (!ready.has(id)) set.delete(id);
    return set;
  }

  function pillMarkup(count) {
    const label = count ? `${count} source${count === 1 ? "" : "s"}` : "Auto";
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
      return `<button class="composer-context-item${on ? " is-on" : ""}" type="button" role="menuitemcheckbox" aria-checked="${on}" data-context-source="${escapeHtml(doc.id)}" title="${escapeHtml(name)}"><span class="composer-context-check">${svg("check", 12)}</span>${sourceBadge(doc)}<span class="composer-context-name">${escapeHtml(sourceShortName(doc))}</span></button>`;
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
    root.innerHTML = pillMarkup(set.size) + (open ? popMarkup(docs, set) : "");
    root.classList.toggle("is-open", open);
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
      set.clear();
      return render();
    }
    const item = target.closest("[data-context-source]");
    if (!item) return;
    const id = item.dataset.contextSource;
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const scroll = wrap()?.querySelector(".composer-context-list")?.scrollTop || 0;
    render();
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

  return {
    bind,
    render,
    close: () => setOpen(false),
    // Chosen source document ids for the next course chat turn; empty means Auto.
    sources: () => (state.studyOpen && state.activeCourseId ? [...liveChosen()] : [])
  };
}
