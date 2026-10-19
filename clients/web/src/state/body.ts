/* The one writer of <body>/<html> classes, data attributes and CSS variables.
   The old stylesheets key layout off these (body.chat-empty, data-mode, the
   wallpaper variables), so they are applied in a layout effect, before paint
   and before anything measures. Only the names listed here are touched; the
   pre-React boot script in index.html sets the same ones for the first frame. */
import { useLayoutEffect } from "react";
import { appearanceAttributes } from "@klui/shared";
import { useApp } from "./app";

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

export function useBodyState() {
  const settings = useApp((s) => s.settings);
  const systemDark = useApp((s) => s.systemDark);
  const mobile = useApp((s) => s.mobile);
  const booted = useApp((s) => s.shellRender > 0);
  const signedIn = useApp((s) => s.signedIn);
  const chatEmpty = useApp((s) => s.chatEmpty);
  const sidebarExpanded = useApp((s) => s.sidebarExpanded);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const temporaryChat = useApp((s) => s.temporaryChat);

  useLayoutEffect(() => {
    const { accent, mode, wallpaper, style } = appearanceAttributes(settings, systemDark);
    const body = document.body;
    body.dataset.accent = accent;
    body.dataset.mode = mode;
    body.dataset.wallpaper = wallpaper;
    for (const name of WALLPAPER_VARS) {
      if (style[name]) body.style.setProperty(name, style[name]);
      else body.style.removeProperty(name);
    }
  }, [settings, systemDark]);

  useLayoutEffect(() => {
    const list = document.body.classList;
    list.toggle("capacitor-native", mobile);
    list.toggle("mobile-ui", mobile);
    list.toggle("chat-empty", chatEmpty);
    list.toggle("temporary-chat", temporaryChat);
    list.toggle("sidebar-expanded", sidebarExpanded);
    list.toggle("sidebar-open", sidebarOpen);
    // Before the first renderShell() the page is the static markup, as before.
    if (booted) list.toggle("guest-mode", !signedIn);
  }, [mobile, chatEmpty, temporaryChat, sidebarExpanded, sidebarOpen, booted, signedIn]);
}
