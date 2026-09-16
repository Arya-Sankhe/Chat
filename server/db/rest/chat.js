import { single } from "./helpers.js";

export async function listConversations(client, userId, { signal } = {}) {
  return client.request("conversations", {
    query: {
      user_id: `eq.${userId}`,
      deleted_at: "is.null",
      select: "id,title,project_id,created_at,updated_at",
      order: "updated_at.desc"
    },
    signal
  });
}

export async function createConversation(client, userId, { title = "New chat", model = "", projectId = null } = {}, { signal } = {}) {
  const rows = await client.request("conversations", {
    method: "POST",
    body: { user_id: userId, title, model: model || null, project_id: projectId || null },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function getConversation(client, userId, conversationId, { signal } = {}) {
  const rows = await client.request("conversations", {
    query: {
      id: `eq.${conversationId}`,
      user_id: `eq.${userId}`,
      deleted_at: "is.null",
      select: "*",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function updateConversation(client, userId, conversationId, patch, { signal } = {}) {
  const rows = await client.request("conversations", {
    method: "PATCH",
    query: { id: `eq.${conversationId}`, user_id: `eq.${userId}` },
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function listConversationAttachments(client, userId, conversationId, { signal } = {}) {
  return client.request("attachments", {
    query: {
      user_id: `eq.${userId}`,
      conversation_id: `eq.${conversationId}`,
      select: "id,object_key,category,file_name,content_type,size_bytes,etag"
    },
    signal
  });
}

export async function deleteConversation(client, userId, conversationId, { signal } = {}) {
  const attachments = await listConversationAttachments(client, userId, conversationId, { signal });

  if (attachments.length) {
    await client.request("attachments", {
      method: "DELETE",
      query: {
        user_id: `eq.${userId}`,
        conversation_id: `eq.${conversationId}`
      },
      prefer: "return=minimal",
      signal
    });
  }

  const rows = await client.request("conversations", {
    method: "DELETE",
    query: {
      id: `eq.${conversationId}`,
      user_id: `eq.${userId}`,
      deleted_at: "is.null"
    },
    prefer: "return=representation",
    signal
  });

  return single(rows);
}

export async function listMessageAttachments(client, userId, messageId, { signal } = {}) {
  return client.request("attachments", {
    query: {
      user_id: `eq.${userId}`,
      message_id: `eq.${messageId}`,
      select: "id,object_key,category,file_name,content_type,size_bytes,etag"
    },
    signal
  });
}

export async function deleteMessage(client, userId, messageId, { signal } = {}) {
  const attachments = await listMessageAttachments(client, userId, messageId, { signal });

  if (attachments.length) {
    await client.request("attachments", {
      method: "DELETE",
      query: {
        user_id: `eq.${userId}`,
        message_id: `eq.${messageId}`
      },
      prefer: "return=minimal",
      signal
    });
  }

  const rows = await client.request("messages", {
    method: "DELETE",
    query: {
      id: `eq.${messageId}`,
      user_id: `eq.${userId}`
    },
    prefer: "return=representation",
    signal
  });

  return single(rows);
}

const MESSAGE_PAGE_SIZE = 24;
const MESSAGE_PAGE_MAX = 60;

function messageSelect(includeReasoning) {
  return `id,user_id,conversation_id,role,content,model,tool_calls,finish_reason,error,created_at,metadata,turn_run_id,output_slot${includeReasoning ? ",reasoning" : ""}`;
}

export async function listMessages(client, userId, conversationId, { signal, includeReasoning = false } = {}) {
  return client.request("messages", {
    query: {
      user_id: `eq.${userId}`,
      conversation_id: `eq.${conversationId}`,
      select: messageSelect(includeReasoning),
      order: "created_at.asc"
    },
    signal
  });
}

/**
 * Newest-first page of a conversation, reversed to reading order. `cursor` is the
 * oldest row the caller already holds ({ createdAt, id }); rows that share a
 * timestamp are ordered by id so a seam can neither skip nor repeat one. The page
 * is trimmed to start on a user message so grouped runs (council / compare) do not
 * straddle a boundary; trimmed rows are older than the returned cursor, so the next
 * page picks them up. The last page is never trimmed, since nothing follows it.
 */
export async function listMessagesPage(client, userId, conversationId, { signal, includeReasoning = false, limit = MESSAGE_PAGE_SIZE, cursor = null } = {}) {
  const requested = Number(limit);
  const size = limit == null || limit === "" || !Number.isFinite(requested)
    ? MESSAGE_PAGE_SIZE
    : Math.max(1, Math.min(MESSAGE_PAGE_MAX, Math.trunc(requested)));
  const rows = await client.request("messages", {
    query: {
      user_id: `eq.${userId}`,
      conversation_id: `eq.${conversationId}`,
      select: messageSelect(includeReasoning),
      order: "created_at.desc,id.desc",
      limit: String(size + 1), // one spare row is what tells us older messages exist
      ...(cursor?.createdAt && cursor?.id
        ? { or: `(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))` }
        : {})
    },
    signal
  });

  const hasMore = rows.length > size;
  const page = (hasMore ? rows.slice(0, size) : rows).reverse();
  const firstUser = hasMore ? page.findIndex((message) => message.role === "user") : -1;
  const messages = firstUser > 0 ? page.slice(firstUser) : page;
  const oldest = messages[0];
  return {
    messages,
    hasMore,
    cursor: oldest ? { createdAt: oldest.created_at, id: oldest.id } : null
  };
}

export async function listRecentAssistantMessages(client, userId, conversationId, { signal, limit = 10, offset = 0 } = {}) {
  return client.request("messages", {
    query: {
      user_id: `eq.${userId}`,
      conversation_id: `eq.${conversationId}`,
      role: "eq.assistant",
      select: "content",
      order: "created_at.desc,id.desc",
      limit: String(limit),
      ...(offset ? { offset: String(offset) } : {})
    },
    signal
  });
}

export async function searchMessages(client, userId, query, { signal, limit = 30 } = {}) {
  return client.rpc("klui_search_messages", { p_user_id: userId, p_query: query, p_limit: limit }, { signal });
}

export async function insertMessage(client, message, { signal } = {}) {
  const rows = await client.request("messages", {
    method: "POST",
    body: message,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function updateMessage(client, userId, messageId, patch, { signal } = {}) {
  const rows = await client.request("messages", {
    method: "PATCH",
    query: { id: `eq.${messageId}`, user_id: `eq.${userId}` },
    body: patch,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}
