import { HttpError } from "../http/responses.js";
import * as admin from "./rest/admin.js";
import * as attachments from "./rest/attachments.js";
import * as billing from "./rest/billing.js";
import * as caches from "./rest/caches.js";
import * as chat from "./rest/chat.js";
import * as documents from "./rest/documents.js";
import * as accountExport from "./rest/export.js";
import * as memory from "./rest/memory.js";
import * as desktop from "./rest/desktop.js";
import * as payments from "./rest/payments.js";
import * as reports from "./rest/reports.js";
import * as profiles from "./rest/profiles.js";
import * as projects from "./rest/projects.js";
import * as research from "./rest/research.js";
import * as study from "./rest/study.js";
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

  async getMessage(userId, messageId, options) {
    return reports.getMessage(this, userId, messageId, options);
  }

  async getMessageById(messageId, options) {
    return reports.getMessageById(this, messageId, options);
  }

  async getOpenContentReport(reporterId, messageId, options) {
    return reports.getOpenContentReport(this, reporterId, messageId, options);
  }

  async createContentReport(row, options) {
    return reports.createContentReport(this, row, options);
  }

  async getContentReport(id, options) {
    return reports.getContentReport(this, id, options);
  }

  async resolveContentReport(id, resolvedBy, options) {
    return reports.resolveContentReport(this, id, resolvedBy, options);
  }

  async listConversations(userId, options) {
    return chat.listConversations(this, userId, options);
  }

  async listProjects(userId, options) {
    return projects.listProjects(this, userId, options);
  }

  async createProject(userId, name, options) {
    return projects.createProject(this, userId, name, options);
  }

  async getProject(userId, projectId, options) {
    return projects.getProject(this, userId, projectId, options);
  }

  async updateProject(userId, projectId, patch, options) {
    return projects.updateProject(this, userId, projectId, patch, options);
  }

  async deleteProject(userId, projectId, options) {
    return projects.deleteProject(this, userId, projectId, options);
  }

  async listProjectAttachments(userId, projectId, options) {
    return projects.listProjectAttachments(this, userId, projectId, options);
  }

  async listProjectConversations(userId, projectId, options) {
    return projects.listProjectConversations(this, userId, projectId, options);
  }

  async listProjectDocuments(userId, projectId, options) {
    return projects.listProjectDocuments(this, userId, projectId, options);
  }

  async listStudyNotes(userId, projectId, options) {
    return study.listStudyNotes(this, userId, projectId, options);
  }

  async getStudyNote(userId, id, options) {
    return study.getStudyNote(this, userId, id, options);
  }

  async createStudyNote(userId, note, options) {
    return study.createStudyNote(this, userId, note, options);
  }

  async deleteStudyNote(userId, id, options) {
    return study.deleteStudyNote(this, userId, id, options);
  }

  async listStudyCards(userId, projectId, options) {
    return study.listStudyCards(this, userId, projectId, options);
  }

  async getStudyCard(userId, id, options) {
    return study.getStudyCard(this, userId, id, options);
  }

  async createStudyCards(userId, cards, options) {
    return study.createStudyCards(this, userId, cards, options);
  }

  async deleteStudyCard(userId, id, options) {
    return study.deleteStudyCard(this, userId, id, options);
  }

  async updateStudyCard(userId, id, patch, options) {
    return study.updateStudyCard(this, userId, id, patch, options);
  }

  async deleteStudyCardsForSource(userId, filter, options) {
    return study.deleteStudyCardsForSource(this, userId, { ...filter, ...options });
  }

  async listStudyQuizzes(userId, projectId, options) {
    return study.listStudyQuizzes(this, userId, projectId, options);
  }

  async getStudyQuiz(userId, id, options) {
    return study.getStudyQuiz(this, userId, id, options);
  }

  async createStudyQuiz(userId, quiz, options) {
    return study.createStudyQuiz(this, userId, quiz, options);
  }

  async updateStudyQuiz(userId, id, patch, options) {
    return study.updateStudyQuiz(this, userId, id, patch, options);
  }

  async deleteStudyQuiz(userId, id, options) {
    return study.deleteStudyQuiz(this, userId, id, options);
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

  async listRecentAssistantMessages(userId, conversationId, options) {
    return chat.listRecentAssistantMessages(this, userId, conversationId, options);
  }

  async searchMessages(userId, query, options) {
    return chat.searchMessages(this, userId, query, options);
  }

  async insertMessage(message, options) {
    return chat.insertMessage(this, message, options);
  }

  async updateMessage(userId, messageId, patch, options) {
    return chat.updateMessage(this, userId, messageId, patch, options);
  }

  async getUserMemory(userId, options) {
    return memory.getUserMemory(this, userId, options);
  }

  async upsertUserMemory(row, options) {
    return memory.upsertUserMemory(this, row, options);
  }

  async updateUserMemory(userId, version, patch, options) {
    return memory.updateUserMemory(this, userId, version, patch, options);
  }

  async listUserMemoryMessages(userId, after, options) {
    return memory.listUserMemoryMessages(this, userId, after, options);
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

  async reserveAttachment(params, options) {
    return attachments.reserveAttachment(this, params, options);
  }

  async completeReservedAttachment(params, options) {
    return attachments.completeReservedAttachment(this, params, options);
  }

  async accountStorageUsed(userId, options) {
    return attachments.accountStorageUsed(this, userId, options);
  }

  async listUserStorageAttachments(userId, options) {
    return attachments.listUserStorageAttachments(this, userId, options);
  }

  async listAccountObjectKeys(userId, options) {
    return attachments.listAccountObjectKeys(this, userId, options);
  }

  async listAccountObjectKeysBatch(userId, options) {
    return attachments.listAccountObjectKeysBatch(this, userId, options);
  }

  async exportAccountData(userId, options) {
    return accountExport.exportAccountData(this, userId, options);
  }

  async deleteAuthUser(userId, { signal } = {}) {
    if (!this.configured) throw new HttpError(503, "Supabase is not configured.");
    const response = await fetch(`${this.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`
      },
      signal
    });
    if (response.status === 404) return true;
    if (!response.ok) throw new HttpError(502, "Account could not be deleted.");
    return true;
  }

  async listConversationStorageTotals(userId, options) {
    return attachments.listConversationStorageTotals(this, userId, options);
  }

  async listOrphanAttachments(options) {
    return attachments.listOrphanAttachments(this, options);
  }

  async listStalePendingAttachments(options) {
    return attachments.listStalePendingAttachments(this, options);
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

  async listUsableProjectDocumentFiles(userId, projectId, options) {
    return documents.listUsableProjectDocumentFiles(this, userId, projectId, options);
  }

  async listDocumentChunksForFiles(userId, documentFileIds, options) {
    return documents.listDocumentChunksForFiles(this, userId, documentFileIds, options);
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

  async updateDocumentPage(userId, documentFileId, pageNumber, patch, options) {
    return documents.updateDocumentPage(this, userId, documentFileId, pageNumber, patch, options);
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

  async reserveApiUsage(params, options) { return billing.reserveApiUsage(this, params, options); }
  async markApiUsageSubmitted(params, options) { return billing.markApiUsageSubmitted(this, params, options); }
  async settleApiUsage(params, options) { return billing.settleApiUsage(this, params, options); }
  async releaseApiUsage(params, options) { return billing.releaseApiUsage(this, params, options); }
  async reconcileApiUsage(options) { return billing.reconcileApiUsage(this, options); }
  async listSubmittedApiUsage(options) { return billing.listSubmittedApiUsage(this, options); }
  async getAccountIdentity(params, options) { return desktop.getAccountIdentity(this, params, options); }
  async resolveAccountIdentity(params, options) { return desktop.resolveAccountIdentity(this, params, options); }
  async acceptDesktopPrivacy(params, options) { return desktop.acceptDesktopPrivacy(this, params, options); }
  async getDesktopPrivacyConsent(params, options) { return desktop.getDesktopPrivacyConsent(this, params, options); }

  async adminSummary(options) {
    return admin.adminSummary(this, options);
  }

  async getModelCache(id, options) {
    return caches.getModelCache(this, id, options);
  }

  async upsertModelCache(id, payload, options) {
    return caches.upsertModelCache(this, id, payload, options);
  }
}
