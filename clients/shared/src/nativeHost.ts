/* The contract between the packaged app's native host (Expo) and the web
   client running in its WebView. The page calls the host with
   `KluiNativeHost.postMessage(JSON.stringify(request))`; the host answers with
   `window.__kluiNativeReply(reply)` and pushes events with
   `window.__kluiNativeEvent(event)`. These are the capabilities the Capacitor
   plugins gave the old app (platform/index.js), one method each. */

/** Set on window.__kluiNative before the page's own scripts run. */
export type NativeHostInfo = {
  platform: "android" | "ios";
  /** The API the page talks to (the page itself is https://localhost). */
  apiOrigin: string;
  /** The OAuth redirect this build's URL scheme receives. */
  authCallback: string;
  version: string;
  build: string;
};

export type NativeHostMethods = {
  "secure.get": (args: { key: string }) => string | null;
  "secure.set": (args: { key: string; value: string }) => void;
  "secure.remove": (args: { key: string }) => void;
  "prefs.get": (args: { key: string }) => string | null;
  "prefs.set": (args: { key: string; value: string }) => void;
  "prefs.remove": (args: { key: string }) => void;
  "browser.open": (args: { url: string }) => void;
  "browser.close": (args: Record<string, never>) => void;
  /** The URL that launched the app, once. */
  "app.launchUrl": (args: Record<string, never>) => string | null;
  "app.exit": (args: Record<string, never>) => void;
  "clipboard.write": (args: { text: string }) => void;
  "clipboard.read": (args: Record<string, never>) => string;
  "files.shareText": (args: { fileName: string; contents: string; mime: string }) => void;
  "files.shareDownload": (args: { url: string; fileName: string }) => void;
  /** Bytes of a URL the page can't read because of CORS, as base64. */
  "http.getBytes": (args: { url: string }) => string;
  "chrome.configure": (args: { dark: boolean }) => void;
  "view.textZoom": (args: { percent: number }) => number;
  "view.showKeyboard": (args: Record<string, never>) => void;
  "view.hideKeyboard": (args: Record<string, never>) => void;
  "email.compose": (args: { app: string; to: string; subject: string; body: string }) => void;
  "voice.start": (args: Record<string, never>) => { running: boolean };
  "voice.stop": (args: Record<string, never>) => void;
};

export type NativeHostMethod = keyof NativeHostMethods;
export type NativeHostArgs<M extends NativeHostMethod> = Parameters<NativeHostMethods[M]>[0];
export type NativeHostResult<M extends NativeHostMethod> = ReturnType<NativeHostMethods[M]>;

export type NativeHostRequest = { id: number; method: NativeHostMethod; args: unknown };
export type NativeHostReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string; code?: string };

/** Pushed by the host: appUrlOpen, appStateChange, backButton, voiceEnd. */
export type NativeHostEvent =
  | { type: "appUrlOpen"; url: string }
  | { type: "appStateChange"; isActive: boolean }
  | { type: "backButton" }
  | { type: "voiceEnd" };
