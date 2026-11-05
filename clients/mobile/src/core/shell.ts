import { Keyboard } from "react-native";
import { create } from "zustand";
import type { WebSurfaceTarget } from "@klui/shared";

/* What the app shell shows. The web surface sits above the native screens,
   kept alive once opened, so a lesson survives going back to chat. */
type ShellState = {
  phase: "starting" | "signedOut" | "signedIn";
  signInError: string;
  signingIn: boolean;
  webVisible: boolean;
  webTarget: WebSurfaceTarget | null;
  /** Bumped each time a target is asked for, even the same one again. */
  webRequest: number;
  /** Bumped when another account signs in: the web surface starts over. */
  webGeneration: number;
  toast: string;
};

export const useShell = create<ShellState>(() => ({
  phase: "starting",
  signInError: "",
  signingIn: false,
  webVisible: false,
  webTarget: null,
  webRequest: 0,
  webGeneration: 0,
  toast: ""
}));

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string) {
  useShell.setState({ toast: message });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => useShell.setState({ toast: "" }), 3200);
}

export function closeWebSurface() {
  useShell.setState({ webVisible: false });
}

export function openWeb(target: WebSurfaceTarget) {
  // Otherwise it stays up over the page, and Back only closes it.
  Keyboard.dismiss();
  useShell.setState((state) => ({ webVisible: true, webTarget: target, webRequest: state.webRequest + 1 }));
}
