import { SessionManager, createApiClient, createChatController, type KeyValueStorage } from "@klui/shared";
import { apiOrigin, isNative, storage } from "../islands/platform/index.js";

/* One instance per tab. The site is served from the same origin as the API,
   so requests are relative and the session lives where the current site keeps
   it. The packaged app (https://localhost) talks to its API origin and keeps
   the session in the device's secure storage, as the Capacitor app did. */
const localStore: KeyValueStorage = {
  async get(key) { return globalThis.localStorage?.getItem(key) ?? null; },
  async set(key, value) { globalThis.localStorage?.setItem(key, value); },
  async remove(key) { globalThis.localStorage?.removeItem(key); }
};

export const session = new SessionManager(isNative() ? storage : localStore);
// index.html starts /api/config and /api/plans with the page (window.__kluiBoot).
const boot = (globalThis as { __kluiBoot?: Record<string, Promise<Response | null> | undefined> }).__kluiBoot;

// Set once /api/config answers (boot.ts); the old api.js sent the same header.
export const webBuild = { id: "", check: () => {} };

export const api = createApiClient({
  baseUrl: apiOrigin(),
  session,
  // The build check is the website's; the app updates through its store listing.
  ...(isNative() ? {} : { buildId: () => webBuild.id, onStaleBuild: () => webBuild.check() }),
  takeBootResponse(name) {
    const pending = boot?.[name] ?? null;
    if (boot) delete boot[name];
    return pending;
  }
});
export const chat = createChatController({
  api,
  keepReasoning: () => false
});
