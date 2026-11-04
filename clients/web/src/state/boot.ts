/* Startup, ported from bootstrap() and loadChatApp() in public/js/app.js. The
   order, concurrency and render points follow the old code, because what the
   page shows (and how many times the home greeting restarts) depends on them. */
import type { HostedSession } from "@klui/shared";
import { api, session, webBuild } from "../app/runtime";
import { configureApiAuth, configureUploadLimit } from "../islands/api.js";
import { isEmbedded, isNative, nativeInfoTarget, onEmbeddedEvents } from "../islands/platform/index.js";
import { chatHooks, closeAuthDialog, handleUpgradeRequired, hasChatAccess, loadPinnedChatIds, openSettings, renderShell, showToast, useApp } from "./app";
import { maybeShowBetaWelcome } from "./betaWelcome";
import { closeGuestContinue, handleNativeBack, handleSessionEnded, loadChatApp, loadPaymentRequests, openNativeConversation, refreshAfterMamoReturn, rejoinTurnsAfterResume, trackPaymentRequests, openRouteResearchReport, prefetchRecentChats, restorePendingDocuments, resumeGuestSend } from "./chat";
import { checkAndShowAppUpdate, hideLaunchScreenWaiting, showLaunchScreenWaiting, hydrateNativeSettings, installNativeChrome, loadBootData, reassertNativeTextZoom, restoreNativePins, setupNativeLifecycle } from "./native";

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

export async function loadMe(init?: RequestInit) {
  const me = await api.fetchMe(init);
  set({ me });
  if (typeof (me as any)?.settings?.systemPrompt === "string") {
    set((s) => ({ settings: { ...s.settings, systemPrompt: (me as any).settings.systemPrompt } }));
  }
  await restoreNativePins();
  loadPinnedChatIds();
  maybeShowBetaWelcome();
}

/** The web build monitor: a newer deploy shows the "Klui has updated" toast. */
let buildPoll: ReturnType<typeof setInterval> | undefined;
// Several stale responses at once share one check.
let buildCheck: Promise<void> | null = null;
// A stale response forces a check even from a hidden tab.
function checkWebBuild({ force = false } = {}) {
  // The app ships its build inside the APK; its updates come from the app update check.
  if (isNative() || !get().buildId || (!force && document.visibilityState !== "visible")) return;
  buildCheck ??= api.fetchBuild().then((payload) => {
    const next = String(payload?.buildId || "");
    if (next && next !== get().buildId) set({ appUpdateAvailable: true });
  }).catch(() => {}).finally(() => { buildCheck = null; });
}

function startWebBuildMonitor() {
  if (isNative() || buildPoll) return;
  const checkWhenVisible = () => checkWebBuild();
  document.addEventListener("visibilitychange", checkWhenVisible);
  window.addEventListener("focus", checkWhenVisible);
  buildPoll = setInterval(checkWhenVisible, 5 * 60 * 1000);
  checkWebBuild();
}

/** refreshAccountAfterResume(): the app came back from the background. */
async function refreshAccountAfterResume() {
  if (session.current()?.access_token) {
    rejoinTurnsAfterResume();
    try {
      await Promise.all([loadMe(), loadPaymentRequests()]);
      renderShell();
    } catch {
      // Normal request/session handling will surface any actionable error.
    }
  }
  await checkAndShowAppUpdate();
}

/* A slow network mustn't turn an embedded page into a guest while the app is signed in.
   It waits on the launch screen and tries again; only the app ends the session. */
async function establishEmbeddedAccount() {
  for (;;) {
    try {
      await withTimeout(session.ensureFresh(), 8000, "Session refresh");
      if (!session.current()) return false;
      // Cancelled, not just abandoned: the browser queues a repeat of a request still open.
      await withTimeout(loadMe({ signal: AbortSignal.timeout(8000) }), 8500, "Account load");
      return true;
    } catch (error) {
      if (!session.current()) return false;
      const status = (error as { status?: number })?.status ?? 0;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        // Waiting won't fix this one: the person decides.
        await showAccountProblem((error as Error).message || "Your account could not be loaded.");
        if (!session.current()) return false;
        continue;
      }
      showLaunchScreenWaiting();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

/** On the launch screen: Try again resolves; Sign out ends the session through the app. */
function showAccountProblem(message: string) {
  showLaunchScreenWaiting();
  const launch = document.getElementById("mobileLaunchScreen")!;
  launch.querySelector(".launch-status")!.textContent = message;
  return new Promise<void>((resolve) => {
    const actions = document.createElement("div");
    actions.className = "launch-actions";
    actions.style.cssText = "display:flex;gap:12px;margin-top:16px;pointer-events:auto";
    const action = (label: string, run: () => void) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText = "min-height:44px;padding:0 18px;border-radius:22px;border:1px solid currentColor;background:none;color:inherit;font:inherit";
      button.onclick = () => {
        actions.remove();
        run();
      };
      actions.append(button);
    };
    action("Try again", resolve);
    action("Sign out", () => void session.signOut().finally(resolve));
    launch.append(actions);
  });
}

let bootFinished = false;

export async function bootstrap() {
  await hydrateNativeSettings();
  installNativeChrome();
  try {
    const urlSession = sessionFromUrl();
    const [config, plansPayload] = await loadBootData(() => Promise.all([api.fetchConfig(), api.fetchPlans()]));
    session.setConfig(config);
    configureUploadLimit(config);
    const saved = urlSession ? (await session.save(urlSession), urlSession) : await session.load();
    set({
      config,
      buildId: String((config as any)?.buildId || ""),
      plans: plansPayload.plans || [],
      composerSkills: Array.isArray((config as any)?.skills) ? (config as any).skills : []
    });
    await setupNativeLifecycle({
      onSession: handleAuthenticatedSession,
      onResume: refreshAccountAfterResume,
      openConversation: openNativeConversation,
      back: handleNativeBack
    });
    webBuild.id = get().buildId;
    webBuild.check = () => checkWebBuild({ force: true });
    // The chat core's API client (the old api.js) reads and refreshes the same session.
    configureApiAuth({
      getSession: () => session.current(),
      onUpgradeRequired: handleUpgradeRequired,
      refresh: (_current: unknown, options: { force?: boolean }) => session.ensureFresh(options),
      buildCheck: () => checkWebBuild({ force: true }),
      buildId: get().buildId
    });
    startWebBuildMonitor();
    const authError = authErrorFromUrl();
    if (authError) showToast(authError);
    // A Google sign-in that relaunched the app finishes during setupNativeLifecycle().
    let signedIn = Boolean(saved || session.current());
    if (signedIn && isEmbedded()) {
      signedIn = await establishEmbeddedAccount();
    } else if (signedIn) {
      try {
        signedIn = Boolean(await withTimeout(session.ensureFresh(), 8000, "Session refresh"));
      } catch {
        await session.save(null);
        signedIn = false;
      }
    }
    if (signedIn && !isEmbedded()) {
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
    hideLaunchScreenWaiting();
    // Guests are likely to open the sign-in dialog: fetch its art when idle.
    whenIdle(() => {
      if (!get().signedIn) set({ authArtLoaded: true });
    });
    if (signedIn) trackPaymentRequests();
    await refreshAfterMamoReturn();
    if (signedIn && hasChatAccess()) {
      await loadChatApp();
      await restorePendingDocuments();
      await openRouteResearchReport();
    }
    reassertNativeTextZoom();
    void checkAndShowAppUpdate();
    if (isEmbedded()) openEmbeddedTarget(nativeInfoTarget());
  } catch (error) {
    set({ signedIn: false, me: null, conversations: [] });
    renderShell();
    showToast((error as Error).message);
  }
  bootFinished = true;
  // The app signed in while this boot was already going as a guest.
  if (isEmbedded() && session.current() && !get().signedIn) void afterSignIn();
}

/** What the native app asked this surface to show. */
function openEmbeddedTarget(target: string | undefined) {
  if (target === "dojo") chatHooks.openStudyHub();
  else if (target === "plans") chatHooks.openUpgradePlans();
  else if (target === "settings") openSettings();
  else if (target === "voice") document.getElementById("voiceModeButton")?.click();
}

if (isEmbedded()) {
  onEmbeddedEvents({
    onSession: (next: Parameters<HostedSession["update"]>[0]) => {
      const wasGuest = !session.current();
      (session as HostedSession).update(next);
      // Signed in from this page as a guest: it carries on, sending what they wrote.
      // During boot, bootstrap's own end picks this up.
      if (bootFinished && wasGuest && session.current()) void afterSignIn();
    },
    onTarget: openEmbeddedTarget
  });
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
  await afterSignIn();
}

/** handleAuthenticatedSession(): the packaged app's Google sign-in returns a session. */
async function handleAuthenticatedSession(next: { access_token: string }) {
  if (!next?.access_token) return;
  await session.save(next as any);
  await afterSignIn();
}

async function afterSignIn() {
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
