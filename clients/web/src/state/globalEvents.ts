/* Document-level click and Escape handling from bindEvents() in
   public/js/app.js: an outside click closes open menus, and Escape closes the
   topmost surface in the old order. Surfaces from later slices (email menus,
   the study hub, the skill menu, the lightbox, the viewer, compare) join
   these lists in their old positions. */
import {
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
  useApp
} from "./app";

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
  if (s.profileMenuOpen) return closeProfileMenu();
  if (s.searchOpen) return closeSearchDialog();
  if (s.pinnedPopupOpen) return closePinnedPopup();
  if (s.openConversationMenuId) return closeConversationMenus();
  if (s.rename) return closeRenameDialog();
  if (s.confirm) return closeConfirmDialog();
  if (s.actionMenu) return closeActionMenu();
  if (s.spectrumOpen) return closeModelDropdown();
  if (s.authOpen) return closeAuthDialog();
  if (s.settingsOpen) return closeSettings();
}

let installed = false;
export function installGlobalEvents() {
  if (installed) return;
  installed = true;
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
}
