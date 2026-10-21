import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { BackHandler, Linking, Platform } from "react-native";
import type { NativeHostEvent, NativeHostMethod, NativeHostReply, NativeHostRequest } from "@klui/shared";
import { KluiHost } from "../../modules/klui-host";

/* The page's Capacitor plugins, re-implemented over the host bridge (see
   @klui/shared nativeHost.ts). Behaviour follows the old platform/index.js. */

// Preferences: small values the page keeps across launches, outside secure storage.
const prefsFile = new File(Paths.document, "klui-preferences.json");
let prefsCache: Record<string, string> | null = null;
function prefs(): Record<string, string> {
  if (prefsCache) return prefsCache;
  try {
    prefsCache = prefsFile.exists ? JSON.parse(prefsFile.textSync()) : {};
  } catch {
    prefsCache = {};
  }
  return prefsCache!;
}
function savePrefs() {
  prefsFile.write(JSON.stringify(prefs()));
}

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
      for (const key of prefKeys) if (!(key in prefs())) prefs()[key] = legacy.prefs[key]!;
      savePrefs();
      movedPrefs.push(...prefKeys);
    } catch (error) {
      prefsCache = null; // the file did not take the merge; read it again
      console.warn("Could not carry over the previous app's preferences", error);
    }
  }
  if (!movedSecure.length && !movedPrefs.length) return;
  await KluiHost.clearLegacyStorage(movedSecure, movedPrefs).catch((error) => console.warn("Could not drop the previous app's storage", error));
}

let launchUrlTaken = false;

const handlers: { [M in NativeHostMethod]: (args: any) => unknown } = {
  "secure.get": ({ key }) => SecureStore.getItemAsync(key),
  "secure.set": ({ key, value }) => SecureStore.setItemAsync(key, String(value)),
  "secure.remove": ({ key }) => SecureStore.deleteItemAsync(key),
  "prefs.get": ({ key }) => prefs()[key] ?? null,
  "prefs.set": ({ key, value }) => { prefs()[key] = String(value); savePrefs(); },
  "prefs.remove": ({ key }) => { delete prefs()[key]; savePrefs(); },
  "browser.open": async ({ url }) => { await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN }); },
  "browser.close": () => { try { WebBrowser.dismissBrowser(); } catch { /* Android closes the tab itself */ } },
  "app.launchUrl": async () => {
    if (launchUrlTaken) return null;
    launchUrlTaken = true;
    return Linking.getInitialURL();
  },
  "app.exit": () => BackHandler.exitApp(),
  "clipboard.write": ({ text }) => Clipboard.setStringAsync(String(text ?? "")),
  "clipboard.read": async () => (await Clipboard.hasStringAsync()) ? Clipboard.getStringAsync() : "",
  "files.shareText": async ({ fileName, contents, mime }) => {
    const file = new File(downloadsDir(), `${Date.now()}-${safeFileName(fileName)}`);
    file.write(String(contents ?? ""));
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
