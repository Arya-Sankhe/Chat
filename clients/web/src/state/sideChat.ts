/* The temporary side chat: a small chat about a selected excerpt (or, in the
   Dojo, the flashcard on screen). shell/SideChatPanel.tsx draws it; the chat
   core lends it the reply streaming it uses itself (chatHooks.sideChat). */
import { create } from "zustand";
import { session } from "../app/runtime";
import { streamTemporaryChat } from "../islands/api.js";
import { isNative } from "../islands/platform/index.js";
import { loadMe } from "./boot";

export type SideChatMessage = { role: "user" | "assistant"; content: unknown; reasoning?: string; toolCalls?: unknown[]; error?: string };
export type SideChatSuggestion = [label: string, prompt: string];
type Rect = { left: number; right: number; top: number; bottom: number };

export type SideChatOptions = {
  flashcard?: boolean;
  role?: string;
  docked?: boolean;
  focus?: boolean;
  send?: boolean;
  title?: string;
  initialText?: string;
  suggestions?: SideChatSuggestion[];
  onAddToCard?: (text: string) => Promise<boolean> | boolean;
  onClose?: () => void;
};

type SideChat = {
  open: boolean;
  /** Bumped on every open, so the panel re-places and re-focuses itself. */
  session: number;
  title: string;
  context: string;
  messages: SideChatMessage[];
  /** Bumped as a streamed reply changes in place. */
  revision: number;
  running: boolean;
  input: string;
  flashcard: boolean;
  role: string;
  docked: boolean;
  suggestions: SideChatSuggestion[];
  canAddToCard: boolean;
  added: Set<number>;
  adding: Set<number>;
  anchor: Rect | null;
  /** Bumped whenever the input should take focus. */
  focusTick: number;
};

const CLOSED: SideChat = {
  open: false, session: 0, title: "Side chat", context: "", messages: [], revision: 0, running: false, input: "", flashcard: false, role: "",
  docked: false, suggestions: [], canAddToCard: false, added: new Set(), adding: new Set(), anchor: null, focusTick: 0
};

export const useSideChat = create<SideChat>(() => ({ ...CLOSED }));
const set = useSideChat.setState;
const get = useSideChat.getState;

/** Follows a streaming reply until the reader scrolls up (wheel and touch in the panel). */
export const scroll = { auto: true };

// Callbacks and the in-flight request stay out of the rendered state.
let onAddToCard: SideChatOptions["onAddToCard"] | null = null;
let onClose: (() => void) | null = null;
let abortController: AbortController | null = null;

/** Text selections and the side chat are for a mouse or trackpad, on the web. */
export function selectionActionsEnabled() {
  return !isNative() && window.matchMedia("(pointer: fine)").matches;
}

function setDocked(docked: boolean) {
  document.body.classList.toggle("side-chat-docked", docked);
}

export function closeSideChat() {
  const closing = onClose;
  onClose = null;
  onAddToCard = null;
  abortController?.abort();
  abortController = null;
  setDocked(false);
  set((s) => ({ ...CLOSED, session: s.session, focusTick: s.focusTick }));
  closing?.();
}

export function openSideChat(context: string, anchorRect: Rect | null, options: SideChatOptions = {}) {
  if (!selectionActionsEnabled()) return;
  abortController?.abort();
  abortController = null;
  onAddToCard = typeof options.onAddToCard === "function" ? options.onAddToCard : null;
  onClose = typeof options.onClose === "function" ? options.onClose : null;
  const docked = Boolean(options.docked);
  setDocked(docked);
  set((s) => ({
    open: true,
    session: s.session + 1,
    title: options.title || "Side chat",
    context: String(context || "").trim(),
    messages: [],
    running: false,
    input: options.initialText || "",
    flashcard: Boolean(options.flashcard),
    role: options.role || "",
    docked,
    suggestions: Array.isArray(options.suggestions) ? options.suggestions : [],
    canAddToCard: Boolean(onAddToCard),
    added: new Set(),
    adding: new Set(),
    anchor: anchorRect,
    // A floating panel always takes focus; a docked one only when asked.
    focusTick: s.focusTick + (docked && !options.focus ? 0 : 1)
  }));
  scroll.auto = true;
  if (options.send && get().input.trim()) void sendSideChatMessage();
}

export function setSideChatInput(input: string) {
  set({ input });
}

export async function sendSideChatMessage(override?: string) {
  const s = get();
  if (s.running || !s.context) return;
  // Highlighted context is enough — empty input still asks about the selection.
  const text = (override ?? s.input).trim() || (s.flashcard ? "" : "Explain this.");
  if (!text) return;
  const hooks = sideChatHooks;
  const lead = s.flashcard
    ? "Use this flashcard as context for my questions:\n\n"
    : "Use this selected excerpt from the main chat as context for my questions:\n\n";
  const history = [
    { role: "user", content: `${lead}${s.context}` },
    ...s.messages.slice(-18).map((message) => ({ role: message.role, content: hooks.rawText(message.content) }))
  ];
  const userMessage: SideChatMessage = { role: "user", content: text };
  const assistantMessage: SideChatMessage = { role: "assistant", content: "", reasoning: "", toolCalls: [] };
  const controller = new AbortController();
  abortController = controller;
  set({ messages: [...s.messages, userMessage, assistantMessage], input: "", running: true });
  scroll.auto = true;
  const request = hooks.request();
  try {
    await streamTemporaryChat(session.current(), {
      text,
      messages: history,
      role: s.role || request.role,
      settings: request.settings,
      writingStyle: "concise",
      agentMode: !s.flashcard,
      webSearch: s.flashcard ? "off" : (request.webSearchMode !== "off" ? "auto" : "off")
    }, {
      signal: controller.signal,
      onEvent: (event: unknown) => {
        if (abortController !== controller) return;
        hooks.applyStreamEvent(assistantMessage, event);
        set((current) => ({ revision: current.revision + 1 }));
      }
    });
    loadMe().catch(() => {});
  } catch (error: any) {
    if (error?.name !== "AbortError") assistantMessage.error = error?.message || "Side chat failed.";
  } finally {
    if (abortController === controller) {
      abortController = null;
      set((current) => ({ running: false, revision: current.revision + 1, focusTick: current.focusTick + 1 }));
    }
  }
}

/** The Dojo's "Add to this card": the reply joins the flashcard's back. */
export async function addReplyToCard(index: number) {
  const s = get();
  const message = s.messages[index];
  const text = message?.role === "assistant" ? sideChatHooks.rawText(message.content).trim() : "";
  if (!text || !onAddToCard || s.added.has(index) || s.adding.has(index)) return;
  set({ adding: new Set(s.adding).add(index) });
  const ok = await onAddToCard(text);
  set((current) => {
    const adding = new Set(current.adding);
    adding.delete(index);
    return { adding, added: ok ? new Set(current.added).add(index) : current.added };
  });
}

/** What the chat core lends the side chat; chat.js fills it as it mounts. */
export const sideChatHooks = {
  request: (): { role: string; settings: unknown; webSearchMode: string } => ({ role: "think", settings: {}, webSearchMode: "off" }),
  applyStreamEvent: (_message: SideChatMessage, _event: unknown) => {},
  rawText: (content: unknown) => String(content ?? ""),
  /** The reply's thinking bar or reasoning, as the main chat draws it. */
  activityHtml: (_message: SideChatMessage, _streaming: boolean) => "",
  openPastedText: (_text: string) => {}
};
