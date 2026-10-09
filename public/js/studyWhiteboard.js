// Dojo whiteboards: a full-screen board over the course, with the Excalidraw editor (lazy-loaded
// from /vendor/whiteboard) and Klui on top. Select something (or frame an area, or just talk) and
// ask; Klui waves while it works, a bubble pops up when the answer is ready, and the answer opens
// in a card that can be read, spoken, put on the board, or followed up.
// The board lives outside the Dojo view, so Dojo repainting never touches the editor.
import { storedProposal } from "./whiteboard/colors.js";
import { boardKluiMarkup, mascotMarkup } from "./whiteboard/mascot.js";
import { createSaveQueue, draftStore, heldLocks, holdLock } from "./whiteboard/persistence.js";
import { KLUI_INK, LIMITS, TEXT_SIZES, cleanScene, cleanTitle, proposalToSkeletons } from "./whiteboard/schema.js";
import { createVoiceActivity } from "./whiteboard/voice-activity.js";
import { validateVoiceProposal, voiceTargetsUnchanged } from "./whiteboard/voice-command.js";
import { splitForSpeech, spokenText } from "./voiceMode.js";

const BUNDLE = new URL("../vendor/whiteboard/board.js", import.meta.url).href;
const STYLES = new URL("../vendor/whiteboard/board.css", import.meta.url).href;
const VOICE_LIMIT_MS = 4 * 60_000; // Keep recordings below the transcription endpoint’s five-minute limit.
const SHOWN_THREADS = 30;
const NOTE_LINE = 46;

let bundle = null;
function loadEditor() {
  if (!bundle) {
    globalThis.EXCALIDRAW_ASSET_PATH = new URL("../vendor/whiteboard/", import.meta.url).href;
    if (!document.querySelector("link[data-wb-styles]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = STYLES;
      link.dataset.wbStyles = "";
      document.head.append(link);
    }
    bundle = import(/* @vite-ignore */ BUNDLE).catch((error) => {
      bundle = null;
      throw error;
    });
  }
  return bundle;
}

const ICONS = {
  back: '<path d="m15 18-6-6 6-6"/>',
  area: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M9 12h6M12 9v6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  draw: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5m4-2v5l3 2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  speak: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  pin: '<path d="M12 20V10M7 15l5 5 5-5"/><rect x="4" y="3" width="16" height="5" rx="1.5"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function blobFromDataUrl(url) {
  const [head, data] = String(url).split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] || "application/octet-stream";
  const bytes = Uint8Array.from(atob(data || ""), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

/** Hard-wraps an answer for a handwritten note on the board. */
export function noteLines(text, width = NOTE_LINE) {
  const out = [];
  for (const paragraph of spokenText(text).split(/(?<=[.!?])\s+(?=[A-Z0-9])/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + word).length > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out.slice(0, 40).join("\n");
}

export function createWhiteboardController({ api, getSession, getUserId, voicePrefs, voiceEnabled, renderContent, escapeHtml, showToast, onClosed, onRenamed, onCreated }) {
  const store = draftStore();
  let board = null; // the open board; null when closed

  function voiceSupported() {
    return Boolean(voiceEnabled?.() && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined" && (window.AudioContext || window.webkitAudioContext));
  }

  /** Opens a board ({ id, title, courseName }). */
  async function open(meta) {
    if (board) await close();
    const view = createBoardView(meta);
    board = view;
    try {
      await view.start();
    } catch (error) {
      if (board === view) {
        showToast(error?.message || "The board could not open.");
        await close();
      }
    }
  }

  async function close() {
    const view = board;
    if (!view) return;
    board = null;
    await view.destroy();
    onClosed?.(view.summary());
  }

  function createBoardView(meta) {
    // Each open board keeps its own draft, so two tabs never clear each other's unsaved work.
    // A draft whose tab is gone (its lock is free) is offered back on the next visit.
    const draftPrefix = `${getUserId()}:${meta.id}`;
    const draftKey = `${draftPrefix}:${crypto.randomUUID()}`;
    const lockName = (key) => `klui-whiteboard:${key}`;
    let releaseLock = () => {};
    let recovery = []; // drafts left by earlier visits that can't simply be continued
    const speechSession = crypto.randomUUID();
    let speechReply = 0;
    let editor = null;
    let queue = null;
    let title = meta.title || "Whiteboard";
    let courseId = meta.courseId || "";
    let revision = 0;
    let destroyed = false;
    let queuedKey = ""; // the scene last handed to the save queue
    let uploaded = new Set();
    let uploading = new Map();
    let failedFiles = new Set();
    let raf = 0;
    let areaMode = false;
    let areaDrag = null;
    let composer = null; // { captureMode, rect, elements, text }
    let activeAsk = null; // { controller, key }
    let openThread = "";
    let voiceJob = null; // the one voice question in progress: freezing → recording → sending
    let playback = null;
    let voiceMode = false;
    let voiceReply = Promise.resolve();
    let voiceThread = null; // one conversation per voice session, so "no, I meant…" has context
    let voiceAckClip = null;
    let voiceAckController = null;
    let voiceAcknowledgement = Promise.resolve();
    let moreTurns = false;
    const threads = new Map(); // threadId (or request id while starting) → thread

    const root = document.createElement("div");
    root.className = "wb-shell";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Whiteboard");
    root.innerHTML = `
      <header class="wb-top">
        <button class="wb-icon-btn" type="button" data-wb-close aria-label="Back to the course" title="Back">${icon("back")}</button>
        <div class="wb-crumb"><span class="wb-course">${escapeHtml(meta.courseName || "Course")}</span><span aria-hidden="true">/</span>
          <input class="wb-title" value="${escapeHtml(title)}" maxlength="${LIMITS.title}" aria-label="Board name"></div>
        <span class="wb-save" data-wb-save data-status="saved" role="status">Saved</span>
        <div class="wb-dock">
          <button class="wb-dock-btn" type="button" data-wb-area aria-pressed="false" title="Frame any area and ask Klui about it">${icon("area")}<span>Ask area</span></button>
          <button class="wb-dock-btn" type="button" data-wb-talk aria-pressed="false" title="Ask questions and control the board by voice"${voiceSupported() ? "" : " hidden"}>${icon("mic")}<span>Voice mode</span></button>
          <button class="wb-dock-btn" type="button" data-wb-history aria-expanded="false" title="Klui's answers on this board">${icon("history")}<span>Answers</span></button>
        </div>
      </header>
      <div class="wb-banner" data-wb-banner hidden></div>
      <div class="wb-stage">
        <div class="wb-canvas" data-wb-canvas><div class="wb-loading" role="status"><span class="study-spin" aria-hidden="true"></span>Opening the board…</div></div>
        <div class="wb-area-layer" data-wb-area-layer hidden></div>
        <div class="wb-overlay" data-wb-overlay></div>
      </div>
      <div class="wb-voice-tip" data-wb-voice-tip hidden>
        <button class="wb-icon-btn" type="button" data-wb-voice-dismiss aria-label="Dismiss voice tip">${icon("close")}</button>
        <strong>Voice mode</strong>
        <p>Ask about what you see, or tell Klui to draw, write, or change text and colours. Pause to send. Klui answers aloud and adds changes to your board.</p>
        <small>Try “Explain this in one line” or “Turn this into a diagram.”<br>Undo reverses changes. Press Esc to exit.</small>
      </div>
      <div class="wb-voice-status" data-wb-voice-status hidden role="status" aria-live="polite"></div>
      <aside class="wb-history" data-wb-history-panel hidden aria-label="Klui's answers"></aside>`;
    document.body.append(root);
    document.documentElement.classList.add("wb-open");
    // A sideways trackpad swipe that nothing scrolls becomes the browser's back gesture, which
    // would leave the board. Keep it inside unless something there can scroll sideways.
    root.addEventListener("wheel", (event) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      for (let node = event.target; node && node !== root; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth && /auto|scroll/.test(getComputedStyle(node).overflowX)) return;
      }
      event.preventDefault();
    }, { passive: false });
    const $ = (selector) => root.querySelector(selector);
    const overlay = $("[data-wb-overlay]");

    // ---------- Loading ----------

    async function start() {
      const session = getSession();
      releaseLock = await holdLock(lockName(draftKey));
      if (destroyed) return releaseLock();
      const [payload, editorModule, drafts, live] = await Promise.all([
        api.fetchWhiteboard(session, meta.id),
        loadEditor(),
        store.list(draftPrefix),
        heldLocks()
      ]);
      if (destroyed) return;
      const saved = payload.board;
      revision = saved.revision;
      courseId = saved.courseId || courseId;
      title = saved.title || title;
      $(".wb-title").value = title;
      uploaded = new Set((payload.files || []).map((file) => file.fileId));
      moreTurns = payload.moreTurns === true;
      for (const turn of [...(payload.turns || [])].reverse()) addTurn(turn, { fresh: false });

      // Drafts from tabs that are still open belong to them. Without the Locks API there is no
      // telling, so every draft counts as left behind.
      const left = drafts
        .filter((draft) => draft.key !== draftKey && draft.value?.scene && !live?.has(lockName(draft.key)))
        .sort((a, b) => (b.value.at || 0) - (a.value.at || 0));
      let scene = saved.scene;
      let restored = null;
      if (left[0]?.value.baseRevision === saved.revision) restored = left.shift();
      if (restored) scene = restored.value.scene;
      recovery = left;
      const files = [...await loadFiles(payload.files || []), ...draftFiles(restored?.value)];
      if (destroyed) return;
      const host = $("[data-wb-canvas]");
      host.innerHTML = "";
      editor = await editorModule.mountBoard(host, {
        scene,
        files,
        theme: document.body.dataset.mode === "dark" ? "dark" : "light",
        onChange: (elements, appState) => onEditorChange(elements, appState),
        onSelectionSettled: () => syncComposer(true)
      });
      if (destroyed) return editor.destroy();
      // Excalidraw tidies the loaded elements over its first frames (bindings, versions); that is
      // not an edit, so the starting point is taken once it settles.
      // (Frames don't run in a background tab, so a timer stands in for them.)
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)));
      });
      if (destroyed) return;
      queuedKey = currentKey();
      queue = createSaveQueue({
        key: draftKey,
        revision,
        store,
        save: (body) => api.saveWhiteboard(getSession(), meta.id, body),
        onStatus: setSaveStatus
      });
      if (restored) {
        // Move the draft over to this visit before letting the old copy go.
        queuedKey = "";
        await recordEdit({ force: true });
        await store.delete(restored.key);
        showToast("Restored changes that hadn't been saved yet.");
      }
      uploadNewFiles();
      if (recovery.length) showBanner("conflict-draft");
      bind();
      position();
    }

    /** Images a draft carried because they had not finished uploading. */
    function draftFiles(draft) {
      return Object.values(draft?.files || {}).filter((file) => file?.id && file.dataURL);
    }

    async function loadFiles(list) {
      const session = getSession();
      const results = await Promise.all(list.map(async (file) => {
        try {
          const blob = await api.fetchWhiteboardFile(session, meta.id, file.fileId);
          return { id: file.fileId, mimeType: file.mimeType, dataURL: await dataUrl(blob), created: Date.now() };
        } catch {
          return null;
        }
      }));
      return results.filter(Boolean);
    }

    // ---------- Saving ----------

    function sceneKey(elements) {
      let key = "";
      for (const element of elements) key += `${element.id}:${element.version}:${element.isDeleted ? 1 : 0};`;
      return key;
    }

    function currentKey() {
      return sceneKey(editor.api.getSceneElementsIncludingDeleted()) + (editor.api.getAppState().viewBackgroundColor || "");
    }

    /** Hands the scene to the save queue if it changed. The draft is written at once, even while images upload. */
    function recordEdit({ force = false } = {}) {
      if (!editor || !queue) return null;
      const key = currentKey();
      if (key === queuedKey && !force) return null;
      queuedKey = key;
      return queue.edit(cleanScene(editor.scene()), { files: pendingFiles() });
    }

    /** Images on the board that the server doesn't have yet, kept in the draft so a reload keeps them. */
    function pendingFiles() {
      const files = editor.files();
      const used = new Set(editor.api.getSceneElements().filter((element) => element.type === "image").map((element) => element.fileId));
      const out = {};
      for (const id of used) {
        const file = files[id];
        if (file?.dataURL && !uploaded.has(id) && !failedFiles.has(id)) out[id] = { id, mimeType: file.mimeType, dataURL: file.dataURL, created: file.created || Date.now() };
      }
      return out;
    }

    function onEditorChange(elements, appState) {
      if (destroyed || !editor || !queue) return;
      schedulePosition();
      if (appState.selectedElementsAreBeingDragged || appState.newElement || appState.resizingElement) hideComposerWhileEditing();
      else syncComposer(false);
      uploadNewFiles();
      void recordEdit();
    }

    function uploadNewFiles() {
      const files = editor.files();
      for (const [id, file] of Object.entries(files)) {
        if (uploaded.has(id) || uploading.has(id) || failedFiles.has(id) || !file?.dataURL) continue;
        // The server only takes a scene whose images it already has, so saves wait for uploads.
        queue.hold();
        const job = api.uploadWhiteboardFile(getSession(), meta.id, id, blobFromDataUrl(file.dataURL))
          .then(() => { uploaded.add(id); })
          .catch((error) => {
            failedFiles.add(id);
            if (!destroyed) showToast(error?.message || "That image could not be added.");
            removeImagesFor(id);
          })
          .finally(() => {
            uploading.delete(id);
            if (uploading.size) return;
            void recordEdit();
            queue.release();
          });
        uploading.set(id, job);
      }
    }

    function removeImagesFor(fileId) {
      const all = editor.api.getSceneElementsIncludingDeleted();
      editor.api.updateScene({ elements: all.map((element) => (element.type === "image" && element.fileId === fileId ? { ...element, isDeleted: true, version: element.version + 1 } : element)) });
    }

    function setSaveStatus(status, detail) {
      const chip = $("[data-wb-save]");
      if (!chip) return;
      chip.dataset.status = status;
      chip.textContent = { saved: "Saved", dirty: "Edited", saving: "Saving…", offline: "Offline · will retry", failed: "Not saved", conflict: "Changed elsewhere" }[status] || "";
      chip.title = status === "failed" && typeof detail === "string" ? detail : "";
      if (status === "conflict") showBanner("conflict");
    }

    function showBanner(kind) {
      const banner = $("[data-wb-banner]");
      if (kind === "conflict") {
        banner.dataset.kind = "conflict";
        banner.innerHTML = `<span>This board was changed on another tab or device. Your edits here are kept on this device and haven't been saved.</span>
          <button type="button" data-wb-copy-mine>Save mine as a new board</button><button type="button" data-wb-load-saved>Load the saved version</button>`;
      } else {
        if (banner.dataset.kind === "conflict" && !banner.hidden) return; // the live conflict comes first
        if (!recovery.length) { banner.hidden = true; return; }
        banner.dataset.kind = "draft";
        banner.innerHTML = `<span>You have unsaved changes from an earlier visit, but the board has changed since.${recovery.length > 1 ? ` (${recovery.length} copies)` : ""}</span>
          <button type="button" data-wb-copy-draft>Save them as a new board</button><button type="button" data-wb-discard-draft>Discard them</button>`;
      }
      banner.hidden = false;
    }

    function hideBanner() {
      const banner = $("[data-wb-banner]");
      banner.hidden = true;
      banner.dataset.kind = "";
      if (recovery.length) showBanner("conflict-draft");
    }

    /** Copies a scene, with its images, into a new board in the same course. */
    async function saveAsNewBoard(scene, extraFiles = {}) {
      const session = getSession();
      const clean = cleanScene(scene);
      const files = { ...extraFiles, ...editor.files() };
      const made = await api.createWhiteboard(session, courseId, { title: cleanTitle(`${title} (my copy)`, "My copy") });
      const board = made.board;
      try {
        const missing = new Set();
        for (const id of new Set(clean.elements.filter((element) => element.type === "image").map((element) => element.fileId))) {
          const file = files[id];
          if (!file?.dataURL) { missing.add(id); continue; }
          try {
            await api.uploadWhiteboardFile(session, board.id, id, blobFromDataUrl(file.dataURL));
          } catch {
            missing.add(id);
          }
        }
        // An image that couldn't be copied goes, and so do arrows' and labels' references to it.
        const elements = missing.size
          ? cleanScene({ ...clean, elements: clean.elements.map((element) => (element.type === "image" && missing.has(element.fileId) ? { ...element, isDeleted: true } : element)) }).elements
          : clean.elements;
        await api.saveWhiteboard(session, board.id, { expectedRevision: 0, scene: { ...clean, elements } });
        onCreated?.(board);
        showToast(missing.size ? "Saved as a new board, without images that couldn't be copied." : "Saved as a new board.");
        return board;
      } catch (error) {
        await api.deleteWhiteboard?.(session, board.id).catch(() => {});
        throw error;
      }
    }

    // ---------- Overlay geometry ----------

    function schedulePosition() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; position(); });
    }

    function clientRect(rect) {
      const a = editor.toClient(rect.x, rect.y);
      const b = editor.toClient(rect.x + rect.width, rect.y + rect.height);
      const stage = $(".wb-stage").getBoundingClientRect();
      return { left: a.x - stage.left, top: a.y - stage.top, width: b.x - a.x, height: b.y - a.y, stage };
    }

    /** Where a thread's anchor is now: its surviving elements, or the frozen area. */
    function threadRect(thread) {
      if (thread.captureMode === "selection" && thread.elementIds?.length && editor) {
        const ids = new Set(thread.elementIds);
        const live = editor.api.getSceneElements().filter((element) => ids.has(element.id));
        if (live.length) {
          const box = boundsOf(live);
          if (box) return box;
        }
      }
      return thread.rect;
    }

    function boundsOf(elements) {
      return elements.length ? editor.bounds(elements) : null;
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function position() {
      if (!editor || destroyed) return;
      const stage = $(".wb-stage").getBoundingClientRect();
      // Outline + mascot for each shown thread.
      for (const thread of threads.values()) {
        const rect = threadRect(thread);
        if (!rect) continue;
        const box = clientRect(rect);
        const showOutline = thread.status === "working" || openThread === thread.id;
        if (thread.outline) {
          thread.outline.hidden = !showOutline;
          Object.assign(thread.outline.style, { left: `${box.left - 6}px`, top: `${box.top - 6}px`, width: `${box.width + 12}px`, height: `${box.height + 12}px` });
        }
        if (thread.mascot) {
          const visible = box.left + box.width > -40 && box.left < stage.width + 40 && box.top > -60 && box.top < stage.height + 40;
          thread.mascot.hidden = !visible;
          thread.mascot.style.left = `${clamp(box.left + box.width - 8, 4, stage.width - 44)}px`;
          thread.mascot.style.top = `${clamp(box.top - 40, 4, stage.height - 44)}px`;
        }
      }
      positionComposer();
      positionCard();
    }

    // ---------- Asking: the composer under a selection or framed area ----------

    function currentSelection() {
      const elements = editor.selectedElements();
      if (!elements.length) return null;
      return { captureMode: "selection", rect: boundsOf(elements), elements };
    }

    function syncComposer(settled) {
      if (!editor || areaMode) return;
      const state = editor.api.getAppState();
      if (state.editingTextElement || state.activeTool?.type !== "selection") return hideComposer();
      const selection = currentSelection();
      if (!selection) {
        if (composer?.captureMode === "selection") hideComposer();
        return;
      }
      const same = composer?.captureMode === "selection" && composer.elements.length === selection.elements.length
        && composer.elements.every((element, index) => element.id === selection.elements[index].id);
      if (same) {
        composer.rect = selection.rect;
        composer.elements = selection.elements;
        positionComposer();
        return;
      }
      if (!settled && !composer) return; // appears once the selection gesture finishes
      showComposer(selection);
    }

    function hideComposerWhileEditing() {
      const node = overlay.querySelector(".wb-composer");
      if (node) node.hidden = true;
    }

    function hideComposer() {
      composer = null;
      overlay.querySelector(".wb-composer")?.remove();
      overlay.querySelector(".wb-area-draft")?.remove();
    }

    function showComposer(capture) {
      const keep = overlay.querySelector(".wb-composer input")?.value || "";
      hideComposer();
      composer = { ...capture };
      const form = document.createElement("form");
      form.className = "wb-composer";
      form.innerHTML = `<span class="wb-composer-klui" aria-hidden="true">${boardKluiMarkup()}</span>
        <input type="text" maxlength="${LIMITS.question}" placeholder="${capture.captureMode === "area" ? "Ask Klui about this area…" : "Ask Klui about this…"}" aria-label="Ask Klui" value="${escapeHtml(keep)}">
        <button class="wb-diagram-btn" type="button" data-wb-draw title="Ask Klui to draw a diagram" aria-label="Ask Klui to draw a diagram">${icon("draw")}<span>Diagram</span></button>
        <button class="wb-send" type="submit" aria-label="Ask">${icon("send")}</button>`;
      overlay.append(form);
      if (capture.captureMode === "area") {
        const outline = document.createElement("div");
        outline.className = "wb-outline wb-area-draft";
        overlay.append(outline);
      }
      positionComposer();
    }

    function positionComposer() {
      const form = overlay.querySelector(".wb-composer");
      if (!form || !composer || !editor) return;
      const box = clientRect(composer.rect);
      const width = Math.min(420, box.stage.width - 16);
      form.hidden = false;
      form.style.width = `${width}px`;
      form.style.left = `${clamp(box.left + box.width / 2 - width / 2, 8, box.stage.width - width - 8)}px`;
      const below = box.top + box.height + 14;
      form.style.top = `${below + 56 < box.stage.height ? Math.max(8, below) : clamp(box.top - 62, 8, box.stage.height - 60)}px`;
      const draft = overlay.querySelector(".wb-area-draft");
      if (draft) Object.assign(draft.style, { left: `${box.left - 6}px`, top: `${box.top - 6}px`, width: `${box.width + 12}px`, height: `${box.height + 12}px` });
    }

    /** Freezes what the question is about: the elements and a picture of exactly that part. */
    async function freeze(capture, allowEmpty = false) {
      let elements = capture.elements;
      if (capture.captureMode !== "selection") elements = editor.elementsIn(capture.rect);
      if (!elements.length && !allowEmpty) throw new Error(capture.captureMode === "view" ? "The board is empty here. Draw or write something first." : "There's nothing in that area yet.");
      if (elements.length > LIMITS.contextElements) throw new Error("That's a lot at once. Select a smaller part of the board.");
      const rect = capture.captureMode === "selection" ? boundsOf(elements) : capture.rect;
      const pad = capture.captureMode === "selection" ? 16 : 0;
      const frame = { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
      const blob = elements.length ? await editor.capture(elements, frame) : null;
      return {
        context: {
          captureMode: capture.captureMode,
          rect: frame,
          elements: cleanScene({ elements }).elements,
          ...boardLook(),
          sceneRevision: queue?.revision ?? revision
        },
        image: blob ? { mimeType: blob.type, data: await base64(blob) } : null
      };
    }

    /** The theme and background the student sees: Klui talks about colours as they look. */
    function boardLook() {
      const state = editor.api.getAppState();
      return { theme: state.theme === "dark" ? "dark" : "light", background: state.viewBackgroundColor || "#ffffff" };
    }

    /** Klui picks colours as they look on screen; the board stores them for its theme. */
    function boardColours(proposal) {
      return storedProposal(proposal, boardLook().theme);
    }

    /**
     * A follow-up's evidence: the thread's frozen context and picture. A thread reopened from an
     * earlier visit has neither in memory, so its stored context is fetched and redrawn.
     */
    async function threadEvidence(thread) {
      if (thread.context && (thread.image || !thread.context.elements.length)) return { context: thread.context, image: thread.image };
      const first = thread.turns[0];
      if (!thread.context && first?.id) {
        try {
          const payload = await api.fetchWhiteboardTurn(getSession(), meta.id, first.id);
          if (payload?.context?.elements?.length) thread.context = { ...payload.context, rect: payload.context.rect || thread.rect };
        } catch {
          // The server falls back to the stored description.
        }
      }
      if (thread.context?.elements?.length && thread.context.rect && !thread.image) {
        const blob = await editor.captureFrozen(thread.context.elements, thread.context.rect).catch(() => null);
        if (blob) thread.image = { mimeType: blob.type, data: await base64(blob) };
      }
      return { context: thread.context, image: thread.image };
    }

    async function ask({ question, mode = "answer", voice = false, capture = null, thread = null, fresh = null }) {
      if (activeAsk) {
        showToast("Klui is still answering. One question at a time.");
        return;
      }
      if (destroyed) return;
      let frozen;
      try {
        frozen = fresh || (thread ? await threadEvidence(thread) : await freeze(capture));
      } catch (error) {
        if (!destroyed) showToast(error.message || "Could not read that part of the board.");
        return;
      }
      if (destroyed) return;
      if (activeAsk) {
        showToast("Klui is still answering. One question at a time.");
        return;
      }
      const clientRequestId = crypto.randomUUID();
      const key = thread?.id || `pending-${clientRequestId}`;
      const target = thread || addThread({
        id: key,
        captureMode: frozen.context.captureMode,
        rect: frozen.context.rect,
        elementIds: frozen.context.elements.map((element) => element.id),
        turns: []
      });
      target.context = frozen.context;
      target.image = frozen.image;
      if (fresh) {
        // A voice turn looks at the board as it is now.
        target.captureMode = frozen.context.captureMode;
        target.rect = frozen.context.rect;
        target.elementIds = frozen.context.elements.map((element) => element.id);
      }
      target.status = "working";
      target.live = { question: question || (mode === "diagram" ? "Draw a diagram of this" : ""), text: "", proposal: null, error: "", voice, stage: "reading" };
      updateMascot(target);
      hideComposer();
      editor.clearSelection();
      const controller = new AbortController();
      activeAsk = { controller, key: target.id };
      if (openThread === target.id) renderCard();
      position();
      try {
        await api.streamWhiteboardAsk(getSession(), meta.id, {
          clientRequestId,
          parentTurnId: thread ? thread.turns.at(-1)?.id || null : null,
          question,
          mode,
          voice,
          context: frozen.context,
          image: frozen.image
        }, { signal: controller.signal, onEvent: (event) => onAskEvent(target, event) });
        if (target.status === "working") throw new Error("Klui stopped before finishing. Try again.");
      } catch (error) {
        if (controller.signal.aborted) {
          target.status = target.turns.length ? "seen" : "error";
          target.live = null;
        } else {
          target.status = "error";
          if (target.live) target.live.error = error.message || "Klui could not answer. Try again.";
        }
        updateMascot(target);
        if (openThread === target.id) renderCard();
      } finally {
        if (activeAsk?.controller === controller) activeAsk = null;
        position();
        renderHistory();
      }
    }

    function onAskEvent(thread, event) {
      if (destroyed) return;
      if (event.type === "started" && event.threadId && thread.id !== event.threadId) {
        threads.delete(thread.id);
        if (openThread === thread.id) openThread = event.threadId;
        if (activeAsk?.key === thread.id) activeAsk.key = event.threadId;
        thread.id = event.threadId;
        thread.mascot.dataset.wbThread = thread.id;
        threads.set(thread.id, thread);
      } else if (event.type === "status" && thread.live) {
        thread.live.stage = event.stage;
      } else if (event.type === "text" && thread.live) {
        thread.live.text += event.delta || "";
        if (openThread === thread.id) renderCard({ streaming: true });
      } else if (event.type === "proposal" && thread.live) {
        thread.live.proposal = event.proposal;
      } else if (event.type === "done" && event.turn) {
        thread.turns.push(event.turn);
        thread.live = null;
        thread.status = openThread === thread.id ? "seen" : "ready";
        updateMascot(thread);
        if (openThread === thread.id) renderCard();
        // A board command (spoken, or typed into a voice conversation) is carried out right away.
        if (event.turn.voice) {
          if (event.turn.proposal) {
            try {
              applyDiagram(event.turn.id);
              editor.clearSelection();
            } catch (error) {
              showToast(error.message);
            }
          }
          if (voiceMode) voiceSay(event.turn.answer);
        }
      } else if (event.type === "error") {
        thread.status = "error";
        if (thread.live) thread.live.error = event.error || "Klui could not answer. Try again.";
        updateMascot(thread);
        if (openThread === thread.id) renderCard();
      }
    }

    // ---------- Threads, mascots and the answer card ----------

    function addThread(data) {
      const thread = { status: "seen", live: null, context: null, image: null, ...data };
      const outline = document.createElement("div");
      outline.className = "wb-outline";
      outline.hidden = true;
      overlay.prepend(outline);
      const holder = document.createElement("div");
      holder.innerHTML = mascotMarkup({ id: escapeHtml(thread.id), state: thread.status, label: "Open Klui's answer" });
      const mascot = holder.firstElementChild;
      overlay.append(mascot);
      thread.outline = outline;
      thread.mascot = mascot;
      threads.set(thread.id, thread);
      trimThreads();
      return thread;
    }

    function trimThreads() {
      const list = [...threads.values()];
      if (list.length <= SHOWN_THREADS) return;
      for (const thread of list.slice(0, list.length - SHOWN_THREADS)) {
        if (thread.status === "working" || openThread === thread.id) continue;
        thread.mascot.hidden = true;
        thread.mascot.dataset.trimmed = "";
      }
    }

    function addTurn(turn, { fresh }) {
      const existing = threads.get(turn.threadId);
      if (existing) {
        existing.turns.push(turn);
        return existing;
      }
      return addThread({
        id: turn.threadId,
        captureMode: turn.context?.captureMode || "area",
        rect: turn.context?.rect,
        elementIds: turn.context?.elementIds || [],
        turns: [turn],
        status: fresh ? "ready" : "seen"
      });
    }

    function updateMascot(thread) {
      if (!thread.mascot) return;
      thread.mascot.dataset.state = thread.status;
      const bubble = thread.mascot.querySelector(".wb-klui-bubble");
      bubble.textContent = thread.status === "error" ? "!" : thread.status === "ready" ? "Answer ready" : "…";
      thread.mascot.setAttribute("aria-label", thread.status === "working" ? "Klui is answering" : thread.status === "ready" ? "Klui's answer is ready. Open it" : "Open Klui's answer");
    }

    function openCard(threadId) {
      const thread = threads.get(threadId);
      if (!thread) return;
      openThread = threadId;
      if (thread.status === "ready") {
        thread.status = "seen";
        updateMascot(thread);
      }
      renderCard();
      position();
    }

    function closeCard() {
      openThread = "";
      overlay.querySelector(".wb-card")?.remove();
      position();
    }

    function turnMarkup(turn) {
      const cites = (turn.citations || []).map((cite) => `<li>[${cite.index}] ${escapeHtml(cite.title)}${cite.page ? `, p. ${cite.page}` : ""}</li>`).join("");
      return `<div class="wb-turn" data-wb-turn="${escapeHtml(turn.id)}">
        ${turn.question ? `<p class="wb-q">${escapeHtml(turn.question)}</p>` : ""}
        <div class="wb-a">${renderContent(turn.answer || "", { artifacts: false })}</div>
        ${turn.proposal?.ops?.length && !turn.proposal.frame ? `<div class="wb-diagram" data-wb-diagram="${escapeHtml(turn.id)}"><div class="wb-diagram-preview" aria-label="Diagram preview"></div></div>` : ""}
        ${cites ? `<ul class="wb-cites" aria-label="Course sources">${cites}</ul>` : ""}
        <div class="wb-turn-actions">
          ${turn.proposal && !turn.applied ? `<button type="button" class="wb-apply" data-wb-apply="${escapeHtml(turn.id)}">${icon("pin")}${turn.proposal.edits ? "Apply board changes" : "Add diagram to board"}</button>` : ""}
          <button type="button" data-wb-copy="${escapeHtml(turn.id)}" title="Copy">${icon("copy")}<span>Copy</span></button>
          ${turn.mode === "answer" && !turn.proposal?.frame ? `<button type="button" data-wb-note="${escapeHtml(turn.id)}" title="Write this answer on the board">${icon("pin")}<span>Put on board</span></button>` : ""}
        </div>
      </div>`;
    }

    function renderCard({ streaming = false } = {}) {
      const thread = threads.get(openThread);
      if (!thread) return closeCard();
      let card = overlay.querySelector(".wb-card");
      if (streaming && card) {
        const live = card.querySelector(".wb-live .wb-a");
        if (live) {
          live.innerHTML = renderContent(thread.live?.text || "", { artifacts: false, holdVisualize: true });
          return;
        }
      }
      if (!card) {
        card = document.createElement("section");
        card.className = "wb-card";
        card.setAttribute("aria-label", "Klui's answer");
        overlay.append(card);
      }
      const live = thread.live
        ? `<div class="wb-turn wb-live">${thread.live.question ? `<p class="wb-q">${escapeHtml(thread.live.question)}</p>` : ""}
            ${thread.live.error ? `<p class="wb-error" role="alert">${escapeHtml(thread.live.error)}</p>`
              : `<div class="wb-a">${thread.live.text ? renderContent(thread.live.text, { artifacts: false, holdVisualize: true }) : `<p class="wb-thinking">${thread.live.stage === "drawing" ? "Sketching a diagram" : thread.live.stage === "thinking" ? "Thinking" : "Reading the board"}<span class="wb-dots" aria-hidden="true"></span></p>`}</div>`}</div>`
        : "";
      card.innerHTML = `<div class="wb-card-controls">
          ${playback ? `<button class="wb-icon-btn" type="button" data-wb-stop-speech aria-label="Stop speaking" title="Stop speaking">${icon("stop")}</button>` : ""}
          <button class="wb-icon-btn" type="button" data-wb-card-close aria-label="Close">${icon("close")}</button></div>
        <div class="wb-card-body">${thread.turns.map(turnMarkup).join("")}${live}</div>
        <form class="wb-followup"${thread.status === "working" ? " hidden" : ""}><input type="text" maxlength="${LIMITS.question}" placeholder="Ask a follow-up…" aria-label="Ask a follow-up">
          <button class="wb-send" type="submit" aria-label="Send">${icon("send")}</button></form>`;
      const body = card.querySelector(".wb-card-body");
      body.scrollTop = body.scrollHeight;
      // A board command shows its result on the board itself, so only diagrams get a preview.
      for (const turn of thread.turns) if (turn.proposal?.ops?.length && !turn.proposal.frame) void showPreview(card, turn);
      positionCard();
    }

    async function showPreview(card, turn) {
      const slot = card.querySelector(`[data-wb-diagram="${CSS.escape(turn.id)}"] .wb-diagram-preview`);
      if (!slot || slot.childElementCount) return;
      try {
        const svg = await editor.preview(proposalToSkeletons(boardColours(turn.proposal)));
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        slot.replaceChildren(svg);
      } catch {
        slot.textContent = "Preview unavailable.";
      }
    }

    function positionCard() {
      const card = overlay.querySelector(".wb-card");
      const thread = threads.get(openThread);
      if (!card || !thread || !editor) return;
      const stage = $(".wb-stage").getBoundingClientRect();
      if (stage.width < 640) {
        card.classList.add("is-sheet");
        card.style.left = card.style.top = "";
        return;
      }
      card.classList.remove("is-sheet");
      const box = clientRect(threadRect(thread));
      const width = card.offsetWidth || 380;
      const height = card.offsetHeight || 300;
      const right = box.left + box.width + 24;
      const left = right + width < stage.width - 8 ? right : box.left - width - 24;
      card.style.left = `${clamp(left, 8, stage.width - width - 8)}px`;
      card.style.top = `${clamp(box.top, 8, stage.height - height - 8)}px`;
    }

    function findTurn(id) {
      for (const thread of threads.values()) {
        const turn = thread.turns.find((item) => item.id === id);
        if (turn) return { thread, turn };
      }
      return null;
    }

    function applyDiagram(turnId) {
      const found = findTurn(turnId);
      if (!found?.turn.proposal) return;
      const voiceTurn = Boolean(found.turn.proposal.edits);
      const rect = voiceTurn ? voicePlace(found.thread) : threadRect(found.thread) || editor.visibleRect();
      const proposal = boardColours(voiceTurn ? validateVoiceProposal(found.turn.proposal, found.thread.context?.elements || []) : found.turn.proposal);
      if (!voiceTargetsUnchanged(proposal, found.thread.context?.elements || [], editor.api.getSceneElements())) {
        throw new Error("Something Klui was changing was edited while it was thinking. Ask again.");
      }
      if (proposal.frame) {
        // Commands are drawn where Klui saw them: its coordinates are the view it was given.
        const edits = proposal.edits.map(({ size, ...edit }) => (size ? { ...edit, fontSize: TEXT_SIZES[size] } : edit));
        editor.command({ skeletons: proposalToSkeletons(proposal), origin: proposal.frame, edits, transforms: proposal.transforms || [] });
      } else if (proposal.ops.length || proposal.edits?.length) {
        editor.insert(proposalToSkeletons(proposal), { x: rect.x + rect.width + 80, y: rect.y }, proposal.edits || [], voiceMode && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      }
      if (proposal.navigation) editor.navigate(proposal.navigation);
      found.turn.applied = true;
      if (openThread === found.thread.id) renderCard();
      showToast("Board updated. Undo reverses it in one step.");
    }

    /**
     * Where a spoken drawing goes: beside what Klui was looking at (so each new drawing lands next
     * to the last), or near the top left of the view on an empty screen. The view then glides to it.
     */
    function voicePlace(thread) {
      const ids = new Set(thread.elementIds || []);
      const live = editor.api.getSceneElements().filter((element) => ids.has(element.id));
      const box = live.length ? editor.bounds(live) : null;
      if (box) return box;
      const view = editor.visibleRect();
      return { x: view.x + view.width * 0.12 - 80, y: view.y + view.height * 0.15, width: 0, height: 0 };
    }

    function putOnBoard(turnId) {
      const found = findTurn(turnId);
      if (!found) return;
      const rect = threadRect(found.thread) || editor.visibleRect();
      const x = rect.x + rect.width + 110;
      const y = rect.y;
      editor.insert([
        { type: "text", x, y, text: noteLines(found.turn.answer), fontSize: 20, fontFamily: 5, strokeColor: KLUI_INK },
        { type: "arrow", x: rect.x + rect.width + 12, y: y + 16, width: 86, height: 0, strokeColor: KLUI_INK, roughness: 1, strokeWidth: 2 }
      ]);
      showToast("Added to the board.");
    }

    // ---------- Voice: speak answers, ask out loud ----------

    function voiceSay(text) {
      setTalkButton("speaking");
      voiceReply = (async () => {
        await voiceAcknowledgement;
        if (voiceMode && !destroyed) await speak(text);
      })();
    }

    function stopSpeech() {
      if (!playback) return;
      playback.controller.abort();
      playback.audio?.pause();
      if (playback.url) URL.revokeObjectURL(playback.url);
      playback = null;
      if (openThread) renderCard();
    }

    async function speak(text) {
      stopSpeech();
      const chunks = splitForSpeech(spokenText(text));
      if (!chunks.length) return;
      const controller = new AbortController();
      const run = { controller, audio: null, url: "" };
      playback = run;
      if (openThread) renderCard();
      speechReply += 1;
      const reply = speechReply;
      const prefs = voicePrefs?.() || {};
      const fetchClip = (chunk) => api.synthesizeVoice(getSession(), { text: chunk, voice: prefs.voice, speed: prefs.speed }, { signal: controller.signal, session: speechSession, reply });
      try {
        let next = fetchClip(chunks[0]);
        for (let index = 0; index < chunks.length; index += 1) {
          const clip = await next;
          if (playback !== run) return;
          next = index + 1 < chunks.length ? fetchClip(chunks[index + 1]) : null;
          next?.catch(() => {});
          run.url = URL.createObjectURL(new Blob([clip.audio], { type: "audio/mpeg" }));
          run.audio = new Audio(run.url);
          await new Promise((resolve, reject) => {
            run.audio.onended = resolve;
            run.audio.onerror = () => reject(new Error("Playback failed."));
            controller.signal.addEventListener("abort", resolve, { once: true });
            run.audio.play().catch(reject);
          });
          URL.revokeObjectURL(run.url);
          run.url = "";
          if (playback !== run) return;
        }
      } catch (error) {
        if (!controller.signal.aborted) showToast(error?.message ? `Couldn't speak the answer: ${error.message}` : "Couldn't speak the answer.");
      } finally {
        if (playback === run) {
          playback = null;
          if (openThread) renderCard();
        }
      }
    }

    function setTalkButton(state) {
      const button = $("[data-wb-talk]");
      if (!button) return;
      button.dataset.state = state;
      button.title = voiceMode ? "Exit voice mode (Esc)" : "Ask questions and control the board by voice";
      button.setAttribute("aria-pressed", String(voiceMode));
      button.innerHTML = `${icon(voiceMode ? "stop" : "mic")}<span>${voiceMode ? "Exit voice" : "Voice mode"}</span>`;
      const status = $("[data-wb-voice-status]");
      status.hidden = !voiceMode;
      const labels = { recording: "Listening… pause to send", busy: "I’m on it…", speaking: "Klui is speaking…", idle: "Listening for your next request…" };
      status.textContent = labels[state] || labels.idle;
    }

    function stopVoiceMode() {
      voiceMode = false;
      voiceThread = null;
      voiceAckController?.abort();
      root.classList.remove("wb-voice-on");
      $("[data-wb-voice-tip]").hidden = true;
      cancelVoice();
      activeAsk?.controller.abort();
      stopSpeech();
      setTalkButton("idle");
    }

    async function toggleVoiceMode() {
      if (voiceMode) return stopVoiceMode();
      if (activeAsk) return showToast("Wait for Klui's answer first.");
      voiceMode = true;
      void api.warmVoiceMode?.(getSession()).catch(() => {});
      root.classList.add("wb-voice-on");
      $("[data-wb-voice-tip]").hidden = false;
      if (!voiceAckClip) {
        voiceAckController = new AbortController();
        const prefs = voicePrefs?.() || {};
        // Synthesize once and reuse across turns; acknowledgement never waits on the model.
        voiceAckClip = api.synthesizeVoice(getSession(), { text: "I'm on it.", voice: prefs.voice, speed: prefs.speed }, { signal: voiceAckController.signal })
          .catch(() => { voiceAckClip = null; return null; });
      }
      await startVoice();
    }

    async function acknowledgeVoice() {
      const clip = await voiceAckClip;
      if (!clip || !voiceMode || destroyed) return;
      stopSpeech();
      const run = { controller: new AbortController(), audio: null, url: URL.createObjectURL(new Blob([clip.audio], { type: "audio/mpeg" })) };
      playback = run;
      run.audio = new Audio(run.url);
      try {
        await new Promise(resolve => {
          run.audio.onended = resolve;
          run.audio.onerror = resolve;
          run.controller.signal.addEventListener("abort", resolve, { once: true });
          run.audio.play().catch(resolve);
        });
      } finally {
        URL.revokeObjectURL(run.url);
        if (playback === run) playback = null;
      }
    }

    async function startVoice() {
      if (!voiceMode || destroyed || voiceJob || activeAsk) return;
      stopSpeech();
      const job = { phase: "listening", chunks: [], stream: null, recorder: null, timer: 0, cancelled: false, controller: new AbortController() };
      voiceJob = job;
      setTalkButton("idle");
      try {
        job.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (job.cancelled) return endVoice(job);
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        job.audioContext = new AudioContext();
        await job.audioContext.resume();
        if (job.cancelled) return endVoice(job);
        const analyser = job.audioContext.createAnalyser();
        analyser.fftSize = 1024;
        job.audioContext.createMediaStreamSource(job.stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const activity = createVoiceActivity();
        const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(value => MediaRecorder.isTypeSupported?.(value)) || "";
        job.recorder = new MediaRecorder(job.stream, type ? { mimeType: type } : undefined);
        job.recorder.ondataavailable = event => { if (event.data?.size) job.chunks.push(event.data); };

        job.activityTimer = setInterval(() => {
          if (job.cancelled || voiceJob !== job) return;
          analyser.getFloatTimeDomainData(samples);
          const level = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
          const state = activity(level, performance.now());
          if (state === "speech" && job.phase === "listening") {
            clearTimeout(job.timer);
            $("[data-wb-voice-tip]").hidden = true;
            job.recorder.start();
            job.phase = "recording";
            job.timer = setTimeout(() => void finishVoice(), VOICE_LIMIT_MS);
            setTalkButton("recording");
          } else if (state === "finished") void finishVoice();
          else if (state === "noise") {
            endVoice(job);
            void startVoice();
          }
        }, 50);
      } catch (error) {
        if (!job.cancelled) showToast("Couldn't start voice mode. Check microphone permission and try again.");
        if (voiceJob === job) stopVoiceMode();
        endVoice(job);
      }
    }

    /** Releases the microphone and, if this job is still the current one, clears it. */
    function endVoice(job) {
      clearTimeout(job.timer);
      clearInterval(job.activityTimer);
      void job.audioContext?.close().catch(() => {});
      if (job.recorder && job.recorder.state !== "inactive") {
        try { job.recorder.stop(); } catch { /* already stopped */ }
      }
      job.stream?.getTracks().forEach((track) => track.stop());
      if (voiceJob === job) {
        voiceJob = null;
        if (!destroyed) setTalkButton("idle");
      }
    }

    function cancelVoice() {
      const job = voiceJob;
      if (!job) return;
      job.cancelled = true;
      job.controller.abort();
      endVoice(job);
    }

    async function finishVoice() {
      const job = voiceJob;
      if (!job || job.phase !== "recording") return;
      job.phase = "sending";
      clearTimeout(job.timer);
      clearInterval(job.activityTimer);
      setTalkButton("busy");
      try {
        await new Promise((resolve) => {
          if (!job.recorder || job.recorder.state === "inactive") return resolve();
          job.recorder.onstop = resolve;
          job.recorder.stop();
        });
        job.stream?.getTracks().forEach((track) => track.stop());
        if (job.cancelled || destroyed || !job.chunks.length) return;
        voiceAcknowledgement = acknowledgeVoice();
        const audio = new Blob(job.chunks, { type: job.chunks[0].type || "audio/webm" });
        const heard = await api.transcribeVoiceTurn(getSession(), audio, { signal: job.controller.signal });
        if (job.cancelled || destroyed) return;
        const question = String(heard?.text || "").trim();
        if (!question) {
          showToast("Klui didn't catch that. Try again.");
          return;
        }
        const frozen = await freezeView();
        if (job.cancelled || !voiceMode || destroyed) return;
        endVoice(job);
        voiceReply = Promise.resolve();
        setTalkButton("busy");
        if (voiceThread && threads.has(voiceThread.id)) {
          openThread = voiceThread.id;
          await ask({ question, voice: true, thread: voiceThread, fresh: frozen });
        } else {
          voiceThread = await askFrozen({ question, voice: true, frozen });
        }
        // A failed answer doesn't end voice mode: say so and keep listening.
        if (voiceThread?.status === "error" && voiceMode && !destroyed) {
          voiceThread.status = voiceThread.turns.length ? "seen" : "error";
          updateMascot(voiceThread);
          voiceSay("Sorry, I couldn't do that one. Try asking again.");
        }
        await voiceReply;
      } catch (error) {
        if (!job.cancelled && !destroyed) showToast(error?.message || "Klui couldn't hear that. Try again.");
      } finally {
        endVoice(job);
        await voiceAcknowledgement;
        if (voiceMode && !destroyed && !job.cancelled) void startVoice();
      }
    }

    /** What a board command sees: the whole view, with whatever is selected marked as "this". */
    async function freezeView() {
      const selected = editor.selectedElements().map((element) => element.id);
      const frozen = await freeze({ captureMode: "view", rect: editor.visibleRect(), elements: [] }, true);
      const inView = new Set(frozen.context.elements.map((element) => element.id));
      const selectedIds = selected.filter((id) => inView.has(id));
      if (selectedIds.length) frozen.context.selectedIds = selectedIds;
      return frozen;
    }

    // Each voice turn sees the current view, including the previous command.
    async function askFrozen({ question, voice, frozen }) {
      if (destroyed || activeAsk) return;
      const thread = addThread({
        id: `pending-${crypto.randomUUID()}`,
        captureMode: frozen.context.captureMode,
        rect: frozen.context.rect,
        elementIds: frozen.context.elements.map((element) => element.id),
        turns: [],
        context: frozen.context,
        image: frozen.image
      });
      openThread = thread.id; // captions: a spoken question shows its answer as it streams
      await ask({ question, voice, thread });
      return thread;
    }

    // ---------- Area mode and history ----------

    function setAreaMode(on) {
      areaMode = on;
      $("[data-wb-area]").setAttribute("aria-pressed", String(on));
      $("[data-wb-area-layer]").hidden = !on;
      if (on) {
        hideComposer();
        editor.clearSelection();
        showToast("Drag over any part of the board to frame it.");
      }
    }

    function renderHistory() {
      const panel = $("[data-wb-history-panel]");
      if (panel.hidden) return;
      const list = [...threads.values()].filter((thread) => thread.turns.length).reverse();
      panel.innerHTML = `<button class="wb-icon-btn wb-history-close" type="button" data-wb-history-close aria-label="Close answers">${icon("close")}</button>
        ${list.length ? `<ol>${list.map((thread) => `<li><button type="button" data-wb-history-open="${escapeHtml(thread.id)}"><strong>${escapeHtml(thread.turns[0].question || "Diagram")}</strong><small>${escapeHtml(spokenText(thread.turns.at(-1).answer).slice(0, 110))}</small></button></li>`).join("")}</ol>` : "<p>Select part of the board and ask Klui. Answers collect here.</p>"}
        ${moreTurns ? '<button type="button" class="wb-more" data-wb-history-more>Show older answers</button>' : ""}`;
    }

    async function loadOlderTurns() {
      const oldest = [...threads.values()].flatMap((thread) => thread.turns).map((turn) => turn.createdAt).filter(Boolean).sort()[0];
      try {
        const payload = await api.fetchWhiteboardTurns(getSession(), meta.id, { before: oldest || "" });
        for (const turn of [...(payload.turns || [])].reverse()) {
          const existing = threads.get(turn.threadId);
          if (existing) {
            if (!existing.turns.some((item) => item.id === turn.id)) existing.turns.unshift(turn);
          } else {
            addTurn(turn, { fresh: false });
          }
        }
        moreTurns = payload.more === true;
        renderHistory();
        position();
      } catch (error) {
        showToast(error.message || "Couldn't load older answers.");
      }
    }

    // ---------- Events ----------

    function bind() {
      root.addEventListener("click", onClick);
      root.addEventListener("submit", onSubmit);
      root.addEventListener("keydown", onKeyDown, true);
      $(".wb-title").addEventListener("change", onTitleChange);
      const layer = $("[data-wb-area-layer]");
      layer.addEventListener("pointerdown", onAreaDown);
      layer.addEventListener("pointermove", onAreaMove);
      layer.addEventListener("pointerup", onAreaUp);
      layer.addEventListener("pointercancel", () => { areaDrag = null; hideComposer(); });
      window.addEventListener("resize", schedulePosition);
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", onVisibility);
    }

    function onVisibility(event) {
      if (document.visibilityState === "hidden" || event?.type === "pagehide") { if (voiceMode) stopVoiceMode(); void queue?.flush(); }
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        if (voiceMode) { event.preventDefault(); event.stopPropagation(); return stopVoiceMode(); }
        if (areaMode) { event.preventDefault(); return setAreaMode(false); }
        if (!editor?.api.getAppState().editingTextElement && (composer || editor?.selectedElements().length)) {
          event.preventDefault();
          event.stopPropagation();
          editor.clearSelection();
          hideComposer();
          return;
        }
        if (openThread && event.target.closest?.(".wb-card")) { event.preventDefault(); return closeCard(); }
      }
    }

    async function onTitleChange(event) {
      const next = cleanTitle(event.target.value, title);
      event.target.value = next;
      if (next === title) return;
      try {
        const saved = await api.saveWhiteboard(getSession(), meta.id, { title: next });
        title = saved.title || next;
        onRenamed?.(meta.id, title);
      } catch (error) {
        event.target.value = title;
        showToast(error.message || "Couldn't rename the board.");
      }
    }

    function onAreaDown(event) {
      const point = editor.toScene(event.clientX, event.clientY);
      areaDrag = { x: point.x, y: point.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    function onAreaMove(event) {
      if (!areaDrag) return;
      const point = editor.toScene(event.clientX, event.clientY);
      const rect = { x: Math.min(areaDrag.x, point.x), y: Math.min(areaDrag.y, point.y), width: Math.abs(point.x - areaDrag.x), height: Math.abs(point.y - areaDrag.y) };
      if (!composer || composer.captureMode !== "area") showComposer({ captureMode: "area", rect, elements: [] });
      composer.rect = rect;
      positionComposer();
    }

    function onAreaUp() {
      if (!areaDrag) return;
      areaDrag = null;
      setAreaMode(false);
      if (!composer || composer.rect.width < 8 || composer.rect.height < 8) return hideComposer();
      overlay.querySelector(".wb-composer input")?.focus();
    }

    function onSubmit(event) {
      event.preventDefault();
      const form = event.target;
      const input = form.querySelector("input");
      const question = input.value.trim();
      if (form.classList.contains("wb-composer")) {
        if (!question || !composer) return;
        void ask({ question, capture: composer });
        return;
      }
      if (form.classList.contains("wb-followup")) {
        const thread = threads.get(openThread);
        if (!question || !thread) return;
        input.value = "";
        // In a voice conversation a typed message is a board command too, on the board as it is now.
        if (thread.turns.some((turn) => turn.voice)) {
          void freezeView().then((fresh) => ask({ question, voice: true, thread, fresh }), (error) => showToast(error.message || "Could not read the board."));
        } else {
          void ask({ question, thread });
        }
      }
    }

    async function copyAnswer(turnId) {
      const found = findTurn(turnId);
      if (!found) return;
      try {
        await navigator.clipboard.writeText(found.turn.answer);
        showToast("Copied.");
      } catch {
        showToast("Couldn't copy.");
      }
    }

    function onClick(event) {
      const target = event.target;
      if (target.closest("[data-wb-close]")) return void close();
      if (target.closest("[data-wb-area]")) return setAreaMode(!areaMode);
      if (target.closest("[data-wb-voice-dismiss]")) { $("[data-wb-voice-tip]").hidden = true; return; }
      if (target.closest("[data-wb-talk]")) return void toggleVoiceMode();
      if (target.closest("[data-wb-history]")) {
        const panel = $("[data-wb-history-panel]");
        panel.hidden = !panel.hidden;
        $("[data-wb-history]").setAttribute("aria-expanded", String(!panel.hidden));
        return renderHistory();
      }
      if (target.closest("[data-wb-history-close]")) {
        $("[data-wb-history-panel]").hidden = true;
        return $("[data-wb-history]").setAttribute("aria-expanded", "false");
      }
      if (target.closest("[data-wb-history-more]")) return void loadOlderTurns();
      const fromHistory = target.closest("[data-wb-history-open]");
      if (fromHistory) {
        const thread = threads.get(fromHistory.dataset.wbHistoryOpen);
        const rect = thread && threadRect(thread);
        if (rect) editor.scrollToRect(rect);
        return openCard(fromHistory.dataset.wbHistoryOpen);
      }
      const mascot = target.closest("[data-wb-thread]");
      if (mascot) return openThread === mascot.dataset.wbThread ? closeCard() : openCard(mascot.dataset.wbThread);
      if (target.closest("[data-wb-card-close]")) return closeCard();
      if (target.closest("[data-wb-stop-speech]")) return stopSpeech();
      if (target.closest("[data-wb-draw]")) {
        if (!composer) return;
        const question = overlay.querySelector(".wb-composer input")?.value.trim() || "";
        return void ask({ question, mode: "diagram", capture: composer });
      }
      const copy = target.closest("[data-wb-copy]");
      if (copy) return void copyAnswer(copy.dataset.wbCopy);
      const note = target.closest("[data-wb-note]");
      if (note) return putOnBoard(note.dataset.wbNote);
      const apply = target.closest("[data-wb-apply]");
      if (apply) { try { applyDiagram(apply.dataset.wbApply); } catch (error) { showToast(error.message); } return; }
      if (target.closest("[data-wb-load-saved]")) return void loadSavedVersion();
      if (target.closest("[data-wb-copy-mine]")) return void copyMine();
      if (target.closest("[data-wb-copy-draft]")) return void copyDraft();
      if (target.closest("[data-wb-discard-draft]")) return void discardDraft();
    }

    async function loadSavedVersion() {
      try {
        const payload = await api.fetchWhiteboard(getSession(), meta.id);
        const files = await loadFiles((payload.files || []).filter((file) => !uploaded.has(file.fileId)));
        for (const file of payload.files || []) uploaded.add(file.fileId);
        editor.addFiles(files);
        editor.load(payload.board.scene);
        queuedKey = currentKey();
        queue.reset(payload.board.revision);
        await store.delete(draftKey);
        hideBanner();
      } catch (error) {
        showToast(error.message || "Couldn't load the saved board.");
      }
    }

    async function copyMine() {
      try {
        await saveAsNewBoard(editor.scene(), pendingFiles());
        await loadSavedVersion();
      } catch (error) {
        showToast(error.message || "Couldn't save a copy.");
      }
    }

    async function copyDraft() {
      const draft = recovery[0];
      if (!draft) return hideBanner();
      try {
        await saveAsNewBoard(draft.value.scene, draft.value.files || {});
        await discardDraft();
      } catch (error) {
        showToast(error.message || "Couldn't save a copy.");
      }
    }

    async function discardDraft() {
      const draft = recovery.shift();
      if (draft) await store.delete(draft.key);
      hideBanner();
    }

    async function destroy() {
      destroyed = true;
      stopVoiceMode();
      stopSpeech();
      cancelVoice();
      activeAsk?.controller.abort();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedulePosition);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onVisibility);
      if (queue) {
        // Let images finish uploading (each one's result updates the scene), take the last edit,
        // then save until nothing is pending. Anything that can't be saved stays in the draft.
        await Promise.allSettled([...uploading.values()]);
        await recordEdit();
        queue.release();
        await queue.drain().catch(() => {});
        queue.stop();
      }
      releaseLock();
      editor?.destroy();
      root.remove();
      document.documentElement.classList.remove("wb-open");
    }

    return {
      start,
      destroy,
      summary: () => ({ id: meta.id, title })
    };
  }

  return {
    open,
    close,
    get isOpen() { return Boolean(board); }
  };
}
