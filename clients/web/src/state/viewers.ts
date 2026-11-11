/* Two read-only viewers over the chat: an image enlarged (the lightbox) and a
   pasted text shown in full. shell/Lightbox.tsx and PastedTextDialog.tsx draw them. */
import { create } from "zustand";

type Viewers = {
  lightbox: { src: string; caption: string } | null;
  pastedText: string | null;
};

export const useViewers = create<Viewers>(() => ({ lightbox: null, pastedText: null }));

export function openLightbox(src: string, caption = "") {
  useViewers.setState({ lightbox: { src, caption: String(caption || "").trim() } });
}

/** Returns whether it was open (for Escape and the back gesture). */
export function closeLightbox() {
  if (!useViewers.getState().lightbox) return false;
  useViewers.setState({ lightbox: null });
  return true;
}

export function openPastedText(text: unknown) {
  useViewers.setState({ pastedText: String(text || "") });
}

export function closePastedText() {
  useViewers.setState({ pastedText: null });
}
