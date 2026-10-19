import { useMemo } from "react";
import { useStore } from "zustand";
import { buildDisplayItems, type ChatState } from "@klui/shared";
import { chat } from "./runtime";

export function useChat<T>(selector: (state: ChatState) => T): T {
  return useStore(chat.store, selector);
}

export function useTranscript(conversationId: string | null) {
  const thread = useChat((state) => (conversationId ? state.threads[conversationId] : undefined));
  const run = useChat((state) => (conversationId ? state.runs[conversationId] : undefined));
  // Recomputed only when this conversation's thread or run changes.
  const items = useMemo(() => buildDisplayItems(thread, run), [thread, run]);
  return { thread, run, items };
}
