import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient, type StreamOptions } from "../src/api";
import { createChatController, selectDisplayItems } from "../src/chatStore";
import type { ConversationDetail, SendPayload, StoredMessage, StreamEvent } from "../src/types";

/* A scripted server: each streamMessage call takes the next script, which
   emits events and may throw to simulate drops or aborts. */
type Script = (emit: (event: StreamEvent) => void, signal: AbortSignal | undefined, payload: SendPayload) => Promise<void>;

function fakeApi({ scripts = [] as Script[], detail = (): ConversationDetail => emptyDetail() } = {}) {
  const calls: SendPayload[] = [];
  const api = {
    listConversations: vi.fn(async () => []),
    createConversation: vi.fn(async () => ({ id: "c1", title: "New chat" })),
    fetchConversation: vi.fn(async () => detail()),
    cancelTurn: vi.fn(async () => ({ run: { status: "running" } })),
    deleteConversation: vi.fn(async () => ({})),
    renameConversation: vi.fn(),
    async streamMessage(_id: string, payload: SendPayload, { signal, onEvent }: StreamOptions) {
      calls.push(payload);
      const script = scripts.shift();
      if (!script) throw new Error("No scripted response left.");
      await script(onEvent, signal, payload);
    }
  };
  return { api: api as unknown as ApiClient & typeof api, calls };
}

function emptyDetail(messages: StoredMessage[] = []): ConversationDetail {
  return { conversation: { id: "c1", title: "Chat" }, messages, pendingTurns: [], page: { hasMore: false, cursor: null } };
}

const delta = (content: string) => ({ choices: [{ delta: { content } }] });
const waitForAbort = (signal?: AbortSignal) => new Promise<never>((_, reject) => {
  signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function controllerFor(api: ApiClient) {
  let n = 0;
  return createChatController({ api, randomId: () => `id${++n}`, publishIntervalMs: 0, rejoinDelaysMs: [0, 0] });
}

describe("chat controller", () => {
  it("streams a new chat, then swaps the live reply for the stored transcript", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const stored: StoredMessage[] = [
      { id: "u1", role: "user", content: "Hi" },
      { id: "a1", role: "assistant", content: "Hello!", turn_run_id: "r1" }
    ];
    const { api, calls } = fakeApi({
      scripts: [async (emit) => {
        emit({ type: "turn:submitted", turnRunId: "r1" });
        emit(delta("Hel"));
        emit(delta("lo!"));
        await gate;
      }],
      detail: () => emptyDetail(stored)
    });
    const chat = controllerFor(api);

    const id = await chat.send({ conversationId: null, text: "  Hi " });
    await settle();
    expect(id).toBe("c1");
    expect(calls[0]).toMatchObject({ text: "Hi", clientTurnKey: expect.any(String), role: "think", agentMode: true });
    const live = selectDisplayItems(chat.store.getState(), id);
    expect(live.map((item) => item.kind)).toEqual(["local-user", "live"]);
    expect(live[1]!.message.content).toBe("Hello!");

    release();
    await vi.waitFor(() => expect(chat.store.getState().runs[id]).toBeUndefined());
    expect(selectDisplayItems(chat.store.getState(), id).map((item) => item.key)).toEqual(["u1", "a1"]);
  });

  it("stopping a turn that never started hands the text back to the composer", async () => {
    const { api } = fakeApi({
      scripts: [async (emit, signal) => {
        emit({ type: "turn:submitted", turnRunId: "r1" });
        await waitForAbort(signal);
      }]
    });
    api.cancelTurn.mockResolvedValueOnce({ run: { status: "cancelled" }, user_message: { id: "u1", role: "user", content: "Draft me" } } as never);
    const chat = controllerFor(api);

    const id = await chat.send({ conversationId: null, text: "Draft me" });
    await settle();
    await chat.stop(id);
    await vi.waitFor(() => expect(chat.store.getState().runs[id]).toBeUndefined());

    expect(api.cancelTurn).toHaveBeenCalledWith("c1", "r1");
    expect(chat.takeDraft(id)).toBe("Draft me");
    expect(chat.takeDraft(id)).toBe("");
  });

  it("rejoins a dropped stream from the replay without duplicating text", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { api, calls } = fakeApi({
      scripts: [
        async (emit) => {
          emit({ type: "turn:submitted", turnRunId: "r1" });
          emit(delta("Part one. "));
          throw new TypeError("Network request failed");
        },
        async (emit) => {
          emit({ type: "turn:submitted", turnRunId: "r1" });
          emit(delta("Part one. "));
          emit(delta("Part two."));
          await gate;
        }
      ]
    });
    const chat = controllerFor(api);

    const id = await chat.send({ conversationId: null, text: "Go" });
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.assistant.content).toBe("Part one. Part two."));
    expect(calls[1]).toEqual({ turnRunId: "r1" });
    release();
    await vi.waitFor(() => expect(chat.store.getState().runs[id]).toBeUndefined());
  });

  it("keeps a request the server rejected on screen with its error", async () => {
    const { api } = fakeApi({ scripts: [async () => { throw new ApiError("Daily limit reached.", 402); }] });
    const chat = controllerFor(api);

    const id = await chat.send({ conversationId: null, text: "Hi" });
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.status).toBe("failed"));
    const items = selectDisplayItems(chat.store.getState(), id);
    expect(items.map((item) => item.kind)).toEqual(["local-user", "live"]);
    expect(items[1]!.message).toMatchObject({ error: "Daily limit reached." });
    expect(api.fetchConversation).not.toHaveBeenCalled();
  });

  it("opening a chat with a pending turn resumes it in place of its partial output", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const partial: StoredMessage[] = [
      { id: "u1", role: "user", content: "Q" },
      { id: "a1", role: "assistant", content: "Par", turn_run_id: "r9" }
    ];
    let first = true;
    const { api, calls } = fakeApi({
      scripts: [async (emit) => { emit(delta("Partial and more")); await gate; }],
      detail: () => {
        const detail = emptyDetail(partial);
        if (first) detail.pendingTurns = [{ id: "r9" }];
        first = false;
        return detail;
      }
    });
    const chat = controllerFor(api);

    await chat.openConversation("c1");
    await vi.waitFor(() => expect(chat.store.getState().runs.c1?.assistant.content).toBe("Partial and more"));
    expect(calls[0]).toEqual({ turnRunId: "r9" });
    expect(selectDisplayItems(chat.store.getState(), "c1").map((item) => item.kind)).toEqual(["stored", "live"]);
    release();
    await vi.waitFor(() => expect(chat.store.getState().runs.c1).toBeUndefined());
  });

  it("retry streams in place of the failed reply", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const messages: StoredMessage[] = [
      { id: "u1", role: "user", content: "Q" },
      { id: "a1", role: "assistant", content: "", error: "Model failed" },
      { id: "u2", role: "user", content: "Later" },
      { id: "a2", role: "assistant", content: "Fine" }
    ];
    const { api, calls } = fakeApi({
      scripts: [async (emit) => { emit({ type: "turn:submitted", turnRunId: "" }); emit(delta("Retried")); await gate; }],
      detail: () => emptyDetail(messages)
    });
    const chat = controllerFor(api);
    await chat.openConversation("c1");

    void chat.retry("c1", "a1");
    await vi.waitFor(() => expect(chat.store.getState().runs.c1?.assistant.content).toBe("Retried"));
    expect(calls[0]).toMatchObject({ retryAssistantMessageId: "a1" });
    expect(selectDisplayItems(chat.store.getState(), "c1").map((item) => item.kind)).toEqual(["stored", "live", "stored", "stored"]);
    release();
    await vi.waitFor(() => expect(chat.store.getState().runs.c1).toBeUndefined());
  });
});

describe("half-open connections", () => {
  it("reattaches a durable turn whose stream goes silent", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { api, calls } = fakeApi({
      scripts: [
        async (emit, signal) => {
          emit({ type: "turn:submitted", turnRunId: "r1" });
          emit(delta("Start. "));
          await waitForAbort(signal); // never delivers another byte
        },
        async (emit) => {
          emit({ type: "turn:submitted", turnRunId: "r1" });
          emit(delta("Start. Rest."));
          await gate;
        }
      ]
    });
    const chat = createChatController({ api, randomId: () => "id", publishIntervalMs: 0, rejoinDelaysMs: [0], stallMs: 30 });

    const id = await chat.send({ conversationId: null, text: "Go" });
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.assistant.content).toBe("Start. Rest."));
    expect(calls[1]).toEqual({ turnRunId: "r1" });
    release();
    await vi.waitFor(() => expect(chat.store.getState().runs[id]).toBeUndefined());
  });
});
