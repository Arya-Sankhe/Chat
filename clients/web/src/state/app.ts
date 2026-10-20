/* The shell's UI state: the subset of the current site's `state` object
   (public/js/app.js) that decides what the shell shows. Session tokens live in
   the SessionManager and chat turns in the shared chat controller; this store
   holds what those don't. Actions keep the old function names so each can be
   checked against the function it ports. */
import { create } from "zustand";
import {
  PINNED_CHATS_KEY,
  SETTINGS_KEY,
  DEFAULT_COMPARE_MODELS,
  DEFAULT_COUNCIL_MODELS,
  SPECTRUM_N,
  SPECTRUM_STEPS,
  normalizeWritingStyle,
  type TopBarMode,
  parseSettings,
  type ChatSettings,
  type ConversationSummary,
  type KluiConfig,
  type Me,
  type Plan,
  type Project
} from "@klui/shared";
import { closeCameraSheet } from "./camera";
import { homeModes } from "./homeModes";

export type View = "boot" | "setup" | "paywall" | "chat" | "research";
export type SettingsTab = "general" | "voice" | "memory" | "storage" | "account";
export type OverlayMode = "" | "search" | "settings" | "account" | "confirm" | "rename" | "auth" | "welcome";

export interface AppState {
  config: KluiConfig | null;
  buildId: string;
  plans: Plan[];
  signedIn: boolean;
  me: (Me & { access?: { active?: boolean; mode?: string }; plan?: { name?: string }; usage?: any; subscription?: any }) | null;
  settings: ChatSettings;
  /** isMobileLayout(): the 860px breakpoint (the web build is never native). */
  mobile: boolean;
  /** prefers-color-scheme: dark, for the "system" appearance. */
  systemDark: boolean;
  /** body.chat-empty: no messages and no loading skeleton (renderMessages). */
  chatEmpty: boolean;
  /** The open chat has messages (state.messages.length), published by the chat core. */
  hasMessages: boolean;
  /** A response is streaming in the open chat (state.running). */
  running: boolean;
  /** Chats with a response in flight, and chats whose response finished while away. */
  runningChatIds: string[];
  unreadChatIds: string[];
  view: View;
  conversations: ConversationSummary[];
  projects: Project[];
  activeConversationId: string;
  conversationLoading: boolean;
  pinnedChatIds: string[];
  openConversationMenuId: string;
  temporaryChat: boolean;
  researchMode: boolean;
  /** Desktop rail vs. expanded sidebar. Guests always get it expanded. */
  sidebarExpanded: boolean;
  /** The phone navigation drawer. */
  sidebarOpen: boolean;
  profileMenuOpen: boolean;
  pinnedPopupOpen: boolean;
  /** Skills marked in the prompt (syncComposerSkillState), e.g. ["slides"]. */
  composerSkillIds: string[];
  /** The skills the server offers the composer. */
  composerSkills: { id: string; name?: string }[];
  /** updateSendButton() has run. Until then the send and voice buttons keep
     their markup state: the old app first syncs them when a signed-in chat
     loads, opens or resets, never on the guest home. */
  sendButtonSynced: boolean;
  /** The prompt has text (composerPlainText().trim()). */
  composerHasText: boolean;
  /** The composer's + menu: closed, its two pages, or the styles submenu. */
  actionMenu: "" | "root" | "more" | "style";
  /** The phone mode sheet (top-bar mode picker). */
  modeSheetOpen: boolean;
  /** The model spectrum popover beside the composer. */
  spectrumOpen: boolean;
  searchOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  /** data-mobile-page on the drawer: phones open on an overview of the tabs. Unset until first opened. */
  settingsPage: "" | "overview" | "detail";
  /** What showMobileSettingsOverview() last wrote into the overview's profile. */
  settingsProfile: { name: string; initials: string; plan: string; email: string } | null;
  authOpen: boolean;
  /** #authNotice: why sign-in can't proceed. */
  authNotice: string;
  /** The auth dialog's artwork loads on first open (or when idle for guests). */
  authArtLoaded: boolean;
  /** openDeleteConfirm(): open when set. */
  confirm: { title: string; body: string; confirmLabel: string; chatId: string; onConfirm: (() => Promise<void> | void) | null } | null;
  /** openRenameDialog(): open when set; `onSave` renames something other than a chat. */
  rename: { title: string; value: string; chatId: string; onSave: ((title: string) => Promise<void>) | null } | null;
  overlay: OverlayMode;
  toast: { message: string; visible: boolean };
  appUpdateAvailable: boolean;
  /** Counts renderShell() calls. The old shell rebuilt the home greeting on
     every call, which restarts its animation and draws new random lines, so
     the greeting remounts on each increment to play out the same way. */
  shellRender: number;
}

const settingsFromStorage = () => {
  const raw = localStorage.getItem(SETTINGS_KEY);
  const { settings, migrated } = parseSettings(raw);
  if (migrated) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
};

const mobileQuery = window.matchMedia("(max-width: 860px)");
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export const useApp = create<AppState>(() => ({
  config: null,
  buildId: "",
  plans: [],
  signedIn: false,
  me: null,
  settings: settingsFromStorage(),
  mobile: mobileQuery.matches,
  systemDark: darkQuery.matches,
  // index.html's boot script marks phones' first frame as the empty home.
  chatEmpty: mobileQuery.matches,
  hasMessages: false,
  running: false,
  runningChatIds: [],
  unreadChatIds: [],
  view: "boot",
  conversations: [],
  projects: [],
  activeConversationId: "",
  conversationLoading: false,
  pinnedChatIds: [],
  openConversationMenuId: "",
  temporaryChat: false,
  researchMode: false,
  sidebarExpanded: false,
  sidebarOpen: false,
  profileMenuOpen: false,
  pinnedPopupOpen: false,
  composerSkillIds: [],
  sendButtonSynced: false,
  composerHasText: false,
  composerSkills: [],
  actionMenu: "",
  modeSheetOpen: false,
  spectrumOpen: false,
  searchOpen: false,
  settingsOpen: false,
  settingsTab: "general",
  settingsPage: "",
  settingsProfile: null,
  authOpen: false,
  authNotice: "",
  authArtLoaded: false,
  confirm: null,
  rename: null,
  overlay: "",
  toast: { message: "", visible: false },
  appUpdateAvailable: false,
  shellRender: 0
}));

mobileQuery.addEventListener("change", (event) => useApp.setState({ mobile: event.matches }));
darkQuery.addEventListener("change", (event) => useApp.setState({ systemDark: event.matches }));

const set = useApp.setState;
const get = useApp.getState;

export function updateSetting<K extends keyof ChatSettings>(key: K, value: ChatSettings[K]) {
  const settings = { ...get().settings, [key]: value };
  set({ settings });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/* ─── View switching ─── */

const servicesReady = (config: KluiConfig | null) => {
  const services = (config?.services || {}) as Record<string, unknown>;
  return Boolean(services.supabase && services.access && services.openrouter);
};

export function hasChatAccess() {
  return Boolean(get().me?.access?.active);
}

export function hasUpgradePlans() {
  const { me, plans } = get();
  return me?.access?.mode !== "testing" && Array.isArray(plans) && plans.length > 0;
}

/** renderShell(): picks the view after boot and after sign-in changes. */
export function renderShell() {
  const { signedIn, config } = get();
  set((s) => ({
    shellRender: s.shellRender + 1,
    // Guests always see the expanded sidebar; it stays expanded after sign-in.
    sidebarExpanded: signedIn ? s.sidebarExpanded : true,
    view: servicesReady(config) ? "chat" : "setup",
    ...(signedIn ? {} : { conversations: [], activeConversationId: "" })
  }));
}

/* ─── Toast ─── */

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string) {
  set({ toast: { message, visible: true } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set((s) => ({ toast: { ...s.toast, visible: false } })), 3200);
}

/* ─── Conversations ─── */

const pinnedStorageKey = () => {
  const userId = get().me?.user?.id;
  return userId ? `${PINNED_CHATS_KEY}.${userId}` : "";
};

export function loadPinnedChatIds() {
  const key = pinnedStorageKey();
  if (!key) return set({ pinnedChatIds: [] });
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    set({ pinnedChatIds: Array.isArray(parsed) ? parsed.filter(Boolean) : [] });
  } catch {
    set({ pinnedChatIds: [] });
  }
}

export function savePinnedChatIds(ids: string[] = get().pinnedChatIds) {
  const key = pinnedStorageKey();
  if (key) localStorage.setItem(key, JSON.stringify(ids));
}

export function togglePinChat(id: string) {
  if (!id) return;
  const ids = get().pinnedChatIds;
  const next = ids.includes(id) ? ids.filter((item) => item !== id) : [id, ...ids.filter((item) => item !== id)];
  set({ pinnedChatIds: next, openConversationMenuId: "" });
  savePinnedChatIds(next);
}

export function unpinChat(id: string) {
  const ids = get().pinnedChatIds;
  if (!ids.includes(id)) return;
  const next = ids.filter((item) => item !== id);
  set({ pinnedChatIds: next });
  savePinnedChatIds(next);
}

/** Newest first; project chats live inside their project. */
export function sortedConversations(conversations: ConversationSummary[]) {
  return conversations.filter((conversation) => !conversation.project_id).sort((a, b) => {
    const ta = a.updated_at || a.created_at || "";
    const tb = b.updated_at || b.created_at || "";
    return String(tb).localeCompare(String(ta));
  });
}

export function formatChatAge(iso: string | undefined, now = Date.now()) {
  if (!iso) return "";
  const diff = now - new Date(iso).getTime();
  const day = 86400000;
  if (diff < day) return "Today";
  if (diff < 7 * day) return "Past week";
  if (diff < 30 * day) return "Past month";
  if (diff < 365 * day) return "Past year";
  return "Older";
}

/* ─── Menus and the sidebar ─── */

export function closeConversationMenus() {
  set({ openConversationMenuId: "" });
}

export function toggleConversationMenu(id: string) {
  set((s) => ({ openConversationMenuId: s.openConversationMenuId === id ? "" : id }));
}

export function closeProfileMenu() {
  set({ profileMenuOpen: false });
}

export function closePinnedPopup() {
  set({ pinnedPopupOpen: false });
}

export function togglePinnedPopup() {
  closeConversationMenus();
  closeSearchDialog();
  closeProfileMenu();
  set((s) => ({ pinnedPopupOpen: !s.pinnedPopupOpen }));
}

export function toggleSidebar() {
  dismissComposerKeyboard();
  closeActionMenu();
  closeMobileModeSheet();
  closeProfileMenu();
  closePinnedPopup();
  closeConversationMenus();
  const { mobile, signedIn } = get();
  if (!signedIn && !mobile) return;
  if (mobile) set((s) => ({ sidebarOpen: !s.sidebarOpen }));
  else set((s) => ({ sidebarExpanded: !s.sidebarExpanded }));
}

/* ─── Composer menus ─── */

/** The prompt keeps focus on phones until something else takes the screen. */
export function dismissComposerKeyboard() {
  const input = document.getElementById("promptInput");
  if (input && document.activeElement === input) input.blur();
}

export function closeMobileModeSheet() {
  set({ modeSheetOpen: false });
}

export function toggleMobileModeSheet() {
  const open = !get().modeSheetOpen;
  if (open) { dismissComposerKeyboard(); closeActionMenu(); }
  set({ modeSheetOpen: open });
}

export function closeActionMenu() {
  set({ actionMenu: "" });
}

export function toggleActionMenu() {
  const open = !get().actionMenu;
  if (open) { dismissComposerKeyboard(); closeMobileModeSheet(); }
  set({ actionMenu: open ? "root" : "" });
}

export const openActionMenuRoot = () => set({ actionMenu: "root" });
export const openActionMenuMore = () => set({ actionMenu: "more" });
export const openWritingStyleMenu = () => set({ actionMenu: "style" });

export function setWritingStyle(value: string) {
  updateSetting("writingStyle", normalizeWritingStyle(value));
  closeActionMenu();
  document.getElementById("promptInput")?.focus();
}

export function toggleModelDropdown() {
  set((s) => ({ spectrumOpen: !s.spectrumOpen }));
}

export function closeModelDropdown() {
  set({ spectrumOpen: false });
}

/** applySpectrumLevel(): pick Nitro, Think or Pro. Vision attachments (which
   Nitro can't read) arrive with the attachment slice. */
export function applySpectrumLevel(level: number) {
  const n = Math.max(0, Math.min(SPECTRUM_N - 1, level | 0));
  const step = SPECTRUM_STEPS[n]!;
  const settings = { ...get().settings, spectrumScale: 3, spectrumLevel: n, modelMode: step.mode, thinkingEffort: step.effort, model: step.model };
  set({ settings });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/* Compare and Council (public/js/compare.js, council.js): fixed model sets. */
function updateSettings(patch: Partial<ChatSettings>) {
  const settings = { ...get().settings, ...patch };
  set({ settings });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function activateCompareMode() {
  updateSettings({ compareMode: "compare", compareModels: [...DEFAULT_COMPARE_MODELS], compareEnabled: true });
}

export function cancelCompareMode() {
  updateSettings({ compareEnabled: false, compareModels: [] });
}

/** enterCouncilMode(): Council can't read documents; that check joins with the attachment slice. */
export function enterCouncilMode() {
  updateSettings({ compareMode: "council", compareModels: [...DEFAULT_COUNCIL_MODELS], compareEnabled: true });
  return true;
}

export const isCouncilMode = () => Boolean(get().settings.compareEnabled && get().settings.compareMode === "council");

export function setResearchMode(enabled: boolean) {
  const next = Boolean(enabled);
  if (next && get().temporaryChat) {
    showToast("Deep Research is not available in temporary chat.");
    return;
  }
  set({ researchMode: next });
  if (next && get().settings.compareEnabled) cancelCompareMode();
  closeActionMenu();
  const input = document.getElementById("promptInput");
  if (next || !get().mobile) {
    input?.focus();
    return;
  }
  const composer = input?.closest(".composer");
  if (composer?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
}

/** applyNativeTopBarMode(): the phone mode sheet's choice. */
export function applyNativeTopBarMode(mode: TopBarMode) {
  if (mode === "compare" || mode === "council") {
    if (get().researchMode) setResearchMode(false);
    if (mode === "compare") activateCompareMode();
    else enterCouncilMode();
    return;
  }
  if (get().settings.compareEnabled) cancelCompareMode();
  applySpectrumLevel(mode === "nitro" ? 0 : mode === "pro" ? SPECTRUM_N - 1 : 1);
}

/** Surfaces the chat core owns (islands/chat.js), registered when it mounts.
   Each closes itself and returns true when it was open. */
export const chatSurfaces = {
  emailMenu: () => false,
  emailEditing: () => false,
  lightbox: () => false,
  viewer: () => false,
  guestContinue: () => false
};

/** closeTopNativeSurface(): back gesture, sheet backdrop and Escape close the
   topmost surface first. Returns whether something closed. Surfaces from
   later slices join this list as they arrive, in the old order. */
export function closeTopNativeSurface() {
  if (closeCameraSheet()) return true;
  const deckDialog = document.getElementById("deckPresetDialog") as HTMLDialogElement | null;
  if (deckDialog?.open) { deckDialog.close(); return true; }
  if (homeModes.closePicker()) return true;
  const s = get();
  if (s.modeSheetOpen) { closeMobileModeSheet(); return true; }
  if (s.actionMenu) { closeActionMenu(); return true; }
  if (s.spectrumOpen) { closeModelDropdown(); return true; }
  if (chatSurfaces.lightbox()) return true;
  if (chatSurfaces.viewer()) return true;
  if (s.settingsOpen) { closeSettings(); return true; }
  if (s.authOpen) { closeAuthDialog(); return true; }
  if (chatSurfaces.guestContinue()) return true;
  if (s.confirm) { closeConfirmDialog(); return true; }
  if (s.rename) { closeRenameDialog(); return true; }
  if (s.searchOpen) { closeSearchDialog(); return true; }
  if (s.sidebarOpen) { set({ sidebarOpen: false }); return true; }
  return false;
}

/* ─── Search ─── */

export function openSearchDialog() {
  closePinnedPopup();
  closeConversationMenus();
  closeProfileMenu();
  set({ searchOpen: true, overlay: "search" });
}

export function closeSearchDialog() {
  set((s) => ({ searchOpen: false, overlay: s.overlay === "search" ? "" : s.overlay }));
}

/* ─── Settings ─── */

export function openSettings() {
  dismissComposerKeyboard();
  set({ sidebarOpen: false });
  setSettingsTab("general");
  if (get().mobile) showMobileSettingsOverview();
  set({ settingsOpen: true, overlay: "settings" });
}

/** setSettingsTab(): voice, memory, storage and account load their data with their own slices. */
export function setSettingsTab(tab: string) {
  const selected = (["general", "voice", "memory", "storage", "account"] as const).find((t) => t === tab) || "general";
  const main = document.querySelector("#settingsDrawer .settings-main");
  if (main) main.scrollTop = 0;
  set({ settingsPage: "detail", settingsTab: selected });
}

export function showMobileSettingsOverview() {
  const user = get().me?.user;
  const name = (user?.name as string | undefined) || (user?.email ? user.email.split("@")[0] : "") || "Klui";
  set({
    settingsPage: "overview",
    settingsProfile: {
      name,
      initials: name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
      plan: get().me?.plan?.name ? `${get().me!.plan!.name} plan` : "Free plan",
      email: user?.email || ""
    }
  });
}

export function closeSettings() {
  const drawer = document.getElementById("settingsDrawer");
  if (drawer?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  set((s) => ({ settingsOpen: false, overlay: s.overlay === "settings" ? "" : s.overlay }));
}

export function toggleProfileMenu(openAuthDialog: () => void) {
  const { signedIn, mobile } = get();
  if (!signedIn) return openAuthDialog();
  if (mobile) {
    closeProfileMenu();
    openSettings();
    return;
  }
  set((s) => ({ profileMenuOpen: !s.profileMenuOpen }));
}

/* ─── Auth dialog and drawers ─── */

export function openAuthDialog() {
  set({ authOpen: true, authArtLoaded: true, overlay: "auth" });
}

export function closeAuthDialog() {
  set((s) => ({ authOpen: false, overlay: s.overlay === "auth" ? "" : s.overlay }));
}

/** startSidebarLogin(): the web build always signs in through the dialog. */
export const startSidebarLogin = openAuthDialog;

export function closeAllDrawers() {
  closeSettings();
  closeProfileMenu();
  closeAuthDialog();
  closeConfirmDialog();
  closeRenameDialog();
  closeSearchDialog();
  closePinnedPopup();
  closeConversationMenus();
}

/* ─── Confirm and rename dialogs ─── */

export function openDeleteConfirm({ title, body, chatId = "", onConfirm = null, confirmLabel = "Delete" }: {
  title: string; body: string; chatId?: string; onConfirm?: (() => Promise<void> | void) | null; confirmLabel?: string;
}) {
  closeConversationMenus();
  closePinnedPopup();
  closeProfileMenu();
  set({ confirm: { title, body, chatId, onConfirm, confirmLabel }, overlay: "confirm" });
}

export function openConfirmDialog(chatId: string) {
  const conversation = get().conversations.find((item) => item.id === chatId);
  if (!conversation) return;
  openDeleteConfirm({ title: "Delete chat?", body: `Delete "${conversation.title || "New chat"}" from your account?`, chatId });
}

export function closeConfirmDialog() {
  set((s) => ({
    confirm: null,
    // Back to whichever drawer the dialog opened over.
    overlay: s.overlay === "confirm" ? (s.settingsOpen ? "settings" : "") : s.overlay
  }));
}

export async function confirmPendingDelete(removeConversation: (id: string) => Promise<void>) {
  const pending = get().confirm;
  if (!pending) return;
  if (pending.onConfirm) {
    closeConfirmDialog();
    await pending.onConfirm();
    return;
  }
  if (pending.chatId) await removeConversation(pending.chatId);
}

export function openRenameDialog(chatId: string) {
  const conversation = get().conversations.find((item) => item.id === chatId);
  if (!conversation) return;
  closeConversationMenus();
  closePinnedPopup();
  closeProfileMenu();
  set({ rename: { title: "Rename chat", value: conversation.title || "New chat", chatId, onSave: null }, overlay: "rename" });
}

export function closeRenameDialog() {
  set((s) => ({ rename: null, overlay: s.overlay === "rename" ? "" : s.overlay }));
}

export async function saveRenameDialog(input: string, renameConversation: (id: string, title: string) => Promise<ConversationSummary>) {
  const pending = get().rename;
  if (!pending) return;
  const title = input.trim();
  if (!title) return showToast(pending.onSave ? "Enter a name." : "Enter a chat title.");
  try {
    if (pending.onSave) await pending.onSave(title);
    else {
      const updated = await renameConversation(pending.chatId, title);
      set((s) => ({ conversations: s.conversations.map((item) => (item.id === pending.chatId ? { ...item, ...updated } : item)) }));
    }
    closeRenameDialog();
  } catch (error) {
    showToast((error as Error).message || "Could not rename.");
  }
}
