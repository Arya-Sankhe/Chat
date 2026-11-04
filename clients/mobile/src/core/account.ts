import { useCallback, useEffect, useState } from "react";
import { Appearance } from "react-native";
import { create } from "zustand";
import { PINNED_CHATS_KEY, SETTINGS_KEY, type Me } from "@klui/shared";
import { prefs } from "./prefs";
import { api } from "./runtime";

/* The signed-in person, and the settings native screens share with the web client. */
export const useAccount = create<{ me: Me | null; error: string }>(() => ({ me: null, error: "" }));

let latestLoad = 0;

export async function loadAccount() {
  const load = ++latestLoad;
  try {
    const me = await api.fetchMe();
    // Signed out, or someone else signed in, while this was on its way.
    if (load === latestLoad) useAccount.setState({ me, error: "" });
  } catch (error) {
    if (load === latestLoad) useAccount.setState({ error: (error as Error)?.message || "Your account could not be loaded." });
  }
}

export function clearAccount() {
  latestLoad += 1;
  useAccount.setState({ me: null, error: "" });
}

export function readControls(): Record<string, unknown> {
  try {
    return JSON.parse(prefs.get(SETTINGS_KEY) || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeControls(patch: Record<string, unknown>) {
  prefs.set(SETTINGS_KEY, JSON.stringify({ ...readControls(), ...patch }));
  applyAppearance();
}

/** The app's light or dark follows the person's Appearance setting, native and web alike. */
export function applyAppearance() {
  const appearance = readControls().appearance;
  Appearance.setColorScheme(appearance === "light" || appearance === "dark" ? appearance : "unspecified");
}

/* Pins are per person, in the same place the web client keeps them. */
export function usePinnedChats() {
  const userId = useAccount((state) => state.me?.user?.id);
  const key = userId ? `${PINNED_CHATS_KEY}.${userId}` : "";
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    if (!key) return setPinned([]);
    try {
      const parsed = JSON.parse(prefs.get(key) || "[]");
      setPinned(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
    } catch {
      setPinned([]);
    }
  }, [key]);

  const togglePin = useCallback((id: string) => {
    setPinned((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current];
      if (key) prefs.set(key, JSON.stringify(next));
      return next;
    });
  }, [key]);

  return { pinned, togglePin };
}
