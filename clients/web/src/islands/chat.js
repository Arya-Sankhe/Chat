// The chat core: the old app's conversation code (public/js/app.js), carried over
// verbatim and grown one slice at a time. It owns #messages, the guest-continue
// card and the turn/run bookkeeping; React owns the shell around it. Functions
// the React store already implements come in through the bridges below under
// their old names, so the copied code reads as it did.
//
// Island changes, kept small so each function still diffs against app.js:
// - writes to store-owned values replace them (`state.conversations = [...]`)
//   instead of mutating, and body classes the store owns are set through it;
// - native-only pieces (app update, keyboard, text zoom) join with the Expo slice.
import { session } from "../app/runtime";
import { state, els } from "../state/legacy";
import {
  applySpectrumLevel,
  chatHooks,
  chatSurfaces,
  closeActionMenu,
  closeAllDrawers,
  closeAuthDialog,
  closeConfirmDialog,
  closeTopNativeSurface,
  closeConversationMenus,
  closePinnedPopup,
  closeProfileMenu,
  closeSearchDialog,
  closeSettings,
  dismissComposerKeyboard,
  blockedOnFree,
  countFreeUse,
  freeAllowance,
  hasChatAccess,
  hasUpgradePlans,
  isFreeAccount,
  promptUpgrade,
  isCouncilMode,
  openAuthDialog,
  openDeleteConfirm,
  openTitleRename,
  renderShell,
  savePinnedChatIds,
  closeAccount,
  setSettingsTab,
  showToast,
  startSidebarLogin,
  unpinChat,
  updateSetting,
  useApp
} from "../state/app";
import { homeModes as homeModesController } from "../state/homeModes";
import { loadMe } from "../state/boot";
import { loadAccountStorage, loadSettingsTab, resetAccountData } from "../state/account";
import { applyCouponFromUrl, resetBilling } from "../state/billing";
import { setCameraPhotoHandler } from "../state/camera";
import {
  VISUALIZE_REPAIRING_LABEL,
  applyVisualizeFrameMessage,
  compactModelDisplayName,
  emailCardFields,
  escapeHtml,
  fileTypeIcon,
  getCodeSource,
  gmailComposeUrl,
  hasEmailCardBlock,
  mailtoComposeUrl,
  modelBrandLogoUrl,
  modelSupportsVision,
  outlookComposeUrl,
  renderContent,
  renderPlainText,
  resetCodeSourceStore,
  stripRedundantSourcesFooter
} from "./render.js";
import {
  createProject,
  deleteProject,
  updateProject,
  updateConversation,
  generateStudyContent,
  deleteStudyMaterial,
  fetchStudyQueue,
  updateStudyCard,
  deleteStudyCard,
  updateStudyDeck,
  deleteStudyDeck,
  fetchStudyQuiz,
  updateStudyQuiz,
  deleteStudyQuiz,
  fetchStudyPodcast,
  updateStudyPodcast,
  deleteStudyPodcast,
  prepareStudyTutor,
  fetchStudyTutor,
  updateStudyTutor,
  deleteStudyTutor,
  transcribeTutorAudio,
  streamTutorTurn,
  endStudyTutor,
  openTutorBoard,
  submitStudyQuizAttempt,
  exportStudyNote,
  deleteStudyNote,
  askDocument,
  cancelPendingDocumentTurn,
  cancelResearch,
  completeUpload,
  createContentReport,
  createConversation,
  createResearch,
  createStudyCard,
  createStudyNote,
  deleteAttachment,
  deleteConversation,
  downloadAttachment,
  exportEditableDocument,
  exportResearchReport,
  fetchAttachmentView,
  fetchConversation,
  fetchDocumentJobStatus,
  fetchDocumentStatus,
  fetchProject,
  fetchResearchReport,
  fetchResearchStatus,
  fetchStudyMaterials,
  fetchStudyPractice,
  listConversations,
  listProjects,
  presignUpload,
  putUploadContent,
  requestClarifications,
  reviseEditableDocument,
  reviseEmailDraft,
  saveEditableDocument,
  streamCompareConversationMessage,
  streamConversationMessage,
  streamTemporaryChat,
  synthesizeVoice,
  transcribeSpeech,
  transcribeVoiceTurn,
  uploadFile,
  warmVoiceMode,
  approveAdminPayment,
  fetchAdminSummary,
  rejectAdminPayment,
  resolveAdminReport,
  updateAdminSettings
} from "./api.js";
import { guestDraftHasPreview, guestPreviewContent, liveGuestImages, serializeGuestDraft } from "./guestSend.js";
import {
  hydrateKluiBars,
  renderHomeGreetingHtml,
  renderKluiThinkingStatus,
  startHomeGreeting,
  stopHomeGreeting,
  updateKluiBar
} from "./klui.js";
import { replaceEmailFence } from "./email.js";
import { renderMindMap } from "./mindMap.js";
import { extractReasoningDelta } from "./reasoning.js";
import { createStreamReducer } from "./streaming.js";
import { reconcilePendingTurnMessages } from "./pendingTurns.js";
import { createDocumentViewer } from "./documentViewer.js";
import { createResearchController } from "./research.js";
import { createCompareController } from "./compare.js";
import { createCouncilController } from "./council.js";
import {
  bindVoicePicker,
  createVoiceSession,
  normalizeVoiceId,
  normalizeVoiceSpeed,
  openVoicePicker,
  voiceModeSupported,
  voicePickerMarkup
} from "./voiceMode.js";
import {
  composeEmailNatively,
  copyText,
  exitApp,
  hideNativeKeyboard as hideNativeKeyboardNow,
  isEmbedded,
  isNative,
  keepVoiceSessionAlive,
  keyboardHiddenOnPurposeAt,
  openExternal,
  showNativeKeyboard as showNativeKeyboardInstant
} from "./platform/index.js";

/* ─── Bridges: the React store's versions of old functions ─── */

const set = useApp.setState;
let suppressUrlSync = false;
// A /c/<id> deep link that opened the packaged app, until the chats load.
let pendingNativeConversationId = "";

/** The sidebar renders from the store; publish what only the chat core knows. */
function renderConversations() {
  if (state.activeConversationId) unreadDoneChats.delete(state.activeConversationId);
  set({ runningChatIds: [...conversationRuns.keys()], unreadChatIds: [...unreadDoneChats] });
}

/** setRunning(): the model and mode buttons render from `running`; the
   prompt, send and stop buttons are the chat core's. */
function setRunning(running) {
  state.running = running;
  set({ imageToggleDisabled: state.temporaryChat || state.researchMode });
  els.promptInput?.setAttribute("contenteditable", "true");
  updateComposerPlaceholder();
  updateSendButton();
  syncComposerBeam();
}

function requireAuth() {
  if (state.session) return true;
  openAuthDialog();
  return false;
}

function isSearchDialogOpen() {
  return useApp.getState().searchOpen;
}

function resolvedAppearance() {
  const { settings, systemDark } = useApp.getState();
  if (settings.appearance === "light" || settings.appearance === "dark") return settings.appearance;
  return systemDark ? "dark" : "light";
}

/** showOnly(): the store picks the view. */
function showOnly(view) {
  const views = new Map([[els.researchReportView, "research"], [els.paywallView, "paywall"], [els.setupView, "setup"]]);
  set({ view: views.get(view) || "chat" });
}

// Normal taps use Android's editor focus. Only startup/new-chat/pill actions
// need an explicit request; one bridge call, without timers or a second path.
function showNativeKeyboard() {
  return showNativeKeyboardInstant().catch(() => {});
}

// Only acts in the packaged app, where it also raises the keyboard; on the web
// the click that got here already placed the caret.
function focusPromptInput() {
  if (!els.promptInput || !isNative()) return;
  if (els.chatView?.classList.contains("hidden") || !els.researchReportView?.classList.contains("hidden")) return;
  els.composer?.classList.remove("compact");
  els.promptInput.focus({ preventScroll: true });
  if (!document.body.classList.contains("keyboard-open")) void showNativeKeyboard();
}

function isMobileLayout() {
  return useApp.getState().mobile;
}

// The temporary chat home keeps its composer open. Menus, sheets and
// navigation still close the keyboard through hideNativeKeyboard; any other
// dismissal (the IME's own hide key, back, a stray tap) reopens it.
const hideNativeKeyboard = hideNativeKeyboardNow;

// React renders these from the store (temporary chat bar, composer Klui, profile
// menu). Both mode renders also wrote #imageToggle's disabled state.
function renderTemporaryChatMode() {
  set({ imageToggleDisabled: state.running });
}
function syncComposerKlui() {}
function renderProfileMenu() {}
function renderSearchResults() {}
function renderResearchMode() {
  set({ imageToggleDisabled: state.running || state.researchMode });
}

/* ─── From public/js/app.js ─── */

const OPENROUTER_TEXT_MODEL = "deepseek/deepseek-v4-flash-0731";

const OPENROUTER_VISION_MODEL = "xiaomi/mimo-v2.6-flash";

const OPENROUTER_COUNCIL_HY3_MODEL = "tencent/hy3";

const OPENROUTER_SOLAR_PRO = "upstage/solar-pro4";

// Text compare: DeepSeek and Solar Pro (Solar runs at medium effort).
const DEFAULT_COMPARE_MODELS = [OPENROUTER_TEXT_MODEL, OPENROUTER_SOLAR_PRO];

const DEFAULT_COUNCIL_MODELS = [
  OPENROUTER_TEXT_MODEL,
  OPENROUTER_COUNCIL_HY3_MODEL,
  OPENROUTER_VISION_MODEL,
  OPENROUTER_SOLAR_PRO
];

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
    messagePage: !temporary && isRunKeyActive(key) ? state.messagePage : null,
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
  if (!run.temporary && run.conversationId) unreadDoneChats.delete(run.conversationId);
  if (isRunKeyActive(key)) syncActiveRunningUi();
  renderConversations();
  return run;
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
    endConversationRun(id, { completed: true });
    return;
  }
  syncActiveRunningUi();
}
// Projects are hidden while they are reworked. Study courses share the projects API and stay on.
const PROJECTS_ENABLED = false;

function conversationIdFromLocation() {
  const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function projectIdFromLocation() {
  const match = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function projectsRouteFromLocation() {
  if (!PROJECTS_ENABLED) return false;
  return window.location.pathname === "/projects" || Boolean(projectIdFromLocation());
}

function courseIdFromLocation() {
  const match = window.location.pathname.match(/^\/study\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function studyRouteFromLocation() {
  return window.location.pathname === "/study" || Boolean(courseIdFromLocation());
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

/* The app changed chats while this page was hidden. Only navigation updates: the open chat,
   the route and the saved pins are the page's own, and may have moved on while this loads. */
let chatListRefreshes = 0;
async function refreshChatList() {
  const refresh = ++chatListRefreshes;
  const userId = state.me?.user?.id;
  const payload = await listConversations(state.session);
  if (refresh !== chatListRefreshes || state.me?.user?.id !== userId || !state.session) return;
  const conversations = payload.conversations || [];
  const listed = new Set(conversations.map((chat) => chat.id));
  const inUse = state.conversations.filter((chat) => !listed.has(chat.id)
    && (chat.id === state.activeConversationId || conversationRuns.has(chat.id)));
  state.conversations = [...inUse, ...conversations];
  renderConversations();
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
  } else if (!guestDraftHasPreview(pendingGuestSend)) {
    state.messages = [];
    stopExtractedModulePollers();
  }
  if (routeConversationId && !state.activeConversationId) syncConversationUrl({ replace: true });
}

async function loadChatApp() {
  const mobileHome = isMobileLayout() && !conversationIdFromLocation()
    && !studyRouteFromLocation() && !projectsRouteFromLocation() && !pendingNativeConversationId;
  if (mobileHome) {
    const session = state.session;
    const userId = state.me?.user?.id;
    const payload = await (mobileRecentChats || listConversations(session, { limit: 10 })).catch(() => ({ conversations: [] }));
    mobileRecentChats = null;
    state.conversations = payload.conversations || [];
    renderConversations();
    // The complete list only updates navigation, never a chat opened while it loads.
    void listConversations(session).then((all) => {
      if (state.me?.user?.id !== userId || !state.session) return;
      const current = new Map(state.conversations.map(chat => [chat.id, chat]));
      for (const chat of all.conversations || []) {
        if (!current.has(chat.id)) current.set(chat.id, chat);
      }
      state.conversations = [...current.values()];
      renderConversations();
    }).catch(() => {});
    await loadProjects();
  } else {
    await Promise.all([loadConversations(), loadProjects()]);
  }
  if (studyRouteFromLocation()) {
    await loadStudyHub();
    state.studyOpen = true;
    state.projectsOpen = false;
    state.activeCourseId = courseIdFromLocation();
    state.activeConversationId = "";
    state.messages = [];
    studyHub.showCourseHome?.();
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
  const routeConversation = state.conversations.find(item => item.id === conversationIdFromLocation());
  if (routeConversation && state.projects.some(item => item.id === routeConversation.project_id && item.kind === "course")) {
    await openConversation(routeConversation.id);
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

let mobileRecentChats = null;
function researchIdFromLocation() {
  const match = window.location.pathname.match(/^\/research\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

let viewTransitionUserMessageId = "";

let renderQueued = false;

let renderedChatPromptSignature = "";

let reasoningOpenIds = new Set();

let pendingGuestSend = null;

let researchController;

let compareController;

let councilController;

/** One in-flight client run per conversation (or temporary chat). */
const TEMPORARY_RUN_KEY = "__temporary__";

const conversationRuns = new Map();

const unreadDoneChats = new Set();

const conversationCache = new Map();

let conversationLoadGeneration = 0;

function rememberConversation(id, messages, page = null) {
  if (!id) return;
  conversationCache.set(id, { messages: messages || [], page });
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

function endConversationRun(key, { completed = false } = {}) {
  if (!key || !conversationRuns.has(key)) return;
  const run = conversationRuns.get(key);
  conversationRuns.delete(key);
  if (completed && !run.temporary && run.conversationId && run.conversationId !== state.activeConversationId) {
    unreadDoneChats.add(run.conversationId);
  }
  if (isRunKeyActive(key) || state.abortController === run?.abortController) {
    syncActiveRunningUi();
  }
  renderConversations();
}

function parkActiveConversationRun() {
  if (state.activeConversationId && !state.temporaryChat && !state.conversationLoading) {
    rememberConversation(state.activeConversationId, state.messages, state.messagePage);
  }
  const key = conversationRunKey();
  const run = getConversationRun(key);
  if (!run) return;
  run.messages = state.messages;
  run.messagePage = state.messagePage;
  run.followUps = state.followUps.slice();
}

function restoreLiveConversationRun(conversationId) {
  const key = conversationRunKey(conversationId, false);
  const run = getConversationRun(key);
  if (!run?.messages) return false;
  // Research is durable on the server; returning should resume from fetched metadata.
  if (run.mode === "research" && !run.abortController) return false;
  state.messages = run.messages;
  state.messagePage = run.messagePage || conversationCache.get(conversationId)?.page || { hasMore: false, cursor: null };
  state.followUps = Array.isArray(run.followUps) ? run.followUps.slice() : [];
  renderFollowUps();
  syncActiveRunningUi();
  return true;
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

function blockChatNavigationWhileRunning() {
  // Temporary chat stays locally locked; normal conversations can background.
  if (!(state.temporaryChat && conversationRuns.has(TEMPORARY_RUN_KEY))) return false;
  showToast("Stop the current response before switching chats.");
  return true;
}

function clearClarification() {
  state.clarification = null;
  state.clarificationChecking = false;
  state.clarificationRequestId += 1;
  els.clarificationCard?.classList.add("hidden");
  if (els.clarificationCard) els.clarificationCard.innerHTML = "";
  updateSendButton();
}

const HUMANIZER_ICON_SVG = '<svg viewBox="0 0 45 46" aria-hidden="true"><defs><mask id="humanizer-cut"><rect width="45" height="46" fill="#fff"/><path d="M7 40 38 6" stroke="#000" stroke-width="4.2" stroke-linecap="round"/></mask></defs><path d="M21.5 7.86C21.79 8.63 22.07 9.4 22.36 10.17C24.69 10.55 27.57 9.69 29.66 11.19C32.33 13.1 31.43 21.34 29.74 23.58C29.12 24.4 27.81 24.86 27.03 25.5C29.74 28.1 31.54 29.05 32.13 33.15C32.28 34.16 32.99 35.07 32.17 35.85C29.92 35.96 30.45 33.14 29.91 31.55C29.62 30.72 28.31 28.8 27.64 28.2C23.4 24.4 16.24 25.36 13.14 29.96C11.86 31.85 12.1 34.6 10.5 36.16C6.91 34.03 12.74 27.12 14.93 25.5C14.12 24.9 12.86 24.39 12.24 23.59C10.22 20.97 9.6 13.41 12.42 11.26C14.4 9.74 17.39 10.54 19.64 10.17C20.26 8.84 19.78 8.03 21.5 7.86ZM14.6 12.49C12.12 13.31 12.23 19.68 13.33 21.49C15.14 24.5 18.6 23.31 21.46 23.48C23.92 23.62 27.21 24.1 28.74 21.58C29.29 20.67 29.12 19.2 29.16 18.17C29.22 16.79 29.63 14.3 28.66 13.17C27.77 12.12 26.39 12.3 25.17 12.3C22.99 12.3 16.22 11.94 14.6 12.49ZM18.5 16.5C18.26 18.61 16.07 18.46 16.17 16.33C17.13 15.79 17.59 15.86 18.5 16.5ZM25.9 16.36C25.9 16.82 25.9 17.29 25.9 17.75C24.44 18.33 23.67 18.09 23.5 16.5C24.42 15.93 24.91 15.92 25.9 16.36Z" fill="currentColor" fill-rule="evenodd" mask="url(#humanizer-cut)"/><path d="M7 40 38 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';

const ILLUSTRATION_ICON_SVG = '<svg viewBox="2 3.6 20 16.8" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.2" y="5" width="17.6" height="14" rx="3.2"/><circle cx="16.2" cy="9.35" r="1.55"/><path d="M4.45 16.4 9.15 11.45l3.15 3.15 2.4-2.8 4.85 4.55"/></svg>';

const VISUALIZE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="4"/><path d="m8 15 3.1-3.1 2.4 2.1 3.7-5"/><circle cx="17.5" cy="7.5" r="1" fill="currentColor" stroke="none"/></svg>';

const SLIDES_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.8" y="3.8" width="18.4" height="12.4" rx="2.6"/><path d="M12 16.2v3.6M8.4 20.2h7.2"/><path d="M7.6 12.6v-2.2M12 12.6V7.6M16.4 12.6V9.4"/></svg>';

const DOCS_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/></svg>';

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
  if (id === "slides") return SLIDES_ICON_SVG;
  if (id === "docs") return DOCS_ICON_SVG;
  return DEFAULT_SKILL_ICON_SVG;
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

function pendingPromptHasImages() {
  return state.images.some((item) => item.category === "image");
}

function selectedModelMode() {
  return state.settings.modelMode === "pro" ? "pro" : "thinking";
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

function compareIncludesTextOnlyModels(modelIds) {
  return modelIds.some((id) => !modelSupportsVision({ id }));
}

function syncCompareContextBanner(modelIds = compareController.selectedCompareModelIds()) {
  compareController.closeCompareContextBanner();
}

function applyCodeHighlightTheme(mode) {
  const light = document.querySelector("#hljsLight");
  const dark = document.querySelector("#hljsDark");
  if (light) light.disabled = mode === "dark";
  if (dark) dark.disabled = mode !== "dark";
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
    if (conversation) state.conversations = [conversation, ...state.conversations];
  }
  state.activeProjectId = conversation?.project_id || "";
  state.projectsOpen = false;
  const course = state.projects.find(item => item.id === conversation?.project_id && item.kind === "course");
  state.studyOpen = Boolean(course);
  if (course) {
    await loadStudyHub();
    if (state.activeCourseId !== course.id) studyHub.resetCourseCaches();
    state.activeCourseId = course.id;
    state.activeCourseTab = "chat";
  }
  state.activeProject = null;
  state.activeConversationId = conversationId;
  clearFollowUps();
  clearComposerSkills();
  set({ sidebarOpen: false });
  state.compareDescribeImages = false;
  stopPendingArtifactPolls();
  closeDocumentViewer();
  compareController.closeCompareContextBanner();
  closeSearchDialog();
  closePinnedPopup();
  closeConversationMenus();
  try {
    if (course) await studyHub.loadCourse();
    syncConversationUrl();
    if (!restoreLiveConversationRun(conversationId)) {
      const cached = conversationCache.get(conversationId);
      state.messages = cached?.messages || [];
      state.messagePage = cached?.page || { hasMore: false, cursor: null };
      state.conversationLoading = !cached;
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

function isAdminUser() {
  return state.me?.profile?.role === "admin";
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
  if (name === "query_spreadsheet") return "Calculating from spreadsheet";
  if (name === "create_document") return "Creating document";
  if (name === "edit_document") return "Editing document";
  if (name === "export_document") return "Exporting document";
  if (name === "load_tools") return "Preparing tools";
  if (name === "limit") return "Wrapping up";
  return "Working";
}

// Live updates under the Klui bar; a first line shows until the stream reports anything.
function thinkingFeed(message) {
  const feed = Array.isArray(message?.activity) ? message.activity : [];
  return feed.length ? feed : [{ key: "start", kind: "thought", text: "Reading your message", live: true }];
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
  if (isVisualizeRepairing(message)) return "";
  if (rawTextContent(message?.content).trim() && !isProvisionalToolProse(message)) return "";
  const label = currentThinkingStatus(message, { streaming });
  if (!label) return "";
  const active = streaming && !isFinalFinishReason(message?.finishReason);
  return renderKluiThinkingStatus(message, { label, active, feed: thinkingFeed(message), startedAt: message?.activityStartedAt });
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
    artifact?.id
    || artifact?.attachment_id
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

const studyPreviewState = new Map();

function previewState(artifact) {
  if (!studyPreviewState.has(artifact.id)) studyPreviewState.set(artifact.id, {
    index: 0, flipped: false, choice: -1, deck: "new", newDeckKey: `chat:${crypto.randomUUID()}`, saved: new Set(), busy: false
  });
  return studyPreviewState.get(artifact.id);
}

function studyPreviewItem(artifact, index) {
  if (artifact.kind === "practice") {
    const question = artifact.questions?.[index] || {};
    return { front: question.q || "Question", back: question.type === "short" ? `${question.choices?.[0] || ""}${question.explanation ? `\n\n${question.explanation}` : ""}` : `${"ABCD"[question.answer] || ""}. ${question.choices?.[question.answer] || ""}${question.explanation ? `\n\n${question.explanation}` : ""}`, choices: question.type === "short" ? [] : question.choices || [], answer: question.answer };
  }
  const card = artifact.cards?.[index] || {};
  const match = String(card.front || "").match(/^([\s\S]*?)\n\nA\. ([\s\S]*?)\nB\. ([\s\S]*?)\nC\. ([\s\S]*?)\nD\. ([\s\S]*)$/);
  const answer = String(card.back || "").match(/^([ABCD])\./)?.[1];
  return { front: match ? match[1] : card.front || "Question", back: card.back || "", choices: match ? match.slice(2) : [], answer: answer ? "ABCD".indexOf(answer) : -1 };
}

function renderStudyPreview(artifact) {
  const ui = previewState(artifact);
  const id = escapeHtml(artifact.id);
  const source = escapeHtml(artifact.source || "Course material");
  const sourceLine = `<span class="study-inline-source">${source}${artifact.page ? ` · Page ${escapeHtml(String(artifact.page))}` : ""}</span>`;
  if (artifact.kind === "mindmap") {
    return `<section class="study-inline study-inline--map" data-study-preview="${id}"><div class="study-inline-top"><span>Mind map</span>${sourceLine}</div>${renderMindMap(artifact.title || "Mind map", String(artifact.content || "").replace(/^<!--klui:mindmap-->\s*/, ""), escapeHtml)}<div class="study-inline-actions"><button type="button" data-study-preview-save="all" ${ui.saved.has("map") || ui.busy ? "disabled" : ""}>${ui.saved.has("map") ? "Saved to Create" : "Save mind map to Create"}</button></div></section>`;
  }
  const items = artifact.kind === "practice" ? artifact.questions || [] : artifact.cards || [];
  if (!items.length) return "";
  ui.index = Math.min(ui.index, items.length - 1);
  const item = studyPreviewItem(artifact, ui.index);
  const decks = (state.studyPractice?.decks || []).map((deck) => `<option value="${escapeHtml(deck.id)}" ${ui.deck === deck.id ? "selected" : ""}>${escapeHtml(deck.title || "Deck")}</option>`).join("");
  const choices = item.choices.length ? `<div class="study-inline-choices">${item.choices.map((choice, i) => `<button type="button" data-study-preview-choice="${i}" class="${ui.choice === i ? "is-picked" : ""}${ui.flipped && i === item.answer ? " is-correct" : ""}"><span>${"ABCD"[i]}</span>${escapeHtml(choice)}</button>`).join("")}</div>` : "";
  return `<section class="study-inline study-inline--cards" data-study-preview="${id}">
    <div class="study-inline-top"><span>${artifact.kind === "practice" ? "Practice questions" : "Flashcards"} · ${escapeHtml(String(items.length))}</span></div>
    <div class="study-inline-count">${ui.index + 1} <span>/ ${items.length}</span></div>
    <div class="study-inline-progress">
      <button type="button" data-study-preview-nav="prev" aria-label="Previous card" ${ui.index === 0 ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
      <div role="progressbar" aria-label="Card progress" aria-valuenow="${ui.index + 1}" aria-valuemin="1" aria-valuemax="${items.length}"><span style="width:${((ui.index + 1) / items.length) * 100}%"></span></div>
      <button type="button" data-study-preview-nav="next" aria-label="Next card" ${ui.index === items.length - 1 ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
    </div>
    <div class="study-inline-stack${items.length > 1 ? " has-stack" : ""}">
      <div class="study-inline-card">
        <div class="study-inline-card-content"><p class="study-inline-question">${escapeHtml(item.front)}</p>${choices}${ui.flipped ? `<p class="study-inline-answer">${escapeHtml(item.back)}</p>` : `<button type="button" class="study-inline-reveal" data-study-preview-flip>Show answer</button>`}</div>
        <div class="study-inline-source-foot">${sourceLine}</div>
      </div>
    </div>
    <div class="study-inline-save"><label>Save to <select data-study-preview-deck><option value="new" ${ui.deck === "new" ? "selected" : ""}>New flashcard set</option>${decks}</select></label><div class="study-inline-actions"><button type="button" data-study-preview-save="one" ${ui.saved.has(ui.index) || ui.busy ? "disabled" : ""}>${ui.saved.has(ui.index) ? "Added" : "Add this card"}</button><button type="button" class="is-primary" data-study-preview-save="all" ${ui.saved.size === items.length || ui.busy ? "disabled" : ""}>${ui.saved.size === items.length ? "All added" : `Add all ${items.length}`}</button><small>${ui.saved.size} / ${items.length} added</small></div></div>
  </section>`;
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

// Island change: created in mountChat(), once React has rendered the viewer.
let openDocumentViewer;
let closeDocumentViewer;
let syncPagePicks;
let renderDocumentViewer;
let syncPendingArtifactPolls;
let stopPendingArtifactPolls;
let initDocumentViewerWidth;
let beginDocumentViewerResize;

function createChatDocumentViewer() {
  ({
    openDocumentViewer,
    closeDocumentViewer,
    syncPagePicks,
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
    replacePendingArtifact,
    askDocument,
    // An Ask Klui edit adds the request and the new version to the chat it belongs to.
    onDocumentEdited: async (result) => {
      if (!result?.conversationId || result.conversationId !== state.activeConversationId) return;
      conversationCache.delete?.(result.conversationId);
      try {
        if (await loadActiveConversation() === "applied" && state.activeConversationId === result.conversationId) renderShell();
      } catch {
        /* The chat refreshes on its next load. */
      }
    }
  }));
}

function citationHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
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

function isPlaceholderPeerReason(value) {
  return /^<?\s*reason\s*>?$/i.test(String(value || "").trim());
}

// A marker is "[3]" or the page-carrying "[3, PDF p. 12]" / "[3, slide 4]" models also write.
const CITATION_MARKER = /\[(\d+)(?:\s*,\s*(?:pdf\s+)?(?:pp?|pages?|slides?)\.?\s*(\d+)(?:\s*[-–]\s*\d+)?)?\]/gi;

function isPageCitation(entry) {
  return entry?.type === "document" && Boolean(entry.attachment_id);
}

// Document sources become page chips where they're cited; clicking one opens that page.
function renderPageCitation(entry) {
  const page = Number(entry.page) || 0;
  const name = entry.source || citationDisplayTitle(entry) || "Document";
  const label = page ? `${name} · page ${page}` : name;
  return `<button class="page-cite" type="button" data-doc-cite="${escapeHtml(entry.attachment_id)}" data-doc-file="${escapeHtml(entry.document_file_id || "")}" data-doc-page="${page || ""}" data-file-name="${escapeHtml(name)}" title="${escapeHtml(label)}" aria-label="Open ${escapeHtml(label)}"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 1.75h5.2L12.5 5v9.25H4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 1.9V5.3h3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg><span>${page || "↗"}</span></button>`;
}

function prepareCitationPlaceholders(text, citations) {
  const slots = [];
  if (!text || !citations?.length) return { text: String(text ?? ""), slots };

  const byIndex = new Map();
  for (const entry of citations) {
    const idx = Number(entry.index);
    if (Number.isFinite(idx)) byIndex.set(idx, entry);
  }
  const hold = (html) => {
    const token = `KLUICITATIONPILL${slots.length}END`;
    slots.push({ token, html });
    return token;
  };

  const blocks = String(text).split(/\n\n+/);
  const processed = blocks.map((block) => {
    const indices = [];
    const seen = new Set();
    const pages = new Set();
    let out = block.replace(CITATION_MARKER, (marker, number, written, offset) => {
      const n = Number(number);
      let entry = byIndex.get(n);
      if (!entry) return marker;
      if (isPageCitation(entry)) {
        // The page the model wrote wins when it names one: tool results number their sources separately.
        const page = Number(written) || 0;
        if (page && Number(entry.page) !== page) {
          entry = citations.find((item) => item.attachment_id === entry.attachment_id && Number(item.page) === page) || { ...entry, page };
        }
        const key = `${entry.attachment_id}:${entry.page || ""}`;
        const space = offset > 0 && /\s/.test(block[offset - 1]) ? "" : " ";
        if (pages.has(key)) return "";
        pages.add(key);
        return `${space}${hold(renderPageCitation(entry))}`;
      }
      if (!seen.has(n)) {
        seen.add(n);
        indices.push(n);
      }
      return "";
    });
    if (!indices.length) return out;
    const sources = indices.map((i) => byIndex.get(i)).filter(Boolean);
    out = out.replace(/[ \t]+(?=[.,;:!?)]|$)/gm, "").trimEnd();
    return `${out} ${hold(renderInlineSourcePill(sources))}`;
  });

  return { text: processed.join("\n\n"), slots };
}

function restoreCitationPlaceholders(html, slots) {
  let out = String(html ?? "");
  for (const { token, html: pillHtml } of slots) out = out.replaceAll(token, () => pillHtml);
  return out;
}

function renderAssistantText(text, citations, { holdVisualize = false, visualizeLabel = "" } = {}) {
  const cleaned = stripRedundantSourcesFooter(
    stripLeakedToolMarkup(stripLeakedCitationHtml(text)),
    citations
  );
  if (!cleaned.trim()) return "";
  if (!citations.length) return renderContent(cleaned, { holdVisualize, emailCards: true, visualizeLabel });
  const { text: prepared, slots } = prepareCitationPlaceholders(cleaned, citations);
  return restoreCitationPlaceholders(renderContent(prepared, { holdVisualize, emailCards: true, visualizeLabel }), slots);
}

// A message being auto-repaired keeps its panel on screen the whole time:
// the previous document stays under the "Getting it ready" state until the
// replacement fence starts streaming in.
function isVisualizeRepairing(message) {
  return Boolean(message?.visualizeRepairSource) && state.running && !message?.error;
}

function renderAssistantContent(content, message) {
  const citations = citationListFromMessage(message);
  const repairing = isVisualizeRepairing(message);
  const visualizeLabel = repairing ? VISUALIZE_REPAIRING_LABEL : "";
  if (repairing && !/```visualize[ \t]*\r?\n/i.test(rawTextContent(content))) {
    return renderContent(`\`\`\`visualize\n${message.visualizeRepairSource}`, { visualizeLabel });
  }
  const holdVisualize = state.running && Boolean(message?.id) && String(state.messages.at(-1)?.id || "") === String(message.id);
  const hasContent = Array.isArray(content)
    ? content.some((part) => part?.type === "text" ? String(part.text || "").trim() : part?.type === "image_url")
    : Boolean(String(content || "").trim());

  if (Array.isArray(content)) {
    if (!hasContent) return "";
    return content
      .map((part) => {
        if (part?.type === "text") return renderAssistantText(part.text || "", citations, { holdVisualize, visualizeLabel });
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
  return renderAssistantText(text, citations, { holdVisualize, visualizeLabel });
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
  if (isStoppedMessage(msg)) return `<div class="message-stopped" role="status">You stopped the response.</div>`;
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
        ${host ? `<span class="sources-row-host">${escapeHtml(host)}${entry?.searched ? " · search result, not cited" : ""}</span>` : ""}
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

  // Search results the answer never cited are shown as what was searched, not as sources.
  const searchedOnly = citations.every((entry) => entry?.searched === true);
  const label = searchedOnly ? "Searched" : "Sources";
  const hint = searchedOnly ? ` title="Pages the web search returned. The answer did not cite them."` : "";
  return `
    <details class="sources-pill">
      <summary class="sources-pill-trigger"${hint}>
        ${faviconStack ? `<span class="sources-favicons">${faviconStack}</span>` : ""}
        <span class="sources-pill-label">${label}</span>
        <span class="sources-pill-count" aria-hidden="true">${citations.length}</span>
      </summary>
      <div class="sources-panel">${rows}</div>
    </details>
  `;
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

const ARTIFACT_KINDS = {
  pdf: { kind: "pdf", tag: "PDF", label: "PDF" },
  docx: { kind: "word", tag: "DOC", label: "Word document" },
  doc: { kind: "word", tag: "DOC", label: "Word document" },
  xlsx: { kind: "excel", tag: "XLS", label: "Excel spreadsheet" },
  csv: { kind: "excel", tag: "CSV", label: "Spreadsheet" },
  pptx: { kind: "slides", tag: "PPT", label: "PowerPoint" },
  md: { kind: "text", tag: "MD", label: "Markdown" }
};

function artifactKindInfo(artifact) {
  const format = artifactFormat(artifact).toLowerCase();
  return ARTIFACT_KINDS[format] || { kind: "file", tag: format.slice(0, 4).toUpperCase() || "FILE", label: "File" };
}

function artifactKind(artifact) {
  return artifactKindInfo(artifact).kind;
}

function artifactKindLabel(artifact) {
  return artifactKindInfo(artifact).label;
}

// A page outline with a folded corner and the file type under the fold, tinted per kind in CSS.
function artifactFileIcon(artifact) {
  const { tag } = artifactKindInfo(artifact);
  return `<span class="artifact-icon" aria-hidden="true"><svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13V7a3 3 0 0 1 3-3h11l6 6v3"/><path d="M20 4v4a2 2 0 0 0 2 2h4"/></svg><span class="artifact-icon-tag">${escapeHtml(tag)}</span></span>`;
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
    if (artifact?.type === "study_preview") return renderStudyPreview(artifact);
    const fileName = artifactLabel(artifact);

    if (artifact.pending) {
      const failed = ["failed", "expired"].includes(String(artifact.status || "").toLowerCase());
      const statusLabel = pendingArtifactStatusLabel(artifact);
      const cardClass = `artifact-card pending${failed ? " failed" : ""}`;
      return `
        <div class="${cardClass}" data-job-id="${escapeHtml(artifact.job_id || "")}" data-kind="${artifactKind(artifact)}">
          ${artifactFileIcon(artifact)}
          <div class="artifact-info">
            <div class="artifact-title">${escapeHtml(fileName)}</div>
            <div class="artifact-status">${failed ? "" : `<span class="artifact-spinner" aria-hidden="true"></span>`}${escapeHtml(statusLabel)}</div>
          </div>
        </div>
      `;
    }

    const attachmentId = artifactAttachmentId(artifact);
    const canView = artifactCanView(artifact);
    const format = artifactFormat(artifact).toLowerCase();
    const body = `
      ${artifactFileIcon(artifact)}
      <span class="artifact-info">
        <span class="artifact-title">${escapeHtml(fileName)}</span>
        <span class="artifact-status">${escapeHtml(artifactKindLabel(artifact))}</span>
      </span>
    `;
    // The whole card opens the file in the viewer.
    return canView
      ? `<button class="artifact-card" type="button" data-kind="${artifactKind(artifact)}" data-view-attachment-id="${escapeHtml(attachmentId)}" data-file-name="${escapeHtml(fileName)}" data-format="${escapeHtml(format)}" aria-label="Open ${escapeHtml(fileName)}">${body}</button>`
      : `<div class="artifact-card" data-kind="${artifactKind(artifact)}">${body}</div>`;
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
  const transitioning = role === "user" && String(msg.id || "") === viewTransitionUserMessageId;
  const userImages = role === "user" ? renderUserImages(msg) : "";

  const inner = role === "assistant" && researchController.researchMeta(msg)
    ? researchController.renderResearchCard(msg)
    : editing
    ? `${userImages}${renderUserEditForm(msg, rawText)}`
    : `${userImages}<div class="message-content">${renderAssistantMessageContent(msg, role)}</div>
        ${renderMessageFooter(msg, role)}`;

  return `
    <article class="message ${role}${editing ? " editing" : ""}${transitioning ? " sent-message-transition" : ""}"${idAttr} data-raw-text="${escapeHtml(rawText)}">
      <div class="message-body">
        ${inner}
      </div>
    </article>
  `;
}

// Expanded visuals go to the browser top layer (a manual popover), so no
// transformed panel, stacking context, or composer can clip or cover them.
function showVisualizeLayer(card) {
  if (typeof card.showPopover !== "function") return;
  card.setAttribute("popover", "manual");
  if (!card.matches(":popover-open")) card.showPopover();
}

function hideVisualizeLayer(card) {
  if (!card.hasAttribute("popover")) return;
  if (card.matches(":popover-open")) card.hidePopover();
  card.removeAttribute("popover");
}

function setVisualizeExpanded(card, expanded) {
  if (!card) return;
  card.classList.toggle("is-expanded", expanded);
  if (expanded) showVisualizeLayer(card);
  else hideVisualizeLayer(card);
  const button = card.querySelector("[data-visualize-expand]");
  if (button) {
    button.textContent = expanded ? "Close" : "Expand";
    button.setAttribute("aria-pressed", String(expanded));
  }
  card.querySelector("iframe[data-visualize-id]")?.contentWindow?.postMessage({
    type: "klui:visualize:expanded",
    expanded
  }, "*");
  document.body.classList.toggle("visualize-expanded", Boolean(document.querySelector(".visualize-card.is-expanded")));
}

function collapseExpandedVisualize(except = null) {
  for (const card of document.querySelectorAll(".visualize-card.is-expanded")) {
    if (card !== except) setVisualizeExpanded(card, false);
  }
}

function renderMessages() {
  parkGuestContinue();
  if (!state.messages.length) {
    const draft = pendingGuestSend;
    if (guestDraftHasPreview(draft)) state.messages = [guestPreviewMessage(draft)];
  }
  collapseExpandedVisualize();
  resetCodeSourceStore();
  const showSkeleton = Boolean(state.conversationLoading && !state.messages.length && state.activeConversationId);
  set({ chatEmpty: !state.messages.length && !showSkeleton, hasMessages: state.messages.length > 0 });
  homeModesController?.render();
  if (state.messages.length) void loadRichTextAssets();
  syncComposerKlui();
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
  const beforeScrollHeight = els.messages.scrollHeight;
  const prepending = state.prependingOlder;
  state.prependingOlder = false;

  captureReasoningOpenState();

  els.messages.innerHTML = messageViews(state.messages)
    .map((view) => {
      if (view.type === "council") return councilController.renderCouncilMessage(view.council);
      if (view.type === "compare") return compareController.renderCompareMessage(view.messages);
      return renderStandardMessage(view.message);
    })
    .join("");

  hydrateKluiBars(els.messages);
  mountGuestContinue();

  if (beforePinned) {
    pinMessagesToBottom();
  } else if (prepending) {
    // Older messages were prepended above the viewport: hold the reader's place.
    setMessagesScrollTop(beforeScrollTop + (els.messages.scrollHeight - beforeScrollHeight));
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

function adoptLiveVisualizeFrame(liveEl, nextRoot) {
  const live = liveEl.querySelector("iframe[data-visualize-id]")?.closest(".visualize-card");
  const next = nextRoot.querySelector("iframe[data-visualize-id]")?.closest(".visualize-card");
  if (!live || !next) return false;
  next.replaceWith(live);
  // Moving a node drops it out of the top layer; keep an expanded visual up. The card sits in
  // a detached container until the caller mounts it, and showPopover() throws on detached
  // nodes, so reopen it once the caller's synchronous swap has finished.
  if (live.classList.contains("is-expanded")) {
    queueMicrotask(() => {
      if (live.isConnected && live.classList.contains("is-expanded")) showVisualizeLayer(live);
    });
  }
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
  if (role === "assistant" && (isStoppedMessage(msg) || /```visualize/i.test(rawTextContent(msg.content)) || hasEmailCardBlock(rawTextContent(msg.content)))) {
    const content = body.querySelector(":scope > .message-content");
    const raw = rawTextContent(msg.content);
    const stopped = isStoppedMessage(msg);
    const visualizeNeedsMount = /```visualize/.test(raw) && !content?.querySelector("iframe[data-visualize-id]");
    const emailNeedsMount = hasEmailCardBlock(raw) && !content?.querySelector("[data-email-card]");
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
  const prompts = !state.studyOpen && desktopChatNavigationEnabled() ? userPromptItems() : [];
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

function queueRenderMessages() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderMessages();
  });
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

function stopExtractedModulePollers() {
  researchController.abandonResearchPolling();
  stopPendingArtifactPolls();
}

/** The api client's onExpired(), also run on sign-out: stop the pollers while
   the active conversation is still known, so its research run ends too. */
function handleSessionEnded() {
  studyHub.closeSession();
  stopExtractedModulePollers();
}

async function loadActiveConversation() {
  const id = state.activeConversationId;
  const loadGeneration = ++conversationLoadGeneration;
  state.loadingOlderMessages = false; // an in-flight older-page fetch now belongs to a stale generation
  state.prependingOlder = false;
  if (!id) {
    state.messages = [];
    state.messagePage = { hasMore: false, cursor: null };
    state.conversationLoading = false;
    stopExtractedModulePollers();
    syncActiveRunningUi();
    return "applied";
  }
  if (restoreLiveConversationRun(id)) {
    state.conversationLoading = false;
    researchController.resumeResearchPolling();
    requestAnimationFrame(fillMessageViewport);
    return "applied";
  }
  const cachedAtStart = conversationCache.get(id);
  const payload = await fetchConversation(state.session, id);
  if (loadGeneration !== conversationLoadGeneration || state.activeConversationId !== id) {
    if (!getConversationRun(id) && conversationCache.get(id) === cachedAtStart) {
      rememberConversation(id, payload.messages || [], payload.page || null);
      return "cached";
    }
    return false;
  }
  if (restoreLiveConversationRun(id)) {
    state.conversationLoading = false;
    researchController.resumeResearchPolling();
    requestAnimationFrame(fillMessageViewport);
    return "applied";
  }
  rememberConversation(id, payload.messages || [], payload.page || null);
  state.messages = payload.messages || [];
  state.messagePage = payload.page || { hasMore: false, cursor: null };
  state.conversationLoading = false;
  const hasActiveResearch = state.messages.some((message) => {
    const meta = message?.metadata?.research;
    return meta?.runId && ["queued", "running"].includes(meta.status);
  });
  if (!hasActiveResearch) {
    const run = conversationRuns.get(state.activeConversationId);
    if (run?.mode === "research" && !run.abortController) {
      endConversationRun(state.activeConversationId, { completed: true });
    }
  }
  researchController.resumeResearchPolling();
  syncActiveRunningUi();
  const pendingTurn = (payload.pendingTurns || [])[0];
  if (pendingTurn && !getConversationRun(state.activeConversationId) && state.resumingTurnId !== pendingTurn.id) {
    setTimeout(() => resumePendingDocumentTurn(pendingTurn), 0);
  }
  requestAnimationFrame(fillMessageViewport);
  return "applied";
}

/**
 * Fetch the page of messages older than the window and prepend it. The prepend
 * is anchored by the scrollHeight delta it adds (see renderMessages).
 */
async function loadOlderMessages() {
  const id = state.activeConversationId;
  const cursor = state.messagePage?.cursor;
  if (!id || !cursor || state.loadingOlderMessages || state.temporaryChat) return;
  state.loadingOlderMessages = true;
  const loadGeneration = conversationLoadGeneration;
  const payload = await fetchConversation(state.session, id, { cursor }).catch(() => null); // on failure keep hasMore so the next scroll retries
  if (loadGeneration !== conversationLoadGeneration || state.activeConversationId !== id) return;
  state.loadingOlderMessages = false;
  if (!payload) return;
  const older = payload.messages || [];
  if (!older.length) {
    state.messagePage = { hasMore: false, cursor: null };
    return;
  }
  state.messages.unshift(...older);
  state.messagePage = payload.page || { hasMore: false, cursor: null };
  state.prependingOlder = true;
  renderMessages();
  fillMessageViewport();
}

/** Scroll-up trigger: only fires at the top, and never while we pin to the bottom. */
function maybeLoadOlderMessages() {
  if (!state.messagePage?.hasMore || state.loadingOlderMessages) return;
  if (state.autoScroll || els.messages.scrollTop > 120) return;
  void loadOlderMessages();
}

/** A window shorter than the viewport can't be scrolled, so top it up until it can. */
function fillMessageViewport() {
  if (!state.messagePage?.hasMore || state.loadingOlderMessages) return;
  if (els.messages.scrollHeight > els.messages.clientHeight + 4) return;
  void loadOlderMessages();
}

function isGuestContinueOpen() {
  return Boolean(els.guestContinue && !els.guestContinue.classList.contains("hidden"));
}

function parkGuestContinue() {
  const node = els.guestContinue;
  if (!node || !els.messages?.contains(node)) return;
  els.messages.after(node);
}

function mountGuestContinue() {
  if (!els.guestContinue || !els.messages) return;
  if (els.guestContinue.classList.contains("hidden")) return;
  els.messages.appendChild(els.guestContinue);
}

function closeGuestContinue() {
  els.guestContinue?.classList.add("hidden");
  els.guestContinue?.setAttribute("aria-hidden", "true");
  parkGuestContinue();
}

function openGuestContinue() {
  closeAuthDialog();
  if (!els.guestContinue || !els.messages) return;
  els.messages.appendChild(els.guestContinue);
  els.guestContinue.classList.remove("hidden");
  els.guestContinue.setAttribute("aria-hidden", "false");
  pinMessagesToBottom();
}

function clearGuestSend() {
  pendingGuestSend = null;
  closeGuestContinue();
}

function guestPreviewMessage(draft) {
  const stored = serializeGuestDraft(draft);
  return {
    id: "local_guest",
    role: "user",
    ...(stored.skillIds.length ? {
      metadata: {
        skillIds: stored.skillIds,
        ...(stored.skillMarks.length ? { skillMarks: stored.skillMarks } : {})
      }
    } : {}),
    content: guestPreviewContent(draft)
  };
}

function dismissGuestContinue() {
  const draft = pendingGuestSend;
  const liveImages = liveGuestImages(draft?.images);
  const text = draft?.text || "";
  const marks = draft?.skillMarks || [];
  clearGuestSend();
  if (state.session) return;
  state.messages = [];
  setComposerPlainText(text, marks);
  state.images = liveImages;
  renderImages();
  applyComposerHeight();
  renderMessages();
}

function openNewChat({ replaceUrl = false } = {}) {
  if (blockChatNavigationWhileRunning()) return;
  if (state.session && state.images.some((item) => item.category === "document" && !item.attachmentId)) {
    showToast("Wait for the document upload to finish before switching chats.");
    return;
  }
  clearGuestSend();
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
  state.messagePage = { hasMore: false, cursor: null };
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
      const restored = [...state.conversations];
      restored.splice(Math.min(index, restored.length), 0, deletedConversation);
      state.conversations = restored;
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

function distanceFromBottom(el) {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

function isNearBottom(el, threshold = 60) {
  return distanceFromBottom(el) <= threshold;
}

function setAutoScroll(enabled) {
  state.autoScroll = Boolean(enabled);
}

const OPENROUTER_PRO_MODEL = "openai/gpt-6-luna";

const OPENROUTER_NITRO_MODEL = "inclusionai/ling-3.0-flash";

const OPENROUTER_VISION_L2 = "qwen/qwen3.7-flash";

const OPENROUTER_VISION_L3 = "qwen/qwen3.8-flash";

const OPENROUTER_GLM_FLASH_MODEL = "z-ai/glm-5.3-flash";

const COMPARE_MEDIA_MODELS = [OPENROUTER_VISION_MODEL, OPENROUTER_VISION_L2];

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

const LONG_PASTE_MIN_CHARS = 1000;

const LONG_PASTE_MIN_LINES = 8;

const LONG_PASTE_MAX_CHARS = 95000;

const WRITING_STYLE_LABELS = Object.freeze({
  normal: "Normal",
  learning: "Learning",
  concise: "Concise",
  explanatory: "Explanatory",
  formal: "Formal"
});

const PENDING_DOCUMENTS_STORAGE_PREFIX = "klui_pending_documents_v1";

let streamingRenderQueued = false;

const streamingRenderTargets = new Map();

let voiceRecorder = null;

let voiceStream = null;

let voiceChunks = [];

let voiceState = "idle";

let voiceCommit = true;

function fileCategory(file) {
  return String(file?.type || "").startsWith("image/") ? "image" : "document";
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
      query: text,
      ...(state.activeConversationId ? { conversationId: state.activeConversationId } : {})
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

const SKILL_REMOVE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M17 7 7 17M7 7l10 10"/></svg>';

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
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
  const remove = document.createElement("span");
  remove.className = "composer-skill-token-remove";
  remove.setAttribute("aria-hidden", "true");
  remove.innerHTML = SKILL_REMOVE_ICON_SVG;
  icon.append(remove);
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
  homeModesController?.render();
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

function isSupportedDocumentFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return [".pdf", ".docx", ".xlsx", ".pptx", ".csv", ".tsv"].some((ext) => name.endsWith(ext));
}

function isSupportedPendingFile(file) {
  return fileCategory(file) === "image" || isSupportedDocumentFile(file);
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

function composerPlaceholder() {
  const homeModePlaceholder = homeModesController?.placeholderOverride();
  if (homeModePlaceholder) return homeModePlaceholder;
  if (state.composerSkillIds.length) return "";
  // A message sent while a reply is still coming waits in the queue.
  if (state.running) return "Queue message";
  return "Ask Klui";
}

function updateComposerPlaceholder() {
  const input = els.promptInput;
  if (!input) return;
  const placeholder = composerPlaceholder();
  input.dataset.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder || "Ask Klui");
  const empty = !composerPlainText().trim() && !state.composerSkillIds.length;
  input.classList.toggle("is-placeholder", empty && Boolean(placeholder));
  // A skill like Slides keeps its own hint next to the chip until the user types.
  const skillHint = Boolean(homeModesController?.placeholderOverride()) && state.composerSkillIds.length > 0 && !composerPlainText().trim();
  input.classList.toggle("is-skill-hint", skillHint);
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

function pendingHasDocuments() {
  return state.images.some((item) => item.category === "document");
}

function chatHasDocuments() {
  return state.messages.some((message) => (
    Array.isArray(message.content) && message.content.some((part) => part?.type === "file")
  ));
}

/* Why Council can't run here, or "" when it can. */
function councilDocumentBlock() {
  if (pendingHasDocuments()) return COUNCIL_DOCUMENT_NOTICE;
  if (chatHasDocuments()) return COUNCIL_CHAT_DOCUMENT_NOTICE;
  return "";
}

function showCouncilDocumentsNotice(text = councilDocumentBlock() || COUNCIL_DOCUMENT_NOTICE) {
  showAttachmentModelNotice(text);
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

function renderContextMeter() {
  /* Context estimation stays available for backend logic; UI is hidden. */
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

function markAssistantStopped(message) {
  if (!message) return;
  if (message.councilGroup) {
    for (const panelist of message.panelists) panelist.stopped = true;
    if (message.chairman) message.chairman.stopped = true;
  } else if (message.compareGroup) {
    for (const response of message.compareResponses) response.stopped = true;
  } else {
    message.stopped = true;
  }
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

function visualizeSourceFromContent(content) {
  return rawTextContent(content).match(/```visualize[ \t]*\r?\n([\s\S]*?)\r?\n```/i)?.[1]?.trim() || "";
}

function animateSentUserMessage(messageId) {
  requestAnimationFrame(() => {
    const bubble = els.messages.querySelector(`[data-message-id="${cssString(messageId)}"] .message-content`);
    if (!bubble) return;
    const reduced = prefersReducedMotion();
    bubble.animate(
      reduced
        ? [{ opacity: 0.55 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translate(12px, 18px) scale(0.95)" },
            { opacity: 1, transform: "translate(0, 0) scale(1)" }
          ],
      {
        duration: reduced ? 140 : 260,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)"
      }
    );
  });
}

function animateRestoredComposerDraft() {
  requestAnimationFrame(() => {
    if (!els.promptInput) return;
    const reduced = prefersReducedMotion();
    els.promptInput.animate(
      reduced
        ? [{ opacity: 0.55 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateY(-12px) scale(0.98)" },
            { opacity: 1, transform: "translateY(0) scale(1)" }
          ],
      {
        duration: reduced ? 140 : 220,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)"
      }
    );
  });
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
  const liveLabel = live.querySelector(".visualize-building-status b");
  const nextLabel = next.querySelector(".visualize-building-status b");
  if (liveLabel && nextLabel && liveLabel.textContent !== nextLabel.textContent) {
    liveLabel.textContent = nextLabel.textContent;
    liveLabel.dataset.label = nextLabel.dataset.label || nextLabel.textContent;
  }
  return true;
}

function stripOpenEmailFence(raw) {
  const text = String(raw || "");
  if (/```email[ \t]*\r?\n[\s\S]*?\r?\n```/i.test(text)) return text;
  if (/<email\b[^>]*>[\s\S]*?<\/email\s*>/i.test(text)) return text;
  return text.replace(/```email[ \t]*\r?\n[\s\S]*$/i, "").replace(/```email[ \t]*$/i, "").replace(/<email\b[^>]*>[\s\S]*$/i, "");
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
    const reasoningEl = contentEl.querySelector("details.reasoning");
    const statusEl = message.error || isStoppedMessage(message) ? null : contentEl.querySelector(".thinking-status");
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
          updateKluiBar(statusEl, {
            label,
            feed: thinkingFeed(message),
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
        updateKluiBar(statusEl, {
          label,
          feed: thinkingFeed(message),
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
        if (reasoningEl && tmp.querySelector("details.reasoning")) {
          patchReasoningInPlace(reasoningEl, message);
          tmp.querySelector("details.reasoning").remove();
          for (const node of [...contentEl.childNodes]) {
            if (node !== reasoningEl) node.remove();
          }
          contentEl.append(...tmp.childNodes);
        } else {
          contentEl.replaceChildren(...tmp.childNodes);
        }
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
        : `${fileTypeIcon(img.file.name)}<span>${escapeHtml(img.file.name)}</span>${img.status !== "ready" ? `<span class="preview-progress" style="--progress:${Math.max(0, Math.min(100, Number(img.progress || 0)))}" title="${escapeHtml(pendingDocumentLabel(img))}"></span>` : ""}` }
      <button class="preview-remove" type="button" data-remove-index="${i}" aria-label="Remove">×</button>
    </div>
  `).join("");
  updateSendButton();
  renderContextMeter();
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
    const { upload: presigned, file: uploadFile } = await presignUpload(state.session, item.file, "document", { signal: controller.signal });
    item.uploadId = presigned.uploadId;
    await putUploadContent(state.session, presigned, uploadFile, "document", { signal: controller.signal });
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
  if (state.researchMode) {
    showToast("Turn off Deep Research before adding attachments.");
    return;
  }
  const draft = composerSnapshot();
  const plan = state.me?.plan || {};
  let allFiles = [...files];
  if (!state.session) {
    const imagesOnly = allFiles.filter((file) => fileCategory(file) === "image");
    if (imagesOnly.length < allFiles.length) showToast("Sign up to attach documents.");
    allFiles = imagesOnly;
    if (!allFiles.length) return;
  }
  if (isFreeAccount()) {
    const imagesOnly = allFiles.filter((file) => fileCategory(file) === "image");
    if (imagesOnly.length < allFiles.length) {
      const notice = "Documents are on Plus and Pro. The free plan can attach images.";
      if (!imagesOnly.length) {
        promptUpgrade(notice);
        return;
      }
      showToast(notice);
    }
    allFiles = imagesOnly;
  }
  const imagesOnly = state.temporaryChat || isCouncilMode();
  const accepted = allFiles.filter((file) => imagesOnly
    ? fileCategory(file) === "image"
    : state.running ? fileCategory(file) === "image" : isSupportedPendingFile(file));
  if (imagesOnly && accepted.length < allFiles.length) {
    if (state.temporaryChat) showToast("Temporary chat supports images only.");
    else showAttachmentModelNotice(COUNCIL_DOCUMENT_NOTICE);
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
  if (!imagesOnly && allFiles.length && !accepted.length) showToast("Upload images, PDFs, Word, Excel, PowerPoint, CSV, or TSV files.");

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

const NITRO_ATTACHMENT_NOTICE = "Nitro is text-only. Switched to Think for attachments.";

const COUNCIL_DOCUMENT_NOTICE = "Council supports images only. Use Compare for documents.";

const COUNCIL_CHAT_DOCUMENT_NOTICE = "This chat has documents, and Council can't read them. Use Compare or start a new chat.";

/* Small notice above the composer explaining why an attachment or mode changed. */
function showAttachmentModelNotice(text = NITRO_ATTACHMENT_NOTICE) {
  clearTimeout(attachmentModelNoticeTimer);
  if (els.attachmentModelNoticeText) els.attachmentModelNoticeText.textContent = text;
  els.attachmentModelNotice?.classList.add("visible");
  els.attachmentModelNotice?.setAttribute("aria-hidden", "false");
  attachmentModelNoticeTimer = setTimeout(hideAttachmentModelNotice, 4500);
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

function trackPendingTurnEvent(event, run = getConversationRun()) {
  if (!run) return;
  run.lastEventAt = Date.now();
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

// Stop takes the send button's place mid-tap, so the tap that sent a message could land on it too.
// Only a press that began on Stop itself (or a keyboard click) counts.
let stopPressStarted = false;

function updateSendButton() {
  if (els.voiceButton) {
    els.voiceButton.disabled = voiceState === "processing"
      || (!state.config?.services?.speech && voiceState !== "recording");
  }
  const voiceBusy = voiceState === "recording" || voiceState === "processing";
  const canStop = Boolean(state.activeResearchId || getConversationRun());
  els.sendButton.classList.toggle("hidden", state.running && !voiceBusy);
  els.stopButton?.classList.toggle("hidden", !state.running || voiceBusy || !canStop);
  if (els.stopButton?.classList.contains("hidden")) stopPressStarted = false;
  if (voiceBusy || state.running) setVoiceModeButton(false);
  if (voiceBusy) {
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
  // An empty composer offers voice mode where the send arrow would be.
  const offerVoice = !hasContent && !blocked && !state.clarification && voiceModeAvailable();
  setVoiceModeButton(offerVoice);
  els.sendButton.classList.toggle("hidden", offerVoice);
  els.sendButton.classList.toggle("active", Boolean(hasContent) && !blocked);
  els.sendButton.disabled = blocked;
}

function voiceModeAvailable() {
  return Boolean(state.config?.services?.speech) && !state.researchMode && voiceModeSupported();
}

function setVoiceModeButton(visible) {
  if (!els.voiceModeButton) return;
  const wasVisible = !els.voiceModeButton.classList.contains("hidden");
  els.voiceModeButton.classList.toggle("hidden", !visible);
  els.voiceModeButton.disabled = !visible;
  // The first keystroke morphs the voice button into Send (and back when the composer empties).
  if (wasVisible && !visible && !state.running) {
    els.sendButton.classList.remove("is-from-voice");
    void els.sendButton.offsetWidth;
    els.sendButton.classList.add("is-from-voice");
    els.sendButton.addEventListener("animationend", function done(event) {
      if (event.animationName !== "send-from-voice") return;
      els.sendButton.classList.remove("is-from-voice");
      els.sendButton.removeEventListener("animationend", done);
    });
  } else if (visible) {
    els.sendButton.classList.remove("is-from-voice");
  }
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
  if (blockedOnFree("Dictation is on Plus and Pro.")) return;
  startVoiceRecording();
}

function applyComposerHeight() {
  const input = els.promptInput;
  input.style.height = "auto";
  if (!document.body.classList.contains("mobile-ui")) {
    input.classList.remove("is-multiline");
    input.style.height = `${Math.min(200, input.scrollHeight)}px`;
    return;
  }
  // Phones keep one line and, once the text wraps, show only a sliver of the
  // line above: enough to hint that earlier text is there to scroll back to.
  const line = parseFloat(getComputedStyle(input).lineHeight) || 26;
  const multiline = input.scrollHeight > line * 1.5;
  input.classList.toggle("is-multiline", multiline);
  input.style.height = multiline ? `${Math.round(line * 1.4)}px` : "";
  if (multiline && isCaretAtComposerEnd()) input.scrollTop = input.scrollHeight;
}

function isCaretAtComposerEnd() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !els.promptInput.contains(selection.anchorNode)) return true;
  if (!selection.isCollapsed) return false;
  const tail = document.createRange();
  tail.selectNodeContents(els.promptInput);
  tail.setStart(selection.anchorNode, selection.anchorOffset);
  // Trailing spaces still count as the end; a following line does not.
  return /^[ \t\u00a0]*$/.test(tail.toString());
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

function patchReasoningInPlace(reasoning, message) {
  const streaming = isAssistantMessageStreaming(message);
  const stillThinking = streaming && !isFinalFinishReason(message?.finishReason) && !message?.reasoningEndedAt;
  reasoning.classList.toggle("is-streaming", stillThinking);
  reasoning.classList.toggle("is-done", !stillThinking && Boolean(message?.reasoning?.trim() || message?.reasoningEndedAt));
  const summary = reasoning.querySelector("summary");
  const label = reasoningSummaryLabel(message, { streaming });
  if (summary.textContent !== label) summary.textContent = label;
  const body = reasoning.querySelector("div");
  const html = message?.reasoning?.trim() ? renderContent(message.reasoning) : "";
  if (body.innerHTML !== html) body.innerHTML = html;
}

function patchKluiThinkingInPlace(message) {
  const id = message?.id ? String(message.id) : "";
  if (!id || message.error || isStoppedMessage(message) || isVisualizeRepairing(message)) return false;
  if (rawTextContent(message?.content).trim() && !isProvisionalToolProse(message)) return false;
  const surface = els.messages.querySelector(`[data-message-id="${cssString(id)}"]`);
  const contentEl = surface?.querySelector(".message-content");
  if (!contentEl) return false;
  if (isAdminUser() && state.settings.showModelReasoning) {
    const reasoning = contentEl.querySelector("details.reasoning");
    if (!reasoning) return false;
    patchReasoningInPlace(reasoning, message);
    return true;
  }
  const label = currentThinkingStatus(message, { streaming: true });
  if (!label) return false;
  const active = !isFinalFinishReason(message?.finishReason);
  const feed = thinkingFeed(message);
  let bar = contentEl.querySelector(".klui-bar");
  if (!bar) {
    contentEl.insertAdjacentHTML("afterbegin", renderKluiThinkingStatus(message, { label, active, feed, startedAt: message.activityStartedAt }));
    hydrateKluiBars(contentEl);
    return true;
  }
  updateKluiBar(bar, { label, feed, active });
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

// Compare and council lanes stream side by side. Repaint only the lane that changed,
// never the whole chat, or every hidden reasoning chunk makes all lanes flicker.
function queueLaneStreamRender(message, event) {
  const choice = event.event?.choices?.[0];
  // Reasoning hidden from this user arrives as empty chunks: nothing on screen changes.
  if (choice && !isStreamDeltaEvent(event) && !choice.finish_reason && !choice.delta?.tool_calls) return;
  if (patchKluiThinkingInPlace(message)) return;
  queueStreamingMessageRender(message);
}

// Lifecycle/stage events must not rebuild the sibling lanes or restart their bars.
function applyLaneStreamEvent(group, event, council, runKey) {
  const previous = council
    ? (event.type?.startsWith("council:chairman:") ? group.chairman : group.panelists?.[Number(event.index)])
    : group.compareResponses?.[Number(event.index)];
  const previousId = previous?.id;
  const target = council ? applyCouncilStreamEvent(group, event) : applyCompareStreamEvent(group, event);
  if (!isRunKeyActive(runKey)) return;
  const anchorId = previousId || (council ? group.panelists?.[0]?.id : group.compareResponses?.[0]?.id);
  const surface = els.messages.querySelector(`[data-message-id="${cssString(anchorId)}"]`);
  const article = surface?.closest("article.message");
  if (previousId && target && surface) {
    surface.dataset.messageId = String(target.id);
    const reasoning = surface.querySelector("details.reasoning");
    if (reasoning) reasoning.dataset.messageId = String(target.id);
  }
  if (target && /(^|:)delta$/.test(event.type)) {
    queueLaneStreamRender(target, event);
    return;
  }
  let patched = false;
  preserveMessageScroll(() => {
    patched = council
      ? councilController.patchCouncilMessage(article, group, { streaming: true })
      : compareController.patchCompareMessage(article, group.compareResponses, { streaming: true });
  });
  if (!patched) {
    queueRenderMessages();
    return;
  }
  hydrateKluiBars(article);
  if (target) queueStreamingMessageRender(target);
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
  markAssistantStopped(run?.assistantMessage);
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
  animateRestoredComposerDraft();
  els.promptInput.focus();
  return true;
}

/* A saved turn keeps running on the server when the app goes to the
   background or the connection drops, so the chat rejoins it instead of
   showing an error. Rejoining replays the reply so far and follows it live. */
const MAX_TURN_REJOINS = 5;

const turnRejoins = new Map();

const CONNECTION_LOST_MESSAGE = "Connection lost. Your reply is still being written. Open this chat again to see it.";

function isDroppedConnection(error) {
  return error?.name === "TypeError" && /fetch|network|load failed|connection/i.test(error?.message || "");
}

function shouldRejoinTurn(run, error) {
  if (!run?.turnRunId || run.cancelRequested) return false;
  if (!run.reattaching && !isDroppedConnection(error)) return false;
  const attempts = (turnRejoins.get(run.turnRunId) || 0) + 1;
  turnRejoins.set(run.turnRunId, attempts);
  return attempts <= MAX_TURN_REJOINS;
}

/* Reloads the chat; a turn still running comes back through pendingTurns. */
async function rejoinConversationTurn(conversationId, assistant) {
  for (const delay of [0, 1000, 2500, 5000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (state.activeConversationId !== conversationId || state.temporaryChat) return;
    if (await loadActiveConversation().catch(() => false)) return;
  }
  assistant.error = CONNECTION_LOST_MESSAGE;
  assistant.connectionLost = true;
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
  let rejoin = false;

  try {
    await streamConversationMessage(state.session, conversationId, { turnRunId: run.id }, {
      signal: abortController.signal,
      onEvent: (event) => {
        trackPendingTurnEvent(event, activeRun);
        if (council) {
          applyLaneStreamEvent(localAssistant, event, true, runKey);
        } else if (compareModels.length) {
          applyLaneStreamEvent(localAssistant, event, false, runKey);
        } else {
          applyStreamEvent(localAssistant, event);
          if (!isRunKeyActive(runKey)) return;
          queueStreamRenderForEvent(localAssistant, event);
        }
      }
    });
    markAssistantActivityDoneTree(localAssistant);
  } catch (error) {
    if (shouldRejoinTurn(activeRun, error)) rejoin = true;
    else if (error.name === "AbortError") localAssistant.stopped = true;
    else localAssistant.error = error.message || "The pending turn could not resume.";
  } finally {
    state.resumingTurnId = "";
    const pinned = state.autoScroll && isNearBottom(els.messages, 120);
    const scrollTop = els.messages.scrollTop;
    endConversationRun(runKey, { completed: !rejoin && !localAssistant.stopped && !localAssistant.error });
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (rejoin && state.activeConversationId === conversationId) {
      await rejoinConversationTurn(conversationId, localAssistant);
      settleLiveMessages({ pinned, scrollTop });
    } else if (state.activeConversationId === conversationId) {
      const refreshed = await fetchConversation(state.session, conversationId).catch(() => null);
      if (refreshed) {
        state.messages = refreshed.messages || state.messages;
        state.messagePage = refreshed.page || { hasMore: false, cursor: null };
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

function stageGuestSend(draft) {
  pendingGuestSend = draft;
  state.messages = [guestPreviewMessage(draft)];
  setComposerPlainText("");
  state.pastedText = "";
  state.images = [];
  renderImages();
  applyComposerHeight();
  renderMessages();
  pinMessagesToBottom();
  openGuestContinue();
  if (document.body.classList.contains("capacitor-native")) {
    els.promptInput?.blur();
    void hideNativeKeyboard();
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
  if (!state.session) {
    stageGuestSend({
      text,
      images: state.images.map((img) => ({
        file: img.file,
        category: img.category,
        previewUrl: img.previewUrl,
        attachmentId: img.attachmentId,
        uploaded: img.uploaded
      })),
      skillIds: sendSkillIds,
      skillMarks: sendSkillMarks,
      researchMode: state.researchMode
    });
    return;
  }
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
  // Council was already on when a chat with documents was opened.
  if (isCouncilMode() && councilDocumentBlock()) {
    showCouncilDocumentsNotice();
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

/* Visualize auto-repair: the server can only compile a document, so runtime
   failures surface here via the sandbox bridge. Only the latest visualize turn
   is repaired, silently, and attempts are capped per user prompt so a stubborn
   bug cannot loop. Returns true when a repair started. */
const VISUALIZE_AUTO_REPAIR_MAX_ATTEMPTS = 2;

const VISUALIZE_AUTO_REPAIR_STORE = "klui:visualize-repairs";

const visualizeRepairCounts = new Map();

// Attempts live in localStorage so a reload or a second tab cannot reset the cap; the
// in-memory map keeps the cap when storage is unavailable.
function storedVisualizeRepairs() {
  try {
    const stored = JSON.parse(localStorage.getItem(VISUALIZE_AUTO_REPAIR_STORE) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function visualizeRepairCount(key) {
  return Math.max(visualizeRepairCounts.get(key) || 0, Number(storedVisualizeRepairs()[key]) || 0);
}

function setVisualizeRepairCount(key, count) {
  visualizeRepairCounts.set(key, count);
  const stored = storedVisualizeRepairs();
  delete stored[key];
  const entries = [...Object.entries(stored), [key, count]].slice(-100);
  try {
    localStorage.setItem(VISUALIZE_AUTO_REPAIR_STORE, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

function maybeAutoRepairVisualization({ messageId, message } = {}) {
  const conversationId = state.activeConversationId;
  if (!conversationId || state.temporaryChat || state.running || !messageId) return false;

  const index = state.messages.findIndex((item) => String(item?.id) === String(messageId));
  if (index <= 0 || index !== state.messages.length - 1) return false;
  const assistant = state.messages[index];
  const userMsg = state.messages[index - 1];
  if (assistant?.role !== "assistant" || userMsg?.role !== "user" || !canRetryAssistant(assistant)) return false;
  if (!normalizeClientSkillIds(userMsg?.metadata?.skillIds).includes("visualize")) return false;
  if (!visualizeSourceFromContent(assistant.content)) return false;

  if (isFreeAccount()) return false;
  const attemptKey = `${conversationId}:${userMsg.id}`;
  const attempts = visualizeRepairCount(attemptKey);
  if (attempts >= VISUALIZE_AUTO_REPAIR_MAX_ATTEMPTS) return false;
  setVisualizeRepairCount(attemptKey, attempts + 1);

  // Silent by design: the panel stays put and switches to "Getting it ready".
  void retryFailedAssistant(String(assistant.id), "", {
    visualizeRuntimeError: String(message || "The visualization could not run.").slice(0, 300)
  }).catch(() => {});
  return true;
}

async function retryFailedAssistant(assistantMessageId, responseAdjustment = "", { visualizeRuntimeError = "" } = {}) {
  if (state.running || !state.activeConversationId || !assistantMessageId) return;

  const conversationId = state.activeConversationId;
  const runKey = conversationRunKey(conversationId, false);
  if (getConversationRun(runKey)) return;

  const index = state.messages.findIndex((message) => message.id === assistantMessageId);
  if (index <= 0) return;

  const failed = state.messages[index];
  const userMsg = state.messages[index - 1];
  if (failed?.role !== "assistant" || userMsg?.role !== "user" || !canRetryAssistant(failed)) return;
  const freeBlock = freeSendBlock({ role: selectedSingleRole(), skillIds: userMsg.metadata?.skillIds || [] });
  if (freeBlock) {
    promptUpgrade(freeBlock);
    return;
  }

  const repairSource = visualizeRuntimeError ? visualizeSourceFromContent(failed.content) : "";
  const localAssistant = {
    id: `local_assistant_${Date.now()}`,
    role: "assistant",
    content: "",
    reasoning: "",
    toolCalls: [],
    ...(repairSource ? { visualizeRepairSource: repairSource } : {})
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
  // A visual repair never shows its own failure: the original visual comes back instead.
  let repairErrored = false;

  try {
    countFreeUse("messages");
    await streamConversationMessage(state.session, conversationId, {
      retryAssistantMessageId: assistantMessageId,
      ...(responseAdjustment ? { responseAdjustment } : {}),
      ...(visualizeRuntimeError ? { visualizeRuntimeError } : {}),
      role: selectedSingleRole(),
      settings: chatRequestSettings(),
      writingStyle: normalizeWritingStyle(state.settings.writingStyle),
      agentMode: true,
      webSearch: state.settings.webSearchMode !== "off" ? "auto" : "off"
    }, {
      signal: abortController.signal,
      onEvent: (event) => {
        if (repairSource && event?.type === "error") {
          repairErrored = true;
          return;
        }
        applyStreamEvent(localAssistant, event);
        if (!isRunKeyActive(runKey)) return;
        queueStreamRenderForEvent(localAssistant, event);
      }
    });

    markAssistantActivityDoneTree(localAssistant);
    shouldReloadConversation = !repairErrored;
    await Promise.all([loadMe(), loadConversations()]).catch(() => {});
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
    endConversationRun(runKey, { completed: !wasAborted && shouldReloadConversation });
    // A silent visual repair that fails puts the previous visual back instead of an error;
    // if it breaks again, the attempt cap decides between another repair and the fallback bar.
    // Stopping a repair by hand also ends automatic repairs for this prompt.
    const repairFailed = Boolean(repairSource) && !shouldReloadConversation;
    if (repairFailed && wasAborted) setVisualizeRepairCount(`${conversationId}:${userMsg.id}`, VISUALIZE_AUTO_REPAIR_MAX_ATTEMPTS);
    // Find the draft by identity: loading older messages mid-repair shifts indexes.
    const draftIndex = repairFailed ? (activeRun.messages?.indexOf(localAssistant) ?? -1) : -1;
    if (draftIndex >= 0) {
      activeRun.messages[draftIndex] = failed;
      if (stillActive) renderMessages();
    } else if (shouldReloadConversation && stillActive) {
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

// `voice` (voice mode) sends a spoken turn with Think and the voice prompt, leaves the composer
// alone, and reports stream events; the result tells voice mode how the turn ended.
// Why a free account can't send this, or "" when it can.
function freeSendBlock({ role, skillIds = [], images = [], voice = null }) {
  if (!isFreeAccount()) return "";
  if (voice) return "Voice is on Plus and Pro. Upgrade to talk with Klui.";
  if (state.temporaryChat) return "Temporary chat is on Plus and Pro.";
  if (role === "compare" || role === "council") return `${role === "compare" ? "Compare" : "Council"} is on Plus and Pro. Upgrade to use it.`;
  if (role !== "think") return "The free plan chats with Think. Upgrade to use other models.";
  if (skillIds.length) return "Tools like slides, docs and visuals are on Plus and Pro.";
  if (state.researchMode) return "Deep Research is on Plus and Pro.";
  if (state.studyOpen || state.activeProjectId) return "Dojo and projects are on Plus and Pro.";
  if (images.some((img) => img.category === "document")) return "Documents are on Plus and Pro. The free plan can attach images.";
  if (freeAllowance("messages") < 1) {
    return `You've used today's ${state.me.usage.free.messages.limit} free messages. Upgrade for more, or come back tomorrow.`;
  }
  const newImages = images.filter((img) => img.category === "image" && img.file).length;
  if (newImages > freeAllowance("images")) {
    return `You've used today's ${state.me.usage.free.images.limit} free image uploads. Upgrade for more, or come back tomorrow.`;
  }
  return "";
}

async function executeSend({ text, images, compareModels, council = false, describeImages = false, newChat = false, editMessageId = "", keepAttachments = [], paste = null, skillIds = [], skillMarks = [], voice = null }) {
  compareController.closeCompareContextBanner();
  const sendSkillIds = editMessageId ? [] : normalizeClientSkillIds(skillIds);
  const sendSkillMarks = editMessageId ? [] : skillMarks.filter((mark) => sendSkillIds.includes(mark.id));
  // Capture the selected deck theme before any composer/skill-chip mutation below clears it.
  const sendDeckTheme = sendSkillIds.includes("slides") ? (homeModesController?.deckThemeForSend() || "") : "";
  if (illustrationSendBlocked(sendSkillIds, compareModels)) {
    showToast("Illustration works in standard chat.");
    return;
  }
  if (visualizeSendBlocked(sendSkillIds, compareModels)) {
    showToast("Visualize works with one model at a time.");
    return;
  }
  const freeBlock = freeSendBlock({ role: voice ? "think" : selectedChatRole(), skillIds: sendSkillIds, images, voice });
  if (freeBlock) {
    promptUpgrade(freeBlock);
    return voice ? { error: freeBlock } : null;
  }

  const temporaryChat = state.temporaryChat;
  const previousTemporaryMessages = temporaryChat ? temporaryHistoryForRequest() : [];
  const creatingConversation = !temporaryChat && (newChat || !state.activeConversationId);
  // Home state to restore if creating the conversation fails.
  const rollback = { messages: state.messages, messagePage: state.messagePage, projectsOpen: state.projectsOpen, studyOpen: state.studyOpen };
  const conversationPromise = creatingConversation
    ? createConversation(state.session, {
        role: selectedChatRole(),
        ...(voice ? { role: "think" } : {}),
        projectId: state.activeProjectId || (state.studyOpen ? state.activeCourseId : "") || null
      })
    : null;
  let conversationId = state.activeConversationId;
  let runKey = creatingConversation ? "" : conversationRunKey(conversationId, temporaryChat);
  if (!creatingConversation && (!runKey || getConversationRun(runKey))) return null;

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
  if (creatingConversation) {
    state.messages = [localUser, localAssistant];
  } else {
    state.messages.push(localUser, localAssistant);
  }
  if (!voice) {
    setComposerPlainText("");
    state.pastedText = "";
    if (!editMessageId) {
      closeSkillMenu();
    }
    applyComposerHeight();
    for (const item of images) forgetPendingDocument(item);
    state.images = [];
    renderImages();
  }

  if (creatingConversation) {
    state.projectsOpen = false;
    setAutoScroll(true);
    setRunning(true);
    const paintConversation = (transitionMessage = false) => {
      viewTransitionUserMessageId = transitionMessage ? localUser.id : "";
      renderShell();
      viewTransitionUserMessageId = "";
      pinMessagesToBottom();
    };
    // View transition snapshots paint above every z-index, so they would show through the voice overlay.
    if (voice) {
      paintConversation();
    } else if (typeof document.startViewTransition === "function" && !prefersReducedMotion()) {
      document.startViewTransition(() => paintConversation(true));
    } else {
      paintConversation();
      animateSentUserMessage(localUser.id);
    }

    let payload;
    try {
      payload = await conversationPromise;
    } catch (error) {
      Object.assign(state, rollback);
      if (!voice) {
        state.images = images;
        for (const item of images) rememberPendingDocument(item);
        setComposerPlainText(text, sendSkillMarks);
      }
      setRunning(false);
      renderImages();
      applyComposerHeight();
      renderShell();
      if (voice) return { error: error.message || "Chat could not be created." };
      showToast(error.message || "Chat could not be created.");
      return null;
    }
    state.conversations = [payload.conversation, ...state.conversations];
    state.activeConversationId = payload.conversation.id;
    state.messages = [localUser, localAssistant]; // re-assert: the user may have navigated while the request was in flight
    state.messagePage = { hasMore: false, cursor: null };
    conversationId = state.activeConversationId;
    runKey = conversationRunKey(conversationId, false);
    syncConversationUrl();
    renderConversations();
    renderProjectChatCrumb();
  }

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
  voice?.onStart?.(() => abortController.abort());
  setAutoScroll(true);
  syncActiveRunningUi();
  renderMessages();
  if (!creatingConversation) animateSentUserMessage(localUser.id);
  pinMessagesToBottom();
  let shouldReloadConversation = false;
  let wasAborted = false;
  let rejoinTurn = false;
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
      if (uploadedFile.category !== "document") countFreeUse("images");
      if (uploadedFile.category === "document") {
        await waitForDocumentReady(uploadedFile.id, img.file.name);
      }
      uploaded.push(uploadedFile);
    }

    const courseSources = !temporaryChat && state.studyOpen ? studyHub?.chatSources?.() || [] : [];
    const coursePages = courseSources.length ? studyHub?.chatSourcePages?.() || {} : {};
    const payload = {
      text,
      // Voice turns stream directly (no queued turn), so interrupting one keeps its partial reply.
      ...(voice ? {} : {
        clientTurnKey: (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`
      }),
      attachments: uploaded.map((item) => item.id),
      role: selectedChatRole(),
      settings: chatRequestSettings(),
      writingStyle: normalizeWritingStyle(state.settings.writingStyle),
      skillIds: sendSkillIds,
      skillMarks: sendSkillMarks,
      agentMode: true,
      webSearch: state.settings.webSearchMode !== "off" ? "auto" : "off",
      ...(courseSources.length ? { sources: courseSources } : {}),
      ...(Object.keys(coursePages).length ? { sourcePages: coursePages } : {}),
      ...(sendDeckTheme ? { deckTheme: sendDeckTheme } : {}),
      ...(paste ? { paste } : {}),
      ...(describeImages ? { describeImages: true } : {}),
      ...(editMessageId ? { editUserMessageId: editMessageId } : {}),
      ...(voice ? { role: "think", voice: true } : {})
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
          voiceStreamEvent(voice, localAssistant, event);
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
          applyLaneStreamEvent(localAssistant, event, true, runKey);
        }
      });
    } else if (compareModels.length) {
      await streamCompareConversationMessage(state.session, conversationId, {
        ...payload
      }, {
        signal: abortController.signal,
        onEvent: (event) => {
          trackPendingTurnEvent(event, activeRun);
          applyLaneStreamEvent(localAssistant, event, false, runKey);
        }
      });
    } else {
      countFreeUse("messages");
      await streamConversationMessage(state.session, conversationId, payload, {
        signal: abortController.signal,
        onEvent: (event) => {
          trackPendingTurnEvent(event, activeRun);
          applyStreamEvent(localAssistant, event);
          voiceStreamEvent(voice, localAssistant, event);
          if (!isRunKeyActive(runKey)) return;
          queueStreamRenderForEvent(localAssistant, event);
        }
      });
    }

    voice?.onStreamEnd?.();
    markAssistantActivityDoneTree(localAssistant);
    await (temporaryChat ? loadMe() : Promise.all([loadMe(), loadConversations()]));
    shouldReloadConversation = true;
  } catch (err) {
    if (shouldRejoinTurn(activeRun, err)) {
      rejoinTurn = true;
    } else if (err.name === "AbortError") {
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
      markAssistantStopped(localAssistant);
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
    endConversationRun(runKey, { completed: !wasAborted && shouldReloadConversation });
    if (rejoinTurn && stillActive) {
      await rejoinConversationTurn(conversationId, localAssistant);
      settleLiveMessages({ pinned, scrollTop });
    } else if (shouldReloadConversation && !temporaryChat && stillActive) {
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
  return { ok: shouldReloadConversation, aborted: wasAborted, error: localAssistant.error || "" };
}

function voiceStreamEvent(voice, message, event) {
  if (!voice) return;
  if (typeof event?.type === "string" && event.type.startsWith("tool:")) voice.onTool?.(event);
  const content = typeof message.content === "string" ? message.content : rawTextContent(message.content);
  if (content) voice.onText?.(content);
}

async function resumeGuestSend() {
  const memory = pendingGuestSend;
  const stored = serializeGuestDraft(memory || {});
  const liveImages = liveGuestImages(memory?.images);
  if (!guestDraftHasPreview({ ...stored, images: liveImages })) {
    clearGuestSend();
    return;
  }
  closeAuthDialog();
  closeGuestContinue();
  if (!hasChatAccess()) return;
  setComposerPlainText(stored.text, stored.skillMarks);
  state.images = liveImages;
  renderImages();
  applyComposerHeight();
  if (stored.researchMode) state.researchMode = true;
  await sendPrompt({ skipClarification: true });
  if (state.activeConversationId || state.messages.some((message) => message.id !== "local_guest")) {
    clearGuestSend();
  }
}

/** bootstrap() reopens a research report linked from the URL. */
async function openRouteResearchReport() {
  const reportId = researchIdFromLocation();
  if (reportId) await researchController.openResearchReport(reportId, { push: false });
}

function applyEmailSource(card, source) {
  emailHistory(card);
  const fields = emailCardFields(source);
  card.querySelector('[data-email-field="to"]').value = fields.to;
  card.querySelector('[data-email-field="subject"]').innerHTML = fields.subjectHtml;
  card.querySelector('[data-email-field="body"]').innerHTML = fields.bodyHtml;
  recordEmailEdit(card);
}

function persistEmailRevisionLocally(messageId, source, emailIndex) {
  const message = state.messages.find((item) => String(item?.id || "") === String(messageId || ""));
  if (!message) return;
  message.content = replaceEmailFence(message.content, source, emailIndex);
}

async function submitEmailRevise(form) {
  const input = form.querySelector("[data-email-revise-input]");
  const instruction = input?.value.trim() || "";
  const card = form.closest("[data-email-card]");
  if (!instruction) { input?.focus(); return; }
  if (!card || card.classList.contains("is-revising")) return;
  if (state.running) { showToast("Wait for the current response to finish."); return; }
  const article = card.closest("[data-message-id]");
  const messageId = article?.dataset.messageId || "";
  const emailIndex = article ? [...article.querySelectorAll("[data-email-card]")].indexOf(card) : 0;
  const { to, subject, body } = emailCardValues(card);
  card.classList.add("is-revising");
  card.inert = true;
  input.disabled = true;
  form.querySelector("button[type='submit']")?.setAttribute("disabled", "");
  try {
    const result = await reviseEmailDraft(state.session, {
      draft: `To: ${to}\nSubject: ${subject}\n\n${body}`,
      instruction,
      messageId: state.temporaryChat ? "" : messageId,
      emailIndex
    });
    const source = String(result?.source || "").trim();
    if (!source) throw new Error("No revision returned.");
    applyEmailSource(card, source);
    persistEmailRevisionLocally(messageId, source, emailIndex);
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

// Voice mode: the live session and the Settings picker (declared early: settings code runs at load).
let voiceSession = null;

function voicePrefs() {
  return { voice: normalizeVoiceId(state.settings.voiceId), speed: normalizeVoiceSpeed(state.settings.voiceSpeed) };
}

function saveVoicePrefs({ voice, speed }) {
  updateSetting("voiceId", normalizeVoiceId(voice));
  updateSetting("voiceSpeed", normalizeVoiceSpeed(speed));
  updateSetting("voiceChosen", true);
}

function pickVoiceMode({ first = false, engine } = {}) {
  const { voice, speed } = voicePrefs();
  return openVoicePicker({
    voice,
    speed,
    engine,
    first,
    onSave: saveVoicePrefs,
    onError: showToast,
    reducedMotion: prefersReducedMotion()
  });
}

async function openVoiceMode() {
  if (voiceSession?.active) return;
  if (!requireAuth()) return;
  if (!hasChatAccess()) {
    openUpgradePlans();
    return;
  }
  if (blockedOnFree("Voice is on Plus and Pro. Upgrade to talk with Klui.")) return;
  if (!voiceModeSupported()) {
    showToast("Voice mode is not supported in this browser.");
    return;
  }
  if (state.running) {
    showToast("Wait for the current reply to finish.");
    return;
  }
  void warmVoiceMode(state.session).catch(() => {});
  if (!state.settings.voiceChosen && !await pickVoiceMode({ first: true })) return;
  if (voiceSession?.active) return;
  document.body.classList.add("voice-mode-open");
  let releaseKeepAlive = () => {};
  const session = createVoiceSession({
    api: {
      transcribe: (blob, options) => transcribeVoiceTurn(state.session, blob, options),
      speak: (text, voice, speed, options) => synthesizeVoice(state.session, { text, voice, speed }, options)
    },
    sendTurn: (text, hooks) => executeSend({ text, images: [], compareModels: [], voice: hooks }),
    prefs: voicePrefs,
    pickVoice: (options) => pickVoiceMode(options),
    escapeHtml,
    reducedMotion: prefersReducedMotion(),
    // The Android app keeps talking with the screen off or another app open.
    keepRunningHidden: isNative(),
    onLive: () => { releaseKeepAlive = keepVoiceRunning(session); },
    onToast: showToast,
    onClose: () => {
      releaseKeepAlive();
      // A newer conversation may already be open; only this one's state is cleared.
      if (voiceSession !== session) return;
      voiceSession = null;
      document.body.classList.remove("voice-mode-open");
      updateSendButton();
    }
  });
  voiceSession = session;
  document.body.append(session.root);
  await session.start();
}

/* Holds the Android background service for one voice conversation and returns
   its release. If Android refuses (Klui left the screen while voice mode was
   starting), it tries again when Klui is back on screen. */
function keepVoiceRunning(session) {
  let released = false;
  let hold = null;
  const retry = () => {
    if (document.hidden || released) return;
    document.removeEventListener("visibilitychange", retry);
    hold?.stop();
    void acquire();
  };
  const acquire = async () => {
    const next = await keepVoiceSessionAlive({ onEnd: () => void session.close() });
    if (released || !session.active) { next.stop(); return; }
    hold = next;
    if (next.running) return;
    if (document.hidden) document.addEventListener("visibilitychange", retry);
    else showToast("Voice mode will pause if you leave Klui.");
  };
  void acquire();
  return () => {
    released = true;
    document.removeEventListener("visibilitychange", retry);
    hold?.stop();
  };
}

let voiceSettingsPicker = null;

// After a delete: the usage meter, the profile menu and Settings' file list.
function refreshAccountStorage() {
  return loadMe()
    .then(() => {
      renderProfileMenu();
      return loadAccountStorage();
    })
    .catch(() => {});
}

// The overlay is the store's.
function openStorageDrawer() {
  if (!state.session) return;
  closeProfileMenu();
  set({ sidebarOpen: false, accountOpen: true, overlay: "account" });
  // React redraws the drawer from the store once `me` is fresh.
  loadMe()
    .then(() => renderProfileMenu())
    .catch(() => {});
}

function openAdminDrawer() {
  set({ sidebarOpen: false });
  openStorageDrawer();
}

function renderVoiceSettings() {
  const host = els.voiceSettingsPicker;
  if (!host) return;
  voiceSettingsPicker?.destroy();
  const { voice, speed } = voicePrefs();
  host.innerHTML = voicePickerMarkup({ voice, speed });
  voiceSettingsPicker = bindVoicePicker(host.querySelector(".voice-picker"), {
    voice,
    speed,
    onChange: saveVoicePrefs,
    onError: showToast,
    reducedMotion: prefersReducedMotion()
  });
}

// The pricing screen is React's (PaywallView); a ?coupon= link is applied as it opens.
function openUpgradePlans() {
  if (!state.session) return;
  closeProfileMenu();
  set({ sidebarOpen: false });
  closeAllDrawers();
  if (isNative()) {
    showToast("Subscribe on the website.");
    return;
  }
  if (!hasUpgradePlans()) return;
  showOnly(els.paywallView);
  applyCouponFromUrl();
}

const GOOGLE_FONTS_HREF = "https://fonts.googleapis.com/css2?family=Orbitron:wght@700&display=swap";

function loadGoogleFonts() {
  if (document.getElementById("kluiGoogleFonts")) return;
  const link = document.createElement("link");
  link.id = "kluiGoogleFonts";
  link.rel = "stylesheet";
  link.href = GOOGLE_FONTS_HREF;
  document.head.appendChild(link);
}

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
  added: new Set(),
  docked: false,
  suggestions: [],
  onClose: null
};

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
  renderSideChatSuggestions();
  // Context is always attached — empty prompt is still sendable.
  els.sideChatSend.disabled = sideChatState.running || !sideChatState.context;
  if (beforePinned) {
    els.sideChatMessages.scrollTop = els.sideChatMessages.scrollHeight;
  } else {
    els.sideChatMessages.scrollTop = beforeScrollTop;
  }
}

// One-tap prompts: stacked while the chat is empty, then a single scrolling row.
function renderSideChatSuggestions() {
  const box = els.sideChatSuggest;
  if (!box) return;
  const list = sideChatState.suggestions;
  box.classList.toggle("hidden", !list.length);
  box.classList.toggle("is-row", sideChatState.messages.length > 0);
  const markup = list.map(([label], index) => `<button type="button" data-side-chat-suggest="${index}"${sideChatState.running ? " disabled" : ""}>${escapeHtml(label)}</button>`).join("");
  if (box.innerHTML !== markup) box.innerHTML = markup;
}

function setSideChatDocked(docked) {
  sideChatState.docked = docked;
  els.sideChatPanel?.classList.toggle("is-docked", docked);
  document.body.classList.toggle("side-chat-docked", docked);
  if (docked && els.sideChatPanel) {
    els.sideChatPanel.style.left = "";
    els.sideChatPanel.style.top = "";
  }
}

function closeSideChat() {
  const onClose = sideChatState.onClose;
  sideChatState.onClose = null;
  sideChatState.suggestions = [];
  setSideChatDocked(false);
  if (els.sideChatTitle) els.sideChatTitle.textContent = "Side chat";
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
  onClose?.();
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
  sideChatState.suggestions = Array.isArray(options.suggestions) ? options.suggestions : [];
  sideChatState.onClose = typeof options.onClose === "function" ? options.onClose : null;
  if (els.sideChatTitle) els.sideChatTitle.textContent = options.title || "Side chat";
  els.sideChatContext.textContent = sideChatState.context.replace(/\s+/g, " ").slice(0, 180);
  if (els.sideChatInput) {
    els.sideChatInput.value = options.initialText || "";
    els.sideChatInput.placeholder = sideChatState.flashcard ? "Ask any doubts." : "Ask about this";
  }
  els.sideChatPanel.classList.remove("hidden");
  setSideChatDocked(Boolean(options.docked));
  if (sideChatState.docked) {
    renderSideChat();
    if (options.focus) els.sideChatInput?.focus();
    if (options.send && els.sideChatInput?.value.trim()) void sendSideChatMessage();
    return;
  }
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
    await streamTemporaryChat(state.session, {
      text,
      messages: history,
      role: sideChatState.role || selectedSingleRole(),
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

let studyHub = {
  closeSession() {},
  handleEscape() { return false; },
  render() {}
};

let studyHubPromise;

function syncStudyUrl({ replace = false } = {}) {
  if (suppressUrlSync) return;
  const target = state.activeCourseId ? `/study/${encodeURIComponent(state.activeCourseId)}` : "/study";
  if (window.location.pathname === target) return;
  window.history[replace ? "replaceState" : "pushState"]({ courseId: state.activeCourseId || "" }, "", target);
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
  if (!isCourse && !PROJECTS_ENABLED) {
    els.projectChatCrumb.classList.add("hidden");
    document.body.classList.remove("project-chat-open");
    return;
  }
  const name = project?.name || (isCourse ? "Course" : "Project");
  els.projectChatCrumb.dataset.projectId = isCourse ? "" : projectId;
  els.projectChatCrumb.dataset.courseId = isCourse ? projectId : "";
  els.projectChatCrumb.classList.toggle("study-chat-crumb", isCourse);
  els.projectChatCrumb.setAttribute("aria-label", `Back to ${name}`);
  if (els.projectChatCrumbName) els.projectChatCrumbName.textContent = name;
}

async function loadStudyHub() {
  if (!studyHubPromise) {
    // The Dojo's page is the React one in src/dojo; studyHub.js stays its engine.
    studyHubPromise = Promise.all([import("./studyHub.js"), import("../dojo/host")]).then(([{ createStudyHubController }, { createDojoHost }]) => {
      const host = createDojoHost(els.studyView);
      studyHub = createStudyHubController({
        host,
        state,
        els,
        // The sidebar is the store's (state/body.ts).
        closeSidebar: () => set({ sidebarOpen: false }),
        escapeHtml,
        renderContent,
        showToast,
        requireAuth,
        blockChatNavigationWhileRunning,
        parkActiveConversationRun,
        clearClarification,
        closeDocumentViewer,
        openDocumentViewer,
        syncPagePicks,
        renderShell,
        renderImages,
        openConversation,
        openDeleteConfirm,
        openTitleRename,
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
        fetchStudyPodcast,
        updateStudyPodcast,
        deleteStudyPodcast,
        prepareStudyTutor,
        fetchStudyTutor,
        updateStudyTutor,
        deleteStudyTutor,
        transcribeTutorAudio,
        transcribeDictation: async (blob) => String((await transcribeSpeech(state.session, await voiceRecordingWav(blob))).transcript || "").trim(),
        speechEnabled: () => Boolean(state.config?.services?.speech),
        streamTutorTurn,
        endStudyTutor,
        openTutorBoard,
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
      host.attach(studyHub);
      studyHub.bindEvents();
      return studyHub;
    });
  }
  return studyHubPromise;
}

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

function renderProjects() {
  if (!els.projectView) return;
  // Reuse the single composer DOM node instead of duplicating it: park it back
  // next to #composerHomeAnchor when leaving a project, then move it into
  // .project-composer-slot for project detail. Fragile if surrounding render
  // order or markup around the anchor/slot changes — keep those stable.
  if (els.composerHomeAnchor && els.composerArea && els.composerArea.parentElement !== els.composerHomeAnchor.parentElement) {
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

function syncProjectsUrl({ replace = false } = {}) {
  if (suppressUrlSync) return;
  const target = state.activeProjectId ? `/projects/${encodeURIComponent(state.activeProjectId)}` : "/projects";
  if (window.location.pathname === target) return;
  window.history[replace ? "replaceState" : "pushState"]({ projectId: state.activeProjectId || "" }, "", target);
}

async function openProjects({ replace = false } = {}) {
  if (!PROJECTS_ENABLED) return;
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
  set({ sidebarOpen: false });
  await loadProjects();
  syncProjectsUrl({ replace });
  renderShell();
}

async function openProject(projectId, { replace = false } = {}) {
  if (!PROJECTS_ENABLED) return;
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
  set({ sidebarOpen: false });
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

// confirmPendingDelete(): the file and project branches. React's confirm dialog
// closes itself and hands over the id it was opened with.
async function deletePendingAttachment(attachmentId) {
  const projectId = state.activeProjectId;
  const projectDocuments = state.activeProject?.documents || [];
  const removedDocumentIndex = projectDocuments.findIndex((document) => {
    const attachment = Array.isArray(document.attachments) ? document.attachments[0] : document.attachments;
    return attachment?.id === attachmentId;
  });
  const removedDocument = projectDocuments[removedDocumentIndex];
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
}

async function deletePendingProject(deletedProjectId) {
  const deletedProject = state.projects.find((project) => project.id === deletedProjectId);
  const deletedConversations = state.conversations.filter((conversation) => conversation.project_id === deletedProjectId);
  const deletedConversationIds = new Set(deletedConversations.map((conversation) => conversation.id));
  const deletedPinnedChatIds = state.pinnedChatIds.filter((id) => deletedConversationIds.has(id));
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
}

function setTemporaryChatMode(enabled, { resetChat = true } = {}) {
  if (blockChatNavigationWhileRunning()) return;
  const next = Boolean(enabled);
  if (next && blockedOnFree("Temporary chat is on Plus and Pro.")) return;
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
    state.messagePage = { hasMore: false, cursor: null };
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

/* ─── Events: the #messages parts of bindEvents() ─── */

function bindMessageEvents() {
  els.messages?.addEventListener("click", (event) => {
    if (event.target.closest("[data-message-error-reload]")) reloadAppIfSafe();
  });
  if (els.messages) els.messages.style.overflowAnchor = "none";
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".message-more-menu")) {
      document.querySelectorAll(".message-more-menu[open]").forEach((menu) => menu.removeAttribute("open"));
    }
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
  els.messages.addEventListener("scroll", () => {
    queueChatNavigationUpdate();
    maybeLoadOlderMessages();
  }, { passive: true });
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
      if (isMobileLayout() && compactBottomSettleTimer) return;
      clearCompactBottomSettleTimer();
      compactBottomSettleTimer = setTimeout(() => {
        compactBottomSettleTimer = null;
        if (els.composer.classList.contains("compact") && distanceFromBottom(els.messages) <= 2) {
          els.composer.classList.remove("compact");
        }
      }, 120);
    };
    const updateCompact = () => {
      if (!state.messages.length || document.body.classList.contains("study-open") || composerHasPendingContent() || composerHasFocus()) {
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
    if (isMobileLayout()) focusPromptInput();
    else requestAnimationFrame(() => {
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

  els.guestContinueSignup?.addEventListener("click", startSidebarLogin);
  els.lightboxClose.addEventListener("click", (e) => { e.stopPropagation(); closeLightbox(); });
  els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) closeLightbox(); });
  els.pastedTextDialogClose?.addEventListener("click", closePastedTextDialog);
  els.pastedTextDialog?.addEventListener("click", (e) => {
    if (e.target === els.pastedTextDialog) closePastedTextDialog();
  });
  els.documentViewerClose?.addEventListener("click", closeDocumentViewer);
  els.documentViewerResizer?.addEventListener("pointerdown", beginDocumentViewerResize);
  els.messages.addEventListener("click", async (e) => {
    const previewAction = e.target.closest("[data-study-preview-nav], [data-study-preview-flip], [data-study-preview-choice], [data-study-preview-save]");
    if (previewAction) {
      const id = previewAction.closest("[data-study-preview]")?.dataset.studyPreview;
      const artifact = state.messages.flatMap(artifactListFromMessage).find((entry) => entry.id === id && entry.type === "study_preview");
      if (!artifact) return;
      const ui = previewState(artifact);
      const nav = previewAction.dataset.studyPreviewNav;
      let navigationDirection = 0;
      if (nav) {
        const count = artifact.kind === "practice" ? artifact.questions?.length || 0 : artifact.cards?.length || 0;
        const previousIndex = ui.index;
        ui.index = Math.max(0, Math.min(count - 1, ui.index + (nav === "next" ? 1 : -1)));
        navigationDirection = Math.sign(ui.index - previousIndex);
        ui.flipped = false;
        ui.choice = -1;
      } else if (previewAction.hasAttribute("data-study-preview-flip")) ui.flipped = true;
      else if (previewAction.hasAttribute("data-study-preview-choice")) {
        ui.choice = Number(previewAction.dataset.studyPreviewChoice);
        ui.flipped = true;
      } else if (previewAction.dataset.studyPreviewSave && !ui.busy) {
        ui.busy = true;
        renderMessages();
        try {
          if (artifact.kind === "mindmap") {
            await createStudyNote(state.session, artifact.course_id, { documentFileId: artifact.document_file_id, title: artifact.title, content: artifact.content });
            ui.saved.add("map");
          } else {
            const items = artifact.kind === "practice" ? artifact.questions || [] : artifact.cards || [];
            const indexes = previewAction.dataset.studyPreviewSave === "all" ? items.map((_, index) => index) : [ui.index];
            const deck = (state.studyPractice?.decks || []).find((entry) => entry.id === ui.deck);
            for (const index of indexes) {
              if (ui.saved.has(index)) continue;
              const item = studyPreviewItem(artifact, index);
              const front = artifact.kind === "practice" && item.choices.length
                ? `${item.front}\n\n${item.choices.map((choice, i) => `${"ABCD"[i]}. ${choice}`).join("\n")}`
                : artifact.kind === "practice" ? item.front : items[index].front;
              await createStudyCard(state.session, artifact.course_id, {
                front, back: item.back,
                ...(artifact.kind === "flashcards" && items[index].sources?.length ? { sources: items[index].sources } : {}),
                ...(ui.deck === "new" ? { deckKey: ui.newDeckKey, deckTitle: `From ${artifact.source || "chat"}` }
                  : deck?.deckKey ? { deckKey: deck.deckKey }
                    : deck?.noteId ? { noteId: deck.noteId }
                      : deck?.documentFileId ? { documentFileId: deck.documentFileId } : {}),
                ...(!deck && ui.deck === "new" ? { documentFileId: artifact.document_file_id } : {})
              });
              ui.saved.add(index);
            }
          }
          if (state.activeCourseId === artifact.course_id) {
            state.studyPractice = await fetchStudyPractice(state.session, artifact.course_id);
            const materials = await fetchStudyMaterials(state.session, artifact.course_id);
            state.studyMaterials = materials;
            studyHub.render();
          }
          showToast(artifact.kind === "mindmap" ? "Mind map saved to Create" : "Added to Create");
        } catch (error) { showToast(error.message || "Could not save study material."); }
        finally { ui.busy = false; }
      }
      renderMessages();
      if (navigationDirection) {
        const preview = [...els.messages.querySelectorAll("[data-study-preview]")].find((node) => node.dataset.studyPreview === id);
        preview?.querySelector(`[data-study-preview-nav="${nav}"]`)?.focus({ preventScroll: true });
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          preview?.querySelector(".study-inline-card")?.animate([
            { opacity: .65, transform: `translateX(${navigationDirection * 12}px) rotateY(${navigationDirection * 3}deg)` },
            { opacity: 1, transform: "translateX(0) rotateY(0)" }
          ], { duration: 180, easing: "cubic-bezier(.23,1,.32,1)" });
        }
      }
      return;
    }
    const visualizeFix = e.target.closest("[data-visualize-fix]");
    if (visualizeFix) {
      const card = visualizeFix.closest(".visualize-card");
      const messageId = card?.closest("[data-message-id]")?.dataset.messageId || "";
      if (card?.dataset.runtimeError && maybeAutoRepairVisualization({ messageId, message: card.dataset.runtimeError })) return;
      showToast("Retry the message to rebuild this visual.");
      return;
    }
    const visualizeExpand = e.target.closest("[data-visualize-expand]");
    if (visualizeExpand) {
      const card = visualizeExpand.closest(".visualize-card");
      const expanded = !card?.classList.contains("is-expanded");
      if (expanded) collapseExpandedVisualize(card);
      setVisualizeExpanded(card, expanded);
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

    const pageCite = e.target.closest("[data-doc-cite]");
    if (pageCite) {
      e.preventDefault();
      const page = Number(pageCite.dataset.docPage) || 1;
      // In Dojo the page opens in the Sources panel beside the chat.
      if (state.studyOpen && studyHub?.openSourcePage?.(pageCite.dataset.docFile, page, e)) return;
      if (!state.session?.access_token) {
        showToast("Sign in to view files.");
        return;
      }
      openDocumentViewer({ attachmentId: pageCite.dataset.docCite, fileName: pageCite.dataset.fileName || "Document", page });
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
      const app = emailChoice.dataset.emailOpen;
      const values = emailCardValues(emailChoice.closest("[data-email-card]"));
      closeEmailMenus();
      composeEmailNatively(app, values)
        .then((opened) => opened || openExternal(emailComposeUrls[app](values)))
        .catch(() => showToast("Could not open email."));
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
  els.messages.addEventListener("change", (event) => {
    const select = event.target.closest("[data-study-preview-deck]");
    if (!select) return;
    const id = select.closest("[data-study-preview]")?.dataset.studyPreview;
    const artifact = state.messages.flatMap(artifactListFromMessage).find((entry) => entry.id === id && entry.type === "study_preview");
    if (artifact) previewState(artifact).deck = select.value;
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

  window.addEventListener("message", (event) => applyVisualizeFrameMessage(event, document, {
    onRuntimeError: (report) => maybeAutoRepairVisualization(report)
  }));

}
let lastMessagesTouchY = 0;

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

function attachmentDownloadPath(href) {
  const path = String(href || "").trim();
  const match = path.match(/^\/api\/attachments\/([^/?#]+)\/download\/?$/i);
  return match ? match[1] : "";
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

function autoSizeEditInput(input) {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 320)}px`;
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

function blurEmptyComposerForHistoryScroll() {
  if (composerHasPendingContent()) return;
  if (!composerHasFocus()) return;
  els.promptInput?.blur();
  void hideNativeKeyboard();
}

async function addConversation() {
  if (!requireAuth()) return;
  openNewChat();
}

// Island change: the SessionManager signs out (and the store drops the account
// when the session clears); the rest is the old reset.
async function signOutAndReset() {
  // Save and close an open whiteboard while the session can still save it.
  await Promise.resolve(studyHub.closeWhiteboard?.()).catch(() => {});
  // The session subscriber in boot.ts stops the pollers (handleSessionEnded).
  await session.signOut();
  clearGuestSend();
  state.me = null;
  resetAccountData();
  resetBilling();
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

/* ─── Events: the research report (bindEvents) ─── */

function bindResearchEvents() {
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
}

/* ─── Events: Settings (bindEvents) ─── */

function bindSettingsEvents() {
  els.settingsDrawer?.addEventListener("click", (event) => {
    if (!els.settingsDrawer.classList.contains("open")) return;
    if (event.target.closest(".settings-panel")) return;
    closeSettings();
  });
}

/** The data half of setSettingsTab(); React marks the tab and shows its panel. */
function settingsTabSelected(selected) {
  if (selected !== "voice") voiceSettingsPicker?.stopPreview();
  if (selected === "voice") renderVoiceSettings();
  loadSettingsTab(selected);
}

/* ─── Events: text selection and the side chat (bindEvents) ─── */

function bindSelectionEvents() {
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
  els.sideChatSuggest?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-side-chat-suggest]");
    const prompt = sideChatState.suggestions[Number(button?.dataset.sideChatSuggest)]?.[1];
    if (!prompt || sideChatState.running || !els.sideChatInput) return;
    els.sideChatInput.value = prompt;
    void sendSideChatMessage();
  });
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
    if (event.button !== 0 || event.target.closest("button") || sideChatState.docked) return;
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
    if (!event.target.closest("#selectionActions")) hideSelectionActions();
  });
}

/* ─── Events: the Dojo and the project crumb (bindEvents) ─── */

function bindStudyEvents() {
  els.studyHubButton?.addEventListener("click", () => {
    set({ sidebarOpen: false });
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
}

/* ─── Events: the temporary chat toggle (bindEvents) ─── */
function bindTemporaryChatEvents() {
  els.temporaryChatToggle?.addEventListener("click", () => {
    if (!requireAuth()) return;
    setTemporaryChatMode(!state.temporaryChat);
    // Force-clear the press highlight so toggling off never leaves a stuck
    // ring on the icon. (transitionend-based removal has a perceptible
    // gap that the user noticed.)
    els.temporaryChatToggle?.classList.remove("pressed");
    if (!isNative()) els.promptInput?.focus();
    else if (state.temporaryChat) focusPromptInput();
  });
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
}

/* ─── Events: outside clicks and Escape for the chat's own surfaces (bindEvents) ─── */
// The store's document listeners (globalEvents.ts) close the shell's menus;
// these are the old handlers' lines for surfaces inside #messages.
function bindChatDismissEvents() {
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".sources-pill")) {
      closeOpenSourcesPills();
    }
    if (!event.target.closest(".klui-email-send-wrap")) closeEmailMenus();
    if (!event.target.closest("[data-email-revise-form], [data-email-edit]")) {
      document.querySelectorAll("[data-email-card].is-editing").forEach((card) => setEmailEditing(card, false));
    }
  });
  // Close dropdown on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePastedTextDialog();
      const card = document.querySelector(".visualize-card.is-expanded");
      if (card) card.querySelector("[data-visualize-expand]")?.click();
    }
  });
}

/* ─── Events: back and forward (bindEvents) ─── */

function bindHistoryEvents() {
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
        studyHub.showCourseHome?.();
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
      await openConversation(routeConversationId);
    } catch (err) {
      showToast(err.message);
    } finally {
      suppressUrlSync = false;
    }
  });
}

/* ─── Events: the composer parts of bindEvents() ─── */

function bindComposerEvents() {
  els.imageFileInput.addEventListener("change", (e) => {
    acceptPendingFiles(e.target.files || []);
    e.target.value = "";
  });
  setCameraPhotoHandler((file) => acceptPendingFiles([file]));
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

  els.sendButton.addEventListener("pointerdown", (event) => {
    if (!document.body.classList.contains("capacitor-native") || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    els.sendButton.click();
  });
  els.sendButton.addEventListener("click", (event) => {
    // Native pointer gestures act on pointerdown; detail=0 keeps keyboard/AT clicks working.
    if (document.body.classList.contains("capacitor-native") && event.detail > 0) return;
    if (els.sendButton.disabled || voiceState === "processing") return;
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
  els.voiceModeButton?.addEventListener("click", () => { void openVoiceMode(); });
  els.stopButton.addEventListener("pointerdown", () => { stopPressStarted = true; });
  els.stopButton.addEventListener("click", (event) => {
    if (event.detail > 0 && !stopPressStarted) return;
    stopPressStarted = false;
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
    if (isLongPaste && !state.running && state.session) {
      addTextToComposerPaste(pasted);
      return;
    }
    insertComposerText(pasted);
    applyComposerHeight();
    updateSendButton();
    syncSkillMenu();
  });

}

/* ─── Mount ─── */

// #guestContinue moves in and out of #messages (mountGuestContinue), so the
// chat core creates it, where public/index.html had it: right after #messages.
const GUEST_CONTINUE_HTML = `<section class="message assistant guest-continue hidden" id="guestContinue" role="region" aria-labelledby="guestContinueTitle" aria-hidden="true">
  <div class="message-body">
    <div class="guest-continue-card">
      <h2 id="guestContinueTitle">Continue your conversation</h2>
      <p>Sign up to continue seamlessly with Klui's full power</p>
      <ul class="guest-continue-list">
        <li>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.49"/></svg>
          <span>Upload files and images</span>
        </li>
        <li>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 14.2 16.6 5.6a1.05 1.05 0 0 1 1.48 0l1.15 1.15a1.05 1.05 0 0 1 0 1.48L10.6 16.8z"/><path d="M6.2 15.6 8.4 13.4"/><path d="M6.5 16.2h11a1 1 0 0 1 1 1V19H5.5v-1.8a1 1 0 0 1 1-1z"/><path d="M4.5 19.5h15a1 1 0 0 1 1 1V22H3.5v-1.5a1 1 0 0 1 1-1z"/></svg>
          <span>Use compare, council and deep research.</span>
        </li>
        <li>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15.5-4.2-4.2a1.5 1.5 0 0 0-2.1 0L6 20"/></svg>
          <span>Create illustrations and visualizations</span>
        </li>
        <li>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9.5C7.4 20.4 4 17 4 12V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>
          <span>Klui doesn't train on your chats</span>
        </li>
      </ul>
      <button type="button" id="guestContinueSignup">Sign up for free</button>
    </div>
  </div>
</section>`;

const standIn = () => document.createElement("div");
let mountedMessages = null;

/** Creates the controllers and binds the chat once per page, as bindEvents()
   did; renders on every renderShell(). AppRoot is the root and never unmounts,
   so there is no teardown. Only a development hot update can re-create the
   elements, and then the page reloads rather than run on stale bindings. */
export function mountChat() {
  if (mountedMessages) {
    if (mountedMessages !== els.messages && import.meta.hot) location.reload();
    return;
  }
  mountedMessages = els.messages;
  els.messages.nextSibling.after(document.createRange().createContextualFragment(GUEST_CONTINUE_HTML), " ");
  createChatDocumentViewer();
  researchController = createResearchController({
    elements: {
      researchReportView: els.researchReportView,
      researchReportBack: els.researchReportBack,
      researchVisualTab: els.researchVisualTab,
      researchTextTab: els.researchTextTab,
      researchCopy: els.researchCopy,
      researchDownload: els.researchDownload,
      researchDownloadMenu: els.researchDownloadMenu,
      researchReportLoading: els.researchReportLoading,
      researchReportLayout: els.researchReportLayout,
      researchReportToc: els.researchReportToc,
      researchReportArticle: els.researchReportArticle,
      researchReportSources: els.researchReportSources,
      researchReportSourcesSummary: els.researchReportSourcesSummary,
      chatView: els.chatView,
      promptInput: els.promptInput,
      messages: els.messages
    },
    state,
    createResearch,
    exportResearchReport,
    fetchResearchStatus,
    fetchResearchReport,
    fetchDocumentJobStatus,
    downloadAttachment,
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

  compareController = createCompareController({
    elements: {
      compareContextBanner: els.compareContextBanner,
      // The compare controls are React's (Composer); the controller writes to stand-ins.
      compareDropdown: standIn(),
      compareButton: standIn(),
      compareWrap: null,
      compareInput: standIn(),
      compareCatalog: standIn(),
      compareLabel: standIn(),
      councilWrap: null,
      councilButton: standIn(),
      councilLabel: standIn(),
      modeSwitch: standIn()
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
    compareIncludesTextOnlyModels,
    renderResearchMode
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
    renderCompareControls: () => compareController.renderCompareControls(),
    renderResearchMode,
    renderKluiThinkingStatus,
    updateKluiBar
  });
  bindMessageEvents();
  bindComposerEvents();
  bindResearchEvents();
  bindSettingsEvents();
  bindSelectionEvents();
  bindStudyEvents();
  bindTemporaryChatEvents();
  bindChatDismissEvents();
  bindHistoryEvents();
  Object.assign(chatHooks, {
    openUpgradePlans,
    openAdminDrawer,
    refreshChatList,
    deletePendingAttachment,
    deletePendingProject,
    openStudyHub: () => { void loadStudyHub().then((hub) => hub.openCourses()); },
    // setResearchMode() and enterCouncilMode(): the checks that need the composer.
    researchBlocked: () => {
      if (!state.images.length) return false;
      showToast("Remove attachments before starting Deep Research.");
      return true;
    },
    researchChanging: (next) => {
      clearClarification();
      if (next) closeSkillMenu();
    },
    councilBlocked: () => {
      const blocked = councilDocumentBlock();
      if (blocked) showCouncilDocumentsNotice(blocked);
      return Boolean(blocked);
    },
    renderMessages,
    settingsTabSelected,
    pendingNeedsVision: pendingPromptNeedsVision,
    showAttachmentModelNotice,
    setComposerSkillIds,
    fillComposerText: (text) => {
      setComposerPlainText(text);
      applyComposerHeight();
      updateSendButton();
      els.promptInput?.focus();
    }
  });
  Object.assign(chatSurfaces, {
    emailMenu: () => {
      if (!document.querySelector(".klui-email-menu:not([hidden])")) return false;
      closeEmailMenus();
      return true;
    },
    emailEditing: () => {
      const editingEmail = document.querySelector("[data-email-card].is-editing");
      if (!editingEmail) return false;
      setEmailEditing(editingEmail, false);
      return true;
    },
    study: () => Boolean(studyHub?.handleEscape?.()),
    skillMenu: () => {
      if (!state.skillMenu.open) return false;
      closeSkillMenu();
      return true;
    },
    compareDropdown: () => {
      if (els.compareDropdown.classList.contains("hidden")) return false;
      compareController.closeCompareDropdown();
      return true;
    },
    lightbox: () => {
      if (els.lightbox.classList.contains("hidden")) return false;
      closeLightbox();
      return true;
    },
    viewer: () => {
      if (!state.viewer.open) return false;
      closeDocumentViewer();
      return true;
    },
    guestContinue: () => {
      if (!isGuestContinueOpen()) return false;
      dismissGuestContinue();
      return true;
    },
    account: () => {
      if (!useApp.getState().accountOpen) return false;
      closeAccount();
      return true;
    }
  });
  // renderShell() re-rendered the messages and the document viewer every time
  // it ran; a guest's first renderShell() can land before React mounts this.
  const renderChatShell = () => {
    // renderShell() ran renderTemporaryChatMode() and then renderResearchMode().
    renderResearchMode();
    syncComposerSkillState();
    // ...and renderConversations(), which clears the open chat's unread dot.
    renderConversations();
    renderProjects();
    studyHub?.render();
    renderProjectChatCrumb();
    renderMessages();
    renderDocumentViewer();
    // The old renderShell() rendered projects and the study hub again after the messages.
    renderProjects();
    studyHub?.render();
    updateComposerPlaceholder();
    if (state.session && hasChatAccess()) compareController.syncCompareContextBanner();
  };
  // applyAppearance() also switched the code highlight stylesheet.
  let lastAppearance = resolvedAppearance();
  useApp.subscribe(() => {
    const appearance = resolvedAppearance();
    if (appearance === lastAppearance) return;
    lastAppearance = appearance;
    applyCodeHighlightTheme(appearance);
  });
  let lastShellRender = useApp.getState().shellRender;
  if (lastShellRender > 0 && useApp.getState().view === "chat") renderChatShell();
  useApp.subscribe((s) => {
    if (s.shellRender === lastShellRender) return;
    lastShellRender = s.shellRender;
    if (s.view === "chat") renderChatShell();
  });
  // The end of the old bindEvents().
  loadGoogleFonts();
}

/** bootstrap() starts the phone's recent-chats request alongside the account load. */
/* ─── The packaged app (public/js/app.js setupNativeLifecycle and friends) ─── */

function onTemporaryChatHome() {
  return state.temporaryChat && !state.messages.length && !state.projectsOpen && !state.studyOpen;
}

function keepTemporaryComposerOpen() {
  if (!isNative() || !onTemporaryChatHome()) return;
  if (document.body.classList.contains("keyboard-open")) return;
  if (document.visibilityState !== "visible" || document.body.classList.contains("sidebar-open")) return;
  if (Date.now() - keyboardHiddenOnPurposeAt() < 800) return;
  focusPromptInput();
}

// Mark the composer while it morphs between the full box and the scrolling
// pill so its contents stay clipped inside the moving outline.
function setupComposerMorph() {
  const composer = els.composer;
  if (!composer) return;
  let wasCompact = composer.classList.contains("compact");
  let settleTimer = null;
  new MutationObserver(() => {
    const compact = composer.classList.contains("compact");
    if (compact === wasCompact) return;
    wasCompact = compact;
    composer.classList.add("is-morphing");
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => composer.classList.remove("is-morphing"), 520);
  }).observe(composer, { attributes: true, attributeFilter: ["class"] });
}

function setupTemporaryComposerPin() {
  let keyboardWasOpen = document.body.classList.contains("keyboard-open");
  new MutationObserver(() => {
    const keyboardOpen = document.body.classList.contains("keyboard-open");
    if (keyboardOpen === keyboardWasOpen) return;
    keyboardWasOpen = keyboardOpen;
    // Let a tap that opened a menu finish before deciding the hide was stray.
    if (!keyboardOpen) setTimeout(keepTemporaryComposerOpen, 120);
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

/** setupNativeLifecycle()'s composer half; needs the mounted composer. */
export function setupNativeComposer() {
  if (!isNative()) return;
  setupTemporaryComposerPin();
  setupComposerMorph();
}

export async function handleNativeBack() {
  if (closeTopNativeSurface()) return;
  // The temporary chat home cannot close its composer; back leaves the mode.
  if (onTemporaryChatHome()) {
    setTemporaryChatMode(false);
    return;
  }
  if (document.body.classList.contains("keyboard-open")) {
    dismissComposerKeyboard();
    return;
  }
  // Inside the app, the native screens are what's behind a chat.
  if (!isEmbedded() && (state.activeConversationId || window.location.pathname !== "/")) {
    openNewChat({ replaceUrl: true });
    return;
  }
  await exitApp();
}

/** A klui.ai/c/<id> link: opened now if signed in, else after the chats load. */
export function openNativeConversation(conversationId) {
  pendingNativeConversationId = conversationId;
  if (session.current()?.access_token) openConversation(pendingNativeConversationId).catch(() => {});
}

/* Back from the background: a stream that went quiet while the app was away
   is rejoined, and a chat that lost its connection is reloaded. */
export function rejoinTurnsAfterResume() {
  const run = getConversationRun();
  if (run) {
    if (!run.turnRunId || !run.abortController || run.cancelRequested) return;
    const resumedAt = Date.now();
    setTimeout(() => {
      if (conversationRuns.get(run.key) !== run || run.cancelRequested) return;
      if ((run.lastEventAt || 0) >= resumedAt) return;
      run.reattaching = true;
      run.abortController.abort();
    }, 5000);
    return;
  }
  const conversationId = state.activeConversationId;
  if (!conversationId || state.temporaryChat || !state.messages.some((message) => message?.connectionLost)) return;
  const pinned = state.autoScroll && isNearBottom(els.messages, 120);
  const scrollTop = els.messages.scrollTop;
  void loadActiveConversation().then((loaded) => {
    if (loaded === "applied" && state.activeConversationId === conversationId) settleLiveMessages({ pinned, scrollTop });
  }).catch(() => {});
}

/** focusPromptInputSoon(): start the editor/IME as the app opens. */
export function focusPromptInputSoon() {
  // Inside the app the keyboard comes up when asked for, not when this page appears.
  if (!isNative() || isEmbedded() || location.hash === "#settings") return;
  if (studyRouteFromLocation() || projectsRouteFromLocation() || researchIdFromLocation()) return;
  focusPromptInput();
}

export function prefetchRecentChats(promise) {
  mobileRecentChats = promise;
}

export {
  addConversation,
  applyComposerHeight,
  closeGuestContinue,
  handleSessionEnded,
  openRouteResearchReport,
  restorePendingDocuments,
  resumeGuestSend,
  conversationCache,
  loadChatApp,
  loadConversations,
  loadActiveConversation,
  openConversation,
  openNewChat,
  removeConversation,
  renderMessages,
  signOutAndReset,
  stopExtractedModulePollers
};
