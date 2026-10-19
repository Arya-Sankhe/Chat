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
export const api = createApiClient({ baseUrl: "", session });
export const chat = createChatController({
  api,
  keepReasoning: () => false
});
