import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";
import { SessionManager, createApiClient, createChatController } from "@klui/shared";
import { secureStorage } from "./secureStorage";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiOrigin?: string; authCallback?: string };

export const API_ORIGIN = (extra.apiOrigin || "https://klui.ai").replace(/\/+$/, "");
export const AUTH_CALLBACK_URL = extra.authCallback || "tech.klui.app://auth/callback";

export const session = new SessionManager(secureStorage);
export const api = createApiClient({
  baseUrl: API_ORIGIN,
  session,
  // React Native's built-in fetch buffers the whole body; expo/fetch streams it.
  streamFetch: expoFetch as unknown as typeof fetch
});
export const chat = createChatController({
  api,
  randomId: () => Crypto.randomUUID()
});
