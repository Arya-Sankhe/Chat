/* The packaged app's lifecycle, from public/js/app.js: preferences that
   outlive the WebView's storage, the status bar and text size, Back, resume,
   deep links, Google sign-in's return and the app update dialog. On the web
   every function here returns at once. */
import { SETTINGS_KEY, clampTextScale, parseSettings, resolvedAppearance } from "@klui/shared";
import {
  configureNativeChrome,
  hideNativeKeyboard,
  isNative,
  listenForAuthCallback,
  listenForDeepLinks,
  onResume,
  preferences,
  registerBackButton,
  setTextZoom
} from "../islands/platform/index.js";
import { checkForAppUpdate } from "../islands/platform/updates.js";
import { openAuthDialog, pinnedStorageKey, showAppUpdate, useApp } from "./app";

const get = useApp.getState;
const set = useApp.setState;

/** hydrateNativeSettings(): the app's saved settings win over the WebView's. */
export async function hydrateNativeSettings() {
  if (!isNative()) return;
  const saved = await preferences.get(SETTINGS_KEY).catch(() => null);
  if (!saved) return;
  localStorage.setItem(SETTINGS_KEY, saved);
  set({ settings: parseSettings(saved).settings });
}

/** loadMe()'s half: the pinned chats come back from the app's preferences. */
export async function restoreNativePins() {
  if (!isNative()) return;
  const key = pinnedStorageKey();
  const saved = key ? await preferences.get(key).catch(() => null) : null;
  if (saved) localStorage.setItem(key, saved);
}

/* applyAppearance()/applyTextScale(): the status bar follows light and dark,
   and the WebView's text zoom follows the text size setting. */
export function installNativeChrome() {
  if (!isNative()) return;
  let dark: boolean | null = null;
  let zoom: number | null = null;
  const apply = () => {
    const { settings, systemDark } = get();
    const nextDark = resolvedAppearance(settings, systemDark) === "dark";
    const nextZoom = clampTextScale(settings.uiTextScale);
    if (nextDark !== dark) void configureNativeChrome({ dark: nextDark });
    // A zoom the host did not confirm is tried again on the next change.
    if (nextZoom !== zoom) void setTextZoom(nextZoom).then((ok: boolean) => { if (!ok && zoom === nextZoom) zoom = null; });
    dark = nextDark;
    zoom = nextZoom;
  };
  apply();
  useApp.subscribe(apply);
}

/** Boot's end: the text zoom again. Under load the first call at boot has
   been seen to leave the WebView at 100% (the cause is not pinned down);
   repeating the same value is harmless otherwise. */
export function reassertNativeTextZoom() {
  if (!isNative()) return;
  void setTextZoom(clampTextScale(get().settings.uiTextScale));
}

/* loadBootData(): the app ships its own pages, so it opens with no network.
   Instead of a "Setup required" page with every service missing, it keeps the
   launch screen up and retries until the server answers. */
export async function loadBootData<T>(load: () => Promise<T>): Promise<T> {
  if (!isNative()) return load();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch {
      showLaunchScreenWaiting();
      await waitForConnection(Math.min(1000 * 2 ** attempt, 8000));
    }
  }
}

function showLaunchScreenWaiting() {
  let launch = document.getElementById("mobileLaunchScreen");
  if (!launch) {
    launch = document.createElement("div");
    launch.id = "mobileLaunchScreen";
    launch.innerHTML = `${(window as any).__kluiLaunchMascot || ""}<span>Klui</span>`;
    document.body.append(launch);
  }
  launch.classList.add("waiting");
  let status = launch.querySelector(".launch-status");
  if (!status) {
    status = document.createElement("p");
    status.className = "launch-status";
    status.setAttribute("role", "status");
    launch.append(status);
  }
  status.textContent = navigator.onLine ? "Connecting…" : "No internet connection";
}

export function hideLaunchScreenWaiting() {
  const launch = document.getElementById("mobileLaunchScreen");
  if (!launch?.classList.contains("waiting")) return;
  launch.classList.add("leaving");
  setTimeout(() => launch.remove(), 200);
}

function waitForConnection(delay: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      document.removeEventListener("visibilitychange", onVisible);
      resolve();
    };
    const onVisible = () => { if (document.visibilityState === "visible") done(); };
    const timer = setTimeout(done, delay);
    window.addEventListener("online", done);
    document.addEventListener("visibilitychange", onVisible);
  });
}

/** checkAndShowAppUpdate(): at launch and on every resume. */
export async function checkAndShowAppUpdate() {
  const update = await checkForAppUpdate().catch(() => null);
  if (!update || !document.getElementById("appUpdateDialog")) return;
  if (isNative()) {
    document.getElementById("promptInput")?.blur();
    void hideNativeKeyboard();
  }
  showAppUpdate(update);
}

// An edge swipe can also reach the WebView. Its duplicate native Back is
// dropped so the same gesture cannot close a sheet and then exit the app.
let lastNativeSwipeAt = 0;
export function noteNativeSwipe() {
  lastNativeSwipeAt = Date.now();
}

type Lifecycle = {
  onSession: (session: { access_token: string }) => Promise<void>;
  onResume: () => Promise<void>;
  openConversation: (id: string) => void;
  back: () => Promise<void>;
};

export async function setupNativeLifecycle(handlers: Lifecycle) {
  if (!isNative()) return;
  await listenForAuthCallback(get().config, {
    onSession: handlers.onSession,
    onError: (error: Error) => {
      set({ authNotice: error?.message || "Google sign-in failed." });
      openAuthDialog();
    }
  });
  await onResume(handlers.onResume);
  await listenForDeepLinks((url: URL) => {
    const match = url.pathname.match(/^\/c\/([^/]+)\/?$/);
    if (match) handlers.openConversation(decodeURIComponent(match[1]!));
  });
  await registerBackButton(async () => {
    if (Date.now() - lastNativeSwipeAt < 350) return;
    await handlers.back();
  });
}
