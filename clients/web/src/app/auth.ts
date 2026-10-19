import { create } from "zustand";
import type { KluiConfig, Me } from "@klui/shared";
import { api, chat, session } from "./runtime";

type AuthStatus = "booting" | "signedOut" | "signedIn" | "error";

interface AuthState {
  status: AuthStatus;
  config: KluiConfig | null;
  me: Me | null;
  error: string;
}

export const useAuth = create<AuthState>(() => ({ status: "booting", config: null, me: null, error: "" }));

async function enter() {
  const me = await api.fetchMe().catch(() => null);
  if (!session.current()) {
    useAuth.setState({ status: "signedOut", me: null });
    return;
  }
  useAuth.setState({ status: "signedIn", me });
  void chat.loadConversations();
}

export async function boot() {
  try {
    const config = await api.fetchConfig();
    session.setConfig(config);
    useAuth.setState({ config });
    const saved = await session.load();
    if (!saved) {
      useAuth.setState({ status: "signedOut" });
      return;
    }
    await session.ensureFresh();
    await enter();
  } catch (error) {
    useAuth.setState({ status: "error", error: (error as Error).message || "Klui could not start." });
  }
}

// Another part of the app (or a dead refresh token) can end the session.
session.subscribe((next) => {
  if (!next && useAuth.getState().status === "signedIn") {
    chat.reset();
    useAuth.setState({ status: "signedOut", me: null });
  }
});

export async function signInWithGoogleCredential(credential: string) {
  await session.signInWithGoogleIdToken(credential);
  await enter();
}

export async function signOut() {
  chat.reset();
  await session.signOut();
  useAuth.setState({ status: "signedOut", me: null });
}
