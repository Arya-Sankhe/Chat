/* Startup, ported from bootstrap() and loadChatApp() in public/js/app.js. The
   order, concurrency and render points follow the old code, because what the
   page shows (and how many times the home greeting restarts) depends on them. */
import { api, session } from "../app/runtime";
import { loadPinnedChatIds, renderShell, showToast, useApp } from "./app";

const set = useApp.setState;
const get = useApp.getState;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const conversationIdFromLocation = () => {
  const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
};

/** A sign-in redirect leaves the session in the URL fragment (auth.js parseSessionFromUrl). */
function sessionFromUrl() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  if (!accessToken) return null;
  const expiresAt = Number(hash.get("expires_at")) || Math.floor(Date.now() / 1000) + Number(hash.get("expires_in") || 3600);
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
  return { access_token: accessToken, refresh_token: hash.get("refresh_token"), expires_at: expiresAt, token_type: hash.get("token_type") || "bearer" };
}

function authErrorFromUrl() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const error = hash.get("error_description") || query.get("error_description") || hash.get("error") || query.get("error");
  if (!error) return "";
  query.delete("error");
  query.delete("error_code");
  query.delete("error_description");
  const search = query.toString();
  window.history.replaceState({}, document.title, `${window.location.pathname}${search ? `?${search}` : ""}`);
  return error.replace(/\+/g, " ");
}

export async function loadMe() {
  const me = await api.fetchMe();
  set({ me });
  if (typeof (me as any)?.settings?.systemPrompt === "string") {
    set((s) => ({ settings: { ...s.settings, systemPrompt: (me as any).settings.systemPrompt } }));
  }
  loadPinnedChatIds();
}

let mobileRecentChats: Promise<{ conversations: any[] }> | null = null;

async function loadConversations() {
  const conversations = await api.listConversations();
  const validIds = new Set(conversations.map((conversation) => conversation.id));
  const pinnedChatIds = get().pinnedChatIds.filter((id) => validIds.has(id));
  set({ conversations, pinnedChatIds });
  const key = get().me?.user?.id;
  if (key) localStorage.setItem(`klui.pinnedChats.v1.${key}`, JSON.stringify(pinnedChatIds));
  const routeConversationId = conversationIdFromLocation();
  const active = routeConversationId && validIds.has(routeConversationId) ? routeConversationId : "";
  set({ activeConversationId: active });
  // Opening the routed conversation is the message slice; until then a /c/ route
  // whose chat no longer exists falls back to home, as it does today.
  if (routeConversationId && !active) window.history.replaceState({ conversationId: "" }, "", "/");
}

async function loadProjects() {
  if (!session.current()?.access_token) return set({ projects: [] });
  const payload = await api.listProjects();
  set({ projects: payload.projects || [] });
}

async function loadChatApp() {
  const mobileHome = get().mobile && !conversationIdFromLocation();
  if (mobileHome) {
    const userId = get().me?.user?.id;
    const payload = await (mobileRecentChats || api.listConversations({ limit: 10 }).then((conversations) => ({ conversations })))
      .catch(() => ({ conversations: [] }));
    mobileRecentChats = null;
    set({ conversations: payload.conversations || [] });
    // The complete list only updates navigation, never a chat opened while it loads.
    void api.listConversations().then((all) => {
      if (get().me?.user?.id !== userId || !session.current()) return;
      const current = new Map(get().conversations.map((chat) => [chat.id, chat]));
      for (const chat of all) if (!current.has(chat.id)) current.set(chat.id, chat);
      set({ conversations: [...current.values()] });
    }).catch(() => {});
    await loadProjects();
  } else {
    await Promise.all([loadConversations(), loadProjects()]);
  }
  renderShell();
}

async function loadPaymentRequests() {
  if (!session.current()?.access_token) return;
  await api.fetchPaymentRequests().catch(() => null);
}

/** The web build monitor: a newer deploy shows the "Klui has updated" toast. */
let buildPoll: ReturnType<typeof setInterval> | undefined;
function startWebBuildMonitor() {
  if (buildPoll) return;
  const check = () => {
    if (document.visibilityState !== "visible" || !get().buildId) return;
    void api.fetchBuild().then((payload) => {
      const next = String(payload?.buildId || "");
      if (next && next !== get().buildId) set({ appUpdateAvailable: true });
    }).catch(() => {});
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
  buildPoll = setInterval(check, 5 * 60 * 1000);
  check();
}

export async function bootstrap() {
  try {
    const urlSession = sessionFromUrl();
    const [config, plansPayload] = await Promise.all([api.fetchConfig(), api.fetchPlans()]);
    session.setConfig(config);
    const saved = urlSession ? (await session.save(urlSession), urlSession) : await session.load();
    set({ config, buildId: String((config as any)?.buildId || ""), plans: plansPayload.plans || [] });
    startWebBuildMonitor();
    const authError = authErrorFromUrl();
    if (authError) showToast(authError);
    let signedIn = Boolean(saved);
    if (signedIn) {
      try {
        signedIn = Boolean(await withTimeout(session.ensureFresh(), 8000, "Session refresh"));
      } catch {
        await session.save(null);
        signedIn = false;
      }
    }
    if (signedIn) {
      try {
        if (get().mobile) mobileRecentChats = api.listConversations({ limit: 10 }).then((conversations) => ({ conversations }));
        await withTimeout(loadMe(), 8000, "Account load");
      } catch {
        await session.save(null);
        signedIn = false;
      }
    }
    set({ signedIn });
    renderShell();
    if (signedIn) void loadPaymentRequests();
    if (signedIn && get().me?.access?.active) await loadChatApp();
  } catch (error) {
    set({ signedIn: false, me: null, conversations: [] });
    renderShell();
    showToast((error as Error).message);
  }
}

// A dead refresh token (or another tab signing out) ends the session.
session.subscribe((next) => {
  if (!next && get().signedIn) {
    set({ signedIn: false, me: null, conversations: [], activeConversationId: "", pinnedChatIds: [] });
    renderShell();
  }
});
