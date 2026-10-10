// The tutor call's whiteboard. The lesson's planned board is laid out up front (lesson.js) but
// hidden; the call hands this board each cue from the tutor's reply at the moment the matching
// words are spoken, and it reveals, points, circles or writes. The student can draw anywhere:
// whatever they drew since their last turn goes to the tutor as a picture, and what they select
// on the tutor's drawing goes as names. The board is a normal course whiteboard, saved as it
// changes, so it stays with the student after the call.
import { loadEditor } from "./studyWhiteboard.js";
import { cleanScene } from "./whiteboard/schema.js";
import { COLUMN, layoutBlock, layoutLesson, markSkeleton } from "./whiteboard/lesson.js";

const SAVE_DELAY_MS = 1500;
// After the student moves around the board themselves, the tutor stops steering the view for a while.
const HANDS_OFF_MS = 7000;
const EXTRA_GAP = 64;
const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * `api`: { open() → { board }, save(boardId, body) → { revision } }. `onSend` asks the call to
 * show the tutor the student's drawing; `onActivity` tells it the student is busy on the board.
 */
export function createTutorBoard({ session, api, onToast, onSend, onActivity }) {
  const steps = layoutLesson(session.plan?.board, session.plan?.steps || []);
  const root = document.createElement("div");
  root.className = "tutor-board";
  root.innerHTML = `
    <div class="tutor-board-canvas" data-board-canvas><div class="wb-loading" role="status"><span class="study-spin" aria-hidden="true"></span>Opening the board…</div></div>
    <div class="tutor-board-tip" data-board-tip hidden role="status"></div>
    <button class="tutor-board-send" type="button" data-board-send hidden>${SEND_ICON}<span>Check my drawing</span></button>`;
  const host = root.querySelector("[data-board-canvas]");
  const tip = root.querySelector("[data-board-tip]");
  const sendButton = root.querySelector("[data-board-send]");

  let editor = null;
  let boardId = null;
  let revision = 0;
  let destroyed = false;
  let current = 1;
  let lastTouch = 0;
  let extras = 0;
  // Ids for improvised parts carry a per-call tag, so a reopened board never reuses saved ones.
  const tag = Math.random().toString(36).slice(2, 6);
  let saveTimer = 0;
  let saving = null;
  let savedKey = "";
  let saveWarned = false;
  let sentVersions = new Map(); // the student's elements as the tutor last saw them
  let pendingSeen = null; // …and as sent with a turn still on its way
  let serverIds = new Set(); // element ids in the board as last read from or saved to the server
  let heldImages = []; // images on the board (added elsewhere), carried through every save
  function sync(scene) {
    heldImages = (scene?.elements || []).filter((element) => element.type === "image" && !element.isDeleted);
  }
  const shownPieces = new Set();
  const shownParts = new Set();
  const entries = new Map(); // name → { laid, step }

  function register(laid, n) {
    for (const piece of laid.pieces) if (!entries.has(piece.part)) entries.set(piece.part, { laid, step: n });
    entries.set(laid.key, { laid, step: n });
  }
  for (const step of steps) {
    register(step.heading, step.n);
    register(step.space, step.n);
    for (const block of step.blocks) register(block, step.n);
  }
  const stepOf = (n) => steps[Math.min(Math.max(1, n), steps.length) - 1];

  /* Revealing */

  const following = () => performance.now() - lastTouch > HANDS_OFF_MS;

  /** The skeletons still to add to show `name` (a whole block, or one part of it). */
  function collect(name) {
    const entry = entries.get(name);
    if (!entry) return [];
    const { laid } = entry;
    const want = name === laid.key ? new Set(laid.pieces.map((piece) => piece.part)) : new Set([name]);
    const out = [];
    laid.pieces.forEach((piece, index) => {
      const id = `${laid.key}:${index}`;
      if (shownPieces.has(id) || piece.needs) return;
      if (piece.base || want.has(piece.part)) {
        shownPieces.add(id);
        shownParts.add(piece.part);
        out.push(...piece.skeletons);
      }
    });
    // Arrows and connectors appear once everything they join is on the board.
    laid.pieces.forEach((piece, index) => {
      const id = `${laid.key}:${index}`;
      if (!piece.needs || shownPieces.has(id) || !piece.needs.every((part) => shownParts.has(part))) return;
      shownPieces.add(id);
      out.push(...piece.skeletons);
    });
    return out;
  }

  function stepSkeletons(n) {
    const step = stepOf(n);
    return step ? [...collect(step.heading.key), ...collect(step.space.key)] : [];
  }

  function draw(skeletons, pace, follow = following()) {
    if (!editor || !skeletons.length) return [];
    return editor.draw(skeletons, { pace, follow });
  }

  /** Every name inside a block, so pointing at a block lights all of it. */
  function namesIn(name) {
    const entry = entries.get(name);
    if (!entry || entry.laid.key !== name) return [name];
    return [...new Set([name, ...entry.laid.pieces.map((piece) => piece.part)])];
  }

  function show(name, pace) {
    const entry = entries.get(name);
    if (!entry) return;
    const added = [...stepSkeletons(entry.step), ...collect(name)];
    // Showing something already up refers back to it instead.
    if (added.length) draw(added, pace);
    else editor.point(namesIn(name), { follow: following() });
  }

  function point(name, pace) {
    if (!editor.point(namesIn(name), { follow: following() })) show(name, pace);
  }

  function mark(name, pace) {
    if (!editor.named(namesIn(name)).length) show(name, pace);
    if (editor.named([`mark-${name}`.slice(0, 40)]).length) {
      editor.point([`mark-${name}`.slice(0, 40)], { follow: following() });
      return;
    }
    const box = editor.bounds(editor.named(namesIn(name)));
    if (!box) return;
    draw([markSkeleton(box, name, `mark-${tag}${extras++}-${name}`.slice(0, 64))], Math.max(500, Math.min(pace, 1200)));
  }

  /** An improvised block (a [write] note or a [draw] sketch) at the bottom of the current step's column. */
  function addBlock(block, pace) {
    const step = stepOf(current);
    if (!step) return;
    if (entries.has(block.key)) return;
    const laid = layoutBlock(block, step.x, step.nextY, `s${step.n}x${tag}${extras++}`);
    step.nextY += laid.height + EXTRA_GAP;
    register(laid, step.n);
    draw([...stepSkeletons(step.n), ...collect(block.key)], pace);
  }

  function setTip(text) {
    tip.textContent = text;
    tip.hidden = !text;
  }

  /**
   * Plays one cue. `pace` is roughly how long the words it goes with take to say, so the drawing
   * keeps time with them.
   */
  function apply(cue, { pace = 1200 } = {}) {
    if (!editor || destroyed || !cue) return;
    try {
      if (cue.op === "step") {
        current = Math.min(Math.max(1, Number(cue.n) || 1), steps.length || 1);
        const added = stepSkeletons(current);
        if (added.length) draw(added, 700, false);
        const step = stepOf(current);
        // A new step: the view moves to the top of its column, like turning to a clean page.
        if (step && following()) editor.frame({ x: step.x, y: 0, width: COLUMN, height: 420 });
      } else if (cue.op === "show") show(cue.key, pace);
      else if (cue.op === "point") point(cue.key, pace);
      else if (cue.op === "mark") mark(cue.key, pace);
      else if (cue.op === "write") addBlock({ key: `note-${tag}${extras}`, type: "note", text: cue.text }, pace);
      else if (cue.op === "add" && cue.block) addBlock(cue.block, pace);
      else if (cue.op === "ask") {
        const step = stepOf(current);
        if (!step) return;
        draw(stepSkeletons(current), 600);
        if (following()) editor.reveal(step.space.box);
        editor.point([step.space.key], { follow: false });
        setTip("Your turn: draw your answer in Your space, then tap Check my drawing or just tell me.");
      }
    } catch (error) {
      // A cue that can't be drawn is skipped; the lesson carries on by voice.
      console.warn("Tutor board cue skipped", cue, error);
    }
  }

  /* The student's work */

  function studentElements() {
    return editor ? editor.api.getSceneElements().filter((element) => element.customData?.klui !== true) : [];
  }

  function changedWork() {
    return studentElements().filter((element) => sentVersions.get(element.id) !== element.version);
  }

  function paintSend() {
    sendButton.hidden = !changedWork().length;
  }

  /**
   * What the tutor should know about the board with the student's next turn: what they selected
   * of the tutor's drawing, and a picture of whatever they drew since it last looked. The work
   * counts as seen only once `acknowledge()` says the turn reached the tutor.
   */
  async function turnContext() {
    if (!editor) return null;
    const live = editor.api.getSceneElements();
    const byId = new Map(live.map((element) => [element.id, element]));
    const pointing = [...new Set(editor.selectedElements()
      .map((element) => (element.containerId ? byId.get(element.containerId) : element)?.customData)
      .filter((data) => data?.klui && data.name && !data.name.startsWith("mark-") && !data.name.startsWith("space-"))
      .map((data) => data.name))].slice(0, 8);
    const changed = changedWork();
    const seen = new Map(studentElements().map((element) => [element.id, element.version]));
    pendingSeen = null;
    let image = null;
    let writing = "";
    if (changed.length) {
      writing = changed.filter((element) => element.type === "text").map((element) => element.text).join(" / ").slice(0, 1000);
      try {
        const box = editor.bounds(changed);
        const rect = { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 };
        const blob = await editor.capture(editor.elementsIn(rect), rect);
        if (blob) image = { data: await base64(blob) };
      } catch {
        image = null;
      }
      // A drawing that couldn't be pictured (and has no words) stays new, to try again.
      if (image || writing) pendingSeen = seen;
    }
    return pointing.length || image || writing ? { pointing, writing, image } : null;
  }

  function acknowledge() {
    if (pendingSeen) sentVersions = pendingSeen;
    pendingSeen = null;
    paintSend();
    setTip("");
  }

  /* Saving */

  function sceneKey() {
    let key = "";
    for (const element of editor.api.getSceneElementsIncludingDeleted()) key += `${element.id}:${element.version}:${element.isDeleted ? 1 : 0};`;
    return key + (editor.api.getAppState().viewBackgroundColor || "");
  }

  function scheduleSave() {
    if (!boardId || destroyed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
  }

  async function save() {
    clearTimeout(saveTimer);
    if (!boardId || !editor) return;
    if (saving) {
      await saving;
      return save();
    }
    if (sceneKey() === savedKey) return;
    // Boards here hold drawings and text only; images would need uploading first.
    const snapshot = () => {
      const scene = editor.scene();
      // Images can't be added here, but ones put on the board elsewhere are kept as they are.
      return cleanScene({ ...scene, elements: [...scene.elements.filter((element) => element.type !== "image"), ...heldImages] });
    };
    saving = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const key = sceneKey();
        try {
          const body = snapshot();
          const result = await api.save(boardId, { expectedRevision: revision, scene: body });
          revision = Number(result?.revision) || revision + 1;
          savedKey = key;
          serverIds = new Set(body.elements.map((element) => element.id));
          return;
        } catch (error) {
          // It's a normal course board, so it may be open in another tab too: fold that copy in
          // (the later edit of each element wins) and save the merge, never overwrite it.
          if (error?.code === "revision_conflict" && attempt === 0 && editor && !destroyed) {
            const latest = await api.open().catch(() => null);
            if (latest?.board?.id === boardId) {
              sync(latest.board.scene);
              editor.merge(latest.board.scene, serverIds);
              serverIds = new Set((latest.board.scene?.elements || []).map((element) => element.id));
              revision = Number(latest.board.revision) || 0;
              continue;
            }
          }
          if (error?.status === 404) boardId = null;
          else if (!saveWarned) {
            saveWarned = true;
            onToast?.("The board couldn't be saved just now. It will keep trying.");
          }
          if (boardId && !destroyed) saveTimer = setTimeout(() => void save(), 8000);
          return;
        }
      }
    })();
    try {
      await saving;
    } finally {
      saving = null;
    }
  }

  /* Lifecycle */

  function onChange() {
    if (destroyed || !editor) return;
    paintSend();
    scheduleSave();
  }

  function touch() {
    lastTouch = performance.now();
    onActivity?.();
  }

  async function mount() {
    const [module, opened] = await Promise.all([
      loadEditor(),
      api.open().catch((error) => {
        onToast?.(error?.message ? `${error.message} The board won't be saved.` : "The board won't be saved this time.");
        return null;
      })
    ]);
    if (destroyed) return;
    const board = opened?.board || null;
    boardId = board?.id || null;
    revision = Number(board?.revision) || 0;
    sync(board?.scene);
    serverIds = new Set((board?.scene?.elements || []).map((element) => element.id));
    host.innerHTML = "";
    editor = await module.mountBoard(host, {
      scene: board?.scene || { elements: [], appState: {} },
      theme: document.body.dataset.mode === "dark" ? "dark" : "light",
      allowImages: false,
      find: false, // no searching the board mid-lesson; it's back once the board opens as a regular whiteboard
      onChange
    });
    if (destroyed) { editor.destroy(); editor = null; return; }
    // A board reopened before the first turn already holds some of the drawing.
    const present = new Set(editor.api.getSceneElementsIncludingDeleted().map((element) => element.id));
    for (const step of steps) {
      for (const laid of [step.heading, step.space, ...step.blocks]) {
        laid.pieces.forEach((piece, index) => {
          if (piece.skeletons.every((skeleton) => present.has(skeleton.id))) {
            shownPieces.add(`${laid.key}:${index}`);
            shownParts.add(piece.part);
          }
        });
      }
    }
    // Improvised notes and sketches from before go on below whatever the tutor already drew there.
    for (const element of editor.api.getSceneElements()) {
      if (!element.customData?.klui) continue;
      const step = steps.find((item) => element.x >= item.x && element.x < item.x + COLUMN);
      if (step) step.nextY = Math.max(step.nextY, element.y + element.height + EXTRA_GAP);
    }
    sentVersions = new Map(studentElements().map((element) => [element.id, element.version]));
    savedKey = sceneKey();
    for (const type of ["pointerdown", "wheel", "touchstart", "keydown"]) host.addEventListener(type, touch, { capture: true, passive: true });
  }

  sendButton.addEventListener("click", () => onSend?.());

  return {
    root,
    mount,
    apply,
    turnContext,
    acknowledge,
    get ready() { return Boolean(editor); },
    get boardId() { return boardId; },
    hasNewWork: () => Boolean(editor && changedWork().length),
    clearTip: () => setTip(""),
    refresh() { editor?.refresh(); },
    async close() {
      if (destroyed) return;
      try { await save(); } catch { /* the last save is best effort */ }
      destroyed = true;
      clearTimeout(saveTimer);
      editor?.destroy();
      editor = null;
    }
  };
}
