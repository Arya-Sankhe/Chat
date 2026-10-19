import { readSseStream } from "./sse";
import type { SessionManager } from "./session";
import type {
  ConversationDetail,
  ConversationSummary,
  KluiConfig,
  Me,
  SendPayload,
  StreamEvent
} from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** The request never got an answer: offline, refused, or cut off mid-stream.
   Each platform's fetch words this differently (browsers throw TypeError,
   expo/fetch throws plain Errors with native messages), so the client
   normalizes them here and callers only check the class. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("Can't reach Klui. Check your connection and try again.", { cause });
    this.name = "NetworkError";
  }
}

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

function transportError(error: unknown, signal: AbortSignal | null | undefined): unknown {
  if (signal?.aborted || (error as { name?: string })?.name === "AbortError") return abortError();
  return error instanceof ApiError ? error : new NetworkError(error);
}

export interface ApiClientOptions {
  /** "" for same-origin web, "https://klui.ai" for native. */
  baseUrl: string;
  session: SessionManager;
  fetch?: typeof fetch;
  /** A fetch whose response body streams. React Native passes expo/fetch here. */
  streamFetch?: typeof fetch;
  onSessionExpired?: () => void;
}

export interface StreamOptions {
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
}

async function readProblem(response: Response): Promise<string> {
  try {
    const json = await response.json() as { error?: string };
    return json.error || "Request failed.";
  } catch {
    return response.statusText || "Request failed.";
  }
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const plainFetch = options.fetch ?? fetch;
  const streamFetch = options.streamFetch ?? plainFetch;
  const url = (path: string) => `${baseUrl}${path}`;

  async function request(path: string, init: RequestInit = {}, { stream = false } = {}): Promise<Response> {
    const doFetch = stream ? streamFetch : plainFetch;
    const send = (token: string | undefined) => doFetch(url(path), {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    }).catch((error: unknown) => { throw transportError(error, init.signal); });

    let session = await options.session.ensureFresh();
    let response = await send(session?.access_token);
    if (response.status === 401 && session?.refresh_token && !init.signal?.aborted) {
      session = await options.session.ensureFresh({ force: true });
      if (session?.access_token) response = await send(session.access_token);
    }
    if (response.status === 401 && options.session.current() == null) options.onSessionExpired?.();
    return response;
  }

  async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await request(path, init);
    if (!response.ok) throw new ApiError(await readProblem(response), response.status);
    return response.json() as Promise<T>;
  }

  const jsonBody = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  return {
    async fetchConfig(): Promise<KluiConfig> {
      const response = await plainFetch(url("/api/config"), { cache: "no-store" })
        .catch((error: unknown) => { throw transportError(error, null); });
      if (!response.ok) throw new ApiError(await readProblem(response), response.status);
      return response.json() as Promise<KluiConfig>;
    },

    fetchMe: () => json<Me>("/api/me"),

    async listConversations({ limit }: { limit?: number } = {}): Promise<ConversationSummary[]> {
      const { conversations } = await json<{ conversations: ConversationSummary[] }>(
        `/api/conversations${limit ? `?limit=${limit}` : ""}`
      );
      return conversations;
    },

    async createConversation(body: { title?: string; role?: string; projectId?: string } = {}): Promise<ConversationSummary> {
      const { conversation } = await json<{ conversation: ConversationSummary }>("/api/conversations", jsonBody("POST", body));
      return conversation;
    },

    fetchConversation(id: string, { limit, cursor }: { limit?: number; cursor?: string | null } = {}) {
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      const query = params.toString();
      return json<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}${query ? `?${query}` : ""}`);
    },

    async renameConversation(id: string, title: string): Promise<ConversationSummary> {
      const { conversation } = await json<{ conversation: ConversationSummary }>(
        `/api/conversations/${encodeURIComponent(id)}`,
        jsonBody("PATCH", { title })
      );
      return conversation;
    },

    deleteConversation: (id: string) =>
      json<unknown>(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),

    /** Streams one turn. Acceptance and the turn's run id arrive as a synthetic `turn:submitted` event. */
    async streamMessage(conversationId: string, payload: SendPayload, { signal, onEvent }: StreamOptions): Promise<void> {
      const response = await request(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        { ...jsonBody("POST", payload), ...(signal ? { signal } : {}) },
        { stream: true }
      );
      if (!response.ok) throw new ApiError(await readProblem(response), response.status);
      // Emitted on every accepted request, so callers know the server owns the turn now.
      onEvent({
        type: "turn:submitted",
        turnRunId: response.headers.get("x-klui-turn-run-id") || "",
        userMessageId: response.headers.get("x-klui-user-message-id") || ""
      });
      if (!response.body) throw new Error("Streaming is not available on this device.");
      // A throw from onEvent is the caller's bug, not the network's; it passes through as is.
      let callbackError: unknown;
      try {
        await readSseStream(response.body, (event) => {
          try { onEvent(event); } catch (error) { callbackError = error; throw error; }
        });
      } catch (error) {
        throw error === callbackError ? error : transportError(error, signal);
      }
    },

    cancelTurn: (conversationId: string, turnRunId: string) =>
      json<{ run?: { status?: string; [key: string]: unknown }; [key: string]: unknown }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnRunId)}/cancel`,
        jsonBody("POST", {})
      )
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
