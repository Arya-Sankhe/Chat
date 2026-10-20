// public/js/platform/index.js for the web build: the same exports, keeping only
// the branches that run when isNative() is false. The native app is a separate
// client, so nothing here imports Capacitor.

export function isNative() {
  return false;
}

export function apiOrigin() {
  return "";
}

export function apiUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  return `${apiOrigin()}${value.startsWith("/") ? value : `/${value}`}`;
}

export const storage = {
  async get(key) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async set(key, value) {
    globalThis.localStorage?.setItem(key, String(value));
  },
  async remove(key) {
    globalThis.localStorage?.removeItem(key);
  }
};

export const preferences = storage;

export async function signInWithGoogle() {
  return null;
}

export async function listenForAuthCallback() {
  return () => {};
}

export async function listenForDeepLinks() {
  return () => {};
}

export async function openExternal(url) {
  if (!url) return;
  globalThis.open?.(url, "_blank", "noopener");
}

export async function saveTextFile(fileName, contents, mime = "application/json") {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    await download(url, fileName);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function download(url, fileName = "download") {
  const anchor = document.createElement("a");
  anchor.href = url;
  // No target="_blank": the signed URL already answers with Content-Disposition: attachment, so
  // the browser saves it in place instead of flashing open (and closing) a blank tab.
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function copyText(value) {
  await navigator.clipboard.writeText(String(value || ""));
}

export async function readClipboardText() {
  return navigator.clipboard.readText();
}

export async function appVersion() {
  return { version: "", build: "0" };
}

export async function onResume() {
  return () => {};
}

export async function configureNativeChrome() {}

export async function fetchNativeBytes() {
  throw new Error("Native fetch is not available on the web.");
}

/* On the web this does nothing and reports running, so callers never warn. */
export async function keepVoiceSessionAlive() {
  return { running: true, stop() {} };
}

export async function setTextZoom() {}

export async function showNativeKeyboard() {}

export async function composeEmailNatively() {
  return false;
}

export async function registerBackButton() {
  return () => {};
}

export async function exitApp() {}
