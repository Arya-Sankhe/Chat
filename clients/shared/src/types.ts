/* Wire shapes of the existing Klui API. Only the fields the clients read are
   typed; the server sends more, which pass through untouched. */

export interface Session {
  access_token: string;
  refresh_token: string | null;
  /** Unix seconds. */
  expires_at: number;
  token_type: string;
}

export interface KluiConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  auth?: { googleClientId?: string; googleEnabled?: boolean };
  [key: string]: unknown;
}

export interface Me {
  user?: { id: string; email?: string; [key: string]: unknown };
  profile?: { role?: string; display_name?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ConversationSummary {
  id: string;
  title: string;
  model?: string;
  project_id?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export type ContentPart = string | { type: string; text?: string; [key: string]: unknown };
export type MessageContent = string | ContentPart[] | null;

/** A message row as `GET /api/conversations/:id` returns it. */
export interface StoredMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: MessageContent;
  model?: string | null;
  reasoning?: string | null;
  tool_calls?: unknown[] | null;
  finish_reason?: string | null;
  error?: string | null;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
  turn_run_id?: string | null;
  output_slot?: string | null;
  [key: string]: unknown;
}

export interface PendingTurn {
  id: string;
  conversation_id?: string;
  status?: string;
  request_payload?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface MessagePage {
  hasMore: boolean;
  cursor: string | null;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: StoredMessage[];
  pendingTurns: PendingTurn[];
  page: MessagePage;
}

export interface ToolCallDelta {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface ToolEvent {
  id: string;
  name: string;
  query?: string;
  status: "running" | "done" | "error" | "limit";
  error?: string;
  cached?: boolean;
  provider?: string;
  resultCount?: number;
  limit?: unknown;
}

export interface Citation {
  index: number;
  url?: string;
  title?: string;
  [key: string]: unknown;
}

export interface ActivityItem {
  key: string;
  kind: "step" | "thought";
  text: string;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

/** The assistant reply being built from stream events. */
export interface LiveAssistant {
  id: string;
  role: "assistant";
  content: string;
  reasoning: string;
  model: string;
  toolCalls: ToolCallDelta[];
  toolEvents: ToolEvent[];
  citations: Citation[];
  activity: ActivityItem[];
  artifacts: unknown[];
  finishReason: string;
  error: string;
  stopped: boolean;
  usage: Usage | null;
  metadata: Record<string, unknown> | null;
  illustrationStatus: string;
  activityStartedAt: number;
  activityEndedAt: number;
  reasoningStartedAt: number;
  reasoningEndedAt: number;
  resetContentOnNextTextDelta: boolean;
}

/** Any SSE `data:` payload. The server mixes OpenAI-style chunks with typed events. */
export interface StreamEvent {
  type?: string;
  [key: string]: unknown;
}

export interface SendPayload {
  text?: string;
  clientTurnKey?: string;
  attachments?: string[];
  role?: string;
  settings?: { systemPrompt?: string };
  writingStyle?: string;
  skillIds?: string[];
  skillMarks?: unknown[];
  agentMode?: boolean;
  webSearch?: "auto" | "off";
  turnRunId?: string;
  retryAssistantMessageId?: string;
  [key: string]: unknown;
}
