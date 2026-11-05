import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { AUTH_STORAGE_KEY, SETTINGS_KEY, type NativeHostEvent, type NativeHostMethod, type NativeHostReply, type NativeHostRequest } from "@klui/shared";
import { KluiHost } from "../../modules/klui-host";
import { applyAppearance } from "../core/account";
import { signIn } from "../core/auth";
import { prefs } from "../core/prefs";
import { hostedSessionState, session } from "../core/runtime";
import { closeWebSurface, useShell } from "../core/shell";

/* The page's Capacitor plugins, re-implemented over the host bridge (see
   @klui/shared nativeHost.ts). Behaviour follows the old platform/index.js. */

function safeFileName(value: string) {
  return String(value || "download").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "download";
}

function downloadsDir() {
  const dir = new Directory(Paths.cache, "downloads");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// The Capacitor secure-storage plugin saved JSON.stringify(value) and its get()
// parsed that back; the page only ever stored strings.
function legacySecureValue(data: string) {
  try {
    const value = JSON.parse(data);
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return data;
  }
}

/* Installed over the Capacitor app, the first launch carries its session,
   update-check stamp and preferences into the stores above (a value already
   here wins), then drops each old copy once it is safely here. A value that
   cannot be read or written now stays behind for the next launch. */
export async function migrateLegacyStorage() {
  if (Platform.OS !== "android") return;
  let legacy: { secure: Record<string, string>; prefs: Record<string, string> };
  try {
    legacy = await KluiHost.readLegacyStorage();
  } catch (error) {
    console.warn("Could not read the previous app's storage", error);
    return;
  }
  const movedSecure: string[] = [];
  const movedPrefs: string[] = [];
  for (const [key, data] of Object.entries(legacy.secure)) {
    try {
      if ((await SecureStore.getItemAsync(key)) == null) await SecureStore.setItemAsync(key, legacySecureValue(data));
      movedSecure.push(key);
    } catch (error) {
      console.warn(`Could not carry over ${key}`, error);
    }
  }
  const prefKeys = Object.keys(legacy.prefs);
  if (prefKeys.length) {
    try {
      prefs.merge(legacy.prefs);
      movedPrefs.push(...prefKeys);
    } catch (error) {
      console.warn("Could not carry over the previous app's preferences", error);
    }
  }
  if (!movedSecure.length && !movedPrefs.length) return;
  await KluiHost.clearLegacyStorage(movedSecure, movedPrefs).catch((error) => console.warn("Could not drop the previous app's storage", error));
}

/* A link is handed to the page once the page has asked for it, which it does when its
   boot reaches the link handling. Until then it waits here, through sign-in if need be. */
let pendingLink: string | null = null;
let pageListening = false;

export function deliverLink(url: string) {
  if (pageListening) emit({ type: "appUrlOpen", url });
  else pendingLink = url;
}

export const hasPendingLink = () => pendingLink !== null;
export const pageIsListening = () => pageListening;

export function pageGone() {
  pageListening = false;
}

/* A page never reads or replaces the session's tokens directly: it asks (session.*). */
function pageKey(key: string) {
  if (key === AUTH_STORAGE_KEY || key.startsWith("klui.auth.")) throw new Error("The app owns the session.");
  return key;
}

const handlers: { [M in NativeHostMethod]: (args: any) => unknown } = {
  "session.snapshot": () => hostedSessionState(),
  "session.refresh": async ({ force }) => {
    await session.ensureFresh({ force: Boolean(force) });
    return hostedSessionState();
  },
  "session.signOut": () => session.signOut(),
  "session.signIn": () => signIn(),
  "secure.get": ({ key }) => SecureStore.getItemAsync(pageKey(key)),
  "secure.set": ({ key, value }) => SecureStore.setItemAsync(pageKey(key), String(value)),
  "secure.remove": ({ key }) => SecureStore.deleteItemAsync(pageKey(key)),
  "prefs.get": ({ key }) => prefs.get(key),
  "prefs.set": ({ key, value }) => {
    prefs.set(key, String(value));
    if (key === SETTINGS_KEY) applyAppearance();
  },
  "prefs.remove": ({ key }) => prefs.remove(key),
  "browser.open": async ({ url }) => { await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN }); },
  "browser.close": () => { try { WebBrowser.dismissBrowser(); } catch { /* Android closes the tab itself */ } },
  "app.launchUrl": () => {
    pageListening = true;
    // A page that reloaded while hidden missed the event.
    if (!useShell.getState().webVisible) emit({ type: "surfaceVisibility", visible: false });
    const url = pendingLink;
    pendingLink = null;
    return url;
  },
  // At its root the page's Back leaves: that is back to the native screens now.
  "app.exit": () => closeWebSurface(),
  "clipboard.write": ({ text }) => Clipboard.setStringAsync(String(text ?? "")),
  "clipboard.read": async () => (await Clipboard.hasStringAsync()) ? Clipboard.getStringAsync() : "",
  "files.shareText": async ({ fileName, contents, mime }) => {
    const file = new File(downloadsDir(), `${Date.now()}-${safeFileName(fileName)}`);
    await file.write(String(contents ?? ""));
    await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: "Save or open file" });
  },
  "files.shareDownload": async ({ url, fileName }) => {
    const target = new File(downloadsDir(), `${Date.now()}-${safeFileName(fileName)}`);
    const file = await File.downloadFileAsync(url, target);
    await Sharing.shareAsync(file.uri, { dialogTitle: "Save or open file" });
  },
  "http.getBytes": async ({ url }) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return toBase64(await response.arrayBuffer());
  },
  "chrome.configure": ({ dark }) => {
    KluiHost.setSystemBarStyle(Boolean(dark));
    KluiHost.syncSystemBarInsets();
  },
  "view.textZoom": ({ percent }) => KluiHost.setTextZoom(Math.round(Number(percent) || 100)),
  "view.showKeyboard": () => KluiHost.showKeyboard(),
  "view.hideKeyboard": () => KluiHost.hideKeyboard(),
  "email.compose": ({ app, to, subject, body }) => KluiHost.composeEmail(String(app || "mailto"), String(to || ""), String(subject || ""), String(body || "")),
  "voice.start": () => KluiHost.voiceStart(),
  "voice.stop": () => KluiHost.voiceStop()
};

function deliver(script: string) {
  KluiHost.evaluate(script);
}

export function reply(message: NativeHostReply) {
  deliver(`window.__kluiNativeReply&&window.__kluiNativeReply(${JSON.stringify(message)});`);
}

export function emit(event: NativeHostEvent) {
  deliver(`window.__kluiNativeEvent&&window.__kluiNativeEvent(${JSON.stringify(event)});`);
}

export async function handleMessage(data: string) {
  let request: NativeHostRequest;
  try {
    request = JSON.parse(data);
  } catch {
    return;
  }
  const handler = handlers[request.method];
  if (!handler) {
    reply({ id: request.id, ok: false, error: `Unknown native method ${request.method}.` });
    return;
  }
  try {
    const value = await handler(request.args ?? {});
    reply({ id: request.id, ok: true, value: value ?? null });
  } catch (error: any) {
    reply({ id: request.id, ok: false, error: String(error?.message || error), code: error?.code });
  }
}

export function hostInfo() {
  return {
    version: Application.nativeApplicationVersion || "",
    build: Application.nativeBuildVersion || "0"
  };
}
