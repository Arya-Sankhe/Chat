const API_ORIGIN = String(import.meta.env?.VITE_KLUI_API_ORIGIN || "https://klui.tech").replace(/\/+$/, "");
const AUTH_CALLBACK_URL = "tech.klui.app://auth/callback";
const AUTH_STORAGE_KEY = "klui.auth.v1";

function capacitorRuntime() {
  return globalThis.Capacitor;
}

export function isNative() {
  return Boolean(capacitorRuntime()?.isNativePlatform?.());
}

export function apiOrigin() {
  return isNative() ? API_ORIGIN : "";
}

export function apiUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  return `${apiOrigin()}${value.startsWith("/") ? value : `/${value}`}`;
}

async function secureStorage() {
  const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
  return SecureStorage;
}

export const storage = {
  async get(key) {
    if (!isNative()) return globalThis.localStorage?.getItem(key) ?? null;
    try {
      return await (await secureStorage()).get(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    if (!isNative()) {
      globalThis.localStorage?.setItem(key, String(value));
      return;
    }
    await (await secureStorage()).set(key, String(value));
  },
  async remove(key) {
    if (!isNative()) {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await (await secureStorage()).remove(key).catch(() => {});
  }
};

export const preferences = {
  async get(key) {
    if (!isNative()) return globalThis.localStorage?.getItem(key) ?? null;
    const { Preferences } = await import("@capacitor/preferences");
    return (await Preferences.get({ key })).value;
  },
  async set(key, value) {
    if (!isNative()) {
      globalThis.localStorage?.setItem(key, String(value));
      return;
    }
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value: String(value) });
  },
  async remove(key) {
    if (!isNative()) {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key });
  }
};

let nativeSupabaseClient = null;

async function supabaseClient(config) {
  if (nativeSupabaseClient) return nativeSupabaseClient;
  const { createClient } = await import("@supabase/supabase-js");
  nativeSupabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: false,
      autoRefreshToken: false,
      storage: {
        getItem: (key) => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.remove(key)
      }
    }
  });
  return nativeSupabaseClient;
}

export async function signInWithGoogle(config) {
  if (!isNative()) return null;
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
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: data.url, presentationStyle: "fullscreen" });
  return null;
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
  const { Browser } = await import("@capacitor/browser");
  await Browser.close().catch(() => {});
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
    error = "Google sign-in redirect is not configured. Add tech.klui.app://auth/callback to Supabase Auth redirect URLs.";
  }
  return {
    code: params.get("code") || "",
    error
  };
}

export async function listenForAuthCallback(config, { onSession, onError } = {}) {
  if (!isNative()) return () => {};
  const { App } = await import("@capacitor/app");
  const handleUrl = async (value) => {
    if (!String(value || "").startsWith(AUTH_CALLBACK_URL)) return;
    try {
      const session = await sessionFromCallback(config, value);
      if (session) await onSession?.(session);
    } catch (error) {
      onError?.(error);
    }
  };
  const listener = await App.addListener("appUrlOpen", (event) => handleUrl(event.url));
  const launch = await App.getLaunchUrl();
  if (launch?.url) await handleUrl(launch.url);
  return () => listener.remove();
}

export async function listenForDeepLinks(callback) {
  if (!isNative()) return () => {};
  const { App } = await import("@capacitor/app");
  const handleUrl = (value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "klui.tech") return;
    callback?.(url);
  };
  const listener = await App.addListener("appUrlOpen", (event) => {
    try {
      handleUrl(event.url);
    } catch {
      // Ignore malformed external URLs.
    }
  });
  const launch = await App.getLaunchUrl();
  if (launch?.url) {
    try {
      handleUrl(launch.url);
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
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url, presentationStyle: "fullscreen" });
}

function safeFileName(value) {
  return String(value || "download")
    .replace(/[^\w.\- ]+/g, "_")
    .slice(0, 120) || "download";
}

export async function download(url, fileName = "download") {
  if (!isNative()) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    anchor.target = "_blank";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }
  const [{ Filesystem, Directory }, { FileTransfer }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/file-transfer"),
    import("@capacitor/share")
  ]);
  const path = `downloads/${Date.now()}-${safeFileName(fileName)}`;
  await Filesystem.mkdir({ path: "downloads", directory: Directory.Cache, recursive: true }).catch(() => {});
  const target = await Filesystem.getUri({ path, directory: Directory.Cache });
  const result = await FileTransfer.downloadFile({ url, path: target.uri });
  await Share.share({
    title: fileName,
    url: result.path || target.uri,
    dialogTitle: "Save or open file"
  });
}

export async function copyText(value) {
  if (!isNative()) {
    await navigator.clipboard.writeText(String(value || ""));
    return;
  }
  const { Clipboard } = await import("@capacitor/clipboard");
  await Clipboard.write({ string: String(value || "") });
}

export async function appVersion() {
  if (!isNative()) return { version: "", build: "0" };
  const { App } = await import("@capacitor/app");
  return App.getInfo();
}

export async function onResume(callback) {
  if (!isNative()) return () => {};
  const { App } = await import("@capacitor/app");
  const listener = await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) callback?.();
  });
  return () => listener.remove();
}

export async function configureNativeChrome({ dark = false, background = "#ffffff" } = {}) {
  if (!isNative()) return;
  const [{ StatusBar, Style }, { Keyboard, KeyboardResize }] = await Promise.all([
    import("@capacitor/status-bar"),
    import("@capacitor/keyboard")
  ]);
  await Promise.all([
    StatusBar.setStyle({ style: dark ? Style.Light : Style.Dark }),
    StatusBar.setBackgroundColor({ color: background }),
    StatusBar.setOverlaysWebView({ overlay: false }),
    Keyboard.setResizeMode({ mode: KeyboardResize.Native })
  ]).catch(() => {});
}

export async function registerBackButton(handler) {
  if (!isNative()) return () => {};
  const { App } = await import("@capacitor/app");
  const listener = await App.addListener("backButton", handler);
  return () => listener.remove();
}

export async function exitApp() {
  if (!isNative()) return;
  const { App } = await import("@capacitor/app");
  await App.exitApp();
}
