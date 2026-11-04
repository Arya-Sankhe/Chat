// public/js/platform/index.js for the new client. On the website isNative() is
// false and every export keeps its web branch. In the packaged app (the Expo
// host's WebView) the Capacitor plugins the old app called are host bridge
// methods instead (nativeHost.js); each native branch follows the old one.
import { nativeCall, nativeInfo, onNativeEvent } from "./nativeHost.js";

const API_ORIGIN = String(nativeInfo?.apiOrigin || "https://klui.ai").replace(/\/+$/, "");
const AUTH_CALLBACK_URL = String(nativeInfo?.authCallback || "tech.klui.app://auth/callback");
const AUTH_STORAGE_KEY = "klui.auth.v1";

export function isNative() {
  return Boolean(nativeInfo);
}

export function isEmbedded() {
  return nativeInfo?.embedded === true;
}

export function nativeInfoTarget() {
  return nativeInfo?.startTarget;
}

export function onEmbeddedEvents({ onSession, onTarget }) {
  onNativeEvent("sessionChanged", ({ generation, session }) => onSession({ generation, session }));
  // Hidden behind the native screens: the page keeps its state but stops being in use.
  onNativeEvent("surfaceVisibility", ({ visible }) => {
    if (visible) return;
    document.activeElement?.blur?.();
    for (const media of document.querySelectorAll("audio, video")) media.pause();
  });
  onNativeEvent("openTarget", (event) => onTarget(event.target));
}

export const sessionHost = {
  snapshot: () => nativeCall("session.snapshot"),
  refresh: (force) => nativeCall("session.refresh", { force }),
  signOut: () => nativeCall("session.signOut")
};

export function nativePlatform() {
  return nativeInfo?.platform || "web";
}

export function apiOrigin() {
  return isNative() ? API_ORIGIN : "";
}

export function apiUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  return `${apiOrigin()}${value.startsWith("/") ? value : `/${value}`}`;
}

export const storage = {
  async get(key) {
    if (!isNative()) return globalThis.localStorage?.getItem(key) ?? null;
    try {
      return await nativeCall("secure.get", { key });
    } catch {
      return null;
    }
  },
  async set(key, value) {
    if (!isNative()) {
      globalThis.localStorage?.setItem(key, String(value));
      return;
    }
    await nativeCall("secure.set", { key, value: String(value) });
  },
  async remove(key) {
    if (!isNative()) {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await nativeCall("secure.remove", { key }).catch(() => {});
  }
};

export const preferences = {
  async get(key) {
    if (!isNative()) return globalThis.localStorage?.getItem(key) ?? null;
    return nativeCall("prefs.get", { key });
  },
  async set(key, value) {
    if (!isNative()) {
      globalThis.localStorage?.setItem(key, String(value));
      return;
    }
    await nativeCall("prefs.set", { key, value: String(value) });
  },
  async remove(key) {
    if (!isNative()) {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await nativeCall("prefs.remove", { key });
  }
};

let nativeSupabaseClient = null;

const pkceStorage = {
  getItem: (key) => key.endsWith("-code-verifier") ? storage.get(key) : null,
  setItem: (key, value) => key.endsWith("-code-verifier") ? storage.set(key, value) : undefined,
  removeItem: (key) => key.endsWith("-code-verifier") ? storage.remove(key) : undefined
};

async function supabaseClient(config) {
  if (nativeSupabaseClient) return nativeSupabaseClient;
  const { createClient } = await import("@supabase/supabase-js");
  nativeSupabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: false,
      storage: pkceStorage
    }
  });
  return nativeSupabaseClient;
}

let googleSignInPromise = null;

export async function signInWithGoogle(config) {
  if (!isNative()) return null;
  if (isEmbedded()) {
    await nativeCall("session.signIn");
    return null;
  }
  // Guard against concurrent sign-in attempts. Multiple PKCE flows
  // overwrite each other's code verifier in storage, causing the OAuth
  // callback to fail when the code verifier doesn't match the original
  // request. Return the same promise for any concurrent callers.
  if (googleSignInPromise) return googleSignInPromise;
  googleSignInPromise = (async () => {
    try {
      const client = await supabaseClient(config);
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: AUTH_CALLBACK_URL,
          skipBrowserRedirect: true,
          queryParams: {
            prompt: "select_account"
          }
        }
      });
      if (error) throw error;
      if (!data?.url) throw new Error("Google sign-in could not be started.");
      await nativeCall("browser.open", { url: data.url });
      return null;
    } finally {
      googleSignInPromise = null;
    }
  })();
  return googleSignInPromise;
}

async function sessionFromCallback(config, callbackUrl) {
  const parsed = parseAuthCallbackUrl(callbackUrl);
  if (parsed?.error) throw new Error(parsed.error);
  const code = parsed?.code;
  if (!code) return null;
  const client = await supabaseClient(config);
  const { data, error: exchangeError } = await client.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
  const session = data?.session;
  if (!session?.access_token) throw new Error("Google sign-in did not return a session.");
  const normalized = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    token_type: session.token_type || "bearer"
  };
  await storage.set(AUTH_STORAGE_KEY, JSON.stringify(normalized));
  await nativeCall("browser.close").catch(() => {});
  return normalized;
}

export function parseAuthCallbackUrl(value) {
  if (!String(value || "").startsWith(AUTH_CALLBACK_URL)) return null;
  const url = new URL(value);
  const params = new URLSearchParams([
    ...new URLSearchParams(url.hash.replace(/^#/, "")),
    ...url.searchParams
  ]);
  const errorCode = params.get("error_code") || params.get("error") || "";
  const errorDescription = params.get("error_description") || "";
  let error = errorDescription || errorCode;
  if (/redirect/i.test(error)) {
    error = `Google sign-in redirect is not configured. Add ${AUTH_CALLBACK_URL} to Supabase Auth redirect URLs.`;
  }
  return {
    code: params.get("code") || "",
    error
  };
}

// The URL that launched the app, read once and shared by the auth and deep
// link listeners (Capacitor's App.getLaunchUrl answered both).
let launchUrl = null;
function getLaunchUrl() {
  launchUrl ??= nativeCall("app.launchUrl").catch(() => null);
  return launchUrl;
}

export async function listenForAuthCallback(config, { onSession, onError } = {}) {
  if (!isNative()) return () => {};
  const handledUrls = new Set();
  const handleUrl = async (value) => {
    if (!String(value || "").startsWith(AUTH_CALLBACK_URL)) return;
    if (handledUrls.has(value)) return;
    handledUrls.add(value);
    try {
      const session = await sessionFromCallback(config, value);
      if (session) await onSession?.(session);
    } catch (error) {
      onError?.(error);
    }
  };
  const listener = onNativeEvent("appUrlOpen", (event) => handleUrl(event.url));
  const launch = await getLaunchUrl();
  if (launch) await handleUrl(launch);
  return () => listener.remove();
}

export async function listenForDeepLinks(callback) {
  if (!isNative()) return () => {};
  const handleUrl = (value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || !new Set(["klui.ai", "klui.tech"]).has(url.hostname)) return;
    callback?.(url);
  };
  const listener = onNativeEvent("appUrlOpen", (event) => {
    try {
      handleUrl(event.url);
    } catch {
      // Ignore malformed external URLs.
    }
  });
  const launch = await getLaunchUrl();
  if (launch) {
    try {
      handleUrl(launch);
    } catch {
      // Ignore malformed launch URLs.
    }
  }
  return () => listener.remove();
}

export async function openExternal(url) {
  if (!url) return;
  if (!isNative()) {
    globalThis.open?.(url, "_blank", "noopener");
    return;
  }
  await nativeCall("browser.open", { url });
}

export async function saveTextFile(fileName, contents, mime = "application/json") {
  if (!isNative()) {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    try {
      await download(url, fileName);
    } finally {
      URL.revokeObjectURL(url);
    }
    return;
  }
  await nativeCall("files.shareText", { fileName, contents: String(contents || ""), mime });
}

export async function download(url, fileName = "download") {
  if (!isNative()) {
    const anchor = document.createElement("a");
    anchor.href = url;
    // No target="_blank": the signed URL already answers with Content-Disposition: attachment, so
    // the browser saves it in place instead of flashing open (and closing) a blank tab.
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }
  await nativeCall("files.shareDownload", { url, fileName });
}

export async function copyText(value) {
  if (!isNative()) {
    await navigator.clipboard.writeText(String(value || ""));
    return;
  }
  await nativeCall("clipboard.write", { text: String(value || "") });
}

export async function readClipboardText() {
  if (!isNative()) return navigator.clipboard.readText();
  return nativeCall("clipboard.read");
}

export async function appVersion() {
  if (!isNative()) return { version: "", build: "0" };
  return { version: String(nativeInfo.version || ""), build: String(nativeInfo.build || "0") };
}

export async function onResume(callback) {
  if (!isNative()) return () => {};
  const listener = onNativeEvent("appStateChange", ({ isActive }) => {
    if (isActive) callback?.();
  });
  return () => listener.remove();
}

export async function configureNativeChrome({ dark = false } = {}) {
  if (!isNative()) return;
  // Transparent bars over the page (the host is edge to edge); the page's
  // safe-area padding keeps its top bar clear of the clock.
  await nativeCall("chrome.configure", { dark }).catch(() => {});
}

// Fallback for signed storage links the WebView (https://localhost) cannot
// read because of CORS. Native HTTP has no CORS but buffers the whole file.
export async function fetchNativeBytes(url) {
  const base64 = await nativeCall("http.getBytes", { url });
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* Voice mode holds a native foreground service while it is on, so the
   conversation keeps listening and speaking with the app in the background.
   Each hold resolves { running, stop }: `running` says whether Android let the
   service start, and only the newest hold can stop it, so a late stop from an
   earlier conversation never ends the current one. `onEnd` runs when the user
   taps End on the notification. */
export function createVoiceKeepAlive(loadPlugin) {
  let owner = 0;
  let holds = 0;
  return async function hold({ onEnd } = {}) {
    const id = ++holds;
    owner = id;
    let plugin = null;
    let listener = null;
    let running = false;
    try {
      plugin = await loadPlugin();
      if (owner === id) {
        listener = await plugin.addListener("end", () => { if (owner === id) onEnd?.(); });
        running = owner === id && Boolean((await plugin.start())?.running);
      }
    } catch {
      running = false;
    }
    return {
      running,
      stop() {
        void listener?.remove();
        listener = null;
        if (owner !== id) return;
        owner = 0;
        void plugin?.stop().catch(() => {});
      }
    };
  };
}

const voiceSessionPlugin = {
  addListener: async (_event, callback) => onNativeEvent("voiceEnd", () => callback()),
  start: () => nativeCall("voice.start"),
  stop: () => nativeCall("voice.stop")
};
const holdVoiceSession = createVoiceKeepAlive(async () => voiceSessionPlugin);

/* On the web this does nothing and reports running, so callers never warn. */
export async function keepVoiceSessionAlive(options) {
  if (!isNative()) return { running: true, stop() {} };
  return holdVoiceSession(options);
}

/** Resolves true once the host has applied the zoom; never throws. */
export async function setTextZoom(percent) {
  if (!isNative()) return false;
  // Never block the UI on this; the default 100% size stays.
  return nativeCall("view.textZoom", { percent: Math.round(percent) }).then(() => true, () => false);
}

export async function showNativeKeyboard() {
  if (!isNative()) return;
  await nativeCall("view.showKeyboard");
}

// When the page last closed the keyboard on purpose (menus, sheets,
// navigation). The temporary chat home reopens it after any other dismissal.
let intentionalKeyboardHideAt = 0;
export const keyboardHiddenOnPurposeAt = () => intentionalKeyboardHideAt;

export async function hideNativeKeyboard() {
  if (!isNative()) return;
  intentionalKeyboardHideAt = Date.now();
  await nativeCall("view.hideKeyboard").catch(() => {});
}

// Opens the draft in the mail app itself. Returns false on the web, or when
// that app isn't installed.
export async function composeEmailNatively(app, { to = "", subject = "", body = "" } = {}) {
  if (!isNative()) return false;
  try {
    await nativeCall("email.compose", { app, to, subject, body });
    return true;
  } catch {
    return false;
  }
}

export async function registerBackButton(handler) {
  if (!isNative()) return () => {};
  const listener = onNativeEvent("backButton", () => handler());
  return () => listener.remove();
}

export async function exitApp() {
  if (!isNative()) return;
  await nativeCall("app.exit");
}
