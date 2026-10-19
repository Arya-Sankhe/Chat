import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as WebBrowser from "expo-web-browser";
import { create } from "zustand";
import type { KluiConfig, Me } from "@klui/shared";
import { AUTH_CALLBACK_URL, api, chat, session } from "./runtime";
import { secureStorage } from "./secureStorage";

type AuthStatus = "booting" | "signedOut" | "signedIn" | "error";

interface AuthState {
  status: AuthStatus;
  config: KluiConfig | null;
  me: Me | null;
  error: string;
  signingIn: boolean;
}

export const useAuth = create<AuthState>(() => ({ status: "booting", config: null, me: null, error: "", signingIn: false }));

/* Supabase is only used for the PKCE handshake. Only its code verifier is
   kept, so a callback that arrives after a cold start can still finish. */
const pkceStorage = {
  getItem: (key: string) => (key.endsWith("-code-verifier") ? secureStorage.get(key) : Promise.resolve(null)),
  setItem: (key: string, value: string) => (key.endsWith("-code-verifier") ? secureStorage.set(key, value) : Promise.resolve()),
  removeItem: (key: string) => (key.endsWith("-code-verifier") ? secureStorage.remove(key) : Promise.resolve())
};

let supabase: SupabaseClient | null = null;
function supabaseFor(config: KluiConfig): SupabaseClient {
  supabase ??= createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: false, storage: pkceStorage }
  });
  return supabase;
}

async function enter() {
  const me = await api.fetchMe().catch(() => null);
  if (!session.current()) {
    useAuth.setState({ status: "signedOut", me: null });
    return;
  }
  useAuth.setState({ status: "signedIn", me, error: "" });
  void chat.loadConversations();
}

export async function boot() {
  try {
    const config = await api.fetchConfig();
    session.setConfig(config);
    useAuth.setState({ config });
    if (!(await session.load())) {
      useAuth.setState({ status: "signedOut" });
      return;
    }
    await session.ensureFresh();
    await enter();
  } catch (error) {
    useAuth.setState({ status: "error", error: (error as Error).message || "Klui could not start." });
  }
}

session.subscribe((next) => {
  if (!next && useAuth.getState().status === "signedIn") {
    chat.reset();
    useAuth.setState({ status: "signedOut", me: null });
  }
});

export function parseAuthCallback(url: string): { code: string; error: string } | null {
  if (!url.startsWith(AUTH_CALLBACK_URL)) return null;
  const parsed = new URL(url);
  const params = new URLSearchParams([...new URLSearchParams(parsed.hash.replace(/^#/, "")), ...parsed.searchParams]);
  let error = params.get("error_description") || params.get("error_code") || params.get("error") || "";
  if (/redirect/i.test(error)) error = `Google sign-in redirect is not configured. Add ${AUTH_CALLBACK_URL} to Supabase Auth redirect URLs.`;
  return { code: params.get("code") || "", error };
}

const handledCodes = new Set<string>();

/** Finishes sign-in from the OAuth redirect, whichever path delivered it. */
export async function completeSignIn(url: string): Promise<void> {
  const parsed = parseAuthCallback(url);
  if (!parsed) return;
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.code || handledCodes.has(parsed.code)) return;
  handledCodes.add(parsed.code);
  const config = useAuth.getState().config;
  if (!config) throw new Error("Klui configuration is not loaded yet.");
  const { data, error } = await supabaseFor(config).auth.exchangeCodeForSession(parsed.code);
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("Google sign-in did not return a session.");
  await session.save({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + data.session.expires_in,
    token_type: data.session.token_type || "bearer"
  });
  await enter();
}

export async function signInWithGoogle(): Promise<void> {
  const config = useAuth.getState().config;
  if (!config || useAuth.getState().signingIn) return;
  useAuth.setState({ signingIn: true, error: "" });
  try {
    const { data, error } = await supabaseFor(config).auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: AUTH_CALLBACK_URL, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } }
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Google sign-in could not be started.");
    const result = await WebBrowser.openAuthSessionAsync(data.url, AUTH_CALLBACK_URL);
    if (result.type === "success") await completeSignIn(result.url);
  } catch (error) {
    useAuth.setState({ error: (error as Error).message || "Google sign-in failed." });
  } finally {
    useAuth.setState({ signingIn: false });
  }
}

export async function signOut() {
  chat.reset();
  await session.signOut();
  useAuth.setState({ status: "signedOut", me: null });
}
