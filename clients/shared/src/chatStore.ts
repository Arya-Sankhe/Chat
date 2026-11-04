import { createStore, type StoreApi } from "zustand/vanilla";
import { ApiError, NetworkError, type ApiClient } from "./api";
import { textFromMessageContent } from "./content";
import { applyStreamEvent, createLiveAssistant } from "./streamReducer";
import type {
  ConversationSummary,
  LiveAssistant,
  MessagePage,
  PendingTurn,
  SendPayload,
  StoredMessage,
  StreamEvent
} from "./types";

/* Chat state for every client. Runs are keyed by conversation and live here,
   not in a screen, so leaving a chat never cancels its reply. */

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface ThreadState {
  status: LoadStatus;
  messages: StoredMessage[];
  page: MessagePage;
  error: string;
}

export type RunStatus = "streaming" | "stopping" | "reconnecting" | "failed";

export interface RunState {
  conversationId: string;
  status: RunStatus;
  turnRunId: string;
  /** Shown until the server's copy of the user message is loaded. */
  userMessage: StoredMessage | null;
  /** The server's id for that user message (x-klui-user-message-id). */
  userMessageId: string;
  /** The server accepted the request, so a reload can show what it kept. */
  persisted: boolean;
  /** A retry replaces this stored assistant in place. */
  replacesMessageId: string;
  assistant: LiveAssistant;
}

export interface ChatState {
  conversations: ConversationSummary[];
  conversationsStatus: LoadStatus;
  conversationsError: string;
  threads: Record<string, ThreadState>;
  runs: Record<string, RunState>;
  /** Text handed back to the composer when a turn is cancelled before it started. */
  drafts: Record<string, WithdrawnDraft>;
}

export type DisplayItem =
  | { kind: "stored"; key: string; message: StoredMessage; canRetry: boolean }
  | { kind: "live"; key: string; message: LiveAssistant; status: RunStatus }
  | { kind: "local-user"; key: string; message: StoredMessage };

/** An uploaded file going out with a message. */
export interface SendAttachment {
  id: string;
  category: "image" | "document";
  fileName: string;
  contentType: string;
  /** Where to show it until the server's copy of the message loads. */
  url: string;
}

/** A message taken back before the model answered, on its way back to the message box. */
export interface WithdrawnDraft {
  text: string;
  attachments: SendAttachment[];
}

function localUserContent(text: string, attachments: SendAttachment[]): StoredMessage["content"] {
  return [
    ...attachments.map((item) => item.category === "image"
      ? { type: "image_url", image_url: { url: item.url, attachment_id: item.id, file_name: item.fileName, content_type: item.contentType } }
      : { type: "file", file: { url: "", attachment_id: item.id, file_name: item.fileName, content_type: item.contentType } }),
    ...(text ? [{ type: "text", text }] : [])
  ];
}

export interface ChatPreferences {
  role: string;
  writingStyle: string;
  webSearch: "auto" | "off";
  systemPrompt: string;
}

export interface ChatControllerOptions {
  api: ApiClient;
  preferences?: () => Partial<ChatPreferences>;
  keepReasoning?: () => boolean;
  randomId?: () => string;
  /** How often a streaming reply re-renders. */
  publishIntervalMs?: number;
  /** Waits before each reconnect attempt after a dropped stream. */
  rejoinDelaysMs?: number[];
  /** A resumed app whose stream stays this quiet is reattached. */
  resumeQuietMs?: number;
  /** A durable turn that sends nothing for this long is assumed half-open and reattached. */
  stallMs?: number;
}

const EMPTY_PAGE: MessagePage = { hasMore: false, cursor: null };
const DEFAULT_PREFERENCES: ChatPreferences = { role: "think", writingStyle: "normal", webSearch: "auto", systemPrompt: "" };
export const CONNECTION_LOST_MESSAGE = "Connection lost. Your reply is still being written. Open this chat again to see it.";

function fallbackUuid(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string })?.name === "AbortError";
}

const isDroppedConnection = (error: unknown) => error instanceof NetworkError;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Builds the transcript a chat screen renders, merging any live run into the stored messages. */
export function selectDisplayItems(state: ChatState, conversationId: string | null): DisplayItem[] {
  return conversationId ? buildDisplayItems(state.threads[conversationId], state.runs[conversationId]) : [];
}

export function buildDisplayItems(thread: ThreadState | undefined, run: RunState | undefined): DisplayItem[] {
  const stored = thread?.messages ?? [];
  const busy = Boolean(run && run.status !== "failed");
  const items: DisplayItem[] = [];
  let liveInserted = false;
  const live = (): DisplayItem => ({ kind: "live", key: `live:${run!.assistant.id}`, message: run!.assistant, status: run!.status });

  let userStored = false;
  for (const message of stored) {
    // The server does not stamp user rows with turn_run_id; its id comes back as a response header.
    if (run?.userMessageId && message.id === run.userMessageId) userStored = true;
    if (run && run.replacesMessageId === message.id) {
      items.push(live());
      liveInserted = true;
      continue;
    }
    // A resumed turn's partial output is replaced by the replayed stream.
    if (run?.turnRunId && message.role !== "user" && message.turn_run_id === run.turnRunId) {
      if (!liveInserted) items.push(live());
      liveInserted = true;
      continue;
    }
    items.push({ kind: "stored", key: message.id, message, canRetry: !busy && canRetryMessage(message) });
  }
  if (run && !liveInserted) {
    if (run.userMessage && !userStored) items.push({ kind: "local-user", key: run.userMessage.id, message: run.userMessage });
    items.push(live());
  }
  return items;
}

export function canRetryMessage(message: StoredMessage): boolean {
  if (message.role !== "assistant") return false;
  const metadata = message.metadata ?? {};
  if (metadata.councilGroup || metadata.compareGroup || metadata.council || metadata.compare) return false;
  return Boolean(message.id) && !String(message.id).startsWith("local_");
}

export function createChatController(options: ChatControllerOptions) {
  const { api } = options;
  const randomId = options.randomId ?? (() => globalThis.crypto?.randomUUID?.() ?? fallbackUuid());
  const publishInterval = options.publishIntervalMs ?? 50;
  const rejoinDelays = options.rejoinDelaysMs ?? [1000, 2500, 5000];
  const resumeQuietMs = options.resumeQuietMs ?? 5000;
  const stallMs = options.stallMs ?? 45_000;
  const preferences = (): ChatPreferences => ({ ...DEFAULT_PREFERENCES, ...options.preferences?.() });

  const store: StoreApi<ChatState> = createStore<ChatState>(() => ({
    conversations: [],
    conversationsStatus: "idle",
    conversationsError: "",
    threads: {},
    runs: {},
    drafts: {}
  }));

  /* Mutable per-run bookkeeping that never needs to render. */
  interface RunHandle {
    abort: AbortController;
    assistant: LiveAssistant;
    turnRunId: string;
    accepted: boolean;
    cancelRequested: boolean;
    reattaching: boolean;
    /** Consecutive reconnects that delivered nothing beyond what an earlier attempt had. */
    rejoinFailures: number;
    /** Most events any attempt has delivered; a replay only counts as progress past this. */
    eventHighWater: number;
    lastEventAt: number;
    publishTimer: ReturnType<typeof setTimeout> | null;
    draftText: string;
    draftAttachments: SendAttachment[];
  }
  const handles = new Map<string, RunHandle>();
  const loadTokens = new Map<string, number>();
  // Never reused, not even across reset(), so a stale response can't pass as current.
  let loadSeq = 0;
  /* Bumped by reset(); async work started under an older epoch belongs to the
     previous account and must not write into the store. */
  let epoch = 0;

  const set = (fn: (state: ChatState) => Partial<ChatState>) => store.setState(fn);

  function patchRun(conversationId: string, patch: Partial<RunState>) {
    set((state) => {
      const run = state.runs[conversationId];
      return run ? { runs: { ...state.runs, [conversationId]: { ...run, ...patch } } } : {};
    });
  }

  function dropRun(conversationId: string) {
    const handle = handles.get(conversationId);
    if (handle?.publishTimer) clearTimeout(handle.publishTimer);
    handles.delete(conversationId);
    set((state) => {
      if (!state.runs[conversationId]) return {};
      const { [conversationId]: _, ...runs } = state.runs;
      return { runs };
    });
  }

  function publish(conversationId: string, immediate = false) {
    const handle = handles.get(conversationId);
    if (!handle) return;
    const flush = () => {
      handle.publishTimer = null;
      if (handles.get(conversationId) !== handle) return;
      patchRun(conversationId, { assistant: { ...handle.assistant, activity: [...handle.assistant.activity], toolEvents: [...handle.assistant.toolEvents] }, turnRunId: handle.turnRunId });
    };
    if (immediate) {
      if (handle.publishTimer) clearTimeout(handle.publishTimer);
      flush();
    } else {
      handle.publishTimer ??= setTimeout(flush, publishInterval);
    }
  }

  function setThread(conversationId: string, patch: Partial<ThreadState>) {
    set((state) => ({
      threads: {
        ...state.threads,
        [conversationId]: { status: "idle", messages: [], page: EMPTY_PAGE, error: "", ...state.threads[conversationId], ...patch }
      }
    }));
  }

  function touchConversation(conversation: ConversationSummary) {
    set((state) => ({
      conversations: [conversation, ...state.conversations.filter((row) => row.id !== conversation.id)]
    }));
  }

  async function loadConversations(): Promise<void> {
    const started = epoch;
    set(() => ({ conversationsStatus: "loading", conversationsError: "" }));
    try {
      const conversations = await api.listConversations();
      if (started === epoch) set(() => ({ conversations, conversationsStatus: "ready" }));
    } catch (error) {
      if (started === epoch) set(() => ({ conversationsStatus: "error", conversationsError: (error as Error).message }));
    }
  }

  type ThreadLoad = { status: "loaded"; pendingTurns: PendingTurn[] } | { status: "superseded" } | { status: "failed" };

  /** Loads the latest page, reporting the pending turns the server still holds. */
  async function loadThread(conversationId: string): Promise<ThreadLoad> {
    const token = ++loadSeq;
    loadTokens.set(conversationId, token);
    const hasMessages = Boolean(store.getState().threads[conversationId]?.messages.length);
    setThread(conversationId, { status: hasMessages ? "ready" : "loading", error: "" });
    try {
      const detail = await api.fetchConversation(conversationId);
      if (loadTokens.get(conversationId) !== token) return { status: "superseded" };
      setThread(conversationId, { status: "ready", messages: detail.messages, page: detail.page ?? EMPTY_PAGE });
      return { status: "loaded", pendingTurns: detail.pendingTurns ?? [] };
    } catch (error) {
      if (loadTokens.get(conversationId) !== token) return { status: "superseded" };
      setThread(conversationId, { status: hasMessages ? "ready" : "error", error: (error as Error).message });
      return { status: "failed" };
    }
  }

  async function loadOlder(conversationId: string): Promise<void> {
    const thread = store.getState().threads[conversationId];
    if (!thread?.page.hasMore || !thread.page.cursor) return;
    const started = epoch;
    const detail = await api.fetchConversation(conversationId, { cursor: thread.page.cursor });
    if (started !== epoch) return;
    const current = store.getState().threads[conversationId];
    if (!current) return;
    const known = new Set(current.messages.map((m) => m.id));
    setThread(conversationId, {
      messages: [...detail.messages.filter((m) => !known.has(m.id)), ...current.messages],
      page: detail.page ?? EMPTY_PAGE
    });
  }

  /** Opens a chat and rejoins a reply the server is still writing. */
  async function openConversation(conversationId: string): Promise<void> {
    // A chat with a reply in flight reloads itself when that reply ends.
    const { runs, threads } = store.getState();
    if (runs[conversationId] && runs[conversationId].status !== "failed" && threads[conversationId]) return;
    const load = await loadThread(conversationId);
    // A kept failure the server knows about gives way to whatever the server has now:
    // the stored reply, or the turn still running (rejoined below).
    const failed = store.getState().runs[conversationId];
    if (load.status === "loaded" && failed?.status === "failed" && failed.persisted) dropRun(conversationId);
    const turn = load.status === "loaded" ? load.pendingTurns[0] : undefined;
    if (turn && !store.getState().runs[conversationId]) void resumeTurn(conversationId, turn.id);
  }

  interface StartRun {
    conversationId: string;
    payload: SendPayload;
    userMessage: StoredMessage | null;
    replacesMessageId?: string;
    turnRunId?: string;
    draftText?: string;
    draftAttachments?: SendAttachment[];
  }

  async function startRun(start: StartRun): Promise<void> {
    const { conversationId } = start;
    const handle: RunHandle = {
      abort: new AbortController(),
      assistant: createLiveAssistant(`local_assistant_${randomId()}`),
      turnRunId: start.turnRunId ?? "",
      accepted: Boolean(start.turnRunId),
      cancelRequested: false,
      reattaching: false,
      rejoinFailures: 0,
      eventHighWater: 0,
      lastEventAt: Date.now(),
      publishTimer: null,
      draftText: start.draftText ?? "",
      draftAttachments: start.draftAttachments ?? []
    };
    handles.set(conversationId, handle);
    set((state) => ({
      runs: {
        ...state.runs,
        [conversationId]: {
          conversationId,
          status: "streaming",
          turnRunId: handle.turnRunId,
          userMessage: start.userMessage,
          userMessageId: "",
          persisted: handle.accepted,
          replacesMessageId: start.replacesMessageId ?? "",
          assistant: { ...handle.assistant }
        }
      }
    }));
    await stream(conversationId, handle, start.payload);
  }

  async function stream(conversationId: string, handle: RunHandle, payload: SendPayload): Promise<void> {
    let attemptEvents = 0;
    const onEvent = (event: StreamEvent) => {
      if (handles.get(conversationId) !== handle) return;
      handle.lastEventAt = Date.now();
      if (event.type === "turn:submitted") {
        handle.accepted = true;
        patchRun(conversationId, { persisted: true });
        if (typeof event.turnRunId === "string" && event.turnRunId) handle.turnRunId = event.turnRunId;
        if (typeof event.userMessageId === "string" && event.userMessageId) {
          patchRun(conversationId, { userMessageId: event.userMessageId });
        }
        publish(conversationId, true);
        return;
      }
      // A reconnect replays from the start; only events past the earlier high-water mark are progress.
      attemptEvents += 1;
      if (attemptEvents > handle.eventHighWater) {
        handle.eventHighWater = attemptEvents;
        handle.rejoinFailures = 0;
      }
      if (event.type === "turn:claimed" && typeof event.turnRunId === "string") handle.turnRunId = event.turnRunId;
      applyStreamEvent(handle.assistant, event, { keepReasoning: options.keepReasoning?.() ?? false });
      publish(conversationId);
    };

    // Mobile networks and proxies can leave a connection open that delivers nothing.
    const watchdog = setInterval(() => {
      if (!handle.turnRunId || handle.cancelRequested || handle.reattaching) return;
      if (Date.now() - handle.lastEventAt < stallMs) return;
      handle.reattaching = true;
      handle.abort.abort();
    }, Math.min(stallMs, 5000));

    let streamError: unknown = null;
    try {
      await api.streamMessage(conversationId, payload, { signal: handle.abort.signal, onEvent });
    } catch (error) {
      streamError = error;
    } finally {
      clearInterval(watchdog);
    }
    if (streamError) {
      const error = streamError;
      if (handles.get(conversationId) !== handle) return;
      const rejoinable = handle.turnRunId && !handle.cancelRequested && (handle.reattaching || isDroppedConnection(error));
      if (rejoinable && handle.rejoinFailures < rejoinDelays.length) {
        const delay = rejoinDelays[handle.rejoinFailures]!;
        handle.rejoinFailures += 1;
        handle.reattaching = false;
        handle.abort = new AbortController();
        handle.lastEventAt = Date.now();
        patchRun(conversationId, { status: "reconnecting" });
        await sleep(delay);
        if (handles.get(conversationId) !== handle) return;
        if (handle.cancelRequested) {
          handle.assistant.stopped = true;
          await finish(conversationId, handle);
          return;
        }
        // The server replays the turn from its first event.
        handle.assistant = createLiveAssistant(handle.assistant.id);
        patchRun(conversationId, { status: "streaming" });
        await stream(conversationId, handle, { turnRunId: handle.turnRunId });
        return;
      }
      if (error instanceof ApiError && error.status === 404 && payload.turnRunId) {
        // The turn finished while we were away; the stored copy is the answer.
        await finish(conversationId, handle);
        return;
      }
      // A rejoinable failure that ran out of retries is a lost connection, even when
      // it surfaced as the watchdog's own abort; only a user stop is a stop.
      if (handle.cancelRequested || (isAbort(error) && !rejoinable)) handle.assistant.stopped = true;
      else handle.assistant.error = rejoinable ? CONNECTION_LOST_MESSAGE : (error as Error).message || "Request failed.";
      if (!handle.accepted) {
        // Nothing reached the server, so there is nothing to reload: keep the failure on screen.
        publish(conversationId, true);
        patchRun(conversationId, { status: "failed" });
        handles.delete(conversationId);
        return;
      }
    }
    await finish(conversationId, handle);
  }

  /* Swaps the live reply for the server's stored copy, unless that copy is
     missing: then the live reply (and any error on it) stays on screen. */
  async function finish(conversationId: string, handle: RunHandle) {
    publish(conversationId, true);
    const load = await loadThread(conversationId);
    if (handles.get(conversationId) !== handle) return;
    const messages = store.getState().threads[conversationId]?.messages ?? [];
    const stored = handle.turnRunId
      && messages.some((m) => m.role !== "user" && m.turn_run_id === handle.turnRunId);
    const keepLive = load.status === "failed" || (Boolean(handle.assistant.error) && !stored);
    if (keepLive) {
      if (load.status === "failed" && !handle.assistant.error && !handle.assistant.stopped) {
        handle.assistant.error = "This reply could not be saved to the chat yet. Reopen the chat to refresh it.";
      }
      publish(conversationId, true);
      patchRun(conversationId, { status: "failed" });
      handles.delete(conversationId);
    } else {
      dropRun(conversationId);
    }
    void loadConversations();
  }

  async function send({ conversationId, text, attachments = [] }: { conversationId: string | null; text: string; attachments?: SendAttachment[] }): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed && !attachments.length) throw new Error("Write a message first.");
    const prefs = preferences();
    let id = conversationId;
    if (!id) {
      const started = epoch;
      const conversation = await api.createConversation({ role: prefs.role });
      if (started !== epoch) throw new Error("You signed out before the chat was created.");
      id = conversation.id;
      touchConversation(conversation);
      setThread(id, { status: "ready" });
    }
    const existing = store.getState().runs[id];
    if (existing && existing.status !== "failed") throw new Error("Klui is still replying in this chat.");
    if (existing) dropRun(id);
    set((state) => {
      const { [id!]: _, ...drafts } = state.drafts;
      return { drafts };
    });

    const userMessage: StoredMessage = {
      id: `local_user_${randomId()}`,
      role: "user",
      content: attachments.length ? localUserContent(trimmed, attachments) : trimmed,
      created_at: new Date().toISOString()
    };
    void startRun({
      conversationId: id,
      userMessage,
      draftText: trimmed,
      draftAttachments: attachments,
      payload: {
        text: trimmed,
        clientTurnKey: randomId(),
        attachments: attachments.map((item) => item.id),
        role: prefs.role,
        settings: prefs.systemPrompt ? { systemPrompt: prefs.systemPrompt } : {},
        writingStyle: prefs.writingStyle,
        skillIds: [],
        skillMarks: [],
        agentMode: true,
        webSearch: prefs.webSearch
      }
    });
    return id;
  }

  async function retry(conversationId: string, assistantMessageId: string): Promise<void> {
    const existing = store.getState().runs[conversationId];
    if (existing && existing.status !== "failed") return;
    if (existing) dropRun(conversationId);
    const messages = store.getState().threads[conversationId]?.messages ?? [];
    const index = messages.findIndex((m) => m.id === assistantMessageId);
    const failed = messages[index];
    if (!failed || index <= 0 || messages[index - 1]?.role !== "user" || !canRetryMessage(failed)) return;
    const prefs = preferences();
    await startRun({
      conversationId,
      userMessage: null,
      replacesMessageId: assistantMessageId,
      payload: {
        retryAssistantMessageId: assistantMessageId,
        role: prefs.role,
        settings: prefs.systemPrompt ? { systemPrompt: prefs.systemPrompt } : {},
        writingStyle: prefs.writingStyle,
        agentMode: true,
        webSearch: prefs.webSearch
      }
    });
  }

  async function resumeTurn(conversationId: string, turnRunId: string): Promise<void> {
    if (store.getState().runs[conversationId]) return;
    await startRun({ conversationId, userMessage: null, turnRunId, payload: { turnRunId } });
  }

  async function stop(conversationId: string): Promise<void> {
    const handle = handles.get(conversationId);
    if (!handle || handle.cancelRequested) return;
    handle.cancelRequested = true;
    patchRun(conversationId, { status: "stopping" });
    if (handle.turnRunId) {
      try {
        const result = await api.cancelTurn(conversationId, handle.turnRunId);
        // Cancelled before the model started: the message is withdrawn and goes back to the composer.
        if (result?.run?.status === "cancelled") {
          const content = (result.user_message as StoredMessage | undefined)?.content;
          const text = content == null ? handle.draftText : textFromMessageContent(content);
          // A turn picked up after a restart only knows its files from the server's reply.
          const rows = (result.attachments ?? []) as Array<{ id: string; category?: string; file_name?: string; content_type?: string }>;
          const attachments = rows.length
            ? rows.map((row): SendAttachment => handle.draftAttachments.find((item) => item.id === row.id) ?? {
              id: row.id,
              category: row.category === "document" ? "document" : "image",
              fileName: row.file_name ?? "",
              contentType: row.content_type ?? "",
              url: ""
            })
            : handle.draftAttachments;
          if (text || attachments.length) set((state) => ({ drafts: { ...state.drafts, [conversationId]: { text, attachments } } }));
        }
      } catch {
        // The abort below still stops this device from following the turn.
      }
    }
    handle.abort.abort();
  }

  function takeDraft(conversationId: string): WithdrawnDraft | null {
    const draft = store.getState().drafts[conversationId] ?? null;
    if (draft) {
      set((state) => {
        const { [conversationId]: _, ...drafts } = state.drafts;
        return { drafts };
      });
    }
    return draft;
  }

  function dismissFailedRun(conversationId: string) {
    if (store.getState().runs[conversationId]?.status === "failed") dropRun(conversationId);
  }

  /** Call when the app returns from the background: a stream that stayed quiet is reattached. */
  function onAppResumed() {
    const resumedAt = Date.now();
    setTimeout(() => {
      for (const [conversationId, handle] of handles) {
        if (!handle.turnRunId || handle.cancelRequested || handle.lastEventAt >= resumedAt) continue;
        if (store.getState().runs[conversationId]?.status !== "streaming") continue;
        handle.reattaching = true;
        handle.abort.abort();
      }
    }, resumeQuietMs);
  }

  async function deleteConversation(conversationId: string) {
    await stop(conversationId);
    await api.deleteConversation(conversationId);
    dropRun(conversationId);
    set((state) => {
      const { [conversationId]: _, ...threads } = state.threads;
      return { threads, conversations: state.conversations.filter((row) => row.id !== conversationId) };
    });
  }

  async function renameConversation(conversationId: string, title: string) {
    const updated = await api.renameConversation(conversationId, title);
    set((state) => ({ conversations: state.conversations.map((row) => (row.id === conversationId ? { ...row, ...updated } : row)) }));
  }

  /** Signing out: stop following every turn (they keep running on the server) and forget the data. */
  function reset() {
    for (const handle of handles.values()) {
      if (handle.publishTimer) clearTimeout(handle.publishTimer);
      handle.cancelRequested = true;
      handle.abort.abort();
    }
    handles.clear();
    loadTokens.clear();
    epoch += 1;
    store.setState({ conversations: [], conversationsStatus: "idle", conversationsError: "", threads: {}, runs: {}, drafts: {} });
  }

  return {
    store,
    loadConversations,
    openConversation,
    loadOlder,
    send,
    retry,
    resumeTurn,
    stop,
    takeDraft,
    dismissFailedRun,
    onAppResumed,
    deleteConversation,
    renameConversation,
    reset
  };
}

export type ChatController = ReturnType<typeof createChatController>;
