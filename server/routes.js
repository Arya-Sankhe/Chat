import { HttpError, sendProblem } from "./http/responses.js";
import { applyApiCors, handleApiPreflight } from "./http/cors.js";
import { handleAdminSettings, handleAdminSummary } from "./routes/admin.js";
import { handleClarifications } from "./routes/clarifications.js";
import { API_DEPENDENCIES, defaultApiDependencies } from "./routes/context.js";
import { handleConversationById, handleConversationSearch, handleConversations, handleMessageById } from "./routes/conversations.js";
import { handleConfig, handleHealth, handleMe, handleMeExport, handleModels, handlePlans } from "./routes/meta.js";
import { handleMemory } from "./routes/memory.js";
import { handleProjectById, handleProjects } from "./routes/projects.js";
import {
  handleStudyCard,
  handleStudyCourseGenerate,
  handleStudyCourseMaterials,
  handleStudyCoursePractice,
  handleStudyCourseCards,
  handleStudyCourseDecks,
  handleStudyCourseQueue,
  handleStudyQuizAttempts,
  handleStudyQuizById,
  handleStudyNote,
  handleStudyNoteExport
} from "./routes/study.js";
import {
  handleAdminPaymentRequests,
  handleAdminUpdatePaymentRequest,
  handleCancelSubscription,
  handleCreateMamoPayment,
  handleCreateZiinaPaymentRequest,
  handleListPaymentRequests,
  handleMamoWebhook
} from "./routes/payments.js";
import { handleAdminResolveReport, handleCreateReport } from "./routes/reports.js";
import {
  handleCancelResearch,
  handleCreateResearch,
  handleResearchReport,
  handleResearchStatus
} from "./routes/research.js";
import {
  handleAttachmentDelete,
  handleAttachmentDownload,
  handleAttachmentView,
  handleCompleteUpload,
  handleDocumentJobStatus,
  handleDocumentEditor,
  handleDocumentEditorExport,
  handleDocumentEditorRevise,
  handleDocumentStatus,
  handlePresignUpload,
  handleStorage,
  handleUploadContent
} from "./routes/uploads.js";
import { handleConversationMessage, handlePendingDocumentTurnCancel } from "./chat/pipeline.js";
import { handleTemporaryChat } from "./chat/temporary.js";
import { handleSpeechToText } from "./routes/speech.js";
import { handleDesktopAuthorizationDecision, handleDesktopAuthorizationDetails } from "./routes/desktopOAuth.js";
import {
  handleDesktopChat,
  handleDesktopLogout,
  handleDesktopMe,
  handleDesktopSpeech,
  sendDesktopProblem
} from "./routes/desktop.js";

export function installStableRequestSignal(req) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };

  if (req.aborted) abort();
  if (typeof req.once === "function") req.once("aborted", abort);

  Object.defineProperty(req, "signal", {
    configurable: true,
    enumerable: false,
    value: controller.signal
  });

  return controller.signal;
}

function pathParts(url) {
  return url.pathname.split("/").filter(Boolean);
}

export function createApiHandler(config, overrides = {}) {
  const validOverrides = Object.fromEntries(
    ["createDb", "createR2", "verifyUser", "verifyDesktopUser"]
      .filter((key) => typeof overrides[key] === "function")
      .map((key) => [key, overrides[key]])
  );
  const scopedConfig = Object.keys(validOverrides).length
    ? Object.assign({}, config, {
        [API_DEPENDENCIES]: Object.freeze({ ...defaultApiDependencies, ...validOverrides })
      })
    : config;
  return (req, res, url) => handleApiRequest(req, res, url, scopedConfig);
}

export {
  applyEditedUserText,
  buildDirectPdfVisualContext,
  normalizeAgentMode,
  runSharedPreSearch,
  shouldSuppressWebSearchForDocumentTurn,
  withResearchReportContext
} from "./chat/pipeline.js";

export async function handleApiRequest(req, res, url, config) {
  installStableRequestSignal(req);
  if (handleApiPreflight(req, res, config.mobile?.allowedOrigins || [])) return;
  applyApiCors(req, res, config.mobile?.allowedOrigins || []);

  try {
    const parts = pathParts(url);

    if (req.method === "GET" && url.pathname === "/api/health") {
      handleHealth(req, res, config);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      handleConfig(req, res, config);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/plans") {
      handlePlans(req, res, config);
      return;
    }

    if (url.pathname === "/api/payments/mamo/webhook") {
      await handleMamoWebhook(req, res, config);
      return;
    }

    if (url.pathname === "/api/payments/ziina" && req.method === "POST") {
      await handleCreateZiinaPaymentRequest(req, res, config);
      return;
    }

    if (url.pathname === "/api/payments/ziina" && req.method === "GET") {
      await handleListPaymentRequests(req, res, config);
      return;
    }

    if (url.pathname === "/api/payments/mamo" && req.method === "POST") {
      await handleCreateMamoPayment(req, res, config);
      return;
    }

    if (url.pathname === "/api/me") {
      await handleMe(req, res, config);
      return;
    }

    if (url.pathname === "/api/me/export") {
      await handleMeExport(req, res, config);
      return;
    }

    if (url.pathname === "/api/me/subscription/cancel") {
      if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
      await handleCancelSubscription(req, res, config);
      return;
    }

    if (url.pathname === "/api/reports") {
      await handleCreateReport(req, res, config);
      return;
    }

    if (url.pathname === "/api/memory") {
      await handleMemory(req, res, config);
      return;
    }

    if (url.pathname === "/api/oauth/desktop/authorization") {
      await handleDesktopAuthorizationDetails(req, res, url, config);
      return;
    }

    if (url.pathname === "/api/oauth/desktop/decision") {
      await handleDesktopAuthorizationDecision(req, res, config);
      return;
    }

    if (url.pathname === "/api/desktop/v1/me") {
      await handleDesktopMe(req, res, config);
      return;
    }

    if (url.pathname === "/api/desktop/v1/chat/completions") {
      await handleDesktopChat(req, res, config);
      return;
    }

    if (url.pathname === "/api/desktop/v1/speech-to-text") {
      await handleDesktopSpeech(req, res, config);
      return;
    }

    if (url.pathname === "/api/desktop/v1/logout") {
      await handleDesktopLogout(req, res, config);
      return;
    }

    if (url.pathname === "/api/models" && req.method === "GET") {
      await handleModels(req, res, config);
      return;
    }

    if (url.pathname === "/api/clarifications" && req.method === "POST") {
      await handleClarifications(req, res, config);
      return;
    }

    if (url.pathname === "/api/storage" && req.method === "GET") {
      await handleStorage(req, res, config);
      return;
    }

    if (url.pathname === "/api/uploads/presign" && req.method === "POST") {
      await handlePresignUpload(req, res, config);
      return;
    }

    if (parts[0] === "api" && parts[1] === "uploads" && parts[2] && parts[3] === "content" && req.method === "PUT") {
      await handleUploadContent(req, res, config, parts[2]);
      return;
    }

    if (url.pathname === "/api/uploads/complete" && req.method === "POST") {
      await handleCompleteUpload(req, res, config);
      return;
    }

    if (parts[0] === "api" && parts[1] === "documents" && parts[2] === "jobs" && parts[3] && parts[4] === "status") {
      await handleDocumentJobStatus(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "documents" && parts[2] && parts[3] === "status") {
      await handleDocumentStatus(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "attachments" && parts[2] && parts[3] === "download") {
      await handleAttachmentDownload(req, res, config, parts[2], url);
      return;
    }

    if (parts[0] === "api" && parts[1] === "attachments" && parts[2] && parts[3] === "view") {
      await handleAttachmentView(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "attachments" && parts[2] && parts[3] === "editor" && !parts[4]) {
      await handleDocumentEditor(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "attachments" && parts[2] && parts[3] === "editor" && parts[4] === "export") {
      await handleDocumentEditorExport(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "attachments" && parts[2] && parts[3] === "editor" && parts[4] === "revise") {
      await handleDocumentEditorRevise(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "attachments" && parts[2] && !parts[3] && req.method === "DELETE") {
      await handleAttachmentDelete(req, res, config, parts[2]);
      return;
    }

    if (url.pathname === "/api/conversations") {
      await handleConversations(req, res, config);
      return;
    }

    if (url.pathname === "/api/conversations/search") {
      await handleConversationSearch(req, res, config);
      return;
    }

    if (url.pathname === "/api/projects") {
      await handleProjects(req, res, config);
      return;
    }

    if (parts[0] === "api" && parts[1] === "projects" && parts[2] && !parts[3]) {
      await handleProjectById(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "courses" && parts[3] && parts[4] === "materials") {
      await handleStudyCourseMaterials(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "courses" && parts[3] && parts[4] === "generate") {
      await handleStudyCourseGenerate(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "courses" && parts[3] && parts[4] === "practice") {
      await handleStudyCoursePractice(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "courses" && parts[3] && parts[4] === "decks") {
      await handleStudyCourseDecks(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "courses" && parts[3] && parts[4] === "queue") {
      await handleStudyCourseQueue(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "courses" && parts[3] && parts[4] === "cards") {
      await handleStudyCourseCards(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "cards" && parts[3] && !parts[4]) {
      await handleStudyCard(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "quizzes" && parts[3] && parts[4] === "attempts") {
      await handleStudyQuizAttempts(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "quizzes" && parts[3] && !parts[4]) {
      await handleStudyQuizById(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "notes" && parts[3] && parts[4] === "export") {
      await handleStudyNoteExport(req, res, config, parts[3]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "study" && parts[2] === "notes" && parts[3] && !parts[4]) {
      await handleStudyNote(req, res, config, parts[3]);
      return;
    }

    if (url.pathname === "/api/research" && req.method === "POST") {
      await handleCreateResearch(req, res, config);
      return;
    }

    if (parts[0] === "api" && parts[1] === "research" && parts[2] && parts[3] === "status") {
      await handleResearchStatus(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "research" && parts[2] && parts[3] === "cancel") {
      await handleCancelResearch(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "research" && parts[2] && parts[3] === "report") {
      await handleResearchReport(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "conversations" && parts[2] && !parts[3]) {
      await handleConversationById(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "conversations" && parts[2] && parts[3] === "messages") {
      await handleConversationMessage(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "conversations" && parts[2]
      && parts[3] === "turns" && parts[4] && parts[5] === "cancel") {
      await handlePendingDocumentTurnCancel(req, res, config, parts[2], parts[4]);
      return;
    }

    if (url.pathname === "/api/temporary-chat") {
      await handleTemporaryChat(req, res, config);
      return;
    }

    if (url.pathname === "/api/speech-to-text") {
      await handleSpeechToText(req, res, config);
      return;
    }

    if (parts[0] === "api" && parts[1] === "messages" && parts[2] && !parts[3]) {
      await handleMessageById(req, res, config, parts[2]);
      return;
    }

    if (url.pathname === "/api/admin/summary" && req.method === "GET") {
      await handleAdminSummary(req, res, config);
      return;
    }

    if (url.pathname === "/api/admin/settings") {
      await handleAdminSettings(req, res, config);
      return;
    }

    if (url.pathname === "/api/admin/payments" && req.method === "GET") {
      await handleAdminPaymentRequests(req, res, config);
      return;
    }

    if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "payments" && parts[3] && parts[4] && req.method === "POST") {
      await handleAdminUpdatePaymentRequest(req, res, config, parts[3], parts[4]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "reports" && parts[3] && (parts[4] === "done" || parts[4] === "reported") && req.method === "POST") {
      await handleAdminResolveReport(req, res, config, parts[3], parts[4]);
      return;
    }

    if (url.pathname === "/api/chat") {
      throw new HttpError(410, "Use /api/conversations/:id/messages for managed Klui chat.");
    }

    throw new HttpError(404, "API route not found.");
  } catch (error) {
    if (url.pathname.startsWith("/api/desktop/")) sendDesktopProblem(res, error, config);
    else sendProblem(res, error);
  }
}
