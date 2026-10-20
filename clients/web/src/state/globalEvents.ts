/* Document-level click and Escape handling from bindEvents() in
   public/js/app.js: an outside click closes open menus, and Escape closes the
   topmost surface in the old order. */
import {
  chatSurfaces,
  closeActionMenu,
  closeAuthDialog,
  closeConfirmDialog,
  closeConversationMenus,
  closeMobileModeSheet,
  closeModelDropdown,
  closePinnedPopup,
  closeProfileMenu,
  closeRenameDialog,
  closeSearchDialog,
  closeSettings,
  closeTopNativeSurface,
  useApp
} from "./app";
import { closeBetaWelcome } from "./betaWelcome";

function onClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const s = useApp.getState();
  if (s.profileMenuOpen && !target?.closest("#sidebarProfileWrap")) closeProfileMenu();
  if (s.pinnedPopupOpen && !target?.closest("#sidebarPinWrap")) closePinnedPopup();
  if (s.openConversationMenuId && !target?.closest(".conversation-menu-wrap")) closeConversationMenus();
  if (s.spectrumOpen && !target?.closest("#composerModelWrap")) closeModelDropdown();
  if (s.actionMenu && !target?.closest("#composerActionMenu, #writingStyleMenu, #composerActionMenuWrap")) closeActionMenu();
  if (s.modeSheetOpen && !target?.closest("#nativeMobileModeButton, #nativeMobileModeDropdown")) closeMobileModeSheet();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const s = useApp.getState();
  // The phone mode sheet has its own Escape listener in the old code and closes alongside.
  if (s.modeSheetOpen) closeMobileModeSheet();
  if (chatSurfaces.emailMenu()) return;
  if (chatSurfaces.emailEditing()) return;
  if (chatSurfaces.study()) return;
  if (chatSurfaces.skillMenu()) return;
  if (s.profileMenuOpen) return closeProfileMenu();
  if (s.searchOpen) return closeSearchDialog();
  if (s.pinnedPopupOpen) return closePinnedPopup();
  if (s.openConversationMenuId) return closeConversationMenus();
  if (s.rename) return closeRenameDialog();
  if (s.confirm) return closeConfirmDialog();
  if (chatSurfaces.lightbox()) return;
  if (chatSurfaces.viewer()) return;
  if (s.actionMenu) return closeActionMenu();
  if (chatSurfaces.compareDropdown()) return;
  if (s.spectrumOpen) return closeModelDropdown();
  if (s.authOpen) return closeAuthDialog();
  if (s.betaWelcomeOpen) return closeBetaWelcome();
  if (chatSurfaces.guestContinue()) return;
  if (s.settingsOpen) return closeSettings();
}

// setupMobileLayout(): a single horizontal gesture dismisses the top surface.
// Ignore controls that own horizontal dragging (sliders, input, carousels and
// slide galleries). Tables, code blocks and other wide content scroll
// sideways; dragging them back to the left must not read as a back gesture.
// Leaving a chat by an edge swipe is native only.
function inHorizontalScroller(node: EventTarget | null) {
  for (let el = node instanceof Element ? node : (node as Node | null)?.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return (document.scrollingElement?.scrollLeft ?? 0) > 0;
}

let swipe: { x: number; y: number } | null = null;
function onTouchStart(event: TouchEvent) {
  swipe = null;
  const target = event.target as Element | null;
  if (!useApp.getState().mobile || event.touches.length !== 1 || target?.closest?.("input, textarea, [contenteditable], [role=slider], .wallpaper-picker, .deck-gallery, .deck-preset-viewer")) return;
  if (inHorizontalScroller(event.target)) return;
  const touch = event.touches[0]!;
  swipe = { x: touch.clientX, y: touch.clientY };
}

function onTouchEnd(event: TouchEvent) {
  const start = swipe;
  swipe = null;
  if (!start || !event.changedTouches.length) return;
  const touch = event.changedTouches[0]!;
  if (touch.clientX - start.x > 72 && Math.abs(touch.clientY - start.y) < 60) closeTopNativeSurface();
}

let installed = false;
export function installGlobalEvents() {
  if (installed) return;
  installed = true;
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  document.addEventListener("touchcancel", () => { swipe = null; }, { passive: true });
}
