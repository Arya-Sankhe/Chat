import {
  configureApiAuth,
  approveAdminPayment,
  clearMemory,
  cancelMamoSubscription,
  cancelResearch,
  cancelPendingDocumentTurn,
  createContentReport,
  createConversation,
  createProject,
  createResearch,
  createMamoCheckout,
  createZiinaPaymentRequest,
  deleteAccount,
  downloadAccountData,
  deleteAttachment,
  deleteConversation,
  deleteProject,
  updateConversation,
  updateProject,
  downloadAttachment,
  exportEditableDocument,
  reviseEditableDocument,
  reviseEmailDraft,
  fetchAttachmentView,
  fetchAdminSummary,
  fetchConfig,
  fetchBuild,
  fetchConversation,
  fetchDocumentJobStatus,
  fetchDocumentStatus,
  fetchMe,
  fetchMemory,
  fetchModels,
  fetchPlans,
  fetchProject,
  fetchStorage,
  fetchResearchReport,
  fetchResearchStatus,
  fetchZiinaPaymentRequests,
  listConversations,
  listProjects,
  searchChats,
  saveEditableDocument,
  rejectAdminPayment,
  resolveAdminReport,
  requestClarifications,
  completeUpload,
  presignUpload,
  putUploadContent,
  streamCompareConversationMessage,
  streamConversationMessage,
  streamTemporaryChat,
  updateAdminSettings,
  updateMemory,
  transcribeSpeech,
  uploadFile,
  fetchStudyMaterials,
  generateStudyContent,
  deleteStudyMaterial,
  fetchStudyPractice,
  fetchStudyQueue,
  createStudyCard,
  updateStudyCard,
  deleteStudyCard,
  updateStudyDeck,
  deleteStudyDeck,
  fetchStudyQuiz,
  updateStudyQuiz,
  deleteStudyQuiz,
  submitStudyQuizAttempt,
  exportStudyNote,
  deleteStudyNote
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
  showNativeKeyboard as showNativeKeyboardInstant,
  signInWithGoogle as nativeSignInWithGoogle
} from "./platform/index.js";
import { checkForAppUpdate, openAppUpdate } from "./platform/updates.js";
import {
  applyVisualizeFrameMessage,
  compactModelDisplayName,
  emailCardFields,
  escapeHtml,
  getCodeSource,
  gmailComposeUrl,
  mailtoComposeUrl,
  modelBrandLogoUrl,
  modelSupportsVision,
  normalizeModelList,
  outlookComposeUrl,
  renderPlainText,
  renderContent,
  resetCodeSourceStore,
  stripRedundantSourcesFooter
} from "./render.js";
import { extractReasoningDelta } from "./reasoning.js";
import { createStreamReducer } from "./streaming.js";
import { createDocumentViewer } from "./documentViewer.js";
import { createResearchController } from "./research.js";
import { createCompareController } from "./compare.js";
import { createCouncilController } from "./council.js";
import { createAdminPanel } from "./adminPanel.js";
import { reconcilePendingTurnMessages } from "./pendingTurns.js";
import {
  hydrateKluiBars,
  renderHomeGreetingHtml,
  renderKluiThinkingStatus,
  startHomeGreeting,
  stopHomeGreeting,
  updateKluiBar
} from "./klui.js";

const SETTINGS_KEY = "klui.chat.controls.v1";
const PINNED_CHATS_KEY = "klui.pinnedChats.v1";
const GOOGLE_FONTS_HREF = "https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Orbitron:wght@700&family=Patrick+Hand&family=Shantell+Sans:ital,wght@0,400;0,600;0,800;1,500&display=swap";

const CHAT_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
const MENU_ICON_ATTRS = `width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
const PIN_MENU_ICON_SVG = `<svg ${MENU_ICON_ATTRS}><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`;
const RENAME_MENU_ICON_SVG = `<svg ${MENU_ICON_ATTRS}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
const DELETE_MENU_ICON_SVG = `<svg ${MENU_ICON_ATTRS}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>`;

const OPENROUTER_TEXT_MODEL = "deepseek/deepseek-v4-flash-0731";
const OPENROUTER_VISION_MODEL = "xiaomi/mimo-v2.5";
const OPENROUTER_COUNCIL_HY3_MODEL = "tencent/hy3";
// Text-only; used only as a Council panelist.
const OPENROUTER_COUNCIL_MIMO_PRO_MODEL = "xiaomi/mimo-v2.5-pro";
const OPENROUTER_PRO_MODEL = "openai/gpt-5.6-luna";
const OPENROUTER_NITRO_MODEL = "inclusionai/ling-3.0-flash";
const OPENROUTER_VISION_L2 = "qwen/qwen3.7-flash";
const OPENROUTER_VISION_L3 = "qwen/qwen3.8-flash";
const OPENROUTER_GLM_FLASH_MODEL = "z-ai/glm-5.3-flash";
// Text compare. Also the legacy media path (Flash + MiMo describe) — revert by always returning this.
const DEFAULT_COMPARE_MODELS = [OPENROUTER_TEXT_MODEL, OPENROUTER_VISION_MODEL];
const COMPARE_MEDIA_MODELS = [OPENROUTER_VISION_MODEL, OPENROUTER_VISION_L2];
const DEFAULT_COUNCIL_MODELS = [
  OPENROUTER_TEXT_MODEL,
  OPENROUTER_COUNCIL_HY3_MODEL,
  OPENROUTER_VISION_MODEL,
  OPENROUTER_COUNCIL_MIMO_PRO_MODEL
];
const COUNCIL_MEDIA_MODELS = [
  OPENROUTER_VISION_MODEL,
  OPENROUTER_GLM_FLASH_MODEL,
  OPENROUTER_VISION_L3,
  OPENROUTER_VISION_L2
];
const DEFAULT_REASONING_EFFORT = "high";
const SPECTRUM_N = 3;
const SPECTRUM_STEPS = [
  { mode: "thinking", model: OPENROUTER_NITRO_MODEL, effort: "high" },
  { mode: "thinking", model: OPENROUTER_TEXT_MODEL, effort: "xhigh" },
  { mode: "pro", model: OPENROUTER_PRO_MODEL, effort: "xhigh" }
];

function normalizeThinkingEffort(value) {
  const effort = String(value || "").trim().toLowerCase();
  if (effort === "max") return "xhigh";
  return effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh"
    ? effort
    : DEFAULT_REASONING_EFFORT;
}

function currentReasoningEffort() {
  return normalizeThinkingEffort(state.settings.thinkingEffort);
}

function spectrumLevelFromSettings() {
  const stored = Number(state.settings.spectrumLevel);
  if (Number.isInteger(stored) && stored >= 0 && stored < SPECTRUM_N) return stored;
  const model = state.settings.model;
  const effort = currentReasoningEffort();
  const idx = SPECTRUM_STEPS.findIndex((s) => s.model === model && s.effort === effort);
  if (idx >= 0) return idx;
  return selectedModelMode() === "pro" ? SPECTRUM_N - 1 : 1;
}

function applySpectrumLevel(level) {
  let n = Math.max(0, Math.min(SPECTRUM_N - 1, level | 0));
  if (n === 0 && pendingPromptNeedsVision()) {
    n = 1;
    showAttachmentModelNotice();
  }
  const step = SPECTRUM_STEPS[n];
  updateSetting("spectrumScale", 3);
  updateSetting("spectrumLevel", n);
  updateSetting("modelMode", step.mode);
  updateSetting("provider", "openrouter");
  updateSetting("thinkingEffort", step.effort);
  updateSetting("model", step.model);
  paintSpectrum(n);
  renderModelOptions();
  if (typeof renderTopBarMode === "function") renderTopBarMode();
}

function paintSpectrum(level = spectrumLevelFromSettings()) {
  const n = Math.max(0, Math.min(SPECTRUM_N - 1, level | 0));
  const sliderT = n / (SPECTRUM_N - 1);
  const sliderPct = `${sliderT * 100}%`;
  if (els.spectrumSteps && !els.spectrumSteps.children.length) {
    for (let i = 0; i < SPECTRUM_N; i++) els.spectrumSteps.appendChild(document.createElement("i"));
  }
  if (els.spectrumFill) els.spectrumFill.style.width = sliderPct;
  if (els.spectrumThumb) els.spectrumThumb.style.left = sliderPct;
  if (els.spectrumTrack) els.spectrumTrack.setAttribute("aria-valuenow", String(n));
  if (els.spectrumSteps) {
    [...els.spectrumSteps.children].forEach((dot, i) => dot.classList.toggle("lit", i <= n));
  }
  if (els.heatFill) els.heatFill.style.width = "100%";
  const isPro = n === SPECTRUM_N - 1;
  const heatLabel = isPro ? roleLabel("pro", "Pro").toUpperCase() : n === 0 ? roleLabel("nitro", "Nitro") : roleLabel("think", "Think");
  els.modelButton?.classList.toggle("nitro-active", n === 0);
  els.modelButton?.classList.toggle("think-active", n === 1);
  els.modelButton?.classList.toggle("pro-active", isPro);
  const names = document.querySelectorAll(".heat-name");
  const labelChanged = [...names].some((el) => el.textContent !== heatLabel);
  if (labelChanged) {
    names.forEach((el) => {
      el.style.filter = "blur(2px)";
      el.style.opacity = "0.55";
    });
    requestAnimationFrame(() => {
      names.forEach((el) => { el.textContent = heatLabel; });
      requestAnimationFrame(() => {
        names.forEach((el) => {
          el.style.filter = "";
          el.style.opacity = "";
        });
      });
    });
  } else {
    names.forEach((el) => { el.textContent = heatLabel; });
  }
  els.modelButton?.setAttribute("title", heatLabel);
}
const CONTEXT_LIMIT_TOKENS = 256000;
const LONG_PASTE_MIN_CHARS = 1000;
const LONG_PASTE_MIN_LINES = 8;
const LONG_PASTE_MAX_CHARS = 95000;

const APPEARANCES = new Set(["light", "dark", "system"]);
const COLOR_PRESETS = new Set(["default", "indigo", "emerald", "rose", "ocean", "violet", "teal", "amber"]);
const HOME_WALLPAPERS = new Set(["none", "clouds", "alpine", "valley", "launch"]);
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
  systemPrompt: "",
  thinkingEffort: DEFAULT_REASONING_EFFORT,
  spectrumLevel: 1,
  spectrumScale: 3,
  compareEnabled: false,
  compareModels: [],
  compareMode: "compare",
  agentMode: true,
  webSearchMode: "auto",
  writingStyle: "normal",
  provider: "openrouter",
  kluiModel: "",
  appearance: "system",
  colorPreset: "default",
  wallpaper: "clouds",
  showModelReasoning: true,
  weatherUnits: "metric",
  uiTextScale: 100
};

const state = {
  config: null,
  buildId: "",
  session: null,
  me: null,
  plans: [],
  paymentRequests: [],
  conversations: [],
  projects: [],
  projectsOpen: false,
  studyOpen: false,
  activeCourseId: "",
  activeCourseTab: "materials",
  studyMaterials: null,
  studyPractice: null,
  studyProjectDetail: null,
  studyUploading: false,
  activeProjectId: "",
  activeProject: null,
  projectUploading: false,
  projectSearch: "",
  projectSort: "updated",
  pinnedChatIds: [],
  activeConversationId: "",
  temporaryChat: false,
  researchMode: false,
  clarification: null,
  clarificationChecking: false,
  clarificationRequestId: 0,
  activeResearchId: "",
  researchReport: null,
  messages: [],
  conversationLoading: false,
  models: [],
  settings: loadSettings(),
  images: [],
  pastedText: "",
  followUps: [],
  composerSkills: [],
  composerSkillIds: [],
  skillMenu: { open: false, query: "", start: 0, end: 0, active: 0, composing: false },
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
  storage: null,
  memory: null,
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
    officeUrl: "",
    officeConfig: null,
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
let voiceRecorder = null;
let voiceStream = null;
let voiceChunks = [];
let voiceState = "idle";
let voiceCommit = true;
let availableAppUpdate = null;
let pendingNativeConversationId = "";
let webBuildCheckPromise = null;
let webBuildPollTimer = null;
let paymentRequestsPromise = Promise.resolve();
let researchController;
let studyHub = {
  closeSession() {},
  handleEscape() { return false; },
  render() {}
};
let studyHubPromise;
let compareController;
let councilController;
let adminPanel;
let selectedTextContext = null;
const sideChatState = {
  context: "",
  messages: [],
  running: false,
  abortController: null,
  autoScroll: true,
  touchY: 0,
  flashcard: false,
  role: "",
  onAddToCard: null,
  added: new Set()
};

/** One in-flight client run per conversation (or temporary chat). */
const TEMPORARY_RUN_KEY = "__temporary__";
const conversationRuns = new Map();
const conversationCache = new Map();
let conversationLoadGeneration = 0;

function rememberConversation(id, messages) {
  if (!id) return;
  conversationCache.set(id, { messages: messages || [] });
  if (conversationCache.size > 30) conversationCache.delete(conversationCache.keys().next().value); // ponytail: FIFO eviction, LRU if it ever matters
}

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
    followUps: isRunKeyActive(key) ? state.followUps.slice() : [],
    turnRunId: "",
    turnWaiting: false,
    cancelRequested: false,
    cancelResult: null,
    userMessage: null,
    assistantMessage: null,
    draft: null
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
  if (state.activeConversationId && !state.temporaryChat && !state.conversationLoading) {
    rememberConversation(state.activeConversationId, state.messages);
  }
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
  sidebarCloseButton: document.querySelector("#sidebarCloseButton"),
  newChatButton: document.querySelector("#newChatButton"),
  searchChatsButton: document.querySelector("#searchChatsButton"),
  projectsButton: document.querySelector("#projectsButton"),
  studyHubButton: document.querySelector("#studyHubButton"),
  pinnedChatsButton: document.querySelector("#pinnedChatsButton"),
  pinnedPopup: document.querySelector("#pinnedPopup"),
  pinnedPopupList: document.querySelector("#pinnedPopupList"),
  pinnedSection: document.querySelector("#pinnedSection"),
  pinnedConversationList: document.querySelector("#pinnedConversationList"),
  sidebarMid: document.querySelector("#sidebarMid"),
  searchDialog: document.querySelector("#searchDialog"),
  searchChatInput: document.querySelector("#searchChatInput"),
  searchChatResults: document.querySelector("#searchChatResults"),
  searchChatStatus: document.querySelector("#searchChatStatus"),
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
  profileMenuStorage: document.querySelector("#profileMenuStorage"),
  profileMenuAdmin: document.querySelector("#profileMenuAdmin"),
  profileMenuSignOut: document.querySelector("#profileMenuSignOut"),
  conversationList: document.querySelector("#conversationList"),
  messages: document.querySelector("#messages"),
  projectView: document.querySelector("#projectView"),
  studyView: document.querySelector("#studyView"),
  studySession: document.querySelector("#studySession"),
  studyNoteOverlay: document.querySelector("#studyNoteOverlay"),
  studyNoteTitle: document.querySelector("#studyNoteTitle"),
  studyNoteBody: document.querySelector("#studyNoteBody"),
  studyNoteClose: document.querySelector("#studyNoteClose"),
  studyNoteCopy: document.querySelector("#studyNoteCopy"),
  studyNoteDownload: document.querySelector("#studyNoteDownload"),
  studyNoteDownloadMenu: document.querySelector("#studyNoteDownloadMenu"),
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
  attachmentModelNotice: document.querySelector("#attachmentModelNotice"),
  attachmentModelNoticeClose: document.querySelector("#attachmentModelNoticeClose"),
  clarificationCard: document.querySelector("#clarificationCard"),
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
  composerBeam: document.querySelector(".composer-beam"),
  composerArea: document.querySelector(".composer-area"),
  composerHomeAnchor: document.querySelector("#composerHomeAnchor"),
  followupQueue: document.querySelector("#followupQueue"),
  imageFileInput: document.querySelector("#imageFileInput"),
  cameraFileInput: document.querySelector("#cameraFileInput"),
  projectFileInput: document.querySelector("#projectFileInput"),
  studyFileInput: document.querySelector("#studyFileInput"),
  projectCreateDialog: document.querySelector("#projectCreateDialog"),
  projectCreateForm: document.querySelector("#projectCreateForm"),
  projectNameInput: document.querySelector("#projectNameInput"),
  projectCreateCancel: document.querySelector("#projectCreateCancel"),
  courseCreateDialog: document.querySelector("#courseCreateDialog"),
  courseCreateForm: document.querySelector("#courseCreateForm"),
  courseNameInput: document.querySelector("#courseNameInput"),
  courseTermInput: document.querySelector("#courseTermInput"),
  courseCreateCancel: document.querySelector("#courseCreateCancel"),
  studyCreateDialog: document.querySelector("#studyCreateDialog"),
  studyCreateForm: document.querySelector("#studyCreateForm"),
  studyCreateTitle: document.querySelector("#studyCreateTitle"),
  studyCreateHint: document.querySelector("#studyCreateHint"),
  studyCreateSearch: document.querySelector("#studyCreateSearch"),
  studyCreateList: document.querySelector("#studyCreateList"),
  studyCreateActions: document.querySelector("#studyCreateActions"),
  studyCreateCancel: document.querySelector("#studyCreateCancel"),
  courseRenameDialog: document.querySelector("#courseRenameDialog"),
  courseRenameForm: document.querySelector("#courseRenameForm"),
  courseRenameNameInput: document.querySelector("#courseRenameNameInput"),
  courseRenameTermInput: document.querySelector("#courseRenameTermInput"),
  courseRenameCancel: document.querySelector("#courseRenameCancel"),
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
  skillCommandMenu: document.querySelector("#skillCommandMenu"),
  composerSkillChips: document.querySelector("#composerSkillChips"),
  imageToggle: document.querySelector("#imageToggle"),
  deepResearchToggle: document.querySelector("#deepResearchToggle"),
  researchModeChip: document.querySelector("#researchModeChip"),
  researchModeClose: document.querySelector("#researchModeClose"),
  sendButton: document.querySelector("#sendButton"),
  voiceButton: document.querySelector("#voiceButton"),
  stopButton: document.querySelector("#stopButton"),
  settingsReasoningSection: document.querySelector("#settingsReasoningSection"),
  settingsSystemPromptSection: document.querySelector("#settingsSystemPromptSection"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  settingsTabs: document.querySelector("#settingsTabs"),
  settingsTitle: document.querySelector("#settingsTitle"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  systemPromptInput: document.querySelector("#systemPromptInput"),
  showModelReasoningInput: document.querySelector("#showModelReasoningInput"),
  saveSystemPromptButton: document.querySelector("#saveSystemPromptButton"),
  textScaleInput: document.querySelector("#textScaleInput"),
  textScaleValue: document.querySelector("#textScaleValue"),
  appearancePill: document.querySelector("#appearancePill"),
  wallpaperPicker: document.querySelector("#wallpaperPicker"),
  homeWallpaper: document.querySelector("#homeWallpaper"),
  colorPresetRow: document.querySelector("#colorPresetRow"),
  settingsStorageSection: document.querySelector("#settingsStorageSection"),
  settingsStorageValue: document.querySelector("#settingsStorageValue"),
  settingsStorageLeft: document.querySelector("#settingsStorageLeft"),
  settingsStorageTrack: document.querySelector("#settingsStorageTrack"),
  settingsStorageFill: document.querySelector("#settingsStorageFill"),
  settingsStorageList: document.querySelector("#settingsStorageList"),
  settingsAccountFields: document.querySelector("#settingsAccountFields"),
  settingsAccountName: document.querySelector("#settingsAccountName"),
  settingsAccountEmail: document.querySelector("#settingsAccountEmail"),
  settingsAccountGuest: document.querySelector("#settingsAccountGuest"),
  settingsAccountCancelRow: document.querySelector("#settingsAccountCancelRow"),
  cancelSubscriptionButton: document.querySelector("#cancelSubscriptionButton"),
  deleteAccountButton: document.querySelector("#deleteAccountButton"),
  exportAccountButton: document.querySelector("#exportAccountButton"),
  memoryEnabledInput: document.querySelector("#memoryEnabledInput"),
  memoryContentInput: document.querySelector("#memoryContentInput"),
  memoryEditor: document.querySelector("#memoryEditor"),
  memoryEmpty: document.querySelector("#memoryEmpty"),
  memoryNotice: document.querySelector("#memoryNotice"),
  saveMemoryButton: document.querySelector("#saveMemoryButton"),
  clearMemoryButton: document.querySelector("#clearMemoryButton"),
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
  spectrumPop: document.querySelector("#spectrumPop"),
  spectrumTrack: document.querySelector("#spectrumTrack"),
  spectrumFill: document.querySelector("#spectrumFill"),
  spectrumSteps: document.querySelector("#spectrumSteps"),
  spectrumThumb: document.querySelector("#spectrumThumb"),
  heatFill: document.querySelector("#heatFill"),
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
  renameTitle: document.querySelector("#renameTitle"),
  renameChatInput: document.querySelector("#renameChatInput"),
  renameCancelButton: document.querySelector("#renameCancelButton"),
  renameSaveButton: document.querySelector("#renameSaveButton"),
  overlay: document.querySelector("#overlay"),
  toast: document.querySelector("#toast"),
  appUpdateToast: document.querySelector("#appUpdateToast"),
  appUpdateReload: document.querySelector("#appUpdateReload"),
  lightbox: document.querySelector("#lightbox"),
  lightboxClose: document.querySelector("#lightboxClose"),
  lightboxImg: document.querySelector("#lightboxImg"),
  lightboxCaption: document.querySelector("#lightboxCaption"),
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

function courseIdFromLocation() {
  const match = window.location.pathname.match(/^\/study\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function studyRouteFromLocation() {
  return window.location.pathname === "/study" || Boolean(courseIdFromLocation());
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

function syncStudyUrl({ replace = false } = {}) {
  if (suppressUrlSync) return;
  const target = state.activeCourseId ? `/study/${encodeURIComponent(state.activeCourseId)}` : "/study";
  if (window.location.pathname === target) return;
  window.history[replace ? "replaceState" : "pushState"]({ courseId: state.activeCourseId || "" }, "", target);
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
  const showTempToggle = !state.projectsOpen && !state.studyOpen && (onEmptyChat || state.temporaryChat);
  els.temporaryChatBar?.classList.toggle("hidden", !showTempToggle);
  els.temporaryChatToggle?.classList.toggle("hidden", !showTempToggle);
  els.temporaryChatLabel?.classList.toggle("hidden", state.projectsOpen || state.studyOpen || !state.temporaryChat);
  if (els.temporaryChatToggle) {
    els.temporaryChatToggle.classList.toggle("active", state.temporaryChat);
    els.temporaryChatToggle.setAttribute("aria-pressed", String(state.temporaryChat));
    els.temporaryChatToggle.setAttribute("title", state.temporaryChat ? "Temporary chat is on" : "Temporary chat");
  }
  if (els.imageToggle) els.imageToggle.disabled = state.running;
}

function renderResearchMode() {
  const available = Boolean(state.config?.services?.research);
  els.deepResearchToggle?.classList.toggle("hidden", !available);
  els.researchModeChip?.classList.toggle("hidden", !state.researchMode);
  els.deepResearchToggle?.classList.toggle("active", state.researchMode);
  els.deepResearchToggle?.setAttribute("aria-pressed", String(state.researchMode));
  if (els.deepResearchToggle) els.deepResearchToggle.disabled = state.running || !available;
  if (els.imageToggle) els.imageToggle.disabled = state.running || state.researchMode;
}

function clearClarification() {
  state.clarification = null;
  state.clarificationChecking = false;
  state.clarificationRequestId += 1;
  els.clarificationCard?.classList.add("hidden");
  if (els.clarificationCard) els.clarificationCard.innerHTML = "";
  updateSendButton();
}

function renderClarification() {
  const card = els.clarificationCard;
  if (!card) return;
  if (state.clarificationChecking && !state.clarification) {
    card.classList.remove("hidden");
    card.innerHTML = `<div class="clarification-loading"><span></span>Checking whether one detail would help…</div>`;
    return;
  }
  const flow = state.clarification;
  if (!flow?.questions?.length) {
    card.classList.add("hidden");
    card.innerHTML = "";
    return;
  }
  const question = flow.questions[flow.index];
  const selected = flow.selections[flow.index];
  const custom = selected === question.options.length;
  const optionMarkup = question.options.map((option, index) => `
    <button class="clarification-option${selected === index ? " selected" : ""}" type="button" data-clarification-option="${index}" aria-pressed="${selected === index}">
      <span class="clarification-key">${String.fromCharCode(65 + index)}</span>
      <span class="clarification-option-copy">${index === 0 ? "<small>Recommended</small>" : ""}${escapeHtml(option)}</span>
    </button>`).join("");
  const customIndex = question.options.length;
  card.classList.remove("hidden");
  card.innerHTML = `
    <header class="clarification-header">
      <span>Questions</span>
      <nav aria-label="Question navigation">
        <button type="button" data-clarification-back aria-label="Previous question" ${flow.index === 0 ? "disabled" : ""}>‹</button>
        <span>${flow.index + 1} of ${flow.questions.length}</span>
        <button type="button" data-clarification-next aria-label="Next question">›</button>
      </nav>
    </header>
    <div class="clarification-body">
      <h2>${escapeHtml(question.question)}</h2>
      <div class="clarification-options" role="group" aria-label="${escapeHtml(question.question)}">
        ${optionMarkup}
        <button class="clarification-option${custom ? " selected" : ""}" type="button" data-clarification-option="${customIndex}" aria-pressed="${custom}">
          <span class="clarification-key">${String.fromCharCode(65 + customIndex)}</span>
          <span class="clarification-option-copy">No, tell it differently</span>
        </button>
      </div>
      ${custom ? `<textarea class="clarification-custom" rows="2" placeholder="Tell Klui what you prefer…" aria-label="Your own answer">${escapeHtml(flow.answers[flow.index] || "")}</textarea>` : ""}
    </div>
    <footer class="clarification-footer">
      <button class="clarification-skip" type="button" data-clarification-skip>Skip</button>
      <button class="clarification-continue" type="button" data-clarification-continue ${custom && !flow.answers[flow.index]?.trim() ? "disabled" : ""}>Continue <span aria-hidden="true">↵</span></button>
    </footer>`;
  if (custom) window.requestAnimationFrame(() => card.querySelector(".clarification-custom")?.focus());
}

async function maybeRequestClarifications(text, paste) {
  const requestId = ++state.clarificationRequestId;
  state.clarificationChecking = true;
  renderClarification();
  updateSendButton();
  try {
    const payload = await requestClarifications(state.session, {
      query: text
    });
    if (requestId !== state.clarificationRequestId) return true;
    const questions = Array.isArray(payload?.questions) ? payload.questions : [];
    state.clarificationChecking = false;
    if (!questions.length) {
      renderClarification();
      updateSendButton();
      return false;
    }
    state.clarification = {
      text,
      paste,
      questions,
      index: 0,
      selections: questions.map(() => 0),
      answers: questions.map((question) => question.options[0])
    };
    renderClarification();
    updateSendButton();
    return true;
  } catch {
    if (requestId === state.clarificationRequestId) clearClarification();
    return false;
  }
}

function selectClarificationOption(index) {
  const flow = state.clarification;
  const question = flow?.questions?.[flow.index];
  if (!question || index < 0 || index > question.options.length) return;
  flow.selections[flow.index] = index;
  flow.answers[flow.index] = index < question.options.length ? question.options[index] : "";
  renderClarification();
}

function continueClarification() {
  const flow = state.clarification;
  if (!flow) return;
  if (!flow.answers[flow.index]?.trim()) return;
  if (flow.index < flow.questions.length - 1) {
    flow.index += 1;
    renderClarification();
    return;
  }
  const details = flow.questions
    .map((question, index) => `- ${question.question} ${flow.answers[index]}`)
    .join("\n");
  const text = [flow.text, `Clarifications:\n${details}`].filter(Boolean).join("\n\n");
  clearClarification();
  void sendPrompt({
    textOverride: text,
    displayTextOverride: flow.text,
    pasteOverride: flow.paste,
    skipClarification: true
  });
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

const HUMANIZER_ICON_SVG = '<svg viewBox="0 0 45 46" aria-hidden="true"><defs><mask id="humanizer-cut"><rect width="45" height="46" fill="#fff"/><path d="M7 40 38 6" stroke="#000" stroke-width="4.2" stroke-linecap="round"/></mask></defs><path d="M21.5 7.86C21.79 8.63 22.07 9.4 22.36 10.17C24.69 10.55 27.57 9.69 29.66 11.19C32.33 13.1 31.43 21.34 29.74 23.58C29.12 24.4 27.81 24.86 27.03 25.5C29.74 28.1 31.54 29.05 32.13 33.15C32.28 34.16 32.99 35.07 32.17 35.85C29.92 35.96 30.45 33.14 29.91 31.55C29.62 30.72 28.31 28.8 27.64 28.2C23.4 24.4 16.24 25.36 13.14 29.96C11.86 31.85 12.1 34.6 10.5 36.16C6.91 34.03 12.74 27.12 14.93 25.5C14.12 24.9 12.86 24.39 12.24 23.59C10.22 20.97 9.6 13.41 12.42 11.26C14.4 9.74 17.39 10.54 19.64 10.17C20.26 8.84 19.78 8.03 21.5 7.86ZM14.6 12.49C12.12 13.31 12.23 19.68 13.33 21.49C15.14 24.5 18.6 23.31 21.46 23.48C23.92 23.62 27.21 24.1 28.74 21.58C29.29 20.67 29.12 19.2 29.16 18.17C29.22 16.79 29.63 14.3 28.66 13.17C27.77 12.12 26.39 12.3 25.17 12.3C22.99 12.3 16.22 11.94 14.6 12.49ZM18.5 16.5C18.26 18.61 16.07 18.46 16.17 16.33C17.13 15.79 17.59 15.86 18.5 16.5ZM25.9 16.36C25.9 16.82 25.9 17.29 25.9 17.75C24.44 18.33 23.67 18.09 23.5 16.5C24.42 15.93 24.91 15.92 25.9 16.36Z" fill="currentColor" fill-rule="evenodd" mask="url(#humanizer-cut)"/><path d="M7 40 38 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
const ILLUSTRATION_ICON_SVG = '<svg viewBox="2 3.6 20 16.8" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.2" y="5" width="17.6" height="14" rx="3.2"/><circle cx="16.2" cy="9.35" r="1.55"/><path d="M4.45 16.4 9.15 11.45l3.15 3.15 2.4-2.8 4.85 4.55"/></svg>';
const VISUALIZE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="4"/><path d="m8 15 3.1-3.1 2.4 2.1 3.7-5"/><circle cx="17.5" cy="7.5" r="1" fill="currentColor" stroke="none"/></svg>';
const DEFAULT_SKILL_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5 12 8l2.5 2.5"/></svg>';

function composerSkillById(id) {
  return state.composerSkills.find((skill) => skill.id === id) || null;
}

function skillDisplayName(skill) {
  return String(skill?.name || skill?.id || "").trim();
}

function skillIconMarkup(id) {
  if (id === "humanizer") return HUMANIZER_ICON_SVG;
  if (id === "illustration") return ILLUSTRATION_ICON_SVG;
  if (id === "visualize") return VISUALIZE_ICON_SVG;
  return DEFAULT_SKILL_ICON_SVG;
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function normalizeClientSkillIds(value) {
  const known = new Set(state.composerSkills.map((skill) => skill.id));
  const seen = new Set();
  const out = [];
  let exclusive = "";
  for (const item of Array.isArray(value) ? value.slice(0, 16) : []) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    if (composerSkillById(id)?.exclusive) {
      if (!exclusive) exclusive = id;
      continue;
    }
    if (out.length < 3) out.push(id);
  }
  return exclusive ? [exclusive] : out;
}

function mergeComposerSkillIds(...lists) {
  return normalizeClientSkillIds(lists.flat());
}

function normalizeClientSkillMarks(value, skillIds, textLength = 100000) {
  const allowed = new Set(normalizeClientSkillIds(skillIds));
  const seen = new Set();
  const out = [];
  for (const mark of Array.isArray(value) ? value.slice(0, 16) : []) {
    const id = String(mark?.id || "").trim();
    const at = Number(mark?.at);
    if (!allowed.has(id) || seen.has(id) || !Number.isInteger(at)) continue;
    seen.add(id);
    out.push({ id, at: Math.max(0, Math.min(textLength, at)) });
  }
  return out;
}

function composerPlainText(root = els.promptInput) {
  if (!root) return "";
  let out = "";
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue || "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.dataset?.skillId) return;
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out.replace(/\u00a0/g, " ");
}

function composerSkillMarks(root = els.promptInput) {
  let at = 0;
  const marks = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      at += (node.nodeValue || "").length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const id = node.dataset?.skillId;
    if (id) {
      marks.push({ id, at });
      return;
    }
    if (node.tagName === "BR") {
      at += 1;
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return marks;
}

function composerSnapshot() {
  const raw = composerPlainText();
  const lead = (raw.match(/^\s*/) || [""])[0].length;
  const text = raw.trim();
  const marks = composerSkillMarks().map((mark) => ({
    id: mark.id,
    at: Math.max(0, Math.min(text.length, mark.at - lead))
  }));
  return { text, marks };
}

function createSkillTokenEl(skill) {
  const token = document.createElement("button");
  token.type = "button";
  token.className = "composer-skill-token";
  token.dataset.skillId = skill.id;
  token.contentEditable = "false";
  token.setAttribute("aria-label", `Remove ${skillDisplayName(skill)}`);
  token.title = `Remove ${skillDisplayName(skill)}`;
  const icon = document.createElement("span");
  icon.className = "composer-skill-token-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = skillIconMarkup(skill.id);
  const label = document.createElement("span");
  label.textContent = skillDisplayName(skill);
  token.append(icon, label);
  token.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    token.remove();
    syncComposerSkillState();
    els.promptInput?.focus();
  });
  return token;
}

function setComposerPlainText(text, marks = []) {
  const root = els.promptInput;
  if (!root) return;
  const value = String(text || "");
  const placed = [];
  const used = new Set();
  for (const mark of Array.isArray(marks) ? marks : []) {
    const id = String(mark?.id || "").trim();
    if (!composerSkillById(id) || used.has(id)) continue;
    used.add(id);
    const at = Number(mark.at);
    placed.push({
      id,
      at: Number.isInteger(at) ? Math.max(0, Math.min(value.length, at)) : 0
    });
  }
  placed.sort((a, b) => a.at - b.at);
  root.replaceChildren();
  let cursor = 0;
  for (const mark of placed) {
    if (mark.at > cursor) root.append(value.slice(cursor, mark.at));
    const skill = composerSkillById(mark.id);
    if (skill) root.appendChild(createSkillTokenEl(skill));
    cursor = mark.at;
  }
  if (cursor < value.length) root.append(value.slice(cursor));
  syncComposerSkillState();
  updateComposerPlaceholder();
}

function syncComposerSkillState() {
  state.composerSkillIds = normalizeClientSkillIds(composerSkillMarks().map((mark) => mark.id));
  updateComposerPlaceholder();
}

function setComposerSkillIds(ids, marks) {
  const next = normalizeClientSkillIds(ids);
  const text = composerPlainText();
  const existing = composerSkillMarks().filter((mark) => next.includes(mark.id));
  const nextMarks = Array.isArray(marks) && marks.length
    ? marks
    : (existing.length === next.length ? existing : next.map((id) => ({ id, at: 0 })));
  setComposerPlainText(text, nextMarks);
}

function clearComposerSkills() {
  els.promptInput?.querySelectorAll("[data-skill-id]").forEach((el) => el.remove());
  syncComposerSkillState();
  closeSkillMenu();
}

function renderComposerSkillChips() {
  syncComposerSkillState();
}

function placeCaretAfter(node) {
  const root = els.promptInput;
  if (!root || !node) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertComposerText(text) {
  const root = els.promptInput;
  if (!root || !text) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !root.contains(selection.anchorNode)) {
    root.append(text);
  } else {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    placeCaretAfter(node);
  }
  updateComposerPlaceholder();
}

function composerCaretBeforeText() {
  const root = els.promptInput;
  const selection = window.getSelection();
  if (!root || !selection?.rangeCount) return null;
  const caret = selection.getRangeAt(0);
  if (!caret.collapsed || !root.contains(caret.startContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(caret.startContainer, caret.startOffset);
  return composerPlainText({ childNodes: pre.cloneContents().childNodes, nodeType: Node.ELEMENT_NODE, dataset: {} });
}

function rangeFromComposerOffsets(start, end) {
  const root = els.promptInput;
  const range = document.createRange();
  if (!root) return range;
  let pos = 0;
  let started = false;
  const walk = (node) => {
    if (started && range.endContainer !== root) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const next = pos + (node.nodeValue || "").length;
      if (!started && start <= next) {
        range.setStart(node, Math.max(0, start - pos));
        started = true;
      }
      if (started && end <= next) {
        range.setEnd(node, Math.max(0, end - pos));
        return;
      }
      pos = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.dataset?.skillId) return;
    if (node.tagName === "BR") {
      if (!started && start <= pos + 1) {
        range.setStartBefore(node);
        started = true;
      }
      if (started && end <= pos + 1) {
        range.setEndAfter(node);
        return;
      }
      pos += 1;
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  if (!started) {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  return range;
}

function animateSkillDrop(skillId, fromRect) {
  const token = els.promptInput?.querySelector(`[data-skill-id="${skillId}"]`);
  if (!token || !fromRect || prefersReducedMotion()) return;
  const to = token.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const ghost = token.cloneNode(true);
  ghost.classList.add("composer-skill-token-fly");
  ghost.tabIndex = -1;
  ghost.style.left = `${fromRect.left}px`;
  ghost.style.top = `${fromRect.top}px`;
  ghost.style.width = `${fromRect.width}px`;
  ghost.style.height = `${fromRect.height}px`;
  document.body.appendChild(ghost);
  token.classList.add("is-landing");
  const dx = to.left - fromRect.left;
  const dy = to.top - fromRect.top;
  const sx = to.width / fromRect.width;
  const sy = to.height / fromRect.height;
  const motion = ghost.animate([
    { transform: "translate(0, 0) scale(1)", opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 1 }
  ], {
    duration: 220,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    fill: "forwards"
  });
  const finish = () => {
    ghost.remove();
    token.classList.remove("is-landing");
  };
  motion.finished.then(finish).catch(finish);
}

function filteredSkillRows() {
  const query = String(state.skillMenu.query || "").toLowerCase();
  return state.composerSkills.filter((skill) => {
    if (!query) return true;
    return String(skill.id || "").toLowerCase().startsWith(query)
      || String(skill.name || "").toLowerCase().startsWith(query);
  });
}

function slashQueryAtCaret() {
  const before = composerCaretBeforeText();
  if (before == null) return null;
  const match = before.match(/(^|\s)\/([a-z0-9-]*)$/i);
  if (!match) return null;
  const start = match.index + match[1].length;
  const end = before.length;
  return {
    start,
    end,
    query: match[2],
    range: rangeFromComposerOffsets(start, end)
  };
}

function closeSkillMenu() {
  if (!state.skillMenu.open && els.skillCommandMenu?.classList.contains("hidden")) {
    els.promptInput?.setAttribute("aria-expanded", "false");
    els.promptInput?.removeAttribute("aria-activedescendant");
    return;
  }
  state.skillMenu.open = false;
  state.skillMenu.query = "";
  state.skillMenu.active = 0;
  renderSkillCommandMenu();
}

function renderSkillCommandMenu() {
  const menu = els.skillCommandMenu;
  if (!menu) return;
  menu.replaceChildren();
  if (!state.skillMenu.open) {
    menu.classList.add("hidden");
    els.promptInput?.setAttribute("aria-expanded", "false");
    els.promptInput?.removeAttribute("aria-activedescendant");
    return;
  }
  const rows = filteredSkillRows();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "skill-command-empty";
    empty.textContent = "No matching skills";
    menu.appendChild(empty);
  } else {
    rows.forEach((skill, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `skill-option-${skill.id}`;
      option.setAttribute("role", "option");
      option.className = "skill-command-option";
      option.dataset.skillId = skill.id;
      const selected = state.composerSkillIds.includes(skill.id);
      if (index === state.skillMenu.active) option.classList.add("is-active");
      if (selected) option.classList.add("is-applied");
      option.setAttribute("aria-selected", String(index === state.skillMenu.active));
      const icon = document.createElement("span");
      icon.className = "skill-command-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = skillIconMarkup(skill.id);
      const name = document.createElement("span");
      name.className = "skill-command-name";
      name.textContent = skillDisplayName(skill);
      const desc = document.createElement("span");
      desc.className = "skill-command-desc";
      desc.textContent = skill.description;
      option.append(icon, name, desc);
      if (selected) {
        const check = document.createElement("span");
        check.className = "skill-command-check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = "✓";
        option.appendChild(check);
      }
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        selectComposerSkill(skill, option);
      });
      menu.appendChild(option);
    });
  }
  menu.classList.remove("hidden");
  els.promptInput?.setAttribute("aria-expanded", "true");
  const active = rows[state.skillMenu.active];
  if (active) {
    els.promptInput?.setAttribute("aria-activedescendant", `skill-option-${active.id}`);
    menu.querySelector(`#skill-option-${active.id}`)?.scrollIntoView({ block: "nearest" });
  } else {
    els.promptInput?.removeAttribute("aria-activedescendant");
  }
}

function syncSkillMenu() {
  const input = els.promptInput;
  if (!input || state.researchMode || !state.composerSkills.length || state.skillMenu.composing) {
    closeSkillMenu();
    return;
  }
  const found = slashQueryAtCaret();
  if (!found) {
    closeSkillMenu();
    return;
  }
  const queryChanged = !state.skillMenu.open || state.skillMenu.query !== found.query;
  state.skillMenu.open = true;
  state.skillMenu.query = found.query;
  state.skillMenu.start = found.start;
  state.skillMenu.end = found.end;
  if (queryChanged) state.skillMenu.active = 0;
  const rows = filteredSkillRows();
  if (state.skillMenu.active >= rows.length) state.skillMenu.active = Math.max(0, rows.length - 1);
  renderSkillCommandMenu();
}

function moveSkillActive(delta) {
  const rows = filteredSkillRows();
  if (!rows.length) return;
  state.skillMenu.active = (state.skillMenu.active + delta + rows.length) % rows.length;
  renderSkillCommandMenu();
}

function removeSlashQuery() {
  const found = slashQueryAtCaret() || (state.skillMenu.start != null && state.skillMenu.end != null
    ? { range: rangeFromComposerOffsets(state.skillMenu.start, state.skillMenu.end) }
    : null);
  found?.range?.deleteContents();
  applyComposerHeight();
  updateSendButton();
}

function selectComposerSkill(skill, fromEl) {
  if (!skill) return;
  if (skill.id === "illustration" && (state.temporaryChat || state.settings.compareEnabled)) {
    showToast("Illustration works in standard chat.");
    removeSlashQuery();
    closeSkillMenu();
    return;
  }
  if (skill.id === "visualize" && state.settings.compareEnabled) {
    showToast("Visualize works with one model at a time.");
    removeSlashQuery();
    closeSkillMenu();
    return;
  }
  if (state.composerSkillIds.includes(skill.id)) {
    removeSlashQuery();
    closeSkillMenu();
    return;
  }
  if (skill.exclusive) {
    state.composerSkillIds = [skill.id];
  } else if (state.composerSkillIds.some((id) => composerSkillById(id)?.exclusive)) {
    state.composerSkillIds = [skill.id];
  } else if (state.composerSkillIds.length >= 3) {
    showToast("You can use up to 3 skills per message.");
    return;
  } else {
    state.composerSkillIds = [...state.composerSkillIds, skill.id];
  }
  const fromRect = fromEl && !prefersReducedMotion() ? fromEl.getBoundingClientRect() : null;
  const found = slashQueryAtCaret() || {
    range: rangeFromComposerOffsets(state.skillMenu.start || 0, state.skillMenu.end || 0)
  };
  found.range?.deleteContents();
  if (skill.exclusive) {
    els.promptInput?.querySelectorAll("[data-skill-id]").forEach((el) => {
      if (el.dataset.skillId !== skill.id) el.remove();
    });
  } else {
    els.promptInput?.querySelectorAll("[data-skill-id]").forEach((el) => {
      if (composerSkillById(el.dataset.skillId)?.exclusive) el.remove();
    });
  }
  const token = createSkillTokenEl(skill);
  const insertAt = found?.range || (() => {
    const range = document.createRange();
    range.selectNodeContents(els.promptInput);
    range.collapse(false);
    return range;
  })();
  insertAt.insertNode(token);
  placeCaretAfter(token);
  syncComposerSkillState();
  closeSkillMenu();
  applyComposerHeight();
  updateSendButton();
  if (fromRect) animateSkillDrop(skill.id, fromRect);
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
  clearClarification();
  state.researchMode = next;
  if (next) closeSkillMenu();
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
    clearClarification();
    for (const message of state.messages) {
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        const url = part?.type === "image_url" ? part.image_url?.url : "";
        if (String(url).startsWith("blob:")) URL.revokeObjectURL(url);
      }
    }
    state.activeConversationId = "";
    state.messages = [];
    for (const item of state.images) forgetPendingDocument(item);
    state.images = [];
    state.pastedText = "";
    state.compareDescribeImages = false;
    stopPendingArtifactPolls();
    clearComposerSkills();
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
  return state.messages.some((message) => contentHasVisualOrDocument(message.content));
}

function pendingPromptNeedsVision(images = state.images) {
  return images.some((item) => item.category === "image" || item.category === "document");
}

function selectedModelMode() {
  return state.settings.modelMode === "pro" ? "pro" : "thinking";
}

function configRoles() {
  return Array.isArray(state.config?.roles) ? state.config.roles : [];
}

function roleLabel(id, fallback) {
  return configRoles().find((role) => role.id === id)?.label || fallback || id;
}

function selectedSingleRole() {
  const level = spectrumLevelFromSettings();
  if (level === 0) return "nitro";
  if (level === SPECTRUM_N - 1) return "pro";
  return "think";
}

function selectedChatRole() {
  if (state.settings.compareEnabled && state.settings.compareMode === "council") return "council";
  if (state.settings.compareEnabled) return "compare";
  return selectedSingleRole();
}

function chatRequestSettings() {
  const { systemPrompt } = state.settings;
  return { systemPrompt };
}

function modelModeLabel(mode = selectedModelMode()) {
  return mode === "pro" ? roleLabel("pro", "Pro") : roleLabel("think", "Think");
}

function composerPlaceholder() {
  if (state.composerSkillIds.length) return "";
  if (state.session && !hasChatAccess()) {
    return isNative() ? "Subscribe on the website to start chatting" : "Choose a plan to start chatting";
  }
  if (state.running) return "Send a follow up message";
  if (state.settings.compareEnabled) {
    return isCouncilMode() ? "Message Klui Council" : "Message Klui Compare";
  }
  if (state.projectsOpen && state.activeProjectId && !state.activeConversationId) {
    return `Message ${state.activeProject?.project?.name || "this project"}`;
  }
  if (state.studyOpen && state.activeCourseId && !state.activeConversationId) {
    return `Message ${state.studyProjectDetail?.project?.name || "this course"}`;
  }
  return "Ask Klui";
}

function updateComposerPlaceholder() {
  const input = els.promptInput;
  if (!input) return;
  const placeholder = composerPlaceholder();
  input.dataset.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder || "Message Klui");
  const empty = !composerPlainText().trim() && !state.composerSkillIds.length;
  input.classList.toggle("is-placeholder", empty && Boolean(placeholder));
}

function renderFollowUps() {
  const run = getConversationRun();
  if (run) run.followUps = state.followUps.slice();
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
  const snapshot = composerSnapshot();
  const text = snapshot.text;
  const images = state.images.filter((item) => item.category === "image");
  const blocked = state.images.some((item) => item.category !== "image");
  if (blocked) {
    showToast("Follow-up attachments can only be images while Klui is working.");
    return;
  }
  if (!text && !images.length) return;
  if (state.followUps.length >= 2) {
    showToast("You can queue up to 2 follow-up messages.");
    return;
  }
  state.followUps.push({
    id: `followup_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    text,
    images,
    skillIds: [...state.composerSkillIds],
    skillMarks: snapshot.marks
  });
  setComposerPlainText("");
  state.images = [];
  clearComposerSkills();
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
  item.skillMarks = normalizeClientSkillIds(item.skillIds).map((skillId) => ({ id: skillId, at: 0 }));
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

function drainFollowUps(limit = state.followUps.length) {
  const queued = state.followUps.splice(0, limit)
    .map((item) => ({
      text: item.text.trim(),
      images: Array.isArray(item.images) ? item.images : [],
      skillIds: normalizeClientSkillIds(item.skillIds),
      skillMarks: Array.isArray(item.skillMarks) ? item.skillMarks : []
    }))
    .filter((item) => item.text || item.images.length);
  renderFollowUps();
  updateSendButton();
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

function followUpBatchSkillMarks(queued) {
  const marks = [];
  let offset = 0;
  for (let index = 0; index < queued.length; index += 1) {
    const item = queued[index];
    const single = queued.length === 1;
    const prefix = single ? "" : `Follow-up ${index + 1}: `;
    const itemText = item.text || (single ? "Follow-up image" : "Image attached");
    for (const mark of item.skillMarks || []) {
      const at = Number(mark?.at);
      if (!Number.isInteger(at)) continue;
      marks.push({
        id: mark.id,
        at: offset + prefix.length + Math.max(0, Math.min(itemText.length, at))
      });
    }
    offset += prefix.length + itemText.length + (index < queued.length - 1 ? 2 : 0);
  }
  return marks;
}

function illustrationSendBlocked(skillIds, compareModels = []) {
  return normalizeClientSkillIds(skillIds).includes("illustration")
    && (state.temporaryChat || compareModels.length > 0);
}

function visualizeSendBlocked(skillIds, compareModels = []) {
  return normalizeClientSkillIds(skillIds).includes("visualize") && compareModels.length > 0;
}

function drainAutomaticFollowUps() {
  const next = state.followUps.slice(0, 1);
  const skillIds = mergeComposerSkillIds(...next.map((item) => item.skillIds));
  const images = followUpBatchImages(next);
  const compareModels = resolveCompareModelsForSend({ images });
  if (illustrationSendBlocked(skillIds, compareModels)) {
    showToast("Illustration works in standard chat.");
    return [];
  }
  if (visualizeSendBlocked(skillIds, compareModels)) {
    showToast("Visualize works with one model at a time.");
    return [];
  }
  return drainFollowUps(1);
}

function resolveRoutedModel({ images = state.images, userContent = null } = {}) {
  const needsVision = pendingPromptNeedsVision(images)
    || chatHistoryNeedsVision()
    || contentHasVisualOrDocument(userContent);
  // Vision/docs by spectrum level. Text uses SPECTRUM_STEPS model.
  if (needsVision) {
    const level = spectrumLevelFromSettings();
    if (level === SPECTRUM_N - 1) return OPENROUTER_PRO_MODEL;
    return OPENROUTER_VISION_MODEL;
  }
  if (state.settings.model) return state.settings.model;
  return spectrumLevelFromSettings() === SPECTRUM_N - 1
    ? OPENROUTER_PRO_MODEL
    : OPENROUTER_TEXT_MODEL;
}

function compareIncludesTextOnlyModels(modelIds) {
  return modelIds.some((id) => !modelSupportsVision(modelById(id) || { id }));
}

function resolveCompareModelsForSend({ images = state.images, userContent = null, keepAttachments = [] } = {}) {
  const base = compareController.activeCompareModelIds();
  if (!base.length) return base;
  const needsVision = pendingPromptNeedsVision(images)
    || chatHistoryNeedsVision()
    || contentHasVisualOrDocument(userContent)
    || keepAttachments.some((item) => item.category === "image" || item.category === "document");
  if (isCouncilMode()) return needsVision ? COUNCIL_MEDIA_MODELS.slice() : DEFAULT_COUNCIL_MODELS.slice();
  return needsVision ? COMPARE_MEDIA_MODELS.slice() : DEFAULT_COMPARE_MODELS.slice();
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
  const level = spectrumLevelFromSettings();
  return level === 0 ? "nitro" : level === SPECTRUM_N - 1 ? "pro" : "thinking";
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
  applySpectrumLevel(mode === "nitro" ? 0 : mode === "pro" ? SPECTRUM_N - 1 : 1);
}

function clampTextScale(value) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return 100;
  return Math.min(130, Math.max(85, num));
}

function loadGoogleFonts() {
  if (document.getElementById("kluiGoogleFonts")) return;
  const link = document.createElement("link");
  link.id = "kluiGoogleFonts";
  link.rel = "stylesheet";
  link.href = GOOGLE_FONTS_HREF;
  document.head.appendChild(link);
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const hadLegacyTheme = Object.hasOwn(stored, "theme");
    const loaded = { ...defaultSettings, ...stored };
    loaded.compareModels = Array.isArray(loaded.compareModels) ? loaded.compareModels.slice(0, 4) : [];
    loaded.compareEnabled = false;
    loaded.compareMode = loaded.compareMode === "council" ? "council" : "compare";
    loaded.agentMode = true;
    loaded.webSearchMode = loaded.webSearchMode === "off" ? "off" : "auto";
    loaded.writingStyle = normalizeWritingStyle(loaded.writingStyle);
    loaded.provider = "openrouter";
    loaded.modelMode = loaded.modelMode === "pro" ? "pro" : "thinking";
    loaded.thinkingEffort = normalizeThinkingEffort(loaded.thinkingEffort);
    const lvl = Number(loaded.spectrumLevel);
    loaded.spectrumLevel = stored.spectrumScale === 3
      ? (Number.isInteger(lvl) && lvl >= 0 && lvl < SPECTRUM_N ? lvl : 1)
      : ([0, 0, 1, 1, 2][lvl] ?? 1);
    loaded.spectrumScale = 3;
    loaded.model = SPECTRUM_STEPS[loaded.spectrumLevel].model;
    loaded.thinkingEffort = SPECTRUM_STEPS[loaded.spectrumLevel].effort;
    loaded.modelMode = SPECTRUM_STEPS[loaded.spectrumLevel].mode;
    loaded.kluiModel = typeof loaded.kluiModel === "string" ? loaded.kluiModel : "";
    delete loaded.theme;
    loaded.appearance = APPEARANCES.has(loaded.appearance) ? loaded.appearance : "system";
    loaded.colorPreset = COLOR_PRESETS.has(loaded.colorPreset) ? loaded.colorPreset : "default";
    loaded.wallpaper = HOME_WALLPAPERS.has(loaded.wallpaper) ? loaded.wallpaper : "clouds";
  loaded.showModelReasoning = loaded.showModelReasoning !== false;
  loaded.uiTextScale = clampTextScale(loaded.uiTextScale);
  if (hadLegacyTheme) localStorage.setItem(SETTINGS_KEY, JSON.stringify(loaded));
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

function applyAppearance() {
  const preset = COLOR_PRESETS.has(state.settings.colorPreset) ? state.settings.colorPreset : "default";
  const mode = resolvedAppearance();
  document.body.dataset.accent = preset;
  document.body.dataset.mode = mode;
  const wallpaper = HOME_WALLPAPERS.has(state.settings.wallpaper) ? state.settings.wallpaper : "clouds";
  document.body.dataset.wallpaper = wallpaper;
  const hasLightWallpaper = mode === "light" && ["clouds", "alpine", "valley", "launch"].includes(wallpaper);
  const darkClouds = mode === "dark" && wallpaper === "clouds";
  if (wallpaper !== "none") {
    const version = isNative() ? "" : darkClouds ? "?v=20260825-clouds-dark-v3" : "?v=20260825-clouds-b-1080";
    const wallpaperSrc = darkClouds
      ? `/images/home-clouds-dark-v3.webp${version}`
      : `/images/home-${wallpaper}${hasLightWallpaper ? "-light" : ""}.webp${version}`;
    const usesNightSky = mode === "dark" && ["alpine", "valley"].includes(wallpaper);
    document.body.style.setProperty("--home-wallpaper-image", `url("${wallpaperSrc}")`);
    document.body.style.setProperty(
      "--home-wallpaper-base",
      usesNightSky ? `url("/images/home-night-sky.webp${isNative() ? "" : "?v=20260723-1"}")` : "none",
    );
    const currentWallpaperPath = els.homeWallpaper ? new URL(els.homeWallpaper.src).pathname : "";
    const nextWallpaperPath = new URL(wallpaperSrc, window.location.href).pathname;
    if (els.homeWallpaper && currentWallpaperPath !== nextWallpaperPath) {
      els.homeWallpaper.src = wallpaperSrc;
    }
  } else {
    document.body.style.removeProperty("--home-wallpaper-image");
    document.body.style.removeProperty("--home-wallpaper-base");
  }
  applyCodeHighlightTheme(mode);
  syncAppearanceControls();
  googleButtonRenderKey = "";
  if (els.authDialog?.classList.contains("open")) renderAuthOptions();
  // Match the Android notification panel color to the chat surface so the
  // status bar visually merges into the top bar. We read the resolved
  // --bg from CSS so the StatusBar tracks every appearance and color preset.
  const nativeBg = (getComputedStyle(document.body).getPropertyValue("--bg") || "").trim()
    || (mode === "dark" ? "#1f1f1f" : "#ffffff");
  void configureNativeChrome({ dark: mode === "dark", background: nativeBg });
}

function applyTextScale() {
  void setTextZoom(clampTextScale(state.settings.uiTextScale));
}

function syncAppearanceControls() {
  const preset = COLOR_PRESETS.has(state.settings.colorPreset) ? state.settings.colorPreset : "default";
  const appearance = APPEARANCES.has(state.settings.appearance) ? state.settings.appearance : "system";
  if (els.appearancePill) {
    els.appearancePill.querySelectorAll("[data-appearance]").forEach((btn) => {
      btn.setAttribute("aria-checked", btn.dataset.appearance === appearance ? "true" : "false");
    });
  }
  if (els.wallpaperPicker) {
    els.wallpaperPicker.querySelectorAll("[data-wallpaper]").forEach((btn) => {
      btn.setAttribute("aria-checked", btn.dataset.wallpaper === state.settings.wallpaper ? "true" : "false");
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
  if (key === "appearance" || key === "colorPreset" || key === "wallpaper") applyAppearance();
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

function showWebBuildUpdate() {
  els.appUpdateToast?.classList.add("visible");
}

async function checkWebBuild({ force = false } = {}) {
  if (isNative() || !state.buildId || (!force && document.visibilityState !== "visible")) return false;
  if (webBuildCheckPromise) return webBuildCheckPromise;
  webBuildCheckPromise = fetchBuild()
    .then((payload) => {
      const nextBuildId = String(payload?.buildId || "");
      if (!nextBuildId || nextBuildId === state.buildId) return false;
      showWebBuildUpdate();
      return true;
    })
    .catch(() => false)
    .finally(() => {
      webBuildCheckPromise = null;
    });
  return webBuildCheckPromise;
}

function startWebBuildMonitor() {
  if (isNative() || webBuildPollTimer) return;
  const checkWhenVisible = () => {
    if (document.visibilityState === "visible") void checkWebBuild();
  };
  document.addEventListener("visibilitychange", checkWhenVisible);
  window.addEventListener("focus", checkWhenVisible);
  webBuildPollTimer = window.setInterval(checkWhenVisible, 5 * 60 * 1000);
  checkWhenVisible();
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
  return state.me?.access?.mode !== "testing" && Array.isArray(state.plans) && state.plans.length > 0;
}

function showPaywall({ allowReturn = false } = {}) {
  els.paywallEmail.textContent = state.me?.user?.email || "";
  renderPlans();
  els.paywallBackButton?.classList.toggle("hidden", !allowReturn);
  els.paywallCloseButton?.classList.toggle("hidden", !allowReturn);
  showOnly(els.paywallView);
}

function openUpgradePlans() {
  if (!state.session) return;
  closeProfileMenu();
  document.body.classList.remove("sidebar-open");
  closeAllDrawers();
  if (isNative()) {
    showToast("Subscribe on the website.");
    return;
  }
  if (!hasUpgradePlans()) return;
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
  if (guest) document.body.classList.add("sidebar-expanded");
  els.guestLoginPanel?.classList.toggle("hidden", !guest);
  renderAuthOptions();
  renderTemporaryChatMode();
  renderResearchMode();
  renderWritingStyle();
  renderComposerSkillChips();
  renderProjects();
  studyHub?.render();
  renderProjectChatCrumb();
  renderAdminOnlyControls();
  renderSettingsStorage();

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
    studyHub?.render();
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
    studyHub?.render();
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
  studyHub?.render();
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

  const renderKey = `${state.config.auth.googleClientId}:${els.googleButton.clientWidth || 0}:${resolvedAppearance()}`;
  if (googleButtonRenderKey === renderKey && els.googleButton.childElementCount) return;
  googleButtonRenderKey = renderKey;

  renderGoogleSignInButton(state.config, els.googleButton, {
    branded: true,
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
    pro: {
      tagline: "For regular everyday use",
      badge: "Most popular",
      usage: "3x more usage",
      features: ["Access to premium models", "Model compare", "Model council"]
    },
    max: {
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
      ${plan.checkout === "mamo" ? `
      <button class="plan-pay-btn" type="button" data-start-mamo="${escapeHtml(plan.id)}">
        Pay with Mamo
      </button>
      <p class="plan-payment-note">You'll be redirected to Mamo. Access starts after payment.</p>
      ` : `
      ${requestsByPlan.has(plan.id) ? renderPendingPayment(requestsByPlan.get(plan.id)) : ""}
      <button class="plan-pay-btn" type="button" data-start-payment="${escapeHtml(plan.id)}" ${plan.ziinaPaymentUrl || plan.ziinaQrImageUrl ? "" : "disabled"}>
        ${pending ? "Open Ziina payment" : "Pay with Ziina"}
      </button>
      ${plan.ziinaPaymentUrl || plan.ziinaQrImageUrl ? `<p class="plan-payment-note">Access activates after we verify your Ziina payment.</p>` : `<p class="plan-payment-note">Ziina link is not configured yet.</p>`}
      `}
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
  if (els.profileName) els.profileName.textContent = state.session ? (state.me?.user?.name || profileDisplayName(email)) : "";
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
  els.profileMenuUpgrade?.classList.toggle("hidden", isNative() || !hasUpgradePlans());
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

function openStorageDrawer() {
  if (!state.session) return;
  closeProfileMenu();
  document.body.classList.remove("sidebar-open");
  renderAccount();
  els.accountDrawer.classList.add("open");
  els.accountDrawer.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "account";
  loadMe()
    .then(() => {
      renderAccount();
      renderProfileMenu();
    })
    .catch(() => {});
}

function openAdminDrawer() {
  document.body.classList.remove("sidebar-open");
  openStorageDrawer();
}

function formatStorageBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  if (value < 1024 * 1024) return `${Math.max(0, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 * 1024 ? 0 : 1)} GB`;
}

function renderSettingsAccount() {
  const signedIn = Boolean(state.session);
  els.settingsAccountFields?.classList.toggle("hidden", !signedIn);
  els.settingsAccountGuest?.classList.toggle("hidden", signedIn);
  const sub = state.me?.subscription;
  const canCancel = signedIn
    && sub?.provider === "mamo"
    && ["active", "trialing", "past_due"].includes(sub?.status)
    && !sub?.cancelAtPeriodEnd;
  els.settingsAccountCancelRow?.classList.toggle("hidden", !canCancel);
  if (!signedIn) return;
  const email = state.me?.user?.email || "Signed in";
  if (els.settingsAccountName) els.settingsAccountName.textContent = state.me?.user?.name || profileDisplayName(email);
  if (els.settingsAccountEmail) els.settingsAccountEmail.textContent = email;
}

async function deleteAccountAndReset() {
  if (!state.session) return;
  try {
    await deleteAccount(state.session);
    await signOutAndReset();
    showToast("Account deleted.");
  } catch (error) {
    showToast(error.message || "Could not delete account.");
  }
}

async function downloadAccountDataAndSave() {
  if (!state.session) return;
  if (els.exportAccountButton) els.exportAccountButton.disabled = true;
  try {
    await downloadAccountData(state.session);
    showToast("Download started.");
  } catch (error) {
    showToast(error.message || "Could not download your data.");
  } finally {
    if (els.exportAccountButton) els.exportAccountButton.disabled = false;
  }
}

async function cancelMamoSubscriptionAndRefresh() {
  if (!state.session) return;
  try {
    await cancelMamoSubscription(state.session);
    await loadMe();
    renderSettingsAccount();
    showToast("Subscription will end at period end.");
  } catch (error) {
    showToast(error.message || "Could not cancel subscription.");
  }
}

function renderSettingsStorage() {
  if (!els.settingsStorageSection) return;
  const storage = state.me?.usage?.storage || {};
  const maxBytes = Number(storage.maxBytes || state.me?.plan?.maxStorageBytes || 0);
  const usedBytes = Math.max(0, Number(storage.usedBytes || 0));
  if (!state.session || maxBytes <= 0) return;
  const percent = Math.max(0, Math.min(100, Math.floor(Number(storage.percent || (usedBytes / maxBytes) * 100))));
  const value = `${formatStorageBytes(usedBytes)} of ${formatStorageBytes(maxBytes)} used`;
  els.settingsStorageValue.textContent = value;
  els.settingsStorageLeft.textContent = `${formatStorageBytes(Math.max(0, maxBytes - usedBytes))} left`;
  els.settingsStorageFill.style.width = `${percent}%`;
  els.settingsStorageTrack.setAttribute("aria-valuenow", String(percent));
  els.settingsStorageTrack.setAttribute("aria-valuetext", value);
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
  let total = estimateTextTokens(composerPlainText());
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

function storageItemWhere(item) {
  const where = item.conversationId
    ? (item.conversationTitle ? `Chat ${item.conversationTitle}` : "Chat")
    : item.projectId
      ? (item.projectName ? `Project ${item.projectName}` : "Project")
      : "Not in a chat";
  if (item.status && item.status !== "uploaded") return `${where} · Incomplete upload`;
  return where;
}

function storageItemById(id) {
  return (state.storage?.items || []).find((item) => item.id === id) || null;
}

async function loadAccountStorage() {
  if (!state.session || !els.settingsStorageList) return;
  try {
    state.storage = await fetchStorage(state.session);
    renderAccountStorageList();
  } catch (error) {
    els.settingsStorageList.innerHTML = `<p class="storage-list-empty">${escapeHtml(error.message || "Could not load files.")}</p>`;
  }
}

function refreshAccountStorage() {
  return loadMe()
    .then(() => {
      renderProfileMenu();
      renderSettingsStorage();
      if (els.accountDrawer.classList.contains("open")) renderAccount();
      return loadAccountStorage();
    })
    .catch(() => {});
}

function renderAccountStorageList() {
  if (!els.settingsStorageList) return;
  const items = state.storage?.items || [];
  if (!items.length) {
    els.settingsStorageList.innerHTML = `<p class="storage-list-empty">No files yet.</p>`;
    return;
  }
  els.settingsStorageList.innerHTML = items.map((item) => {
    const actions = item.canDelete
      ? `<button class="admin-small-btn danger" type="button" data-storage-delete-file="${escapeHtml(item.id)}">Delete</button>`
      : item.conversationId
        ? `<button class="admin-small-btn" type="button" data-storage-open-chat="${escapeHtml(item.id)}">Open chat</button>
           <button class="admin-small-btn danger" type="button" data-storage-delete-chat="${escapeHtml(item.id)}">Delete chat</button>`
        : "";
    return `
      <div class="storage-row">
        <div class="storage-row-copy">
          <strong>${escapeHtml(item.fileName || "File")}</strong>
          <small>${escapeHtml(formatStorageBytes(item.sizeBytes))} · ${escapeHtml(storageItemWhere(item))}</small>
        </div>
        <div class="storage-row-actions">${actions}</div>
      </div>`;
  }).join("");
}

function handleAccountStorageClick(event) {
  const deleteFile = event.target.closest("[data-storage-delete-file]");
  const openChat = event.target.closest("[data-storage-open-chat]");
  const deleteChat = event.target.closest("[data-storage-delete-chat]");
  if (!deleteFile && !openChat && !deleteChat) return;
  const item = storageItemById(
    deleteFile?.dataset.storageDeleteFile || openChat?.dataset.storageOpenChat || deleteChat?.dataset.storageDeleteChat
  );
  if (!item) return;

  if (openChat) {
    closeAccount();
    closeSettings();
    void openConversation(item.conversationId);
    return;
  }

  if (deleteFile) {
    const searchNote = item.projectId ? " This also deletes search data for that project file." : "";
    openDeleteConfirm({
      title: "Delete file?",
      body: `Remove "${item.fileName || "this file"}"?${searchNote}`,
      attachmentId: item.id
    });
    return;
  }

  if (!item.conversationId) return;
  const title = item.conversationTitle || "New chat";
  const others = Math.max(0, Number(item.siblingCount || 0) - 1);
  const extra = others
    ? ` This also deletes ${others} other file${others === 1 ? "" : "s"} in '${title}' (${formatStorageBytes(item.siblingBytes)} in that chat).`
    : "";
  openDeleteConfirm({
    title: "Delete chat?",
    body: `Delete "${title}" from your account?${extra}`,
    chatId: item.conversationId
  });
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
  const projects = [...(state.projects || []).filter((project) => project.kind !== "course")].sort((a, b) => state.projectSort === "name"
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
  const visible = Boolean(projectId && state.activeConversationId && !state.projectsOpen && !state.studyOpen && !state.temporaryChat);
  els.projectChatCrumb.classList.toggle("hidden", !visible);
  document.body.classList.toggle("project-chat-open", visible);
  if (!visible) return;
  const project = state.projects.find((item) => item.id === projectId)
    || (state.activeProject?.project?.id === projectId ? state.activeProject.project : null);
  const isCourse = project?.kind === "course";
  const name = project?.name || (isCourse ? "Course" : "Project");
  els.projectChatCrumb.dataset.projectId = isCourse ? "" : projectId;
  els.projectChatCrumb.dataset.courseId = isCourse ? projectId : "";
  els.projectChatCrumb.classList.toggle("study-chat-crumb", isCourse);
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
  clearClarification();
  studyHub.closeSession();
  state.temporaryChat = false;
  state.projectsOpen = true;
  state.studyOpen = false;
  state.activeCourseId = "";
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
  clearClarification();
  studyHub.closeSession();
  state.temporaryChat = false;
  state.projectsOpen = true;
  state.studyOpen = false;
  state.activeCourseId = "";
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
        void refreshAccountStorage();
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

let searchBodyTimer = 0;
let searchBodyRequestId = 0;
let searchBodyHits = [];
let searchBodyHitsQuery = "";
let searchBodyStatus = "idle";

function cancelSearchBody() {
  if (searchBodyTimer) {
    clearTimeout(searchBodyTimer);
    searchBodyTimer = 0;
  }
  searchBodyRequestId += 1;
  searchBodyHits = [];
  searchBodyHitsQuery = "";
  searchBodyStatus = "idle";
}

function bodySearchHits(query) {
  const trimmed = query.trim();
  if (trimmed.length < 2 || trimmed !== searchBodyHitsQuery) return [];
  return searchBodyHits;
}

function renderSearchResults(query = "") {
  if (!els.searchChatResults) return;
  const needle = query.trim().toLowerCase();
  const matches = sortedConversations().filter((conversation) => {
    const title = String(conversation.title || "New chat").toLowerCase();
    return !needle || title.includes(needle);
  });
  const titleIds = new Set(matches.map((conversation) => conversation.id));
  const bodyHits = bodySearchHits(query).filter((hit) => hit?.conversation_id && !titleIds.has(hit.conversation_id));
  const bodyStatus = query.trim() === searchBodyHitsQuery ? searchBodyStatus : "idle";
  const statusHtml = bodyStatus === "pending"
    ? `<div class="search-dialog-empty">Searching messages…</div>`
    : bodyStatus === "error"
      ? `<div class="search-dialog-empty">Message search is unavailable. Try again.</div>`
      : "";
  const emptyStatus = !matches.length && !bodyHits.length
    ? (needle ? "No chats found." : "No chats yet.")
    : "";
  const statusText = bodyStatus === "pending"
    ? "Searching messages…"
    : bodyStatus === "error"
      ? "Message search is unavailable. Try again."
      : emptyStatus;
  els.searchChatStatus?.setAttribute("aria-busy", bodyStatus === "pending" ? "true" : "false");
  if (els.searchChatStatus && els.searchChatStatus.textContent !== statusText) {
    els.searchChatStatus.textContent = statusText;
  }

  if (!matches.length && !bodyHits.length) {
    els.searchChatResults.innerHTML = statusHtml || `<div class="search-dialog-empty">${emptyStatus}</div>`;
    return;
  }

  const titleHtml = matches.map((conversation) => {
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

  const bodyHtml = bodyHits.length ? `
    <div class="search-result-section">Message matches</div>
    ${bodyHits.map((hit) => {
      const active = hit.conversation_id === state.activeConversationId ? "active" : "";
      return `
      <button class="search-result-row ${active}" type="button" data-open-chat-id="${escapeHtml(hit.conversation_id)}">
        <span class="search-result-icon">${CHAT_ICON_SVG}</span>
        <span class="search-result-copy">
          <span class="search-result-title">${escapeHtml(hit.title || "New chat")}</span>
          <span class="search-result-snippet">${escapeHtml(hit.snippet || "")}</span>
        </span>
        <span class="search-result-meta">${escapeHtml(formatChatAge(hit.matched_at))}</span>
      </button>
    `;
    }).join("")}
  ` : "";

  els.searchChatResults.innerHTML = titleHtml + bodyHtml + statusHtml;
}

async function fetchSearchBody(trimmed) {
  const requestId = ++searchBodyRequestId;
  try {
    const payload = await searchChats(state.session, trimmed);
    if (requestId !== searchBodyRequestId) return;
    if (!isSearchDialogOpen()) return;
    if ((els.searchChatInput?.value || "").trim() !== trimmed) return;
    searchBodyHits = Array.isArray(payload?.results) ? payload.results : [];
    searchBodyHitsQuery = trimmed;
    searchBodyStatus = "ready";
    renderSearchResults(els.searchChatInput.value);
  } catch {
    if (requestId !== searchBodyRequestId) return;
    if (!isSearchDialogOpen()) return;
    if ((els.searchChatInput?.value || "").trim() !== trimmed) return;
    searchBodyHits = [];
    searchBodyHitsQuery = trimmed;
    searchBodyStatus = "error";
    renderSearchResults(els.searchChatInput?.value || "");
  }
}

function scheduleSearchBody(query) {
  if (searchBodyTimer) {
    clearTimeout(searchBodyTimer);
    searchBodyTimer = 0;
  }
  const trimmed = query.trim();
  if (trimmed.length < 2 || !state.session) {
    searchBodyRequestId += 1;
    searchBodyHits = [];
    searchBodyHitsQuery = "";
    searchBodyStatus = "idle";
    return;
  }
  searchBodyHits = [];
  searchBodyHitsQuery = trimmed;
  searchBodyStatus = "pending";
  searchBodyTimer = setTimeout(() => {
    searchBodyTimer = 0;
    void fetchSearchBody(trimmed);
  }, 250);
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
  cancelSearchBody();
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
  clearClarification();
  researchController.stopResearchPolling();
  studyHub.closeSession();
  state.images = state.images.filter((item) => item.category !== "document");
  state.temporaryChat = false;
  let conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    conversation = (state.activeProject?.conversations || []).find((item) => item.id === conversationId)
      || (state.studyProjectDetail?.conversations || []).find((item) => item.id === conversationId)
      || null;
    if (conversation) state.conversations.unshift(conversation);
  }
  state.activeProjectId = conversation?.project_id || "";
  state.projectsOpen = false;
  state.studyOpen = false;
  state.activeProject = null;
  state.activeConversationId = conversationId;
  clearFollowUps();
  clearComposerSkills();
  document.body.classList.remove("sidebar-open");
  state.compareDescribeImages = false;
  stopPendingArtifactPolls();
  closeDocumentViewer();
  compareController.closeCompareContextBanner();
  closeSearchDialog();
  closePinnedPopup();
  closeConversationMenus();
  try {
    syncConversationUrl();
    if (!restoreLiveConversationRun(conversationId)) {
      state.messages = conversationCache.get(conversationId)?.messages || [];
      state.conversationLoading = !conversationCache.has(conversationId);
    } else {
      state.conversationLoading = false;
    }
    renderImages();
    renderShell();
    const loadResult = await loadActiveConversation();
    if (state.activeConversationId !== conversationId || loadResult !== "applied") return;
    state.conversationLoading = false;
    renderShell();
    await restorePendingDocuments();
  } catch (err) {
    if (state.activeConversationId === conversationId) {
      state.conversationLoading = false;
      renderShell();
    }
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
  if (id === OPENROUTER_COUNCIL_HY3_MODEL) return "Hy3";
  if (id === OPENROUTER_VISION_MODEL) return "MiMo";
  if (id === OPENROUTER_COUNCIL_MIMO_PRO_MODEL) return "MiMo Pro";
  if (id === OPENROUTER_PRO_MODEL) return "GPT-5.6 Luna";
  if (id === OPENROUTER_VISION_L2) return "Qwen 3.7 Flash";
  if (id === OPENROUTER_VISION_L3) return "Qwen 3.8 Flash";
  if (id === OPENROUTER_GLM_FLASH_MODEL) return "GLM 5.3 Flash";
  const model = modelById(id);
  return compactModelDisplayName(model?.name || model?.rawName || id) || id;
}

function toggleModelDropdown() {
  const open = !els.composerModelWrap.classList.contains("is-open");
  setSpectrumOpen(open);
}

function closeModelDropdown() {
  setSpectrumOpen(false);
}

function setSpectrumOpen(open) {
  const pop = els.spectrumPop;
  els.modelButton?.setAttribute("aria-expanded", String(open));
  els.composerModelWrap?.classList.toggle("is-open", open);
  if (!pop) return;
  if (open) {
    paintSpectrum();
    pop.hidden = false;
    requestAnimationFrame(() => pop.classList.add("open"));
  } else {
    pop.classList.remove("open");
    setTimeout(() => {
      if (!els.composerModelWrap?.classList.contains("is-open")) pop.hidden = true;
    }, 180);
  }
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
  const mobileSidebar = document.body.classList.contains("capacitor-native") || window.matchMedia("(max-width: 860px)").matches;
  if (document.body.classList.contains("guest-mode") && !mobileSidebar) return;
  if (mobileSidebar) {
    document.body.classList.toggle("sidebar-open");
    return;
  }
  document.body.classList.toggle("sidebar-expanded");
}

function renderModelCatalog() {
  // ponytail: Thinking/Pro list replaced by spectrum popover
}

function renderModelOptions() {
  const mode = selectedModelMode();
  const isPro = spectrumLevelFromSettings() === SPECTRUM_N - 1;
  const level = spectrumLevelFromSettings();
  const heatLabel = isPro ? "PRO" : level === 0 ? "Nitro" : "Think";
  els.modelButton?.setAttribute("aria-label", heatLabel);
  els.modelButton?.classList.toggle("pro-active", isPro);
  if (els.modelLabel) els.modelLabel.textContent = modelModeLabel(mode);
  els.modelPriceBadge?.classList.add("hidden");
  paintSpectrum();
  compareController.renderCompareControls();
}

/* ─── Messages ─── */

function normalizeMessage(msg) {
  return {
    ...msg,
    finishReason: msg.finishReason || msg.finish_reason || "",
    toolCalls: msg.toolCalls || msg.tool_calls || []
  };
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
            stage1Status: panelists.every((panelist) => panelist.finishReason || panelist.error) ? "done" : "active",
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

// Tool-loop "Let me look…" prose is not the final answer yet.
function isProvisionalToolProse(message) {
  if (message?.resetContentOnNextTextDelta) return true;
  if (message?.finishReason === "tool_calls") return true;
  if (
    isAssistantMessageStreaming(message)
    && (message?.toolCalls || []).some((tc) => tc?.function?.name || tc?.id)
    && !isFinalFinishReason(message?.finishReason)
  ) {
    return true;
  }
  return false;
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
  els.settingsReasoningSection?.classList.toggle("hidden", !admin);
  els.settingsSystemPromptSection?.classList.toggle("hidden", !admin);
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
  if (name === "get_weather") return "Checking weather";
  if (name === "web_search") return "Searching web";
  if (name === "read_url") return "Reading page";
  if (name === "search_document") return "Searching documents";
  if (name === "read_document") return "Reading document";
  if (name === "extract_tables") return "Reading tables";
  if (name === "create_document") return "Creating document";
  if (name === "edit_document") return "Editing document";
  if (name === "export_document") return "Exporting document";
  if (name === "load_tools") return "Preparing tools";
  if (name === "limit") return "Wrapping up";
  return "Working";
}

function toolTaskLabel(tool = {}) {
  const name = String(tool.name || "").toLowerCase();
  const query = String(tool.query || "").trim().replace(/\s+/g, " ");
  const detail = query.length > 46 ? `${query.slice(0, 43)}…` : query;
  if (name === "web_search") return detail ? `Searching for ${detail}` : "Searching the web";
  if (name === "read_url") {
    try {
      return `Reading ${new URL(query).hostname.replace(/^www\./i, "")}`;
    } catch {}
    return "Reading a source";
  }
  if (name === "get_weather") return "Checking the forecast";
  if (name === "search_document") return detail ? `Searching documents for ${detail}` : "Searching documents";
  if (["read_document", "extract_tables"].includes(name)) return "Reading your document";
  if (name === "load_tools") return "Preparing tools";
  if (["create_document", "edit_document", "export_document"].includes(name)) return toolStatusLabel(tool);
  return "Working on your request";
}

function currentThinkingUpdate(message, { streaming = false } = {}) {
  if (!streaming || isFinalFinishReason(message?.finishReason)) return "";
  const tools = Array.isArray(message?.toolEvents) ? message.toolEvents : [];
  const runningTool = [...tools].reverse().find((tool) => tool.status === "running");
  if (!runningTool) return null;
  return {
    key: String(runningTool.id || `${tools.length}:${runningTool.name}:${runningTool.query || ""}`),
    text: toolTaskLabel(runningTool)
  };
}

function currentThinkingStatus(message, { streaming = false } = {}) {
  if (message?.error) return "";
  if (message?.illustrationStatus) return message.illustrationStatus;
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
  if (rawTextContent(message?.content).trim() && !isProvisionalToolProse(message)) return "";
  const label = currentThinkingStatus(message, { streaming });
  if (!label) return "";
  const active = streaming && !isFinalFinishReason(message?.finishReason);
  const update = currentThinkingUpdate(message, { streaming });
  return renderKluiThinkingStatus(message, { label, update: update?.text, updateKey: update?.key, active });
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

const RELOADABLE_MESSAGE_ERRORS = new Set([
  "Failed to fetch",
  "Load failed",
  "NetworkError when attempting to fetch resource.",
  "This tab is out of date. Reload to continue."
]);

function renderMessageError(message) {
  const error = String(message.error || "");
  if (!error) return "";
  const reload = RELOADABLE_MESSAGE_ERRORS.has(error)
    ? `<button class="msg-action-btn message-error-reload" type="button" data-message-error-reload aria-label="Reload" title="Reload"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.3-8.6"/><path d="M21 3v5h-5"/></svg></button>`
    : "";
  return `<div class="message-error"><span>${escapeHtml(error)}</span>${reload}</div>`;
}

function isStoppedMessage(message) {
  return Boolean(message?.stopped || message?.error === "Stopped by user.");
}

function canRetryAssistant(message) {
  if (state.running) return false;
  if (message?.councilGroup || message?.compareGroup) return false;
  const id = message?.id ? String(message.id) : "";
  if (!id || id.startsWith("local_")) return false;
  if (isStoppedMessage(message)) return false;
  return true;
}

function renderMessageRetry(message) {
  if (!canRetryAssistant(message)) return "";
  const title = isIllustrationMessage(message) ? "Generate a new version (uses credits)" : "Retry";
  return `<button class="msg-action-btn msg-retry-btn" type="button" data-retry-assistant-id="${escapeHtml(String(message.id))}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button>`;
}

function isIllustrationMessage(message) {
  return Boolean(message?.metadata?.illustration);
}

function canAdjustAssistant(message) {
  if (isIllustrationMessage(message)) return false;
  if (!canRetryAssistant(message) || !rawTextContent(message.content).trim()) return false;
  const latest = [...state.messages].reverse().find((item) => item.role === "assistant");
  return String(latest?.id || "") === String(message.id || "");
}

function renderAssistantMoreMenu(message) {
  const id = escapeHtml(String(message.id));
  const adjustments = canAdjustAssistant(message)
    ? `<button type="button" role="menuitem" data-adjust-response="longer" data-adjust-assistant-id="${id}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8M12 3v18M8 21h8"/><path d="m9 7 3-3 3 3M9 17l3 3 3-3"/></svg>
        <span>Longer</span>
      </button>
      <button type="button" role="menuitem" data-adjust-response="shorter" data-adjust-assistant-id="${id}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8M12 3v18M8 21h8"/><path d="m9 10 3 3 3-3M9 14l3-3 3 3"/></svg>
        <span>Shorter</span>
      </button>`
    : "";
  const report = messageReportMenuItem(message);
  if (!adjustments && !report) return "";
  return `<details class="message-more-menu">
    <summary class="msg-action-btn" aria-label="More response actions" title="More response actions">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
    </summary>
    <div class="message-more-popover" role="menu">
      ${adjustments}${report}
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
    || artifact?.weather_id
    || (artifact?.pending && artifact?.job_id ? `job:${artifact.job_id}` : "")
    || ""
  );
}

function artifactListFromMessage(message) {
  const combined = [];
  if (Array.isArray(message?.artifacts)) combined.push(...message.artifacts);
  const docs = message?.metadata?.documents;
  if (docs && Array.isArray(docs.artifacts)) combined.push(...docs.artifacts);
  const weather = message?.metadata?.weather;
  if (weather && Array.isArray(weather.artifacts)) combined.push(...weather.artifacts);
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
  reviseEditableDocument,
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

    // Internal presigned-storage URLs are not real web sources (they expire
    // and render as error pages); older messages may still carry them.
    const host = citationHost(entry.url);
    if (host === "r2.cloudflarestorage.com" || host.endsWith(".r2.cloudflarestorage.com")) continue;
    const key = entry.url || host;
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
  // Hoist visualize fences first: their HTML legitimately contains <details>,
  // which the leak strippers below would otherwise delete or corrupt.
  const heldVisualize = [];
  s = s.replace(/```(?:visualize|email)[ \t]*\r?\n[\s\S]*?(?:\r?\n```|$)/gi, (block) => {
    heldVisualize.push(block);
    return `KLUIVISKEEP${heldVisualize.length - 1}END`;
  });
  s = s.replace(/<details\b[^>]*\binline-source-pill\b[\s\S]*?<\/details>/gi, "");
  s = s.replace(/<details\b[^>]*\binline-source-pill\b[\s\S]*?(?=\n\n|```|$)/gi, "");
  s = s.replace(/<\/?(?:details|summary|div|span|a|img)\b[^>]*\binline-source-[\w-]+\b[^>]*>/gi, "");
  s = s.replace(/```[\w-]*\n[\s\S]*?(?:inline-source-|<\/details>)[\s\S]*?```/gi, "");
  s = s.replace(/```php-template\n[\s\S]*?```/gi, "");
  s = s.replace(/<\/details>/gi, "");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s.replace(/KLUIVISKEEP(\d+)END/g, (_, i) => heldVisualize[Number(i)] ?? "");
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

// Keep in sync with the mirrored copy in server/saas/messages/content.js.
function stripLeakedReasoningMarkup(value, model) {
  const text = String(value ?? "");
  if (model !== OPENROUTER_NITRO_MODEL) return text;

  let inCodeFence = false;
  let leakedTagEnd = -1;
  for (const match of text.matchAll(/```|~~~|<\/think\s*>/gi)) {
    if (match[0] === "```" || match[0] === "~~~") {
      inCodeFence = !inCodeFence;
    } else if (!inCodeFence) {
      leakedTagEnd = match.index + match[0].length;
    }
  }
  return leakedTagEnd < 0 ? text : text.slice(leakedTagEnd).trimStart();
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
  stripLeakedReasoningMarkup,
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
  const beforePinned = sideChatState.autoScroll && isNearBottom(els.sideChatMessages, 60);
  const beforeScrollTop = els.sideChatMessages.scrollTop;
  els.sideChatMessages.innerHTML = sideChatState.messages.map((message, index) => {
    const text = rawTextContent(message.content);
    const body = message.role === "assistant" ? renderContent(text) : renderPlainText(text);
    const streaming = message.role === "assistant"
      && sideChatState.running
      && index === sideChatState.messages.length - 1;
    const activity = message.role === "assistant"
      ? renderAssistantActivity(message, { streaming })
      : "";
    const add = message.role === "assistant"
      && sideChatState.onAddToCard
      && !streaming
      && !message.error
      && text.trim()
      ? `<button class="side-chat-add-card" type="button" data-add-to-card="${index}"${sideChatState.added.has(index) ? " disabled" : ""}>${sideChatState.added.has(index) ? "Added" : "Add to this card"}</button>`
      : "";
    return `<div class="side-chat-message ${message.role}">${activity}${body}${message.error ? `<span class="side-chat-error">${escapeHtml(message.error)}</span>` : ""}${add}</div>`;
  }).join("");
  hydrateKluiBars(els.sideChatMessages);
  // Context is always attached — empty prompt is still sendable.
  els.sideChatSend.disabled = sideChatState.running || !sideChatState.context;
  if (beforePinned) {
    els.sideChatMessages.scrollTop = els.sideChatMessages.scrollHeight;
  } else {
    els.sideChatMessages.scrollTop = beforeScrollTop;
  }
}

function closeSideChat() {
  sideChatState.abortController?.abort();
  sideChatState.abortController = null;
  sideChatState.running = false;
  sideChatState.context = "";
  sideChatState.messages = [];
  sideChatState.autoScroll = true;
  sideChatState.flashcard = false;
  sideChatState.role = "";
  sideChatState.onAddToCard = null;
  sideChatState.added = new Set();
  els.sideChatPanel?.classList.add("hidden");
  if (els.sideChatInput) {
    els.sideChatInput.value = "";
    els.sideChatInput.placeholder = "Ask about this";
  }
}

function openSideChat(context, anchorRect, options = {}) {
  if (!selectionActionsEnabled() || !els.sideChatPanel) return;
  sideChatState.abortController?.abort();
  sideChatState.context = String(context || "").trim();
  sideChatState.messages = [];
  sideChatState.running = false;
  sideChatState.abortController = null;
  sideChatState.autoScroll = true;
  sideChatState.flashcard = Boolean(options.flashcard);
  sideChatState.role = options.role || "";
  sideChatState.onAddToCard = typeof options.onAddToCard === "function" ? options.onAddToCard : null;
  sideChatState.added = new Set();
  els.sideChatContext.textContent = sideChatState.context.replace(/\s+/g, " ").slice(0, 180);
  if (els.sideChatInput) {
    els.sideChatInput.value = options.initialText || "";
    els.sideChatInput.placeholder = sideChatState.flashcard ? "Ask any doubts." : "Ask about this";
  }
  els.sideChatPanel.classList.remove("hidden");
  const panelWidth = els.sideChatPanel.offsetWidth || 380;
  const panelHeight = els.sideChatPanel.offsetHeight || 480;
  const preferredLeft = (anchorRect?.right || 12) + 14;
  const left = preferredLeft + panelWidth <= window.innerWidth - 12
    ? preferredLeft
    : Math.max(12, (anchorRect?.left || 12) - panelWidth - 14);
  const top = Math.min(Math.max(12, anchorRect?.top || 12), window.innerHeight - panelHeight - 12);
  els.sideChatPanel.style.left = `${left}px`;
  els.sideChatPanel.style.top = `${Math.max(12, top)}px`;
  renderSideChat();
  els.sideChatInput?.focus();
  if (options.send && els.sideChatInput?.value.trim()) void sendSideChatMessage();
}

async function sendSideChatMessage() {
  if (sideChatState.running || !sideChatState.context) return;
  // Highlighted context is enough — empty input still asks about the selection.
  const text = els.sideChatInput?.value.trim() || (sideChatState.flashcard ? "" : "Explain this.");
  if (!text) return;

  const lead = sideChatState.flashcard
    ? "Use this flashcard as context for my questions:\n\n"
    : "Use this selected excerpt from the main chat as context for my questions:\n\n";
  const history = [
    { role: "user", content: `${lead}${sideChatState.context}` },
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
  sideChatState.autoScroll = true;
  const controller = new AbortController();
  sideChatState.abortController = controller;
  renderSideChat();

  try {
    const provider = activeProvider();
    await streamTemporaryChat(state.session, {
      text,
      messages: history,
      role: sideChatState.role || selectedSingleRole(),
      provider,
      settings: chatRequestSettings(),
      writingStyle: "concise",
      agentMode: !sideChatState.flashcard,
      webSearch: sideChatState.flashcard ? "off" : (state.settings.webSearchMode !== "off" ? "auto" : "off")
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

function renderAssistantText(text, citations, { holdVisualize = false } = {}) {
  const cleaned = stripRedundantSourcesFooter(
    stripLeakedToolMarkup(stripLeakedCitationHtml(text)),
    citations
  );
  if (!cleaned.trim()) return "";
  if (!citations.length) return renderContent(cleaned, { holdVisualize, emailCards: true });
  const { text: prepared, slots } = prepareCitationPlaceholders(cleaned, citations);
  return restoreCitationPlaceholders(renderContent(prepared, { holdVisualize, emailCards: true }), slots);
}

function renderAssistantContent(content, message) {
  const citations = citationListFromMessage(message);
  const holdVisualize = state.running && Boolean(message?.id) && String(state.messages.at(-1)?.id || "") === String(message.id);
  const hasContent = Array.isArray(content)
    ? content.some((part) => part?.type === "text" ? String(part.text || "").trim() : part?.type === "image_url")
    : Boolean(String(content || "").trim());

  if (Array.isArray(content)) {
    if (!hasContent) return "";
    return content
      .map((part) => {
        if (part?.type === "text") return renderAssistantText(part.text || "", citations, { holdVisualize });
        if (part?.type === "image_url") {
          const url = part.image_url?.url;
          if (!url) return "";
          const html = renderContent([part]);
          if (!isIllustrationMessage(message)) return html;
          const caption = illustrationCaptionFromMessage(message);
          return caption
            ? html.replace("<img ", `<img data-preview-caption="${escapeHtml(caption)}" `)
            : html;
        }
        if (part?.type === "file") return renderContent([part]);
        return "";
      })
      .join("");
  }

  const text = typeof content === "string" ? content : "";
  return renderAssistantText(text, citations, { holdVisualize });
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

function skillTokenHtml(id) {
  const skill = composerSkillById(id);
  const name = escapeHtml(skillDisplayName(skill || { id }));
  return `<span class="composer-skill-token" data-skill-id="${escapeHtml(id)}"><span class="composer-skill-token-icon" aria-hidden="true">${skillIconMarkup(id)}</span><span>${name}</span></span>`;
}

function skillMarksForMessage(message, text) {
  const ids = Array.isArray(message?.metadata?.skillIds)
    ? message.metadata.skillIds.filter((id) => typeof id === "string" && id)
    : [];
  if (!ids.length) return [];
  const used = new Set();
  const placed = [];
  for (const mark of Array.isArray(message?.metadata?.skillMarks) ? message.metadata.skillMarks : []) {
    const id = typeof mark?.id === "string" ? mark.id : "";
    const at = Number(mark?.at);
    if (!ids.includes(id) || used.has(id) || !Number.isInteger(at) || at < 0) continue;
    used.add(id);
    placed.push({ id, at: Math.min(at, text.length) });
  }
  for (const id of ids) {
    if (!used.has(id)) placed.push({ id, at: 0 });
  }
  return placed.sort((a, b) => a.at - b.at);
}

function renderUserTextWithSkills(text, message) {
  const marks = skillMarksForMessage(message, text);
  if (!marks.length) return renderPlainText(text);
  let html = "";
  let cursor = 0;
  for (const mark of marks) {
    html += renderPlainText(text.slice(cursor, mark.at));
    html += skillTokenHtml(mark.id);
    cursor = mark.at;
  }
  html += renderPlainText(text.slice(cursor));
  return html;
}

function renderUserContent(message) {
  const content = message?.content;
  const paste = pastedTextFromMessage(message);
  const attachments = Array.isArray(content)
    ? content.filter((part) => part?.type === "file").map((part) => renderContent([part])).join("")
    : "";
  if (!paste) {
    const text = rawTextContent(content);
    return `${text || message?.metadata?.skillIds?.length ? `<div class="user-plain-text">${renderUserTextWithSkills(text, message)}</div>` : ""}${attachments}`;
  }
  const fullText = rawTextContent(content);
  const visibleText = `${fullText.slice(0, paste.start)}${fullText.slice(paste.start + paste.length)}`.trim();
  return `${renderPastedTextCard(paste.text, message?.id)}${visibleText || message?.metadata?.skillIds?.length ? `<div class="user-plain-text">${renderUserTextWithSkills(visibleText, message)}</div>` : ""}${attachments}`;
}

function renderUserImages(message) {
  if (!Array.isArray(message?.content)) return "";
  const images = message.content
    .filter((part) => part?.type === "image_url")
    .map((part) => renderContent([part]))
    .join("");
  return images ? `<div class="user-image-strip">${images}</div>` : "";
}

function renderAssistantMessageContent(message, role = "assistant") {
  const msg = normalizeMessage(message);
  const content = typeof msg.content === "string" ? msg.content : msg.content;
  const streaming = role === "assistant" && isAssistantMessageStreaming(msg);
  if (role !== "assistant") return renderUserContent(msg);
  if (isStoppedMessage(msg)) return `<div class="message-stopped" role="status">Stopped by user.</div>`;
  return `${renderAssistantActivity(msg, { streaming })}${renderArtifacts(msg, (artifact) => artifact?.type === "weather")}${renderAssistantContent(content, msg)}${renderArtifacts(msg, (artifact) => artifact?.type !== "weather")}${renderMessageError(msg)}${renderMissingFinal(msg, role)}`;
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

function positionSourcesPill(pill) {
  if (!pill?.open) return;
  const trigger = pill.querySelector(".sources-pill-trigger");
  const panel = pill.querySelector(".sources-panel");
  if (!trigger || !panel) return;
  const rect = trigger.getBoundingClientRect();
  const above = rect.top - 12;
  const below = window.innerHeight - rect.bottom - 12;
  const opensDown = below > above;
  pill.classList.toggle("opens-down", opensDown);
  panel.style.maxHeight = `${Math.max(80, Math.min(340, Math.floor(opensDown ? below : above)))}px`;
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

function weatherSymbol(icon, className = "weather-symbol") {
  const code = String(icon || "").trim();
  const night = code.endsWith("n");
  const kind = code.slice(0, 2);
  let body = '<circle cx="12" cy="12" r="4"/>';
  let tone = "sun";
  if (kind === "01" && night) {
    body = '<path d="M20.2 15.1A8.2 8.2 0 1 1 9.6 3.9 5.1 5.1 0 0 0 20.2 15.1z"/>';
    tone = "moon";
  } else if (kind === "01") {
    body = '<circle cx="12" cy="12" r="3.6"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>';
    tone = "sun";
  } else if (kind === "02" || kind === "03" || kind === "04") {
    body = '<path d="M7 16h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.5-1.2A3.8 3.8 0 0 0 7 16z"/>';
    tone = "cloud";
  } else if (kind === "09" || kind === "10") {
    body = '<path d="M7 14h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.5-1.2A3.8 3.8 0 0 0 7 14z"/><path d="m9 17-1 3M12 17l-1 3M15 17l-1 3"/>';
    tone = "rain";
  } else if (kind === "11") {
    body = '<path d="M7 14h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.5-1.2A3.8 3.8 0 0 0 7 14z"/><path d="m11 15-2 4h3l-2 4"/>';
    tone = "storm";
  } else if (kind === "13") {
    body = '<path d="M12 4v16M6.5 7.5l11 9M6.5 16.5l11-9"/>';
    tone = "snow";
  } else if (night) {
    body = '<path d="M20.2 15.1A8.2 8.2 0 1 1 9.6 3.9 5.1 5.1 0 0 0 20.2 15.1z"/>';
    tone = "moon";
  }
  return `<svg class="${className} weather-symbol--${tone}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function weatherDisplayUnits(artifact) {
  const preferred = state.settings?.weatherUnits;
  if (preferred === "metric" || preferred === "imperial") return preferred;
  return artifact.units === "imperial" ? "imperial" : "metric";
}

function weatherConvertTemp(value, fromUnits, toUnits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (fromUnits === toUnits) return Math.round(number);
  return toUnits === "imperial" ? Math.round(number * 9 / 5 + 32) : Math.round((number - 32) * 5 / 9);
}

function weatherConvertWind(value, fromUnits, toUnits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (fromUnits === toUnits) return Math.round(number);
  return toUnits === "imperial" ? Math.round(number * 2.23694) : Math.round(number / 2.23694);
}

function weatherTemperature(value, unit) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}${unit}` : "--";
}

function weatherHourLabel(hour) {
  const label = String(hour?.label || "").trim();
  if (label && !/cloud|sky|rain|snow|mist|clear|overcast|thunder|haze|fog|drizzle/i.test(label)) return label;
  if (!hour?.timestamp) return label || "";
  return new Intl.DateTimeFormat("en", { hour: "numeric" }).format(new Date(Number(hour.timestamp) * 1000));
}

function weatherDayName(day) {
  const label = String(day?.label || "").trim();
  if (label && !/cloud|sky|rain|snow|mist|clear|overcast|thunder|haze|fog|drizzle/i.test(label)) return label;
  if (!day?.date) return label || "";
  const today = new Date().toISOString().slice(0, 10);
  if (day.date === today) return "Today";
  return new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`));
}

function renderWeatherArtifact(artifact) {
  const current = artifact.current || {};
  const sourceUnits = artifact.units === "imperial" ? "imperial" : "metric";
  const displayUnits = weatherDisplayUnits(artifact);
  const unit = "°";
  const unitLabel = displayUnits === "imperial" ? "°F" : "°C";
  const windUnit = displayUnits === "imperial" ? "mph" : "m/s";
  const temp = (value) => weatherConvertTemp(value, sourceUnits, displayUnits);
  const wind = weatherConvertWind(current.wind_speed, sourceUnits, displayUnits);
  const city = String(artifact.location?.name || "").trim();
  const country = String(artifact.location?.country || "").trim();
  const condition = String(current.label || "Current conditions").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const currentTemp = temp(current.temperature);
  const high = temp(current.high);
  const low = temp(current.low);
  const feels = temp(current.feels_like);
  const hours = [
    { label: "Now", icon: current.icon, temperature: current.temperature },
    ...(artifact.hourly || []).slice(0, 6).map((hour) => ({ ...hour, label: weatherHourLabel(hour) }))
  ];
  const hourly = hours.map((hour) => `
    <div class="weather-hour">
      <span>${escapeHtml(hour.label || "")}</span>
      ${weatherSymbol(hour.icon, "weather-symbol")}
      <strong>${escapeHtml(weatherTemperature(temp(hour.temperature), unit))}</strong>
    </div>
  `).join("");
  const days = (artifact.daily || []).slice(0, 5);
  const allTemperatures = days.flatMap((day) => [temp(day.min), temp(day.max)]).filter(Number.isFinite);
  const scaleMin = allTemperatures.length ? Math.min(...allTemperatures) : 0;
  const scaleMax = allTemperatures.length ? Math.max(...allTemperatures) : 1;
  const span = Math.max(1, scaleMax - scaleMin);
  const daily = days.map((day) => {
    const dayMin = temp(day.min);
    const dayMax = temp(day.max);
    const left = Math.max(0, Math.min(100, ((Number(dayMin) - scaleMin) / span) * 100));
    const width = Math.max(8, Math.min(100 - left, ((Number(dayMax) - Number(dayMin)) / span) * 100));
    return `
      <div class="weather-day">
        <strong>${escapeHtml(weatherDayName(day))}</strong>
        ${weatherSymbol(day.icon, "weather-symbol")}
        <span class="weather-low">${escapeHtml(weatherTemperature(dayMin, unit))}</span>
        <span class="weather-range" aria-hidden="true"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></i></span>
        <span class="weather-high">${escapeHtml(weatherTemperature(dayMax, unit))}</span>
      </div>
    `;
  }).join("");
  const attribution = artifact.attribution || {};
  const placeLabel = [city, country].filter(Boolean).join(", ");
  return `
    <section class="weather-card" aria-label="Weather for ${escapeHtml(placeLabel)}">
      <header class="weather-card-header">
        <div class="weather-place">
          <strong>${escapeHtml(city || placeLabel || "Weather")}</strong>
          ${country ? `<span class="weather-country">${escapeHtml(country)}</span>` : ""}
        </div>
        <div class="weather-header-end">
          <div class="weather-unit-toggle" role="group" aria-label="Temperature unit">
            <button type="button" data-weather-units="metric" class="${displayUnits === "metric" ? "is-active" : ""}" aria-pressed="${displayUnits === "metric"}">°C</button>
            <button type="button" data-weather-units="imperial" class="${displayUnits === "imperial" ? "is-active" : ""}" aria-pressed="${displayUnits === "imperial"}">°F</button>
          </div>
          <span class="weather-now-label">now</span>
        </div>
      </header>
      <div class="weather-current">
        ${weatherSymbol(current.icon, "weather-current-icon")}
        <div class="weather-current-main">
          <strong class="weather-temperature">${escapeHtml(weatherTemperature(currentTemp, unitLabel))}</strong>
          <span>${escapeHtml(condition)}</span>
        </div>
        <div class="weather-current-meta">
          <div class="weather-hi-lo"><strong>${escapeHtml(weatherTemperature(high, unit))}</strong> <span>${escapeHtml(weatherTemperature(low, unit))}</span></div>
          <div class="weather-feels">feels like ${escapeHtml(weatherTemperature(feels, unit))}</div>
          <div class="weather-stats">
            <span title="Humidity"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 2.7c.5 1.7 4.8 7.2 4.8 10.4a4.8 4.8 0 1 1-9.6 0C7.2 9.9 11.5 4.4 12 2.7z"/></svg>${escapeHtml(String(current.humidity ?? "--"))}%</span>
            <span title="Wind"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/></svg>${escapeHtml(wind == null ? "--" : String(wind))} ${windUnit}</span>
          </div>
        </div>
      </div>
      ${hourly ? `<div class="weather-hourly">${hourly}</div>` : ""}
      ${daily ? `<div class="weather-daily">${daily}</div>` : ""}
      ${attribution.url ? `<a class="weather-attribution" href="${escapeHtml(attribution.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attribution.label || "OpenWeather")}</a>` : ""}
    </section>
  `;
}

function renderArtifacts(message, predicate = null) {
  let artifacts = artifactListFromMessage(message);
  if (typeof predicate === "function") artifacts = artifacts.filter(predicate);
  if (!artifacts.length) return "";
  const rows = artifacts.map((artifact) => {
    if (artifact?.type === "weather") return renderWeatherArtifact(artifact);
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
          ${canView ? `<button class="artifact-download" type="button" data-view-attachment-id="${escapeHtml(attachmentId)}" data-file-name="${escapeHtml(fileName)}" data-format="${escapeHtml(format)}">Open</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
  return `<div class="artifact-list">${rows}</div>`;
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

function messageReportMenuItem(msg) {
  const id = msg?.id ? String(msg.id) : "";
  if (!id || id.startsWith("local_")) return "";
  return `<button type="button" role="menuitem" data-report-msg="${escapeHtml(id)}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg><span>Report</span></button>`;
}

function reportMessage(messageId) {
  if (!requireAuth()) return;
  openDeleteConfirm({
    title: "Report this message?",
    body: "We'll review it. This cannot be undone.",
    confirmLabel: "Report",
    onConfirm: async () => {
      try {
        await createContentReport(state.session, messageId);
        showToast("Reported.");
      } catch (error) {
        showToast(error.message || "Could not send report.");
      }
    }
  });
}

function renderMessageFooter(msg, role) {
  if (role === "user") return renderUserMessageFooter(msg);
  if (role !== "assistant") return "";
  // Hide copy/sources while tools are still running or prose is provisional.
  if (isAssistantMessageStreaming(msg) || isProvisionalToolProse(msg)) return "";
  const latestAssistant = [...state.messages].reverse().find((item) => item.role === "assistant");
  const accuracy = document.body.classList.contains("capacitor-native")
    && !state.running
    && String(latestAssistant?.id || "") === String(msg.id || "")
    ? `<a class="message-accuracy-note" href="https://home.klui.ai/accuracy/" target="_blank" rel="noopener"><span>Klui can make mistakes.</span><span>Double-check important responses.</span></a>`
    : "";
  const copy = messageCopyButton(msg, { iconOnly: true });
  const retry = renderMessageRetry(msg);
  const more = renderAssistantMoreMenu(msg);
  const citations = renderCitations(msg);
  if (!copy && !retry && !more && !citations && !accuracy) return "";
  return `
    <div class="message-footer">
      ${copy || retry || more ? `<div class="message-footer-actions">${retry}${copy}${more}</div>` : ""}
      ${citations ? `<div class="message-footer-sources">${citations}</div>` : ""}
      ${accuracy}
    </div>
  `;
}

function formatMessageStamp(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return {
    iso: date.toISOString(),
    short: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    full: date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    })
  };
}

function canEditUserMessage(msg) {
  if (state.running) return false;
  const id = msg?.id ? String(msg.id) : "";
  if (!id || id.startsWith("local_")) return false;
  return msg.role === "user" && !normalizeClientSkillIds(msg.metadata?.skillIds).includes("illustration");
}

function renderUserMessageFooter(msg) {
  const copy = messageCopyButton(msg, { iconOnly: true });
  const edit = canEditUserMessage(msg)
    ? `<button class="msg-action-btn msg-edit-btn" type="button" data-edit-msg="${escapeHtml(String(msg.id))}" aria-label="Edit" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>`
    : "";
  const stamp = formatMessageStamp(msg.created_at);
  const time = stamp
    ? `<time class="msg-timestamp" datetime="${escapeHtml(stamp.iso)}" data-full="${escapeHtml(stamp.full)}">${escapeHtml(stamp.short)}</time>`
    : "";
  if (!copy && !edit && !time) return "";
  return `
    <div class="message-footer message-footer--user">
      <div class="message-footer-actions">${time}${copy}${edit}</div>
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
  const rawText = role === "assistant"
    ? stripRedundantSourcesFooter(rawTextContent(msg.content), citationListFromMessage(msg))
    : rawTextContent(msg.content);
  const idAttr = msg.id ? ` data-message-id="${escapeHtml(String(msg.id))}"` : "";
  const editing = role === "user" && msg.id && state.editingMessageId === String(msg.id);
  const userImages = role === "user" ? renderUserImages(msg) : "";

  const inner = role === "assistant" && researchController.researchMeta(msg)
    ? researchController.renderResearchCard(msg)
    : editing
    ? `${userImages}${renderUserEditForm(msg, rawText)}`
    : `${userImages}<div class="message-content">${renderAssistantMessageContent(msg, role)}</div>
        ${renderMessageFooter(msg, role)}`;

  return `
    <article class="message ${role}${editing ? " editing" : ""}"${idAttr} data-raw-text="${escapeHtml(rawText)}">
      <div class="message-body">
        ${inner}
      </div>
    </article>
  `;
}

function collapseExpandedVisualize(except = null) {
  for (const card of document.querySelectorAll(".visualize-card.is-expanded")) {
    if (card === except) continue;
    card.classList.remove("is-expanded");
    const button = card.querySelector("[data-visualize-expand]");
    if (button) {
      button.textContent = "Expand";
      button.setAttribute("aria-pressed", "false");
    }
    card.querySelector("iframe[data-visualize-id]")?.contentWindow?.postMessage({
      type: "klui:visualize:expanded",
      expanded: false
    }, "*");
  }
  document.body.classList.toggle("visualize-expanded", Boolean(document.querySelector(".visualize-card.is-expanded")));
}

function renderMessages() {
  collapseExpandedVisualize();
  resetCodeSourceStore();
  const showSkeleton = Boolean(state.conversationLoading && !state.messages.length && state.activeConversationId);
  document.body.classList.toggle("chat-empty", !state.messages.length && !showSkeleton);
  renderTemporaryChatMode();
  if (showSkeleton) {
    stopHomeGreeting();
    els.messages.innerHTML = `<div class="msg-skeleton" aria-hidden="true"><div class="msg-skeleton-bar"></div><div class="msg-skeleton-bar"></div><div class="msg-skeleton-bar"></div></div>`;
    els.chatPromptNav?.classList.add("hidden");
    els.chatJumpBottom?.classList.remove("visible");
    return;
  }
  if (!state.messages.length) {
    stopHomeGreeting();
    const guest = !state.session;
    els.messages.innerHTML = renderHomeGreetingHtml({ guest, temporary: state.temporaryChat });
    startHomeGreeting({ guest, temporary: state.temporaryChat });
    els.chatPromptNav?.classList.add("hidden");
    els.chatJumpBottom?.classList.remove("visible");
    return;
  }

  stopHomeGreeting();

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

  hydrateKluiBars(els.messages);

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

// Keep finished tables mounted so a mid-stream pan isn't cancelled by the next token.
function adoptUnchangedTableScrolls(liveEl, nextRoot) {
  const unused = [...liveEl.querySelectorAll(".table-scroll")];
  if (!unused.length) return;
  for (const next of nextRoot.querySelectorAll(".table-scroll")) {
    const index = unused.findIndex((node) => node.innerHTML === next.innerHTML);
    if (index < 0) continue;
    next.replaceWith(unused[index]);
    unused.splice(index, 1);
  }
}

// Keep the loading surface mounted while its code changes so its animation
// does not restart on every streamed token. Returns true when the live card
// was patched in place; callers must then skip swapping children, because
// detaching the card (even momentarily) cancels its CSS shimmer animation.
// Safe to skip: once the fence is open, every new token lands inside it.
function adoptLiveVisualizeBuilding(liveEl, nextRoot) {
  const live = liveEl.querySelector(".visualize-building");
  const next = nextRoot.querySelector(".visualize-building");
  if (!live || !next) return false;
  const liveCode = live.querySelector(".visualize-building-code code");
  const nextCode = next.querySelector(".visualize-building-code code");
  if (liveCode && nextCode && liveCode.textContent !== nextCode.textContent) {
    liveCode.textContent = nextCode.textContent;
  }
  return true;
}

function adoptLiveVisualizeFrame(liveEl, nextRoot) {
  const live = liveEl.querySelector("iframe[data-visualize-id]")?.closest(".visualize-card");
  const next = nextRoot.querySelector("iframe[data-visualize-id]")?.closest(".visualize-card");
  if (!live || !next) return false;
  next.replaceWith(live);
  return true;
}

// Transplant edited email cards positionally so rerenders keep local edits.
function adoptLiveEmailCards(liveEl, nextRoot) {
  const live = [...liveEl.querySelectorAll("[data-email-card]")];
  const next = [...nextRoot.querySelectorAll("[data-email-card]")];
  if (!live.length || live.length !== next.length) return false;
  next.forEach((node, index) => node.replaceWith(live[index]));
  return true;
}

function closeEmailMenus() {
  for (const menu of document.querySelectorAll(".klui-email-menu:not([hidden])")) {
    menu.hidden = true;
    menu.closest("[data-email-card]")?.querySelector("[data-email-send]")?.setAttribute("aria-expanded", "false");
  }
}

function setEmailEditing(card, editing) {
  if (!card || (card.classList.contains("is-revising") && !editing)) return;
  card.classList.toggle("is-editing", editing);
  const edit = card.querySelector("[data-email-edit]");
  const revise = card.querySelector("[data-email-revise-form]");
  if (edit) edit.hidden = editing;
  if (revise) revise.hidden = !editing;
  if (editing) requestAnimationFrame(() => revise?.querySelector("input")?.focus());
}

function emailFieldText(el) {
  return ((el?.isContentEditable ? el.innerText : el?.value) || "").trim();
}

function emailCardValues(card) {
  return {
    to: emailFieldText(card?.querySelector('[data-email-field="to"]')),
    subject: emailFieldText(card?.querySelector('[data-email-field="subject"]')),
    body: emailFieldText(card?.querySelector('[data-email-field="body"]'))
  };
}

function emailCardText(card) {
  const { to, subject, body } = emailCardValues(card);
  const headers = [to && `To: ${to}`, subject && `Subject: ${subject}`].filter(Boolean).join("\n");
  return [headers, body].filter(Boolean).join("\n\n");
}

const emailComposeUrls = { gmail: gmailComposeUrl, outlook: outlookComposeUrl, mailto: mailtoComposeUrl };

// Placeholders like [Name] are hints, not text: the first edit touching one
// removes the whole highlighted token so the user's typing is plain.
function clearEmailPlaceholderAtCaret(card, event) {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  if (!anchor || !selection.isCollapsed) return;
  const element = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
  let ph = element?.closest(".klui-email-ph");
  if (!ph && event.inputType === "deleteContentBackward" && selection.anchorOffset === 0) {
    ph = anchor.previousSibling?.classList?.contains("klui-email-ph") ? anchor.previousSibling : null;
  }
  if (!ph) return;
  const range = document.createRange();
  range.setStartBefore(ph);
  range.collapse(true);
  ph.remove();
  selection.removeAllRanges();
  selection.addRange(range);
  if (!event.inputType.startsWith("delete")) return;
  event.preventDefault();
  recordEmailEdit(card);
}

// Per-card undo/redo over recent field snapshots.
const emailHistories = new WeakMap();

function emailSnapshot(card) {
  return {
    to: card.querySelector('[data-email-field="to"]').value,
    subject: card.querySelector('[data-email-field="subject"]').innerHTML,
    body: card.querySelector('[data-email-field="body"]').innerHTML
  };
}

// Baseline is captured lazily on the first beforeinput, before the edit lands.
function emailHistory(card) {
  let history = emailHistories.get(card);
  if (!history) emailHistories.set(card, history = { entries: [emailSnapshot(card)], index: 0 });
  return history;
}

function syncEmailHistoryButtons(card, history) {
  card.querySelector(".klui-email-history").hidden = history.entries.length < 2;
  card.querySelector("[data-email-undo]").disabled = history.index === 0;
  card.querySelector("[data-email-redo]").disabled = history.index === history.entries.length - 1;
}

function recordEmailEdit(card) {
  const history = emailHistory(card);
  history.entries.length = history.index + 1;
  history.entries.push(emailSnapshot(card));
  if (history.entries.length > 100) history.entries.shift();
  history.index = history.entries.length - 1;
  syncEmailHistoryButtons(card, history);
}

function stepEmailHistory(card, delta) {
  const history = emailHistories.get(card);
  const next = history?.entries[history.index + delta];
  if (!next) return;
  history.index += delta;
  card.querySelector('[data-email-field="to"]').value = next.to;
  card.querySelector('[data-email-field="subject"]').innerHTML = next.subject;
  card.querySelector('[data-email-field="body"]').innerHTML = next.body;
  syncEmailHistoryButtons(card, history);
}

function applyEmailSource(card, source) {
  emailHistory(card);
  const fields = emailCardFields(source);
  card.querySelector('[data-email-field="to"]').value = fields.to;
  card.querySelector('[data-email-field="subject"]').innerHTML = fields.subjectHtml;
  card.querySelector('[data-email-field="body"]').innerHTML = fields.bodyHtml;
  recordEmailEdit(card);
}

function replaceEmailFenceInContent(content, source) {
  const fence = `\`\`\`email\n${source}\n\`\`\``;
  const swap = (text) => (/```email\b/i.test(text)
    ? String(text).replace(/```email[ \t]*\r?\n[\s\S]*?(?:\r?\n```|$)/i, fence)
    : `${text}\n\n${fence}`);
  if (Array.isArray(content)) {
    const textParts = content.map((part, index) => part?.type === "text" ? index : -1).filter((index) => index >= 0);
    const target = textParts.find((index) => /```email\b/i.test(content[index].text || "")) ?? textParts[0];
    return content.map((part, index) => index === target ? { ...part, text: swap(part.text || "") } : part);
  }
  return swap(String(content || ""));
}

function persistEmailRevisionLocally(messageId, source) {
  const message = state.messages.find((item) => String(item?.id || "") === String(messageId || ""));
  if (!message) return;
  message.content = replaceEmailFenceInContent(message.content, source);
}

async function submitEmailRevise(form) {
  const input = form.querySelector("[data-email-revise-input]");
  const instruction = input?.value.trim() || "";
  const card = form.closest("[data-email-card]");
  if (!instruction) { input?.focus(); return; }
  if (!card || card.classList.contains("is-revising")) return;
  if (state.running) { showToast("Wait for the current response to finish."); return; }
  const messageId = card.closest("[data-message-id]")?.dataset.messageId || "";
  card.classList.add("is-revising");
  card.inert = true;
  input.disabled = true;
  form.querySelector("button[type='submit']")?.setAttribute("disabled", "");
  try {
    const result = await reviseEmailDraft(state.session, {
      draft: emailCardText(card),
      instruction,
      messageId
    });
    const source = String(result?.source || "").trim();
    if (!source) throw new Error("No revision returned.");
    applyEmailSource(card, source);
    persistEmailRevisionLocally(messageId, source);
    input.value = "";
    card.classList.remove("is-revising");
    setEmailEditing(card, false);
  } catch (error) {
    if (error?.name === "AbortError") return;
    showToast(error.message || "Could not revise email.");
  } finally {
    card.classList.remove("is-revising");
    card.inert = false;
    input.disabled = false;
    form.querySelector("button[type='submit']")?.removeAttribute("disabled");
  }
}

function stripOpenEmailFence(raw) {
  const text = String(raw || "");
  if (/```email[ \t]*\r?\n[\s\S]*?\r?\n```/i.test(text)) return text;
  return text.replace(/```email[ \t]*\r?\n[\s\S]*$/i, "").replace(/```email[ \t]*$/i, "");
}

function patchStandardArticle(article, msg) {
  if (researchController.researchMeta(msg)) return false;
  if (article.classList.contains("compare-message") || article.classList.contains("council-message")) return false;
  const role = msg.role === "user" ? "user" : "assistant";
  if (msg.id) article.dataset.messageId = String(msg.id);
  article.dataset.rawText = role === "assistant"
    ? stripRedundantSourcesFooter(rawTextContent(msg.content), citationListFromMessage(msg))
    : rawTextContent(msg.content);
  const reasoning = article.querySelector("details.reasoning");
  if (reasoning && msg.id) reasoning.dataset.messageId = String(msg.id);
  article.querySelectorAll(".thinking-status").forEach((node) => node.remove());
  const body = article.querySelector(".message-body");
  if (!body) return false;
  if (role === "assistant" && (isStoppedMessage(msg) || /```(?:visualize|email)/.test(rawTextContent(msg.content)))) {
    const content = body.querySelector(":scope > .message-content");
    const raw = rawTextContent(msg.content);
    const stopped = isStoppedMessage(msg);
    const visualizeNeedsMount = /```visualize/.test(raw) && !content?.querySelector("iframe[data-visualize-id]");
    const emailNeedsMount = /```email/.test(raw) && !content?.querySelector("[data-email-card]");
    if (content && (stopped || visualizeNeedsMount || emailNeedsMount)) {
      if (stopped || visualizeNeedsMount) collapseExpandedVisualize();
      const next = document.createElement("div");
      next.innerHTML = renderAssistantMessageContent(msg, role);
      if (!stopped) {
        adoptLiveVisualizeFrame(content, next);
        adoptLiveEmailCards(content, next);
      }
      content.replaceChildren(...next.childNodes);
    }
  }
  if (role === "user") {
    const nextImages = renderUserImages(msg);
    const prevImages = body.querySelector(":scope > .user-image-strip");
    const staleImages = prevImages?.querySelector('img[src^="blob:"], [data-preview-src^="blob:"]');
    if (prevImages && nextImages) {
      if (staleImages) prevImages.outerHTML = nextImages;
    }
    else if (prevImages) prevImages.remove();
    else if (nextImages) body.insertAdjacentHTML("afterbegin", nextImages);
  }
  const nextFooter = renderMessageFooter(msg, role);
  const prevFooter = body.querySelector(":scope > .message-footer");
  if (prevFooter && nextFooter) prevFooter.outerHTML = nextFooter;
  else if (prevFooter) prevFooter.remove();
  else if (nextFooter) body.insertAdjacentHTML("beforeend", nextFooter);
  return true;
}

// Patch ids/footers in place. Remounting the thread is the finish-jerk.
function patchCompletedMessages() {
  const articles = [...els.messages.querySelectorAll(":scope > article.message")];
  const views = messageViews(state.messages);
  if (!articles.length || articles.length !== views.length) return false;
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i];
    const article = articles[i];
    if (view.type === "compare") {
      if (!compareController.patchCompareMessage(article, view.messages)) return false;
      continue;
    }
    if (view.type === "council") {
      if (!councilController.patchCouncilMessage(article, view.council)) return false;
      continue;
    }
    if (view.type !== "message" || !patchStandardArticle(article, view.message)) return false;
  }
  return true;
}

function settleLiveMessages({ pinned, scrollTop }) {
  if (patchCompletedMessages()) {
    renderConversations();
    renderProfileMenu();
    renderContextMeter();
    renderChatPromptNavigator();
    updateChatScrollNavigation();
    compareController.syncCompareContextBanner();
    syncPendingArtifactPolls();
    if (pinned) pinMessagesToBottom();
    return;
  }
  renderShell();
  if (pinned) pinMessagesToBottom();
  else setMessagesScrollTop(scrollTop);
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

function animateNewestStreamingText(root, addedCharacters) {
  if (!root || addedCharacters < 1 || root.querySelector(".visualize-building")) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!node.data.trim() || parent?.closest(".thinking-status, .klui-bar, .artifact-list, .weather-card, .message-error, .sources-pill, .visualize-building, .klui-email, pre, code, .katex, button, svg")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let newest = null;
  while (walker.nextNode()) newest = walker.currentNode;
  if (!newest) return;
  const start = Math.max(0, newest.data.length - Math.min(addedCharacters, 48));
  const tail = newest.splitText(start);
  const reveal = document.createElement("span");
  reveal.className = "streaming-text-reveal";
  tail.replaceWith(reveal);
  reveal.append(tail);
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
    const previousRawText = surface.dataset.rawText || "";
    const appendOnly = rawText.startsWith(previousRawText);
    const addedCharacters = appendOnly
      ? rawText.length - previousRawText.length
      : rawText.length;
    surface.dataset.rawText = rawText;
    // Intro stays mounted while an unclosed email fence streams; the card
    // appears once, complete. Otherwise every hidden token remounts the
    // intro and retriggers streaming-text-reveal.
    if (stripOpenEmailFence(rawText) === stripOpenEmailFence(previousRawText) && addedCharacters > 0) {
      return;
    }
    const statusEl = contentEl.querySelector(".thinking-status");
    const hasContent = rawText.trim().length > 0;
    const provisional = isProvisionalToolProse(message);

    if (statusEl && hasContent) {
      // Keep the live status node so opacity can fade out while answer HTML updates.
      const tmp = document.createElement("div");
      tmp.innerHTML = renderAssistantMessageContent(message);
      tmp.querySelector(".thinking-status")?.remove();
      adoptUnchangedTableScrolls(contentEl, tmp);
      adoptLiveEmailCards(contentEl, tmp);
      const keptFrame = appendOnly && adoptLiveVisualizeFrame(contentEl, tmp);
      if (!adoptLiveVisualizeBuilding(contentEl, tmp)) {
        if (!keptFrame) collapseExpandedVisualize();
        for (const node of [...contentEl.childNodes]) {
          if (node !== statusEl) node.remove();
        }
        while (tmp.firstChild) contentEl.appendChild(tmp.firstChild);
      }
      if (provisional) {
        // Interim tool-loop prose: keep Klui visible alongside the one-liner.
        statusEl.classList.remove("is-leaving");
        const label = currentThinkingStatus(message, { streaming: true });
        if (label) {
          const update = currentThinkingUpdate(message, { streaming: true });
          updateKluiBar(statusEl, {
            label,
            update: update?.text,
            updateKey: update?.key,
            active: !isFinalFinishReason(message?.finishReason)
          });
        }
      } else if (!statusEl.classList.contains("is-leaving")) {
        void statusEl.offsetWidth;
        statusEl.classList.add("is-leaving");
        const removeStatus = () => {
          if (statusEl.isConnected) statusEl.remove();
        };
        statusEl.addEventListener("transitionend", removeStatus, { once: true });
        setTimeout(removeStatus, 200);
      }
    } else if (statusEl?.classList.contains("klui-bar") && !hasContent) {
      // Root fix: reasoning/tool-adjacent deltas used to innerHTML-replace this node
      // mid-roll (old shimmer stutter). Patch the live bar instead of remounting.
      const label = currentThinkingStatus(message, { streaming: true });
      if (label) {
        const update = currentThinkingUpdate(message, { streaming: true });
        updateKluiBar(statusEl, {
          label,
          update: update?.text,
          updateKey: update?.key,
          active: !isFinalFinishReason(message?.finishReason)
        });
      }
    } else {
      const tmp = document.createElement("div");
      tmp.innerHTML = renderAssistantMessageContent(message);
      adoptUnchangedTableScrolls(contentEl, tmp);
      adoptLiveEmailCards(contentEl, tmp);
      const keptFrame = appendOnly && adoptLiveVisualizeFrame(contentEl, tmp);
      if (!adoptLiveVisualizeBuilding(contentEl, tmp)) {
        if (!keptFrame) collapseExpandedVisualize();
        contentEl.replaceChildren(...tmp.childNodes);
        hydrateKluiBars(contentEl);
      }
    }
    animateNewestStreamingText(contentEl, contentEl.querySelector("[data-email-card]") ? 0 : addedCharacters);
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
      void refreshAccountStorage();
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
  if (state.researchMode) {
    showToast("Turn off Deep Research before adding attachments.");
    return;
  }
  const draft = composerSnapshot();
  const plan = state.me?.plan || {};
  const allFiles = [...files];
  const accepted = allFiles.filter((file) => state.temporaryChat
    ? fileCategory(file) === "image"
    : state.running ? fileCategory(file) === "image" : isSupportedPendingFile(file));
  if (state.temporaryChat && accepted.length < allFiles.length) {
    showToast("Temporary chat supports images only.");
  }
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
  if (!state.temporaryChat && allFiles.length && !accepted.length) showToast("Upload images, PDFs, Word, Excel, PowerPoint, CSV, or TSV files.");

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
  if (chosen.length && spectrumLevelFromSettings() === 0) {
    applySpectrumLevel(1);
    showAttachmentModelNotice();
  }
  renderImages();
  setComposerPlainText(draft.text, draft.marks);
  applyComposerHeight();
  compareController.syncCompareContextBanner();
}

let attachmentModelNoticeTimer = null;

function hideAttachmentModelNotice() {
  clearTimeout(attachmentModelNoticeTimer);
  attachmentModelNoticeTimer = null;
  els.attachmentModelNotice?.classList.remove("visible");
  els.attachmentModelNotice?.setAttribute("aria-hidden", "true");
}

function showAttachmentModelNotice() {
  clearTimeout(attachmentModelNoticeTimer);
  els.attachmentModelNotice?.classList.add("visible");
  els.attachmentModelNotice?.setAttribute("aria-hidden", "false");
  attachmentModelNoticeTimer = setTimeout(hideAttachmentModelNotice, 4500);
}

function illustrationCaptionFromMessage(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return rawTextContent(content).trim();
  return content
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text || "").trim())
    .filter((text) => text && !/illustration could not be generated/i.test(text))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function openLightbox(src, caption = "") {
  els.lightboxImg.src = src;
  const text = String(caption || "").trim();
  if (els.lightboxCaption) {
    els.lightboxCaption.textContent = text;
    els.lightboxCaption.hidden = !text;
  }
  els.lightbox.classList.remove("hidden");
}

function closeLightbox() {
  els.lightbox.classList.add("hidden");
  els.lightboxImg.src = "";
  if (els.lightboxCaption) {
    els.lightboxCaption.textContent = "";
    els.lightboxCaption.hidden = true;
  }
}

/* ─── Drawers / Dialogs ─── */

function openSettings() {
  document.body.classList.remove("sidebar-open");
  syncSettingsInputs();
  setSettingsTab("general");
  els.settingsDrawer.classList.add("open");
  els.settingsDrawer.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "settings";
}

function renderMemorySettings() {
  const memory = state.memory || { enabled: false, content: "" };
  if (els.memoryEnabledInput) els.memoryEnabledInput.checked = Boolean(memory.enabled);
  if (els.memoryContentInput && document.activeElement !== els.memoryContentInput) {
    els.memoryContentInput.value = memory.content || "";
  }
  els.memoryEditor?.classList.toggle("hidden", !memory.enabled);
  els.memoryEmpty?.classList.toggle("hidden", Boolean(memory.enabled));
}

async function loadMemorySettings() {
  if (!state.session) return;
  if (els.memoryNotice) els.memoryNotice.textContent = "Loading memory...";
  try {
    const payload = await fetchMemory(state.session);
    state.memory = payload.memory;
    renderMemorySettings();
    if (els.memoryNotice) els.memoryNotice.textContent = "";
  } catch (error) {
    if (els.memoryNotice) els.memoryNotice.textContent = error.message || "Could not load memory.";
  }
}

async function setMemoryEnabled(enabled) {
  if (!els.memoryEnabledInput) return;
  if (!state.session) {
    renderMemorySettings();
    return;
  }
  els.memoryEnabledInput.disabled = true;
  if (els.memoryNotice) els.memoryNotice.textContent = enabled ? "Turning memory on..." : "Turning memory off...";
  try {
    const payload = await updateMemory(state.session, { enabled });
    state.memory = payload.memory;
    renderMemorySettings();
    if (els.memoryNotice) {
      els.memoryNotice.textContent = enabled
        ? "Memory is on. Only new messages you send from now on can be remembered."
        : "Memory is off. Your existing summary is kept but will not be used or updated.";
    }
  } catch (error) {
    renderMemorySettings();
    if (els.memoryNotice) els.memoryNotice.textContent = error.message || "Could not update memory.";
  } finally {
    els.memoryEnabledInput.disabled = false;
  }
}

async function saveMemorySettings() {
  if (!state.session || !els.memoryContentInput) return;
  els.saveMemoryButton.disabled = true;
  if (els.memoryNotice) els.memoryNotice.textContent = "Saving...";
  try {
    const payload = await updateMemory(state.session, { content: els.memoryContentInput.value });
    state.memory = payload.memory;
    renderMemorySettings();
    if (els.memoryNotice) els.memoryNotice.textContent = "Saved. Changes apply to future replies.";
  } catch (error) {
    if (els.memoryNotice) els.memoryNotice.textContent = error.message || "Could not save memory.";
  } finally {
    els.saveMemoryButton.disabled = false;
  }
}

async function clearMemorySettings() {
  if (!state.session || !els.clearMemoryButton) return;
  if (els.clearMemoryButton.dataset.confirming !== "true") {
    els.clearMemoryButton.dataset.confirming = "true";
    els.clearMemoryButton.textContent = "Confirm clear";
    if (els.memoryNotice) els.memoryNotice.textContent = "This permanently removes the whole memory summary.";
    setTimeout(() => {
      if (els.clearMemoryButton?.dataset.confirming !== "true") return;
      delete els.clearMemoryButton.dataset.confirming;
      els.clearMemoryButton.textContent = "Clear memory";
    }, 5000);
    return;
  }
  delete els.clearMemoryButton.dataset.confirming;
  els.clearMemoryButton.textContent = "Clear memory";
  els.clearMemoryButton.disabled = true;
  try {
    const payload = await clearMemory(state.session);
    state.memory = payload.memory;
    renderMemorySettings();
    if (els.memoryNotice) els.memoryNotice.textContent = "Memory cleared.";
  } catch (error) {
    if (els.memoryNotice) els.memoryNotice.textContent = error.message || "Could not clear memory.";
  } finally {
    els.clearMemoryButton.disabled = false;
  }
}

function setSettingsTab(tab) {
  const selected = ["general", "memory", "storage", "account"].includes(tab) ? tab : "general";
  els.settingsTabs?.querySelectorAll("[data-settings-tab]").forEach((button) => {
    const active = button.dataset.settingsTab === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-settings-panel], #settingsTextScaleSection").forEach((panel) => {
    panel.hidden = (panel.dataset.settingsPanel || "general") !== selected;
  });
  if (els.settingsTitle) els.settingsTitle.textContent = selected[0].toUpperCase() + selected.slice(1);
  if (selected === "memory" && !state.memory) void loadMemorySettings();
  if (selected === "storage") {
    if (els.settingsStorageList) els.settingsStorageList.innerHTML = `<p class="storage-list-empty">Loading files...</p>`;
    void Promise.all([loadMe(), loadAccountStorage()]).then(renderSettingsStorage).catch(() => {});
  }
  if (selected === "account") {
    renderSettingsAccount();
    if (state.session) void loadMe().then(renderSettingsAccount).catch(() => {});
  }
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

function openDeleteConfirm({ title, body, chatId = "", attachmentId = "", projectId = "", onConfirm = null, confirmLabel = "Delete" } = {}) {
  closeConversationMenus();
  closePinnedPopup();
  closeProfileMenu();
  if (isNative()) document.body.classList.remove("sidebar-open");
  state.pendingDeleteId = chatId || "";
  state.pendingDeleteAttachmentId = attachmentId || "";
  state.pendingDeleteProjectId = projectId || "";
  state.pendingDeleteConfirm = typeof onConfirm === "function" ? onConfirm : null;
  els.confirmTitle.textContent = title;
  els.confirmBody.textContent = body;
  els.confirmDeleteButton.textContent = confirmLabel;
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
  state.pendingDeleteConfirm = null;
  els.confirmDeleteButton.textContent = "Delete";
  els.confirmDialog.classList.remove("open");
  els.confirmDialog.setAttribute("aria-hidden", "true");
  if (els.overlay.dataset.mode === "confirm") {
    if (els.settingsDrawer.classList.contains("open")) {
      els.overlay.dataset.mode = "settings";
    } else if (els.accountDrawer.classList.contains("open")) {
      els.overlay.dataset.mode = "account";
    } else {
      els.overlay.hidden = true;
      delete els.overlay.dataset.mode;
    }
  }
}

async function confirmPendingDelete() {
  if (typeof state.pendingDeleteConfirm === "function") {
    const fn = state.pendingDeleteConfirm;
    closeConfirmDialog();
    await fn();
    return;
  }
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
      void refreshAccountStorage();
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
    deletedConversationIds.forEach((cid) => conversationCache.delete(cid));
    state.pinnedChatIds = state.pinnedChatIds.filter((id) => !deletedConversationIds.has(id));
    savePinnedChatIds();
    const isCourse = deletedProject?.kind === "course" || state.studyOpen;
    state.activeProjectId = "";
    state.activeProject = null;
    if (isCourse) {
      state.studyOpen = true;
      state.projectsOpen = false;
      if (state.activeCourseId === deletedProjectId) {
        state.activeCourseId = "";
        state.studyMaterials = null;
        state.studyPractice = null;
        state.studyProjectDetail = null;
      }
      syncStudyUrl({ replace: true });
    } else {
      syncProjectsUrl({ replace: true });
    }
    renderShell();
    try {
      await deleteProject(state.session, deletedProjectId);
      void refreshAccountStorage();
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
  if (typeof conversation?.onSave === "function") {
    state.pendingRenameId = "";
    state.pendingRenameSave = conversation.onSave;
    if (els.renameTitle) els.renameTitle.textContent = conversation.title || "Rename";
    els.renameChatInput.value = conversation.value || "";
  } else {
    state.pendingRenameSave = null;
    state.pendingRenameId = conversation.id;
    if (els.renameTitle) els.renameTitle.textContent = "Rename chat";
    els.renameChatInput.value = conversation.title || "New chat";
  }
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
  state.pendingRenameSave = null;
  if (els.renameTitle) els.renameTitle.textContent = "Rename chat";
  els.renameDialog.classList.remove("open");
  els.renameDialog.setAttribute("aria-hidden", "true");
  if (els.overlay.dataset.mode === "rename") {
    els.overlay.hidden = true;
    delete els.overlay.dataset.mode;
  }
}

async function saveRenameDialog() {
  const title = els.renameChatInput.value.trim();
  if (!title) {
    showToast(state.pendingRenameSave ? "Enter a name." : "Enter a chat title.");
    return;
  }
  if (typeof state.pendingRenameSave === "function") {
    try {
      await state.pendingRenameSave(title);
      closeRenameDialog();
    } catch (err) {
      showToast(err.message || "Could not rename.");
    }
    return;
  }
  const id = state.pendingRenameId;
  if (!id) return;
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
  els.systemPromptInput.value = state.settings.systemPrompt;
  if (els.showModelReasoningInput) {
    els.showModelReasoningInput.checked = state.settings.showModelReasoning !== false;
  }
  if (els.textScaleInput) els.textScaleInput.value = String(clampTextScale(state.settings.uiTextScale));
  if (els.textScaleValue) els.textScaleValue.textContent = `${clampTextScale(state.settings.uiTextScale)}%`;
  syncAppearanceControls();
  renderSettingsStorage();
}

/* Composer border-beam: md while generating, pulse-inner ocean while mic. */
const BEAM_PULSE_ROWS = [["--bw1-mic",0.72,1.308,2.34,0,""],["--bh1-mic",1.252,0.762,3.276,0,""],["--bx1-mic",-33,29.7,3.04,0,"px"],["--by1-mic",18.15,-23.1,3.04,0,"px"],["--bw2-mic",1.28,0.762,2.86,0,""],["--bh2-mic",0.776,1.294,2.106,0,""],["--bx2-mic",26.4,-29.7,3.572,0,"px"],["--by2-mic",-33,21.45,3.572,0,"px"],["--bw3-mic",0.832,1.322,2.548,0,""],["--bh3-mic",1.21,0.72,3.64,0,""],["--bx3-mic",-19.8,33,2.755,0,"px"],["--by3-mic",-28.05,14.85,2.755,0,"px"],["--bgh-mic",0.66,1.34,2.4,0,""],["--bop-tl-mic",0.52,1,1.9,0,""],["--bop-tr-mic",0.52,1,2.508,0.532,""],["--bop-bl-mic",0.52,1,1.596,1.045,""],["--bop-br-mic",0.52,1,3.002,1.577,""]];
const BEAM_PULSE_HUE = { prop: "--beam-hue-mic", range: 28, period: 16 };
let beamPulseRaf = null;
let beamPulseLast = 0;
let beamPulseEl = null;

function setComposerBeamActive(el, on) {
  if (!el) return;
  if (on) {
    el.removeAttribute("data-fading");
    el.setAttribute("data-active", "");
    return;
  }
  if (!el.hasAttribute("data-active") && !el.hasAttribute("data-fading")) return;
  el.removeAttribute("data-active");
  el.setAttribute("data-fading", "");
  setTimeout(() => el.removeAttribute("data-fading"), 600);
}

function setMicPulseActive(el, on) {
  if (!on) {
    beamPulseEl = null;
    if (beamPulseRaf != null) {
      cancelAnimationFrame(beamPulseRaf);
      beamPulseRaf = null;
    }
    return;
  }
  if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  beamPulseEl = el;
  if (beamPulseRaf != null) return;
  beamPulseLast = 0;
  const tick = (ts) => {
    beamPulseRaf = requestAnimationFrame(tick);
    if (!beamPulseEl || ts - beamPulseLast < 1000 / 30 - 2) return;
    beamPulseLast = ts;
    const t = ts / 1000;
    const ease = (phase) => (1 - Math.cos(Math.PI * 2 * phase)) / 2;
    for (const [prop, a, b, period, delay, unit] of BEAM_PULSE_ROWS) {
      const v = a + (b - a) * ease((t - delay) / period);
      beamPulseEl.style.setProperty(prop, unit === "px" ? `${v.toFixed(2)}px` : v.toFixed(4));
    }
    beamPulseEl.style.setProperty(
      BEAM_PULSE_HUE.prop,
      // ponytail: ping-pong ±range so ocean stays blue/purple (no full-spectrum spin).
      `${(-BEAM_PULSE_HUE.range + 2 * BEAM_PULSE_HUE.range * ease(t / BEAM_PULSE_HUE.period)).toFixed(2)}deg`
    );
  };
  beamPulseRaf = requestAnimationFrame(tick);
}

function syncComposerBeam() {
  const el = els.composerBeam;
  if (!el) return;
  const voiceOn = voiceState === "recording" || voiceState === "processing";
  const mode = voiceOn ? "mic" : state.running ? "gen" : "";
  if (!mode) {
    setComposerBeamActive(el, false);
    setMicPulseActive(el, false);
    return;
  }
  if (el.getAttribute("data-beam") !== mode) {
    el.removeAttribute("data-active");
    el.removeAttribute("data-fading");
    el.setAttribute("data-beam", mode);
  }
  setComposerBeamActive(el, true);
  setMicPulseActive(el, mode === "mic");
}

function setRunning(running) {
  state.running = running;
  els.stopButton.classList.toggle("hidden", !running);
  els.sendButton.classList.toggle("hidden", running);
  els.promptInput?.setAttribute("contenteditable", "true");
  els.imageToggle.disabled = state.temporaryChat || state.researchMode;
  els.modelButton.disabled = running;
  els.compareButton.disabled = running || state.temporaryChat;
  if (els.councilButton) els.councilButton.disabled = running || state.temporaryChat;
  if (els.deepResearchToggle) els.deepResearchToggle.disabled = running || !state.config?.services?.research;
  updateComposerPlaceholder();
  updateSendButton();
  syncComposerBeam();
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
  renderImages
});

async function loadStudyHub() {
  if (!studyHubPromise) {
    studyHubPromise = import("./studyHub.js").then(({ createStudyHubController }) => {
      studyHub = createStudyHubController({
        state,
        els,
        escapeHtml,
        renderContent,
        showToast,
        requireAuth,
        blockChatNavigationWhileRunning,
        parkActiveConversationRun,
        clearClarification,
        closeDocumentViewer,
        renderShell,
        renderImages,
        openConversation,
        openDeleteConfirm,
        openTitleRename: openRenameDialog,
        isSupportedDocumentFile,
        fetchProject,
        createProject,
        updateProject,
        updateConversation,
        presignUpload,
        putUploadContent,
        completeUpload,
        deleteAttachment,
        fetchDocumentStatus,
        fetchStudyMaterials,
        generateStudyContent,
        deleteStudyMaterial,
        fetchStudyPractice,
        fetchStudyQueue,
        createStudyCard,
        updateStudyCard,
        deleteStudyCard,
        updateStudyDeck,
        deleteStudyDeck,
        fetchStudyQuiz,
        updateStudyQuiz,
        deleteStudyQuiz,
        submitStudyQuizAttempt,
        exportStudyNote,
        deleteStudyNote,
        fetchDocumentJobStatus,
        downloadAttachment,
        flashCopySuccess,
        syncStudyUrl,
        loadProjects,
        canUseSideChat: selectionActionsEnabled,
        openSideChat,
        closeSideChat
      });
      studyHub.bindEvents();
      return studyHub;
    });
  }
  return studyHubPromise;
}

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
  resolveAdminReport,
  escapeHtml,
  isAdminUser,
  showToast,
  saveSettings,
  syncSettingsInputs
});

function updateSendButton() {
  if (els.voiceButton) {
    els.voiceButton.disabled = voiceState === "processing"
      || (!state.config?.services?.speech && voiceState !== "recording");
  }
  if (voiceState === "recording" || voiceState === "processing") {
    els.sendButton.classList.toggle("active", voiceState === "recording");
    els.sendButton.disabled = voiceState !== "recording";
    els.sendButton.classList.toggle("is-voice-confirm", true);
    return;
  }
  els.sendButton.classList.toggle("is-voice-confirm", false);
  const hasText = Boolean(composerPlainText().trim() || state.pastedText);
  if (state.running) {
    const hasContent = hasText || state.images.some((item) => item.category === "image");
    const blocked = state.images.some((item) => item.category !== "image") || state.followUps.length >= 2;
    els.sendButton.classList.toggle("active", hasContent && !blocked);
    els.sendButton.disabled = !hasContent || blocked;
    return;
  }
  const hasContent = hasText || state.images.length || state.followUps.length;
  const blocked = pendingDocumentUploads().length > 0 || state.clarificationChecking;
  els.sendButton.classList.toggle("active", Boolean(hasContent) && !blocked);
  els.sendButton.disabled = blocked;
}

function setVoiceState(next) {
  voiceState = next;
  const recording = next === "recording";
  const processing = next === "processing";
  els.composer?.classList.toggle("is-voice-recording", recording || processing);
  if (els.voiceButton) {
    els.voiceButton.classList.toggle("is-recording", recording);
    els.voiceButton.classList.toggle("is-processing", processing);
    els.voiceButton.setAttribute("aria-pressed", String(recording));
    els.voiceButton.setAttribute(
      "aria-label",
      recording ? "Cancel voice input" : processing ? "Transcribing voice input" : "Start voice input"
    );
    els.voiceButton.title = recording ? "Cancel recording" : processing ? "Transcribing…" : "Voice input";
  }
  if (els.sendButton) {
    els.sendButton.setAttribute(
      "aria-label",
      recording ? "Confirm and transcribe" : processing ? "Transcribing…" : "Send"
    );
    els.sendButton.title = recording ? "Transcribe into message" : processing ? "Transcribing…" : "Send";
  }
  updateSendButton();
  syncComposerBeam();
}

function preferredRecordingType() {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
    .find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function pcmWavBlob(samples, sampleRate) {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, bytes, true);
  for (let i = 0, offset = 44; i < samples.length; i += 1, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function voiceRecordingWav(blob) {
  if (String(blob.type || "").toLowerCase().includes("wav")) return blob;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx || !Offline) throw new Error("Voice input is not supported in this browser.");
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const frames = Math.max(1, Math.ceil(decoded.duration * rate));
    const offline = new Offline(1, frames, rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return pcmWavBlob((await offline.startRendering()).getChannelData(0), rate);
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function finishVoiceRecording() {
  const chunks = voiceChunks;
  const commit = voiceCommit;
  const mimeType = chunks[0]?.type || "audio/webm";
  voiceChunks = [];
  voiceStream?.getTracks().forEach((track) => track.stop());
  voiceStream = null;
  voiceRecorder = null;
  voiceCommit = true;
  if (!commit) {
    setVoiceState("idle");
    return;
  }
  setVoiceState("processing");
  const blob = new Blob(chunks, { type: mimeType });
  if (!blob.size) {
    showToast("No speech was detected.");
    setVoiceState("idle");
    return;
  }
  try {
    const result = await transcribeSpeech(state.session, await voiceRecordingWav(blob));
    const transcript = String(result.transcript || "").trim();
    if (transcript) {
      const current = composerPlainText();
      const marks = composerSkillMarks();
      setComposerPlainText(`${current}${current && !/\s$/.test(current) ? " " : ""}${transcript}`, marks);
      els.promptInput.dispatchEvent(new Event("input", { bubbles: true }));
      els.promptInput.focus();
    } else {
      showToast("No speech was detected.");
    }
  } catch (error) {
    showToast(error?.message || "Speech transcription failed.");
  }
  setVoiceState("idle");
}

async function startVoiceRecording() {
  if (!state.config?.services?.speech) {
    showToast("Voice input is not configured.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    showToast("Voice input is not supported in this browser.");
    return;
  }

  try {
    setVoiceState("processing");
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = [];
    voiceCommit = true;
    const mimeType = preferredRecordingType();
    voiceRecorder = new MediaRecorder(voiceStream, mimeType ? { mimeType } : undefined);
    voiceRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) voiceChunks.push(event.data);
    });
    voiceRecorder.addEventListener("error", () => {
      showToast("Recording failed.");
      stopVoiceRecording({ commit: false });
    });
    voiceRecorder.addEventListener("stop", finishVoiceRecording, { once: true });
    setVoiceState("recording");
    voiceRecorder.start();
  } catch (error) {
    voiceStream?.getTracks().forEach((track) => track.stop());
    voiceStream = null;
    voiceRecorder = null;
    voiceChunks = [];
    setVoiceState("idle");
    showToast(error?.name === "NotAllowedError" ? "Microphone access was blocked." : "Could not start voice input.");
  }
}

function stopVoiceRecording({ commit }) {
  if (voiceState !== "recording") return;
  voiceCommit = Boolean(commit);
  setVoiceState("processing");
  if (voiceRecorder?.state === "recording") voiceRecorder.stop();
  else finishVoiceRecording();
}

function toggleVoiceRecording() {
  if (voiceState === "processing") return;
  if (voiceState === "recording") {
    stopVoiceRecording({ commit: false });
    return;
  }
  startVoiceRecording();
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

function patchKluiThinkingInPlace(message) {
  const id = message?.id ? String(message.id) : "";
  if (!id) return false;
  if (rawTextContent(message?.content).trim() && !isProvisionalToolProse(message)) return false;
  const surface = els.messages.querySelector(`[data-message-id="${cssString(id)}"]`);
  const contentEl = surface?.querySelector(".message-content");
  if (!contentEl) return false;
  const label = currentThinkingStatus(message, { streaming: true });
  if (!label) return false;
  const active = !isFinalFinishReason(message?.finishReason);
  const update = currentThinkingUpdate(message, { streaming: true });
  let bar = contentEl.querySelector(".klui-bar");
  if (!bar) {
    contentEl.insertAdjacentHTML("afterbegin", renderKluiThinkingStatus(message, { label, update: update?.text, updateKey: update?.key, active }));
    hydrateKluiBars(contentEl);
    return true;
  }
  updateKluiBar(bar, { label, update: update?.text, updateKey: update?.key, active });
  return true;
}

function queueStreamRenderForEvent(message, event) {
  if (isStreamDeltaEvent(event)) {
    // While still thinking (no answer text), keep the Klui bar alive — reasoning
    // deltas previously remounted it every chunk and chopped slot-text mid-roll.
    if (!rawTextContent(message?.content).trim() && patchKluiThinkingInPlace(message)) return;
    queueStreamingMessageRender(message);
    return;
  }
  if (patchKluiThinkingInPlace(message)) return;
  queueRenderMessages();
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
  if (studyHub?.handleEscape?.()) return true;
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
  if (projectsRouteFromLocation() || studyRouteFromLocation()) return;
  if (routeConversationId) {
    state.activeConversationId = state.conversations.some((conversation) => conversation.id === routeConversationId)
      ? routeConversationId
      : "";
  }
  if (state.activeConversationId && !state.conversations.some((conversation) => conversation.id === state.activeConversationId)) {
    state.activeConversationId = "";
  }
  if (!routeConversationId) state.activeConversationId = "";
  if (state.activeConversationId) {
    const loadResult = await loadActiveConversation();
    const run = getConversationRun(state.activeConversationId);
    const hasLiveRun = Boolean(run?.messages) && !(run.mode === "research" && !run.abortController);
    if (loadResult === "applied" && !hasLiveRun) {
      state.conversationLoading = false;
      renderShell();
      await restorePendingDocuments();
    }
  } else {
    state.messages = [];
    stopExtractedModulePollers();
  }
  if (routeConversationId && !state.activeConversationId) syncConversationUrl({ replace: true });
}

async function loadActiveConversation() {
  const id = state.activeConversationId;
  const loadGeneration = ++conversationLoadGeneration;
  if (!id) {
    state.messages = [];
    state.conversationLoading = false;
    stopExtractedModulePollers();
    syncActiveRunningUi();
    return "applied";
  }
  if (restoreLiveConversationRun(id)) {
    state.conversationLoading = false;
    researchController.resumeResearchPolling();
    return "applied";
  }
  const cachedAtStart = conversationCache.get(id);
  const payload = await fetchConversation(state.session, id);
  if (loadGeneration !== conversationLoadGeneration || state.activeConversationId !== id) {
    if (!getConversationRun(id) && conversationCache.get(id) === cachedAtStart) {
      rememberConversation(id, payload.messages || []);
      return "cached";
    }
    return false;
  }
  if (restoreLiveConversationRun(id)) {
    state.conversationLoading = false;
    researchController.resumeResearchPolling();
    return "applied";
  }
  rememberConversation(id, payload.messages || []);
  state.messages = payload.messages || [];
  state.conversationLoading = false;
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
  return "applied";
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

function restoreCancelledTurnDraft(result, run = getConversationRun()) {
  if (result?.run?.status !== "cancelled") return false;
  if (result.run.conversation_id && result.run.conversation_id !== state.activeConversationId) return false;
  const remainingMessages = state.messages.filter((message) =>
    message !== run?.userMessage && message !== run?.assistantMessage);
  state.messages = remainingMessages;
  if (run) run.messages = remainingMessages;
  if (!remainingMessages.length) {
    for (const item of [...state.images, ...(run?.draft?.images || [])]) {
      forgetPendingDocument(item);
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    setComposerPlainText("");
    state.pastedText = "";
    state.images = [];
    clearFollowUps();
    renderImages();
    applyComposerHeight();
    renderMessages();
    return true;
  }
  const content = result.user_message?.content;
  const restoredText = content == null ? (run?.draft?.text || "") : textFromMessageContent(content);
  const restoredMarks = result.user_message?.metadata?.skillMarks
    || (result.user_message?.metadata?.skillIds || run?.draft?.skillIds || []).map((id) => ({ id, at: 0 }));
  setComposerPlainText(restoredText, restoredMarks);
  const parts = Array.isArray(content) ? content : [];
  state.images = parts.length
    ? parts.map(restoredTurnAttachment).filter(Boolean)
    : (run?.draft?.images || []);
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
  renderMessages();
  els.promptInput.focus();
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
    const pinned = state.autoScroll && isNearBottom(els.messages, 120);
    const scrollTop = els.messages.scrollTop;
    endConversationRun(runKey);
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
      settleLiveMessages({ pinned, scrollTop });
    } else {
      loadConversations().catch(() => {});
    }
  }
}

async function loadChatApp() {
  await Promise.all([loadModels(), loadConversations(), loadProjects()]);
  if (studyRouteFromLocation()) {
    await loadStudyHub();
    state.studyOpen = true;
    state.projectsOpen = false;
    state.activeCourseId = courseIdFromLocation();
    state.activeConversationId = "";
    state.messages = [];
    renderShell();
    if (state.activeCourseId) {
      try {
        await studyHub.loadCourse();
      } catch (error) {
        showToast(error.message || "Course could not be loaded.");
        state.activeCourseId = "";
      }
      renderShell();
    }
    return;
  }
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
  clearClarification();
  researchController.stopResearchPolling();
  studyHub.closeSession();
  state.activeConversationId = "";
  state.conversationLoading = false;
  state.projectsOpen = false;
  state.studyOpen = false;
  state.activeCourseId = "";
  state.activeProjectId = "";
  state.activeProject = null;
  state.messages = [];
  state.images = [];
  state.pastedText = "";
  state.compareDescribeImages = false;
  stopPendingArtifactPolls();
  clearFollowUps();
  clearComposerSkills();
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
  if (isNative()) focusPromptInput();
  else els.promptInput?.focus();
}

async function addConversation() {
  if (!requireAuth()) return;
  openNewChat();
}

async function startMamoPayment(planId) {
  if (isNative()) return;
  if (!requireAuth()) return;
  try {
    const payload = await createMamoCheckout(state.session, planId);
    if (payload.paymentUrl) await openExternal(payload.paymentUrl);
  } catch (err) {
    showToast(err.message);
  }
}

async function startZiinaPayment(planId) {
  if (isNative()) return;
  if (!requireAuth()) return;
  await paymentRequestsPromise;
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
    if (conversationRuns.has(id)) {
      showToast("Stop the response in this chat before deleting it.");
      return;
    }
    try {
      await deleteConversation(state.session, id);
      void refreshAccountStorage();
    } catch (err) {
      showToast(err.message || "Chat could not be deleted.");
    }
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
  conversationCache.delete(id);
  if (state.activeProject?.conversations) {
    state.activeProject.conversations = state.activeProject.conversations.filter((conversation) => conversation.id !== id);
  }
  if (state.studyProjectDetail?.conversations) {
    state.studyProjectDetail.conversations = state.studyProjectDetail.conversations.filter((conversation) => conversation.id !== id);
  }
  unpinChat(id);

  if (wasActive) {
    state.activeConversationId = "";
    state.messages = [];
    stopExtractedModulePollers();
    clearFollowUps();
    clearComposerSkills();
    closeDocumentViewer();
    compareController.closeCompareContextBanner();
    syncConversationUrl({ replace: true });
    syncActiveRunningUi();
  }

  renderShell();
  if (isSearchDialogOpen()) renderSearchResults(els.searchChatInput?.value || "");

  try {
    await deleteConversation(state.session, id);
    void refreshAccountStorage();
  } catch (err) {
    if (!state.conversations.some((conversation) => conversation.id === id)) {
      state.conversations.splice(Math.min(index, state.conversations.length), 0, deletedConversation);
    }
    if (
      deletedConversation
      && state.studyProjectDetail?.conversations
      && deletedConversation.project_id === state.studyProjectDetail.project?.id
      && !state.studyProjectDetail.conversations.some((conversation) => conversation.id === id)
    ) {
      state.studyProjectDetail.conversations = [deletedConversation, ...state.studyProjectDetail.conversations];
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

async function sendPrompt({
  textOverride = null,
  displayTextOverride = null,
  pasteOverride = null,
  skipClarification = false
} = {}) {
  hideAttachmentModelNotice();
  if (state.clarificationChecking) return;
  if (state.clarification && textOverride == null) {
    continueClarification();
    return;
  }
  if (voiceState === "recording") {
    stopVoiceRecording({ commit: true });
    return;
  }
  if (voiceState === "processing") return;
  if (state.session && !hasChatAccess()) {
    openUpgradePlans();
    return;
  }
  let text = textOverride == null ? composerSnapshot().text : String(textOverride).trim();
  if (document.body.classList.contains("capacitor-native")) {
    els.promptInput?.blur();
    void hideNativeKeyboard();
  }
  if (state.running) {
    if (state.activeResearchId) {
      showToast("Wait for Deep Research to finish or cancel it first.");
      return;
    }
    if (!requireAuth()) return;
    addFollowUpFromInput();
    return;
  }
  const sendSkillSnapshot = textOverride == null ? composerSnapshot() : { text, marks: [] };
  let sendSkillIds = [...state.composerSkillIds];
  let sendSkillMarks = sendSkillSnapshot.marks;
  if (textOverride == null && state.followUps.length) {
    const candidateSkillIds = mergeComposerSkillIds(
      ...state.followUps.map((item) => item.skillIds),
      sendSkillIds
    );
    const candidateImages = [...followUpBatchImages(state.followUps), ...state.images];
    const candidateCompareModels = resolveCompareModelsForSend({ images: candidateImages });
    if (illustrationSendBlocked(candidateSkillIds, candidateCompareModels)) {
      showToast("Illustration works in standard chat.");
      return;
    }
    if (visualizeSendBlocked(candidateSkillIds, candidateCompareModels)) {
      showToast("Visualize works with one model at a time.");
      return;
    }
  }
  if (textOverride == null && !text && state.followUps.length) {
    const queued = drainFollowUps();
    text = followUpBatchText(queued);
    state.images = [...followUpBatchImages(queued), ...state.images];
    sendSkillIds = mergeComposerSkillIds(...queued.map((item) => item.skillIds), sendSkillIds);
    sendSkillMarks = followUpBatchSkillMarks(queued);
    renderImages();
  } else if (textOverride == null && text && state.followUps.length) {
    const queued = drainFollowUps();
    const queuedText = followUpBatchText(queued);
    const queuedMarks = followUpBatchSkillMarks(queued);
    const currentOffset = queuedText ? queuedText.length + 2 : 0;
    text = [queuedText, text].filter(Boolean).join("\n\n");
    state.images = [...followUpBatchImages(queued), ...state.images];
    sendSkillIds = mergeComposerSkillIds(...queued.map((item) => item.skillIds), sendSkillIds);
    sendSkillMarks = [
      ...queuedMarks,
      ...sendSkillMarks.map((mark) => ({ ...mark, at: mark.at + currentOffset }))
    ];
    renderImages();
  }
  sendSkillMarks = normalizeClientSkillMarks(sendSkillMarks, sendSkillIds, text.length);
  const pastedText = textOverride == null ? state.pastedText.trim() : "";
  const paste = textOverride == null
    ? pastedText
      ? { start: text ? text.length + 2 : 0, length: pastedText.length }
      : null
    : pasteOverride;
  if (pastedText) text = text ? `${text}\n\n${pastedText}` : pastedText;
  if (text.length > 100000) {
    showToast("Message is too long. Shorten the typed text or pasted content.");
    return;
  }
  if (!text && !state.images.length) return;
  if (!requireAuth()) return;
  if (state.researchMode && !skipClarification && await maybeRequestClarifications(text, paste)) return;
  if (state.researchMode) {
    if (state.images.length) {
      showToast("Deep Research currently supports text questions only.");
      return;
    }
    await researchController.startDeepResearch(text, displayTextOverride || text);
    return;
  }
  const pendingImages = state.images.map((img) => ({
    file: img.file,
    category: img.category,
    previewUrl: img.previewUrl,
    attachmentId: img.attachmentId,
    uploaded: img.uploaded
  }));
  const compareModels = resolveCompareModelsForSend({ images: pendingImages });
  if (sendSkillIds.includes("illustration") && (state.temporaryChat || compareModels.length)) {
    showToast("Illustration works in standard chat.");
    return;
  }
  if (visualizeSendBlocked(sendSkillIds, compareModels)) {
    showToast("Visualize works with one model at a time.");
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
    images: pendingImages,
    compareModels,
    council: Boolean(compareModels.length && isCouncilMode()),
    describeImages: Boolean(compareModels.length && compareIncludesTextOnlyModels(compareModels)),
    paste,
    skillIds: sendSkillIds,
    skillMarks: sendSkillMarks
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

  const compareModels = resolveCompareModelsForSend({ images: [], keepAttachments });
  await executeSend({
    text,
    images: [],
    compareModels,
    council: Boolean(compareModels.length && isCouncilMode()),
    describeImages: Boolean(compareModels.length && compareIncludesTextOnlyModels(compareModels)),
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
    await streamConversationMessage(state.session, conversationId, {
      retryAssistantMessageId: assistantMessageId,
      ...(responseAdjustment ? { responseAdjustment } : {}),
      role: selectedSingleRole(),
      provider: retryProvider,
      settings: chatRequestSettings(),
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
    const queuedFollowUps = !wasAborted && shouldReloadConversation && stillActive ? drainAutomaticFollowUps() : [];
    const pinned = state.autoScroll && isNearBottom(els.messages, 120);
    const scrollTop = els.messages.scrollTop;
    endConversationRun(runKey);
    if (shouldReloadConversation && stillActive) {
      await loadActiveConversation().catch(() => {});
      settleLiveMessages({ pinned, scrollTop });
    } else if (!stillActive) {
      loadConversations().catch(() => {});
    } else {
      settleLiveMessages({ pinned, scrollTop });
    }
    if (queuedFollowUps.length) {
      const followUpImages = followUpBatchImages(queuedFollowUps);
      const followUpCompareModels = resolveCompareModelsForSend({ images: followUpImages });
      const followUpText = followUpBatchText(queuedFollowUps);
      const followUpSkillIds = mergeComposerSkillIds(...queuedFollowUps.map((item) => item.skillIds));
      await executeSend({
        text: followUpText,
        images: followUpImages,
        compareModels: followUpCompareModels,
        council: Boolean(followUpCompareModels.length && isCouncilMode()),
        describeImages: Boolean(followUpCompareModels.length && compareIncludesTextOnlyModels(followUpCompareModels)),
        skillIds: followUpSkillIds,
        skillMarks: normalizeClientSkillMarks(
          followUpBatchSkillMarks(queuedFollowUps),
          followUpSkillIds,
          followUpText.length
        )
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

async function executeSend({ text, images, compareModels, council = false, describeImages = false, newChat = false, editMessageId = "", keepAttachments = [], paste = null, skillIds = [], skillMarks = [] }) {
  compareController.closeCompareContextBanner();
  const sendSkillIds = editMessageId ? [] : normalizeClientSkillIds(skillIds);
  const sendSkillMarks = editMessageId ? [] : skillMarks.filter((mark) => sendSkillIds.includes(mark.id));
  if (illustrationSendBlocked(sendSkillIds, compareModels)) {
    showToast("Illustration works in standard chat.");
    return;
  }
  if (visualizeSendBlocked(sendSkillIds, compareModels)) {
    showToast("Visualize works with one model at a time.");
    return;
  }

  const temporaryChat = state.temporaryChat;
  const previousTemporaryMessages = temporaryChat ? temporaryHistoryForRequest() : [];
  let createdConversation = false;

  if (!temporaryChat && (newChat || !state.activeConversationId)) {
    const payload = await createConversation(state.session, {
      role: selectedChatRole(),
      projectId: state.activeProjectId || (state.studyOpen ? state.activeCourseId : "") || null
    });
    state.conversations.unshift(payload.conversation);
    state.activeConversationId = payload.conversation.id;
    state.projectsOpen = false;
    state.studyOpen = false;
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
    ...((paste || sendSkillIds.length) ? {
      metadata: {
        ...(paste ? { paste } : {}),
        ...(sendSkillIds.length ? { skillIds: sendSkillIds } : {}),
        ...(sendSkillMarks.length ? { skillMarks: sendSkillMarks } : {})
      }
    } : {}),
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
  setComposerPlainText("");
  state.pastedText = "";
  if (!editMessageId) {
    closeSkillMenu();
  }
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
  activeRun.userMessage = localUser;
  activeRun.assistantMessage = localAssistant;
  activeRun.draft = { text, images, skillIds: sendSkillIds, skillMarks: sendSkillMarks };
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
    for (const img of images) {
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
    const payload = {
      text,
      clientTurnKey: (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`,
      attachments: uploaded.map((item) => item.id),
      role: selectedChatRole(),
      provider,
      settings: chatRequestSettings(),
      writingStyle: normalizeWritingStyle(state.settings.writingStyle),
      skillIds: sendSkillIds,
      skillMarks: sendSkillMarks,
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
        ...payload
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
          setComposerPlainText(text, sendSkillMarks);
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
    const queuedFollowUps = !wasAborted && shouldReloadConversation && stillActive ? drainAutomaticFollowUps() : [];
    const pinned = state.autoScroll && isNearBottom(els.messages, 120);
    const scrollTop = els.messages.scrollTop;
    endConversationRun(runKey);
    if (shouldReloadConversation && !temporaryChat && stillActive) {
      const reloaded = await loadActiveConversation().catch(() => false);
      if (reloaded === "applied") {
        for (const url of sentPreviewUrls) URL.revokeObjectURL(url);
      }
      settleLiveMessages({ pinned, scrollTop });
    } else if (stillActive) {
      settleLiveMessages({ pinned, scrollTop });
    } else if (!temporaryChat) {
      loadConversations().catch(() => {});
    }
    if (queuedFollowUps.length) {
      const followUpImages = followUpBatchImages(queuedFollowUps);
      const followUpCompareModels = resolveCompareModelsForSend({ images: followUpImages });
      const followUpText = followUpBatchText(queuedFollowUps);
      const followUpSkillIds = mergeComposerSkillIds(...queuedFollowUps.map((item) => item.skillIds));
      await executeSend({
        text: followUpText,
        images: followUpImages,
        compareModels: followUpCompareModels,
        council: Boolean(followUpCompareModels.length && isCouncilMode()),
        describeImages: Boolean(followUpCompareModels.length && compareIncludesTextOnlyModels(followUpCompareModels)),
        skillIds: followUpSkillIds,
        skillMarks: normalizeClientSkillMarks(
          followUpBatchSkillMarks(queuedFollowUps),
          followUpSkillIds,
          followUpText.length
        )
      });
    }
  }
}

async function signOutAndReset() {
  await signOut(state.config, state.session);
  stopExtractedModulePollers();
  state.session = null;
  state.me = null;
  state.memory = null;
  state.paymentRequests = [];
  state.conversations = [];
  conversationCache.clear();
  state.pinnedChatIds = [];
  state.messages = [];
  state.pastedText = "";
  state.temporaryChat = false;
  clearClarification();
  clearFollowUps();
  clearComposerSkills();
  state.activeConversationId = "";
  closeDocumentViewer();
  syncConversationUrl({ replace: true });
  closeAllDrawers();
  renderShell();
}

/* ─── Bootstrap ─── */

let richTextAssetsPromise;

function loadRichTextAssets() {
  if (richTextAssetsPromise) return richTextAssetsPromise;
  document.head.insertAdjacentHTML("beforeend", `
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.46/dist/katex.min.css">
    <link rel="stylesheet" id="hljsLight" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/github.min.css">
    <link rel="stylesheet" id="hljsDark" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/github-dark.min.css" disabled>
  `);
  applyCodeHighlightTheme(resolvedAppearance());
  richTextAssetsPromise = Promise.allSettled([
    "https://cdn.jsdelivr.net/npm/katex@0.16.46/dist/katex.min.js",
    "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/highlight.min.js"
  ].map((src) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  }))).then((results) => {
    // Markdown is loaded in the document head; only the heavier math and
    // highlighting tools upgrade an already-visible conversation later.
    if (state.messages.length) queueRenderMessages();
    return results;
  });
  return richTextAssetsPromise;
}

async function hydrateNativeSettings() {
  if (!isNative()) return;
  const saved = await preferences.get(SETTINGS_KEY);
  if (!saved) return;
  localStorage.setItem(SETTINGS_KEY, saved);
  state.settings = loadSettings();
}

async function bootstrap() {
  await hydrateNativeSettings();
  applyAppearance();
  applyTextScale();
  try {
    const [config, plansPayload, session] = await Promise.all([
      fetchConfig(),
      fetchPlans(),
      parseSessionFromUrl() || loadSession()
    ]);
    state.config = config;
    state.buildId = String(config?.buildId || "");
    state.plans = plansPayload.plans || [];
    state.session = session;
    state.composerSkills = Array.isArray(state.config?.skills) ? state.config.skills : [];
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
      },
      buildCheck: () => checkWebBuild({ force: true }),
      buildId: state.buildId
    });
    startWebBuildMonitor();
    const authError = parseAuthErrorFromUrl();
    if (authError) showToast(authError);
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
      } catch {
        await clearSession();
        state.session = null;
      }
    }
    renderShell();
    void loadRichTextAssets();
    if (state.session) {
      paymentRequestsPromise = loadPaymentRequests();
      void paymentRequestsPromise.then(() => {
        if (!els.paywallView.classList.contains("hidden")) renderPlans();
      });
    }
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
  return Boolean(composerPlainText().trim() || state.pastedText || state.images?.length);
}

function reloadAppIfSafe() {
  window.location.reload();
}

function composerHasFocus() {
  return Boolean(els.composer?.contains(document.activeElement));
}

async function showNativeKeyboard() {
  if (!isNative()) return;
  try {
    await showNativeKeyboardInstant();
  } catch {
    try {
      const { Keyboard } = await import("@capacitor/keyboard");
      await Keyboard.show();
    } catch {
      // The input focus still remains correct if an older Android build cannot
      // show the IME programmatically.
    }
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
  if (!document.body.classList.contains("keyboard-open")) void showNativeKeyboard();
}

function focusPromptInputSoon() {
  if (!isNative()) return;
  focusPromptInput();
}

function setAutoScroll(enabled) {
  state.autoScroll = Boolean(enabled);
}

function bindEvents() {
  initDocumentViewerWidth();
  els.appUpdateReload?.addEventListener("click", reloadAppIfSafe);
  els.messages?.addEventListener("click", (event) => {
    if (event.target.closest("[data-message-error-reload]")) reloadAppIfSafe();
  });
  if (els.messages) els.messages.style.overflowAnchor = "none";

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
  els.sideChatMessages?.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-add-to-card]");
    if (!btn || btn.disabled || !sideChatState.onAddToCard) return;
    const index = Number(btn.dataset.addToCard);
    const message = sideChatState.messages[index];
    const text = message?.role === "assistant" ? rawTextContent(message.content).trim() : "";
    if (!text) return;
    btn.disabled = true;
    btn.textContent = "Adding…";
    if (await sideChatState.onAddToCard(text)) {
      sideChatState.added.add(index);
      btn.textContent = "Added";
    } else {
      btn.disabled = false;
      btn.textContent = "Add to this card";
    }
  });
  els.sideChatSend?.addEventListener("click", () => { void sendSideChatMessage(); });
  els.sideChatInput?.addEventListener("input", () => {
    els.sideChatSend.disabled = sideChatState.running || !sideChatState.context;
  });
  els.sideChatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendSideChatMessage();
    }
  });
  els.sideChatMessages?.addEventListener("wheel", (event) => {
    if (event.deltaY < 0) sideChatState.autoScroll = false;
    else if (event.deltaY > 0 && isNearBottom(els.sideChatMessages, 40)) sideChatState.autoScroll = true;
  }, { passive: true });
  els.sideChatMessages?.addEventListener("touchstart", (event) => {
    sideChatState.touchY = event.touches?.[0]?.clientY ?? 0;
  }, { passive: true });
  els.sideChatMessages?.addEventListener("touchmove", (event) => {
    const y = event.touches?.[0]?.clientY ?? sideChatState.touchY;
    if (y > sideChatState.touchY + 2) sideChatState.autoScroll = false;
    else if (y < sideChatState.touchY - 2 && isNearBottom(els.sideChatMessages, 40)) sideChatState.autoScroll = true;
    sideChatState.touchY = y;
  }, { passive: true });
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
  els.messages.addEventListener("click", (event) => {
    const pill = event.target.closest(".sources-pill");
    if (pill) requestAnimationFrame(() => positionSourcesPill(pill));
  });
  let chatNavigationFrame = 0;
  const queueChatNavigationUpdate = () => {
    if (chatNavigationFrame) return;
    chatNavigationFrame = requestAnimationFrame(() => {
      chatNavigationFrame = 0;
      updateChatScrollNavigation();
    });
  };
  els.messages.addEventListener("scroll", queueChatNavigationUpdate, { passive: true });
  els.messages.addEventListener("load", (event) => {
    if (!event.target.closest?.("img.message-image") || !state.autoScroll) return;
    requestAnimationFrame(pinMessagesToBottom);
  }, true);
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
  els.paywallPlans.addEventListener("click", (e) => {
    const mamoButton = e.target.closest("[data-start-mamo]");
    if (mamoButton) {
      startMamoPayment(mamoButton.dataset.startMamo);
      return;
    }
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
  els.sidebarCloseButton?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
  });
  els.promptInput?.addEventListener("click", () => {
    if (!isNative()) return;
    els.promptInput.focus({ preventScroll: true });
    void showNativeKeyboard();
  });
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
  els.studyHubButton?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
    void loadStudyHub().then((hub) => hub.openCourses());
  });
  els.projectChatCrumb?.addEventListener("click", () => {
    const courseId = els.projectChatCrumb.dataset.courseId;
    if (courseId) {
      void loadStudyHub().then(() => studyHub.openCourse(courseId, { tab: "chat" }));
      return;
    }
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
    scheduleSearchBody(event.target.value);
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
  els.profileMenuStorage?.addEventListener("click", () => {
    closeProfileMenu();
    openSettings();
    setSettingsTab("storage");
  });
  els.profileMenuAdmin?.addEventListener("click", openAdminDrawer);
  els.profileMenuSignOut?.addEventListener("click", () => {
    closeProfileMenu();
    signOutAndReset();
  });
  els.closeAccountButton.addEventListener("click", closeAccount);
  els.settingsStorageList?.addEventListener("click", handleAccountStorageClick);
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
  els.settingsTabs?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-settings-tab]");
    if (tab) setSettingsTab(tab.dataset.settingsTab);
  });
  els.memoryEnabledInput?.addEventListener("change", (event) => { void setMemoryEnabled(event.target.checked); });
  els.saveMemoryButton?.addEventListener("click", () => { void saveMemorySettings(); });
  els.clearMemoryButton?.addEventListener("click", () => { void clearMemorySettings(); });
  els.exportAccountButton?.addEventListener("click", () => { void downloadAccountDataAndSave(); });
  els.cancelSubscriptionButton?.addEventListener("click", () => {
    openDeleteConfirm({
      title: "Cancel subscription?",
      body: "You'll keep access until the end of the current period. Then it stops.",
      confirmLabel: "Cancel",
      onConfirm: cancelMamoSubscriptionAndRefresh
    });
  });
  els.deleteAccountButton?.addEventListener("click", () => {
    openDeleteConfirm({
      title: "Delete account?",
      body: "This permanently deletes your account, chats, files, and data. This cannot be undone.",
      onConfirm: deleteAccountAndReset
    });
  });
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
    if (!event.target.closest(".klui-email-send-wrap")) closeEmailMenus();
    if (!event.target.closest("[data-email-revise-form], [data-email-edit]")) {
      document.querySelectorAll("[data-email-card].is-editing").forEach((card) => setEmailEditing(card, false));
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!state.skillMenu.open) return;
    if (event.target.closest("#skillCommandMenu") || event.target === els.promptInput) return;
    closeSkillMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.querySelector(".klui-email-menu:not([hidden])")) { closeEmailMenus(); return; }
    const editingEmail = document.querySelector("[data-email-card].is-editing");
    if (editingEmail) { setEmailEditing(editingEmail, false); return; }
    if (studyHub.handleEscape()) return;
    if (state.skillMenu.open) { closeSkillMenu(); return; }
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
    if (els.composerModelWrap?.classList.contains("is-open")) { closeModelDropdown(); return; }
    if (els.authDialog.classList.contains("open")) { closeAuthDialog(); return; }
    if (els.accountDrawer.classList.contains("open")) { closeAccount(); return; }
    if (els.settingsDrawer.classList.contains("open")) { closeSettings(); return; }
  });

  els.modelButton.addEventListener("click", (e) => {
    e.stopPropagation();
    closeActionMenu();
    compareController.closeCompareDropdown();
    if (document.body.classList.contains("capacitor-native")) {
      applySpectrumLevel(selectedModelMode() === "pro" ? 1 : 2);
      closeModelDropdown();
      return;
    }
    toggleModelDropdown();
  });

  if (els.spectrumSteps && !els.spectrumSteps.children.length) {
    for (let i = 0; i < SPECTRUM_N; i++) els.spectrumSteps.appendChild(document.createElement("i"));
  }

  function spectrumFromPointer(e) {
    const track = els.spectrumTrack;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    applySpectrumLevel(Math.round(t * (SPECTRUM_N - 1)));
  }

  if (els.spectrumTrack) {
    els.spectrumTrack.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      spectrumFromPointer(e);
      const move = (ev) => spectrumFromPointer(ev);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

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
    if (!els.composerModelWrap?.contains(e.target)) {
      closeModelDropdown();
    }
    if (!els.composerActionMenu.contains(e.target) && !els.composerActionMenuWrap.contains(e.target)) {
      closeActionMenu();
    }
    if (!els.compareDropdown.contains(e.target) && !els.compareWrap.contains(e.target)) {
      compareController.closeCompareDropdown();
    }
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
    if (!isNative()) els.promptInput?.focus();
  });

  // ── Mode chip dropdown (APK only) ──────────────────────────────────
  // Renders the current mode label inside the top-bar chip and wires
  // the dropdown open/close + selection handlers.
  function renderTopBarMode() {
    const mode = currentNativeTopBarMode();
    const label = els.nativeMobileModeLabel;
    if (label) {
      const display = mode === "nitro" ? "Nitro"
        : mode === "thinking" ? "Think"
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
      const card = document.querySelector(".visualize-card.is-expanded");
      if (card) card.querySelector("[data-visualize-expand]")?.click();
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
    studyHub.closeSession();
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
      if (studyRouteFromLocation()) {
        await loadStudyHub();
        state.studyOpen = true;
        state.projectsOpen = false;
        state.activeProjectId = "";
        state.activeProject = null;
        state.activeCourseId = courseIdFromLocation();
        state.activeConversationId = "";
        state.messages = [];
        renderShell();
        if (state.activeCourseId) {
          try {
            await studyHub.loadCourse();
          } catch (error) {
            showToast(error.message || "Course could not be loaded.");
            state.activeCourseId = "";
          }
          renderShell();
        } else {
          loadProjects().then(() => renderShell()).catch(() => {});
        }
        return;
      }
      if (projectsRouteFromLocation()) {
        state.projectsOpen = true;
        state.studyOpen = false;
        state.activeCourseId = "";
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
        state.studyOpen = false;
        state.activeCourseId = "";
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
      state.projectsOpen = false;
      state.studyOpen = false;
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
    els.imageFileInput.click();
  });
  els.imageFileInput.addEventListener("change", (e) => {
    acceptPendingFiles(e.target.files || []);
    e.target.value = "";
  });
  els.cameraAction?.addEventListener("click", () => {
    closeActionMenu();
    if (!requireAuth()) return;
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
    if (state.researchMode) return;
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
        deleteAttachment(state.session, deleteId).then(() => refreshAccountStorage()).catch((err) => {
          showToast(err.message || "Attachment could not be deleted.");
        });
      }
      renderImages();
      compareController.syncCompareContextBanner();
      return;
    }
    const thumb = e.target.closest("[data-preview-src]");
    if (thumb) openLightbox(thumb.dataset.previewSrc, thumb.dataset.previewCaption || "");
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
    const visualizeExpand = e.target.closest("[data-visualize-expand]");
    if (visualizeExpand) {
      const card = visualizeExpand.closest(".visualize-card");
      if (!card?.classList.contains("is-expanded")) collapseExpandedVisualize(card);
      const expanded = card?.classList.toggle("is-expanded");
      visualizeExpand.textContent = expanded ? "Close" : "Expand";
      visualizeExpand.setAttribute("aria-pressed", String(Boolean(expanded)));
      document.body.classList.toggle("visualize-expanded", Boolean(document.querySelector(".visualize-card.is-expanded")));
      card?.querySelector("iframe[data-visualize-id]")?.contentWindow?.postMessage({
        type: "klui:visualize:expanded",
        expanded: Boolean(expanded)
      }, "*");
      return;
    }
    const weatherUnit = e.target.closest("[data-weather-units]");
    if (weatherUnit) {
      e.preventDefault();
      const next = weatherUnit.dataset.weatherUnits === "imperial" ? "imperial" : "metric";
      if (state.settings.weatherUnits !== next) {
        updateSetting("weatherUnits", next);
        queueRenderMessages();
      }
      return;
    }
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
      openLightbox(previewImage.dataset.previewSrc, previewImage.dataset.previewCaption || "");
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

    const emailUndo = e.target.closest("[data-email-undo], [data-email-redo]");
    if (emailUndo) {
      e.preventDefault();
      stepEmailHistory(emailUndo.closest("[data-email-card]"), emailUndo.hasAttribute("data-email-undo") ? -1 : 1);
      return;
    }
    const emailEdit = e.target.closest("[data-email-edit]");
    if (emailEdit) {
      e.preventDefault();
      setEmailEditing(emailEdit.closest("[data-email-card]"), true);
      return;
    }
    const emailCopy = e.target.closest("[data-email-copy]");
    if (emailCopy) {
      e.preventDefault();
      copyText(emailCardText(emailCopy.closest("[data-email-card]")))
        .then(() => flashCopySuccess(emailCopy))
        .catch(() => showToast("Copy failed."));
      return;
    }
    const emailSend = e.target.closest("[data-email-send]");
    if (emailSend) {
      e.preventDefault();
      const card = emailSend.closest("[data-email-card]");
      const menu = card?.querySelector(".klui-email-menu");
      if (!card || !menu) return;
      const open = menu.hidden;
      closeEmailMenus();
      menu.hidden = !open;
      emailSend.setAttribute("aria-expanded", String(open));
      return;
    }
    const emailChoice = e.target.closest("[data-email-open]");
    if (emailChoice) {
      e.preventDefault();
      const url = emailComposeUrls[emailChoice.dataset.emailOpen](emailCardValues(emailChoice.closest("[data-email-card]")));
      closeEmailMenus();
      openExternal(url).catch(() => showToast("Could not open email."));
      return;
    }

    const msgCopy = e.target.closest("[data-copy-msg]");
    if (msgCopy) {
      const container = msgCopy.closest("[data-raw-text]");
      const text = container?.dataset.rawText || "";
      copyText(text).then(() => flashCopySuccess(msgCopy)).catch(() => showToast("Copy failed."));
      return;
    }

    const msgReport = e.target.closest("[data-report-msg]");
    if (msgReport) {
      e.preventDefault();
      reportMessage(msgReport.dataset.reportMsg);
      return;
    }
  });

  els.messages.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-email-revise-form]");
    if (!form) return;
    e.preventDefault();
    void submitEmailRevise(form);
  });

  els.messages.addEventListener("keydown", (e) => {
    const previewImage = e.target.closest("[data-preview-src]");
    if (previewImage && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openLightbox(previewImage.dataset.previewSrc, previewImage.dataset.previewCaption || "");
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
    const emailCard = e.target.closest("[data-email-field]")?.closest("[data-email-card]");
    if (emailCard) recordEmailEdit(emailCard);
  });

  els.messages.addEventListener("beforeinput", (e) => {
    const field = e.target.closest("[data-email-field]");
    if (!field) return;
    const card = field.closest("[data-email-card]");
    if (field.dataset.emailField === "subject" && (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak")) {
      e.preventDefault();
      return;
    }
    emailHistory(card);
    if (field.isContentEditable) clearEmailPlaceholderAtCaret(card, e);
  });

  window.addEventListener("message", (event) => applyVisualizeFrameMessage(event));

  let mobileSendHandledOnPointerDown = false;
  els.sendButton.addEventListener("pointerdown", (event) => {
    if (!document.body.classList.contains("capacitor-native") || voiceState === "recording") return;
    event.preventDefault();
    mobileSendHandledOnPointerDown = true;
    void sendPrompt();
  });
  els.sendButton.addEventListener("click", () => {
    if (mobileSendHandledOnPointerDown) {
      mobileSendHandledOnPointerDown = false;
      return;
    }
    if (voiceState === "recording") {
      stopVoiceRecording({ commit: true });
      return;
    }
    sendPrompt();
  });
  els.clarificationCard?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-clarification-option]");
    if (option) {
      selectClarificationOption(Number(option.dataset.clarificationOption));
      return;
    }
    if (event.target.closest("[data-clarification-back]")) {
      if (state.clarification?.index > 0) {
        state.clarification.index -= 1;
        renderClarification();
      }
      return;
    }
    if (event.target.closest("[data-clarification-skip]")) {
      const flow = state.clarification;
      const text = flow?.text || "";
      clearClarification();
      void sendPrompt({ textOverride: text, pasteOverride: flow?.paste, skipClarification: true });
      return;
    }
    if (event.target.closest("[data-clarification-next], [data-clarification-continue]")) continueClarification();
  });
  els.clarificationCard?.addEventListener("input", (event) => {
    if (!event.target.matches(".clarification-custom") || !state.clarification) return;
    state.clarification.answers[state.clarification.index] = event.target.value;
    const button = els.clarificationCard.querySelector("[data-clarification-continue]");
    if (button) button.disabled = !event.target.value.trim();
  });
  els.clarificationCard?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && event.target.matches(".clarification-custom")) {
      event.preventDefault();
      continueClarification();
    }
  });
  els.attachmentModelNoticeClose?.addEventListener("click", hideAttachmentModelNotice);
  els.voiceButton?.addEventListener("click", toggleVoiceRecording);
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
        restoreCancelledTurnDraft(result, run);
      }).catch((error) => showToast(error.message || "The pending turn could not be cancelled."))
        .finally(() => run.abortController?.abort());
      return;
    }
    restoreCancelledTurnDraft({ run: { status: "cancelled" } }, run);
    run.abortController?.abort();
  });

  els.promptInput.addEventListener("input", () => {
    if (state.clarification || state.clarificationChecking) clearClarification();
    syncComposerSkillState();
    els.composer?.classList.remove("compact");
    applyComposerHeight();
    updateSendButton();
    renderContextMeter();
    syncSkillMenu();
  });
  els.promptInput.addEventListener("click", () => syncSkillMenu());
  els.promptInput.addEventListener("keyup", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) syncSkillMenu();
  });
  els.promptInput.addEventListener("compositionstart", () => {
    state.skillMenu.composing = true;
  });
  els.promptInput.addEventListener("compositionend", () => {
    state.skillMenu.composing = false;
    syncSkillMenu();
  });
  els.promptInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (document.activeElement === els.promptInput) return;
      if (els.skillCommandMenu?.contains(document.activeElement)) return;
      closeSkillMenu();
    }, 0);
  });
  els.promptInput.addEventListener("keydown", (e) => {
    if (state.skillMenu.open && !e.isComposing && e.key !== "Process") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSkillActive(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSkillActive(-1);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const rows = filteredSkillRows();
        const skill = rows[state.skillMenu.active];
        e.preventDefault();
        if (skill) selectComposerSkill(skill);
        else closeSkillMenu();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSkillMenu();
        return;
      }
    }
    if (e.key === "Backspace" && !e.isComposing) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range?.collapsed) {
        const node = range.startContainer;
        const offset = range.startOffset;
        let chip = null;
        if (node === els.promptInput && offset > 0 && els.promptInput.childNodes[offset - 1]?.dataset?.skillId) {
          chip = els.promptInput.childNodes[offset - 1];
        } else if (node.nodeType === Node.TEXT_NODE && offset === 0 && node.previousSibling?.dataset?.skillId) {
          chip = node.previousSibling;
        }
        if (chip) {
          e.preventDefault();
          chip.remove();
          syncComposerSkillState();
          return;
        }
      }
    }
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      insertComposerText("\n");
      applyComposerHeight();
      updateSendButton();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (voiceState === "recording") {
        stopVoiceRecording({ commit: true });
        return;
      }
      sendPrompt();
    }
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
    e.preventDefault();
    if (isLongPaste && !state.running) {
      addTextToComposerPaste(pasted);
      return;
    }
    insertComposerText(pasted);
    applyComposerHeight();
    updateSendButton();
    syncSkillMenu();
  });

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
  els.appearancePill?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-appearance]");
    if (!btn) return;
    updateSetting("appearance", APPEARANCES.has(btn.dataset.appearance) ? btn.dataset.appearance : "system");
  });
  els.wallpaperPicker?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-wallpaper]");
    if (!btn) return;
    updateSetting("wallpaper", HOME_WALLPAPERS.has(btn.dataset.wallpaper) ? btn.dataset.wallpaper : "clouds");
  });
  els.colorPresetRow?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-accent]");
    if (!btn) return;
    updateSetting("colorPreset", COLOR_PRESETS.has(btn.dataset.accent) ? btn.dataset.accent : "default");
  });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (state.settings.appearance === "system") applyAppearance();
  });

  els.loadAdminButton.addEventListener("click", () => { void adminPanel.loadAdminDashboard(); });
  els.adminOutput.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-admin-tab]");
    if (tab) {
      adminPanel.setAdminQueueTab(tab.dataset.adminTab);
      return;
    }
    const done = e.target.closest("[data-resolve-report]");
    if (done) {
      adminPanel.resolveReport(done.dataset.resolveReport, done.dataset.resolveStatus);
      return;
    }
    const approve = e.target.closest("[data-approve-payment]");
    if (approve) {
      adminPanel.updateAdminPayment(approve.dataset.approvePayment, "approve");
      return;
    }
    const reject = e.target.closest("[data-reject-payment]");
    if (reject) adminPanel.updateAdminPayment(reject.dataset.rejectPayment, "reject");
  });

  loadGoogleFonts();
}

document.body.classList.toggle(
  "capacitor-native",
  isNative() || window.matchMedia("(max-width: 860px)").matches
);
bindEvents();
if (location.hash === "#settings") {
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  openSettings();
}
bootstrap();
