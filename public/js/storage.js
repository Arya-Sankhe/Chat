import { DEFAULT_SETTINGS } from "./constants.js";

const STORAGE_KEY = "crofchat.state.v1";

export function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createConversation() {
  const now = new Date().toISOString();
  return {
    id: createId("chat"),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function defaultState() {
  const conversation = createConversation();
  return {
    settings: { ...DEFAULT_SETTINGS },
    conversations: [conversation],
    activeConversationId: conversation.id
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();

    const parsed = JSON.parse(raw);
    const conversations = Array.isArray(parsed.conversations) && parsed.conversations.length
      ? parsed.conversations
      : [createConversation()];

    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      conversations,
      activeConversationId: parsed.activeConversationId || conversations[0].id
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  const copy = structuredClone(state);
  if (!copy.settings.rememberKey) {
    copy.settings.apiKey = "";
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
}
