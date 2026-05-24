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

function isMissingMessageCountRpc(error) {
  const text = `${error?.message || ""} ${JSON.stringify(error?.details || {})}`;
  return /p_message_count|schema cache|smartyfy_consume_usage/i.test(text);
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
        select: "id,object_key,category,file_name,content_type,size_bytes,etag"
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
        select: "id,object_key,category,file_name,content_type,size_bytes,etag"
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

  async createDocumentFile(documentFile, { signal } = {}) {
    const rows = await this.request("document_files", {
      method: "POST",
      body: documentFile,
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async getDocumentFile(userId, documentFileId, { signal } = {}) {
    const rows = await this.request("document_files", {
      query: {
        id: `eq.${documentFileId}`,
        user_id: `eq.${userId}`,
        select: "*",
        limit: "1"
      },
      signal
    });
    return single(rows);
  }

  async getDocumentFileByAttachment(userId, attachmentId, { signal } = {}) {
    const rows = await this.request("document_files", {
      query: {
        attachment_id: `eq.${attachmentId}`,
        user_id: `eq.${userId}`,
        select: "*",
        limit: "1"
      },
      signal
    });
    return single(rows);
  }

  async getReadyPdfPreviewForDocument(userId, documentFileId, { signal } = {}) {
    const rows = await this.request("document_files", {
      query: {
        parent_document_id: `eq.${documentFileId}`,
        user_id: `eq.${userId}`,
        kind: "eq.pdf",
        processing_status: "eq.ready",
        select: "*,attachments(id,file_name,content_type,size_bytes,object_key,etag,status)",
        order: "created_at.desc",
        limit: "1"
      },
      signal
    });
    return single(rows);
  }

  async getActivePdfPreviewJob(userId, documentFileId, { signal } = {}) {
    const rows = await this.request("document_jobs", {
      query: {
        user_id: `eq.${userId}`,
        document_file_id: `eq.${documentFileId}`,
        status: "in.(queued,running)",
        job_type: "in.(document.export.docx_to_pdf,document.export.xlsx_to_pdf)",
        select: "*",
        order: "created_at.desc",
        limit: "1"
      },
      signal
    });
    return single(rows);
  }

  async listReadyDocumentFiles(userId, conversationId, { signal } = {}) {
    return this.request("document_files", {
      query: {
        user_id: `eq.${userId}`,
        conversation_id: `eq.${conversationId}`,
        processing_status: "eq.ready",
        select: "*,attachments(id,file_name,content_type,size_bytes,object_key,etag)",
        order: "created_at.asc"
      },
      signal
    });
  }

  async listDocumentFilesByAttachments(userId, attachmentIds = [], { signal } = {}) {
    const ids = [...new Set(attachmentIds.filter(Boolean))];
    if (!ids.length) return [];
    return this.request("document_files", {
      query: {
        user_id: `eq.${userId}`,
        attachment_id: `in.(${ids.join(",")})`,
        select: "*,attachments(id,file_name,content_type,size_bytes,object_key,etag)"
      },
      signal
    });
  }

  async updateDocumentFile(userId, documentFileId, patch, { signal } = {}) {
    const rows = await this.request("document_files", {
      method: "PATCH",
      query: { id: `eq.${documentFileId}`, user_id: `eq.${userId}` },
      body: { ...patch, updated_at: new Date().toISOString() },
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async updateDocumentFileByAttachment(userId, attachmentId, patch, { signal } = {}) {
    const rows = await this.request("document_files", {
      method: "PATCH",
      query: { attachment_id: `eq.${attachmentId}`, user_id: `eq.${userId}` },
      body: { ...patch, updated_at: new Date().toISOString() },
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async createDocumentJob(job, { signal } = {}) {
    const rows = await this.request("document_jobs", {
      method: "POST",
      body: job,
      prefer: "return=representation",
      signal
    });
    return single(rows);
  }

  async getDocumentJob(userId, jobId, { signal } = {}) {
    const rows = await this.request("document_jobs", {
      query: { id: `eq.${jobId}`, user_id: `eq.${userId}`, select: "*", limit: "1" },
      signal
    });
    return single(rows);
  }

  async listDocumentChunks(userId, documentFileId, { limit = 20, sourceType = "", signal } = {}) {
    return this.request("document_chunks", {
      query: {
        user_id: `eq.${userId}`,
        document_file_id: `eq.${documentFileId}`,
        ...(sourceType ? { source_type: `eq.${sourceType}` } : {}),
        select: "id,document_file_id,chunk_index,source_type,source_label,text,metadata",
        order: "chunk_index.asc",
        limit: String(limit)
      },
      signal
    });
  }

  async listDocumentPages(userId, documentFileId, { limit = 40, pageStart = null, pageEnd = null, signal } = {}) {
    return this.request("document_pages", {
      query: {
        user_id: `eq.${userId}`,
        document_file_id: `eq.${documentFileId}`,
        ...(pageStart ? { page_number: `gte.${pageStart}` } : {}),
        ...(pageEnd ? { and: `(page_number.lte.${pageEnd})` } : {}),
        select: "id,document_file_id,page_number,source_label,image_key,image_content_type,width_px,height_px,text,metadata",
        order: "page_number.asc",
        limit: String(limit)
      },
      signal
    });
  }

  async searchDocumentPages({ userId, documentFileIds = [], queryEmbedding = "", limit = 8 }, { signal } = {}) {
    return this.rpc("smartyfy_search_document_pages", {
      p_user_id: userId,
      p_document_ids: documentFileIds,
      p_query_embedding: queryEmbedding,
      p_limit: limit
    }, { signal });
  }

  async deleteAttachment(userId, attachmentId, { signal } = {}) {
    return this.request("attachments", {
      method: "DELETE",
      query: { id: `eq.${attachmentId}`, user_id: `eq.${userId}` },
      prefer: "return=minimal",
      signal
    });
  }

  async searchDocumentChunks({ userId, documentFileIds = [], query = "", limit = 5 }, { signal } = {}) {
    return this.rpc("smartyfy_search_document_chunks", {
      p_user_id: userId,
      p_document_ids: documentFileIds,
      p_query: query,
      p_limit: limit
    }, { signal });
  }

  async consumeUsage({ userId, planId, dailyMessageLimit, monthlyImageLimit, imageCount, messageCount = 1 }, { signal } = {}) {
    const body = {
      p_user_id: userId,
      p_plan_id: planId,
      p_daily_message_limit: dailyMessageLimit,
      p_monthly_image_limit: monthlyImageLimit,
      p_image_count: imageCount
    };

    if (messageCount !== 1) body.p_message_count = messageCount;

    try {
      return await this.rpc("smartyfy_consume_usage", body, { signal });
    } catch (error) {
      if (!isMissingMessageCountRpc(error)) throw error;
    }

    let usage;
    for (let i = 0; i < messageCount; i++) {
      usage = await this.rpc("smartyfy_consume_usage", {
        p_user_id: userId,
        p_plan_id: planId,
        p_daily_message_limit: dailyMessageLimit,
        p_monthly_image_limit: monthlyImageLimit,
        p_image_count: i === 0 ? imageCount : 0
      }, { signal });

      if (!usage?.allowed) return usage;
    }

    return {
      ...usage,
      consumed_message_count: messageCount,
      legacy_usage_fallback: true
    };
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

  async consumeSearch({ userId, planId, dailySearchLimit, searchCount = 1 }, { signal } = {}) {
    return this.rpc("smartyfy_consume_search", {
      p_user_id: userId,
      p_plan_id: planId,
      p_daily_search_limit: dailySearchLimit,
      p_search_count: searchCount
    }, { signal });
  }

  async consumeDocuments({
    userId,
    planId,
    dailyDocumentToolLimit,
    dailyGeneratedDocumentLimit,
    toolCount = 1,
    generatedCount = 0
  }, { signal } = {}) {
    return this.rpc("smartyfy_consume_documents", {
      p_user_id: userId,
      p_plan_id: planId,
      p_daily_document_tool_limit: dailyDocumentToolLimit,
      p_daily_generated_document_limit: dailyGeneratedDocumentLimit,
      p_tool_count: toolCount,
      p_generated_count: generatedCount
    }, { signal });
  }

  async getSearchCache(queryHash, { signal } = {}) {
    if (!this.configured) return null;
    try {
      const rows = await this.request("search_cache", {
        query: { query_hash: `eq.${queryHash}`, select: "*", limit: "1" },
        signal
      });
      return single(rows);
    } catch {
      return null;
    }
  }

  async upsertSearchCache(row, { signal } = {}) {
    if (!this.configured) return null;
    return this.request("search_cache", {
      method: "POST",
      query: { on_conflict: "query_hash" },
      body: row,
      prefer: "resolution=merge-duplicates,return=minimal",
      signal
    });
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
