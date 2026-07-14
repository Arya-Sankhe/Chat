import {
  configureApiAuth,
  approveAdminPayment,
  cancelResearch,
  cancelPendingDocumentTurn,
  createConversation,
  createProject,
  createResearch,
  createZiinaPaymentRequest,
  deleteAttachment,
  deleteConversation,
  deleteProject,
  updateConversation,
  updateProject,
  downloadAttachment,
  exportEditableDocument,
  fetchAttachmentView,
  fetchAdminSummary,
  fetchConfig,
  fetchConversation,
  fetchDocumentJobStatus,
  fetchDocumentStatus,
  fetchMe,
  fetchModels,
  fetchPlans,
  fetchProject,
  fetchResearchReport,
  fetchResearchStatus,
  fetchZiinaPaymentRequests,
  listConversations,
  listProjects,
  saveEditableDocument,
  rejectAdminPayment,
  completeUpload,
  presignUpload,
  putUploadContent,
  streamCompareConversationMessage,
  streamConversationMessage,
  streamTemporaryChat,
  updateAdminSettings,
  uploadFile
} from "./api.js";
import {
  clearSession,
  loadSession,
  parseAuthErrorFromUrl,
  parseSessionFromUrl,
  refreshSession,
  renderGoogleSignInButton,
  saveSession,
  signOut,
  listenForNativeAuth
} from "./auth.js";
import {
  configureNativeChrome,
  copyText,
  exitApp,
  isNative,
  listenForDeepLinks,
  onResume,
  openExternal,
  preferences,
  registerBackButton,
  setTextZoom,
  signInWithGoogle as nativeSignInWithGoogle
} from "./platform/index.js";
import { checkForAppUpdate, openAppUpdate } from "./platform/updates.js";
import {
  compactModelDisplayName,
  escapeHtml,
  getCodeSource,
  modelBrandLogoUrl,
  modelSupportsVision,
  normalizeModelList,
  renderPlainText,
  renderContent,
  resetCodeSourceStore
} from "./render.js?v=20260710-code-copy-svg-v3";
import { extractReasoningDelta } from "./reasoning.js";
import { createStreamReducer } from "./streaming.js";
import { createDocumentViewer } from "./documentViewer.js";
import { createResearchController } from "./research.js";
import { createCompareController } from "./compare.js";
import { createCouncilController } from "./council.js";
import { createAdminPanel } from "./adminPanel.js";
import { reconcilePendingTurnMessages } from "./pendingTurns.js";

const SETTINGS_KEY = "klui.chat.controls.v1";
const PINNED_CHATS_KEY = "klui.pinnedChats.v1";

const CHAT_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
const MENU_ICON_ATTRS = `width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
const PIN_MENU_ICON_SVG = `<svg ${MENU_ICON_ATTRS}><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`;
const RENAME_MENU_ICON_SVG = `<svg ${MENU_ICON_ATTRS}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
const DELETE_MENU_ICON_SVG = `<svg ${MENU_ICON_ATTRS}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>`;

const OPENROUTER_TEXT_MODEL = "deepseek/deepseek-v4-flash";
const OPENROUTER_VISION_MODEL = "xiaomi/mimo-v2.5";
const OPENROUTER_TEXT_PRO_MODEL = "deepseek/deepseek-v4-pro";
const OPENROUTER_VISION_PRO_MODEL = "xiaomi/mimo-v2.5-pro";
const OPENROUTER_PRO_MODEL = "minimax/minimax-m3";
const DEFAULT_COMPARE_MODELS = [OPENROUTER_TEXT_MODEL, OPENROUTER_VISION_MODEL];
const DEFAULT_COUNCIL_MODELS = [
  OPENROUTER_TEXT_MODEL,
  OPENROUTER_TEXT_PRO_MODEL,
  OPENROUTER_VISION_MODEL,
  OPENROUTER_VISION_PRO_MODEL
];
const DEFAULT_REASONING_EFFORT = "high";
const CONTEXT_LIMIT_TOKENS = 256000;
const LONG_PASTE_MIN_CHARS = 1000;
const LONG_PASTE_MIN_LINES = 8;
const LONG_PASTE_MAX_CHARS = 95000;
const CHAT_THEMES = new Set(["classic", "cyber", "doodle"]);
const APPEARANCES = new Set(["light", "dark", "system"]);
const COLOR_PRESETS = new Set(["default", "indigo", "emerald", "rose", "ocean"]);
const WRITING_STYLE_LABELS = Object.freeze({
  normal: "Normal",
  learning: "Learning",
  concise: "Concise",
  explanatory: "Explanatory",
  formal: "Formal"
});

const defaultSettings = {
  model: OPENROUTER_TEXT_MODEL,
  modelMode: "thinking",
  temperature: 0.7,
  top_p: 0.95,
  max_tokens: "",
  seed: "",
  systemPrompt: "",
  thinkingEffort: DEFAULT_REASONING_EFFORT,
  compareEnabled: false,
  compareModels: [],
  compareMode: "compare",
  agentMode: true,
  webSearchMode: "auto",
  writingStyle: "normal",
  provider: "openrouter",
  kluiModel: "",
  theme: "classic",
  appearance: "system",
  colorPreset: "default",
  showModelReasoning: true,
  uiTextScale: 100
};

const state = {
  config: null,
  session: null,
  me: null,
  plans: [],
  paymentRequests: [],
  conversations: [],
  projects: [],
  projectsOpen: false,
  activeProjectId: "",
  activeProject: null,
  projectUploading: false,
  projectSearch: "",
  projectSort: "updated",
  pinnedChatIds: [],
  activeConversationId: "",
  temporaryChat: false,
  researchMode: false,
  activeResearchId: "",
  researchReport: null,
  messages: [],
  models: [],
  settings: loadSettings(),
  images: [],
  pastedText: "",
  followUps: [],
  running: false,
  autoScroll: true,
  abortController: null,
  activeTurnRunId: "",
  activeTurnConversationId: "",
  activeTurnWaiting: false,
  activeTurnCancelRequested: false,
  activeTurnCancelResult: null,
  resumingTurnId: "",
  pendingDeleteId: "",
  pendingDeleteAttachmentId: "",
  pendingDeleteProjectId: "",
  pendingRenameId: "",
  openConversationMenuId: "",
  editingMessageId: "",
  compareDescribeImages: false,
  viewer: {
    open: false,
    attachmentId: "",
    downloadAttachmentId: "",
    jobId: "",
    fileName: "",
    kind: "",
    sourceKind: "",
    url: "",
    sheets: [],
    activeSheet: 0,
    markdown: "",
    revision: 0,
    loading: false,
    error: ""
  }
};

const PENDING_DOCUMENTS_STORAGE_PREFIX = "klui_pending_documents_v1";

let renderQueued = false;
let streamingRenderQueued = false;
const streamingRenderTargets = new Map();
let renderedChatPromptSignature = "";
let googleButtonRenderKey = "";
let reasoningOpenIds = new Set();
let suppressUrlSync = false;
let lastMessagesTouchY = 0;
let lastNativeBackAt = 0;
let availableAppUpdate = null;
let pendingNativeConversationId = "";
let researchController;
let compareController;
let councilController;
let adminPanel;
let selectedTextContext = null;
const sideChatState = {
  context: "",
  messages: [],
  running: false,
  abortController: null
};

/** One in-flight client run per conversation (or temporary chat). */
const TEMPORARY_RUN_KEY = "__temporary__";
const conversationRuns = new Map();

function conversationRunKey(conversationId = state.activeConversationId, temporary = state.temporaryChat) {
  if (temporary) return TEMPORARY_RUN_KEY;
  return String(conversationId || "");
}

function getConversationRun(key = conversationRunKey()) {
  return key ? conversationRuns.get(key) || null : null;
}

function isRunKeyActive(key) {
  return Boolean(key) && conversationRunKey() === key;
}

function syncTurnFieldsFromRun(run) {
  if (!run) {
    state.abortController = null;
    state.activeTurnRunId = "";
    state.activeTurnConversationId = "";
    state.activeTurnWaiting = false;
    state.activeTurnCancelRequested = false;
    state.activeTurnCancelResult = null;
    return;
  }
  state.abortController = run.abortController || null;
  state.activeTurnRunId = run.turnRunId || "";
  state.activeTurnConversationId = run.temporary ? "" : (run.conversationId || "");
  state.activeTurnWaiting = Boolean(run.turnWaiting);
  state.activeTurnCancelRequested = Boolean(run.cancelRequested);
  state.activeTurnCancelResult = run.cancelResult ?? null;
}

function syncActiveRunningUi() {
  const run = getConversationRun();
  syncTurnFieldsFromRun(run);
  setRunning(Boolean(run));
}

function beginConversationRun(key, {
  conversationId = "",
  temporary = false,
  abortController = null,
  mode = "chat"
} = {}) {
  if (!key) return null;
  const existing = conversationRuns.get(key);
  if (existing) return existing;
  const run = {
    key,
    conversationId: temporary ? "" : String(conversationId || key),
    temporary: Boolean(temporary),
    mode,
    abortController,
    messages: null,
    followUps: [],
    turnRunId: "",
    turnWaiting: false,
    cancelRequested: false,
    cancelResult: null
  };
  conversationRuns.set(key, run);
  if (isRunKeyActive(key)) syncActiveRunningUi();
  return run;
}

function endConversationRun(key) {
  if (!key || !conversationRuns.has(key)) return;
  const run = conversationRuns.get(key);
  conversationRuns.delete(key);
  if (isRunKeyActive(key) || state.abortController === run?.abortController) {
    syncActiveRunningUi();
  }
}

function parkActiveConversationRun() {
  const key = conversationRunKey();
  const run = getConversationRun(key);
  if (!run) return;
  run.messages = state.messages;
  run.followUps = state.followUps.slice();
}

function restoreLiveConversationRun(conversationId) {
  const key = conversationRunKey(conversationId, false);
  const run = getConversationRun(key);
  if (!run?.messages) return false;
  // Research is durable on the server; returning should resume from fetched metadata.
  if (run.mode === "research" && !run.abortController) return false;
  state.messages = run.messages;
  state.followUps = Array.isArray(run.followUps) ? run.followUps.slice() : [];
  renderFollowUps();
  syncActiveRunningUi();
  return true;
}

function setResearchConversationRunning(running, conversationId = state.activeConversationId) {
  const id = String(conversationId || "");
  if (!id) return;
  if (running) {
    beginConversationRun(id, {
      conversationId: id,
      temporary: false,
      abortController: null,
      mode: "research"
    });
    syncActiveRunningUi();
    return;
  }
  const run = conversationRuns.get(id);
  if (run?.mode === "research" && !run.abortController) {
    conversationRuns.delete(id);
  }
  syncActiveRunningUi();
}

const els = {
  setupView: document.querySelector("#setupView"),
  paywallView: document.querySelector("#paywallView"),
  chatView: document.querySelector("#chatView"),
  researchReportView: document.querySelector("#researchReportView"),
  researchReportBack: document.querySelector("#researchReportBack"),
  researchVisualTab: document.querySelector("#researchVisualTab"),
  researchTextTab: document.querySelector("#researchTextTab"),
  researchCopy: document.querySelector("#researchCopy"),
  researchPrint: document.querySelector("#researchPrint"),
  researchReportLoading: document.querySelector("#researchReportLoading"),
  researchReportLayout: document.querySelector("#researchReportLayout"),
  researchReportToc: document.querySelector("#researchReportToc"),
  researchReportArticle: document.querySelector("#researchReportArticle"),
  researchReportSourcesSummary: document.querySelector("#researchReportSourcesSummary"),
  researchReportSources: document.querySelector("#researchReportSources"),
  serviceList: document.querySelector("#serviceList"),
  googleButton: document.querySelector("#googleButton"),
  authNotice: document.querySelector("#authNotice"),
  authDialog: document.querySelector("#authDialog"),
  authDialogClose: document.querySelector("#authDialogClose"),
  guestLoginPanel: document.querySelector("#guestLoginPanel"),
  guestLoginButton: document.querySelector("#guestLoginButton"),
  paywallEmail: document.querySelector("#paywallEmail"),
  paywallPlans: document.querySelector("#paywallPlans"),
  paywallBackButton: document.querySelector("#paywallBackButton"),
  paywallCloseButton: document.querySelector("#paywallCloseButton"),
  nativeMobileMenu: document.querySelector("#nativeMobileMenu"),
  compactNewChatButton: document.querySelector("#compactNewChatButton"),
  nativeNavBackdrop: document.querySelector("#nativeNavBackdrop"),
  sidebarButton: document.querySelector("#sidebarButton"),
  newChatButton: document.querySelector("#newChatButton"),
  searchChatsButton: document.querySelector("#searchChatsButton"),
  projectsButton: document.querySelector("#projectsButton"),
  pinnedChatsButton: document.querySelector("#pinnedChatsButton"),
  pinnedPopup: document.querySelector("#pinnedPopup"),
  pinnedPopupList: document.querySelector("#pinnedPopupList"),
  pinnedSection: document.querySelector("#pinnedSection"),
  pinnedConversationList: document.querySelector("#pinnedConversationList"),
  sidebarMid: document.querySelector("#sidebarMid"),
  searchDialog: document.querySelector("#searchDialog"),
  searchChatInput: document.querySelector("#searchChatInput"),
  searchChatResults: document.querySelector("#searchChatResults"),
  searchDialogClose: document.querySelector("#searchDialogClose"),
  accountButton: document.querySelector("#accountButton"),
  profileAvatar: document.querySelector("#profileAvatar"),
  profileName: document.querySelector("#profileName"),
  profilePlan: document.querySelector("#profilePlan"),
  profileMeta: document.querySelector("#profileMeta"),
  profileMenu: document.querySelector("#profileMenu"),
  profileMenuEmail: document.querySelector("#profileMenuEmail"),
  profileMenuUsage: document.querySelector("#profileMenuUsage"),
  profileMenuUpgrade: document.querySelector("#profileMenuUpgrade"),
  profileMenuSettings: document.querySelector("#profileMenuSettings"),
  profileMenuAdmin: document.querySelector("#profileMenuAdmin"),
  profileMenuSignOut: document.querySelector("#profileMenuSignOut"),
  conversationList: document.querySelector("#conversationList"),
  messages: document.querySelector("#messages"),
  projectView: document.querySelector("#projectView"),
  projectChatCrumb: document.querySelector("#projectChatCrumb"),
  projectChatCrumbName: document.querySelector("#projectChatCrumbName"),
  chatJumpBottom: document.querySelector("#chatJumpBottom"),
  chatPromptNav: document.querySelector("#chatPromptNav"),
  chatPromptRail: document.querySelector("#chatPromptRail"),
  chatPromptMarkers: document.querySelector("#chatPromptMarkers"),
  chatPromptPanel: document.querySelector("#chatPromptPanel"),
  chatPromptList: document.querySelector("#chatPromptList"),
  promptInput: document.querySelector("#promptInput"),
  temporaryChatBar: document.querySelector(".temporary-chat-bar"),
  temporaryChatToggle: document.querySelector("#temporaryChatToggle"),
  temporaryChatLabel: document.querySelector("#temporaryChatLabel"),
  imagePreviews: document.querySelector("#imagePreviews"),
  pastedTextDialog: document.querySelector("#pastedTextDialog"),
  pastedTextDialogBody: document.querySelector("#pastedTextDialogBody"),
  pastedTextDialogMeta: document.querySelector("#pastedTextDialogMeta"),
  pastedTextDialogClose: document.querySelector("#pastedTextDialogClose"),
  selectionActions: document.querySelector("#selectionActions"),
  selectionAddToChat: document.querySelector("#selectionAddToChat"),
  selectionAskSideChat: document.querySelector("#selectionAskSideChat"),
  sideChatPanel: document.querySelector("#sideChatPanel"),
  sideChatHeader: document.querySelector("#sideChatHeader"),
  sideChatClose: document.querySelector("#sideChatClose"),
  sideChatContext: document.querySelector("#sideChatContext"),
  sideChatMessages: document.querySelector("#sideChatMessages"),
  sideChatInput: document.querySelector("#sideChatInput"),
  sideChatSend: document.querySelector("#sideChatSend"),
  composer: document.querySelector(".composer"),
  composerArea: document.querySelector(".composer-area"),
  composerHomeAnchor: document.querySelector("#composerHomeAnchor"),
  followupQueue: document.querySelector("#followupQueue"),
  imageFileInput: document.querySelector("#imageFileInput"),
  cameraFileInput: document.querySelector("#cameraFileInput"),
  projectFileInput: document.querySelector("#projectFileInput"),
  projectCreateDialog: document.querySelector("#projectCreateDialog"),
  projectCreateForm: document.querySelector("#projectCreateForm"),
  projectNameInput: document.querySelector("#projectNameInput"),
  projectCreateCancel: document.querySelector("#projectCreateCancel"),
  cameraAction: document.querySelector("#cameraAction"),
  composerActionMenuWrap: document.querySelector("#composerActionMenuWrap"),
  actionMenuButton: document.querySelector("#actionMenuButton"),
  composerActionMenu: document.querySelector("#composerActionMenu"),
  writingStyleButton: document.querySelector("#writingStyleButton"),
  writingStyleMenu: document.querySelector("#writingStyleMenu"),
  writingStyleBack: document.querySelector("#writingStyleBack"),
  writingStyleMenuValue: document.querySelector("#writingStyleMenuValue"),
  writingStylePill: document.querySelector("#writingStylePill"),
  writingStylePillLabel: document.querySelector("#writingStylePillLabel"),
  writingStylePillClose: document.querySelector("#writingStylePillClose"),
  imageToggle: document.querySelector("#imageToggle"),
  deepResearchToggle: document.querySelector("#deepResearchToggle"),
  researchModeChip: document.querySelector("#researchModeChip"),
  researchModeClose: document.querySelector("#researchModeClose"),
  sendButton: document.querySelector("#sendButton"),
  stopButton: document.querySelector("#stopButton"),
  settingsButtonAlt: document.querySelector("#settingsButtonAlt"),
  settingsModelParamsSection: document.querySelector("#settingsModelParamsSection"),
  settingsReasoningSection: document.querySelector("#settingsReasoningSection"),
  settingsSystemPromptSection: document.querySelector("#settingsSystemPromptSection"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  temperatureInput: document.querySelector("#temperatureInput"),
  topPInput: document.querySelector("#topPInput"),
  maxTokensInput: document.querySelector("#maxTokensInput"),
  seedInput: document.querySelector("#seedInput"),
  systemPromptInput: document.querySelector("#systemPromptInput"),
  showModelReasoningInput: document.querySelector("#showModelReasoningInput"),
  saveSystemPromptButton: document.querySelector("#saveSystemPromptButton"),
  textScaleInput: document.querySelector("#textScaleInput"),
  textScaleValue: document.querySelector("#textScaleValue"),
  themePreviewGrid: document.querySelector("#themePreviewGrid"),
  appearancePill: document.querySelector("#appearancePill"),
  colorPresetRow: document.querySelector("#colorPresetRow"),
  accountDrawer: document.querySelector("#accountDrawer"),
  closeAccountButton: document.querySelector("#closeAccountButton"),
  accountInfo: document.querySelector("#accountInfo"),
  signOutButton: document.querySelector("#signOutButton"),
  adminSection: document.querySelector("#adminSection"),
  loadAdminButton: document.querySelector("#loadAdminButton"),
  adminOutput: document.querySelector("#adminOutput"),
  thinkingEffort: document.querySelector("#thinkingEffort"),
  composerModelWrap: document.querySelector("#composerModelWrap"),
  modelButton: document.querySelector("#modelButton"),
  modelLabel: document.querySelector("#modelLabel"),
  modelPriceBadge: document.querySelector("#modelPriceBadge"),
  modelDropdown: document.querySelector("#modelDropdown"),
  modelInput: document.querySelector("#modelInput"),
  modelCatalog: document.querySelector("#modelCatalog"),
  compareWrap: document.querySelector("#compareWrap"),
  compareButton: document.querySelector("#compareButton"),
  compareLabel: document.querySelector("#compareLabel"),
  councilWrap: document.querySelector("#councilWrap"),
  councilButton: document.querySelector("#councilButton"),
  councilLabel: document.querySelector("#councilLabel"),
  compareDropdown: document.querySelector("#compareDropdown"),
  compareInput: document.querySelector("#compareInput"),
  compareCatalog: document.querySelector("#compareCatalog"),
  compareClearButton: document.querySelector("#compareClearButton"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmBody: document.querySelector("#confirmBody"),
  confirmCancelButton: document.querySelector("#confirmCancelButton"),
  confirmDeleteButton: document.querySelector("#confirmDeleteButton"),
  renameDialog: document.querySelector("#renameDialog"),
  renameChatInput: document.querySelector("#renameChatInput"),
  renameCancelButton: document.querySelector("#renameCancelButton"),
  renameSaveButton: document.querySelector("#renameSaveButton"),
  overlay: document.querySelector("#overlay"),
  toast: document.querySelector("#toast"),
  lightbox: document.querySelector("#lightbox"),
  lightboxClose: document.querySelector("#lightboxClose"),
  lightboxImg: document.querySelector("#lightboxImg"),
  compareContextBanner: document.querySelector("#compareContextBanner"),
  compareContextYes: document.querySelector("#compareContextYes"),
  compareContextNo: document.querySelector("#compareContextNo"),
  compareContextCancel: document.querySelector("#compareContextCancel"),
  compareModeToggle: document.querySelector("#compareModeToggle"),
  compareModeDesc: document.querySelector("#compareModeDesc"),
  webSearchToggle: document.querySelector("#webSearchToggle"),
  providerToggle: document.querySelector("#providerToggle"),
  documentViewer: document.querySelector("#documentViewer"),
  documentViewerResizer: document.querySelector("#documentViewerResizer"),
  documentViewerTitle: document.querySelector("#documentViewerTitle"),
  documentViewerMeta: document.querySelector("#documentViewerMeta"),
  documentViewerDownload: document.querySelector("#documentViewerDownload"),
  documentViewerFullscreen: document.querySelector("#documentViewerFullscreen"),
  documentViewerClose: document.querySelector("#documentViewerClose"),
  documentViewerBody: document.querySelector("#documentViewerBody"),
  appUpdateDialog: document.querySelector("#appUpdateDialog"),
  appUpdateBody: document.querySelector("#appUpdateBody"),
  appUpdateLater: document.querySelector("#appUpdateLater"),
  appUpdateDownload: document.querySelector("#appUpdateDownload"),
  nativeMobileModeButton: document.querySelector("#nativeMobileModeButton"),
  nativeMobileModeDropdown: document.querySelector("#nativeMobileModeDropdown"),
  nativeMobileModeLabel: document.querySelector("#nativeMobileModeLabel")
};

function imageDescription(part) {
  return String(part?.image_url?.description || part?.image_url?.alt_text || "").trim();
}

function fileCategory(file) {
  return String(file?.type || "").startsWith("image/") ? "image" : "document";
}

function conversationIdFromLocation() {
  const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function researchIdFromLocation() {
  const match = window.location.pathname.match(/^\/research\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function projectIdFromLocation() {
  const match = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function projectsRouteFromLocation() {
  return window.location.pathname === "/projects" || Boolean(projectIdFromLocation());
}

function conversationUrl(id) {
  return id ? `/c/${encodeURIComponent(id)}` : "/";
}

function syncConversationUrl({ replace = false } = {}) {
  if (suppressUrlSync) return;
  const target = conversationUrl(state.activeConversationId);
  if (window.location.pathname === target) return;
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ conversationId: state.activeConversationId || "" }, "", target);
}

function syncProjectsUrl({ replace = false } = {}) {
  if (suppressUrlSync) return;
  const target = state.activeProjectId ? `/projects/${encodeURIComponent(state.activeProjectId)}` : "/projects";
  if (window.location.pathname === target) return;
  window.history[replace ? "replaceState" : "pushState"]({ projectId: state.activeProjectId || "" }, "", target);
}

function blockChatNavigationWhileRunning() {
  // Temporary chat stays locally locked; normal conversations can background.
  if (!(state.temporaryChat && conversationRuns.has(TEMPORARY_RUN_KEY))) return false;
  showToast("Stop the current response before switching chats.");
  return true;
}

function textFromMessageContent(content) {
  if (!Array.isArray(content)) return String(content || "");
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return String(part.text || "");
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function temporaryHistoryForRequest() {
  return state.messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && !message.error && !message.compareGroup && !message.councilGroup)
    .map((message) => ({
      role: message.role,
      content: textFromMessageContent(message.content)
    }))
    .filter((message) => message.content.trim())
    .slice(-20);
}

function renderTemporaryChatMode() {
  document.body.classList.toggle("temporary-chat", state.temporaryChat);
  const onEmptyChat = !state.messages.length;
  // Incognito affordance only on the home/empty screen or while a temp chat
  // is active — hide it once a normal conversation has messages.
  const showTempToggle = !state.projectsOpen && (onEmptyChat || state.temporaryChat);
  els.temporaryChatBar?.classList.toggle("hidden", !showTempToggle);
  els.temporaryChatToggle?.classList.toggle("hidden", !showTempToggle);
  els.temporaryChatLabel?.classList.toggle("hidden", state.projectsOpen || !state.temporaryChat);
  if (els.temporaryChatToggle) {
    els.temporaryChatToggle.classList.toggle("active", state.temporaryChat);
    els.temporaryChatToggle.setAttribute("aria-pressed", String(state.temporaryChat));
    els.temporaryChatToggle.setAttribute("title", state.temporaryChat ? "Temporary chat is on" : "Temporary chat");
  }
  if (els.imageToggle) els.imageToggle.disabled = state.running || state.temporaryChat;
}

function renderResearchMode() {
  const available = Boolean(state.config?.services?.research);
  els.deepResearchToggle?.classList.toggle("hidden", !available);
  els.researchModeChip?.classList.toggle("hidden", !state.researchMode);
  els.deepResearchToggle?.classList.toggle("active", state.researchMode);
  els.deepResearchToggle?.setAttribute("aria-pressed", String(state.researchMode));
  if (els.deepResearchToggle) els.deepResearchToggle.disabled = state.running || !available;
  if (els.imageToggle) els.imageToggle.disabled = state.running || state.temporaryChat || state.researchMode;
}

function normalizeWritingStyle(value) {
  const style = String(value || "normal").trim().toLowerCase();
  return Object.hasOwn(WRITING_STYLE_LABELS, style) ? style : "normal";
}

function renderWritingStyle() {
  const style = normalizeWritingStyle(state.settings.writingStyle);
  const label = WRITING_STYLE_LABELS[style];
  if (els.writingStyleMenuValue) els.writingStyleMenuValue.textContent = label;
  els.writingStylePill?.classList.toggle("hidden", style === "normal");
  if (els.writingStylePillLabel) els.writingStylePillLabel.textContent = label;
  els.writingStyleMenu?.querySelectorAll("[data-writing-style]").forEach((option) => {
    option.setAttribute("aria-checked", String(option.dataset.writingStyle === style));
  });
}

function setWritingStyle(value) {
  updateSetting("writingStyle", normalizeWritingStyle(value));
  renderWritingStyle();
  closeActionMenu();
  els.promptInput?.focus();
}

function setResearchMode(enabled) {
  const next = Boolean(enabled);
  if (next && state.temporaryChat) {
    showToast("Deep Research is not available in temporary chat.");
    return;
  }
  if (next && state.images.length) {
    showToast("Remove attachments before starting Deep Research.");
    return;
  }
  state.researchMode = next;
  if (next && state.settings.compareEnabled) compareController.cancelCompareMode();
  renderResearchMode();
  closeActionMenu();
  els.promptInput?.focus();
}

function setTemporaryChatMode(enabled, { resetChat = true } = {}) {
  if (blockChatNavigationWhileRunning()) return;
  const next = Boolean(enabled);
  if (state.temporaryChat === next && !resetChat) {
    renderTemporaryChatMode();
    return;
  }
  if (resetChat) parkActiveConversationRun();
  researchController.stopResearchPolling();
  state.temporaryChat = next;
  if (next) state.researchMode = false;
  if (resetChat) {
    state.activeConversationId = "";
    state.messages = [];
    for (const item of state.images) forgetPendingDocument(item);
    state.images = [];
    state.pastedText = "";
    state.compareDescribeImages = false;
    stopPendingArtifactPolls();
    clearFollowUps();
    closeDocumentViewer();
    compareController.closeCompareContextBanner();
    closeSearchDialog();
    closePinnedPopup();
    closeConversationMenus();
    renderImages();
    syncConversationUrl({ replace: true });
  }
  if (next && state.settings.compareEnabled) {
    compareController.cancelCompareMode();
  }
  syncActiveRunningUi();
  renderTemporaryChatMode();
  renderShell();
}

function isSupportedDocumentFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return [".pdf", ".docx", ".xlsx", ".pptx", ".csv", ".tsv"].some((ext) => name.endsWith(ext));
}

function isSupportedPendingFile(file) {
  return fileCategory(file) === "image" || isSupportedDocumentFile(file);
}

function messageHasUndescribedImages(content) {
  return Array.isArray(content) && content.some((part) => part?.type === "image_url" && !imageDescription(part));
}

function chatHistoryHasUndescribedImages() {
  return state.messages.some((message) => message.role === "user" && messageHasUndescribedImages(message.content));
}

function pendingPromptHasImages() {
  return state.images.some((item) => item.category === "image");
}

function contentHasVisualOrDocument(content) {
  return Array.isArray(content) && content.some((part) => part?.type === "image_url" || part?.type === "file");
}

function chatHistoryNeedsVision() {
  return state.messages.some((message) => message.role === "user" && contentHasVisualOrDocument(message.content));
}

function pendingPromptNeedsVision(images = state.images) {
  return images.some((item) => item.category === "image" || item.category === "document");
}

function selectedModelMode() {
  return state.settings.modelMode === "pro" ? "pro" : "thinking";
}

function modelModeLabel(mode = selectedModelMode()) {
  return mode === "pro" ? "Pro" : "Thinking";
}

function composerPlaceholder() {
  if (state.session && !hasChatAccess()) return "Choose a plan to start chatting";
  if (state.running) return "Send a follow up message";
  if (state.settings.compareEnabled) {
    return isCouncilMode() ? "Message Klui Council" : "Message Klui Compare";
  }
  if (state.projectsOpen && state.activeProjectId && !state.activeConversationId) {
    return `Message ${state.activeProject?.project?.name || "this project"}`;
  }
  return "Message Klui agent";
}

function updateComposerPlaceholder() {
  if (els.promptInput) els.promptInput.placeholder = composerPlaceholder();
}

function renderFollowUps() {
  if (!els.followupQueue) return;
  if (!state.followUps.length) {
    els.followupQueue.classList.add("hidden");
    els.followupQueue.innerHTML = "";
    return;
  }
  els.followupQueue.classList.remove("hidden");
  els.followupQueue.innerHTML = state.followUps.map((item, index) => {
    const editing = item.editing ? " is-editing" : "";
    const images = Array.isArray(item.images) ? item.images : [];
    const imageBadge = images.length ? `<span class="followup-media-count">${images.length} image${images.length === 1 ? "" : "s"}</span>` : "";
    const imageEditor = item.editing && images.length
      ? `<div class="followup-media-strip">
          ${images.map((img) => `<img src="${escapeHtml(img.previewUrl)}" alt="${escapeHtml(img.file?.name || "Follow-up image")}">`).join("")}
        </div>`
      : "";
    const body = item.editing
      ? `<input class="followup-input" type="text" value="${escapeHtml(item.text)}" data-followup-input="${escapeHtml(item.id)}" aria-label="Edit follow-up message">
         <button class="followup-edit" type="button" data-save-followup="${escapeHtml(item.id)}">Save</button>
         ${imageEditor}`
      : `<span class="followup-text">${escapeHtml(item.text)}</span>
         ${imageBadge}
         <button class="followup-edit" type="button" data-edit-followup="${escapeHtml(item.id)}">Edit</button>`;
    return `
      <div class="followup-pill${editing}" data-followup-id="${escapeHtml(item.id)}">
        <span class="followup-index">${index + 1}</span>
        ${body}
        <button class="followup-delete" type="button" data-delete-followup="${escapeHtml(item.id)}" aria-label="Remove follow-up">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        </button>
      </div>
    `;
  }).join("");
}

function addFollowUpFromInput() {
  const text = els.promptInput.value.trim();
  const images = state.images.filter((item) => item.category === "image");
  const blocked = state.images.some((item) => item.category !== "image");
  if (blocked) {
    showToast("Follow-up attachments can only be images while Klui is working.");
    return;
  }
  if (!text && !images.length) return;
  if (state.followUps.length >= 3) {
    showToast("You can queue up to 3 follow-up messages.");
    return;
  }
  state.followUps.push({
    id: `followup_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    text,
    images
  });
  els.promptInput.value = "";
  state.images = [];
  applyComposerHeight();
  renderImages();
  renderFollowUps();
  updateSendButton();
}

function editFollowUp(id) {
  const item = state.followUps.find((candidate) => candidate.id === id);
  if (!item) return;
  for (const candidate of state.followUps) candidate.editing = candidate.id === id;
  renderFollowUps();
  window.requestAnimationFrame(() => {
    const input = els.followupQueue?.querySelector(`[data-followup-input="${cssString(id)}"]`);
    input?.focus();
    input?.select();
  });
}

function saveFollowUp(id) {
  const item = state.followUps.find((candidate) => candidate.id === id);
  const input = els.followupQueue?.querySelector(`[data-followup-input="${cssString(id)}"]`);
  if (!item || !input) return;
  const text = input.value.trim();
  if (!text && !item.images?.length) return;
  item.text = text;
  item.editing = false;
  renderFollowUps();
}

function deleteFollowUp(id) {
  const removed = state.followUps.find((item) => item.id === id);
  if (removed?.images?.length) {
    for (const img of removed.images) {
      if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
    }
  }
  state.followUps = state.followUps.filter((item) => item.id !== id);
  renderFollowUps();
  updateSendButton();
}

function clearFollowUps({ revoke = true } = {}) {
  if (revoke) {
    for (const item of state.followUps) {
      for (const img of item.images || []) {
        if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
      }
    }
  }
  state.followUps = [];
  renderFollowUps();
  updateSendButton();
}

function drainFollowUps() {
  const queued = state.followUps
    .map((item) => ({
      text: item.text.trim(),
      images: Array.isArray(item.images) ? item.images : []
    }))
    .filter((item) => item.text || item.images.length);
  clearFollowUps({ revoke: false });
  return queued;
}

function followUpBatchText(queued) {
  if (!queued.length) return "";
  if (queued.length === 1) return queued[0].text || "Follow-up image";
  return queued.map((item, index) => `Follow-up ${index + 1}: ${item.text || "Image attached"}`).join("\n\n");
}

function followUpBatchImages(queued) {
  return queued.flatMap((item) => item.images || []);
}

function resolveRoutedModel({ images = state.images, userContent = null } = {}) {
  if (selectedModelMode() === "pro") return OPENROUTER_PRO_MODEL;
  const needsVision = pendingPromptNeedsVision(images)
    || chatHistoryNeedsVision()
    || contentHasVisualOrDocument(userContent);
  return needsVision ? OPENROUTER_VISION_MODEL : OPENROUTER_TEXT_MODEL;
}

function compareIncludesTextOnlyModels(modelIds) {
  return modelIds.some((id) => !modelSupportsVision(modelById(id) || { id }));
}

function shouldPromptCompareImageContext(modelIds) {
  return modelIds.length >= 2
    && (chatHistoryHasUndescribedImages() || pendingPromptHasImages())
    && compareIncludesTextOnlyModels(modelIds);
}

function openCompareContextBanner() {
  els.compareContextBanner.classList.remove("hidden");
}

function syncCompareContextBanner(modelIds = compareController.selectedCompareModelIds()) {
  compareController.closeCompareContextBanner();
}

function currentNativeTopBarMode() {
  if (state.settings.compareEnabled && state.settings.compareMode === "council") return "council";
  if (state.settings.compareEnabled) return "compare";
  return state.settings.modelMode === "pro" ? "pro" : "thinking";
}

function applyNativeTopBarMode(mode) {
  if (mode === "compare") {
    compareController.activateCompareMode();
    return;
  }
  if (mode === "council") {
    councilController.activateCouncilMode();
    return;
  }
  if (state.settings.compareEnabled) compareController.cancelCompareMode();
  const modelMode = mode === "pro" ? "pro" : "thinking";
  updateSetting("modelMode", modelMode);
  updateSetting("provider", "openrouter");
  updateSetting("thinkingEffort", DEFAULT_REASONING_EFFORT);
  updateSetting("model", modelMode === "pro" ? OPENROUTER_PRO_MODEL : resolveRoutedModel());
  renderModelOptions();
}

function clampTextScale(value) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return 100;
  return Math.min(130, Math.max(85, num));
}

function loadSettings() {
  try {
    const loaded = { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    loaded.compareModels = Array.isArray(loaded.compareModels) ? loaded.compareModels.slice(0, 4) : [];
    loaded.compareEnabled = false;
    loaded.compareMode = loaded.compareMode === "council" ? "council" : "compare";
    loaded.agentMode = true;
    loaded.webSearchMode = loaded.webSearchMode === "off" ? "off" : "auto";
    loaded.writingStyle = normalizeWritingStyle(loaded.writingStyle);
    loaded.provider = "openrouter";
    loaded.modelMode = loaded.modelMode === "pro" ? "pro" : "thinking";
    loaded.thinkingEffort = DEFAULT_REASONING_EFFORT;
    loaded.temperature = 0.7;
    loaded.top_p = 0.95;
    loaded.kluiModel = typeof loaded.kluiModel === "string" ? loaded.kluiModel : "";
    loaded.theme = CHAT_THEMES.has(loaded.theme) ? loaded.theme : "classic";
    loaded.appearance = APPEARANCES.has(loaded.appearance) ? loaded.appearance : "system";
    loaded.colorPreset = COLOR_PRESETS.has(loaded.colorPreset) ? loaded.colorPreset : "default";
  loaded.showModelReasoning = loaded.showModelReasoning !== false;
  loaded.uiTextScale = clampTextScale(loaded.uiTextScale);
  loaded.model = loaded.modelMode === "pro" ? OPENROUTER_PRO_MODEL : OPENROUTER_TEXT_MODEL;
  return loaded;
  } catch {
    return { ...defaultSettings };
  }
}

function systemPrefersDark() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function resolvedAppearance() {
  const appearance = APPEARANCES.has(state.settings.appearance) ? state.settings.appearance : "system";
  if (appearance === "system") return systemPrefersDark() ? "dark" : "light";
  return appearance;
}

function applyCodeHighlightTheme(mode) {
  const light = document.querySelector("#hljsLight");
  const dark = document.querySelector("#hljsDark");
  if (light) light.disabled = mode === "dark";
  if (dark) dark.disabled = mode !== "dark";
}

function applyChatTheme() {
  const theme = CHAT_THEMES.has(state.settings.theme) ? state.settings.theme : "classic";
  const preset = COLOR_PRESETS.has(state.settings.colorPreset) ? state.settings.colorPreset : "default";
  const mode = resolvedAppearance();
  document.body.dataset.chatTheme = theme;
  document.body.dataset.accent = preset;
  document.body.dataset.mode = mode;
  applyCodeHighlightTheme(mode);
  syncAppearanceControls();
  // Match the Android notification panel color to the chat surface so the
  // status bar visually merges into the top bar. We read the resolved
  // --bg from CSS so the StatusBar tracks every color preset / theme.
  const nativeBg = (getComputedStyle(document.body).getPropertyValue("--bg") || "").trim()
    || (mode === "dark" ? "#1f1f1f" : "#ffffff");
  void configureNativeChrome({ dark: mode === "dark", background: nativeBg });
}

function applyTextScale() {
  void setTextZoom(clampTextScale(state.settings.uiTextScale));
}

function syncAppearanceControls() {
  const theme = CHAT_THEMES.has(state.settings.theme) ? state.settings.theme : "classic";
  const preset = COLOR_PRESETS.has(state.settings.colorPreset) ? state.settings.colorPreset : "default";
  const appearance = APPEARANCES.has(state.settings.appearance) ? state.settings.appearance : "system";
  if (els.themePreviewGrid) {
    els.themePreviewGrid.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.setAttribute("aria-checked", btn.dataset.theme === theme ? "true" : "false");
    });
  }
  if (els.appearancePill) {
    els.appearancePill.querySelectorAll("[data-appearance]").forEach((btn) => {
      btn.setAttribute("aria-checked", btn.dataset.appearance === appearance ? "true" : "false");
    });
  }
  if (els.colorPresetRow) {
    els.colorPresetRow.querySelectorAll("[data-accent]").forEach((btn) => {
      const active = btn.dataset.accent === preset;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }
}

function webSearchAvailable() {
  return Boolean(state.config?.services?.websearch);
}

function renderWebSearchToggle() {
  if (!els.webSearchToggle) return;
  if (!webSearchAvailable()) {
    els.webSearchToggle.classList.add("hidden");
    return;
  }
  els.webSearchToggle.classList.remove("hidden");
  const on = state.settings.webSearchMode !== "off";
  els.webSearchToggle.setAttribute("aria-pressed", on ? "true" : "false");
  els.webSearchToggle.setAttribute(
    "title",
    on
      ? "Web search: Auto — the model searches the web when it needs to. Click to disable."
      : "Web search: Off — click to let the model search when needed."
  );
  els.webSearchToggle.setAttribute("aria-label", on ? "Web search auto (on)" : "Web search off");
}

function openRouterAvailable() {
  return Boolean(state.config?.providers?.openrouter || state.config?.services?.openrouter);
}

function activeProvider() {
  return "openrouter";
}

function renderProviderToggle() {
  if (!els.providerToggle) return;
  if (!openRouterAvailable()) {
    els.providerToggle.classList.add("hidden");
    return;
  }
  els.providerToggle.classList.remove("hidden");
  const on = activeProvider() === "openrouter";
  els.providerToggle.setAttribute("aria-pressed", on ? "true" : "false");
  els.providerToggle.setAttribute(
    "aria-label",
    on ? "Provider: OpenRouter (on)" : "Provider: Klui — click to use OpenRouter"
  );
  els.providerToggle.setAttribute(
    "title",
    on
      ? "Provider: OpenRouter."
      : "Provider: Klui — click to route this chat through OpenRouter."
  );
}

function toggleProvider() {
  if (!openRouterAvailable()) return;
  const next = activeProvider() === "openrouter" ? "klui" : "openrouter";
  if (next === "openrouter") {
    /* Stash the current Klui model so we can restore it on toggle-off. */
    if (state.settings.model && state.settings.model !== OPENROUTER_VISION_MODEL) {
      updateSetting("kluiModel", state.settings.model);
    }
    updateSetting("provider", "openrouter");
    updateSetting("model", resolveRoutedModel());
    if (state.settings.compareEnabled) {
      updateSetting("compareEnabled", false);
      updateSetting("compareModels", []);
      compareController.closeCompareDropdown();
    }
  } else {
    updateSetting("provider", "klui");
    const restored = state.settings.kluiModel
      || state.models.find((m) => m.id !== OPENROUTER_VISION_MODEL)?.id
      || "";
    if (restored) updateSetting("model", restored);
  }
  renderProviderToggle();
  renderModelOptions();
  compareController.renderCompareControls();
}

function toggleWebSearchMode() {
  const next = state.settings.webSearchMode === "off" ? "auto" : "off";
  updateSetting("webSearchMode", next);
  renderWebSearchToggle();
}

function isCouncilMode() {
  return state.settings.compareEnabled && state.settings.compareMode === "council";
}

function saveSettings() {
  const value = JSON.stringify(state.settings);
  localStorage.setItem(SETTINGS_KEY, value);
  if (isNative()) void preferences.set(SETTINGS_KEY, value);
}

function updateSetting(key, value) {
  state.settings[key] = value;
  saveSettings();
  if (key === "theme" || key === "appearance" || key === "colorPreset") applyChatTheme();
  if (key === "uiTextScale") applyTextScale();
}

function getGreeting() {
  return "How can I help you?";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("visible"), 3200);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function servicesReady() {
  const s = state.config?.services || {};
  const providers = state.config?.providers || {};
  return Boolean(s.supabase && s.access && (providers.openrouter || s.openrouter));
}

function hasChatAccess() {
  return Boolean(state.me?.access?.active || ["active", "trialing", "testing"].includes(state.me?.subscription?.status));
}

function hasUpgradePlans() {
  return Array.isArray(state.plans) && state.plans.length > 0;
}

function showPaywall({ allowReturn = false } = {}) {
  els.paywallEmail.textContent = state.me?.user?.email || "";
  renderPlans();
  els.paywallBackButton?.classList.toggle("hidden", !allowReturn);
  els.paywallCloseButton?.classList.toggle("hidden", !allowReturn);
  showOnly(els.paywallView);
}

function openUpgradePlans() {
  if (!state.session || !hasUpgradePlans()) return;
  closeProfileMenu();
  document.body.classList.remove("sidebar-open");
  closeAllDrawers();
  showPaywall({ allowReturn: true });
}

/* ─── View switching ─── */

function showOnly(view) {
  [els.setupView, els.paywallView, els.chatView, els.researchReportView].forEach((el) => el?.classList.add("hidden"));
  view.classList.remove("hidden");
}

function renderShell() {
  const guest = !state.session;
  document.body.classList.toggle("guest-mode", guest);
  els.guestLoginPanel?.classList.toggle("hidden", !guest);
  renderAuthOptions();
  renderTemporaryChatMode();
  renderResearchMode();
  renderWritingStyle();
  renderProjects();
  renderProjectChatCrumb();
  renderAdminOnlyControls();

  if (!servicesReady()) {
    renderServices();
    showOnly(els.setupView);
    return;
  }

  if (!state.session) {
    showOnly(els.chatView);
    state.conversations = [];
    state.activeConversationId = "";
    renderConversations();
    renderModelOptions();
    renderWebSearchToggle();
    renderMessages();
    renderDocumentViewer();
    renderProfileMenu();
    renderProjects();
    return;
  }

  if (!hasChatAccess()) {
    showOnly(els.chatView);
    renderConversations();
    renderModelOptions();
    renderWebSearchToggle();
    renderMessages();
    renderDocumentViewer();
    renderProfileMenu();
    updateComposerPlaceholder();
    renderProjects();
    return;
  }

  showOnly(els.chatView);
  renderConversations();
  renderModelOptions();
  renderWebSearchToggle();
  renderMessages();
  renderDocumentViewer();
  renderProfileMenu();
  renderProjects();
  updateComposerPlaceholder();
  compareController.syncCompareContextBanner();
}

function renderServices() {
  const services = state.config?.services || {};
  els.serviceList.innerHTML = Object.entries({
    supabase: "Supabase Auth & Postgres",
    access: "Access mode",
    r2: "Cloudflare R2 storage",
    crof: "Managed model API key",
    documents: "Document tools"
  }).map(([key, label]) => `
    <div class="service-row">
      <span>${escapeHtml(label)}</span>
      <span class="${services[key] ? "status-ok" : "status-missing"}">${services[key] ? "Ready" : "Missing"}</span>
    </div>
  `).join("");
}

function renderAuthOptions() {
  const googleEnabled = Boolean(state.config?.auth?.googleEnabled);
  const googleReady = Boolean(googleEnabled && (isNative() || state.config?.auth?.googleClientId));
  els.googleButton.classList.toggle("hidden", !googleReady);
  if (!googleReady) {
    els.googleButton.innerHTML = "";
    googleButtonRenderKey = "";
    if (googleEnabled) els.authNotice.textContent = "Google sign-in needs GOOGLE_CLIENT_ID in your environment.";
    return;
  }

  if (els.authNotice.textContent === "Google sign-in needs GOOGLE_CLIENT_ID in your environment.") {
    els.authNotice.textContent = "";
  }

  if (!els.authDialog.classList.contains("open")) return;

  const renderKey = `${state.config.auth.googleClientId}:${els.googleButton.clientWidth || 0}`;
  if (googleButtonRenderKey === renderKey && els.googleButton.childElementCount) return;
  googleButtonRenderKey = renderKey;

  renderGoogleSignInButton(state.config, els.googleButton, {
    onSession: handleAuthenticatedSession,
    onError: (err) => {
      els.authNotice.textContent = err?.message || "Google sign-in failed.";
    }
  }).catch((err) => {
    googleButtonRenderKey = "";
    els.authNotice.textContent = err?.message || "Google sign-in could not be loaded.";
  });
}

function renderPlans() {
  const requestsByPlan = new Map(
    (state.paymentRequests || [])
      .filter((request) => request.status === "pending")
      .map((request) => [request.planId, request])
  );
  const planMeta = {
    lite: {
      tagline: "For light everyday use",
      features: ["Access to premium models", "Model compare"]
    },
    essential: {
      tagline: "For regular everyday use",
      badge: "Most popular",
      usage: "3.5x more usage",
      features: ["Access to premium models", "Model compare", "Model council"]
    },
    pro: {
      tagline: "For pro workflows",
      usage: "6x more usage",
      features: ["Access to premium models", "Model compare", "Model council", "Highest pro model usage"]
    }
  };
  els.paywallPlans.innerHTML = (state.plans || []).map((plan) => {
    const id = String(plan.id || "").toLowerCase();
    const planClass = id.replace(/[^a-z0-9_-]/g, "");
    const meta = planMeta[id] || { tagline: plan.description || "", features: ["Access to premium models"] };
    const pending = requestsByPlan.get(plan.id);
    const price = plan.amountAed ? `${Number(plan.amountAed).toLocaleString()} AED` : (plan.priceLabel || "");
    return `
    <article class="plan-card plan-card-${escapeHtml(planClass)}">
      <div class="plan-pin" aria-hidden="true"></div>
      ${meta.badge ? `<div class="plan-ribbon">${escapeHtml(meta.badge)}</div>` : ""}
      ${meta.usage ? `<div class="plan-usage-badge">${escapeHtml(meta.usage)}</div>` : ""}
      <div class="plan-head">
        <h3>${escapeHtml(plan.name)}</h3>
        <div class="price"><strong>${escapeHtml(price)}</strong><span>/month</span></div>
        <p>${escapeHtml(meta.tagline)}</p>
      </div>
      <ul>
        ${meta.features.map((feature) => `<li><span aria-hidden="true">✓</span>${escapeHtml(feature)}</li>`).join("")}
      </ul>
      ${requestsByPlan.has(plan.id) ? renderPendingPayment(requestsByPlan.get(plan.id)) : ""}
      <button class="plan-pay-btn" type="button" data-start-payment="${escapeHtml(plan.id)}" ${plan.ziinaPaymentUrl || plan.ziinaQrImageUrl ? "" : "disabled"}>
        ${pending ? "Open Ziina payment" : "Pay with Ziina"}
      </button>
      ${plan.ziinaPaymentUrl || plan.ziinaQrImageUrl ? `<p class="plan-payment-note">Access activates after we verify your Ziina payment.</p>` : `<p class="plan-payment-note">Ziina link is not configured yet.</p>`}
    </article>
  `;
  }).join("");
}

function renderPendingPayment(request) {
  return `
    <div class="payment-pending">
      <span>Pending verification</span>
      <strong>${escapeHtml(request.referenceCode || "")}</strong>
    </div>
  `;
}

function profileInitials(email) {
  const local = String(email || "").split("@")[0] || "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  if (local.length >= 2) return local.slice(0, 2).toUpperCase();
  if (local.length === 1) return local.toUpperCase();
  return "K";
}

function profileDisplayName(email) {
  const local = String(email || "").split("@")[0] || "";
  return local || "Signed in";
}

function renderProfileMenu() {
  const email = state.me?.user?.email || "";
  const planName = state.me?.plan?.name || "Free";
  if (els.profileAvatar) els.profileAvatar.textContent = state.session ? profileInitials(email) : "K";
  if (els.profileName) els.profileName.textContent = state.session ? profileDisplayName(email) : "";
  if (els.profilePlan) els.profilePlan.textContent = state.session ? planName : "";
  if (els.profileMeta) els.profileMeta.setAttribute("aria-hidden", state.session ? "false" : "true");
  if (!els.profileMenuEmail || !els.profileMenuUsage) return;

  if (!state.session) {
    els.profileMenuEmail.textContent = "";
    els.profileMenuUsage.innerHTML = "";
    els.profileMenuUpgrade?.classList.add("hidden");
    els.profileMenuAdmin?.classList.add("hidden");
    return;
  }

  els.profileMenuEmail.textContent = email || "Signed in";
  els.profileMenuUsage.innerHTML = renderAccountUsageMarkup();
  els.profileMenuUpgrade?.classList.toggle("hidden", !hasUpgradePlans());
  els.profileMenuAdmin?.classList.toggle("hidden", state.me?.profile?.role !== "admin");
}

function isProfileMenuOpen() {
  return els.profileMenu && !els.profileMenu.classList.contains("hidden");
}

function closeProfileMenu() {
  if (!els.profileMenu) return;
  els.profileMenu.classList.add("hidden");
  els.accountButton?.setAttribute("aria-expanded", "false");
}

function toggleProfileMenu() {
  if (!state.session) {
    openAuthDialog();
    return;
  }
  renderProfileMenu();
  if (isProfileMenuOpen()) {
    closeProfileMenu();
    return;
  }
  els.profileMenu.classList.remove("hidden");
  els.accountButton?.setAttribute("aria-expanded", "true");
}

function openAdminDrawer() {
  if (!state.session) return;
  closeProfileMenu();
  document.body.classList.remove("sidebar-open");
  renderAccount();
  els.accountDrawer.classList.add("open");
  els.accountDrawer.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "account";
}

function renderAccountUsageMarkup() {
  const plan = state.me?.plan;
  const usage = state.me?.usage || {};
  if (!plan) return "";

  const api = usage.api || {};
  const percent = Math.max(0, Math.min(100, Math.floor(Number(api.percent || 0))));
  const resetLabel = api.weekEnd
    ? `Resets ${new Date(api.weekEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "Resets weekly";

  return `
    <div class="account-usage">
      <div class="account-usage-head">
        <span class="account-usage-label">Weekly usage</span>
        <span class="account-usage-value">${percent}%</span>
      </div>
      <div class="account-usage-track" aria-hidden="true">
        <span class="account-usage-fill" style="width: ${percent}%"></span>
      </div>
      <p class="account-usage-note">${escapeHtml(resetLabel)}</p>
    </div>
  `;
}

/* Rough chars-per-token ratio for English-ish text. Only used to
   estimate the parts of context we can't measure exactly yet (the unsent
   draft, and turns that predate provider usage reporting). */
const CHARS_PER_TOKEN = 4;
/* Per-message envelope overhead (role markers / chat template tokens). */
const MESSAGE_OVERHEAD_TOKENS = 8;
/* Approximate vision token cost per attached image / document page. */
const IMAGE_TOKENS = 1200;
const FILE_TOKENS = 2500;

function estimateTextTokens(text) {
  return Math.ceil(String(text ?? "").length / CHARS_PER_TOKEN);
}

function normalizeClientUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  const prompt = num(usage.promptTokens ?? usage.prompt_tokens);
  const completion = num(usage.completionTokens ?? usage.completion_tokens);
  const reasoning = num(
    usage.reasoningTokens
    ?? usage.reasoning_tokens
    ?? usage.completion_tokens_details?.reasoning_tokens
  );
  let total = num(usage.totalTokens ?? usage.total_tokens);
  if (total == null && (prompt != null || completion != null)) {
    total = (prompt || 0) + (completion || 0);
  }
  const result = {};
  if (prompt != null) result.promptTokens = prompt;
  if (completion != null) result.completionTokens = completion;
  if (reasoning != null) result.reasoningTokens = reasoning;
  if (total != null) result.totalTokens = total;
  return Object.keys(result).length ? result : null;
}

/* Provider-reported total tokens for a turn, read from a live stream or
   persisted message metadata. Some providers report the full prompt context;
   others report only the current exchange, so this is a useful signal but
   not always authoritative for the whole visible chat. */
function messageUsageTotalTokens(message) {
  const usage = normalizeClientUsage(message?.usage || message?.metadata?.usage);
  return usage && usage.totalTokens != null ? usage.totalTokens : null;
}

function estimateContentTokens(content) {
  if (typeof content === "string") return estimateTextTokens(content);
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (part?.type === "text") total += estimateTextTokens(part.text);
    else if (part?.type === "image_url") total += IMAGE_TOKENS;
    else if (part?.type === "file") total += FILE_TOKENS;
  }
  return total;
}

/* Full estimate for a single message: content + reasoning + tool-call
   arguments + envelope overhead. Mirrors everything that occupies the
   context window for that turn. */
function estimateMessageTokens(message) {
  if (!message || typeof message !== "object") return 0;
  let total = MESSAGE_OVERHEAD_TOKENS + estimateContentTokens(message.content);
  if (message.reasoning) total += estimateTextTokens(message.reasoning);
  const toolCalls = message.toolCalls || message.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      const fn = call?.function || call;
      total += estimateTextTokens(`${fn?.name || ""}${fn?.arguments || ""}`);
    }
  }
  return total;
}

/* Estimate the system prompt footprint when no measured turn exists yet.
   Includes the custom prompt plus a small allowance for the agent tool
   schemas / document hints the server injects. */
function estimateSystemPromptTokens() {
  let total = estimateTextTokens(state.settings?.systemPrompt || "");
  if (state.settings?.agentMode) total += 500;
  return total;
}

function estimatePendingInputTokens() {
  let total = estimateTextTokens(els.promptInput?.value || "");
  for (const item of state.images || []) {
    total += item.category === "image" ? IMAGE_TOKENS : FILE_TOKENS;
  }
  return total ? total + MESSAGE_OVERHEAD_TOKENS : 0;
}

/**
 * Estimate how much of the model's context window this chat occupies.
 *
 * Uses the larger of:
 *   1. the local accumulated chat estimate, and
 *   2. the most recent provider token total plus anything newer.
 *
 * This keeps provider-reported usage useful for large hidden prompt/tool
 * costs without letting a later small response make the context bar shrink.
 */
function estimateContextTokens() {
  const messages = state.messages || [];
  const pendingTokens = estimatePendingInputTokens();

  let localEstimate = estimateSystemPromptTokens();
  for (const message of messages) {
    localEstimate += estimateMessageTokens(message);
  }
  localEstimate += pendingTokens;

  let baseTokens = 0;
  let estimateFromIndex = 0;
  let measured = false;

  for (let i = messages.length - 1; i >= 0; i--) {
    const total = messageUsageTotalTokens(messages[i]);
    if (total != null) {
      baseTokens = total;
      estimateFromIndex = i + 1;
      measured = true;
      break;
    }
  }

  let estimated = measured ? 0 : estimateSystemPromptTokens();
  for (let i = estimateFromIndex; i < messages.length; i++) {
    estimated += estimateMessageTokens(messages[i]);
  }
  estimated += pendingTokens;

  const providerEstimate = measured ? baseTokens + estimated : 0;
  return Math.max(0, Math.round(Math.max(localEstimate, providerEstimate)));
}

function formatTokenCount(tokens) {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

function renderContextMeter() {
  /* Context estimation stays available for backend logic; UI is hidden. */
}

function renderAccount() {
  const sub = state.me?.subscription;
  const plan = state.me?.plan;
  els.accountInfo.innerHTML = `
    <div class="account-label">${escapeHtml(state.me?.user?.email || "Signed in")}</div>
    <p class="account-detail">Plan: ${escapeHtml(plan?.name || "No active plan")}</p>
    <p class="account-detail">Access: ${escapeHtml(sub?.status || state.me?.access?.mode || "none")}</p>
    ${sub?.currentPeriodEnd ? `<p class="account-detail">Renews: ${escapeHtml(new Date(sub.currentPeriodEnd).toLocaleDateString())}</p>` : ""}
    ${renderAccountUsageMarkup()}
  `;
  els.adminSection.classList.toggle("hidden", state.me?.profile?.role !== "admin");
}

/* ─── Projects ─── */

function formatProjectBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  if (value < 1024 * 1024) return `${Math.max(0, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function projectSourceRows(project = state.activeProject) {
  return (project?.documents || []).map((document) => {
    const attachment = Array.isArray(document.attachments) ? document.attachments[0] : document.attachments;
    return { ...document, attachment: attachment || null };
  }).filter((document) => document.attachment?.id);
}

function projectListMarkup() {
  const search = state.projectSearch.trim().toLowerCase();
  const projects = [...(state.projects || [])].sort((a, b) => state.projectSort === "name"
      ? a.name.localeCompare(b.name)
      : new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  const visibleCount = projects.filter((project) => !search || project.name.toLowerCase().includes(search)).length;
  const rows = projects.map((project) => `
        <button class="project-list-row" type="button" data-open-project-id="${escapeHtml(project.id)}" ${search && !project.name.toLowerCase().includes(search) ? "hidden" : ""}>
          <span class="project-list-copy">
            <strong>${escapeHtml(project.name)}</strong>
            <small>Updated ${escapeHtml(formatChatAge(project.updated_at || project.created_at).toLowerCase())}</small>
          </span>
        </button>
      `).join("");
  const empty = `<div class="project-empty" ${visibleCount ? "hidden" : ""}><strong>${search ? "No matching projects" : "No projects yet"}</strong><p>${search ? "Try another search." : "Create one to keep related chats, instructions, and files together."}</p></div>`;

  return `
    <div class="projects-page">
      <header class="projects-page-header">
        <h1>Projects</h1>
        <div class="projects-page-actions">
          <label class="project-sort-control">Sort by
            <select data-project-sort aria-label="Sort projects">
              <option value="updated" ${state.projectSort === "updated" ? "selected" : ""}>Last updated</option>
              <option value="name" ${state.projectSort === "name" ? "selected" : ""}>Name</option>
            </select>
          </label>
          <button class="project-primary-button" type="button" data-create-project>New project</button>
        </div>
      </header>
      <label class="project-search-control">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input type="search" data-project-search value="${escapeHtml(state.projectSearch)}" placeholder="Search projects..." aria-label="Search projects">
      </label>
      <div class="project-list">${rows}${empty}</div>
    </div>`;
}

function projectDetailMarkup() {
  const payload = state.activeProject;
  if (!payload?.project) return `<div class="project-loading">Loading project...</div>`;
  const project = payload.project;
  const usage = payload.usage || { usedBytes: 0, maxBytes: state.me?.plan?.maxProjectBytes || 0, percent: 0 };
  const conversations = payload.conversations || [];
  const sources = projectSourceRows(payload);
  const recentMarkup = conversations.length
    ? conversations.slice(0, 6).map((conversation) => `
        <div class="project-recent-row">
          <button class="project-recent-open" type="button" data-open-chat-id="${escapeHtml(conversation.id)}">
            <span>${escapeHtml(conversation.title || "New chat")}</span>
          </button>
          <small class="project-recent-age">${escapeHtml(formatChatAge(conversation.updated_at || conversation.created_at))}</small>
          <button class="project-recent-delete" type="button" data-delete-project-chat-id="${escapeHtml(conversation.id)}" aria-label="Delete ${escapeHtml(conversation.title || "chat")}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>`).join("")
    : `<p class="project-section-empty">Your first conversation will appear here.</p>`;
  const sourceMarkup = sources.length
    ? sources.map((document) => {
        const attachment = document.attachment;
        const ready = Boolean(document.text_ready_at || document.visual_ready_at);
        const status = ready ? "Ready" : document.processing_status === "failed" ? "Failed" : "Processing";
        return `
          <div class="project-source-row${ready ? " is-ready" : ""}" data-view-project-attachment="${escapeHtml(attachment.id)}" data-file-name="${escapeHtml(attachment.file_name || "Document")}" data-format="${escapeHtml(document.kind || "")}" data-ready="${ready ? "1" : "0"}" role="button" tabindex="${ready ? "0" : "-1"}" ${ready ? "" : 'aria-disabled="true"'}>
            <button type="button" class="project-source-remove" data-remove-project-attachment="${escapeHtml(attachment.id)}" data-file-name="${escapeHtml(attachment.file_name || "Document")}" aria-label="Remove ${escapeHtml(attachment.file_name || "document")}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
            <span class="project-source-kind">${escapeHtml(String(document.kind || "file").toUpperCase())}</span>
            <span class="project-source-copy"><strong>${escapeHtml(attachment.file_name || "Document")}</strong><small>${escapeHtml(formatProjectBytes(attachment.size_bytes))} · ${escapeHtml(status)}</small></span>
          </div>`;
      }).join("")
    : `<p class="project-section-empty">Add files to give every chat in this project shared context.</p>`;

  return `
    <button class="project-back-button" type="button" data-projects-back>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      All projects
    </button>
    <div class="project-detail-page">
      <div class="project-detail-layout">
        <main class="project-detail-main">
          <header class="project-detail-header">
            <input class="project-title-input" value="${escapeHtml(project.name)}" maxlength="80" aria-label="Project name">
            <div class="project-menu-wrap">
              <button class="project-menu-btn" type="button" data-toggle-project-menu aria-label="Project options" aria-haspopup="menu" aria-expanded="false">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
              </button>
              <div class="project-menu hidden" data-project-menu role="menu">
                <button class="project-menu-item project-menu-danger" type="button" role="menuitem" data-delete-project>Delete project</button>
              </div>
            </div>
          </header>
          <div class="project-composer-slot"></div>
          <section class="project-recents-section">
            <div class="project-section-heading"><h2>Recents</h2></div>
            <div class="project-recent-list">${recentMarkup}</div>
          </section>
        </main>

        <aside class="project-context-panel">
          <section class="project-context-section project-instructions-section">
            <div class="project-section-heading"><div><h2>Instructions</h2><p>Applied to every response in this project.</p></div><button type="button" data-save-project-instructions>Save</button></div>
            <textarea class="project-instructions-input" maxlength="10000" placeholder="How should Klui help with this project?">${escapeHtml(project.instructions || "")}</textarea>
          </section>

          <section class="project-context-section project-files-section">
            <div class="project-section-heading"><h2>Files</h2><button type="button" data-add-project-files ${state.projectUploading ? "disabled" : ""} aria-label="Add project files">${state.projectUploading ? "Uploading..." : "+"}</button></div>
            <div class="project-capacity" aria-label="${escapeHtml(String(usage.percent || 0))}% of project knowledge used">
              <div class="project-capacity-track"><span style="width:${Math.min(100, Number(usage.percent || 0))}%"></span></div>
              <p>${escapeHtml(String(usage.percent || 0))}% of project capacity used</p>
            </div>
            <div class="project-source-list">${sourceMarkup}</div>
          </section>
        </aside>
      </div>
    </div>`;
}

function renderProjectChatCrumb() {
  if (!els.projectChatCrumb) return;
  const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
  const projectId = conversation?.project_id || "";
  // Only while a project chat is open — not on the project home / normal chats.
  const visible = Boolean(projectId && state.activeConversationId && !state.projectsOpen && !state.temporaryChat);
  els.projectChatCrumb.classList.toggle("hidden", !visible);
  document.body.classList.toggle("project-chat-open", visible);
  if (!visible) return;
  const project = state.projects.find((item) => item.id === projectId)
    || (state.activeProject?.project?.id === projectId ? state.activeProject.project : null);
  const name = project?.name || "Project";
  els.projectChatCrumb.dataset.projectId = projectId;
  els.projectChatCrumb.setAttribute("aria-label", `Back to ${name}`);
  if (els.projectChatCrumbName) els.projectChatCrumbName.textContent = name;
}

function renderProjects() {
  if (!els.projectView) return;
  // Reuse the single composer DOM node instead of duplicating it: park it back
  // next to #composerHomeAnchor when leaving a project, then move it into
  // .project-composer-slot for project detail. Fragile if surrounding render
  // order or markup around the anchor/slot changes — keep those stable.
  if (els.composerHomeAnchor && els.composerArea?.parentElement !== els.composerHomeAnchor.parentElement) {
    els.composerHomeAnchor.after(els.composerArea);
  }
  const visible = state.projectsOpen && !state.activeConversationId;
  const detailReady = Boolean(visible && state.activeProjectId && state.activeProject?.project);
  els.projectView.classList.toggle("hidden", !visible);
  els.projectView?.classList.toggle("project-view--detail", Boolean(visible && state.activeProjectId));
  els.messages?.classList.toggle("hidden", visible);
  if (visible) els.chatPromptNav?.classList.add("hidden");
  els.composerArea?.classList.toggle("hidden", visible && !detailReady);
  document.body.classList.toggle("projects-open", visible);
  els.projectsButton?.classList.toggle("active", state.projectsOpen);
  renderProjectChatCrumb();
  if (!visible) return;
  els.projectView.innerHTML = state.activeProjectId ? projectDetailMarkup() : projectListMarkup();
  const composerSlot = els.projectView.querySelector(".project-composer-slot");
  if (composerSlot && els.composerArea) composerSlot.append(els.composerArea);
}

async function loadProjects() {
  if (!state.session?.access_token) {
    state.projects = [];
    return;
  }
  const payload = await listProjects(state.session);
  state.projects = payload.projects || [];
}

async function loadActiveProject() {
  if (!state.activeProjectId) {
    state.activeProject = null;
    return;
  }
  state.activeProject = await fetchProject(state.session, state.activeProjectId);
}

async function openProjects({ replace = false } = {}) {
  if (!requireAuth() || blockChatNavigationWhileRunning()) return;
  if (state.images.some((item) => item.category === "document" && !item.attachmentId)) {
    showToast("Wait for the document upload to finish before opening projects.");
    return;
  }
  parkActiveConversationRun();
  state.temporaryChat = false;
  state.projectsOpen = true;
  state.activeProjectId = "";
  state.activeProject = null;
  state.activeConversationId = "";
  state.messages = [];
  state.images = [];
  renderImages();
  closeDocumentViewer();
  document.body.classList.remove("sidebar-open");
  await loadProjects();
  syncProjectsUrl({ replace });
  renderShell();
}

async function openProject(projectId, { replace = false } = {}) {
  if (!projectId || !requireAuth() || blockChatNavigationWhileRunning()) return;
  if (state.images.some((item) => item.category === "document" && !item.attachmentId)) {
    showToast("Wait for the document upload to finish before opening a project.");
    return;
  }
  parkActiveConversationRun();
  state.temporaryChat = false;
  state.projectsOpen = true;
  state.activeProjectId = projectId;
  state.activeProject = null;
  state.activeConversationId = "";
  state.messages = [];
  state.images = [];
  renderImages();
  document.body.classList.remove("sidebar-open");
  renderShell();
  try {
    await loadActiveProject();
    syncProjectsUrl({ replace });
    renderShell();
    els.promptInput?.focus();
  } catch (error) {
    state.activeProjectId = "";
    showToast(error.message || "Project could not be loaded.");
    await openProjects({ replace: true });
  }
}

function openProjectCreateDialog() {
  if (!requireAuth()) return;
  els.projectNameInput.value = "";
  els.projectCreateDialog.showModal();
  window.requestAnimationFrame(() => els.projectNameInput?.focus());
}

async function submitProjectCreate(event) {
  event.preventDefault();
  const name = els.projectNameInput.value.trim();
  if (!name) return;
  try {
    const payload = await createProject(state.session, name);
    state.projects = [payload.project, ...state.projects];
    els.projectCreateDialog.close();
    await openProject(payload.project.id);
  } catch (error) {
    showToast(error.message || "Project could not be created.");
  }
}

async function saveProjectPatch(patch, successMessage = "Project updated.") {
  if (!state.activeProjectId) return;
  const payload = await updateProject(state.session, state.activeProjectId, patch);
  if (state.activeProject) state.activeProject.project = payload.project;
  state.projects = state.projects.map((item) => item.id === payload.project.id ? payload.project : item);
  renderProjects();
  showToast(successMessage);
}

async function uploadProjectFiles(files) {
  const accepted = [...files].filter(isSupportedDocumentFile);
  if (!accepted.length) {
    showToast("Choose a PDF, Word, Excel, PowerPoint, CSV, or TSV file.");
    return;
  }
  const usage = state.activeProject?.usage || {};
  const pendingBytes = accepted.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (Number(usage.maxBytes || 0) > 0 && Number(usage.usedBytes || 0) + pendingBytes > Number(usage.maxBytes)) {
    showToast(`These files exceed this project's ${formatProjectBytes(usage.maxBytes)} knowledge capacity.`);
    return;
  }
  state.projectUploading = true;
  renderProjects();
  try {
    const projectId = state.activeProjectId;
    const uploaded = await Promise.all(accepted.map(async (file) => {
      const presigned = await presignUpload(state.session, file, "document", { projectId: state.activeProjectId });
      try {
        await putUploadContent(state.session, presigned, file, "document");
        return await completeUpload(state.session, presigned.uploadId);
      } catch (error) {
        await deleteAttachment(state.session, presigned.uploadId).catch(() => {});
        throw error;
      }
    }));
    await loadActiveProject();
    for (const document of uploaded.filter((item) => !item.document?.usable)) {
      void waitForDocumentReady(document.id, document.fileName)
        .catch(() => null)
        .then(async () => {
          if (!state.projectsOpen || state.activeProjectId !== projectId) return;
          await loadActiveProject();
          renderProjects();
        })
        .catch(() => {});
    }
  } catch (error) {
    showToast(error.message || "Project files could not be uploaded.");
  } finally {
    state.projectUploading = false;
    renderProjects();
  }
}

async function handleProjectViewClick(event) {
  const menuBtn = event.target.closest("[data-toggle-project-menu]");
  if (menuBtn) {
    const menu = els.projectView.querySelector("[data-project-menu]");
    const open = Boolean(menu?.classList.contains("hidden"));
    menu?.classList.toggle("hidden", !open);
    menuBtn.setAttribute("aria-expanded", String(open));
    return;
  }
  if (!event.target.closest(".project-menu-wrap")) {
    els.projectView.querySelector("[data-project-menu]")?.classList.add("hidden");
    els.projectView.querySelector("[data-toggle-project-menu]")?.setAttribute("aria-expanded", "false");
  }

  const create = event.target.closest("[data-create-project]");
  if (create) return openProjectCreateDialog();
  const open = event.target.closest("[data-open-project-id]");
  if (open) return openProject(open.dataset.openProjectId);
  if (event.target.closest("[data-projects-back]")) return openProjects();
  if (event.target.closest("[data-new-project-chat]")) {
    els.promptInput?.focus();
    return;
  }
  if (event.target.closest("[data-add-project-files]")) {
    els.projectFileInput?.click();
    return;
  }
  const deleteChat = event.target.closest("[data-delete-project-chat-id]");
  if (deleteChat) {
    const id = deleteChat.dataset.deleteProjectChatId;
    const conversation = (state.activeProject?.conversations || []).find((item) => item.id === id)
      || state.conversations.find((item) => item.id === id);
    if (!conversation) return;
    if (!state.conversations.some((item) => item.id === id)) state.conversations.unshift(conversation);
    openConfirmDialog(conversation);
    return;
  }
  const openChat = event.target.closest("[data-open-chat-id]");
  if (openChat) return openConversation(openChat.dataset.openChatId);
  const remove = event.target.closest("[data-remove-project-attachment]");
  if (remove) {
    event.stopPropagation();
    openDeleteConfirm({
      title: "Delete file?",
      body: `Remove "${remove.dataset.fileName || "this file"}" from this project?`,
      attachmentId: remove.dataset.removeProjectAttachment
    });
    return;
  }
  const view = event.target.closest("[data-view-project-attachment]");
  if (view) {
    if (view.dataset.ready !== "1") return;
    openDocumentViewer({
      attachmentId: view.dataset.viewProjectAttachment,
      fileName: view.dataset.fileName || "Document",
      format: view.dataset.format || ""
    });
    return;
  }
  if (event.target.closest("[data-save-project-instructions]")) {
    const instructions = els.projectView.querySelector(".project-instructions-input")?.value || "";
    try { await saveProjectPatch({ instructions }, "Instructions saved."); }
    catch (error) { showToast(error.message || "Instructions could not be saved."); }
    return;
  }
  if (event.target.closest("[data-delete-project]")) {
    openDeleteConfirm({
      title: "Delete project?",
      body: "Delete this project, its chats, and its files?",
      projectId: state.activeProjectId
    });
  }
}

async function handleProjectTitleChange(event) {
  const sort = event.target.closest("[data-project-sort]");
  if (sort) {
    state.projectSort = sort.value === "name" ? "name" : "updated";
    renderProjects();
    return;
  }
  const input = event.target.closest(".project-title-input");
  if (!input) return;
  const name = input.value.trim();
  if (!name || name === state.activeProject?.project?.name) return;
  try { await saveProjectPatch({ name }, "Project renamed."); }
  catch (error) { showToast(error.message || "Project could not be renamed."); }
}

function handleProjectSearch(event) {
  const input = event.target.closest("[data-project-search]");
  if (!input) return;
  state.projectSearch = input.value;
  const query = state.projectSearch.trim().toLowerCase();
  let visibleCount = 0;
  els.projectView.querySelectorAll("[data-open-project-id]").forEach((row) => {
    const project = state.projects.find((item) => item.id === row.dataset.openProjectId);
    const visible = !query || project?.name?.toLowerCase().includes(query);
    row.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  const empty = els.projectView.querySelector(".project-empty");
  if (empty) empty.hidden = visibleCount > 0;
}

/* ─── Conversations ─── */

function pinnedStorageKey() {
  const userId = state.me?.user?.id;
  return userId ? `${PINNED_CHATS_KEY}.${userId}` : "";
}

function loadPinnedChatIds() {
  const key = pinnedStorageKey();
  if (!key) {
    state.pinnedChatIds = [];
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    state.pinnedChatIds = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    state.pinnedChatIds = [];
  }
}

function savePinnedChatIds() {
  const key = pinnedStorageKey();
  if (!key) return;
  const value = JSON.stringify(state.pinnedChatIds);
  localStorage.setItem(key, value);
  if (isNative()) void preferences.set(key, value);
}

function isPinnedChat(id) {
  return state.pinnedChatIds.includes(id);
}

function togglePinChat(id) {
  if (!id) return;
  if (isPinnedChat(id)) {
    state.pinnedChatIds = state.pinnedChatIds.filter((item) => item !== id);
  } else {
    state.pinnedChatIds = [id, ...state.pinnedChatIds.filter((item) => item !== id)];
  }
  savePinnedChatIds();
  closeConversationMenus();
  renderConversations();
}

function unpinChat(id) {
  if (!isPinnedChat(id)) return;
  state.pinnedChatIds = state.pinnedChatIds.filter((item) => item !== id);
  savePinnedChatIds();
}

function sortedConversations() {
  return state.conversations.filter((conversation) => !conversation.project_id).sort((a, b) => {
    const ta = a.updated_at || a.created_at || "";
    const tb = b.updated_at || b.created_at || "";
    return String(tb).localeCompare(String(ta));
  });
}

function formatChatAge(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const day = 86400000;
  if (diff < day) return "Today";
  if (diff < 7 * day) return "Past week";
  if (diff < 30 * day) return "Past month";
  if (diff < 365 * day) return "Past year";
  return "Older";
}

function conversationMenuMarkup(conversation) {
  const pinned = isPinnedChat(conversation.id);
  return `
    <div class="conversation-menu-wrap">
      <button class="conversation-menu-btn" type="button" data-toggle-menu-id="${escapeHtml(conversation.id)}" aria-label="Chat options" aria-haspopup="menu" aria-expanded="false">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
      <div class="conversation-menu hidden" data-menu-id="${escapeHtml(conversation.id)}" role="menu">
        <button class="conversation-menu-item" type="button" role="menuitem" data-pin-chat-id="${escapeHtml(conversation.id)}">
          <span class="conversation-menu-item-icon">${PIN_MENU_ICON_SVG}</span>
          <span>${pinned ? "Unpin chat" : "Pin chat"}</span>
        </button>
        <button class="conversation-menu-item" type="button" role="menuitem" data-rename-chat-id="${escapeHtml(conversation.id)}">
          <span class="conversation-menu-item-icon">${RENAME_MENU_ICON_SVG}</span>
          <span>Rename chat</span>
        </button>
        <button class="conversation-menu-item conversation-menu-danger" type="button" role="menuitem" data-delete-chat-id="${escapeHtml(conversation.id)}">
          <span class="conversation-menu-item-icon">${DELETE_MENU_ICON_SVG}</span>
          <span>Delete chat</span>
        </button>
      </div>
    </div>
  `;
}

function renderConversationRow(conversation) {
  const active = conversation.id === state.activeConversationId ? "active" : "";
  return `
    <div class="conversation-row ${active}" data-chat-id="${escapeHtml(conversation.id)}">
      <button class="conversation-item" type="button" data-open-chat-id="${escapeHtml(conversation.id)}">
        <span>${escapeHtml(conversation.title || "New chat")}</span>
      </button>
      ${conversationMenuMarkup(conversation)}
    </div>
  `;
}

function renderPinnedPopupList(conversations) {
  if (!els.pinnedPopupList) return;
  if (!conversations.length) {
    els.pinnedPopupList.innerHTML = `<div class="pinned-popup-empty">No pinned chats yet.</div>`;
    return;
  }
  els.pinnedPopupList.innerHTML = conversations.map((conversation) => `
    <button class="pinned-popup-item" type="button" role="menuitem" data-open-chat-id="${escapeHtml(conversation.id)}">
      <span>${escapeHtml(conversation.title || "New chat")}</span>
    </button>
  `).join("");
}

function renderConversations() {
  const sorted = sortedConversations();
  const pinned = sorted.filter((conversation) => isPinnedChat(conversation.id));
  const recent = sorted.filter((conversation) => !isPinnedChat(conversation.id));

  if (els.pinnedSection) {
    els.pinnedSection.classList.toggle("hidden", !pinned.length);
  }
  if (els.pinnedConversationList) {
    els.pinnedConversationList.innerHTML = pinned.map(renderConversationRow).join("");
  }
  if (els.conversationList) {
    els.conversationList.innerHTML = recent.map(renderConversationRow).join("");
  }
  renderPinnedPopupList(pinned);
}

function isPinnedPopupOpen() {
  return Boolean(els.pinnedPopup && !els.pinnedPopup.classList.contains("hidden"));
}

function closePinnedPopup() {
  if (!els.pinnedPopup) return;
  els.pinnedPopup.classList.add("hidden");
  els.pinnedChatsButton?.setAttribute("aria-expanded", "false");
}

function togglePinnedPopup() {
  if (!els.pinnedPopup || !els.pinnedChatsButton) return;
  closeConversationMenus();
  closeSearchDialog();
  closeProfileMenu();
  const open = isPinnedPopupOpen();
  if (open) {
    closePinnedPopup();
    return;
  }
  renderConversations();
  els.pinnedPopup.classList.remove("hidden");
  els.pinnedChatsButton.setAttribute("aria-expanded", "true");
}

function isSearchDialogOpen() {
  return Boolean(els.searchDialog && !els.searchDialog.classList.contains("hidden"));
}

function renderSearchResults(query = "") {
  if (!els.searchChatResults) return;
  const needle = query.trim().toLowerCase();
  const matches = sortedConversations().filter((conversation) => {
    const title = String(conversation.title || "New chat").toLowerCase();
    return !needle || title.includes(needle);
  });

  if (!matches.length) {
    els.searchChatResults.innerHTML = `<div class="search-dialog-empty">${needle ? "No chats found." : "No chats yet."}</div>`;
    return;
  }

  els.searchChatResults.innerHTML = matches.map((conversation) => {
    const active = conversation.id === state.activeConversationId ? "active" : "";
    return `
      <button class="search-result-row ${active}" type="button" data-open-chat-id="${escapeHtml(conversation.id)}">
        <span class="search-result-icon">${CHAT_ICON_SVG}</span>
        <span class="search-result-copy">
          <span class="search-result-title">${escapeHtml(conversation.title || "New chat")}</span>
        </span>
        <span class="search-result-meta">${escapeHtml(formatChatAge(conversation.updated_at || conversation.created_at))}</span>
      </button>
    `;
  }).join("");
}

function openSearchDialog() {
  if (!els.searchDialog) return;
  closePinnedPopup();
  closeConversationMenus();
  closeProfileMenu();
  els.searchDialog.classList.remove("hidden");
  els.searchDialog.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "search";
  renderSearchResults("");
  window.requestAnimationFrame(() => {
    els.searchChatInput?.focus();
    els.searchChatInput?.select();
  });
}

function closeSearchDialog() {
  if (!els.searchDialog) return;
  els.searchDialog.classList.add("hidden");
  els.searchDialog.setAttribute("aria-hidden", "true");
  if (els.searchChatInput) els.searchChatInput.value = "";
  if (els.overlay.dataset.mode === "search") {
    els.overlay.hidden = true;
    delete els.overlay.dataset.mode;
  }
}

function closeConversationMenus() {
  document.querySelectorAll(".conversation-menu:not(.hidden)").forEach((menu) => menu.classList.add("hidden"));
  document.querySelectorAll(".conversation-menu-btn[aria-expanded='true']").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
  state.openConversationMenuId = "";
}

function toggleConversationMenu(conversationId, button) {
  const menu = document.querySelector(`[data-menu-id="${conversationId}"]`);
  if (!menu) return;
  const isOpen = state.openConversationMenuId === conversationId;
  closeConversationMenus();
  if (isOpen) return;
  menu.classList.remove("hidden", "conversation-menu--up");
  button?.setAttribute("aria-expanded", "true");
  state.openConversationMenuId = conversationId;

  const scroller = menu.closest(".sidebar-mid");
  if (scroller) {
    const menuRect = menu.getBoundingClientRect();
    const bounds = scroller.getBoundingClientRect();
    if (menuRect.bottom > bounds.bottom) {
      menu.classList.add("conversation-menu--up");
    }
  }
}

async function openConversation(conversationId) {
  if (!conversationId) return;
  if (blockChatNavigationWhileRunning()) return;
  if (state.images.some((item) => item.category === "document" && !item.attachmentId)) {
    showToast("Wait for the document upload to finish before switching chats.");
    return;
  }
  parkActiveConversationRun();
  researchController.stopResearchPolling();
  state.images = state.images.filter((item) => item.category !== "document");
  state.temporaryChat = false;
  let conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    conversation = (state.activeProject?.conversations || []).find((item) => item.id === conversationId) || null;
    if (conversation) state.conversations.unshift(conversation);
  }
  state.activeProjectId = conversation?.project_id || "";
  state.projectsOpen = false;
  state.activeProject = null;
  state.activeConversationId = conversationId;
  clearFollowUps();
  document.body.classList.remove("sidebar-open");
  state.compareDescribeImages = false;
  stopPendingArtifactPolls();
  closeDocumentViewer();
  compareController.closeCompareContextBanner();
  closeSearchDialog();
  closePinnedPopup();
  closeConversationMenus();
  try {
    await loadActiveConversation();
    await restorePendingDocuments();
    syncConversationUrl();
    renderImages();
    renderShell();
  } catch (err) {
    showToast(err.message);
  }
}

async function handleConversationListClick(event) {
  const menuToggle = event.target.closest("[data-toggle-menu-id]");
  if (menuToggle) {
    event.stopPropagation();
    toggleConversationMenu(menuToggle.dataset.toggleMenuId, menuToggle);
    return;
  }

  const pinAction = event.target.closest("[data-pin-chat-id]");
  if (pinAction) {
    togglePinChat(pinAction.dataset.pinChatId);
    return;
  }

  const renameAction = event.target.closest("[data-rename-chat-id]");
  if (renameAction) {
    const conversation = state.conversations.find((item) => item.id === renameAction.dataset.renameChatId);
    if (conversation) openRenameDialog(conversation);
    return;
  }

  const del = event.target.closest("[data-delete-chat-id]");
  if (del) {
    const conversation = state.conversations.find((item) => item.id === del.dataset.deleteChatId);
    if (conversation) openConfirmDialog(conversation);
    return;
  }

  const open = event.target.closest("[data-open-chat-id]");
  if (!open) return;
  await openConversation(open.dataset.openChatId);
}

/* ─── Model selector ─── */

function selectedModel() {
  return state.models.find((m) => m.id === state.settings.model);
}

function modelById(id) {
  return state.models.find((m) => m.id === id);
}

function modelDisplayName(id) {
  if (id === OPENROUTER_TEXT_MODEL) return "DeepSeek";
  if (id === OPENROUTER_TEXT_PRO_MODEL) return "DeepSeek Pro";
  if (id === OPENROUTER_VISION_MODEL) return "MiMo";
  if (id === OPENROUTER_VISION_PRO_MODEL) return "MiMo Pro";
  if (id === OPENROUTER_PRO_MODEL) return "MiniMax M3";
  const model = modelById(id);
  return compactModelDisplayName(model?.name || model?.rawName || id) || id;
}

function toggleModelDropdown() {
  const isOpen = !els.modelDropdown.classList.contains("hidden");
  els.modelDropdown.classList.toggle("hidden", isOpen);
  const nowOpen = !els.modelDropdown.classList.contains("hidden");
  els.modelButton.setAttribute("aria-expanded", String(nowOpen));
  els.composerModelWrap.classList.toggle("is-open", nowOpen);
  if (!isOpen) {
    renderModelCatalog();
  }
}

function closeModelDropdown() {
  els.modelDropdown.classList.add("hidden");
  els.modelButton.setAttribute("aria-expanded", "false");
  els.composerModelWrap.classList.remove("is-open");
}

function toggleActionMenu() {
  const open = els.composerActionMenu.classList.contains("hidden")
    && els.writingStyleMenu?.classList.contains("hidden");
  els.composerActionMenu.classList.toggle("hidden", !open);
  els.writingStyleMenu?.classList.add("hidden");
  els.actionMenuButton.setAttribute("aria-expanded", String(open));
  els.composerActionMenuWrap.classList.toggle("is-open", open);
}

function openWritingStyleMenu() {
  els.composerActionMenu?.classList.add("hidden");
  els.writingStyleMenu?.classList.remove("hidden");
  els.actionMenuButton?.setAttribute("aria-expanded", "true");
  els.composerActionMenuWrap?.classList.add("is-open");
}

function openActionMenuRoot() {
  els.writingStyleMenu?.classList.add("hidden");
  els.composerActionMenu?.classList.remove("hidden");
}

function closeActionMenu() {
  if (!els.composerActionMenu) return;
  els.composerActionMenu.classList.add("hidden");
  els.writingStyleMenu?.classList.add("hidden");
  els.actionMenuButton?.setAttribute("aria-expanded", "false");
  els.composerActionMenuWrap?.classList.remove("is-open");
}

function toggleSidebar() {
  closeProfileMenu();
  closePinnedPopup();
  closeConversationMenus();
  if (document.body.classList.contains("capacitor-native") || window.matchMedia("(max-width: 860px)").matches) {
    document.body.classList.toggle("sidebar-open");
    return;
  }
  document.body.classList.toggle("sidebar-expanded");
}

function renderModelCatalog() {
  const mode = selectedModelMode();
  els.modelCatalog.innerHTML = `
    <button class="model-option mode-option ${mode === "thinking" ? "active" : ""}" type="button" data-model-mode="thinking" aria-selected="${mode === "thinking"}">
      <span class="model-option-main">
        <span class="model-option-copy">
          <span class="model-option-name">Thinking</span>
          <span class="model-option-desc">Best model for most tasks.</span>
        </span>
      </span>
      <span class="model-option-check">${mode === "thinking" ? "✓" : ""}</span>
    </button>
    <button class="model-option mode-option ${mode === "pro" ? "active" : ""}" type="button" data-model-mode="pro" aria-selected="${mode === "pro"}">
      <span class="model-option-main">
        <span class="model-option-copy">
          <span class="model-option-name">Pro <span class="model-price-note">4x</span></span>
          <span class="model-option-desc">Use for the most complex tasks.</span>
        </span>
      </span>
      <span class="model-option-check">${mode === "pro" ? "✓" : ""}</span>
    </button>
  `;
}

function renderModelOptions() {
  const mode = selectedModelMode();
  const displayName = modelModeLabel(mode);

  els.modelButton.setAttribute("aria-label", `Model: ${displayName}`);
  els.modelButton.classList.remove("has-brand-logo");
  els.modelButton.classList.toggle("pro-active", mode === "pro");
  els.modelLabel.classList.remove("hidden");
  els.modelPriceBadge?.classList.toggle("hidden", mode !== "pro");

  els.modelLabel.textContent = displayName;
  renderModelCatalog();
  compareController.renderCompareControls();
}

/* ─── Messages ─── */

function normalizeMessage(msg) {
  return { ...msg, toolCalls: msg.toolCalls || msg.tool_calls || [] };
}

function councilSessionId(msg) {
  return msg?.metadata?.council?.sessionId || "";
}

function councilRole(msg) {
  return msg?.metadata?.council?.role || "";
}

function councilPeerReviewStatus(panelists, chairman) {
  if (chairman) return "done";
  if (panelists.some((p) => p.metadata?.council?.peerRank != null && Number(p.metadata?.council?.ballotCount || 0) > 0)) return "done";
  const statuses = panelists.map((p) => p.metadata?.council?.peerReviewStatus).filter(Boolean);
  if (statuses.includes("error")) return "error";
  if (statuses.includes("skipped")) return "done";
  return "pending";
}

function messageViews(messages) {
  const views = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = normalizeMessage(messages[i]);

    if (msg.councilGroup) {
      views.push({ type: "council", council: msg });
      continue;
    }

    if (msg.compareGroup) {
      views.push({ type: "compare", messages: msg.compareResponses || [] });
      continue;
    }

    const role = msg.role === "user" ? "user" : "assistant";
    if (role !== "assistant") {
      views.push({ type: "message", message: msg });
      continue;
    }

    // Detect council session (panelist+chairman messages sharing metadata.council.sessionId)
    const sessionId = councilSessionId(msg);
    if (sessionId) {
      const panelists = [];
      let chairman = null;
      let j = i;
      while (j < messages.length) {
        const next = normalizeMessage(messages[j]);
        if (next.role !== "assistant" || councilSessionId(next) !== sessionId) break;
        if (councilRole(next) === "chairman") chairman = next;
        else panelists.push(next);
        j++;
      }
      if (panelists.length) {
        views.push({
          type: "council",
          council: {
            sessionId,
            panelists,
            chairman,
            stage1Done: true,
            stage2Status: councilPeerReviewStatus(panelists, chairman),
            stage3Status: chairman ? (chairman.error ? "error" : (chairman.content ? "done" : "pending")) : "pending"
          }
        });
        i = j - 1;
        continue;
      }
    }

    const group = [msg];
    while (i + 1 < messages.length) {
      const next = normalizeMessage(messages[i + 1]);
      if (next.compareGroup || next.councilGroup || next.role === "user" || councilSessionId(next)) break;
      group.push(next);
      i++;
    }

    views.push(group.length > 1 ? { type: "compare", messages: group } : { type: "message", message: msg });
  }
  return views;
}

function captureReasoningOpenState() {
  reasoningOpenIds = new Set();
  for (const el of els.messages.querySelectorAll("details.reasoning[open][data-message-id]")) {
    reasoningOpenIds.add(el.dataset.messageId);
  }
  councilController.captureCouncilDetailsOpenState();
}

function isAssistantMessageStreaming(message) {
  if (!state.running || message?.error) return false;
  if (message?.finishReason && message.finishReason !== "tool_calls") return false;
  return Boolean(message?.id);
}

function isFinalFinishReason(reason) {
  return Boolean(reason && reason !== "tool_calls");
}

function resolveReasoningDurationMs(message) {
  const stored = message?.metadata?.reasoningDurationMs ?? message?.reasoningDurationMs;
  if (stored != null && Number.isFinite(Number(stored))) return Math.max(0, Number(stored));
  if (message?.activityStartedAt && message?.activityEndedAt) {
    return Math.max(0, message.activityEndedAt - message.activityStartedAt);
  }
  if (message?.reasoningStartedAt && message?.reasoningEndedAt) {
    return Math.max(0, message.reasoningEndedAt - message.reasoningStartedAt);
  }
  return null;
}

function markActivityStarted(message) {
  if (!message.activityStartedAt) message.activityStartedAt = Date.now();
}

function markActivityEnded(message) {
  if (message.activityStartedAt && !message.activityEndedAt) {
    message.activityEndedAt = Date.now();
  }
}

function markReasoningStarted(message) {
  markActivityStarted(message);
  if (!message.reasoningStartedAt) message.reasoningStartedAt = Date.now();
}

function markReasoningEnded(message) {
  if (message.reasoningStartedAt && !message.reasoningEndedAt) {
    message.reasoningEndedAt = Date.now();
  }
}

function markAssistantActivityTree(message) {
  const now = Date.now();
  const stamp = (entry) => {
    if (entry && !entry.activityStartedAt) entry.activityStartedAt = now;
  };
  stamp(message);
  if (message?.compareGroup) {
    for (const response of message.compareResponses || []) stamp(response);
  }
  if (message?.councilGroup) {
    for (const panelist of message.panelists || []) stamp(panelist);
    if (message.chairman) stamp(message.chairman);
  }
}

function markAssistantActivityDoneTree(message) {
  const now = Date.now();
  const stamp = (entry) => {
    if (entry?.activityStartedAt && !entry.activityEndedAt) entry.activityEndedAt = now;
  };
  stamp(message);
  if (message?.compareGroup) {
    for (const response of message.compareResponses || []) stamp(response);
  }
  if (message?.councilGroup) {
    for (const panelist of message.panelists || []) stamp(panelist);
    if (message.chairman) stamp(message.chairman);
  }
}

function isAdminUser() {
  return state.me?.profile?.role === "admin";
}

function renderAdminOnlyControls() {
  const admin = isAdminUser();
  els.settingsModelParamsSection?.classList.toggle("hidden", !admin);
  els.settingsReasoningSection?.classList.toggle("hidden", !admin);
  els.settingsSystemPromptSection?.classList.toggle("hidden", !admin);
  els.settingsButtonAlt?.classList.toggle("hidden", !admin);
}

function reasoningSummaryLabel(message, { streaming = false } = {}) {
  const stillThinking = streaming && !isFinalFinishReason(message?.finishReason) && !message?.reasoningEndedAt;
  if (stillThinking) return "Thinking";

  const ms = resolveReasoningDurationMs(message);
  if (ms != null) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return `Worked for ${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  return "Worked";
}

function toolStatusLabel(tool = {}) {
  const name = String(tool.name || "").toLowerCase();
  if (name === "web_search") return "Searching web";
  if (name === "read_url") return "Reading page";
  if (name === "search_document") return "Searching documents";
  if (name === "read_document") return "Reading document";
  if (name === "extract_tables") return "Reading tables";
  if (name === "create_document") return "Creating document";
  if (name === "edit_document") return "Editing document";
  if (name === "export_document") return "Exporting document";
  if (name === "limit") return "Wrapping up";
  return "Working";
}

function currentThinkingStatus(message, { streaming = false } = {}) {
  if (message?.error) return "";
  const tools = Array.isArray(message?.toolEvents) ? message.toolEvents : [];
  const runningTool = [...tools].reverse().find((tool) => tool.status === "running");
  if (streaming && runningTool) return toolStatusLabel(runningTool);

  if (isFinalFinishReason(message?.finishReason)) {
    const ms = resolveReasoningDurationMs(message);
    if (ms != null) return reasoningSummaryLabel(message, { streaming: false });
    return "Worked";
  }

  if (streaming) {
    const lastTool = [...tools].reverse().find((tool) => tool.status === "done");
    return lastTool ? "Reviewing results" : "Thinking";
  }

  return "";
}

function renderThinkingStatus(message, { streaming = false } = {}) {
  if (rawTextContent(message?.content).trim()) return "";
  const label = currentThinkingStatus(message, { streaming });
  if (!label) return "";
  const active = streaming && !isFinalFinishReason(message?.finishReason);
  return `<div class="thinking-status ${active ? "is-active" : "is-done"}" role="status" aria-live="polite"><span data-label="${escapeHtml(label)}">${escapeHtml(label)}</span></div>`;
}

function renderReasoning(message, { streaming = false } = {}) {
  const text = String(message?.reasoning || "");
  const hasReasoning = text.trim().length > 0;
  if (!hasReasoning && !streaming) return "";

  const messageId = message?.id ? String(message.id) : "";
  const shouldOpen = messageId && reasoningOpenIds.has(messageId);
  const openAttr = shouldOpen ? " open" : "";
  const idAttr = messageId ? ` data-message-id="${escapeHtml(messageId)}"` : "";
  const stillThinking = streaming && !isFinalFinishReason(message?.finishReason) && !message?.reasoningEndedAt;
  const streamingClass = stillThinking ? " is-streaming" : "";
  const doneClass = !stillThinking && (hasReasoning || message?.reasoningEndedAt) ? " is-done" : "";
  const body = hasReasoning ? renderContent(text) : "";
  const summary = reasoningSummaryLabel(message, { streaming });

  return `<details class="reasoning${streamingClass}${doneClass}"${openAttr}${idAttr}><summary>${escapeHtml(summary)}</summary><div>${body}</div></details>`;
}

function renderAssistantActivity(message, { streaming = false } = {}) {
  return isAdminUser() && state.settings.showModelReasoning
    ? renderReasoning(message, { streaming })
    : renderThinkingStatus(message, { streaming });
}

function renderToolCalls() {
  return "";
}

function renderMessageError(message) {
  if (!message.error) return "";
  return `<div class="message-error"><span>${escapeHtml(message.error)}</span></div>`;
}

function canRetryAssistant(message) {
  if (state.running) return false;
  if (message?.councilGroup || message?.compareGroup) return false;
  const id = message?.id ? String(message.id) : "";
  if (!id || id.startsWith("local_")) return false;
  if (message.error === "Stopped by user.") return false;
  return true;
}

function renderMessageRetry(message) {
  if (!canRetryAssistant(message)) return "";
  return `<button class="msg-action-btn msg-retry-btn" type="button" data-retry-assistant-id="${escapeHtml(String(message.id))}" aria-label="Retry" title="Retry"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button>`;
}

function canAdjustAssistant(message) {
  if (!canRetryAssistant(message) || !rawTextContent(message.content).trim()) return false;
  const latest = [...state.messages].reverse().find((item) => item.role === "assistant");
  return String(latest?.id || "") === String(message.id || "");
}

function renderResponseAdjustmentMenu(message) {
  if (!canAdjustAssistant(message)) return "";
  const id = escapeHtml(String(message.id));
  return `<details class="message-more-menu">
    <summary class="msg-action-btn" aria-label="More response actions" title="More response actions">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
    </summary>
    <div class="message-more-popover" role="menu">
      <button type="button" role="menuitem" data-adjust-response="longer" data-adjust-assistant-id="${id}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8M12 3v18M8 21h8"/><path d="m9 7 3-3 3 3M9 17l3 3 3-3"/></svg>
        <span>Longer</span>
      </button>
      <button type="button" role="menuitem" data-adjust-response="shorter" data-adjust-assistant-id="${id}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8M12 3v18M8 21h8"/><path d="m9 10 3 3 3-3M9 14l3-3 3 3"/></svg>
        <span>Shorter</span>
      </button>
    </div>
  </details>`;
}

function renderToolStatuses() {
  return "";
}

function citationListFromMessage(message) {
  if (Array.isArray(message?.citations) && message.citations.length) return message.citations;
  const combined = [];
  const meta = message?.metadata?.websearch;
  if (meta && Array.isArray(meta.citations) && meta.citations.length) combined.push(...meta.citations);
  const docs = message?.metadata?.documents;
  if (docs && Array.isArray(docs.citations) && docs.citations.length) combined.push(...docs.citations);
  return combined;
}

function artifactKey(artifact) {
  return (
    artifact?.attachment_id
    || artifact?.document_file_id
    || artifact?.download_url
    || (artifact?.pending && artifact?.job_id ? `job:${artifact.job_id}` : "")
    || ""
  );
}

function artifactListFromMessage(message) {
  const combined = [];
  if (Array.isArray(message?.artifacts)) combined.push(...message.artifacts);
  const docs = message?.metadata?.documents;
  if (docs && Array.isArray(docs.artifacts)) combined.push(...docs.artifacts);
  const seen = new Set();
  const out = [];
  for (const artifact of combined) {
    const key = artifactKey(artifact);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(artifact);
  }
  return out;
}

function mergeArtifacts(message, artifacts = []) {
  if (!Array.isArray(artifacts) || !artifacts.length) return;
  if (!message.artifacts) message.artifacts = [];
  const seen = new Set(message.artifacts.map(artifactKey).filter(Boolean));
  for (const artifact of artifacts) {
    const key = artifactKey(artifact);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    message.artifacts.push(artifact);
  }
}

function replacePendingArtifact(message, jobId, resolved) {
  if (!message || !jobId || !resolved) return false;
  const lists = [];
  if (Array.isArray(message.artifacts)) lists.push(message.artifacts);
  const metaArtifacts = message.metadata?.documents?.artifacts;
  if (Array.isArray(metaArtifacts)) lists.push(metaArtifacts);
  let mutated = false;
  for (const list of lists) {
    const idx = list.findIndex((entry) => entry?.pending && entry?.job_id === jobId);
    if (idx === -1) continue;
    list[idx] = { ...resolved };
    mutated = true;
  }
  return mutated;
}

const {
  openDocumentViewer,
  closeDocumentViewer,
  renderDocumentViewer,
  syncPendingArtifactPolls,
  stopPendingArtifactPolls,
  initDocumentViewerWidth,
  beginDocumentViewerResize
} = createDocumentViewer({
  elements: {
    documentViewer: els.documentViewer,
    documentViewerResizer: els.documentViewerResizer,
    documentViewerTitle: els.documentViewerTitle,
    documentViewerMeta: els.documentViewerMeta,
    documentViewerDownload: els.documentViewerDownload,
    documentViewerDownloadMenu: document.querySelector("#documentViewerDownloadMenu"),
    documentViewerFullscreen: els.documentViewerFullscreen,
    documentViewerClose: els.documentViewerClose,
    documentViewerBody: els.documentViewerBody
  },
  state,
  fetchDocumentJobStatus,
  fetchAttachmentView,
  saveEditableDocument,
  exportEditableDocument,
  downloadAttachment,
  showToast,
  queueRenderMessages,
  escapeHtml,
  artifactListFromMessage,
  replacePendingArtifact
});

function citationHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function attachmentDownloadPath(href) {
  const path = String(href || "").trim();
  const match = path.match(/^\/api\/attachments\/([^/?#]+)\/download\/?$/i);
  return match ? match[1] : "";
}

function documentCitationTitle(entry) {
  const source = String(entry?.source || "").trim();
  if (source) return source;
  const title = String(entry?.title || "").trim();
  if (!title) return "Document";
  const dash = title.indexOf(" - ");
  return dash === -1 ? title : title.slice(0, dash).trim() || title;
}

/* Display title for a citation. Documents are shown by their actual file
   name (e.g. "cmp466 hw3.pdf"), never the generic "Document" or a
   per-page "<file> - Page N" label. */
function citationDisplayTitle(entry) {
  if (entry?.type === "document") return documentCitationTitle(entry);
  return String(entry?.title || "").trim();
}

function dedupeCitationsForDisplay(citations) {
  const out = [];
  const seenDocs = new Set();
  const seenWeb = new Set();

  for (const entry of citations) {
    if (entry?.type === "document") {
      const key = entry.attachment_id || entry.document_file_id || entry.url;
      if (!key || seenDocs.has(key)) continue;
      seenDocs.add(key);
      out.push({ ...entry, title: documentCitationTitle(entry) });
      continue;
    }

    const key = entry.url || citationHost(entry.url);
    if (!key || seenWeb.has(key)) continue;
    seenWeb.add(key);
    out.push(entry);
  }

  return out;
}

function citationFaviconUrl(url) {
  if (String(url || "").startsWith("/")) return "";
  const host = citationHost(url);
  if (!host) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
}

function isClickableSourceUrl(url) {
  const value = String(url || "").trim();
  return /^https?:\/\//i.test(value);
}

function uniqueCitationPreview(citations, limit = 3) {
  const seen = new Set();
  const preview = [];
  for (const entry of citations) {
    const host = citationHost(entry.url);
    const key = host || entry.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    preview.push(entry);
    if (preview.length >= limit) break;
  }
  return preview;
}

function sourceShortLabel(entry) {
  const title = citationDisplayTitle(entry);
  if (title.length > 14) return `${title.slice(0, 11)}…`;
  if (title) return title;
  const host = citationHost(entry.url);
  if (!host) return "Source";
  const base = host.split(".")[0];
  if (!base || base === "www") return host.length > 14 ? `${host.slice(0, 11)}…` : host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function renderInlineSourcePill(sources) {
  if (!sources.length) return "";
  const primary = sources[0];
  const icon = citationFaviconUrl(primary.url);
  const extra = sources.length - 1;
  const rows = sources.map((entry) => {
    const host = citationHost(entry.url);
    const rowIcon = citationFaviconUrl(entry.url);
    const title = citationDisplayTitle(entry) || host || entry.url;
    const href = isClickableSourceUrl(entry.url) ? entry.url : "";
    const content = `
      ${rowIcon ? `<img src="${escapeHtml(rowIcon)}" alt="" width="14" height="14" decoding="async">` : ""}
      <span class="inline-source-row-title">${escapeHtml(title)}</span>
      ${host ? `<span class="inline-source-row-host">${escapeHtml(host)}</span>` : ""}
    `;
    if (entry?.type === "document" && entry.attachment_id) {
      return `<button class="inline-source-row" type="button" data-view-attachment-id="${escapeHtml(entry.attachment_id)}" data-file-name="${escapeHtml(entry.source || title || "Document")}">${content}</button>`;
    }
    if (!href) return `<div class="inline-source-row is-static">${content}</div>`;
    return `
      <a class="inline-source-row" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
        ${content}
      </a>
    `;
  }).join("");

  return `<details class="inline-source-pill"><summary class="inline-source-pill-trigger">${icon ? `<img class="inline-source-favicon" src="${escapeHtml(icon)}" alt="" width="14" height="14" decoding="async">` : ""}<span class="inline-source-pill-label">${escapeHtml(sourceShortLabel(primary))}</span>${extra > 0 ? `<span class="inline-source-pill-more">+${extra}</span>` : ""}</summary><div class="inline-source-panel">${rows}</div></details>`;
}

function stripLeakedCitationHtml(text) {
  let s = String(text ?? "");
  s = s.replace(/<details\b[^>]*\binline-source-pill\b[\s\S]*?<\/details>/gi, "");
  s = s.replace(/<details\b[^>]*\binline-source-pill\b[\s\S]*?(?=\n\n|```|$)/gi, "");
  s = s.replace(/<\/?(?:details|summary|div|span|a|img)\b[^>]*\binline-source-[\w-]+\b[^>]*>/gi, "");
  s = s.replace(/```[\w-]*\n[\s\S]*?(?:inline-source-|<\/details>)[\s\S]*?```/gi, "");
  s = s.replace(/```php-template\n[\s\S]*?```/gi, "");
  s = s.replace(/<\/details>/gi, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

// Keep in sync with the mirrored copy in server/saas/messages.js (client/server bundles are separate).
function stripLeakedToolMarkup(value) {
  const text = String(value ?? "");
  const dsmlTag = /<[^>]*\bDSML\b/i;
  if (!dsmlTag.test(text)) return text;
  return text
    .replace(/<\s*\|\s*\|?\s*DSML\s*\|[\s\S]*?<\s*\/\s*\|\s*\|?\s*DSML\s*\|\s*\|?\s*tool_calls\s*>/gi, "")
    .split(/\r?\n/)
    .filter((line) => !dsmlTag.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isPlaceholderPeerReason(value) {
  return /^<?\s*reason\s*>?$/i.test(String(value || "").trim());
}

const {
  applyStreamEvent,
  applyToolEvent,
  applyCompareStreamEvent,
  applyCouncilStreamEvent,
  ensureToolState
} = createStreamReducer({
  isAdminUser,
  mergeArtifacts,
  markActivityStarted,
  markActivityEnded,
  markReasoningStarted,
  markReasoningEnded,
  normalizeClientUsage,
  stripLeakedToolMarkup,
  isFinalFinishReason,
  isPlaceholderPeerReason
});

function addTextToComposerPaste(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  const combined = [state.pastedText, text].filter(Boolean).join("\n\n");
  if (combined.length > LONG_PASTE_MAX_CHARS) {
    showToast("Pasted text is too long. Keep it under 95,000 characters.");
    return false;
  }
  state.pastedText = combined;
  renderImages();
  updateSendButton();
  return true;
}

function selectionActionsEnabled() {
  return !isNative() && window.matchMedia("(pointer: fine)").matches;
}

function hideSelectionActions() {
  els.selectionActions?.classList.add("hidden");
}

function showSelectionActionsFromCurrentSelection() {
  if (!selectionActionsEnabled() || !els.selectionActions) return hideSelectionActions();
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return hideSelectionActions();
  const text = selection.toString().trim();
  if (!text) return hideSelectionActions();

  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;
  if (!(node instanceof Element) || !node.closest(".message.assistant .message-content")) {
    return hideSelectionActions();
  }

  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return hideSelectionActions();
  selectedTextContext = {
    text: text.slice(0, LONG_PASTE_MAX_CHARS),
    rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
  };
  els.selectionActions.classList.remove("hidden");
  requestAnimationFrame(() => {
    const width = els.selectionActions.offsetWidth;
    const height = els.selectionActions.offsetHeight;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
    const below = rect.bottom + 8;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 8);
    els.selectionActions.style.left = `${left}px`;
    els.selectionActions.style.top = `${top}px`;
  });
}

function renderSideChat() {
  if (!els.sideChatMessages) return;
  els.sideChatMessages.innerHTML = sideChatState.messages.map((message, index) => {
    const text = rawTextContent(message.content);
    const body = message.role === "assistant" ? renderContent(text) : renderPlainText(text);
    const streaming = message.role === "assistant"
      && sideChatState.running
      && index === sideChatState.messages.length - 1;
    const activity = message.role === "assistant"
      ? renderAssistantActivity(message, { streaming })
      : "";
    return `<div class="side-chat-message ${message.role}">${activity}${body}${message.error ? `<span class="side-chat-error">${escapeHtml(message.error)}</span>` : ""}</div>`;
  }).join("");
  els.sideChatSend.disabled = sideChatState.running || !els.sideChatInput.value.trim();
  requestAnimationFrame(() => {
    els.sideChatMessages.scrollTop = els.sideChatMessages.scrollHeight;
  });
}

function closeSideChat() {
  sideChatState.abortController?.abort();
  sideChatState.abortController = null;
  sideChatState.running = false;
  sideChatState.context = "";
  sideChatState.messages = [];
  els.sideChatPanel?.classList.add("hidden");
  if (els.sideChatInput) els.sideChatInput.value = "";
}

function openSideChat(context, anchorRect) {
  if (!selectionActionsEnabled() || !els.sideChatPanel) return;
  sideChatState.abortController?.abort();
  sideChatState.context = String(context || "").trim();
  sideChatState.messages = [];
  sideChatState.running = false;
  sideChatState.abortController = null;
  els.sideChatContext.textContent = sideChatState.context.replace(/\s+/g, " ").slice(0, 180);
  els.sideChatPanel.classList.remove("hidden");
  const panelWidth = els.sideChatPanel.offsetWidth || 380;
  const panelHeight = els.sideChatPanel.offsetHeight || 480;
  const preferredLeft = anchorRect.right + 14;
  const left = preferredLeft + panelWidth <= window.innerWidth - 12
    ? preferredLeft
    : Math.max(12, anchorRect.left - panelWidth - 14);
  const top = Math.min(Math.max(12, anchorRect.top), window.innerHeight - panelHeight - 12);
  els.sideChatPanel.style.left = `${left}px`;
  els.sideChatPanel.style.top = `${Math.max(12, top)}px`;
  renderSideChat();
  els.sideChatInput.focus();
}

async function sendSideChatMessage() {
  const text = els.sideChatInput?.value.trim() || "";
  if (!text || sideChatState.running || !sideChatState.context) return;

  const history = [
    { role: "user", content: `Use this selected excerpt from the main chat as context for my questions:\n\n${sideChatState.context}` },
    ...sideChatState.messages.slice(-18).map((message) => ({
      role: message.role,
      content: rawTextContent(message.content)
    }))
  ];
  const userMessage = { role: "user", content: text };
  const assistantMessage = { role: "assistant", content: "", reasoning: "", toolCalls: [] };
  sideChatState.messages.push(userMessage, assistantMessage);
  els.sideChatInput.value = "";
  sideChatState.running = true;
  const controller = new AbortController();
  sideChatState.abortController = controller;
  renderSideChat();

  try {
    const provider = activeProvider();
    const model = provider === "openrouter" ? resolveRoutedModel({ images: [], userContent: text }) : state.settings.model;
    await streamTemporaryChat(state.session, {
      text,
      messages: history,
      model,
      provider,
      settings: { ...state.settings, reasoning_effort: DEFAULT_REASONING_EFFORT },
      writingStyle: normalizeWritingStyle(state.settings.writingStyle),
      agentMode: true,
      webSearch: state.settings.webSearchMode !== "off" ? "auto" : "off"
    }, {
      signal: controller.signal,
      onEvent: (event) => {
        applyStreamEvent(assistantMessage, event);
        renderSideChat();
      }
    });
    loadMe().catch(() => {});
  } catch (error) {
    if (error.name !== "AbortError") assistantMessage.error = error.message || "Side chat failed.";
  } finally {
    if (sideChatState.abortController === controller) {
      sideChatState.abortController = null;
      sideChatState.running = false;
      renderSideChat();
      els.sideChatInput?.focus();
    }
  }
}

function prepareCitationPlaceholders(text, citations) {
  const slots = [];
  if (!text || !citations?.length) return { text: String(text ?? ""), slots };

  const byIndex = new Map();
  for (const entry of citations) {
    const idx = Number(entry.index);
    if (Number.isFinite(idx)) byIndex.set(idx, entry);
  }

  const blocks = String(text).split(/\n\n+/);
  const processed = blocks.map((block) => {
    const indices = [];
    const seen = new Set();
    for (const match of block.matchAll(/\[(\d+)\]/g)) {
      const n = Number(match[1]);
      if (!seen.has(n) && byIndex.has(n)) {
        seen.add(n);
        indices.push(n);
      }
    }
    if (!indices.length) return block;

    const sources = indices.map((i) => byIndex.get(i)).filter(Boolean);
    const token = `KLUICITATIONPILL${slots.length}END`;
    slots.push({ token, html: renderInlineSourcePill(sources) });
    const cleaned = block.replace(/\s*\[(\d+)\]/g, "").trimEnd();
    return `${cleaned} ${token}`;
  });

  return { text: processed.join("\n\n"), slots };
}

function restoreCitationPlaceholders(html, slots) {
  let out = String(html ?? "");
  for (const { token, html: pillHtml } of slots) out = out.replaceAll(token, pillHtml);
  return out;
}

function renderAssistantText(text, citations) {
  const cleaned = stripLeakedToolMarkup(stripLeakedCitationHtml(text));
  if (!cleaned.trim()) return "";
  if (!citations.length) return renderContent(cleaned);
  const { text: prepared, slots } = prepareCitationPlaceholders(cleaned, citations);
  return restoreCitationPlaceholders(renderContent(prepared), slots);
}

function renderAssistantContent(content, message) {
  const citations = citationListFromMessage(message);
  const hasContent = Array.isArray(content)
    ? content.some((part) => part?.type === "text" ? String(part.text || "").trim() : part?.type === "image_url")
    : Boolean(String(content || "").trim());

  if (Array.isArray(content)) {
    if (!hasContent) return "";
    return content
      .map((part) => {
        if (part?.type === "text") return renderAssistantText(part.text || "", citations);
        if (part?.type === "image_url") {
          const url = part.image_url?.url;
          return url ? renderContent([part]) : "";
        }
        if (part?.type === "file") return renderContent([part]);
        return "";
      })
      .join("");
  }

  const text = typeof content === "string" ? content : "";
  return renderAssistantText(text, citations);
}

function pastedTextFromMessage(message) {
  const text = rawTextContent(message?.content);
  const paste = message?.metadata?.paste;
  const start = Number(paste?.start);
  const length = Number(paste?.length);
  if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 1 || start + length > text.length) return null;
  const pasted = text.slice(start, start + length);
  if (!pasted.trim()) return null;
  return { text: pasted, start, length };
}

function renderPastedTextCard(text, messageId) {
  const preview = String(text || "").replace(/\s+/g, " ").trim().slice(0, 150);
  return `<button class="pasted-text-card" type="button" data-open-pasted-text="${escapeHtml(String(messageId || ""))}">
    <span class="pasted-text-preview">${renderPlainText(preview)}</span>
    <span class="pasted-text-badge">Pasted</span>
  </button>`;
}

function renderUserContent(message) {
  const content = message?.content;
  const paste = pastedTextFromMessage(message);
  const attachments = Array.isArray(content)
    ? content.filter((part) => part?.type === "image_url" || part?.type === "file").map((part) => renderContent([part])).join("")
    : "";
  if (!paste) {
    const text = rawTextContent(content);
    return `${text ? `<div class="user-plain-text">${renderPlainText(text)}</div>` : ""}${attachments}`;
  }
  const fullText = rawTextContent(content);
  const visibleText = `${fullText.slice(0, paste.start)}${fullText.slice(paste.start + paste.length)}`.trim();
  return `${renderPastedTextCard(paste.text, message?.id)}${visibleText ? `<div class="user-plain-text">${renderPlainText(visibleText)}</div>` : ""}${attachments}`;
}

function renderAssistantMessageContent(message, role = "assistant") {
  const msg = normalizeMessage(message);
  const content = typeof msg.content === "string" ? msg.content : msg.content;
  const streaming = role === "assistant" && isAssistantMessageStreaming(msg);
  if (role !== "assistant") return renderUserContent(msg);
  return `${renderAssistantActivity(msg, { streaming })}${renderAssistantContent(content, msg)}${renderArtifacts(msg)}${renderMessageError(msg)}${renderMessageNote(msg)}${renderMissingFinal(msg, role)}`;
}

function renderCitations(message) {
  const citations = dedupeCitationsForDisplay(citationListFromMessage(message));
  if (!citations.length) return "";

  const preview = uniqueCitationPreview(citations, 3);
  const faviconStack = preview.map((entry, i) => {
    const icon = citationFaviconUrl(entry.url);
    if (!icon) return "";
    return `<img class="sources-favicon" src="${escapeHtml(icon)}" alt="" width="18" height="18" decoding="async" style="--stack:${i}">`;
  }).join("");

  const rows = citations.map((entry) => {
    const host = citationHost(entry.url);
    const icon = citationFaviconUrl(entry.url);
    const title = entry.title || host || entry.url;
    const href = isClickableSourceUrl(entry.url) ? entry.url : "";
    const content = `
      ${icon ? `<img class="sources-row-icon" src="${escapeHtml(icon)}" alt="" width="16" height="16" decoding="async">` : `<span class="sources-row-fallback" aria-hidden="true"></span>`}
      <span class="sources-row-text">
        <span class="sources-row-title">${escapeHtml(title)}</span>
        ${host ? `<span class="sources-row-host">${escapeHtml(host)}</span>` : ""}
      </span>
    `;
    if (entry?.type === "document" && entry.attachment_id) {
      return `<button class="sources-row" type="button" data-view-attachment-id="${escapeHtml(entry.attachment_id)}" data-file-name="${escapeHtml(entry.source || title || "Document")}">${content}</button>`;
    }
    if (!href) {
      return `<div class="sources-row is-static">${content}</div>`;
    }
    return `
      <a class="sources-row" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
        ${content}
      </a>
    `;
  }).join("");

  return `
    <details class="sources-pill">
      <summary class="sources-pill-trigger">
        ${faviconStack ? `<span class="sources-favicons">${faviconStack}</span>` : ""}
        <span class="sources-pill-label">Sources</span>
        <span class="sources-pill-count" aria-hidden="true">${citations.length}</span>
      </summary>
      <div class="sources-panel">${rows}</div>
    </details>
  `;
}

function closeOpenSourcesPills() {
  document.querySelectorAll(".sources-pill[open]").forEach((el) => {
    el.removeAttribute("open");
  });
}

function artifactLabel(artifact) {
  const fileName = String(artifact?.file_name || "Generated document").trim();
  return fileName || "Generated document";
}

function artifactFormat(artifact) {
  const explicit = String(artifact?.format || "").trim().toUpperCase();
  if (explicit) return explicit;
  const fileName = artifactLabel(artifact);
  const ext = fileName.includes(".") ? fileName.split(".").pop() : "";
  return ext ? ext.toUpperCase() : "FILE";
}

function artifactAttachmentId(artifact) {
  return String(artifact?.attachment_id || artifact?.id || "").trim();
}

function artifactCanView(artifact) {
  const format = artifactFormat(artifact).toLowerCase();
  return Boolean(artifactAttachmentId(artifact) && ["pdf", "docx", "xlsx", "pptx"].includes(format));
}

function pendingArtifactStatusLabel(artifact) {
  const raw = String(artifact?.status || "").trim().toLowerCase();
  if (raw === "failed" || raw === "expired") return "Failed";
  if (raw === "running" || raw === "processing") return "Generating…";
  return "Generating…";
}

function renderArtifacts(message) {
  const artifacts = artifactListFromMessage(message);
  if (!artifacts.length) return "";
  const rows = artifacts.map((artifact) => {
    const fileName = artifactLabel(artifact);
    const badge = escapeHtml(artifactFormat(artifact));

    if (artifact.pending) {
      const failed = ["failed", "expired"].includes(String(artifact.status || "").toLowerCase());
      const statusLabel = pendingArtifactStatusLabel(artifact);
      const cardClass = `artifact-card pending${failed ? " failed" : ""}`;
      const action = failed
        ? `<span class="artifact-download is-disabled" aria-disabled="true">Failed</span>`
        : `<span class="artifact-download is-disabled" aria-disabled="true"><span class="artifact-spinner" aria-hidden="true"></span>Generating…</span>`;
      return `
        <div class="${cardClass}" data-job-id="${escapeHtml(artifact.job_id || "")}">
          <div class="artifact-badge" aria-hidden="true">${badge}</div>
          <div class="artifact-info">
            <div class="artifact-title">${escapeHtml(fileName)}</div>
            <div class="artifact-status">${escapeHtml(statusLabel)}</div>
          </div>
          ${action}
        </div>
      `;
    }

    const attachmentId = artifactAttachmentId(artifact);
    const href = artifact.download_url || (attachmentId ? attachmentDownloadHref(attachmentId) : "#");
    const status = String(artifact.status || "ready").trim();
    const canView = artifactCanView(artifact);
    const format = artifactFormat(artifact).toLowerCase();
    return `
      <div class="artifact-card">
        <div class="artifact-badge" aria-hidden="true">${badge}</div>
        <div class="artifact-info">
          <div class="artifact-title">${escapeHtml(fileName)}</div>
          ${status ? `<div class="artifact-status">${escapeHtml(status)}</div>` : ""}
        </div>
        <div class="artifact-actions">
          ${canView ? `<button class="artifact-download" type="button" data-view-attachment-id="${escapeHtml(attachmentId)}" data-file-name="${escapeHtml(fileName)}" data-format="${escapeHtml(format)}">View</button>` : ""}
          <a class="artifact-download" href="${escapeHtml(href)}" download="${escapeHtml(fileName)}" data-file-name="${escapeHtml(fileName)}">Download</a>
        </div>
      </div>
    `;
  }).join("");
  return `<div class="artifact-list">${rows}</div>`;
}

function renderMessageNote(message) {
  return message.stopped ? `<div class="message-note">Stopped by user.</div>` : "";
}

function renderMissingFinal(message, role) {
  const hasFinal = String(message.content || "").trim()
    || (Array.isArray(message.toolCalls) && message.toolCalls.length)
    || artifactListFromMessage(message).length;
  if (role !== "assistant" || state.running || message.error || message.stopped || hasFinal) return "";
  return `<div class="message-error"><span>No final response was saved.</span></div>`;
}

function rawTextContent(content) {
  if (Array.isArray(content)) return content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  return String(content || "");
}

function flashCopySuccess(btn) {
  if (!btn) return;
  btn.classList.remove("copy-flash");
  void btn.offsetWidth;
  btn.classList.add("copy-flash");
  const label = btn.querySelector("span");
  const prevLabel = label?.textContent || "";
  if (label) label.textContent = "Copied!";
  const icon = btn.querySelector("svg");
  if (icon) {
    btn._copyIconHtml ||= icon.outerHTML;
    const w = icon.getAttribute("width") || "16";
    const h = icon.getAttribute("height") || "16";
    icon.outerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
  }
  clearTimeout(btn._copyFlashTimer);
  btn._copyFlashTimer = setTimeout(() => {
    btn.classList.remove("copy-flash");
    if (label) label.textContent = prevLabel || "Copy";
    if (btn._copyIconHtml) {
      const current = btn.querySelector("svg");
      if (current) current.outerHTML = btn._copyIconHtml;
    }
  }, 1200);
}

function messageCopyButton(msg, { iconOnly = false } = {}) {
  const text = rawTextContent(msg.content);
  if (!text.trim()) return "";
  const label = iconOnly ? "" : "<span>Copy</span>";
  const copyLabel = iconOnly ? "Copy" : "Copy message";
  return `<button class="msg-action-btn msg-copy-btn${iconOnly ? " msg-copy-btn--icon" : ""}" type="button" data-copy-msg aria-label="${copyLabel}" title="${copyLabel}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>${label}</button>`;
}

function renderMessageFooter(msg, role) {
  if (role === "user") return renderUserMessageFooter(msg);
  if (role !== "assistant") return "";
  const copy = messageCopyButton(msg, { iconOnly: true });
  const retry = renderMessageRetry(msg);
  const adjust = renderResponseAdjustmentMenu(msg);
  const citations = renderCitations(msg);
  if (!copy && !retry && !adjust && !citations) return "";
  return `
    <div class="message-footer">
      ${copy || retry || adjust ? `<div class="message-footer-actions">${retry}${copy}${adjust}</div>` : ""}
      ${citations ? `<div class="message-footer-sources">${citations}</div>` : ""}
    </div>
  `;
}

function canEditUserMessage(msg) {
  if (state.running) return false;
  const id = msg?.id ? String(msg.id) : "";
  if (!id || id.startsWith("local_")) return false;
  return msg.role === "user";
}

function renderUserMessageFooter(msg) {
  const copy = messageCopyButton(msg, { iconOnly: true });
  const edit = canEditUserMessage(msg)
    ? `<button class="msg-action-btn msg-edit-btn" type="button" data-edit-msg="${escapeHtml(String(msg.id))}" aria-label="Edit" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>`
    : "";
  if (!copy && !edit) return "";
  return `
    <div class="message-footer message-footer--user">
      <div class="message-footer-actions">${copy}${edit}</div>
    </div>
  `;
}

function renderUserEditForm(msg, rawText) {
  const id = escapeHtml(String(msg.id));
  return `
    <div class="message-edit">
      <textarea class="message-edit-input" data-edit-input="${id}" rows="1" spellcheck="false">${escapeHtml(rawText)}</textarea>
      <div class="message-edit-actions">
        <button class="message-edit-cancel" type="button" data-edit-cancel>Cancel</button>
        <button class="message-edit-save" type="button" data-edit-save="${id}">Send</button>
      </div>
    </div>
  `;
}

function renderStandardMessage(raw) {
  const msg = normalizeMessage(raw);
  const role = msg.role === "user" ? "user" : "assistant";
  const rawText = rawTextContent(msg.content);
  const idAttr = msg.id ? ` data-message-id="${escapeHtml(String(msg.id))}"` : "";
  const editing = role === "user" && msg.id && state.editingMessageId === String(msg.id);

  const inner = role === "assistant" && researchController.researchMeta(msg)
    ? researchController.renderResearchCard(msg)
    : editing
    ? renderUserEditForm(msg, rawText)
    : `<div class="message-content">${renderAssistantMessageContent(msg, role)}</div>
        ${renderMessageFooter(msg, role)}`;

  return `
    <article class="message ${role}${editing ? " editing" : ""}"${idAttr} data-raw-text="${escapeHtml(rawText)}">
      <div class="message-body">
        ${inner}
      </div>
    </article>
  `;
}

function renderMessages() {
  resetCodeSourceStore();
  document.body.classList.toggle("chat-empty", !state.messages.length);
  renderTemporaryChatMode();
  if (!state.messages.length) {
    const title = state.session ? getGreeting() : "What can I help you with?";
    els.messages.innerHTML = `<div class="empty-state"><h1>${escapeHtml(title)}</h1></div>`;
    els.chatPromptNav?.classList.add("hidden");
    els.chatJumpBottom?.classList.remove("visible");
    return;
  }

  const beforePinned = state.autoScroll && isNearBottom(els.messages, 120);
  const beforeScrollTop = els.messages.scrollTop;

  captureReasoningOpenState();

  els.messages.innerHTML = messageViews(state.messages)
    .map((view) => {
      if (view.type === "council") return councilController.renderCouncilMessage(view.council);
      if (view.type === "compare") return compareController.renderCompareMessage(view.messages);
      return renderStandardMessage(view.message);
    })
    .join("");

  if (beforePinned) {
    pinMessagesToBottom();
  } else {
    setMessagesScrollTop(beforeScrollTop);
  }

  syncPendingArtifactPolls();
  renderContextMeter();
  renderChatPromptNavigator();
  updateChatScrollNavigation();
}

function cssString(value) {
  const raw = String(value ?? "");
  if (globalThis.CSS?.escape) return CSS.escape(raw);
  return raw.replace(/["\\]/g, "\\$&");
}

function preserveMessageScroll(update) {
  const beforePinned = state.autoScroll && isNearBottom(els.messages, 120);
  const beforeScrollTop = els.messages.scrollTop;
  update();
  if (beforePinned) {
    pinMessagesToBottom();
  } else {
    setMessagesScrollTop(beforeScrollTop);
  }
}

function setMessagesScrollTop(value) {
  const maxScroll = Math.max(0, els.messages.scrollHeight - els.messages.clientHeight);
  els.messages.scrollTop = Math.min(Math.max(0, value), maxScroll);
}

function pinMessagesToBottom() {
  setMessagesScrollTop(Math.max(0, els.messages.scrollHeight - els.messages.clientHeight));
}

function desktopChatNavigationEnabled() {
  return !isNative() && window.matchMedia("(min-width: 901px)").matches;
}

function userPromptItems() {
  return (state.messages || []).filter((message) => message.role === "user" && message.id).map((message) => {
    const text = rawTextContent(message.content).replace(/\s+/g, " ").trim();
    return { id: String(message.id), label: text || "Uploaded files" };
  });
}

function renderChatPromptNavigator() {
  if (!els.chatPromptNav) return;
  const prompts = desktopChatNavigationEnabled() ? userPromptItems() : [];
  const visible = prompts.length > 1;
  els.chatPromptNav.classList.toggle("hidden", !visible);
  if (!visible) {
    renderedChatPromptSignature = "";
    return;
  }
  const signature = JSON.stringify(prompts);
  if (signature === renderedChatPromptSignature) return;
  const previousActiveId = els.chatPromptMarkers.querySelector("[data-prompt-marker].active")?.dataset.promptMarker;
  const activeId = prompts.some((prompt) => prompt.id === previousActiveId) ? previousActiveId : prompts[0].id;
  renderedChatPromptSignature = signature;
  els.chatPromptMarkers.innerHTML = prompts.map((prompt) =>
    `<span data-prompt-marker="${escapeHtml(prompt.id)}"${prompt.id === activeId ? ' class="active"' : ""}></span>`
  ).join("");
  els.chatPromptList.innerHTML = prompts.map((prompt) =>
    `<button type="button" data-prompt-jump="${escapeHtml(prompt.id)}"${prompt.id === activeId ? ' class="active" aria-current="true"' : ""}>${escapeHtml(prompt.label)}</button>`
  ).join("");
}

function updateChatScrollNavigation() {
  if (!desktopChatNavigationEnabled()) return;
  const bottomDistance = distanceFromBottom(els.messages);
  els.chatJumpBottom?.classList.toggle("visible", bottomDistance > 220 && state.messages.length > 0);
  if (!els.chatPromptNav || els.chatPromptNav.classList.contains("hidden")) return;

  const containerTop = els.messages.getBoundingClientRect().top;
  const promptSurfaces = [...els.messages.querySelectorAll(".message.user[data-message-id]")];
  if (!promptSurfaces.length) return;
  let activeId = promptSurfaces[0].dataset.messageId || "";
  for (const surface of promptSurfaces) {
    if (surface.getBoundingClientRect().top <= containerTop + 140) activeId = surface.dataset.messageId || activeId;
    else break;
  }
  els.chatPromptMarkers.querySelectorAll("[data-prompt-marker]").forEach((marker) => {
    marker.classList.toggle("active", marker.dataset.promptMarker === activeId);
  });
  els.chatPromptList.querySelectorAll("[data-prompt-jump]").forEach((button) => {
    const active = button.dataset.promptJump === activeId;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
}

function scrollToChatPrompt(messageId) {
  const target = els.messages.querySelector(`.message.user[data-message-id="${cssString(messageId)}"]`);
  if (!target) return;
  const top = target.getBoundingClientRect().top
    - els.messages.getBoundingClientRect().top
    + els.messages.scrollTop
    - 28;
  setAutoScroll(false);
  els.messages.scrollTo({
    top: Math.max(0, top),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
  });
}

function renderStreamingMessageSurface(message) {
  const id = message?.id ? String(message.id) : "";
  if (!id) return false;
  const surface = els.messages.querySelector(`[data-message-id="${cssString(id)}"]`);
  const contentEl = surface?.querySelector(".message-content");
  if (!surface || !contentEl) return false;

  captureReasoningOpenState();
  preserveMessageScroll(() => {
    const rawText = rawTextContent(message.content);
    surface.dataset.rawText = rawText;
    const statusEl = contentEl.querySelector(".thinking-status");
    const hasContent = rawText.trim().length > 0;

    if (statusEl && hasContent) {
      // Keep the live status node so opacity can fade out while answer HTML updates.
      const tmp = document.createElement("div");
      tmp.innerHTML = renderAssistantMessageContent(message);
      tmp.querySelector(".thinking-status")?.remove();
      for (const node of [...contentEl.childNodes]) {
        if (node !== statusEl) node.remove();
      }
      while (tmp.firstChild) contentEl.appendChild(tmp.firstChild);
      if (!statusEl.classList.contains("is-leaving")) {
        void statusEl.offsetWidth;
        statusEl.classList.add("is-leaving");
        const removeStatus = () => {
          if (statusEl.isConnected) statusEl.remove();
        };
        statusEl.addEventListener("transitionend", removeStatus, { once: true });
        setTimeout(removeStatus, 200);
      }
    } else {
      contentEl.innerHTML = renderAssistantMessageContent(message);
    }
  });
  syncPendingArtifactPolls();
  renderContextMeter();
  return true;
}

function flushStreamingMessageSurfaces() {
  streamingRenderQueued = false;
  const targets = Array.from(streamingRenderTargets.values());
  streamingRenderTargets.clear();
  for (const target of targets) {
    if (!renderStreamingMessageSurface(target)) renderMessages();
  }
}

function queueStreamingMessageRender(message) {
  const id = message?.id ? String(message.id) : "";
  if (!id) {
    queueRenderMessages();
    return;
  }
  streamingRenderTargets.set(id, message);
  if (streamingRenderQueued) return;
  streamingRenderQueued = true;
  requestAnimationFrame(flushStreamingMessageSurfaces);
}

function queueRenderMessages() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderMessages();
  });
}

/* ─── Images ─── */

function pendingDocumentUploads() {
  return state.images.filter((item) => item.category === "document" && item.status !== "ready");
}

function pendingDocumentLabel(item) {
  if (item.status === "failed") return item.error || "Failed";
  if (item.status === "uploading") return "Uploading";
  if (item.status === "processing") return `${Math.max(1, Math.min(99, Math.round(item.progress || 10)))}%`;
  return "Queued";
}

function renderImages() {
  if (state.images?.length || state.pastedText) els.composer?.classList.remove("compact");
  const pastedPreview = state.pastedText
    ? `<div class="preview-thumb preview-pasted" data-open-composer-paste>
        <span>${renderPlainText(state.pastedText.replace(/\s+/g, " ").trim().slice(0, 120))}</span>
        <strong>Pasted</strong>
        <button class="preview-remove" type="button" data-remove-paste aria-label="Remove pasted text">×</button>
      </div>`
    : "";
  els.imagePreviews.innerHTML = pastedPreview + state.images.map((img, i) => `
    <div class="preview-thumb ${img.category === "document" ? `preview-file preview-${escapeHtml(img.status || "ready")}` : ""}" ${img.previewUrl ? `data-preview-src="${escapeHtml(img.previewUrl)}"` : ""}>
      ${img.category === "image"
        ? `<img src="${escapeHtml(img.previewUrl)}" alt="${escapeHtml(img.file.name)}">`
        : `<div class="preview-file-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg></div><span>${escapeHtml(img.file.name)}</span>${img.status !== "ready" ? `<span class="preview-progress" style="--progress:${Math.max(0, Math.min(100, Number(img.progress || 0)))}" title="${escapeHtml(pendingDocumentLabel(img))}"></span>` : ""}` }
      <button class="preview-remove" type="button" data-remove-index="${i}" aria-label="Remove">×</button>
    </div>
  `).join("");
  updateSendButton();
  renderContextMeter();
}

function openPastedTextDialog(text) {
  if (!els.pastedTextDialog || !els.pastedTextDialogBody) return;
  const value = String(text || "");
  els.pastedTextDialogBody.textContent = value;
  if (els.pastedTextDialogMeta) {
    const bytes = new TextEncoder().encode(value).length;
    const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
    els.pastedTextDialogMeta.textContent = `${size} · ${Math.max(1, value.split("\n").length)} lines`;
  }
  els.pastedTextDialog.classList.remove("hidden");
}

function closePastedTextDialog() {
  els.pastedTextDialog?.classList.add("hidden");
  if (els.pastedTextDialogBody) els.pastedTextDialogBody.textContent = "";
}

function updatePendingDocument(localId, patch) {
  const item = state.images.find((entry) => entry.localId === localId);
  if (!item) return null;
  Object.assign(item, patch);
  rememberPendingDocument(item);
  renderImages();
  return item;
}

function pendingDocumentsStorageKey() {
  const userId = state.me?.user?.id;
  return userId ? `${PENDING_DOCUMENTS_STORAGE_PREFIX}:${userId}` : "";
}

function readPendingDocuments() {
  const key = pendingDocumentsStorageKey();
  if (!key) return [];
  try {
    const records = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writePendingDocuments(records) {
  const key = pendingDocumentsStorageKey();
  if (!key) return;
  if (records.length) localStorage.setItem(key, JSON.stringify(records));
  else localStorage.removeItem(key);
}

function rememberPendingDocument(item) {
  if (item?.category !== "document" || !item.attachmentId || item.status === "failed") return;
  const records = readPendingDocuments().filter((record) => record.attachmentId !== item.attachmentId);
  records.push({
    attachmentId: item.attachmentId,
    documentId: item.documentId || "",
    fileName: item.file?.name || item.uploaded?.fileName || "Document",
    contentType: item.file?.type || item.uploaded?.contentType || "application/octet-stream",
    sizeBytes: Number(item.file?.size || item.uploaded?.sizeBytes || 0),
    status: item.status || "processing",
    progress: Number(item.progress || 0),
    conversationId: state.activeConversationId || "",
    savedAt: Date.now()
  });
  writePendingDocuments(records.slice(-10));
}

function forgetPendingDocument(item) {
  const attachmentId = typeof item === "string" ? item : item?.attachmentId;
  if (!attachmentId) return;
  writePendingDocuments(readPendingDocuments().filter((record) => record.attachmentId !== attachmentId));
}

async function restorePendingDocuments() {
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  const records = readPendingDocuments();
  const currentConversationId = state.activeConversationId || "";
  const keep = records.filter((record) => Number(record.savedAt || 0) >= cutoff);
  writePendingDocuments(keep);
  for (const record of keep.filter((entry) => (entry.conversationId || "") === currentConversationId)) {
    if (state.images.some((item) => item.attachmentId === record.attachmentId)) continue;
    const item = {
      localId: `restored_${record.attachmentId}`,
      file: {
        name: record.fileName || "Document",
        type: record.contentType || "application/octet-stream",
        size: Number(record.sizeBytes || 0)
      },
      category: "document",
      previewUrl: "",
      status: record.status === "ready" ? "ready" : "processing",
      progress: Number(record.progress || 8),
      attachmentId: record.attachmentId,
      documentId: record.documentId || "",
      uploaded: {
        id: record.attachmentId,
        fileName: record.fileName || "Document",
        contentType: record.contentType || "application/octet-stream",
        sizeBytes: Number(record.sizeBytes || 0),
        category: "document"
      },
      error: ""
    };
    state.images.push(item);
    if (item.status === "ready") continue;
    void pollUploadedDocument(item.localId, item.attachmentId).catch((error) => {
      updatePendingDocument(item.localId, {
        status: "failed",
        progress: 0,
        error: error?.message || "Document status could not be restored."
      });
      forgetPendingDocument(item);
    });
  }
  renderImages();
}

async function pollUploadedDocument(localId, attachmentId) {
  let failedAttempts = 0;
  while (state.session && state.images.some((entry) => entry.localId === localId)) {
    let payload;
    try {
      payload = await fetchDocumentStatus(state.session, attachmentId);
      failedAttempts = 0;
    } catch (error) {
      failedAttempts += 1;
      if (failedAttempts >= 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(10000, 1000 * (2 ** failedAttempts))));
      continue;
    }
    const doc = payload.document || {};
    if (!state.images.some((entry) => entry.localId === localId)) return;
    updatePendingDocument(localId, {
      status: doc.usable ? "ready" : "processing",
      progress: doc.usable ? 100 : Math.max(8, Number(doc.progress || 15)),
      stage: doc.stage || "",
      textReadyAt: doc.textReadyAt || null,
      visualReadyAt: doc.visualReadyAt || null,
      enrichedAt: doc.enrichedAt || null,
      documentId: doc.id || "",
      error: doc.error?.message || ""
    });
    if (doc.usable) {
      return;
    }
    if (doc.status === "failed" && !doc.usable) {
      throw new Error(doc.error?.message || "Document could not be processed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

async function startDocumentUpload(item) {
  const controller = new AbortController();
  item.abortController = controller;
  updatePendingDocument(item.localId, { status: "uploading", progress: 3, error: "" });
  try {
    const presigned = await presignUpload(state.session, item.file, "document", { signal: controller.signal });
    item.uploadId = presigned.uploadId;
    await putUploadContent(state.session, presigned, item.file, "document", { signal: controller.signal });
    const uploaded = await completeUpload(state.session, presigned.uploadId, { signal: controller.signal });
    if (!state.images.some((entry) => entry.localId === item.localId)) {
      forgetPendingDocument(uploaded.id);
      await deleteAttachment(state.session, uploaded.id).catch(() => {});
      return;
    }
    updatePendingDocument(item.localId, {
      attachmentId: uploaded.id,
      uploaded,
      status: uploaded.category === "document" ? "processing" : "ready",
      progress: uploaded.category === "document" ? 8 : 100,
      abortController: null
    });
    if (uploaded.category === "document") {
      await pollUploadedDocument(item.localId, uploaded.id);
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    updatePendingDocument(item.localId, {
      status: "failed",
      progress: 0,
      error: err.message || "Upload failed.",
      abortController: null
    });
    forgetPendingDocument(item);
  }
}

function acceptPendingFiles(files) {
  if (!requireAuth()) return;
  if (state.temporaryChat) {
    showToast("Temporary chat is text-only for now.");
    return;
  }
  if (state.researchMode) {
    showToast("Turn off Deep Research before adding attachments.");
    return;
  }
  const draft = els.promptInput.value;
  const plan = state.me?.plan || {};
  const allFiles = [...files];
  const accepted = allFiles.filter((file) => state.running ? fileCategory(file) === "image" : isSupportedPendingFile(file));
  if (state.running && allFiles.length && !accepted.length) {
    showToast("Follow-up attachments can only be images while Klui is working.");
    return;
  }
  if (state.running && accepted.length < allFiles.length) {
    showToast("Only images were added to the follow-up.");
  }
  const currentImages = state.images.filter((item) => item.category === "image").length;
  const currentDocs = state.images.filter((item) => item.category === "document").length;
  const maxImages = plan.maxImagesPerMessage || 4;
  const maxDocs = plan.maxDocumentsPerMessage || 5;
  const chosen = [];
  let imageSlots = Math.max(0, maxImages - currentImages);
  let docSlots = Math.max(0, maxDocs - currentDocs);
  for (const file of accepted) {
    const category = fileCategory(file);
    if (category === "image" && imageSlots > 0) {
      chosen.push(file);
      imageSlots -= 1;
    } else if (category === "document" && docSlots > 0) {
      chosen.push(file);
      docSlots -= 1;
    }
  }
  if (accepted.length > chosen.length) showToast(state.running ? `Attach up to ${maxImages} images.` : `Attach up to ${maxImages} images and ${maxDocs} documents.`);
  if (allFiles.length && !accepted.length) showToast("Upload images, PDFs, Word, Excel, PowerPoint, CSV, or TSV files.");

  for (const file of chosen) {
    const category = fileCategory(file);
    const item = {
      localId: `pending_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      file,
      category,
      previewUrl: category === "image" ? URL.createObjectURL(file) : "",
      status: category === "document" ? "queued" : "ready",
      progress: category === "document" ? 1 : 100,
      attachmentId: "",
      documentId: "",
      error: ""
    };
    state.images.push(item);
    if (category === "document") {
      startDocumentUpload(item);
    }
  }
  renderImages();
  els.promptInput.value = draft;
  applyComposerHeight();
  compareController.syncCompareContextBanner();
}

function openLightbox(src) {
  els.lightboxImg.src = src;
  els.lightbox.classList.remove("hidden");
}

function closeLightbox() {
  els.lightbox.classList.add("hidden");
  els.lightboxImg.src = "";
}

/* ─── Drawers / Dialogs ─── */

function openSettings() {
  document.body.classList.remove("sidebar-open");
  syncSettingsInputs();
  els.settingsDrawer.classList.add("open");
  els.settingsDrawer.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "settings";
}

function closeSettings() {
  els.settingsDrawer.classList.remove("open");
  els.settingsDrawer.setAttribute("aria-hidden", "true");
  if (els.overlay.dataset.mode === "settings") {
    els.overlay.hidden = true;
    delete els.overlay.dataset.mode;
  }
}

function closeAccount() {
  els.accountDrawer.classList.remove("open");
  els.accountDrawer.setAttribute("aria-hidden", "true");
  if (els.overlay.dataset.mode === "account") {
    els.overlay.hidden = true;
    delete els.overlay.dataset.mode;
  }
}

function openAuthDialog() {
  els.authDialog.classList.add("open");
  els.authDialog.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "auth";
  renderAuthOptions();
}

function startSidebarLogin() {
  if (!isNative()) {
    openAuthDialog();
    return;
  }
  document.body.classList.remove("sidebar-open");
  closeAuthDialog();
  els.authNotice.textContent = "";
  nativeSignInWithGoogle(state.config).catch((error) => {
    els.authNotice.textContent = error?.message || "Google sign-in failed.";
    openAuthDialog();
  });
}

function closeAuthDialog() {
  els.authDialog.classList.remove("open");
  els.authDialog.setAttribute("aria-hidden", "true");
  if (els.overlay.dataset.mode === "auth") {
    els.overlay.hidden = true;
    delete els.overlay.dataset.mode;
  }
}

function openDeleteConfirm({ title, body, chatId = "", attachmentId = "", projectId = "" } = {}) {
  closeConversationMenus();
  closePinnedPopup();
  closeProfileMenu();
  if (isNative()) document.body.classList.remove("sidebar-open");
  state.pendingDeleteId = chatId || "";
  state.pendingDeleteAttachmentId = attachmentId || "";
  state.pendingDeleteProjectId = projectId || "";
  els.confirmTitle.textContent = title;
  els.confirmBody.textContent = body;
  els.confirmDialog.classList.add("open");
  els.confirmDialog.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "confirm";
  els.confirmDeleteButton.focus();
}

function openConfirmDialog(conversation) {
  openDeleteConfirm({
    title: "Delete chat?",
    body: `Delete "${conversation.title || "New chat"}" from your account?`,
    chatId: conversation.id
  });
}

function closeConfirmDialog() {
  state.pendingDeleteId = "";
  state.pendingDeleteAttachmentId = "";
  state.pendingDeleteProjectId = "";
  els.confirmDialog.classList.remove("open");
  els.confirmDialog.setAttribute("aria-hidden", "true");
  if (els.overlay.dataset.mode === "confirm") {
    els.overlay.hidden = true;
    delete els.overlay.dataset.mode;
  }
}

async function confirmPendingDelete() {
  if (state.pendingDeleteAttachmentId) {
    const attachmentId = state.pendingDeleteAttachmentId;
    const projectId = state.activeProjectId;
    const projectDocuments = state.activeProject?.documents || [];
    const removedDocumentIndex = projectDocuments.findIndex((document) => {
      const attachment = Array.isArray(document.attachments) ? document.attachments[0] : document.attachments;
      return attachment?.id === attachmentId;
    });
    const removedDocument = projectDocuments[removedDocumentIndex];
    closeConfirmDialog();
    if (state.activeProject?.documents) {
      state.activeProject = {
        ...state.activeProject,
        documents: state.activeProject.documents.filter((document) => {
          const attachment = Array.isArray(document.attachments) ? document.attachments[0] : document.attachments;
          return attachment?.id !== attachmentId;
        })
      };
      renderProjects();
    }
    try {
      await deleteAttachment(state.session, attachmentId);
      if (state.activeProjectId === projectId) {
        await loadActiveProject();
        renderProjects();
      }
    } catch (error) {
      if (state.activeProjectId === projectId && removedDocument) {
        const documents = [...(state.activeProject?.documents || [])];
        documents.splice(Math.min(removedDocumentIndex, documents.length), 0, removedDocument);
        state.activeProject = { ...state.activeProject, documents };
        renderProjects();
      }
      showToast(error.message || "File could not be removed.");
    }
    return;
  }
  if (state.pendingDeleteProjectId) {
    const deletedProjectId = state.pendingDeleteProjectId;
    const deletedProject = state.projects.find((project) => project.id === deletedProjectId);
    const deletedConversations = state.conversations.filter((conversation) => conversation.project_id === deletedProjectId);
    const deletedConversationIds = new Set(deletedConversations.map((conversation) => conversation.id));
    const deletedPinnedChatIds = state.pinnedChatIds.filter((id) => deletedConversationIds.has(id));
    closeConfirmDialog();
    state.projects = state.projects.filter((project) => project.id !== deletedProjectId);
    state.conversations = state.conversations.filter((conversation) => conversation.project_id !== deletedProjectId);
    state.pinnedChatIds = state.pinnedChatIds.filter((id) => !deletedConversationIds.has(id));
    savePinnedChatIds();
    state.activeProjectId = "";
    state.activeProject = null;
    syncProjectsUrl({ replace: true });
    renderShell();
    try {
      await deleteProject(state.session, deletedProjectId);
    } catch (error) {
      if (deletedProject && !state.projects.some((project) => project.id === deletedProjectId)) {
        state.projects = [deletedProject, ...state.projects];
      }
      const currentConversationIds = new Set(state.conversations.map((conversation) => conversation.id));
      state.conversations = [...deletedConversations.filter((conversation) => !currentConversationIds.has(conversation.id)), ...state.conversations];
      state.pinnedChatIds = [...new Set([...state.pinnedChatIds, ...deletedPinnedChatIds])];
      savePinnedChatIds();
      renderShell();
      showToast(error.message || "Project could not be deleted.");
    }
    return;
  }
  if (state.pendingDeleteId) removeConversation(state.pendingDeleteId);
}

function openRenameDialog(conversation) {
  closeConversationMenus();
  closePinnedPopup();
  closeProfileMenu();
  if (isNative()) document.body.classList.remove("sidebar-open");
  state.pendingRenameId = conversation.id;
  els.renameChatInput.value = conversation.title || "New chat";
  els.renameDialog.classList.add("open");
  els.renameDialog.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "rename";
  requestAnimationFrame(() => {
    els.renameChatInput.focus();
    els.renameChatInput.select();
  });
}

function closeRenameDialog() {
  state.pendingRenameId = "";
  els.renameDialog.classList.remove("open");
  els.renameDialog.setAttribute("aria-hidden", "true");
  if (els.overlay.dataset.mode === "rename") {
    els.overlay.hidden = true;
    delete els.overlay.dataset.mode;
  }
}

async function saveRenameDialog() {
  const id = state.pendingRenameId;
  if (!id) return;
  const title = els.renameChatInput.value.trim();
  if (!title) {
    showToast("Enter a chat title.");
    return;
  }
  try {
    const payload = await updateConversation(state.session, id, { title });
    const index = state.conversations.findIndex((item) => item.id === id);
    if (index >= 0) state.conversations[index] = { ...state.conversations[index], ...payload.conversation };
    closeRenameDialog();
    renderConversations();
    if (isSearchDialogOpen()) renderSearchResults(els.searchChatInput?.value || "");
  } catch (err) {
    showToast(err.message);
  }
}

function closeAllDrawers() {
  closeSettings();
  closeAccount();
  closeProfileMenu();
  closeAuthDialog();
  closeConfirmDialog();
  closeRenameDialog();
  closeSearchDialog();
  closePinnedPopup();
  closeConversationMenus();
}

function syncSettingsInputs() {
  els.temperatureInput.value = state.settings.temperature;
  els.topPInput.value = state.settings.top_p;
  els.maxTokensInput.value = state.settings.max_tokens;
  els.seedInput.value = state.settings.seed;
  els.systemPromptInput.value = state.settings.systemPrompt;
  if (els.showModelReasoningInput) {
    els.showModelReasoningInput.checked = state.settings.showModelReasoning !== false;
  }
  if (els.textScaleInput) els.textScaleInput.value = String(clampTextScale(state.settings.uiTextScale));
  if (els.textScaleValue) els.textScaleValue.textContent = `${clampTextScale(state.settings.uiTextScale)}%`;
  syncAppearanceControls();
}

function setRunning(running) {
  state.running = running;
  els.stopButton.classList.toggle("hidden", !running);
  els.sendButton.classList.toggle("hidden", running);
  els.promptInput.disabled = false;
  els.imageToggle.disabled = state.temporaryChat || state.researchMode;
  els.modelButton.disabled = running;
  els.compareButton.disabled = running || state.temporaryChat;
  if (els.councilButton) els.councilButton.disabled = running || state.temporaryChat;
  if (els.deepResearchToggle) els.deepResearchToggle.disabled = running || !state.config?.services?.research;
  updateComposerPlaceholder();
  updateSendButton();
}

function trackPendingTurnEvent(event, run = getConversationRun()) {
  if (!run) return;
  if (event?.type === "turn:submitted") {
    run.turnRunId = event.turnRunId || "";
  } else if (event?.type === "turn:waiting" || event?.type === "turn:claimed") {
    run.turnWaiting = true;
  } else if (event?.type && !event.type.startsWith("turn:")) {
    run.turnWaiting = false;
  } else {
    return;
  }
  if (isRunKeyActive(run.key)) syncTurnFieldsFromRun(run);
}

researchController = createResearchController({
  elements: {
    researchReportView: els.researchReportView,
    researchReportBack: els.researchReportBack,
    researchVisualTab: els.researchVisualTab,
    researchTextTab: els.researchTextTab,
    researchCopy: els.researchCopy,
    researchPrint: els.researchPrint,
    researchReportLoading: els.researchReportLoading,
    researchReportLayout: els.researchReportLayout,
    researchReportToc: els.researchReportToc,
    researchReportArticle: els.researchReportArticle,
    researchReportSources: els.researchReportSources,
    researchReportSourcesSummary: els.researchReportSourcesSummary,
    chatView: els.chatView,
    promptInput: els.promptInput
  },
  state,
  createResearch,
  fetchResearchStatus,
  fetchResearchReport,
  escapeHtml,
  renderContent,
  renderMessages,
  renderShell,
  renderResearchMode,
  setRunning: setResearchConversationRunning,
  showToast,
  showOnly,
  loadMe,
  loadConversations,
  loadActiveConversation,
  conversationUrl,
  syncConversationUrl,
  selectedModelMode,
  applyComposerHeight,
  renderImages,
  OPENROUTER_PRO_MODEL,
  OPENROUTER_TEXT_MODEL
});

function stopExtractedModulePollers() {
  researchController.abandonResearchPolling();
  stopPendingArtifactPolls();
}

compareController = createCompareController({
  elements: {
    compareContextBanner: els.compareContextBanner,
    compareDropdown: els.compareDropdown,
    compareButton: els.compareButton,
    compareWrap: els.compareWrap,
    compareInput: els.compareInput,
    compareCatalog: els.compareCatalog,
    compareLabel: els.compareLabel,
    councilWrap: els.councilWrap,
    councilButton: els.councilButton,
    councilLabel: els.councilLabel
  },
  state,
  DEFAULT_COMPARE_MODELS,
  DEFAULT_COUNCIL_MODELS,
  updateSetting,
  escapeHtml,
  compactModelDisplayName,
  modelBrandLogoUrl,
  renderAssistantMessageContent,
  renderCitations,
  normalizeMessage,
  rawTextContent,
  openNewChat,
  renderShell,
  pendingPromptHasImages,
  compareIncludesTextOnlyModels
});

councilController = createCouncilController({
  elements: { messages: els.messages },
  state,
  DEFAULT_COUNCIL_MODELS,
  updateSetting,
  escapeHtml,
  normalizeMessage,
  rawTextContent,
  renderAssistantMessageContent,
  isPlaceholderPeerReason,
  compareModelAlias: (...args) => compareController.compareModelAlias(...args),
  renderCompareControls: () => compareController.renderCompareControls()
});

adminPanel = createAdminPanel({
  elements: {
    adminOutput: els.adminOutput,
    loadAdminButton: els.loadAdminButton,
    saveSystemPromptButton: els.saveSystemPromptButton,
    systemPromptInput: els.systemPromptInput
  },
  state,
  fetchAdminSummary,
  updateAdminSettings,
  approveAdminPayment,
  rejectAdminPayment,
  escapeHtml,
  isAdminUser,
  showToast,
  saveSettings,
  syncSettingsInputs
});

function updateSendButton() {
  const hasText = Boolean(els.promptInput.value.trim() || state.pastedText);
  if (state.running) {
    const hasContent = hasText || state.images.some((item) => item.category === "image");
    const blocked = state.images.some((item) => item.category !== "image") || state.followUps.length >= 3;
    els.sendButton.classList.toggle("active", hasContent && !blocked);
    els.sendButton.disabled = !hasContent || blocked;
    return;
  }
  const hasContent = hasText || state.images.length || state.followUps.length;
  const blocked = pendingDocumentUploads().length > 0;
  els.sendButton.classList.toggle("active", Boolean(hasContent) && !blocked);
  els.sendButton.disabled = blocked;
}

function applyComposerHeight() {
  els.promptInput.style.height = "auto";
  els.promptInput.style.height = `${Math.min(200, els.promptInput.scrollHeight)}px`;
}

function isStreamDeltaEvent(event) {
  if (event?.type === "delta") return isStreamDeltaEvent(event.event);
  if (event?.type === "council:chairman:delta") return isStreamDeltaEvent(event.event);
  const delta = event?.choices?.[0]?.delta || {};
  return Boolean(
    typeof delta.content === "string" && delta.content
    || extractReasoningDelta(delta)
  );
}

function queueStreamRenderForEvent(message, event) {
  if (isStreamDeltaEvent(event)) queueStreamingMessageRender(message);
  else queueRenderMessages();
}

/* ─── API data loading ─── */

async function loadMe() {
  state.me = await fetchMe(state.session);
  if (typeof state.me?.settings?.systemPrompt === "string") {
    state.settings.systemPrompt = state.me.settings.systemPrompt;
  }
  if (isNative()) {
    const key = pinnedStorageKey();
    const saved = key ? await preferences.get(key) : null;
    if (saved) localStorage.setItem(key, saved);
  }
  loadPinnedChatIds();
}

async function refreshAccountAfterResume() {
  if (state.session?.access_token) {
    try {
      await Promise.all([loadMe(), loadPaymentRequests()]);
      renderShell();
    } catch {
      // Normal request/session handling will surface any actionable error.
    }
  }
  await checkAndShowAppUpdate();
}

async function checkAndShowAppUpdate() {
  const update = await checkForAppUpdate().catch(() => null);
  if (!update || !els.appUpdateDialog) return;
  availableAppUpdate = update;
  const notes = Array.isArray(update.releaseNotes) && update.releaseNotes.length
    ? ` ${update.releaseNotes.join(" ")}`
    : "";
  els.appUpdateBody.textContent = `Version ${update.versionName} is ready.${notes}`;
  els.appUpdateLater.classList.toggle("hidden", Boolean(update.required));
  els.appUpdateDialog.classList.remove("hidden");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "app-update";
}

function closeAppUpdate() {
  if (availableAppUpdate?.required) return;
  els.appUpdateDialog?.classList.add("hidden");
  if (els.overlay.dataset.mode === "app-update") {
    els.overlay.hidden = true;
    delete els.overlay.dataset.mode;
  }
}

function closeTopNativeSurface() {
  if (!els.appUpdateDialog?.classList.contains("hidden")) {
    closeAppUpdate();
    return true;
  }
  if (!els.lightbox.classList.contains("hidden")) {
    closeLightbox();
    return true;
  }
  if (state.viewer.open) {
    closeDocumentViewer();
    return true;
  }
  if (!els.paywallView.classList.contains("hidden")) {
    renderShell();
    return true;
  }
  if (els.settingsDrawer.classList.contains("open")) {
    closeSettings();
    return true;
  }
  if (els.accountDrawer.classList.contains("open")) {
    closeAccount();
    return true;
  }
  if (els.authDialog.classList.contains("open")) {
    closeAuthDialog();
    return true;
  }
  if (els.confirmDialog.classList.contains("open")) {
    closeConfirmDialog();
    return true;
  }
  if (els.renameDialog.classList.contains("open")) {
    closeRenameDialog();
    return true;
  }
  if (isSearchDialogOpen()) {
    closeSearchDialog();
    return true;
  }
  if (document.body.classList.contains("sidebar-open")) {
    document.body.classList.remove("sidebar-open");
    return true;
  }
  return false;
}

async function setupNativeLifecycle() {
  if (!isNative()) return;
  await listenForNativeAuth(state.config, {
    onSession: handleAuthenticatedSession,
    onError: (error) => {
      els.authNotice.textContent = error?.message || "Google sign-in failed.";
      openAuthDialog();
    }
  });
  await onResume(refreshAccountAfterResume);
  await listenForDeepLinks((url) => {
    const match = url.pathname.match(/^\/c\/([^/]+)\/?$/);
    if (!match) return;
    pendingNativeConversationId = decodeURIComponent(match[1]);
    if (state.session?.access_token) {
      openConversation(pendingNativeConversationId).catch(() => {});
    }
  });
  await registerBackButton(async () => {
    if (closeTopNativeSurface()) return;
    if (state.activeConversationId || window.location.pathname !== "/") {
      openNewChat({ replaceUrl: true });
      return;
    }
    const now = Date.now();
    if (now - lastNativeBackAt < 1800) {
      await exitApp();
      return;
    }
    lastNativeBackAt = now;
    showToast("Press back again to exit.");
  });
}

async function handleAuthenticatedSession(session) {
  if (!session?.access_token) return;
  state.session = session;
  await saveSession(session);
  els.authNotice.textContent = "";
  closeAuthDialog();
  renderShell();
  try {
    await withTimeout(loadMe(), 8000, "Account load");
    await loadPaymentRequests();
    renderShell();
    if (hasChatAccess()) {
      await loadChatApp();
      await restorePendingDocuments();
    }
  } catch (err) {
    els.authNotice.textContent = err?.message || "Signed in, but your account could not be loaded.";
    showToast(els.authNotice.textContent);
  }
}

async function loadModels() {
  if (!state.config?.services?.crof) {
    state.models = [];
    return;
  }
  try {
    const payload = await fetchModels(state.session);
    state.models = normalizeModelList(payload);
  } catch (err) {
    showToast(err.message);
  }
}

async function loadPaymentRequests() {
  if (!state.session?.access_token) {
    state.paymentRequests = [];
    return;
  }
  try {
    const payload = await fetchZiinaPaymentRequests(state.session);
    state.paymentRequests = payload.paymentRequests || [];
  } catch {
    state.paymentRequests = [];
  }
}

async function loadConversations() {
  const payload = await listConversations(state.session);
  state.conversations = payload.conversations || [];
  const validIds = new Set(state.conversations.map((conversation) => conversation.id));
  state.pinnedChatIds = state.pinnedChatIds.filter((id) => validIds.has(id));
  savePinnedChatIds();
  const routeConversationId = conversationIdFromLocation();
  if (projectsRouteFromLocation()) return;
  if (routeConversationId) {
    state.activeConversationId = state.conversations.some((conversation) => conversation.id === routeConversationId)
      ? routeConversationId
      : "";
  }
  if (state.activeConversationId && !state.conversations.some((conversation) => conversation.id === state.activeConversationId)) {
    state.activeConversationId = "";
  }
  if (!routeConversationId) state.activeConversationId = "";
  if (state.activeConversationId) await loadActiveConversation();
  else {
    state.messages = [];
    stopExtractedModulePollers();
  }
  if (routeConversationId && !state.activeConversationId) syncConversationUrl({ replace: true });
}

async function loadActiveConversation() {
  if (!state.activeConversationId) {
    state.messages = [];
    stopExtractedModulePollers();
    syncActiveRunningUi();
    return;
  }
  if (restoreLiveConversationRun(state.activeConversationId)) {
    researchController.resumeResearchPolling();
    return;
  }
  const payload = await fetchConversation(state.session, state.activeConversationId);
  state.messages = payload.messages || [];
  const hasActiveResearch = state.messages.some((message) => {
    const meta = message?.metadata?.research;
    return meta?.runId && ["queued", "running"].includes(meta.status);
  });
  if (!hasActiveResearch) {
    const run = conversationRuns.get(state.activeConversationId);
    if (run?.mode === "research" && !run.abortController) {
      conversationRuns.delete(state.activeConversationId);
    }
  }
  researchController.resumeResearchPolling();
  syncActiveRunningUi();
  const pendingTurn = (payload.pendingTurns || [])[0];
  if (pendingTurn && !getConversationRun(state.activeConversationId) && state.resumingTurnId !== pendingTurn.id) {
    setTimeout(() => resumePendingDocumentTurn(pendingTurn), 0);
  }
}

function restoredTurnAttachment(part) {
  const source = part?.type === "file" ? part.file : part?.image_url;
  const attachmentId = source?.attachment_id || "";
  if (!attachmentId) return null;
  const category = part.type === "file" ? "document" : "image";
  const item = {
    localId: `cancelled_${attachmentId}`,
    file: {
      name: source.file_name || (category === "document" ? "Document" : "Image"),
      type: source.content_type || (category === "document" ? "application/octet-stream" : "image/jpeg"),
      size: Number(source.size_bytes || 0)
    },
    category,
    previewUrl: category === "image" ? (source.url || "") : "",
    status: category === "document" ? "processing" : "ready",
    progress: category === "document" ? 8 : 100,
    attachmentId,
    uploaded: {
      id: attachmentId,
      fileName: source.file_name || (category === "document" ? "Document" : "Image"),
      contentType: source.content_type || (category === "document" ? "application/octet-stream" : "image/jpeg"),
      sizeBytes: Number(source.size_bytes || 0),
      category
    },
    error: ""
  };
  return item;
}

function restoreCancelledTurnDraft(result) {
  if (result?.run?.status !== "cancelled" || !result.user_message) return false;
  if (result.run.conversation_id && result.run.conversation_id !== state.activeConversationId) return false;
  els.promptInput.value = textFromMessageContent(result.user_message.content);
  const parts = Array.isArray(result.user_message.content) ? result.user_message.content : [];
  state.images = parts.map(restoredTurnAttachment).filter(Boolean);
  for (const item of state.images) {
    if (item.category !== "document") continue;
    rememberPendingDocument(item);
    void pollUploadedDocument(item.localId, item.attachmentId).catch((error) => {
      updatePendingDocument(item.localId, {
        status: "failed",
        progress: 0,
        error: error?.message || "Document status could not be restored."
      });
    });
  }
  renderImages();
  applyComposerHeight();
  return true;
}

async function resumePendingDocumentTurn(run) {
  if (!run?.id || !state.activeConversationId) return;
  const conversationId = run.conversation_id || state.activeConversationId;
  if (conversationId !== state.activeConversationId) return;
  const runKey = conversationRunKey(conversationId, false);
  if (getConversationRun(runKey) || state.resumingTurnId === run.id) return;
  state.resumingTurnId = run.id;
  const payload = run.request_payload || {};
  const compareModels = Array.isArray(payload.models) ? payload.models.filter(Boolean) : [];
  const council = Boolean(payload.council);
  const localAssistant = localAssistantForMode(compareModels, council);
  markAssistantActivityTree(localAssistant);
  state.messages = reconcilePendingTurnMessages(state.messages, run.id, localAssistant);
  const abortController = new AbortController();
  const activeRun = beginConversationRun(runKey, {
    conversationId,
    temporary: false,
    abortController,
    mode: "pending"
  });
  activeRun.turnRunId = run.id;
  activeRun.messages = state.messages;
  setAutoScroll(true);
  syncActiveRunningUi();
  renderMessages();
  pinMessagesToBottom();

  try {
    await streamConversationMessage(state.session, conversationId, { turnRunId: run.id }, {
      signal: abortController.signal,
      onEvent: (event) => {
        trackPendingTurnEvent(event, activeRun);
        if (council) {
          const target = applyCouncilStreamEvent(localAssistant, event);
          if (!isRunKeyActive(runKey)) return;
          if (target && isStreamDeltaEvent(event)) queueStreamingMessageRender(target);
          else queueRenderMessages();
        } else if (compareModels.length) {
          const target = applyCompareStreamEvent(localAssistant, event);
          if (!isRunKeyActive(runKey)) return;
          if (target && isStreamDeltaEvent(event)) queueStreamingMessageRender(target);
          else queueRenderMessages();
        } else {
          applyStreamEvent(localAssistant, event);
          if (!isRunKeyActive(runKey)) return;
          queueStreamRenderForEvent(localAssistant, event);
        }
      }
    });
    markAssistantActivityDoneTree(localAssistant);
  } catch (error) {
    if (error.name === "AbortError") localAssistant.stopped = true;
    else localAssistant.error = error.message || "The pending turn could not resume.";
  } finally {
    state.resumingTurnId = "";
    endConversationRun(runKey);
    setAutoScroll(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (state.activeConversationId === conversationId) {
      const refreshed = await fetchConversation(state.session, conversationId).catch(() => null);
      if (refreshed) {
        state.messages = refreshed.messages || state.messages;
        const nextTurn = (refreshed.pendingTurns || [])[0];
        if (nextTurn && nextTurn.id !== run.id) {
          setTimeout(() => resumePendingDocumentTurn(nextTurn), 0);
        }
      }
      renderShell();
    } else {
      loadConversations().catch(() => {});
    }
  }
}

async function loadChatApp() {
  await Promise.all([loadModels(), loadConversations(), loadProjects()]);
  if (projectsRouteFromLocation()) {
    state.projectsOpen = true;
    state.activeProjectId = projectIdFromLocation();
    state.activeConversationId = "";
    state.messages = [];
    if (state.activeProjectId) await loadActiveProject();
    renderShell();
    return;
  }
  if (pendingNativeConversationId) {
    const conversationId = pendingNativeConversationId;
    pendingNativeConversationId = "";
    if (state.conversations.some((conversation) => conversation.id === conversationId)) {
      await openConversation(conversationId);
      return;
    }
  }
  renderShell();
}

/* ─── Actions ─── */

function requireAuth() {
  if (state.session) return true;
  openAuthDialog();
  return false;
}

function openNewChat({ replaceUrl = false } = {}) {
  if (blockChatNavigationWhileRunning()) return;
  if (state.images.some((item) => item.category === "document" && !item.attachmentId)) {
    showToast("Wait for the document upload to finish before switching chats.");
    return;
  }
  parkActiveConversationRun();
  researchController.stopResearchPolling();
  state.activeConversationId = "";
  state.projectsOpen = false;
  state.activeProjectId = "";
  state.activeProject = null;
  state.messages = [];
  state.images = [];
  state.pastedText = "";
  state.compareDescribeImages = false;
  stopPendingArtifactPolls();
  clearFollowUps();
  closeDocumentViewer();
  compareController.closeCompareContextBanner();
  closeSearchDialog();
  closePinnedPopup();
  closeConversationMenus();
  renderImages();
  void restorePendingDocuments();
  syncConversationUrl({ replace: replaceUrl });
  syncActiveRunningUi();
  renderShell();
  els.promptInput?.focus();
}

async function addConversation() {
  if (!requireAuth()) return;
  openNewChat();
}

async function startZiinaPayment(planId) {
  if (!requireAuth()) return;
  const plan = state.plans.find((candidate) => candidate.id === planId);
  if (!plan) return;
  const existing = (state.paymentRequests || []).find((request) => request.planId === planId && request.status === "pending");
  if (existing) {
    if (existing.paymentUrl) await openExternal(existing.paymentUrl);
    return;
  }

  try {
    const payload = await createZiinaPaymentRequest(state.session, planId);
    const request = payload.paymentRequest;
    state.paymentRequests = [request, ...(state.paymentRequests || [])];
    renderPlans();
    if (request.paymentUrl) await openExternal(request.paymentUrl);
  } catch (err) {
    showToast(err.message);
  }
}

async function removeConversation(id) {
  const index = state.conversations.findIndex((conversation) => conversation.id === id);
  if (index < 0) {
    closeConfirmDialog();
    return;
  }

  const deletedConversation = state.conversations[index];
  const previousPinnedChatIds = [...state.pinnedChatIds];
  const wasActive = state.activeConversationId === id;
  const previousMessages = wasActive ? [...state.messages] : [];

  if (wasActive && state.temporaryChat && blockChatNavigationWhileRunning()) {
    closeConfirmDialog();
    return;
  }

  if (conversationRuns.has(id)) {
    closeConfirmDialog();
    showToast("Stop the response in this chat before deleting it.");
    return;
  }

  closeConfirmDialog();
  closeConversationMenus();
  state.conversations = state.conversations.filter((conversation) => conversation.id !== id);
  if (state.activeProject?.conversations) {
    state.activeProject.conversations = state.activeProject.conversations.filter((conversation) => conversation.id !== id);
  }
  unpinChat(id);

  if (wasActive) {
    state.activeConversationId = "";
    state.messages = [];
    stopExtractedModulePollers();
    clearFollowUps();
    closeDocumentViewer();
    compareController.closeCompareContextBanner();
    syncConversationUrl({ replace: true });
    syncActiveRunningUi();
  }

  renderShell();
  if (isSearchDialogOpen()) renderSearchResults(els.searchChatInput?.value || "");

  try {
    await deleteConversation(state.session, id);
  } catch (err) {
    if (!state.conversations.some((conversation) => conversation.id === id)) {
      state.conversations.splice(Math.min(index, state.conversations.length), 0, deletedConversation);
    }
    state.pinnedChatIds = previousPinnedChatIds;
    savePinnedChatIds();

    if (wasActive && !state.activeConversationId && window.location.pathname === "/") {
      state.activeConversationId = id;
      state.messages = previousMessages;
      syncConversationUrl({ replace: true });
    }

    renderShell();
    if (isSearchDialogOpen()) renderSearchResults(els.searchChatInput?.value || "");
    showToast(err.message);
  }
}

async function sendPrompt() {
  if (state.session && !hasChatAccess()) {
    openUpgradePlans();
    return;
  }
  let text = els.promptInput.value.trim();
  if (state.running) {
    if (state.activeResearchId) {
      showToast("Wait for Deep Research to finish or cancel it first.");
      return;
    }
    if (!requireAuth()) return;
    addFollowUpFromInput();
    return;
  }
  if (!text && state.followUps.length) {
    const queued = drainFollowUps();
    text = followUpBatchText(queued);
    state.images = [...followUpBatchImages(queued), ...state.images];
    renderImages();
  } else if (text && state.followUps.length) {
    const queued = drainFollowUps();
    text = [followUpBatchText(queued), text].filter(Boolean).join("\n\n");
    state.images = [...followUpBatchImages(queued), ...state.images];
    renderImages();
  }
  const pastedText = state.pastedText.trim();
  const paste = pastedText
    ? { start: text ? text.length + 2 : 0, length: pastedText.length }
    : null;
  if (pastedText) text = text ? `${text}\n\n${pastedText}` : pastedText;
  if (text.length > 100000) {
    showToast("Message is too long. Shorten the typed text or pasted content.");
    return;
  }
  if (!text && !state.images.length) return;
  if (!requireAuth()) return;
  if (state.researchMode) {
    if (state.images.length) {
      showToast("Deep Research currently supports text questions only.");
      return;
    }
    await researchController.startDeepResearch(text);
    return;
  }
  const compareModels = compareController.activeCompareModelIds();
  if (state.temporaryChat && state.images.length) {
    showToast("Temporary chat is text-only for now.");
    return;
  }
  if (state.temporaryChat && compareModels.length) {
    showToast("Temporary chat uses one model for now.");
    return;
  }
  const pendingDocs = pendingDocumentUploads();
  if (pendingDocs.length) {
    const failed = pendingDocs.find((item) => item.status === "failed");
    showToast(failed ? `Remove or retry ${failed.file.name}.` : "Wait for document processing to finish.");
    return;
  }
  if (state.settings.compareEnabled && compareController.selectedCompareModelIds().length < (isCouncilMode() ? 4 : 2)) {
    showToast(isCouncilMode() ? "Council needs its four fixed models." : "Compare needs its two fixed models.");
    return;
  }
  compareController.closeCompareContextBanner();

  await executeSend({
    text,
    images: state.images.map((img) => ({
      file: img.file,
      category: img.category,
      previewUrl: img.previewUrl,
      attachmentId: img.attachmentId,
      uploaded: img.uploaded
    })),
    compareModels,
    council: Boolean(compareModels.length && isCouncilMode()),
    describeImages: Boolean(
      compareModels.length
    ),
    paste
  });
}

async function waitForDocumentReady(attachmentId, fileName) {
  while (state.session) {
    const payload = await fetchDocumentStatus(state.session, attachmentId);
    const doc = payload.document || {};
    if (doc.usable) return doc;
    if (doc.status === "failed" && !doc.usable) {
      throw new Error(doc.error?.message || `${fileName || "Document"} could not be processed.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error(`${fileName || "Document"} processing stopped because the session ended.`);
}

function autoSizeEditInput(input) {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 320)}px`;
}

function beginEditMessage(id) {
  if (state.running || !id) return;
  state.editingMessageId = String(id);
  renderMessages();
  const input = els.messages.querySelector(`[data-edit-input="${cssString(id)}"]`);
  if (input) {
    autoSizeEditInput(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function cancelEditMessage() {
  if (!state.editingMessageId) return;
  state.editingMessageId = "";
  renderMessages();
}

function attachmentsFromMessageContent(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const part of content) {
    if (part?.type === "image_url") {
      const image = part.image_url || {};
      out.push({
        id: image.attachment_id || "",
        category: "image",
        fileName: image.file_name || "image",
        contentType: image.content_type || "",
        url: image.url || ""
      });
    } else if (part?.type === "file") {
      const file = part.file || {};
      out.push({
        id: file.attachment_id || "",
        category: "document",
        fileName: file.file_name || "file",
        contentType: file.content_type || "",
        url: file.url || ""
      });
    }
  }
  return out.filter((att) => att.id);
}

/**
 * Edit a previously sent user message. The server replaces the message text
 * in place (keeping its original images and documents), drops every later
 * message, and regenerates — so the model answers as if the old prompt never
 * existed. This reuses executeSend, so it works for normal, compare and
 * council chats through one code path.
 */
async function editUserMessage(id) {
  if (state.running || !id) return;
  const input = els.messages.querySelector(`[data-edit-input="${cssString(id)}"]`);
  const text = (input?.value || "").trim();

  const index = state.messages.findIndex((m) => String(m.id) === String(id));
  if (index < 0) return;
  const original = state.messages[index];
  const keepAttachments = attachmentsFromMessageContent(original.content);
  if (!text && !keepAttachments.length) {
    showToast("Message can't be empty.");
    return;
  }

  state.editingMessageId = "";
  state.messages = state.messages.slice(0, index);
  renderMessages();

  const compareModels = compareController.activeCompareModelIds();
  await executeSend({
    text,
    images: [],
    compareModels,
    council: Boolean(compareModels.length && isCouncilMode()),
    describeImages: Boolean(compareModels.length),
    editMessageId: String(id),
    keepAttachments
  });
}

async function retryFailedAssistant(assistantMessageId, responseAdjustment = "") {
  if (state.running || !state.activeConversationId || !assistantMessageId) return;

  const conversationId = state.activeConversationId;
  const runKey = conversationRunKey(conversationId, false);
  if (getConversationRun(runKey)) return;

  const index = state.messages.findIndex((message) => message.id === assistantMessageId);
  if (index <= 0) return;

  const failed = state.messages[index];
  const userMsg = state.messages[index - 1];
  if (failed?.role !== "assistant" || userMsg?.role !== "user" || !canRetryAssistant(failed)) return;

  const localAssistant = {
    id: `local_assistant_${Date.now()}`,
    role: "assistant",
    content: "",
    reasoning: "",
    toolCalls: []
  };
  markAssistantActivityTree(localAssistant);
  state.messages[index] = localAssistant;

  const abortController = new AbortController();
  const activeRun = beginConversationRun(runKey, {
    conversationId,
    temporary: false,
    abortController,
    mode: "retry"
  });
  activeRun.messages = state.messages;
  setAutoScroll(true);
  syncActiveRunningUi();
  renderMessages();
  pinMessagesToBottom();
  let wasAborted = false;
  let shouldReloadConversation = false;

  try {
    const retryProvider = activeProvider();
    const retryModel = retryProvider === "openrouter"
      ? resolveRoutedModel({ images: [], userContent: userMsg.content })
      : state.settings.model;
    await streamConversationMessage(state.session, conversationId, {
      retryAssistantMessageId: assistantMessageId,
      ...(responseAdjustment ? { responseAdjustment } : {}),
      model: retryModel,
      provider: retryProvider,
      settings: {
        ...state.settings,
        reasoning_effort: DEFAULT_REASONING_EFFORT
      },
      writingStyle: normalizeWritingStyle(state.settings.writingStyle),
      agentMode: true,
      webSearch: state.settings.webSearchMode !== "off" ? "auto" : "off"
    }, {
      signal: abortController.signal,
      onEvent: (event) => {
        applyStreamEvent(localAssistant, event);
        if (!isRunKeyActive(runKey)) return;
        queueStreamRenderForEvent(localAssistant, event);
      }
    });

    markAssistantActivityDoneTree(localAssistant);
    await Promise.all([loadMe(), loadConversations()]);
    shouldReloadConversation = true;
  } catch (err) {
    if (err.name === "AbortError") {
      wasAborted = true;
      localAssistant.stopped = true;
    } else {
      const hasRenderedOutput = rawTextContent(localAssistant.content).trim()
        || artifactListFromMessage(localAssistant).length;
      if (!hasRenderedOutput) localAssistant.error = err.message;
    }
  } finally {
    const stillActive = state.activeConversationId === conversationId;
    const queuedFollowUps = !wasAborted && shouldReloadConversation && stillActive ? drainFollowUps() : [];
    const completedScrollTop = els.messages.scrollTop;
    endConversationRun(runKey);
    setAutoScroll(false);
    if (shouldReloadConversation && stillActive) {
      await loadActiveConversation().catch(() => {});
      renderShell();
      setMessagesScrollTop(completedScrollTop);
    } else if (!stillActive) {
      loadConversations().catch(() => {});
    } else {
      renderShell();
      setMessagesScrollTop(completedScrollTop);
    }
    if (queuedFollowUps.length) {
      await executeSend({
        text: followUpBatchText(queuedFollowUps),
        images: followUpBatchImages(queuedFollowUps),
        compareModels: compareController.activeCompareModelIds(),
        council: Boolean(compareController.activeCompareModelIds().length && isCouncilMode()),
        describeImages: Boolean(compareController.activeCompareModelIds().length)
      });
    }
  }
}

function localAssistantForMode(compareModels = [], council = false) {
  if (council) {
    return {
      id: `local_council_${Date.now()}`,
      role: "assistant",
      councilGroup: true,
      sessionId: "",
      stage1Status: "active",
      stage2Status: "pending",
      stage3Status: "pending",
      peerStatus: "",
      panelists: compareModels.map((model) => ({
        id: `local_panel_${model}_${Date.now()}`,
        role: "assistant",
        model,
        content: "",
        reasoning: "",
        toolCalls: [],
        metadata: { council: { role: "panelist", stage: 1 } }
      })),
      chairman: null,
      ballots: []
    };
  }
  if (compareModels.length) {
    const stamp = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      id: `local_compare_${stamp}`,
      role: "assistant",
      compareGroup: true,
      compareResponses: compareModels.map((model) => ({
        id: `local_compare_${model}_${stamp}`,
        role: "assistant",
        model,
        content: "",
        reasoning: "",
        toolCalls: []
      }))
    };
  }
  return {
    id: `local_assistant_${Date.now()}`,
    role: "assistant",
    content: "",
    reasoning: "",
    toolCalls: []
  };
}

async function executeSend({ text, images, compareModels, council = false, describeImages = false, newChat = false, editMessageId = "", keepAttachments = [], paste = null }) {
  compareController.closeCompareContextBanner();

  const temporaryChat = state.temporaryChat;
  const previousTemporaryMessages = temporaryChat ? temporaryHistoryForRequest() : [];
  let createdConversation = false;

  if (!temporaryChat && (newChat || !state.activeConversationId)) {
    const payload = await createConversation(state.session, {
      model: compareModels[0] || resolveRoutedModel({ images }),
      projectId: state.activeProjectId || null
    });
    state.conversations.unshift(payload.conversation);
    state.activeConversationId = payload.conversation.id;
    state.projectsOpen = false;
    state.messages = [];
    createdConversation = true;
    syncConversationUrl();
    renderConversations();
  }
  const conversationId = state.activeConversationId;
  const runKey = conversationRunKey(conversationId, temporaryChat);
  if (!runKey || getConversationRun(runKey)) return;

  const keptParts = keepAttachments.map((att) => att.category === "document"
    ? { type: "file", file: { attachment_id: att.id, file_name: att.fileName, content_type: att.contentType, url: att.url } }
    : { type: "image_url", image_url: { attachment_id: att.id, file_name: att.fileName, url: att.url } });

  const localUser = {
    id: `local_${Date.now()}`,
    role: "user",
    ...(paste ? { metadata: { paste } } : {}),
    content: (images.length || keptParts.length)
      ? [
          ...(text ? [{ type: "text", text }] : []),
          ...keptParts,
          ...images.map((img) => img.category === "image"
            ? { type: "image_url", image_url: { url: img.previewUrl } }
            : { type: "file", file: { file_name: img.file.name, content_type: img.file.type } })
        ]
      : text
  };

  const localAssistant = localAssistantForMode(compareModels, council);

  markAssistantActivityTree(localAssistant);
  /* Drop any cancelled local compare/council group from the previous send
     so its stale "Stopped by user" bubbles can't collide with the new
     streaming ids in the DOM. */
  if (localAssistant.compareGroup || localAssistant.councilGroup) {
    state.messages = state.messages.filter((m) => {
      if (m === localAssistant) return true;
      if (m.role !== "assistant") return true;
      if (!m.stopped) return true;
      return !(m.compareGroup || m.councilGroup);
    });
  }
  state.messages.push(localUser, localAssistant);
  els.promptInput.value = "";
  state.pastedText = "";
  applyComposerHeight();
  for (const item of images) forgetPendingDocument(item);
  state.images = [];
  renderImages();

  const abortController = new AbortController();
  const activeRun = beginConversationRun(runKey, {
    conversationId: temporaryChat ? "" : conversationId,
    temporary: temporaryChat,
    abortController,
    mode: council ? "council" : (compareModels.length ? "compare" : "chat")
  });
  activeRun.messages = state.messages;
  setAutoScroll(true);
  syncActiveRunningUi();
  if (createdConversation) renderShell();
  else renderMessages();
  pinMessagesToBottom();
  let shouldReloadConversation = false;
  let wasAborted = false;
  const sentPreviewUrls = images
    .filter((img) => img.category === "image" && img.previewUrl)
    .map((img) => img.previewUrl);

  try {
    const uploaded = [];
    for (const img of temporaryChat ? [] : images) {
      if (img.category === "document" && img.attachmentId) {
        uploaded.push(img.uploaded || {
          id: img.attachmentId,
          fileName: img.file.name,
          contentType: img.file.type,
          sizeBytes: img.file.size,
          category: "document"
        });
        continue;
      }

      const uploadedFile = await uploadFile(state.session, img.file);
      if (uploadedFile.category === "document") {
        await waitForDocumentReady(uploadedFile.id, img.file.name);
      }
      uploaded.push(uploadedFile);
    }

    const provider = activeProvider();
    const effectiveModel = provider === "openrouter"
      ? resolveRoutedModel({ images, userContent: localUser.content })
      : state.settings.model;
    updateSetting("model", effectiveModel);
    const payload = {
      text,
      clientTurnKey: (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`,
      attachments: uploaded.map((item) => item.id),
      model: effectiveModel,
      provider,
      settings: {
        ...state.settings,
        reasoning_effort: DEFAULT_REASONING_EFFORT
      },
      writingStyle: normalizeWritingStyle(state.settings.writingStyle),
      agentMode: true,
      webSearch: state.settings.webSearchMode !== "off" ? "auto" : "off",
      ...(paste ? { paste } : {}),
      ...(describeImages ? { describeImages: true } : {}),
      ...(editMessageId ? { editUserMessageId: editMessageId } : {})
    };

    if (temporaryChat) {
      await streamTemporaryChat(state.session, {
        ...payload,
        messages: previousTemporaryMessages
      }, {
        signal: abortController.signal,
        onEvent: (event) => {
          trackPendingTurnEvent(event, activeRun);
          applyStreamEvent(localAssistant, event);
          if (!isRunKeyActive(runKey)) return;
          queueStreamRenderForEvent(localAssistant, event);
        }
      });
    } else if (council) {
      await streamCompareConversationMessage(state.session, conversationId, {
        ...payload,
        models: compareModels,
        council: true
      }, {
        signal: abortController.signal,
        onEvent: (event) => {
          trackPendingTurnEvent(event, activeRun);
          const target = applyCouncilStreamEvent(localAssistant, event);
          if (!isRunKeyActive(runKey)) return;
          if (target && isStreamDeltaEvent(event)) queueStreamingMessageRender(target);
          else queueRenderMessages();
        }
      });
    } else if (compareModels.length) {
      await streamCompareConversationMessage(state.session, conversationId, {
        ...payload,
        models: compareModels
      }, {
        signal: abortController.signal,
        onEvent: (event) => {
          trackPendingTurnEvent(event, activeRun);
          const target = applyCompareStreamEvent(localAssistant, event);
          if (!isRunKeyActive(runKey)) return;
          if (target && isStreamDeltaEvent(event)) queueStreamingMessageRender(target);
          else queueRenderMessages();
        }
      });
    } else {
      await streamConversationMessage(state.session, conversationId, payload, {
        signal: abortController.signal,
        onEvent: (event) => {
          trackPendingTurnEvent(event, activeRun);
          applyStreamEvent(localAssistant, event);
          if (!isRunKeyActive(runKey)) return;
          queueStreamRenderForEvent(localAssistant, event);
        }
      });
    }

    markAssistantActivityDoneTree(localAssistant);
    await (temporaryChat ? loadMe() : Promise.all([loadMe(), loadConversations()]));
    shouldReloadConversation = true;
  } catch (err) {
    if (err.name === "AbortError") {
      wasAborted = true;
      if (activeRun.cancelRequested && activeRun.turnWaiting && !activeRun.cancelResult) {
        if (isRunKeyActive(runKey)) {
          els.promptInput.value = text;
          state.images = images;
          for (const item of images) rememberPendingDocument(item);
          renderImages();
          applyComposerHeight();
        }
      }
      if (localAssistant.councilGroup) {
        for (const panelist of localAssistant.panelists) panelist.stopped = true;
        if (localAssistant.chairman) localAssistant.chairman.stopped = true;
      } else if (localAssistant.compareGroup) {
        for (const response of localAssistant.compareResponses) response.stopped = true;
      } else {
        localAssistant.stopped = true;
      }
    } else {
      if (localAssistant.councilGroup) {
        for (const panelist of localAssistant.panelists) {
          if (!panelist.content) panelist.error = err.message;
        }
        if (localAssistant.chairman && !localAssistant.chairman.content) {
          localAssistant.chairman.error = err.message;
        }
      } else if (localAssistant.compareGroup) {
        for (const response of localAssistant.compareResponses) {
          if (!response.content) response.error = err.message;
        }
      } else {
        const hasRenderedOutput = rawTextContent(localAssistant.content).trim()
          || artifactListFromMessage(localAssistant).length;
        if (!hasRenderedOutput) localAssistant.error = err.message;
      }
    }
  } finally {
    const stillActive = temporaryChat
      ? state.temporaryChat && isRunKeyActive(runKey)
      : state.activeConversationId === conversationId && !state.temporaryChat;
    const queuedFollowUps = !wasAborted && shouldReloadConversation && stillActive ? drainFollowUps() : [];
    const completedScrollTop = els.messages.scrollTop;
    endConversationRun(runKey);
    setAutoScroll(false);
    if (shouldReloadConversation && !temporaryChat && stillActive) {
      const reloaded = await loadActiveConversation().then(() => true).catch(() => false);
      if (reloaded) {
        for (const url of sentPreviewUrls) URL.revokeObjectURL(url);
      }
      renderShell();
      setMessagesScrollTop(completedScrollTop);
    } else if (stillActive) {
      renderShell();
      setMessagesScrollTop(completedScrollTop);
    } else if (!temporaryChat) {
      loadConversations().catch(() => {});
    }
    if (queuedFollowUps.length) {
      await executeSend({
        text: followUpBatchText(queuedFollowUps),
        images: followUpBatchImages(queuedFollowUps),
        compareModels: compareController.activeCompareModelIds(),
        council: Boolean(compareController.activeCompareModelIds().length && isCouncilMode()),
        describeImages: Boolean(compareController.activeCompareModelIds().length)
      });
    }
  }
}

async function signOutAndReset() {
  await signOut(state.config, state.session);
  stopExtractedModulePollers();
  state.session = null;
  state.me = null;
  state.paymentRequests = [];
  state.conversations = [];
  state.pinnedChatIds = [];
  state.messages = [];
  state.pastedText = "";
  state.temporaryChat = false;
  clearFollowUps();
  state.activeConversationId = "";
  closeDocumentViewer();
  syncConversationUrl({ replace: true });
  closeAllDrawers();
  renderShell();
}

/* ─── Bootstrap ─── */

async function hydrateNativeSettings() {
  if (!isNative()) return;
  const saved = await preferences.get(SETTINGS_KEY);
  if (!saved) return;
  localStorage.setItem(SETTINGS_KEY, saved);
  state.settings = loadSettings();
}

async function bootstrap() {
  await hydrateNativeSettings();
  applyChatTheme();
  applyTextScale();
  try {
    state.config = await fetchConfig();
    await setupNativeLifecycle();
    configureApiAuth({
      getSession: () => state.session,
      refresh: (session, options) => refreshSession(state.config, session, options),
      onSession: (session) => {
        state.session = session;
        void saveSession(session);
      },
      onExpired: () => {
        void clearSession();
        stopExtractedModulePollers();
        state.session = null;
        state.me = null;
      }
    });
    const plansPayload = await fetchPlans();
    state.plans = plansPayload.plans || [];
    const authError = parseAuthErrorFromUrl();
    if (authError) showToast(authError);
    state.session = parseSessionFromUrl() || await loadSession();
    if (state.session) {
      try {
        state.session = await withTimeout(refreshSession(state.config, state.session), 8000, "Session refresh");
        if (state.session) await saveSession(state.session);
      } catch {
        await clearSession();
        state.session = null;
      }
    }
    if (state.session) {
      try {
        await withTimeout(loadMe(), 8000, "Account load");
        await loadPaymentRequests();
      } catch {
        await clearSession();
        state.session = null;
      }
    }
    renderShell();
    if (state.session && hasChatAccess()) {
      // The chat is now visible and authorized. Start focusing before the
      // model/conversation requests below so native startup feels immediate.
      if (!researchIdFromLocation()) focusPromptInputSoon();
      await loadChatApp();
      await restorePendingDocuments();
      const reportId = researchIdFromLocation();
      if (reportId) await researchController.openResearchReport(reportId, { push: false });
    }
    focusPromptInputSoon();
    await checkAndShowAppUpdate();
  } catch (err) {
    state.session = null;
    state.me = null;
    state.conversations = [];
    state.messages = [];
    renderShell();
    showToast(err.message);
  }
}

/* ─── Event binding ─── */

function distanceFromBottom(el) {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

function isNearBottom(el, threshold = 60) {
  return distanceFromBottom(el) <= threshold;
}

function composerHasPendingContent() {
  return Boolean(els.promptInput?.value?.trim() || state.pastedText || state.images?.length);
}

function composerHasFocus() {
  return Boolean(els.composer?.contains(document.activeElement));
}

async function showNativeKeyboard() {
  if (!isNative()) return;
  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    await Keyboard.show();
  } catch {
    // Some Android WebView/IME combinations only allow showing the keyboard
    // after a user gesture. The input focus still remains correct.
  }
}

async function hideNativeKeyboard() {
  if (!isNative()) return;
  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    await Keyboard.hide();
  } catch {}
}

function blurEmptyComposerForHistoryScroll() {
  if (composerHasPendingContent()) return;
  if (!composerHasFocus()) return;
  els.promptInput?.blur();
  void hideNativeKeyboard();
}

function focusPromptInput() {
  if (!els.promptInput || !isNative() || !state.session || !hasChatAccess()) return;
  if (els.chatView?.classList.contains("hidden") || !els.researchReportView?.classList.contains("hidden")) return;
  els.composer?.classList.remove("compact");
  els.promptInput.focus({ preventScroll: true });
  void showNativeKeyboard();
}

function focusPromptInputSoon() {
  if (!isNative()) return;
  setTimeout(() => focusPromptInput(), 120);
  setTimeout(() => focusPromptInput(), 450);
}

function setAutoScroll(enabled) {
  state.autoScroll = Boolean(enabled);
}

function bindEvents() {
  initDocumentViewerWidth();

  document.addEventListener("pointerup", (event) => {
    if (event.target.closest("#selectionActions, #sideChatPanel")) return;
    requestAnimationFrame(showSelectionActionsFromCurrentSelection);
  });
  els.selectionActions?.addEventListener("pointerdown", (event) => event.preventDefault());
  els.selectionAddToChat?.addEventListener("click", () => {
    if (selectedTextContext && addTextToComposerPaste(selectedTextContext.text)) {
      hideSelectionActions();
      window.getSelection()?.removeAllRanges();
      selectedTextContext = null;
      focusPromptInput();
    }
  });
  els.selectionAskSideChat?.addEventListener("click", () => {
    if (!selectedTextContext) return;
    openSideChat(selectedTextContext.text, selectedTextContext.rect);
    hideSelectionActions();
    window.getSelection()?.removeAllRanges();
    selectedTextContext = null;
  });
  els.sideChatClose?.addEventListener("click", closeSideChat);
  els.sideChatContext?.addEventListener("click", () => openPastedTextDialog(sideChatState.context));
  els.sideChatSend?.addEventListener("click", () => { void sendSideChatMessage(); });
  els.sideChatInput?.addEventListener("input", () => {
    els.sideChatSend.disabled = sideChatState.running || !els.sideChatInput.value.trim();
  });
  els.sideChatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendSideChatMessage();
    }
  });
  let sideChatDrag = null;
  els.sideChatHeader?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = els.sideChatPanel.getBoundingClientRect();
    sideChatDrag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    els.sideChatHeader.setPointerCapture(event.pointerId);
  });
  els.sideChatHeader?.addEventListener("pointermove", (event) => {
    if (!sideChatDrag) return;
    const panel = els.sideChatPanel;
    const left = Math.min(Math.max(8, sideChatDrag.left + event.clientX - sideChatDrag.x), window.innerWidth - panel.offsetWidth - 8);
    const top = Math.min(Math.max(8, sideChatDrag.top + event.clientY - sideChatDrag.y), window.innerHeight - panel.offsetHeight - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
  const stopSideChatDrag = () => { sideChatDrag = null; };
  els.sideChatHeader?.addEventListener("pointerup", stopSideChatDrag);
  els.sideChatHeader?.addEventListener("pointercancel", stopSideChatDrag);
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".message-more-menu")) {
      document.querySelectorAll(".message-more-menu[open]").forEach((menu) => menu.removeAttribute("open"));
    }
    if (!event.target.closest("#selectionActions")) hideSelectionActions();
  });

  els.messages.addEventListener("scroll", closeOpenSourcesPills, { passive: true });
  let chatNavigationFrame = 0;
  const queueChatNavigationUpdate = () => {
    if (chatNavigationFrame) return;
    chatNavigationFrame = requestAnimationFrame(() => {
      chatNavigationFrame = 0;
      updateChatScrollNavigation();
    });
  };
  els.messages.addEventListener("scroll", queueChatNavigationUpdate, { passive: true });
  window.addEventListener("resize", () => {
    renderChatPromptNavigator();
    queueChatNavigationUpdate();
  }, { passive: true });
  els.chatJumpBottom?.addEventListener("click", () => {
    setAutoScroll(true);
    els.messages.scrollTo({
      top: els.messages.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  });
  els.chatPromptNav?.addEventListener("mouseenter", () => els.chatPromptRail?.setAttribute("aria-expanded", "true"));
  els.chatPromptNav?.addEventListener("mouseleave", () => els.chatPromptRail?.setAttribute("aria-expanded", "false"));
  els.chatPromptNav?.addEventListener("focusin", () => els.chatPromptRail?.setAttribute("aria-expanded", "true"));
  els.chatPromptNav?.addEventListener("focusout", (event) => {
    if (!els.chatPromptNav.contains(event.relatedTarget)) els.chatPromptRail?.setAttribute("aria-expanded", "false");
  });
  els.chatPromptList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-prompt-jump]");
    if (button) scrollToChatPrompt(button.dataset.promptJump);
  });
  // APK polish: collapse the composer to a mini pill only when the user is
  // clearly browsing history. Use hysteresis so normal/mini state does not
  // flicker around the bottom threshold while momentum scrolling.
  if (els.messages && els.composer) {
    let compactBottomSettleTimer = null;
    const clearCompactBottomSettleTimer = () => {
      if (!compactBottomSettleTimer) return;
      clearTimeout(compactBottomSettleTimer);
      compactBottomSettleTimer = null;
    };
    const expandCompactAtSettledBottom = () => {
      clearCompactBottomSettleTimer();
      compactBottomSettleTimer = setTimeout(() => {
        compactBottomSettleTimer = null;
        if (els.composer.classList.contains("compact") && distanceFromBottom(els.messages) <= 2) {
          els.composer.classList.remove("compact");
        }
      }, 120);
    };
    const updateCompact = () => {
      if (composerHasPendingContent() || composerHasFocus()) {
        clearCompactBottomSettleTimer();
        els.composer.classList.remove("compact");
        return;
      }
      const bottomDistance = distanceFromBottom(els.messages);
      if (els.composer.classList.contains("compact")) {
        if (bottomDistance <= 2) expandCompactAtSettledBottom();
        else clearCompactBottomSettleTimer();
      } else if (bottomDistance >= 180) {
        clearCompactBottomSettleTimer();
        els.composer.classList.add("compact");
      }
    };
    els.messages.addEventListener("scroll", updateCompact, { passive: true });
    const ro = new ResizeObserver(updateCompact);
    ro.observe(els.messages);
    state.composerCompactObserver = ro;
  }
  const expandCompactComposer = () => {
    if (!els.composer?.classList.contains("compact")) return;
    els.composer.classList.remove("compact");
    requestAnimationFrame(() => {
      els.composer?.classList.remove("compact");
      focusPromptInput();
    });
  };
  els.composer?.addEventListener("click", expandCompactComposer);
  els.composerArea?.addEventListener("click", expandCompactComposer);
  // Expand the mini composer only on a deliberate tap near the bottom of the
  // screen. Tracking pointer movement between down/up lets fast history scrolls
  // that begin in this zone pass through without snapping the pill to full size.
  let composerTapStart = null;
  document.addEventListener("pointerdown", (event) => {
    composerTapStart = isNative() && els.composer?.classList.contains("compact")
      ? { x: event.clientX, y: event.clientY, t: Date.now() }
      : null;
  }, { capture: true, passive: true });
  document.addEventListener("pointerup", (event) => {
    const start = composerTapStart;
    composerTapStart = null;
    if (!start || !els.composer?.classList.contains("compact")) return;
    if (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10) return;
    if (Date.now() - start.t > 500) return;
    if (event.clientY < window.innerHeight - 200) return;
    expandCompactComposer();
  }, { capture: true, passive: true });
  els.composer?.querySelector("#promptInput")?.addEventListener("focus", () => {
    els.composer?.classList.remove("compact");
  });
  els.appUpdateLater?.addEventListener("click", closeAppUpdate);
  els.appUpdateDownload?.addEventListener("click", () => {
    if (availableAppUpdate) openAppUpdate(availableAppUpdate);
  });

  document.addEventListener("click", (event) => {
    if (!isNative() || event.defaultPrevented) return;
    const link = event.target.closest("a[href]");
    if (!link) return;
    if (String(link.getAttribute("href") || "").startsWith("#")) return;
    const href = link.href;
    if (!/^https?:\/\//i.test(href)) return;
    // Product navigation uses pushState; ordinary HTTP anchors are external resources.
    event.preventDefault();
    openExternal(href).catch(() => showToast("Could not open link."));
  });

  // Auto-scroll is controlled ONLY by genuine user gestures (wheel, touch,
  // keys). Programmatic pinning during streaming never fires these events, so
  // it can never accidentally stop or restart auto-scroll. Any upward gesture
  // stops it immediately; returning to the bottom resumes it.
  els.messages.addEventListener("wheel", (event) => {
    blurEmptyComposerForHistoryScroll();
    if (event.deltaY < 0) setAutoScroll(false);
    else if (event.deltaY > 0 && isNearBottom(els.messages, 40)) setAutoScroll(true);
  }, { passive: true });

  els.messages.addEventListener("touchstart", (event) => {
    lastMessagesTouchY = event.touches?.[0]?.clientY ?? 0;
    blurEmptyComposerForHistoryScroll();
  }, { passive: true });

  els.messages.addEventListener("touchmove", (event) => {
    const y = event.touches?.[0]?.clientY ?? lastMessagesTouchY;
    if (y > lastMessagesTouchY + 2) setAutoScroll(false);
    else if (y < lastMessagesTouchY - 2 && isNearBottom(els.messages, 40)) setAutoScroll(true);
    lastMessagesTouchY = y;
  }, { passive: true });

  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (["ArrowUp", "PageUp", "Home"].includes(event.key)) setAutoScroll(false);
    else if (["ArrowDown", "PageDown", "End"].includes(event.key) && isNearBottom(els.messages, 40)) setAutoScroll(true);
  }, { passive: true });

  els.guestLoginButton.addEventListener("click", startSidebarLogin);
  els.authDialogClose.addEventListener("click", closeAuthDialog);
  els.paywallPlans.addEventListener("click", (e) => {
    const button = e.target.closest("[data-start-payment]");
    if (!button) return;
    startZiinaPayment(button.dataset.startPayment);
  });
  els.paywallBackButton?.addEventListener("click", () => {
    renderShell();
  });
  els.paywallCloseButton?.addEventListener("click", () => {
    renderShell();
  });
  els.signOutButton.addEventListener("click", signOutAndReset);

  els.sidebarButton.addEventListener("click", toggleSidebar);
  els.nativeMobileMenu?.addEventListener("click", toggleSidebar);
  els.compactNewChatButton?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
    addConversation();
  });
  els.nativeNavBackdrop?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
  });
  els.newChatButton.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
    addConversation();
  });
  els.searchChatsButton?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
    openSearchDialog();
  });
  els.projectsButton?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
    void openProjects();
  });
  els.projectChatCrumb?.addEventListener("click", () => {
    const projectId = els.projectChatCrumb.dataset.projectId;
    if (projectId) void openProject(projectId);
  });
  els.projectView?.addEventListener("click", (event) => { void handleProjectViewClick(event); });
  els.projectView?.addEventListener("change", (event) => { void handleProjectTitleChange(event); });
  els.projectView?.addEventListener("input", handleProjectSearch);
  els.projectView?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches(".project-title-input")) {
      event.preventDefault();
      event.target.blur();
    }
  });
  els.projectCreateForm?.addEventListener("submit", submitProjectCreate);
  els.projectCreateCancel?.addEventListener("click", () => els.projectCreateDialog?.close());
  els.projectFileInput?.addEventListener("change", (event) => {
    void uploadProjectFiles(event.target.files || []);
    event.target.value = "";
  });
  els.pinnedChatsButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePinnedPopup();
  });
  els.searchDialogClose?.addEventListener("click", closeSearchDialog);
  els.searchChatInput?.addEventListener("input", (event) => {
    renderSearchResults(event.target.value);
  });
  els.accountButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleProfileMenu();
  });
  els.profileMenuSettings?.addEventListener("click", () => {
    closeProfileMenu();
    openSettings();
  });
  els.profileMenuUpgrade?.addEventListener("click", openUpgradePlans);
  els.profileMenuAdmin?.addEventListener("click", openAdminDrawer);
  els.profileMenuSignOut?.addEventListener("click", () => {
    closeProfileMenu();
    signOutAndReset();
  });
  els.closeAccountButton.addEventListener("click", closeAccount);
  els.settingsButtonAlt?.addEventListener("click", () => {
    closeActionMenu();
    openSettings();
  });
  els.deepResearchToggle?.addEventListener("click", () => setResearchMode(!state.researchMode));
  els.researchModeClose?.addEventListener("click", () => setResearchMode(false));
  els.writingStyleButton?.addEventListener("click", openWritingStyleMenu);
  els.writingStyleBack?.addEventListener("click", openActionMenuRoot);
  els.writingStyleMenu?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-writing-style]");
    if (option) setWritingStyle(option.dataset.writingStyle);
  });
  els.writingStylePillClose?.addEventListener("click", () => setWritingStyle("normal"));
  els.researchReportBack?.addEventListener("click", () => researchController.closeResearchReport());
  els.researchVisualTab?.addEventListener("click", () => researchController.setResearchReportView("visual"));
  els.researchTextTab?.addEventListener("click", () => researchController.setResearchReportView("text"));
  els.researchCopy?.addEventListener("click", () => {
    const text = state.researchReport?.report || "";
    copyText(text).then(() => flashCopySuccess(els.researchCopy)).catch(() => showToast("Copy failed."));
  });
  els.researchReportToc?.addEventListener("click", (event) => {
    const link = event.target.closest("a[href^='#']");
    if (!link) return;
    const heading = document.getElementById(link.getAttribute("href").slice(1));
    if (!heading) return;
    event.preventDefault();
    const header = els.researchReportView.querySelector(".research-report-header");
    const top = heading.getBoundingClientRect().top
      - els.researchReportView.getBoundingClientRect().top
      + els.researchReportView.scrollTop
      - (header?.offsetHeight || 0)
      - 20;
    els.researchReportView.scrollTo({
      top: Math.max(0, top),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  });
  els.researchPrint?.addEventListener("click", () => window.print());
  els.closeSettingsButton.addEventListener("click", closeSettings);
  els.settingsDrawer?.addEventListener("click", (event) => {
    if (!els.settingsDrawer.classList.contains("open")) return;
    if (event.target.closest(".settings-panel")) return;
    closeSettings();
  });

  els.overlay.addEventListener("click", () => {
    const mode = els.overlay.dataset.mode;
    if (mode === "confirm") closeConfirmDialog();
    else if (mode === "rename") closeRenameDialog();
    else if (mode === "auth") closeAuthDialog();
    else if (mode === "search") closeSearchDialog();
    else if (mode === "account") closeAccount();
    else if (mode === "app-update") closeAppUpdate();
    else closeSettings();
  });

  document.addEventListener("click", (event) => {
    if (isProfileMenuOpen() && !event.target.closest("#sidebarProfileWrap")) {
      closeProfileMenu();
    }
    if (isPinnedPopupOpen() && !event.target.closest("#sidebarPinWrap")) {
      closePinnedPopup();
    }
    if (state.openConversationMenuId && !event.target.closest(".conversation-menu-wrap")) {
      closeConversationMenus();
    }
    if (!event.target.closest(".sources-pill")) {
      closeOpenSourcesPills();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isProfileMenuOpen()) { closeProfileMenu(); return; }
    if (isSearchDialogOpen()) { closeSearchDialog(); return; }
    if (isPinnedPopupOpen()) { closePinnedPopup(); return; }
    if (state.openConversationMenuId) { closeConversationMenus(); return; }
    if (els.renameDialog.classList.contains("open")) { closeRenameDialog(); return; }
    if (els.confirmDialog.classList.contains("open")) { closeConfirmDialog(); return; }
    if (!els.lightbox.classList.contains("hidden")) { closeLightbox(); return; }
    if (state.viewer.open) { closeDocumentViewer(); return; }
    if (!els.composerActionMenu.classList.contains("hidden") || !els.writingStyleMenu?.classList.contains("hidden")) { closeActionMenu(); return; }
    if (!els.compareDropdown.classList.contains("hidden")) { compareController.closeCompareDropdown(); return; }
    if (!els.modelDropdown.classList.contains("hidden")) { closeModelDropdown(); return; }
    if (els.authDialog.classList.contains("open")) { closeAuthDialog(); return; }
    if (els.accountDrawer.classList.contains("open")) { closeAccount(); return; }
    if (els.settingsDrawer.classList.contains("open")) { closeSettings(); return; }
  });

  els.modelButton.addEventListener("click", (e) => {
    e.stopPropagation();
    closeActionMenu();
    compareController.closeCompareDropdown();
    if (document.body.classList.contains("capacitor-native")) {
      const mode = selectedModelMode() === "pro" ? "thinking" : "pro";
      updateSetting("modelMode", mode);
      updateSetting("provider", "openrouter");
      updateSetting("thinkingEffort", DEFAULT_REASONING_EFFORT);
      updateSetting("model", mode === "pro" ? OPENROUTER_PRO_MODEL : resolveRoutedModel());
      closeModelDropdown();
      renderModelOptions();
      if (typeof renderTopBarMode === "function") renderTopBarMode();
      return;
    }
    toggleModelDropdown();
  });

  els.compareButton.addEventListener("click", (e) => {
    e.stopPropagation();
    closeActionMenu();
    closeModelDropdown();
    compareController.closeCompareDropdown();
    if (state.researchMode) setResearchMode(false);
    if (state.settings.compareEnabled && state.settings.compareMode !== "council") {
      compareController.cancelCompareMode();
      return;
    }
    compareController.activateCompareMode();
  });

  if (els.councilButton) {
    els.councilButton.addEventListener("click", (e) => {
      e.stopPropagation();
      closeActionMenu();
      closeModelDropdown();
      compareController.closeCompareDropdown();
      if (state.researchMode) setResearchMode(false);
      if (state.settings.compareEnabled && state.settings.compareMode === "council") {
        compareController.cancelCompareMode();
        return;
      }
      councilController.activateCouncilMode();
    });
  }

  document.addEventListener("click", (e) => {
    if (!els.modelDropdown.contains(e.target) && !els.composerModelWrap.contains(e.target)) {
      closeModelDropdown();
    }
    if (!els.composerActionMenu.contains(e.target) && !els.composerActionMenuWrap.contains(e.target)) {
      closeActionMenu();
    }
    if (!els.compareDropdown.contains(e.target) && !els.compareWrap.contains(e.target)) {
      compareController.closeCompareDropdown();
    }
  });

  els.modelCatalog.addEventListener("click", (e) => {
    const modeItem = e.target.closest("[data-model-mode]");
    if (modeItem) {
      const mode = modeItem.dataset.modelMode === "pro" ? "pro" : "thinking";
      updateSetting("modelMode", mode);
      updateSetting("provider", "openrouter");
      updateSetting("thinkingEffort", DEFAULT_REASONING_EFFORT);
      updateSetting("model", mode === "pro" ? OPENROUTER_PRO_MODEL : resolveRoutedModel());
      closeModelDropdown();
      renderModelOptions();
      if (typeof renderTopBarMode === "function") renderTopBarMode();
      els.promptInput.focus();
      return;
    }

    const item = e.target.closest("[data-model-id]");
    if (!item) return;
    if (activeProvider() === "openrouter") {
      /* Picking a Klui model from the dropdown is an implicit
         "switch back to Klui" — keep the chosen id and route through Klui. */
      updateSetting("provider", "klui");
      renderProviderToggle();
    }
    updateSetting("model", item.dataset.modelId);
    closeModelDropdown();
    renderModelOptions();
    els.promptInput.focus();
  });

  els.compareCatalog.addEventListener("click", (e) => {
    const item = e.target.closest("[data-compare-model-id]");
    if (!item) return;
    const id = item.dataset.compareModelId;
    const selected = compareController.selectedCompareModelIds();
    const exists = selected.includes(id);
    if (!exists && selected.length >= 4) {
      showToast("Compare uses the fixed two-model pair.");
      return;
    }

    const next = exists ? selected.filter((modelId) => modelId !== id) : [...selected, id];
    updateSetting("compareModels", next);
    updateSetting("compareEnabled", next.length >= 2);
    if (state.compareDescribeImages && !compareIncludesTextOnlyModels(next)) {
      state.compareDescribeImages = false;
    }
    compareController.renderCompareControls();
    syncCompareContextBanner(next);
    els.promptInput.focus();
  });

  els.compareClearButton.addEventListener("click", () => {
    compareController.cancelCompareMode();
    els.promptInput.focus();
  });

  if (els.compareModeToggle) {
    els.compareModeToggle.addEventListener("click", (e) => {
      const seg = e.target.closest("[data-compare-mode]");
      if (!seg) return;
      const mode = seg.dataset.compareMode === "council" ? "council" : "compare";
      if (state.settings.compareMode === mode) return;
      updateSetting("compareMode", mode);
      compareController.renderCompareControls();
    });
  }

  els.compareContextYes.addEventListener("click", () => {
    state.compareDescribeImages = true;
    compareController.closeCompareContextBanner();
    els.promptInput.focus();
  });

  els.compareContextNo.addEventListener("click", async () => {
    compareController.closeCompareContextBanner();
    try {
      await compareController.startCompareFreshChat();
      els.promptInput.focus();
    } catch (err) {
      showToast(err.message);
    }
  });

  els.compareContextCancel.addEventListener("click", () => {
    compareController.cancelCompareMode();
    els.promptInput.focus();
  });

  els.compareInput.addEventListener("input", () => compareController.renderCompareCatalog());
  els.temporaryChatToggle?.addEventListener("click", () => {
    if (!requireAuth()) return;
    setTemporaryChatMode(!state.temporaryChat);
    // Force-clear the press highlight so toggling off never leaves a stuck
    // ring on the icon. (transitionend-based removal has a perceptible
    // gap that the user noticed.)
    els.temporaryChatToggle?.classList.remove("pressed");
    els.promptInput?.focus();
  });

  // ── Mode chip dropdown (APK only) ──────────────────────────────────
  // Renders the current mode label inside the top-bar chip and wires
  // the dropdown open/close + selection handlers.
  function renderTopBarMode() {
    const mode = currentNativeTopBarMode();
    const label = els.nativeMobileModeLabel;
    if (label) {
      const display = mode === "thinking" ? "Thinking"
        : mode === "pro" ? "Pro"
        : mode === "compare" ? "Compare"
        : mode === "council" ? "Council"
        : mode;
      label.textContent = display;
    }
    // Mark the active item in the dropdown
    const dropdown = els.nativeMobileModeDropdown;
    if (dropdown) {
      dropdown.querySelectorAll(".native-mobile-mode-item").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.mode === mode);
        btn.setAttribute("aria-selected", btn.dataset.mode === mode ? "true" : "false");
      });
    }
  }

  function closeTopBarModeDropdown() {
    if (!els.nativeMobileModeButton) return;
    els.nativeMobileModeButton.setAttribute("aria-expanded", "false");
    els.nativeMobileModeDropdown?.classList.add("hidden");
  }

  function openTopBarModeDropdown() {
    if (!els.nativeMobileModeButton) return;
    renderTopBarMode();
    els.nativeMobileModeButton.setAttribute("aria-expanded", "true");
    els.nativeMobileModeDropdown?.classList.remove("hidden");
  }

  // Wire mode chip click → toggle dropdown
  els.nativeMobileModeButton?.addEventListener("click", () => {
    const isOpen = els.nativeMobileModeButton?.getAttribute("aria-expanded") === "true";
    if (isOpen) {
      closeTopBarModeDropdown();
    } else {
      openTopBarModeDropdown();
    }
  });

  // Wire mode item selection
  els.nativeMobileModeDropdown?.querySelectorAll(".native-mobile-mode-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      if (!mode) return;
      applyNativeTopBarMode(mode);
      renderTopBarMode();
      closeTopBarModeDropdown();
    });
  });

  // Close dropdown on outside click
  document.addEventListener("click", (e) => {
    if (!els.nativeMobileModeButton || !els.nativeMobileModeDropdown) return;
    if (!els.nativeMobileModeButton.contains(e.target) && !els.nativeMobileModeDropdown.contains(e.target)) {
      closeTopBarModeDropdown();
    }
  });

  // Close dropdown on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeTopBarModeDropdown();
      closePastedTextDialog();
    }
  });

  // Initial render
  renderTopBarMode();

  // Briefly show the .pressed highlight on the temporary-chat toggle and
  // auto-remove it so the press feedback does not linger after the toggle.
  els.temporaryChatToggle?.addEventListener("pointerdown", () => {
    const btn = els.temporaryChatToggle;
    if (!btn) return;
    btn.classList.remove("pressed");
    // Force a reflow so the class re-add restarts the transition.
    void btn.offsetWidth;
    btn.classList.add("pressed");
  });
  els.temporaryChatToggle?.addEventListener("transitionend", (event) => {
    if (event.propertyName !== "background-color") return;
    els.temporaryChatToggle.classList.remove("pressed");
  });
  els.temporaryChatToggle?.addEventListener("pointercancel", () => {
    els.temporaryChatToggle.classList.remove("pressed");
  });

  els.sidebarMid?.addEventListener("click", handleConversationListClick);
  els.pinnedPopupList?.addEventListener("click", handleConversationListClick);
  els.searchChatResults?.addEventListener("click", handleConversationListClick);

  window.addEventListener("popstate", async () => {
    if (!state.session?.access_token) return;
    if (blockChatNavigationWhileRunning()) {
      window.history.replaceState(
        { conversationId: state.activeConversationId || "" },
        "",
        conversationUrl(state.activeConversationId)
      );
      return;
    }
    parkActiveConversationRun();
    researchController.stopResearchPolling();
    const routeResearchId = researchIdFromLocation();
    const routeConversationId = conversationIdFromLocation();
    const routeProjectId = projectIdFromLocation();
    suppressUrlSync = true;
    try {
      if (routeResearchId) {
        await researchController.openResearchReport(routeResearchId, { push: false });
        return;
      }
      if (!els.researchReportView.classList.contains("hidden")) {
        await researchController.closeResearchReport({ push: false });
      }
      if (projectsRouteFromLocation()) {
        state.projectsOpen = true;
        state.activeProjectId = routeProjectId;
        state.activeProject = null;
        state.activeConversationId = "";
        state.messages = [];
        if (routeProjectId) await loadActiveProject();
        renderShell();
        return;
      }
      if (!routeConversationId) {
        state.temporaryChat = false;
        state.projectsOpen = false;
        state.activeProjectId = "";
        state.activeProject = null;
        state.activeConversationId = "";
        state.messages = [];
        stopPendingArtifactPolls();
        closeDocumentViewer();
        compareController.closeCompareContextBanner();
        syncActiveRunningUi();
        renderShell();
        return;
      }
      if (!state.conversations.some((conversation) => conversation.id === routeConversationId)) {
        await loadConversations();
      }
      if (!state.conversations.some((conversation) => conversation.id === routeConversationId)) {
        state.activeConversationId = "";
        state.messages = [];
        stopPendingArtifactPolls();
        window.history.replaceState({ conversationId: "" }, "", "/");
        syncActiveRunningUi();
        renderShell();
        return;
      }
      state.activeConversationId = routeConversationId;
      state.temporaryChat = false;
      closeDocumentViewer();
      compareController.closeCompareContextBanner();
      await loadActiveConversation();
      renderShell();
    } catch (err) {
      showToast(err.message);
    } finally {
      suppressUrlSync = false;
    }
  });

  els.confirmCancelButton.addEventListener("click", closeConfirmDialog);
  els.confirmDeleteButton.addEventListener("click", () => {
    void confirmPendingDelete();
  });
  els.renameCancelButton.addEventListener("click", closeRenameDialog);
  els.renameSaveButton.addEventListener("click", saveRenameDialog);
  els.renameChatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveRenameDialog();
    }
  });

  els.actionMenuButton.addEventListener("click", (e) => {
    e.stopPropagation();
    closeModelDropdown();
    compareController.closeCompareDropdown();
    toggleActionMenu();
  });

  els.imageToggle.addEventListener("click", () => {
    closeActionMenu();
    if (!requireAuth()) return;
    if (state.temporaryChat) {
      showToast("Temporary chat is text-only for now.");
      return;
    }
    els.imageFileInput.click();
  });
  els.imageFileInput.addEventListener("change", (e) => {
    acceptPendingFiles(e.target.files || []);
    e.target.value = "";
  });
  els.cameraAction?.addEventListener("click", () => {
    closeActionMenu();
    if (!requireAuth()) return;
    if (state.temporaryChat) {
      showToast("Temporary chat is text-only for now.");
      return;
    }
    els.cameraFileInput?.click();
  });
  els.cameraFileInput?.addEventListener("change", (e) => {
    acceptPendingFiles(e.target.files || []);
    e.target.value = "";
  });

  const hasDraggedFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  els.composer?.addEventListener("dragover", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (state.temporaryChat || state.researchMode) return;
    event.dataTransfer.dropEffect = "copy";
    els.composer.classList.add("drag-over");
  });
  els.composer?.addEventListener("dragleave", (event) => {
    if (!els.composer.contains(event.relatedTarget)) els.composer.classList.remove("drag-over");
  });
  els.composer?.addEventListener("drop", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    els.composer.classList.remove("drag-over");
    acceptPendingFiles(event.dataTransfer?.files || []);
  });

  if (els.webSearchToggle) {
    els.webSearchToggle.addEventListener("click", () => {
      toggleWebSearchMode();
      closeActionMenu();
    });
  }
  if (els.providerToggle) {
    els.providerToggle.addEventListener("click", toggleProvider);
  }
  els.imagePreviews.addEventListener("click", (e) => {
    const removePaste = e.target.closest("[data-remove-paste]");
    if (removePaste) {
      e.stopPropagation();
      state.pastedText = "";
      renderImages();
      return;
    }
    if (e.target.closest("[data-open-composer-paste]")) {
      openPastedTextDialog(state.pastedText);
      return;
    }
    const removeBtn = e.target.closest("[data-remove-index]");
    if (removeBtn) {
      e.stopPropagation();
      const [removed] = state.images.splice(Number(removeBtn.dataset.removeIndex), 1);
      forgetPendingDocument(removed);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      if (removed?.abortController) removed.abortController.abort();
      const deleteId = removed?.attachmentId || removed?.uploadId || "";
      if (deleteId) {
        deleteAttachment(state.session, deleteId).catch((err) => {
          showToast(err.message || "Attachment could not be deleted.");
        });
      }
      renderImages();
      compareController.syncCompareContextBanner();
      return;
    }
    const thumb = e.target.closest("[data-preview-src]");
    if (thumb) openLightbox(thumb.dataset.previewSrc);
  });

  els.followupQueue?.addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit-followup]");
    if (edit) {
      editFollowUp(edit.dataset.editFollowup);
      return;
    }
    const save = e.target.closest("[data-save-followup]");
    if (save) {
      saveFollowUp(save.dataset.saveFollowup);
      return;
    }
    const del = e.target.closest("[data-delete-followup]");
    if (del) {
      deleteFollowUp(del.dataset.deleteFollowup);
    }
  });

  els.followupQueue?.addEventListener("keydown", (e) => {
    const input = e.target.closest("[data-followup-input]");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      saveFollowUp(input.dataset.followupInput);
    } else if (e.key === "Escape") {
      const item = state.followUps.find((candidate) => candidate.id === input.dataset.followupInput);
      if (item) item.editing = false;
      renderFollowUps();
    }
  });

  els.lightboxClose.addEventListener("click", (e) => { e.stopPropagation(); closeLightbox(); });
  els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) closeLightbox(); });
  els.pastedTextDialogClose?.addEventListener("click", closePastedTextDialog);
  els.pastedTextDialog?.addEventListener("click", (e) => {
    if (e.target === els.pastedTextDialog) closePastedTextDialog();
  });
  els.documentViewerClose?.addEventListener("click", closeDocumentViewer);
  els.documentViewerResizer?.addEventListener("pointerdown", beginDocumentViewerResize);
  els.messages.addEventListener("click", async (e) => {
    const pastedCard = e.target.closest("[data-open-pasted-text]");
    if (pastedCard) {
      const message = state.messages.find((item) => String(item.id) === pastedCard.dataset.openPastedText);
      const paste = pastedTextFromMessage(message);
      if (paste) openPastedTextDialog(paste.text);
      return;
    }
    const openResearch = e.target.closest("[data-open-research]");
    if (openResearch) {
      await researchController.openResearchReport(openResearch.dataset.openResearch);
      return;
    }
    const cancelResearchButton = e.target.closest("[data-cancel-research]");
    if (cancelResearchButton) {
      try {
        const payload = await cancelResearch(state.session, cancelResearchButton.dataset.cancelResearch);
        researchController.applyResearchRunUpdate(payload.run);
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    const previewImage = e.target.closest("[data-preview-src]");
    if (previewImage) {
      openLightbox(previewImage.dataset.previewSrc);
      return;
    }

    const viewButton = e.target.closest("[data-view-attachment-id]");
    if (viewButton) {
      e.preventDefault();
      const attachmentId = viewButton.dataset.viewAttachmentId;
      if (!state.session?.access_token) {
        showToast("Sign in to view files.");
        return;
      }
      openDocumentViewer({
        attachmentId,
        fileName: viewButton.dataset.fileName || "Document",
        format: viewButton.dataset.format || ""
      });
      return;
    }

    const downloadLink = e.target.closest("a[href]");
    if (downloadLink) {
      const attachmentId = attachmentDownloadPath(downloadLink.getAttribute("href") || "");
      if (attachmentId) {
        e.preventDefault();
        if (!state.session?.access_token) {
          showToast("Sign in to download files.");
          return;
        }
        const fileName = downloadLink.dataset.fileName || downloadLink.getAttribute("download") || downloadLink.textContent?.trim() || "download";
        try {
          await downloadAttachment(state.session, attachmentId, fileName);
        } catch (err) {
          showToast(err.message || "Download failed.");
        }
        return;
      }
    }

    const codeCopy = e.target.closest("[data-code-id]");
    if (codeCopy) {
      const text = getCodeSource(codeCopy.dataset.codeId)
        || codeCopy.closest(".code-block-wrap")?.querySelector("code")?.textContent
        || "";
      if (!text) {
        showToast("Copy failed.");
        return;
      }
      copyText(text).then(() => flashCopySuccess(codeCopy)).catch(() => showToast("Copy failed."));
      return;
    }

    const retryBtn = e.target.closest("[data-retry-assistant-id]");
    if (retryBtn) {
      e.preventDefault();
      const assistantId = retryBtn.dataset.retryAssistantId || "";
      if (assistantId) retryFailedAssistant(assistantId).catch((err) => showToast(err.message || "Retry failed."));
      return;
    }
    const adjustBtn = e.target.closest("[data-adjust-response]");
    if (adjustBtn) {
      e.preventDefault();
      adjustBtn.closest("details")?.removeAttribute("open");
      const assistantId = adjustBtn.dataset.adjustAssistantId || "";
      const adjustment = adjustBtn.dataset.adjustResponse || "";
      if (assistantId) retryFailedAssistant(assistantId, adjustment).catch((err) => showToast(err.message || "Response rewrite failed."));
      return;
    }

    const editBtn = e.target.closest("[data-edit-msg]");
    if (editBtn) {
      e.preventDefault();
      beginEditMessage(editBtn.dataset.editMsg);
      return;
    }

    if (e.target.closest("[data-edit-cancel]")) {
      e.preventDefault();
      cancelEditMessage();
      return;
    }

    const editSave = e.target.closest("[data-edit-save]");
    if (editSave) {
      e.preventDefault();
      editUserMessage(editSave.dataset.editSave).catch((err) => showToast(err.message || "Edit failed."));
      return;
    }

    const msgCopy = e.target.closest("[data-copy-msg]");
    if (msgCopy) {
      const container = msgCopy.closest("[data-raw-text]");
      const text = container?.dataset.rawText || "";
      copyText(text).then(() => flashCopySuccess(msgCopy)).catch(() => showToast("Copy failed."));
      return;
    }
  });

  els.messages.addEventListener("keydown", (e) => {
    const previewImage = e.target.closest("[data-preview-src]");
    if (previewImage && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openLightbox(previewImage.dataset.previewSrc);
      return;
    }
    const input = e.target.closest("[data-edit-input]");
    if (!input) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      editUserMessage(input.dataset.editInput).catch((err) => showToast(err.message || "Edit failed."));
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditMessage();
    }
  });

  els.messages.addEventListener("input", (e) => {
    const input = e.target.closest("[data-edit-input]");
    if (input) autoSizeEditInput(input);
  });

  els.sendButton.addEventListener("click", sendPrompt);
  els.stopButton.addEventListener("click", () => {
    if (state.activeResearchId) {
      cancelResearch(state.session, state.activeResearchId).catch((error) => showToast(error.message));
      return;
    }
    const run = getConversationRun();
    if (!run) return;
    if (run.turnRunId && run.conversationId) {
      run.cancelRequested = true;
      state.activeTurnCancelRequested = true;
      cancelPendingDocumentTurn(
        state.session,
        run.conversationId,
        run.turnRunId
      ).then((result) => {
        run.cancelResult = result;
        state.activeTurnCancelResult = result;
        restoreCancelledTurnDraft(result);
      }).catch((error) => showToast(error.message || "The pending turn could not be cancelled."))
        .finally(() => run.abortController?.abort());
      return;
    }
    run.abortController?.abort();
  });

  els.promptInput.addEventListener("input", () => { els.composer?.classList.remove("compact"); applyComposerHeight(); updateSendButton(); renderContextMeter(); });
  els.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
  });
  els.promptInput.addEventListener("paste", (e) => {
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      acceptPendingFiles(files);
      return;
    }
    const pasted = e.clipboardData?.getData("text/plain") || "";
    const isLongPaste = pasted.length >= LONG_PASTE_MIN_CHARS || pasted.split("\n").length >= LONG_PASTE_MIN_LINES;
    if (!isLongPaste || state.running) return;
    e.preventDefault();
    addTextToComposerPaste(pasted);
  });

  els.temperatureInput.addEventListener("input", (e) => updateSetting("temperature", Number(e.target.value)));
  els.topPInput.addEventListener("input", (e) => updateSetting("top_p", Number(e.target.value)));
  els.maxTokensInput.addEventListener("input", (e) => updateSetting("max_tokens", e.target.value));
  els.seedInput.addEventListener("input", (e) => updateSetting("seed", e.target.value));
  els.systemPromptInput.addEventListener("input", (e) => { state.settings.systemPrompt = e.target.value; });
  els.showModelReasoningInput?.addEventListener("change", (e) => {
    updateSetting("showModelReasoning", e.target.checked);
    renderMessages();
  });
  els.textScaleInput?.addEventListener("input", (e) => {
    const value = clampTextScale(e.target.value);
    if (els.textScaleValue) els.textScaleValue.textContent = `${value}%`;
    void setTextZoom(value);
  });
  els.textScaleInput?.addEventListener("change", (e) => {
    updateSetting("uiTextScale", clampTextScale(e.target.value));
  });
  els.saveSystemPromptButton?.addEventListener("click", () => { void adminPanel.saveGlobalSystemPrompt(); });
  els.themePreviewGrid?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme]");
    if (!btn) return;
    updateSetting("theme", CHAT_THEMES.has(btn.dataset.theme) ? btn.dataset.theme : "classic");
  });
  els.appearancePill?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-appearance]");
    if (!btn) return;
    updateSetting("appearance", APPEARANCES.has(btn.dataset.appearance) ? btn.dataset.appearance : "system");
  });
  els.colorPresetRow?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-accent]");
    if (!btn) return;
    updateSetting("colorPreset", COLOR_PRESETS.has(btn.dataset.accent) ? btn.dataset.accent : "default");
  });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (state.settings.appearance === "system") applyChatTheme();
  });

  els.loadAdminButton.addEventListener("click", () => { void adminPanel.loadAdminDashboard(); });
  els.adminOutput.addEventListener("click", (e) => {
    const approve = e.target.closest("[data-approve-payment]");
    if (approve) {
      adminPanel.updateAdminPayment(approve.dataset.approvePayment, "approve");
      return;
    }
    const reject = e.target.closest("[data-reject-payment]");
    if (reject) adminPanel.updateAdminPayment(reject.dataset.rejectPayment, "reject");
  });
}

document.body.classList.toggle("capacitor-native", isNative());
bindEvents();
bootstrap();
