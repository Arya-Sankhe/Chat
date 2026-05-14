import { HttpError } from "../http/responses.js";

function queryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

function single(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export class SupabaseRest {
  constructor(config) {
    this.url = config.supabase.url;
    this.serviceRoleKey = config.supabase.serviceRoleKey;
  }

  get configured() {
    return Boolean(this.url && this.serviceRoleKey);
  }

  async request(path, { method = "GET", query, body, prefer, signal } = {}) {
    if (!this.configured) {
      throw new HttpError(503, "Supabase is not configured.");
    }

    const response = await fetch(`${this.url}/rest/v1/${path}${queryString(query)}`, {
      method,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(prefer ? { prefer } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      let details;
      try {
        details = await response.json();
      } catch {
        details = await response.text();
      }

      throw new HttpError(response.status, details?.message || "Database request failed.", details);
    }

    if (response.status === 204) return null;

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async rpc(name, body, { signal } = {}) {
    return this.request(`rpc/${name}`, { method: "POST", body, signal });
  }

  async upsertProfile(user, { signal } = {}) {
    const payload = {
      id: user.id,
      email: user.email || null,
      updated_at: new Date().toISOString()
    };

    const rows = await this.request("profiles", {
      method: "POST",
      query: { on_conflict: "id" },
      body: payload,
      prefer: "resolution=merge-duplicates,return=representation",
      signal
    });

    return single(rows);
  }

  async updateProfile(userId, patch, { signal } = {}) {
    const rows = await this.request("profiles", {
      method: "PATCH",
      query: { id: `eq.${userId}` },
      body: { ...patch, updated_at: new Date().toISOString() },
      prefer: "return=representation",
      signal
    });

    return single(rows);
  }

  async getProfile(userId, { signal } = {}) {
    const rows = await this.request("profiles", {
      query: { id: `eq.${userId}`, select: "*" },
      signal
    });
    return single(rows);
  }

  async getLatestSubscription(userId, { signal } = {}) {
    const rows = await this.request("subscriptions", {
      query: {
        user_id: `eq.${userId}`,
        select: "*",
        order: "updated_at.desc",
        limit: "1"
      },
      signal
    });
    return single(rows);
  }

  async upsertSubscription(subscription, { signal } = {}) {
    const rows = await this.request("subscriptions", {
      method: "POST",
      query: { on_conflict: "provider_subscription_id" },
      body: subscription,
      prefer: "resolution=merge-duplicates,return=representation",
      signal
    });
    return single(rows);
  }

  async listConversations(userId, { signal } = {}) {
    return this.request("conversations", {
      query: {
        user_id: `eq.${userId}`,
        deleted_at: "is.null",
        select: "id,title,model,created_at,updated_at",
        order: "updated_at.desc"
      },
      signal
    });
  }

  async createConversation(userId, { title = "New chat", model = "" } = {}, { signal } = {}) {
    const rows = await this.request("conversations", {
      method: "POST",
      body: { user_id: userId, title, model: model || null },
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async getConversation(userId, conversationId, { signal } = {}) {
    const rows = await this.request("conversations", {
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

  async updateConversation(userId, conversationId, patch, { signal } = {}) {
    const rows = await this.request("conversations", {
      method: "PATCH",
      query: { id: `eq.${conversationId}`, user_id: `eq.${userId}` },
      body: { ...patch, updated_at: new Date().toISOString() },
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async deleteConversation(userId, conversationId, { signal } = {}) {
    const attachments = await this.listConversationAttachments(userId, conversationId, { signal });

    if (attachments.length) {
      await this.request("attachments", {
        method: "DELETE",
        query: {
          user_id: `eq.${userId}`,
          conversation_id: `eq.${conversationId}`
        },
        prefer: "return=minimal",
        signal
      });
    }

    const rows = await this.request("conversations", {
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

  async listConversationAttachments(userId, conversationId, { signal } = {}) {
    return this.request("attachments", {
      query: {
        user_id: `eq.${userId}`,
        conversation_id: `eq.${conversationId}`,
        select: "id,object_key"
      },
      signal
    });
  }

  async deleteMessage(userId, messageId, { signal } = {}) {
    const attachments = await this.listMessageAttachments(userId, messageId, { signal });

    if (attachments.length) {
      await this.request("attachments", {
        method: "DELETE",
        query: {
          user_id: `eq.${userId}`,
          message_id: `eq.${messageId}`
        },
        prefer: "return=minimal",
        signal
      });
    }

    const rows = await this.request("messages", {
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

  async listMessageAttachments(userId, messageId, { signal } = {}) {
    return this.request("attachments", {
      query: {
        user_id: `eq.${userId}`,
        message_id: `eq.${messageId}`,
        select: "id,object_key"
      },
      signal
    });
  }

  async listMessages(userId, conversationId, { signal } = {}) {
    return this.request("messages", {
      query: {
        user_id: `eq.${userId}`,
        conversation_id: `eq.${conversationId}`,
        select: "*",
        order: "created_at.asc"
      },
      signal
    });
  }

  async insertMessage(message, { signal } = {}) {
    const rows = await this.request("messages", {
      method: "POST",
      body: message,
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async updateMessage(userId, messageId, patch, { signal } = {}) {
    const rows = await this.request("messages", {
      method: "PATCH",
      query: { id: `eq.${messageId}`, user_id: `eq.${userId}` },
      body: patch,
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async createAttachment(attachment, { signal } = {}) {
    const rows = await this.request("attachments", {
      method: "POST",
      body: attachment,
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async completeAttachment(userId, attachmentId, patch, { signal } = {}) {
    const rows = await this.request("attachments", {
      method: "PATCH",
      query: { id: `eq.${attachmentId}`, user_id: `eq.${userId}` },
      body: { ...patch, status: "uploaded", uploaded_at: new Date().toISOString() },
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async updateAttachment(userId, attachmentId, patch, { signal } = {}) {
    const rows = await this.request("attachments", {
      method: "PATCH",
      query: { id: `eq.${attachmentId}`, user_id: `eq.${userId}` },
      body: patch,
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async getAttachment(userId, attachmentId, { signal } = {}) {
    const rows = await this.request("attachments", {
      query: {
        id: `eq.${attachmentId}`,
        user_id: `eq.${userId}`,
        select: "*",
        limit: "1"
      },
      signal
    });
    return single(rows);
  }

  async consumeUsage({ userId, planId, dailyMessageLimit, monthlyImageLimit, imageCount }, { signal } = {}) {
    return this.rpc("smartyfy_consume_usage", {
      p_user_id: userId,
      p_plan_id: planId,
      p_daily_message_limit: dailyMessageLimit,
      p_monthly_image_limit: monthlyImageLimit,
      p_image_count: imageCount
    }, { signal });
  }

  async recordUsageEvent(event, { signal } = {}) {
    const rows = await this.request("usage_events", {
      method: "POST",
      body: event,
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async getTodayUsage(userId, { signal } = {}) {
    const rows = await this.request("usage_daily", {
      query: {
        user_id: `eq.${userId}`,
        day: `eq.${new Date().toISOString().slice(0, 10)}`,
        select: "*",
        limit: "1"
      },
      signal
    });
    return single(rows);
  }

  async adminSummary({ signal } = {}) {
    const [profiles, subscriptions, usage] = await Promise.all([
      this.request("profiles", { query: { select: "id,email,role,created_at", order: "created_at.desc", limit: "25" }, signal }),
      this.request("subscriptions", { query: { select: "*", order: "updated_at.desc", limit: "25" }, signal }),
      this.request("usage_daily", { query: { select: "*", order: "day.desc", limit: "25" }, signal })
    ]);

    return { profiles, subscriptions, usage };
  }

  async getModelCache(id, { signal } = {}) {
    const rows = await this.request("model_cache", {
      query: { id: `eq.${id}`, select: "*", limit: "1" },
      signal
    });
    return single(rows);
  }

  async upsertModelCache(id, payload, { signal } = {}) {
    const rows = await this.request("model_cache", {
      method: "POST",
      query: { on_conflict: "id" },
      body: {
        id,
        payload,
        fetched_at: new Date().toISOString()
      },
      prefer: "resolution=merge-duplicates,return=representation",
      signal
    });
    return single(rows);
  }
}
