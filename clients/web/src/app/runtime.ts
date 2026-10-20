import { SessionManager, createApiClient, createChatController, type KeyValueStorage } from "@klui/shared";

/* One instance per tab. The new site is served from the same origin as the
   API, so requests are relative and the session lives where the current site
   keeps it. */
const localStore: KeyValueStorage = {
  async get(key) { return globalThis.localStorage?.getItem(key) ?? null; },
  async set(key, value) { globalThis.localStorage?.setItem(key, value); },
  async remove(key) { globalThis.localStorage?.removeItem(key); }
};

export const session = new SessionManager(localStore);
// index.html starts /api/config and /api/plans with the page (window.__kluiBoot).
const boot = (globalThis as { __kluiBoot?: Record<string, Promise<Response | null> | undefined> }).__kluiBoot;

// Set once /api/config answers (boot.ts); the old api.js sent the same header.
export const webBuild = { id: "", check: () => {} };

export const api = createApiClient({
  baseUrl: "",
  session,
  buildId: () => webBuild.id,
  onStaleBuild: () => webBuild.check(),
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
