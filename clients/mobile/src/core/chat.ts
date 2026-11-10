import * as Crypto from "expo-crypto";
import { useStore } from "zustand";
import { createChatController, type ChatState } from "@klui/shared";
import { readControls } from "./account";
import { prefs } from "./prefs";
import { api } from "./runtime";

/* The app's chat state: runs outlive screens, so leaving a chat never cancels its reply. */
const ROLE_KEY = "klui.native.role.v1";

export const NATIVE_ROLES = ["nitro", "think", "pro"] as const;

export function savedRole(): string {
  const saved = prefs.get(ROLE_KEY);
  return saved && (NATIVE_ROLES as readonly string[]).includes(saved) ? saved : "think";
}

export function saveRole(role: string) {
  prefs.set(ROLE_KEY, role);
}

export const chat = createChatController({
  api,
  randomId: () => Crypto.randomUUID(),
  preferences: () => {
    const saved = readControls();
    return {
      role: savedRole(),
      writingStyle: typeof saved.writingStyle === "string" ? saved.writingStyle : "normal",
      systemPrompt: "",
      webSearch: "auto" as const
    };
  }
});

/* The last list shows at once on the next launch, and without a connection; the server's follows. */
const LIST_KEY = "klui.native.chatList.v1";

export function showSavedChatList() {
  try {
    const saved = JSON.parse(prefs.get(LIST_KEY) || "null");
    if (Array.isArray(saved)) chat.store.setState({ conversations: saved, conversationsStatus: "ready" });
  } catch {
    prefs.remove(LIST_KEY);
  }
}

export function forgetChatList() {
  prefs.remove(LIST_KEY);
}

chat.store.subscribe((state, previous) => {
  if (state.conversationsStatus === "ready" && state.conversations !== previous.conversations) {
    prefs.set(LIST_KEY, JSON.stringify(state.conversations.slice(0, 40)));
  }
});

export function useChat<T>(selector: (state: ChatState) => T): T {
  return useStore(chat.store, selector);
}
