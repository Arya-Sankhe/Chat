/* The one writer of <body>/<html> classes, data attributes and CSS variables.
   The old stylesheets key layout off these (body.chat-empty, data-mode, the
   wallpaper variables), so they are applied from a store subscription, before
   React commits and before anything measures. Only the names listed here are touched; the
   pre-React boot script in index.html sets the same ones for the first frame. */
import { appearanceAttributes } from "@klui/shared";
import { NATIVE_APP, useApp, type AppState } from "./app";

/** documentViewer.js setDocumentViewerWidth/initDocumentViewerWidth (run once at load). */
const VIEWER_WIDTH_KEY = "klui.documentViewer.width.v1";
export function setDocumentViewerWidth(width: number) {
  const min = 360;
  const max = Math.max(min, Math.min(window.innerWidth - 460, Math.floor(window.innerWidth * 0.72)));
  const next = Math.max(min, Math.min(max, Math.round(width)));
  document.documentElement.style.setProperty("--document-viewer-w", `${next}px`);
  try {
    localStorage.setItem(VIEWER_WIDTH_KEY, String(next));
  } catch {
    /* Ignore storage failures. */
  }
}

export function initDocumentViewerWidth() {
  const saved = Number(localStorage.getItem(VIEWER_WIDTH_KEY) || 0);
  setDocumentViewerWidth(saved || Math.round(window.innerWidth * 0.45));
}

const WALLPAPER_VARS = ["--home-wallpaper-image", "--chat-outline-image", "--home-wallpaper-base"];

function apply(state: AppState) {
  const { accent, mode, wallpaper, style } = appearanceAttributes(state.settings, state.systemDark, NATIVE_APP);
  const body = document.body;
  body.dataset.accent = accent;
  body.dataset.mode = mode;
  body.dataset.wallpaper = wallpaper;
  for (const name of WALLPAPER_VARS) {
    if (style[name]) body.style.setProperty(name, style[name]);
    else body.style.removeProperty(name);
  }
  const list = body.classList;
  list.toggle("capacitor-native", state.mobile);
  list.toggle("mobile-ui", state.mobile);
  list.toggle("chat-empty", state.chatEmpty);
  list.toggle("temporary-chat", state.temporaryChat);
  list.toggle("sidebar-expanded", state.sidebarExpanded);
  list.toggle("sidebar-open", state.sidebarOpen);
  // Before the first renderShell() the page is the static markup, as before.
  if (state.shellRender > 0) list.toggle("guest-mode", !state.signedIn);
}

/** Applied on every store change, synchronously: before React commits and
   before any layout effect measures, as the old code set classes first. */
export function installBodyState() {
  apply(useApp.getState());
  useApp.subscribe(apply);
}
