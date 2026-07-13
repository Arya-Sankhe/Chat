import { HttpError } from "../http/responses.js";
import * as admin from "./rest/admin.js";
import * as attachments from "./rest/attachments.js";
import * as billing from "./rest/billing.js";
import * as caches from "./rest/caches.js";
import * as chat from "./rest/chat.js";
import * as documents from "./rest/documents.js";
import * as payments from "./rest/payments.js";
import * as profiles from "./rest/profiles.js";
import * as research from "./rest/research.js";
import * as subscriptions from "./rest/subscriptions.js";
import * as turns from "./rest/turns.js";

function queryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
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

  async upsertProfile(user, options) {
    return profiles.upsertProfile(this, user, options);
  }

  async updateProfile(userId, patch, options) {
    return profiles.updateProfile(this, userId, patch, options);
  }

  async getAppSetting(key, options) {
    return admin.getAppSetting(this, key, options);
  }

  async upsertAppSetting(key, value, updatedBy, options) {
    return admin.upsertAppSetting(this, key, value, updatedBy, options);
  }

  async getProfile(userId, options) {
    return profiles.getProfile(this, userId, options);
  }

  async getLatestSubscription(userId, options) {
    return subscriptions.getLatestSubscription(this, userId, options);
  }

  async upsertSubscription(subscription, options) {
    return subscriptions.upsertSubscription(this, subscription, options);
  }

  async createPaymentRequest(row, options) {
    return payments.createPaymentRequest(this, row, options);
  }

  async listPaymentRequests(userId, options) {
    return payments.listPaymentRequests(this, userId, options);
  }

  async listPendingPaymentRequests(options) {
    return payments.listPendingPaymentRequests(this, options);
  }

  async getPaymentRequest(id, options) {
    return payments.getPaymentRequest(this, id, options);
  }

  async updatePaymentRequest(id, patch, options) {
    return payments.updatePaymentRequest(this, id, patch, options);
  }

  async listConversations(userId, options) {
    return chat.listConversations(this, userId, options);
  }

  async createConversation(userId, conversation, options) {
    return chat.createConversation(this, userId, conversation, options);
  }

  async getConversation(userId, conversationId, options) {
    return chat.getConversation(this, userId, conversationId, options);
  }

  async updateConversation(userId, conversationId, patch, options) {
    return chat.updateConversation(this, userId, conversationId, patch, options);
  }

  async deleteConversation(userId, conversationId, options) {
    return chat.deleteConversation(this, userId, conversationId, options);
  }

  async listConversationAttachments(userId, conversationId, options) {
    return chat.listConversationAttachments(this, userId, conversationId, options);
  }

  async deleteMessage(userId, messageId, options) {
    return chat.deleteMessage(this, userId, messageId, options);
  }

  async listMessageAttachments(userId, messageId, options) {
    return chat.listMessageAttachments(this, userId, messageId, options);
  }

  async listMessages(userId, conversationId, options) {
    return chat.listMessages(this, userId, conversationId, options);
  }

  async insertMessage(message, options) {
    return chat.insertMessage(this, message, options);
  }

  async updateMessage(userId, messageId, patch, options) {
    return chat.updateMessage(this, userId, messageId, patch, options);
  }

  async submitDocumentTurn(params, options) {
    return turns.submitDocumentTurn(this, params, options);
  }

  async getPendingDocumentTurn(userId, turnId, options) {
    return turns.getPendingDocumentTurn(this, userId, turnId, options);
  }

  async listPendingDocumentTurns(userId, conversationId, options) {
    return turns.listPendingDocumentTurns(this, userId, conversationId, options);
  }

  async claimPendingDocumentTurn(params, options) {
    return turns.claimPendingDocumentTurn(this, params, options);
  }

  async heartbeatPendingDocumentTurn(params, options) {
    return turns.heartbeatPendingDocumentTurn(this, params, options);
  }

  async releasePendingDocumentTurn(params, options) {
    return turns.releasePendingDocumentTurn(this, params, options);
  }

  async markPendingTurnProviderStarted(params, options) {
    return turns.markPendingTurnProviderStarted(this, params, options);
  }

  async finishPendingDocumentTurn(params, options) {
    return turns.finishPendingDocumentTurn(this, params, options);
  }

  async cancelPendingDocumentTurn(userId, turnId, options) {
    return turns.cancelPendingDocumentTurn(this, userId, turnId, options);
  }

  async upsertTurnOutputMessage(message, options) {
    return turns.upsertTurnOutputMessage(this, message, options);
  }

  async updatePendingTurnOutput(params, options) {
    return turns.updatePendingTurnOutput(this, params, options);
  }

  async createAttachment(attachment, options) {
    return attachments.createAttachment(this, attachment, options);
  }

  async listOrphanAttachments(options) {
    return attachments.listOrphanAttachments(this, options);
  }

  async completeAttachment(userId, attachmentId, patch, options) {
    return attachments.completeAttachment(this, userId, attachmentId, patch, options);
  }

  async updateAttachment(userId, attachmentId, patch, options) {
    return attachments.updateAttachment(this, userId, attachmentId, patch, options);
  }

  async getAttachment(userId, attachmentId, options) {
    return attachments.getAttachment(this, userId, attachmentId, options);
  }

  async createDocumentFile(documentFile, options) {
    return documents.createDocumentFile(this, documentFile, options);
  }

  async getDocumentFile(userId, documentFileId, options) {
    return documents.getDocumentFile(this, userId, documentFileId, options);
  }

  async getDocumentFileByAttachment(userId, attachmentId, options) {
    return documents.getDocumentFileByAttachment(this, userId, attachmentId, options);
  }

  async getReadyPdfPreviewForDocument(userId, documentFileId, options) {
    return documents.getReadyPdfPreviewForDocument(this, userId, documentFileId, options);
  }

  async getActivePdfPreviewJob(userId, documentFileId, options) {
    return documents.getActivePdfPreviewJob(this, userId, documentFileId, options);
  }

  async listReadyDocumentFiles(userId, conversationId, options) {
    return documents.listReadyDocumentFiles(this, userId, conversationId, options);
  }

  async listUsableDocumentFiles(userId, conversationId, options) {
    return documents.listUsableDocumentFiles(this, userId, conversationId, options);
  }

  async listDocumentFilesByAttachments(userId, attachmentIds, options) {
    return documents.listDocumentFilesByAttachments(this, userId, attachmentIds, options);
  }

  async updateDocumentFile(userId, documentFileId, patch, options) {
    return documents.updateDocumentFile(this, userId, documentFileId, patch, options);
  }

  async updateDocumentFileByAttachment(userId, attachmentId, patch, options) {
    return documents.updateDocumentFileByAttachment(this, userId, attachmentId, patch, options);
  }

  async createDocumentJob(job, options) {
    return documents.createDocumentJob(this, job, options);
  }

  async completeDocumentUpload(params, options) {
    return documents.completeDocumentUpload(this, params, options);
  }

  async getDocumentJob(userId, jobId, options) {
    return documents.getDocumentJob(this, userId, jobId, options);
  }

  async createResearchRun(run, options) {
    return research.createResearchRun(this, run, options);
  }

  async getResearchRun(userId, runId, options) {
    return research.getResearchRun(this, userId, runId, options);
  }

  async listActiveResearchRuns(userId, conversationId, options) {
    return research.listActiveResearchRuns(this, userId, conversationId, options);
  }

  async updateResearchRun(runId, patch, options) {
    return research.updateResearchRun(this, runId, patch, options);
  }

  async claimResearchRun(workerId, leaseSeconds, options) {
    return research.claimResearchRun(this, workerId, leaseSeconds, options);
  }

  async failExpiredResearchRuns(options) {
    return research.failExpiredResearchRuns(this, options);
  }

  async listDocumentChunks(userId, documentFileId, options) {
    return documents.listDocumentChunks(this, userId, documentFileId, options);
  }

  async listDocumentPages(userId, documentFileId, options) {
    return documents.listDocumentPages(this, userId, documentFileId, options);
  }

  async listDocumentPagesByNumbers(userId, documentFileId, pageNumbers, options) {
    return documents.listDocumentPagesByNumbers(this, userId, documentFileId, pageNumbers, options);
  }

  async queueDocumentPageRender(params, options) {
    return documents.queueDocumentPageRender(this, params, options);
  }

  async searchDocumentPages(params, options) {
    return documents.searchDocumentPages(this, params, options);
  }

  async deleteAttachment(userId, attachmentId, options) {
    return attachments.deleteAttachment(this, userId, attachmentId, options);
  }

  async searchDocumentChunks(params, options) {
    return documents.searchDocumentChunks(this, params, options);
  }

  async checkApiBudget(params, options) {
    return billing.checkApiBudget(this, params, options);
  }

  async recordApiUsageCost(params, options) {
    return billing.recordApiUsageCost(this, params, options);
  }

  async getApiWeeklyUsage(userId, options) {
    return billing.getApiWeeklyUsage(this, userId, options);
  }

  async adminSummary(options) {
    return admin.adminSummary(this, options);
  }

  async getSearchCache(queryHash, options) {
    return caches.getSearchCache(this, queryHash, options);
  }

  async upsertSearchCache(row, options) {
    return caches.upsertSearchCache(this, row, options);
  }

  async getModelCache(id, options) {
    return caches.getModelCache(this, id, options);
  }

  async upsertModelCache(id, payload, options) {
    return caches.upsertModelCache(this, id, payload, options);
  }
}
