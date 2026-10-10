// The Dojo whiteboard's drawing editor: Excalidraw (pinned) mounted as a small React island.
// Everything else (saving, Klui's asks, voice) lives in public/js/studyWhiteboard.js and talks to
// the editor only through the controller returned by mountBoard().
// Built by `npm run whiteboard:build` into public/vendor/whiteboard/; the build output is committed.
import { createElement, Fragment, useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  newElementWith,
  convertToExcalidrawElements,
  elementsOverlappingBBox,
  exportToBlob,
  exportToCanvas,
  exportToSvg,
  getCommonBounds,
  restoreElements
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./whiteboard.css";
import { Find } from "./find.js";
import { ImagePlacementPreview } from "./image-placement.js";
import { clearOf, revealView } from "./make-room.js";
import { darkPixels } from "../../public/js/whiteboard/colors.js";

// Element types a board may hold; frames, embeds and iframes are switched off.
const ALLOWED = new Set(["rectangle", "ellipse", "diamond", "text", "line", "arrow", "freedraw", "image"]);
const BLOCKED_TOOLS = new Set(["frame", "magicframe", "embeddable"]);
const CAPTURE_MAX_PX = 1024;
const CAPTURE_MAX_BYTES = 1_400_000;

function Board({ host, initial, theme, onApi, onChange, onPointerUp, onPaste }) {
  const apiRef = useRef(null);
  const [findOpen, setFindOpen] = useState(false);
  const closeFind = useCallback(() => setFindOpen(false), []);
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        setFindOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
  useEffect(() => () => { apiRef.current = null; }, []);
  return createElement(
    Excalidraw,
    {
      initialData: initial,
      theme,
      excalidrawAPI: (api) => { apiRef.current = api; onApi(api); },
      onChange,
      renderTopRightUI: () => createPortal(createElement(Fragment, null,
        createElement(Find, { api: apiRef.current, open: findOpen, onOpen: () => setFindOpen(true), onClose: closeFind }),
        createElement(ImagePlacementPreview, { api: apiRef.current })), host),
      onPointerUp,
      onPaste,
      aiEnabled: false,
      validateEmbeddable: false,
      handleKeyboardGlobally: false,
      autoFocus: true,
      UIOptions: {
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          export: false,
          saveAsImage: true,
          clearCanvas: true,
          changeViewBackgroundColor: true,
          toggleTheme: null
        },
        tools: { image: true }
      }
    },
    createElement(
      MainMenu,
      null,
      createElement(MainMenu.DefaultItems.SaveAsImage),
      createElement(MainMenu.DefaultItems.Help),
      createElement(MainMenu.DefaultItems.ClearCanvas),
      createElement(MainMenu.Separator),
      createElement(MainMenu.DefaultItems.ChangeCanvasBackground)
    )
  );
}

/** Klui's new elements, shifted by (dx, dy) and marked as Klui's (with the part's name). */
function kluiParts(elements, dx, dy) {
  return elements.map((element) => ({ ...element, x: element.x + dx, y: element.y + dy, customData: { klui: true, ...element.customData } }));
}

function boundsOf(elements) {
  if (!elements.length) return null;
  const [x1, y1, x2, y2] = getCommonBounds(elements);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

// A hidden tab gets no animation frames, so its changes land at once.
const motionOff = () => document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (t) => 1 - (1 - t) ** 3;
// A little overshoot, so new parts pop in.
const easeBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const lerp = (from, to, t) => from + (to - from) * t;

function lerpColor(from, to, t) {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!hex.test(from || "") || !hex.test(to || "")) return t < 0.5 ? from : to;
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const channel = (shift) => Math.round(lerp((a >> shift) & 255, (b >> shift) & 255, t));
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, "0")}`;
}

/** An element part way from how it was to `patch` (positions, sizes, points and colours blend). */
function tween(element, patch, t) {
  const out = {};
  for (const key of ["x", "y", "width", "height", "fontSize", "opacity"]) {
    if (typeof patch[key] === "number" && typeof element[key] === "number") out[key] = lerp(element[key], patch[key], t);
  }
  for (const key of ["strokeColor", "backgroundColor"]) if (patch[key] !== undefined) out[key] = lerpColor(element[key], patch[key], t);
  if (Array.isArray(patch.points) && patch.points.length === element.points?.length) {
    out.points = element.points.map(([px, py], index) => [lerp(px, patch.points[index][0], t), lerp(py, patch.points[index][1], t)]);
  }
  return out;
}

/** A new element at `t` of its entrance: shapes grow out of their centre, lines draw themselves. */
function entrance(element, t) {
  const opacity = element.opacity * Math.min(1, t * 2.5);
  if (Array.isArray(element.points) && element.points.length > 1 && element.type !== "freedraw") {
    const steps = element.points.length - 1;
    const reach = easeOut(t) * steps;
    const whole = Math.floor(reach);
    const points = element.points.slice(0, whole + 1);
    if (whole < steps) {
      const [ax, ay] = element.points[whole];
      const [bx, by] = element.points[whole + 1];
      points.push([lerp(ax, bx, reach - whole), lerp(ay, by, reach - whole)]);
    }
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    return { opacity, points, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  if (element.type === "text") return { opacity };
  const scale = lerp(0.35, 1, easeBack(t));
  return {
    opacity,
    x: element.x + (element.width * (1 - scale)) / 2,
    y: element.y + (element.height * (1 - scale)) / 2,
    width: element.width * scale,
    height: element.height * scale
  };
}

/**
 * Mounts the editor into `host`. Resolves to a controller once Excalidraw is ready.
 * scene: { elements, appState: { viewBackgroundColor } }; files: BinaryFileData[] for images.
 */
export function mountBoard(host, { scene = {}, files = [], theme = "light", onChange, onSelectionSettled, onPaste } = {}) {
  const root = createRoot(host);
  let api = null;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  const initial = {
    elements: restoreElements((scene.elements || []).filter((element) => ALLOWED.has(element.type)), null),
    appState: {
      viewBackgroundColor: scene.appState?.viewBackgroundColor || "#ffffff",
      currentItemFontFamily: 5, // Excalifont, the handwritten face
      currentItemRoughness: 1
    },
    files: Object.fromEntries(files.map((file) => [file.id, file])),
    scrollToContent: true
  };

  function selectedElements(state = api.getAppState()) {
    const ids = state.selectedElementIds || {};
    const chosen = api.getSceneElements().filter((element) => ids[element.id]);
    // A shape's label or an arrow's text comes along with it.
    const extra = api.getSceneElements().filter((element) => element.containerId && ids[element.containerId] && !ids[element.id]);
    return [...chosen, ...extra];
  }

  let playing = null;

  /**
   * Applies Klui's change as one undo step: `added` new elements (those in `behind` go under
   * everything), `patches` by id (isDeleted removes). Unless motion is reduced, it plays first:
   * edits glide, new parts appear one after another and deletions fade, while the student's
   * own edits during the animation are kept.
   */
  /** A short glow around each element in `ids` (or one around them all when there are many). */
  function flash(ids) {
    const live = api.getSceneElements().filter((element) => ids.includes(element.id));
    if (!live.length) return;
    let layer = host.querySelector(":scope > .wb-flash-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "wb-flash-layer";
      host.append(layer);
    }
    const origin = host.getBoundingClientRect();
    const boxes = live.length > 24 ? [boundsOf(live)] : live.map((element) => boundsOf([element]));
    for (const box of boxes) {
      const a = controller.toClient(box.x, box.y);
      const b = controller.toClient(box.x + box.width, box.y + box.height);
      const glow = document.createElement("div");
      glow.className = "wb-flash";
      Object.assign(glow.style, { left: `${a.x - origin.left - 6}px`, top: `${a.y - origin.top - 6}px`, width: `${b.x - a.x + 12}px`, height: `${b.y - a.y + 12}px` });
      glow.addEventListener("animationend", () => glow.remove());
      layer.append(glow);
    }
  }

  function commit({ added = [], behind = new Set(), patches = new Map(), select = [], glow = [] }) {
    playing?.finish();
    const known = new Set(added.map((element) => element.id));
    const originals = new Map(api.getSceneElementsIncludingDeleted().filter((element) => patches.has(element.id)).map((element) => [element.id, element]));
    // The change lands at once as one undo step; the animation is only a replay on top of it.
    const rest = api.getSceneElementsIncludingDeleted().map((element) => (patches.has(element.id) ? newElementWith(element, patches.get(element.id)) : element));
    api.updateScene({
      elements: [...added.filter((element) => behind.has(element.id)), ...rest, ...added.filter((element) => !behind.has(element.id))],
      appState: { selectedElementIds: Object.fromEntries(select.map((id) => [id, true])) },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
    if (motionOff() || (!added.length && !patches.size)) {
      flash(glow);
      return;
    }
    const landed = new Map(api.getSceneElementsIncludingDeleted().filter((element) => known.has(element.id) || patches.has(element.id)).map((element) => [element.id, element]));
    // Labels enter with their shape; everything else takes its turn.
    const order = added.filter((element) => !element.containerId);
    const gap = Math.min(110, 900 / Math.max(1, order.length));
    const startOf = new Map(order.map((element, index) => [element.id, index * gap]));
    for (const element of added) if (element.containerId) startOf.set(element.id, startOf.get(element.containerId) ?? 0);
    const lengthOf = (element) => (Array.isArray(element.points) ? 520 : 420);
    const EDIT_MS = 560;
    const total = Math.max(EDIT_MS, ...added.map((element) => startOf.get(element.id) + lengthOf(element)));
    // Frames are never recorded, so they can't touch undo; the student's own edits meanwhile stay.
    const show = (pick) => api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((element) => {
        const change = landed.has(element.id) && pick(element.id);
        return change ? newElementWith(element, change) : element;
      }),
      captureUpdate: CaptureUpdateAction.NEVER
    });
    const began = performance.now();
    let frameId = 0;
    const frame = () => {
      const now = performance.now() - began;
      if (now >= total) return run.finish();
      const t = easeOut(Math.min(1, now / EDIT_MS));
      show((id) => {
        if (known.has(id)) return entrance(landed.get(id), Math.min(1, Math.max(0, (now - startOf.get(id)) / lengthOf(landed.get(id)))));
        const from = originals.get(id);
        // A deletion fades out; everything else blends from how it was to how it is now.
        return patches.get(id).isDeleted ? { isDeleted: false, opacity: from.opacity * (1 - t) } : tween(from, patches.get(id), t);
      });
      frameId = requestAnimationFrame(frame);
    };
    const ANIMATED = ["x", "y", "width", "height", "fontSize", "opacity", "strokeColor", "backgroundColor", "points", "isDeleted"];
    const run = {
      finish() {
        if (playing !== run) return;
        playing = null;
        cancelAnimationFrame(frameId);
        show((id) => Object.fromEntries(ANIMATED.filter((key) => landed.get(id)[key] !== undefined).map((key) => [key, landed.get(id)[key]])));
        flash(glow);
      }
    };
    playing = run;
    // Frames can stall (the tab is hidden mid-animation); the change still lands.
    setTimeout(() => run.finish(), total + 400);
    frame();
  }

  /** Pans the view (keeping its zoom) just far enough to show `box`; too big to fit, it zooms out to fit. */
  function showBox(box) {
    const state = api.getAppState();
    const zoom = state.zoom.value;
    const view = { x: -state.scrollX, y: -state.scrollY, width: state.width / zoom, height: state.height / zoom };
    const to = revealView(box, view, 60 / zoom);
    if (!to) return;
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Centring on a view-sized frame at the new spot pans there; the student can interrupt it.
    const target = to === "fit" ? box : { ...view, x: to.x, y: to.y };
    api.scrollToContent(convertToExcalidrawElements([{ type: "rectangle", ...target }]), { animate, ...(to === "fit" ? { fitToViewport: true, viewportZoomFactor: 0.9 } : {}) });
  }

  const controller = {
    get api() { return api; },
    /** The durable drawing: all elements (including deleted, so undo survives reloads) and the background. */
    scene() {
      return {
        elements: api.getSceneElementsIncludingDeleted(),
        appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor }
      };
    },
    files() { return api.getFiles(); },
    selectedElements,
    selectionBounds() { return boundsOf(selectedElements()); },
    /** The box around elements as drawn: rotation and stroke extent included. */
    bounds(elements) { return boundsOf(elements); },
    /** Elements touching a scene-space rectangle. */
    elementsIn(rect) {
      const live = api.getSceneElements();
      const hit = elementsOverlappingBBox({
        elements: live,
        bounds: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
        type: "overlap"
      });
      const ids = new Set(hit.map((element) => element.id));
      return live.filter((element) => ids.has(element.id) || (element.containerId && ids.has(element.containerId)));
    },
    /** Scene point → page (client) pixels, for overlays. */
    toClient(x, y) {
      const state = api.getAppState();
      return {
        x: (x + state.scrollX) * state.zoom.value + state.offsetLeft,
        y: (y + state.scrollY) * state.zoom.value + state.offsetTop
      };
    },
    /** Page pixels → scene point. */
    toScene(clientX, clientY) {
      const state = api.getAppState();
      return {
        x: (clientX - state.offsetLeft) / state.zoom.value - state.scrollX,
        y: (clientY - state.offsetTop) / state.zoom.value - state.scrollY
      };
    },
    /** The part of the board on screen, in scene coordinates. */
    visibleRect() {
      const state = api.getAppState();
      const zoom = state.zoom.value;
      return { x: -state.scrollX, y: -state.scrollY, width: state.width / zoom, height: state.height / zoom };
    },
    /**
     * A picture of exactly `rect` (scene coordinates) showing `elements`, longest side at most
     * 1024 px, on the board's background. PNG, or JPEG when the PNG would be too large.
     */
    async capture(elements, rect) {
      if (!elements.length || !rect || rect.width < 1 || rect.height < 1) return null;
      const [x1, y1, x2, y2] = getCommonBounds(elements);
      const background = api.getAppState().viewBackgroundColor || "#ffffff";
      // Scale so the framed area fits 1024 px, but never render the elements' full extent past 4096 px.
      const scale = Math.min(2, CAPTURE_MAX_PX / Math.max(rect.width, rect.height), 4096 / Math.max(x2 - x1, y2 - y1, 1));
      const source = await exportToCanvas({
        elements,
        files: api.getFiles(),
        appState: { exportBackground: false, viewBackgroundColor: background, exportWithDarkMode: false },
        exportPadding: 0,
        getDimensions: (width, height) => ({ width: width * scale, height: height * scale, scale })
      });
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(rect.width * scale));
      out.height = Math.max(1, Math.round(rect.height * scale));
      const ctx = out.getContext("2d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, out.width, out.height);
      // The exported canvas starts at the elements' top-left (x1, y1); shift it into the frame.
      ctx.drawImage(source, (x1 - rect.x) * scale, (y1 - rect.y) * scale);
      // In the dark theme the picture shows the board as the student sees it.
      if (api.getAppState().theme === "dark") {
        const pixels = ctx.getImageData(0, 0, out.width, out.height);
        darkPixels(pixels.data);
        ctx.putImageData(pixels, 0, 0);
      }
      const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
      if (blob && blob.size <= CAPTURE_MAX_BYTES) return blob;
      return new Promise((resolve) => out.toBlob(resolve, "image/jpeg", 0.85));
    },
    /** capture() for elements stored earlier (a reopened answer's frozen context). */
    captureFrozen(elements, rect) {
      return controller.capture(restoreElements((elements || []).filter((element) => ALLOWED.has(element.type)), null), rect);
    },
    /** An SVG preview of Klui's diagram skeletons, for the answer card. */
    async preview(skeletons) {
      const made = convertToExcalidrawElements(skeletons, { regenerateIds: true });
      return exportToSvg({
        elements: made,
        files: {},
        appState: { exportBackground: false, exportWithDarkMode: document.body.dataset.mode === "dark" },
        exportPadding: 12
      });
    },
    /** Centres the view on a scene rectangle. */
    scrollToRect(rect) {
      const state = api.getAppState();
      const zoom = state.zoom.value;
      api.updateScene({
        appState: {
          scrollX: state.width / zoom / 2 - (rect.x + rect.width / 2),
          scrollY: state.height / zoom / 2 - (rect.y + rect.height / 2)
        },
        captureUpdate: CaptureUpdateAction.NEVER
      });
    },
    /**
     * Adds elements as one undo step. `skeletons` are Excalidraw element skeletons; with `at`
     * their top-left is moved to that point, otherwise their coordinates are used as they are.
     * Returns the new element ids.
     */
    insert(skeletons, at = null, edits = [], animate = false) {
      const made = convertToExcalidrawElements(skeletons, { regenerateIds: true });
      const box = boundsOf(made) || { x: 0, y: 0 };
      const dx = at ? at.x - box.x : 0;
      let dy = at ? at.y - box.y : 0;
      if (at && box.width && box.height) {
        const occupied = api.getSceneElements().map((element) => boundsOf([element]));
        // Keep a newly applied diagram away from existing notes and drawings.
        for (let pass = 0; pass <= occupied.length; pass += 1) {
          const hit = occupied.find((rect) => at.x < rect.x + rect.width + 40 && at.x + box.width + 40 > rect.x && box.y + dy < rect.y + rect.height + 40 && box.y + dy + box.height + 40 > rect.y);
          if (!hit) break;
          dy = hit.y + hit.height + 80 - box.y;
        }
      }
      const moved = kluiParts(made, dx, dy).map((element) => {
        delete element.customData.behind;
        return element;
      });
      const patches = new Map();
      for (const element of api.getSceneElementsIncludingDeleted()) {
        const edit = edits.find(item => item.id === element.id);
        if (!edit) continue;
        const { id, ...patch } = edit;
        if (patch.text !== undefined) {
          const [measured] = convertToExcalidrawElements([{ type: "text", x: element.x, y: element.y, text: patch.text, fontSize: element.fontSize, fontFamily: element.fontFamily, textAlign: element.textAlign }]);
          Object.assign(patch, { originalText: patch.text, width: measured.width, height: measured.height, autoResize: true });
        }
        patches.set(element.id, patch);
      }
      commit({ added: moved, patches, select: moved.filter((element) => !element.containerId).map((element) => element.id) });
      if (at && moved.length) api.scrollToContent(moved, { animate });
      return moved.map((element) => element.id);
    },
    /**
     * Runs a voice command as one undo step: draws `skeletons` with their coordinates taken from
     * `origin` (the top-left of the view the command was given) and applies `edits` to elements by
     * id. Edit x/y are view coordinates of the element's box; a shape's label follows its shape.
     * Returns the ids of what it drew and of the elements it was asked to change.
     */
    command({ skeletons = [], origin, edits = [], transforms = [], seen = null, reveal = false }) {
      let made = kluiParts(convertToExcalidrawElements(skeletons, { regenerateIds: true }), origin.x, origin.y);
      // A new drawing past the edge of the view moves clear of anything Klui couldn't see. Parts
      // added on or beside what it saw (a window on a house) stay where they were put.
      const drawn = boundsOf(made);
      if (drawn && seen) {
        const known = new Set(seen);
        const live = api.getSceneElements();
        const boxes = (keep) => live.filter((element) => known.has(element.id) === keep).map((element) => boundsOf([element]));
        const { dx, dy } = clearOf(drawn, origin, boxes(false), boxes(true));
        if (dx || dy) made = kluiParts(made, dx, dy);
      }
      const all = api.getSceneElementsIncludingDeleted();
      const byId = new Map(all.map((element) => [element.id, element]));
      // A transform moves or scales a whole drawing about its shared centre: each part gets the
      // matching move and resize (text grows by font size).
      edits = [...edits];
      for (const item of transforms) {
        const group = item.ids.map((id) => byId.get(id)).filter((element) => element && !element.isDeleted);
        const box = boundsOf(group);
        if (!box) continue;
        const scale = item.scale || 1;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        for (const element of group) {
          const own = boundsOf([element]);
          const x = cx + (own.x - cx) * scale + (item.dx || 0) - origin.x;
          const y = cy + (own.y - cy) * scale + (item.dy || 0) - origin.y;
          const size = scale === 1 ? {} : element.type === "text" ? { fontSize: element.fontSize * scale } : { width: element.width * scale, height: element.height * scale };
          edits.push({ id: element.id, x, y, ...size });
        }
      }
      const patches = new Map();
      const patch = (id, change) => patches.set(id, { ...patches.get(id), ...change });
      const measure = (element, text, fontSize = element.fontSize) => {
        const [measured] = convertToExcalidrawElements([{ type: "text", x: 0, y: 0, text, fontSize, fontFamily: element.fontFamily, textAlign: element.textAlign }]);
        return measured;
      };
      for (const edit of edits) {
        const element = byId.get(edit.id);
        if (!element || element.isDeleted) continue;
        const labelRef = element.boundElements?.find((bound) => bound.type === "text");
        const label = labelRef ? byId.get(labelRef.id) : null;
        if (edit.delete) {
          patch(element.id, { isDeleted: true });
          if (label) patch(label.id, { isDeleted: true });
          continue;
        }
        const box = boundsOf([element]) || { x: element.x, y: element.y, width: element.width, height: element.height };
        const change = {};
        let width = element.width;
        let height = element.height;
        if (element.type === "text" && (edit.text !== undefined || edit.fontSize)) {
          const measured = measure(element, edit.text ?? element.originalText ?? element.text, edit.fontSize || element.fontSize);
          if (edit.text !== undefined) Object.assign(change, { text: edit.text, originalText: edit.text });
          if (edit.fontSize) change.fontSize = edit.fontSize;
          Object.assign(change, { width: measured.width, height: measured.height, autoResize: true });
          width = measured.width;
          height = measured.height;
        }
        if (element.type !== "text" && (edit.width !== undefined || edit.height !== undefined)) {
          const sx = edit.width !== undefined && element.width ? edit.width / element.width : 1;
          const sy = edit.height !== undefined && element.height ? edit.height / element.height : 1;
          width = element.width * sx;
          height = element.height * sy;
          change.width = width;
          change.height = height;
          // Lines and strokes are points: scale them about the box's top-left.
          if (Array.isArray(element.points)) {
            const left = Math.min(...element.points.map((point) => point[0]));
            const top = Math.min(...element.points.map((point) => point[1]));
            change.points = element.points.map(([px, py]) => [left + (px - left) * sx, top + (py - top) * sy]);
          }
        }
        // Moving puts the box's top-left at (x, y); a resize without a move keeps the same centre.
        const resized = width !== element.width || height !== element.height;
        const left = edit.x !== undefined ? origin.x + edit.x : resized && element.type !== "text" ? box.x - (width - element.width) / 2 : box.x;
        const top = edit.y !== undefined ? origin.y + edit.y : resized && element.type !== "text" ? box.y - (height - element.height) / 2 : box.y;
        change.x = element.x + (left - box.x);
        change.y = element.y + (top - box.y);
        if (edit.strokeColor) change.strokeColor = edit.strokeColor;
        if (edit.backgroundColor) {
          change.backgroundColor = edit.backgroundColor;
          if (element.backgroundColor === "transparent" && edit.backgroundColor !== "transparent") change.fillStyle = label ? "hachure" : "solid";
        }
        patch(element.id, change);
        if (label) {
          // Only new words are measured again; otherwise the label keeps its wrapping and just follows.
          const size = edit.text !== undefined ? measure(label, edit.text) : label;
          patch(label.id, {
            ...(edit.text !== undefined ? { text: edit.text, originalText: edit.text, width: size.width, height: size.height } : {}),
            x: change.x + width / 2 - size.width / 2,
            y: change.y + height / 2 - size.height / 2,
            ...(edit.strokeColor ? { strokeColor: edit.strokeColor } : {})
          });
        }
      }
      // Arrows attached to a moved shape keep their attached end on it.
      for (const arrow of all) {
        if (arrow.type !== "arrow" || arrow.isDeleted || patches.has(arrow.id) || arrow.points.length < 2) continue;
        const shift = (binding) => {
          const target = binding && byId.get(binding.elementId);
          const change = target && patches.get(target.id);
          if (!change || change.isDeleted || change.x === undefined) return null;
          const width = change.width ?? target.width;
          const height = change.height ?? target.height;
          return [change.x + width / 2 - (target.x + target.width / 2), change.y + height / 2 - (target.y + target.height / 2)];
        };
        const start = shift(arrow.startBinding);
        const end = shift(arrow.endBinding);
        if (!start && !end) continue;
        const points = arrow.points.map(([px, py]) => [px, py]);
        const last = points.length - 1;
        if (end) points[last] = [points[last][0] + end[0] - (start?.[0] || 0), points[last][1] + end[1] - (start?.[1] || 0)];
        if (start) for (let index = 1; index < last; index += 1) points[index] = [points[index][0] - start[0], points[index][1] - start[1]];
        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        patch(arrow.id, {
          x: arrow.x + (start?.[0] || 0), y: arrow.y + (start?.[1] || 0), points,
          width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys)
        });
      }
      const behind = new Set(made.filter((element) => element.customData.behind || (element.containerId && made.find((item) => item.id === element.containerId)?.customData.behind)).map((element) => element.id));
      for (const element of made) delete element.customData.behind;
      // What Klui drew or changed glows for a moment instead of being selected, so the board stays clean.
      const changed = [...patches].filter(([id, change]) => !change.isDeleted && !byId.get(id)?.containerId).map(([id]) => id);
      commit({ added: made, behind, patches, glow: [...made.filter((element) => !element.containerId).map((element) => element.id), ...changed] });
      // What Klui was asked to draw or change, without arrows that only followed a moved shape.
      const asked = new Set(edits.filter((edit) => !edit.delete).map((edit) => edit.id));
      const focus = [...made.filter((element) => !element.containerId).map((element) => element.id), ...changed.filter((id) => asked.has(id))];
      // The view moves just enough to show it when it ended up off screen.
      if (reveal && focus.length) {
        // Where everything ends up, not the animation's first frame.
        const ids = new Set(focus);
        showBox(boundsOf([...made.filter((element) => ids.has(element.id)), ...changed.filter((id) => ids.has(id)).map((id) => ({ ...byId.get(id), ...patches.get(id) }))]));
      }
      return focus;
    },
    navigate(direction) {
      const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (direction === "fit") {
        const elements = api.getSceneElements();
        if (elements.length) api.scrollToContent(elements, { animate, fitToViewport: true });
        return;
      }
      const state = api.getAppState();
      const width = state.width / state.zoom.value;
      const height = state.height / state.zoom.value;
      const x = -state.scrollX + (direction === "left" ? -width * .65 : direction === "right" ? width * .65 : 0);
      const y = -state.scrollY + (direction === "up" ? -height * .65 : direction === "down" ? height * .65 : 0);
      const frame = convertToExcalidrawElements([{ type: "rectangle", x, y, width, height }]);
      api.scrollToContent(frame, { animate });
    },
    /** Replaces the whole drawing without touching undo history (loading a saved copy). */
    load(sceneData) {
      api.updateScene({
        elements: restoreElements((sceneData.elements || []).filter((element) => ALLOWED.has(element.type)), null),
        appState: { viewBackgroundColor: sceneData.appState?.viewBackgroundColor || "#ffffff" },
        captureUpdate: CaptureUpdateAction.NEVER
      });
      api.history.clear();
    },
    addFiles(list) { if (list.length) api.addFiles(list); },
    /** Drops element types boards do not allow (e.g. a frame added from the shape menu). */
    dropDisallowed() {
      const all = api.getSceneElementsIncludingDeleted();
      if (all.every((element) => ALLOWED.has(element.type))) return false;
      api.updateScene({ elements: all.filter((element) => ALLOWED.has(element.type)), captureUpdate: CaptureUpdateAction.NEVER });
      return true;
    },
    clearSelection() {
      api.updateScene({ appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
    },
    setTool(type) { api.setActiveTool({ type }); },
    setTheme(next) { render(next); },
    toast(message) { api.setToast({ message, closable: true, duration: 3000 }); },
    destroy() { root.unmount(); }
  };

  function render(currentTheme) {
    root.render(createElement(Board, {
      host,
      initial,
      theme: currentTheme,
      onApi: (next) => {
        if (api) return;
        api = next;
        resolveReady(controller);
      },
      onChange: (elements, appState) => {
        const shell = host.closest(".wb-shell");
        shell?.style.setProperty("--wb-canvas-color", appState.viewBackgroundColor || "#ffffff");
        shell?.style.setProperty("--wb-canvas-filter", appState.theme === "dark" ? "invert(93%) hue-rotate(180deg)" : "none");
        // Frames and embeds are not available on boards: the shape menu and shortcuts still
        // offer them, so switch the tool back and drop anything that slipped in (e.g. a paste).
        if (api && appState.openSidebar) api.toggleSidebar({ name: appState.openSidebar.name, force: false });
        if (api && BLOCKED_TOOLS.has(appState.activeTool?.type)) {
          api.setActiveTool({ type: "selection" });
          controller.toast("Frames and embeds aren't available on boards.");
        }
        if (api && elements.some((element) => !ALLOWED.has(element.type))) {
          setTimeout(() => controller.dropDisallowed(), 0);
          return;
        }
        onChange?.(elements, appState);
      },
      onPointerUp: (activeTool) => {
        if (activeTool.type === "selection") setTimeout(() => onSelectionSettled?.(), 0);
      },
      onPaste: (data, event) => (onPaste ? onPaste(data, event) : true)
    }));
  }
  render(theme);
  return ready;
}
