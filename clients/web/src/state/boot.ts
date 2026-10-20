/* Startup, ported from bootstrap() and loadChatApp() in public/js/app.js. The
   order, concurrency and render points follow the old code, because what the
   page shows (and how many times the home greeting restarts) depends on them. */
import { api, session, webBuild } from "../app/runtime";
import { configureApiAuth, configureUploadLimit } from "../islands/api.js";
import { closeAuthDialog, hasChatAccess, loadPinnedChatIds, renderShell, showToast, useApp } from "./app";
import { maybeShowBetaWelcome } from "./betaWelcome";
import { closeGuestContinue, handleSessionEnded, loadChatApp, loadPaymentRequests, refreshAfterMamoReturn, trackPaymentRequests, openRouteResearchReport, prefetchRecentChats, restorePendingDocuments, resumeGuestSend } from "./chat";

const set = useApp.setState;
const get = useApp.getState;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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

function whenIdle(callback: () => void) {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(callback, { timeout: 4000 });
  else setTimeout(callback, 2500);
}

export async function loadMe() {
  const me = await api.fetchMe();
  set({ me });
  if (typeof (me as any)?.settings?.systemPrompt === "string") {
    set((s) => ({ settings: { ...s.settings, systemPrompt: (me as any).settings.systemPrompt } }));
  }
  loadPinnedChatIds();
  maybeShowBetaWelcome();
}

/** The web build monitor: a newer deploy shows the "Klui has updated" toast. */
let buildPoll: ReturnType<typeof setInterval> | undefined;
// Several stale responses at once share one check.
let buildCheck: Promise<void> | null = null;
// A stale response forces a check even from a hidden tab.
function checkWebBuild({ force = false } = {}) {
  if (!get().buildId || (!force && document.visibilityState !== "visible")) return;
  buildCheck ??= api.fetchBuild().then((payload) => {
    const next = String(payload?.buildId || "");
    if (next && next !== get().buildId) set({ appUpdateAvailable: true });
  }).catch(() => {}).finally(() => { buildCheck = null; });
}

function startWebBuildMonitor() {
  if (buildPoll) return;
  const checkWhenVisible = () => checkWebBuild();
  document.addEventListener("visibilitychange", checkWhenVisible);
  window.addEventListener("focus", checkWhenVisible);
  buildPoll = setInterval(checkWhenVisible, 5 * 60 * 1000);
  checkWebBuild();
}

export async function bootstrap() {
  try {
    const urlSession = sessionFromUrl();
    const [config, plansPayload] = await Promise.all([api.fetchConfig(), api.fetchPlans()]);
    session.setConfig(config);
    configureUploadLimit(config);
    const saved = urlSession ? (await session.save(urlSession), urlSession) : await session.load();
    set({
      config,
      buildId: String((config as any)?.buildId || ""),
      plans: plansPayload.plans || [],
      composerSkills: Array.isArray((config as any)?.skills) ? (config as any).skills : []
    });
    webBuild.id = get().buildId;
    webBuild.check = () => checkWebBuild({ force: true });
    // The chat core's API client (the old api.js) reads and refreshes the same session.
    configureApiAuth({
      getSession: () => session.current(),
      refresh: (_current: unknown, options: { force?: boolean }) => session.ensureFresh(options),
      buildCheck: () => checkWebBuild({ force: true }),
      buildId: get().buildId
    });
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
        if (get().mobile) prefetchRecentChats(api.listConversations({ limit: 10 }).then((conversations) => ({ conversations })).catch(() => ({ conversations: [] })));
        await withTimeout(loadMe(), 8000, "Account load");
      } catch {
        await session.save(null);
        signedIn = false;
      }
    }
    set({ signedIn });
    renderShell();
    // Guests are likely to open the sign-in dialog: fetch its art when idle.
    whenIdle(() => {
      if (!get().signedIn) set({ authArtLoaded: true });
    });
    if (signedIn) trackPaymentRequests();
    await refreshAfterMamoReturn();
    if (signedIn && get().me?.access?.active) {
      await loadChatApp();
      await restorePendingDocuments();
      await openRouteResearchReport();
    }
  } catch (error) {
    set({ signedIn: false, me: null, conversations: [] });
    renderShell();
    showToast((error as Error).message);
  }
}

// A dead refresh token (or another tab signing out) ends the session.
session.subscribe((next) => {
  if (!next) handleSessionEnded();
  if (!next && get().signedIn) {
    set({ signedIn: false, me: null, conversations: [], activeConversationId: "", pinnedChatIds: [] });
    renderShell();
  }
});

/** handleAuthenticatedSession(): after Google sign-in completes. */
export async function signInWithGoogleCredential(credential: string) {
  try {
    if (!credential) throw new Error("Google did not return a sign-in token.");
    await session.signInWithGoogleIdToken(credential);
  } catch (error) {
    set({ authNotice: (error as Error).message || "Google sign-in failed." });
    return;
  }
  set({ signedIn: true, authNotice: "" });
  closeAuthDialog();
  closeGuestContinue();
  renderShell();
  try {
    await withTimeout(loadMe(), 8000, "Account load");
    await loadPaymentRequests();
    renderShell();
    if (hasChatAccess()) {
      await loadChatApp();
      await restorePendingDocuments();
      await resumeGuestSend();
    } else {
      closeGuestContinue();
    }
  } catch (error) {
    const notice = (error as Error)?.message || "Signed in, but your account could not be loaded.";
    set({ authNotice: notice });
    showToast(notice);
  }
}
