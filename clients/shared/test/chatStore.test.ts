import { describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError, type ApiClient, type StreamOptions } from "../src/api";
import { CONNECTION_LOST_MESSAGE, createChatController, selectDisplayItems } from "../src/chatStore";
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
    expect(chat.takeDraft(id)).toEqual({ text: "Draft me", attachments: [] });
    expect(chat.takeDraft(id)).toBeNull();
  });

  it("a resumed turn gets its files back from the server when stopped", async () => {
    const { api } = fakeApi({
      scripts: [async (emit, signal) => {
        emit({ type: "turn:submitted", turnRunId: "r1" });
        await waitForAbort(signal);
      }]
    });
    api.cancelTurn.mockResolvedValueOnce({
      run: { status: "cancelled" },
      user_message: { id: "u1", role: "user", content: [] },
      attachments: [
        { id: "a1", category: "document", file_name: "notes.pdf", content_type: "application/pdf" },
        { id: "a2", category: "image", file_name: "photo.png", content_type: "image/png" }
      ]
    } as never);
    const chat = controllerFor(api);

    void chat.resumeTurn("c1", "r1");
    await settle();
    await chat.stop("c1");
    await vi.waitFor(() => expect(chat.store.getState().runs.c1).toBeUndefined());

    expect(chat.takeDraft("c1")).toEqual({
      text: "",
      attachments: [
        { id: "a1", category: "document", fileName: "notes.pdf", contentType: "application/pdf", url: "" },
        { id: "a2", category: "image", fileName: "photo.png", contentType: "image/png", url: "" }
      ]
    });
  });

  it("rejoins a dropped stream from the replay without duplicating text", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { api, calls } = fakeApi({
      scripts: [
        async (emit) => {
          emit({ type: "turn:submitted", turnRunId: "r1" });
          emit(delta("Part one. "));
          throw new NetworkError();
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

  it("a stream that keeps going silent ends as a lost connection, not a stop", async () => {
    const silent: Script = async (emit, signal) => {
      emit({ type: "turn:submitted", turnRunId: "r1" });
      emit(delta("Start. "));
      await waitForAbort(signal);
    };
    const { api } = fakeApi({ scripts: [silent, silent] });
    const chat = createChatController({ api, randomId: () => "id", publishIntervalMs: 0, rejoinDelaysMs: [0], stallMs: 30 });

    const id = await chat.send({ conversationId: null, text: "Go" });
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.status).toBe("failed"));
    const run = chat.store.getState().runs[id]!;
    expect(run.assistant.stopped).toBe(false);
    expect(run.assistant.error).toBe(CONNECTION_LOST_MESSAGE);
  });
});

describe("review round 1 regressions", () => {
  it("stopping during a reconnect backoff settles the run instead of wedging it", async () => {
    const { api } = fakeApi({
      scripts: [async (emit) => {
        emit({ type: "turn:submitted", turnRunId: "r1" });
        throw new NetworkError();
      }]
    });
    const chat = createChatController({ api, randomId: () => "id", publishIntervalMs: 0, rejoinDelaysMs: [50] });

    const id = await chat.send({ conversationId: null, text: "Go" });
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.status).toBe("reconnecting"));
    await chat.stop(id);
    await vi.waitFor(() => expect(chat.store.getState().runs[id]).toBeUndefined());
    await expect(chat.send({ conversationId: id, text: "Again" })).resolves.toBe(id);
  });

  it("keeps the live reply when the final reload fails, and an error the server never stored", async () => {
    const { api } = fakeApi({
      scripts: [
        async (emit) => { emit({ type: "turn:submitted", turnRunId: "r1" }); emit(delta("Kept")); },
        async (emit) => { emit({ type: "turn:submitted", turnRunId: "r2" }); emit({ type: "error", error: "Model overloaded." }); }
      ]
    });
    api.fetchConversation.mockRejectedValueOnce(new Error("offline"));
    const chat = controllerFor(api);

    const id = await chat.send({ conversationId: null, text: "One" });
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.status).toBe("failed"));
    expect(chat.store.getState().runs[id]?.assistant.content).toBe("Kept");

    await chat.send({ conversationId: id, text: "Two" });
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.assistant.error).toBe("Model overloaded."));
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.status).toBe("failed"));
  });

  it("a replay that only repeats old events does not refill the reconnect budget", async () => {
    const replayThenDrop = async (emit: (event: StreamEvent) => void) => {
      emit({ type: "turn:submitted", turnRunId: "r1" });
      emit(delta("Same. "));
      throw new NetworkError();
    };
    const { api, calls } = fakeApi({ scripts: [replayThenDrop, replayThenDrop, replayThenDrop, replayThenDrop] });
    const chat = createChatController({ api, randomId: () => "id", publishIntervalMs: 0, rejoinDelaysMs: [0, 0] });

    const id = await chat.send({ conversationId: null, text: "Go" });
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.status).toBe("failed"));
    expect(calls).toHaveLength(3);
    expect(chat.store.getState().runs[id]?.assistant.error).toMatch(/Connection lost/);
  });

  it("shows the user's message once when history loads mid-turn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { api } = fakeApi({
      scripts: [async (emit) => {
        emit({ type: "turn:submitted", turnRunId: "r1", userMessageId: "u1" });
        emit(delta("Hi"));
        await gate;
      }],
      // Like the real schema: the stored user row has no turn_run_id.
      detail: () => emptyDetail([{ id: "u1", role: "user", content: "Hello" }])
    });
    const chat = controllerFor(api);

    const id = await chat.send({ conversationId: null, text: "Hello" });
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.userMessageId).toBe("u1"));
    chat.store.setState((state) => ({ threads: { ...state.threads, [id]: { status: "ready", messages: [{ id: "u1", role: "user", content: "Hello" }], page: { hasMore: false, cursor: null }, error: "" } } }));
    expect(selectDisplayItems(chat.store.getState(), id).map((item) => item.kind)).toEqual(["stored", "live"]);
    release();
  });

  it("drops results that land after sign-out", async () => {
    let resolveList!: (rows: unknown[]) => void;
    const { api } = fakeApi();
    api.listConversations.mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve; }) as never);
    const chat = controllerFor(api);

    const loading = chat.loadConversations();
    chat.reset();
    resolveList([{ id: "a", title: "Account A secret" }]);
    await loading;
    expect(chat.store.getState().conversations).toEqual([]);
  });
});

describe("review round 2 regressions", () => {
  it("a transcript requested before sign-out never shows after signing back in", async () => {
    const pending: Array<(detail: ConversationDetail) => void> = [];
    const { api } = fakeApi();
    api.fetchConversation.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }) as never);
    const chat = controllerFor(api);

    void chat.openConversation("c1");
    chat.reset();
    void chat.openConversation("c1");
    pending[0]!(emptyDetail([{ id: "a-secret", role: "user", content: "Account A" }]));
    await settle();
    expect(chat.store.getState().threads.c1?.messages).toEqual([]);
    pending[1]!(emptyDetail([{ id: "b1", role: "user", content: "Account B" }]));
    await vi.waitFor(() => expect(chat.store.getState().threads.c1?.messages.map((m) => m.id)).toEqual(["b1"]));
  });

  it("reopening a chat replaces a kept failure with the server's stored reply", async () => {
    const stored: StoredMessage[] = [
      { id: "u1", role: "user", content: "Q" },
      { id: "a1", role: "assistant", content: "Stored answer", turn_run_id: "r1" }
    ];
    const { api } = fakeApi({
      scripts: [async (emit) => { emit({ type: "turn:submitted", turnRunId: "r1" }); emit(delta("Partial")); }],
      detail: () => emptyDetail(stored)
    });
    api.fetchConversation.mockRejectedValueOnce(new Error("offline"));
    const chat = controllerFor(api);

    const id = await chat.send({ conversationId: null, text: "Q" });
    await vi.waitFor(() => expect(chat.store.getState().runs[id]?.status).toBe("failed"));
    await chat.openConversation(id);
    expect(chat.store.getState().runs[id]).toBeUndefined();
    expect(selectDisplayItems(chat.store.getState(), id).map((item) => item.key)).toEqual(["u1", "a1"]);
  });
});
