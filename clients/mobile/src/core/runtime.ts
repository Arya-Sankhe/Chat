import Constants from "expo-constants";
import { fetch as streamingFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { SessionManager, createApiClient, type ApiClientOptions, type KeyValueStorage, type KluiConfig, sessionSnapshot, type HostedSessionState } from "@klui/shared";
import { prefs } from "./prefs";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiOrigin?: string; authCallback?: string; parity?: boolean };

export const API_ORIGIN = (extra.apiOrigin || "https://klui.ai").replace(/\/+$/, "");
export const AUTH_CALLBACK = extra.authCallback || "tech.klui.app://auth/callback";
/** A local test build, never a release: see auth.ts. */
export const PARITY_BUILD = extra.parity === true;

const CONFIG_KEY = "klui.config.v1";

const secureStorage: KeyValueStorage = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key)
};

/* The only owner of the session in the app: web surfaces ask it for tokens. */
export const session = new SessionManager(secureStorage);

let sessionGeneration = 0;
session.subscribe(() => { sessionGeneration += 1; });

/** The session as web surfaces get it: no refresh token, and ordered. */
export function hostedSessionState(): HostedSessionState {
  return { generation: sessionGeneration, session: sessionSnapshot(session.current()) };
}

/* Set by account.ts, which knows the plan. */
export const upgradeRequired: { handle: NonNullable<ApiClientOptions["onUpgradeRequired"]> } = { handle: () => {} };

export const api = createApiClient({
  baseUrl: API_ORIGIN,
  session,
  onUpgradeRequired: (problem) => upgradeRequired.handle(problem),
  streamFetch: streamingFetch as unknown as typeof fetch
});

let config: KluiConfig | null = null;

function remember(next: KluiConfig) {
  config = next;
  session.setConfig(next);
}

/** Reads the last config so the app opens offline, then updates it from the server. */
export function loadConfig(): Promise<KluiConfig | null> {
  const saved = prefs.get(CONFIG_KEY);
  if (saved) {
    try {
      remember(JSON.parse(saved));
    } catch {
      prefs.remove(CONFIG_KEY);
    }
  }
  const fresh = api.fetchConfig().then((next) => {
    remember(next);
    prefs.set(CONFIG_KEY, JSON.stringify(next));
    return next;
  });
  if (config) {
    fresh.catch(() => {});
    return Promise.resolve(config);
  }
  return fresh.catch(() => null);
}
