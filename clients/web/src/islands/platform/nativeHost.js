// The packaged app's side of the native host bridge (@klui/shared
// nativeHost.ts). The Expo host sets window.__kluiNative before this page's
// scripts run and exposes KluiNativeHost.postMessage; it answers through
// window.__kluiNativeReply and pushes events through window.__kluiNativeEvent.

export const nativeInfo = globalThis.__kluiNative || null;

const pending = new Map();
const listeners = new Map();
// Random per document, so a reply meant for a page that has since reloaded matches nothing.
let nextId = Math.floor(Math.random() * 2 ** 31) * 1024 + 1;

if (nativeInfo) {
  globalThis.__kluiNativeReply = (reply) => {
    const entry = pending.get(reply?.id);
    if (!entry) return;
    pending.delete(reply.id);
    if (reply.ok) entry.resolve(reply.value);
    else {
      const error = new Error(reply.error || "Native call failed.");
      if (reply.code) error.code = reply.code;
      entry.reject(error);
    }
  };
  globalThis.__kluiNativeEvent = (event) => {
    for (const callback of [...(listeners.get(event?.type) || [])]) {
      try {
        callback(event);
      } catch (error) {
        console.error(error);
      }
    }
  };
}

/** Calls a host method; resolves with its value. */
export function nativeCall(method, args = {}) {
  if (!nativeInfo || !globalThis.KluiNativeHost) return Promise.reject(new Error("Not running in the Klui app."));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    globalThis.KluiNativeHost.postMessage(JSON.stringify({ id, method, args }));
  });
}

/** Listens for a host event (appUrlOpen, appStateChange, backButton, voiceEnd). */
export function onNativeEvent(type, callback) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(callback);
  return { remove: () => listeners.get(type)?.delete(callback) };
}
