import { single } from "./helpers.js";

export async function listConversations(client, userId, { signal } = {}) {
  return client.request("conversations", {
    query: {
      user_id: `eq.${userId}`,
      deleted_at: "is.null",
      select: "id,title,model,created_at,updated_at",
      order: "updated_at.desc"
    },
    signal
  });
}

export async function createConversation(client, userId, { title = "New chat", model = "" } = {}, { signal } = {}) {
  const rows = await client.request("conversations", {
    method: "POST",
    body: { user_id: userId, title, model: model || null },
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

export async function listMessages(client, userId, conversationId, { signal } = {}) {
  return client.request("messages", {
    query: {
      user_id: `eq.${userId}`,
      conversation_id: `eq.${conversationId}`,
      select: "*",
      order: "created_at.asc"
    },
    signal
  });
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
