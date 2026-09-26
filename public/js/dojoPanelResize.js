// Drag the gaps beside Ask to resize the Sources and Create panels.
// Widths are remembered per mode: a file list and an open preview keep separate sizes,
// as do the Create collection and an item opened inside it.
const STORAGE_KEY = "klui.dojo.panelSizes.v1";
const MIN = { sources: 180, studio: 230 };
const CHAT_MIN = 320;
const STEP = 24;
const PANEL = { sources: ".dojo-sources", studio: ".dojo-studio" };

function loadSizes() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

// mode(side) names the size slot for the panel's current content;
// collapsed(side) is true while that panel is folded to its rail.
export function createPanelResizer({ mode, collapsed }) {
  const desktop = window.matchMedia?.("(min-width: 761px)");
  const sizes = loadSizes();
  let workspace = null;
  let observer = null;
  let frame = 0;
  let drag = null;

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes)); } catch { /* Storage is optional. */ }
  }

  function panelWidth(side) {
    return workspace.querySelector(PANEL[side])?.getBoundingClientRect().width || 0;
  }

  function gap() {
    return parseFloat(getComputedStyle(workspace).columnGap) || 0;
  }

  // Keeps Ask at least CHAT_MIN wide beside the other panel.
  function fit(side, width, other) {
    const room = workspace.clientWidth - gap() * 2 - CHAT_MIN - other;
    return Math.round(Math.max(MIN[side], Math.min(width, room)));
  }

  function apply() {
    if (!workspace?.isConnected) return;
    workspace.style.gridTemplateColumns = "";
    const left = desktop?.matches && !collapsed("sources") && sizes[mode("sources")];
    const right = desktop?.matches && !collapsed("studio") && sizes[mode("studio")];
    if (left || right) {
      // Sides without a saved width keep what the stylesheet gives them.
      const css = getComputedStyle(workspace).gridTemplateColumns.split(" ").map(parseFloat);
      let l = left || css[0];
      let r = right || css[2];
      if (right) r = fit("studio", r, l);
      if (left) l = fit("sources", l, r);
      // Too tight for any saved width to leave Ask its room: the stylesheet's layout takes over.
      if (workspace.clientWidth - gap() * 2 - l - r >= CHAT_MIN) workspace.style.gridTemplateColumns = `${l}px minmax(0, 1fr) ${r}px`;
    }
    place();
  }

  function place() {
    if (!workspace?.isConnected) return;
    const box = workspace.getBoundingClientRect();
    const half = gap() / 2;
    workspace.querySelectorAll("[data-panel-resize]").forEach((handle) => {
      const side = handle.dataset.panelResize;
      const rect = workspace.querySelector(PANEL[side])?.getBoundingClientRect();
      if (!rect) return;
      const edge = side === "sources" ? rect.right - box.left + half : rect.left - box.left - half;
      handle.style.left = `${edge}px`;
      handle.setAttribute("aria-valuenow", String(Math.round(rect.width)));
    });
  }

  function setSize(side, width) {
    const other = side === "sources" ? "studio" : "sources";
    sizes[mode(side)] = fit(side, width, panelWidth(other));
    apply();
  }

  function reset(side) {
    delete sizes[mode(side)];
    save();
    apply();
  }

  function draggingHandle() {
    return drag && workspace?.querySelector(`[data-panel-resize="${drag.side}"]`);
  }

  // The drag listens on the window, so a repaint that swaps the handle mid-drag
  // neither strands the page in its resizing state nor drops the drag.
  function onDragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = event.clientX - drag.startX;
    setSize(drag.side, drag.startWidth + (drag.side === "sources" ? delta : -delta));
    draggingHandle()?.classList.add("is-dragging");
  }

  function endDrag(event) {
    if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
    workspace?.querySelectorAll(".dojo-resizer.is-dragging").forEach((handle) => handle.classList.remove("is-dragging"));
    drag = null;
    document.body.classList.remove("dojo-resizing");
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    window.removeEventListener("blur", endDrag);
    save();
  }

  function startDrag(event) {
    const handle = event.currentTarget;
    const side = handle.dataset.panelResize;
    if (event.button !== 0 || !desktop?.matches || collapsed(side)) return;
    event.preventDefault();
    endDrag();
    drag = { side, pointerId: event.pointerId, startX: event.clientX, startWidth: panelWidth(side) };
    handle.classList.add("is-dragging");
    document.body.classList.add("dojo-resizing");
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("blur", endDrag);
  }

  function onKey(event) {
    const side = event.currentTarget.dataset.panelResize;
    if (collapsed(side)) return;
    if (event.key === "Home" || event.key === "Enter") {
      event.preventDefault();
      reset(side);
      return;
    }
    const dir = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    event.preventDefault();
    setSize(side, panelWidth(side) + dir * STEP * (side === "sources" ? 1 : -1));
    save();
  }

  function attach(next) {
    if (!next) return;
    if (next !== workspace) {
      observer?.disconnect();
      workspace = next;
      workspace.querySelectorAll("[data-panel-resize]").forEach((handle) => {
        handle.addEventListener("pointerdown", startDrag);
        handle.addEventListener("dblclick", () => reset(handle.dataset.panelResize));
        handle.addEventListener("keydown", onKey);
      });
      if (typeof ResizeObserver !== "undefined") {
        // Room can change without a window resize (the app sidebar opening), so widths are refit too.
        observer = new ResizeObserver(schedule);
        observer.observe(workspace);
        Object.values(PANEL).forEach((selector) => {
          const panel = workspace.querySelector(selector);
          if (panel) observer.observe(panel);
        });
      }
      if (drag) draggingHandle()?.classList.add("is-dragging");
    }
    apply();
  }

  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  }

  window.addEventListener("resize", schedule);

  return { attach, apply };
}

export function panelResizeHandles() {
  return [["sources", "Resize sources"], ["studio", "Resize create"]].map(([side, label]) =>
    `<div class="dojo-resizer" data-panel-resize="${side}" role="separator" aria-orientation="vertical" aria-label="${label}" title="Drag to resize · double-click to reset" tabindex="0"></div>`
  ).join("");
}
