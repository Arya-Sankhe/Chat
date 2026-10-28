// "Wheel zooms": with a mouse, the scroll wheel zooms the board without holding Ctrl. Off by
// default (trackpads scroll), remembered per browser. Excalidraw's wheel handler asks wheelZooms().
const KEY = "klui.whiteboard.wheelZoom";
let on = false;
try { on = localStorage.getItem(KEY) === "1"; } catch {}

export const wheelZoomOn = () => on;

export function setWheelZoom(value) {
  on = Boolean(value);
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {}
}

/** Whether a plain wheel turn zooms; Shift+wheel still scrolls sideways. */
export const wheelZooms = (event) => on && !event.shiftKey;
