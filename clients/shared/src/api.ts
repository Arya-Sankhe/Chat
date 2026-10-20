import { readSseStream } from "./sse";
import type { SessionManager } from "./session";
import type {
  ChatSearchHit,
  ConversationDetail,
  ConversationSummary,
  KluiConfig,
  Me,
  Plan,
  Project,
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
  /** The web page starts /api/config and /api/plans before any script loads
     (window.__kluiBoot); each prefetched response is used once, if it succeeded. */
  takeBootResponse?: (name: "config" | "plans") => Promise<Response | null> | null;
  /** The web build this page was served with. The server turns away same-origin
     writes without it (a stale tab); native clients send none. */
  buildId?: () => string;
  /** Called on a 404, 410 or 426 so the page can check for a newer build. */
  onStaleBuild?: () => void;
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
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.buildId?.() ? { "x-klui-build-id": options.buildId() } : {})
      }
    }).catch((error: unknown) => { throw transportError(error, init.signal); });

    let session = await options.session.ensureFresh();
    let response = await send(session?.access_token);
    if (response.status === 401 && session?.refresh_token && !init.signal?.aborted) {
      session = await options.session.ensureFresh({ force: true });
      if (session?.access_token) response = await send(session.access_token);
    }
    if (response.status === 401 && options.session.current() == null) options.onSessionExpired?.();
    if (!response.ok && [404, 410, 426].includes(response.status)) options.onStaleBuild?.();
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

  /** An unauthenticated GET, served from the boot prefetch when there is one. */
  async function publicJson<T>(path: string, init: RequestInit, boot?: "config" | "plans"): Promise<T> {
    const prefetched = boot ? await options.takeBootResponse?.(boot) : null;
    const response = prefetched?.ok ? prefetched : await plainFetch(url(path), init)
      .catch((error: unknown) => { throw transportError(error, null); });
    if (!response.ok) throw new ApiError(await readProblem(response), response.status);
    return response.json() as Promise<T>;
  }

  return {
    fetchConfig: () => publicJson<KluiConfig>("/api/config", { cache: "no-store" }, "config"),
    fetchPlans: () => publicJson<{ plans?: Plan[]; [key: string]: unknown }>("/api/plans", {}, "plans"),
    fetchBuild: () => publicJson<{ buildId?: string }>("/api/build", { cache: "no-store" }),

    fetchMe: () => json<Me>("/api/me"),
    fetchPaymentRequests: () => json<{ requests?: unknown[]; [key: string]: unknown }>("/api/payments/ziina"),
    listProjects: () => json<{ projects?: Project[]; [key: string]: unknown }>("/api/projects"),
    searchChats: (query: string) =>
      json<{ results?: ChatSearchHit[] }>(`/api/conversations/search?q=${encodeURIComponent(query)}`),

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
      await readSseStream(response.body, onEvent, (error) => transportError(error, signal));
    },

    cancelTurn: (conversationId: string, turnRunId: string) =>
      json<{ run?: { status?: string; [key: string]: unknown }; [key: string]: unknown }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnRunId)}/cancel`,
        jsonBody("POST", {})
      )
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
