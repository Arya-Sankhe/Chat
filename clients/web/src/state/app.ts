/* The shell's UI state: the subset of the current site's `state` object
   (public/js/app.js) that decides what the shell shows. Session tokens live in
   the SessionManager and chat turns in the shared chat controller; this store
   holds what those don't. Actions keep the old function names so each can be
   checked against the function it ports. */
import { create } from "zustand";
import {
  PINNED_CHATS_KEY,
  SETTINGS_KEY,
  parseSettings,
  type ChatSettings,
  type ConversationSummary,
  type KluiConfig,
  type Me,
  type Plan,
  type Project
} from "@klui/shared";

export type View = "boot" | "setup" | "paywall" | "chat" | "research";
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
  searchOpen: boolean;
  settingsOpen: boolean;
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
  searchOpen: false,
  settingsOpen: false,
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
    // Until the message slice lands, a routed chat shows its loading skeleton.
    chatEmpty: !(signedIn && s.activeConversationId),
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

function savePinnedChatIds(ids: string[]) {
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
  // dismissComposerKeyboard / closeActionMenu / closeMobileModeSheet: composer slice.
  closeProfileMenu();
  closePinnedPopup();
  closeConversationMenus();
  const { mobile, signedIn } = get();
  if (!signedIn && !mobile) return;
  if (mobile) set((s) => ({ sidebarOpen: !s.sidebarOpen }));
  else set((s) => ({ sidebarExpanded: !s.sidebarExpanded }));
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
  set({ sidebarOpen: false, settingsOpen: true, overlay: "settings" });
}

export function closeSettings() {
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
