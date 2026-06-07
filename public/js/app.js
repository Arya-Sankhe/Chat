import {
  createConversation,
  deleteAttachment,
  deleteConversation,
  downloadAttachment,
  fetchAttachmentView,
  fetchAdminSummary,
  fetchConfig,
  fetchConversation,
  fetchDocumentJobStatus,
  fetchDocumentStatus,
  fetchMe,
  fetchModels,
  fetchPlans,
  listConversations,
  completeUpload,
  presignUpload,
  putUploadContent,
  streamCompareConversationMessage,
  streamConversationMessage,
  uploadFile
} from "./api.js";
import {
  clearSession,
  googleSignInUrl,
  loadSession,
  parseSessionFromUrl,
  refreshSession,
  saveSession,
  sendMagicLink,
  signOut
} from "./auth.js";
import {
  compactModelDisplayName,
  escapeHtml,
  modelBrandLogoUrl,
  modelSupportsVision,
  normalizeModelList,
  renderContent
} from "./render.js?v=20260607-render-currency-v1";
import { extractReasoningDelta } from "./reasoning.js";

const SETTINGS_KEY = "klui.chat.controls.v1";

const OPENROUTER_TEXT_MODEL = "deepseek/deepseek-v4-flash";
const OPENROUTER_VISION_MODEL = "xiaomi/mimo-v2.5";
const OPENROUTER_PRO_MODEL = "qwen/qwen3.7-plus";
const DEFAULT_COMPARE_MODELS = [OPENROUTER_TEXT_MODEL, OPENROUTER_VISION_MODEL];
const DEFAULT_REASONING_EFFORT = "high";
const CONTEXT_LIMIT_TOKENS = 256000;

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
  agentMode: false,
  webSearchMode: "auto",
  provider: "openrouter",
  kluiModel: ""
};

const state = {
  config: null,
  session: null,
  me: null,
  plans: [],
  conversations: [],
  activeConversationId: "",
  messages: [],
  models: [],
  settings: loadSettings(),
  images: [],
  running: false,
  autoScroll: true,
  abortController: null,
  pendingDeleteId: "",
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
    loading: false,
    error: ""
  }
};

let renderQueued = false;
let reasoningOpenIds = new Set();

const els = {
  setupView: document.querySelector("#setupView"),
  authView: document.querySelector("#authView"),
  paywallView: document.querySelector("#paywallView"),
  chatView: document.querySelector("#chatView"),
  serviceList: document.querySelector("#serviceList"),
  googleButton: document.querySelector("#googleButton"),
  magicForm: document.querySelector("#magicForm"),
  emailInput: document.querySelector("#emailInput"),
  authNotice: document.querySelector("#authNotice"),
  paywallEmail: document.querySelector("#paywallEmail"),
  paywallPlans: document.querySelector("#paywallPlans"),
  paywallSignOutButton: document.querySelector("#paywallSignOutButton"),
  sidebarButton: document.querySelector("#sidebarButton"),
  newChatButton: document.querySelector("#newChatButton"),
  accountButton: document.querySelector("#accountButton"),
  settingsButton: document.querySelector("#settingsButton"),
  conversationList: document.querySelector("#conversationList"),
  usagePill: document.querySelector("#usagePill"),
  contextMeter: document.querySelector("#contextMeter"),
  contextMeterLabel: document.querySelector("#contextMeterLabel"),
  contextMeterFill: document.querySelector("#contextMeterFill"),
  messages: document.querySelector("#messages"),
  promptInput: document.querySelector("#promptInput"),
  imagePreviews: document.querySelector("#imagePreviews"),
  imageFileInput: document.querySelector("#imageFileInput"),
  composerActionMenuWrap: document.querySelector("#composerActionMenuWrap"),
  actionMenuButton: document.querySelector("#actionMenuButton"),
  composerActionMenu: document.querySelector("#composerActionMenu"),
  imageToggle: document.querySelector("#imageToggle"),
  sendButton: document.querySelector("#sendButton"),
  stopButton: document.querySelector("#stopButton"),
  settingsButtonAlt: document.querySelector("#settingsButtonAlt"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  temperatureInput: document.querySelector("#temperatureInput"),
  topPInput: document.querySelector("#topPInput"),
  maxTokensInput: document.querySelector("#maxTokensInput"),
  seedInput: document.querySelector("#seedInput"),
  systemPromptInput: document.querySelector("#systemPromptInput"),
  modelDetails: document.querySelector("#modelDetails"),
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
  compareDropdown: document.querySelector("#compareDropdown"),
  compareInput: document.querySelector("#compareInput"),
  compareCatalog: document.querySelector("#compareCatalog"),
  compareClearButton: document.querySelector("#compareClearButton"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmBody: document.querySelector("#confirmBody"),
  confirmCancelButton: document.querySelector("#confirmCancelButton"),
  confirmDeleteButton: document.querySelector("#confirmDeleteButton"),
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
  agentModeToggle: document.querySelector("#agentModeToggle"),
  webSearchToggle: document.querySelector("#webSearchToggle"),
  providerToggle: document.querySelector("#providerToggle"),
  documentViewer: document.querySelector("#documentViewer"),
  documentViewerResizer: document.querySelector("#documentViewerResizer"),
  documentViewerTitle: document.querySelector("#documentViewerTitle"),
  documentViewerMeta: document.querySelector("#documentViewerMeta"),
  documentViewerDownload: document.querySelector("#documentViewerDownload"),
  documentViewerClose: document.querySelector("#documentViewerClose"),
  documentViewerBody: document.querySelector("#documentViewerBody")
};

function imageDescription(part) {
  return String(part?.image_url?.description || part?.image_url?.alt_text || "").trim();
}

function fileCategory(file) {
  return String(file?.type || "").startsWith("image/") ? "image" : "document";
}

function isSupportedDocumentFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return [".pdf", ".docx", ".xlsx", ".csv", ".tsv"].some((ext) => name.endsWith(ext));
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
  if (state.settings.compareEnabled) {
    return isCouncilMode() ? "Message Klui Council" : "Message Klui Compare";
  }
  return "Message Klui agent";
}

function updateComposerPlaceholder() {
  if (els.promptInput) els.promptInput.placeholder = composerPlaceholder();
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

function closeCompareContextBanner() {
  els.compareContextBanner.classList.add("hidden");
}

function syncCompareContextBanner(modelIds = selectedCompareModelIds()) {
  closeCompareContextBanner();
}

function cancelCompareMode() {
  state.compareDescribeImages = false;
  updateSetting("compareEnabled", false);
  updateSetting("compareModels", []);
  closeCompareDropdown();
  closeCompareContextBanner();
  renderCompareControls();
}

function seedCompareModels() {
  return DEFAULT_COMPARE_MODELS;
}

async function activateCompareMode() {
  updateSetting("compareModels", DEFAULT_COMPARE_MODELS);
  updateSetting("compareEnabled", true);
  state.compareDescribeImages = false;
  renderCompareControls();
}

async function startCompareFreshChat() {
  const compareModels = selectedCompareModelIds();
  const shouldDescribePendingImages = pendingPromptHasImages() && compareIncludesTextOnlyModels(compareModels);
  const payload = await createConversation(state.session, {
    model: compareModels[0] || state.settings.model
  });
  state.conversations.unshift(payload.conversation);
  state.activeConversationId = payload.conversation.id;
  state.messages = [];
  state.compareDescribeImages = shouldDescribePendingImages;
  renderConversations();
  renderShell();
}

function loadSettings() {
  try {
    const loaded = { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    loaded.compareModels = Array.isArray(loaded.compareModels) ? loaded.compareModels.slice(0, 4) : [];
    loaded.compareEnabled = false;
    loaded.compareMode = loaded.compareMode === "council" ? "council" : "compare";
    loaded.agentMode = Boolean(loaded.agentMode);
    loaded.webSearchMode = loaded.webSearchMode === "off" ? "off" : "auto";
    loaded.provider = "openrouter";
    loaded.modelMode = loaded.modelMode === "pro" ? "pro" : "thinking";
    loaded.thinkingEffort = DEFAULT_REASONING_EFFORT;
    loaded.temperature = 0.7;
    loaded.top_p = 0.95;
    loaded.kluiModel = typeof loaded.kluiModel === "string" ? loaded.kluiModel : "";
    loaded.model = loaded.modelMode === "pro" ? OPENROUTER_PRO_MODEL : OPENROUTER_TEXT_MODEL;
    return loaded;
  } catch {
    return { ...defaultSettings };
  }
}

function webSearchAvailable() {
  return Boolean(state.config?.services?.websearch);
}

function agentToolsAvailable() {
  const services = state.config?.services || {};
  return Boolean(services.websearch || services.documents);
}

function renderAgentModeToggle() {
  if (!els.agentModeToggle) return;
  if (!agentToolsAvailable()) {
    els.agentModeToggle.classList.add("hidden");
    return;
  }
  els.agentModeToggle.classList.remove("hidden");
  const on = Boolean(state.settings.agentMode);
  els.agentModeToggle.setAttribute("aria-pressed", on ? "true" : "false");
  els.agentModeToggle.setAttribute("aria-label", on ? "Agent mode on" : "Agent mode off");
  els.agentModeToggle.setAttribute(
    "title",
    on
      ? "Agent mode: On — web search and document tools are available. Click to use normal chat."
      : "Agent mode: Off — PDFs are sent as hidden page context without tool calls. Click to enable tools."
  );
}

function renderWebSearchToggle() {
  if (!els.webSearchToggle) return;
  if (!webSearchAvailable() || !state.settings.agentMode) {
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

function toggleAgentMode() {
  const next = !state.settings.agentMode;
  updateSetting("agentMode", next);
  renderAgentModeToggle();
  renderWebSearchToggle();
  showToast(next ? "Agent mode enabled. Tools can be used." : "Agent mode disabled. PDFs use direct context.");
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
      closeCompareDropdown();
    }
    showToast("Routing this chat through OpenRouter.");
  } else {
    updateSetting("provider", "klui");
    const restored = state.settings.kluiModel
      || state.models.find((m) => m.id !== OPENROUTER_VISION_MODEL)?.id
      || "";
    if (restored) updateSetting("model", restored);
    showToast("Routing this chat through Klui.");
  }
  renderProviderToggle();
  renderModelOptions();
  renderCompareControls();
}

function toggleWebSearchMode() {
  const next = state.settings.webSearchMode === "off" ? "auto" : "off";
  updateSetting("webSearchMode", next);
  renderWebSearchToggle();
  showToast(next === "off" ? "Web search disabled for this chat." : "Web search set to Auto.");
}

function isCouncilMode() {
  return state.settings.compareEnabled && state.settings.compareMode === "council";
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function updateSetting(key, value) {
  state.settings[key] = value;
  saveSettings();
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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

/* ─── View switching ─── */

function showOnly(view) {
  [els.setupView, els.authView, els.paywallView, els.chatView].forEach((el) => el.classList.add("hidden"));
  view.classList.remove("hidden");
}

function renderShell() {
  renderAuthOptions();

  if (!servicesReady()) {
    renderServices();
    showOnly(els.setupView);
    return;
  }

  if (!state.session) {
    showOnly(els.authView);
    return;
  }

  if (!hasChatAccess()) {
    els.paywallEmail.textContent = state.me?.user?.email || "";
    renderPlans();
    showOnly(els.paywallView);
    return;
  }

  showOnly(els.chatView);
  renderUsage();
  renderConversations();
  renderModelOptions();
  renderContextMeter();
  renderAgentModeToggle();
  renderWebSearchToggle();
  renderMessages();
  renderDocumentViewer();
  syncCompareContextBanner();
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
  els.googleButton.classList.toggle("hidden", !state.config?.auth?.googleEnabled);
}

function renderPlans() {
  els.paywallPlans.innerHTML = (state.plans || []).map((plan) => `
    <article class="plan-card">
      <h3>${escapeHtml(plan.name)}</h3>
      <div class="price">${escapeHtml(plan.priceLabel || "")}</div>
      <p>${escapeHtml(plan.description || "")}</p>
      <ul>
        <li>${Number(plan.dailyMessageLimit).toLocaleString()} messages/day</li>
        <li>${Number(plan.monthlyImageLimit).toLocaleString()} images/month</li>
        <li>${Number(plan.maxDocumentsPerMessage || 0).toLocaleString()} documents/message</li>
      </ul>
    </article>
  `).join("");
}

function renderUsage() {
  const plan = state.me?.plan;
  const usage = state.me?.usage || {};
  if (!plan) {
    els.usagePill.textContent = "";
    return;
  }
  els.usagePill.textContent = `${usage.message_count || 0}/${plan.dailyMessageLimit} today`;
}

function estimateContentTokens(content) {
  if (typeof content === "string") return Math.ceil(content.length / 4);
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (part?.type === "text") total += Math.ceil(String(part.text || "").length / 4);
    else if (part?.type === "image_url") total += 1200;
    else if (part?.type === "file") total += 2500;
  }
  return total;
}

function estimatePendingInputTokens() {
  let total = Math.ceil(String(els.promptInput?.value || "").length / 4);
  for (const item of state.images || []) {
    total += item.category === "image" ? 1200 : 2500;
  }
  return total;
}

function formatTokenCount(tokens) {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

function renderContextMeter() {
  if (!els.contextMeter) return;
  const used = Math.min(
    CONTEXT_LIMIT_TOKENS,
    Math.max(0, Math.round(
      (state.messages || []).reduce((sum, message) => sum + 8 + estimateContentTokens(message.content), 0)
      + estimatePendingInputTokens()
    ))
  );
  const percent = Math.min(100, Math.round((used / CONTEXT_LIMIT_TOKENS) * 100));
  els.contextMeterLabel.textContent = `${formatTokenCount(used)} / 256k`;
  els.contextMeterFill.style.width = `${percent}%`;
  els.contextMeter.classList.toggle("warn", percent >= 80);
}

function renderAccount() {
  const sub = state.me?.subscription;
  const plan = state.me?.plan;
  els.accountInfo.innerHTML = `
    <div class="account-label">${escapeHtml(state.me?.user?.email || "Signed in")}</div>
    <p class="account-detail">Plan: ${escapeHtml(plan?.name || "No active plan")}</p>
    <p class="account-detail">Access: ${escapeHtml(sub?.status || state.me?.access?.mode || "none")}</p>
    ${sub?.currentPeriodEnd ? `<p class="account-detail">Renews: ${escapeHtml(new Date(sub.currentPeriodEnd).toLocaleDateString())}</p>` : ""}
  `;
  els.adminSection.classList.toggle("hidden", state.me?.profile?.role !== "admin");
}

/* ─── Conversations ─── */

function renderConversations() {
  const sorted = state.conversations.slice().sort((a, b) => {
    const ta = a.updated_at || a.created_at || "";
    const tb = b.updated_at || b.created_at || "";
    return String(tb).localeCompare(String(ta));
  });

  els.conversationList.innerHTML = sorted.map((c) => {
    const active = c.id === state.activeConversationId ? "active" : "";
    return `
      <div class="conversation-row ${active}" data-chat-id="${escapeHtml(c.id)}">
        <button class="conversation-item" type="button" data-open-chat-id="${escapeHtml(c.id)}">
          <span>${escapeHtml(c.title || "New chat")}</span>
        </button>
        <button class="conversation-delete" type="button" data-delete-chat-id="${escapeHtml(c.id)}" aria-label="Delete ${escapeHtml(c.title || "chat")}" title="Delete chat">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>
        </button>
      </div>
    `;
  }).join("");
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
  if (id === OPENROUTER_VISION_MODEL) return "MiMo";
  if (id === OPENROUTER_PRO_MODEL) return "Pro";
  const model = modelById(id);
  return compactModelDisplayName(model?.name || model?.rawName || id) || id;
}

function selectedCompareModelIds() {
  const ids = state.settings.compareEnabled ? DEFAULT_COMPARE_MODELS : (Array.isArray(state.settings.compareModels) ? state.settings.compareModels : []);
  const unique = ids.filter((id, index) => id && ids.indexOf(id) === index);
  return unique.slice(0, 2);
}

function activeCompareModelIds() {
  const ids = selectedCompareModelIds();
  return state.settings.compareEnabled && ids.length >= 2 ? ids : [];
}

function seedCompareModelsForDropdown() {
  if (selectedCompareModelIds().length) return;
  const seeded = seedCompareModels();
  updateSetting("compareModels", seeded);
  updateSetting("compareEnabled", seeded.length >= 2);
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

function toggleCompareDropdown() {
  const isOpen = !els.compareDropdown.classList.contains("hidden");
  els.compareDropdown.classList.toggle("hidden", isOpen);
  const nowOpen = !els.compareDropdown.classList.contains("hidden");
  els.compareButton.setAttribute("aria-expanded", String(nowOpen));
  els.compareWrap.classList.toggle("is-open", nowOpen);
  if (!isOpen) {
    seedCompareModelsForDropdown();
    els.compareInput.value = "";
    renderCompareCatalog();
    renderCompareControls();
    els.compareInput.focus();
  }
}

function closeCompareDropdown() {
  els.compareDropdown.classList.add("hidden");
  els.compareButton.setAttribute("aria-expanded", "false");
  els.compareWrap.classList.remove("is-open");
}

function closeModelDropdown() {
  els.modelDropdown.classList.add("hidden");
  els.modelButton.setAttribute("aria-expanded", "false");
  els.composerModelWrap.classList.remove("is-open");
}

function toggleActionMenu() {
  const open = els.composerActionMenu.classList.toggle("hidden") === false;
  els.actionMenuButton.setAttribute("aria-expanded", String(open));
  els.composerActionMenuWrap.classList.toggle("is-open", open);
}

function closeActionMenu() {
  if (!els.composerActionMenu) return;
  els.composerActionMenu.classList.add("hidden");
  els.actionMenuButton?.setAttribute("aria-expanded", "false");
  els.composerActionMenuWrap?.classList.remove("is-open");
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
          <span class="model-option-name">Pro <span class="model-price-note">5x</span></span>
          <span class="model-option-desc">Use for the most complex tasks.</span>
        </span>
      </span>
      <span class="model-option-check">${mode === "pro" ? "✓" : ""}</span>
    </button>
  `;
}

function renderCompareModelOption(model, selected, disabled) {
  const logoUrl = modelBrandLogoUrl(model);
  return `
    <button class="model-option compare-option ${selected ? "active" : ""} ${disabled ? "disabled" : ""}" type="button" data-compare-model-id="${escapeHtml(model.id)}" aria-selected="${selected}" ${disabled ? "aria-disabled=\"true\"" : ""}>
      <span class="model-option-main">
        ${logoUrl
          ? `<img class="model-option-logo" src="${escapeHtml(logoUrl)}" alt="" width="24" height="24" decoding="async">`
          : `<span class="model-option-logo-placeholder"></span>`}
        <span class="model-option-name">${escapeHtml(compactModelDisplayName(model.name || model.id))}</span>
      </span>
      <span class="model-option-check">${selected ? "✓" : ""}</span>
    </button>
  `;
}

function renderCompareCatalog() {
  const query = els.compareInput.value.trim().toLowerCase();
  const selectedIds = selectedCompareModelIds();
  const visible = state.models
    .filter((m) => {
      const h = `${m.id} ${m.name || ""}`.toLowerCase();
      return !query || h.includes(query);
    })
    .slice(0, 80);

  if (!state.models.length) {
    els.compareCatalog.innerHTML = `<div class="model-empty">Loading models…</div>`;
    return;
  }

  if (!visible.length) {
    els.compareCatalog.innerHTML = `<div class="model-empty">No matches.</div>`;
    return;
  }

  els.compareCatalog.innerHTML = visible
    .map((m) => renderCompareModelOption(m, selectedIds.includes(m.id), selectedIds.length >= 4 && !selectedIds.includes(m.id)))
    .join("");
}

function renderCompareControls() {
  if (!els.compareWrap) return;
  els.compareWrap.classList.remove("hidden");
  closeCompareContextBanner();
  closeCompareDropdown();
  const active = Boolean(state.settings.compareEnabled);
  els.compareButton.classList.toggle("active", active);
  els.compareButton.classList.remove("council-active");
  els.compareButton.setAttribute("aria-pressed", String(active));
  els.compareButton.setAttribute("aria-expanded", "false");
  els.compareButton.setAttribute("title", active ? "Compare mode on" : "Compare DeepSeek and MiMo");
  els.compareLabel.textContent = active ? "Compare on" : "Compare";
  updateComposerPlaceholder();
}

function renderModelOptions() {
  const mode = selectedModelMode();
  const displayName = modelModeLabel(mode);
  if (els.modelDetails) {
    els.modelDetails.innerHTML = `<div class="model-empty">${mode === "pro" ? "For the most complex tasks." : "Best model for most tasks."}</div>`;
  }

  els.modelButton.setAttribute("aria-label", `Model: ${displayName}`);
  els.modelButton.classList.remove("has-brand-logo");
  els.modelButton.classList.toggle("pro-active", mode === "pro");
  els.modelLabel.classList.remove("hidden");
  els.modelPriceBadge?.classList.toggle("hidden", mode !== "pro");

  els.modelLabel.textContent = displayName;
  renderModelCatalog();
  renderCompareControls();
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
}

function isAssistantMessageStreaming(message) {
  if (!state.running || message?.error || message?.finishReason) return false;
  return Boolean(message?.id);
}

function resolveReasoningDurationMs(message) {
  const stored = message?.metadata?.reasoningDurationMs ?? message?.reasoningDurationMs;
  if (stored != null && Number.isFinite(Number(stored))) return Math.max(0, Number(stored));
  if (message?.reasoningStartedAt && message?.reasoningEndedAt) {
    return Math.max(0, message.reasoningEndedAt - message.reasoningStartedAt);
  }
  return null;
}

function markReasoningStarted(message) {
  if (!message.reasoningStartedAt) message.reasoningStartedAt = Date.now();
}

function markReasoningEnded(message) {
  if (message.reasoningStartedAt && !message.reasoningEndedAt) {
    message.reasoningEndedAt = Date.now();
  }
}

function reasoningSummaryLabel(message, { streaming = false } = {}) {
  const stillThinking = streaming && !message?.finishReason && !message?.reasoningEndedAt;
  if (stillThinking) return "Thinking";

  const ms = resolveReasoningDurationMs(message);
  if (ms != null) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return `Thought for ${seconds}s`;
  }
  return "Thought";
}

function renderReasoning(message, { streaming = false } = {}) {
  const text = String(message?.reasoning || "");
  const hasReasoning = text.trim().length > 0;
  if (!hasReasoning && !streaming) return "";

  const messageId = message?.id ? String(message.id) : "";
  const shouldOpen = messageId && reasoningOpenIds.has(messageId);
  const openAttr = shouldOpen ? " open" : "";
  const idAttr = messageId ? ` data-message-id="${escapeHtml(messageId)}"` : "";
  const stillThinking = streaming && !message?.finishReason && !message?.reasoningEndedAt;
  const streamingClass = stillThinking ? " is-streaming" : "";
  const doneClass = !stillThinking && (hasReasoning || message?.reasoningEndedAt) ? " is-done" : "";
  const body = hasReasoning ? renderContent(text) : "";
  const summary = reasoningSummaryLabel(message, { streaming });

  return `<details class="reasoning${streamingClass}${doneClass}"${openAttr}${idAttr}><summary>${escapeHtml(summary)}</summary><div>${body}</div></details>`;
}

function renderToolCalls() {
  return "";
}

function renderMessageError(message) {
  if (!message.error) return "";
  const retry = message.error === "Stopped by user." ? "" : renderMessageRetry(message);
  return `<div class="message-error"><span>${escapeHtml(message.error)}</span>${retry}</div>`;
}

function canRetryAssistant(message) {
  if (state.running) return false;
  if (message?.councilGroup || message?.compareGroup) return false;
  const id = message?.id ? String(message.id) : "";
  if (!id || id.startsWith("local_")) return false;
  if (message.error) return message.error !== "Stopped by user.";
  const hasFinal = String(message.content || "").trim()
    || (Array.isArray(message.toolCalls) && message.toolCalls.length)
    || artifactListFromMessage(message).length;
  return !message.stopped && !hasFinal;
}

function renderMessageRetry(message) {
  if (!canRetryAssistant(message)) return "";
  return `<button class="message-retry-btn" type="button" data-retry-assistant-id="${escapeHtml(String(message.id))}">Retry</button>`;
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
    const href = entry.url || "#";
    return `
      <a class="inline-source-row" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
        ${rowIcon ? `<img src="${escapeHtml(rowIcon)}" alt="" width="14" height="14" decoding="async">` : ""}
        <span class="inline-source-row-title">${escapeHtml(title)}</span>
        ${host ? `<span class="inline-source-row-host">${escapeHtml(host)}</span>` : ""}
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
  const cleaned = stripLeakedCitationHtml(text);
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
    const href = entry.url || "#";
    return `
      <a class="sources-row" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
        ${icon ? `<img class="sources-row-icon" src="${escapeHtml(icon)}" alt="" width="16" height="16" decoding="async">` : `<span class="sources-row-fallback" aria-hidden="true"></span>`}
        <span class="sources-row-text">
          <span class="sources-row-title">${escapeHtml(title)}</span>
          ${host ? `<span class="sources-row-host">${escapeHtml(host)}</span>` : ""}
        </span>
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

const pendingArtifactPolls = new Map();
const PENDING_ARTIFACT_POLL_INTERVAL_MS = 2000;
const PENDING_ARTIFACT_POLL_MAX_ATTEMPTS = 60;
const VIEWER_WIDTH_KEY = "klui.documentViewer.width.v1";
let documentViewerPoll = null;
let pdfJsPromise = null;
let pdfRenderToken = 0;

function findPendingArtifacts() {
  const out = [];
  for (const message of state.messages || []) {
    const artifacts = artifactListFromMessage(message);
    for (const artifact of artifacts) {
      if (artifact?.pending && artifact?.job_id) {
        const failed = ["failed", "expired"].includes(String(artifact.status || "").toLowerCase());
        if (failed) continue;
        out.push({ messageId: message.id, jobId: artifact.job_id });
      }
    }
  }
  return out;
}

function applyJobStatusToPendingArtifact(jobId, payload) {
  if (!payload || !payload.job) return false;
  const job = payload.job;
  const messages = state.messages || [];
  let mutated = false;

  if (job.status === "succeeded" && payload.artifact) {
    for (const message of messages) {
      if (replacePendingArtifact(message, jobId, payload.artifact)) mutated = true;
    }
  } else if (job.status === "failed" || job.status === "expired") {
    for (const message of messages) {
      const lists = [];
      if (Array.isArray(message.artifacts)) lists.push(message.artifacts);
      const metaArtifacts = message.metadata?.documents?.artifacts;
      if (Array.isArray(metaArtifacts)) lists.push(metaArtifacts);
      for (const list of lists) {
        for (const entry of list) {
          if (entry?.pending && entry?.job_id === jobId) {
            entry.status = job.status;
            mutated = true;
          }
        }
      }
    }
  }
  return mutated;
}

async function pollPendingArtifact(jobId) {
  if (!jobId || !state.session?.access_token) return;
  let attempts = 0;
  const tick = async () => {
    if (!pendingArtifactPolls.has(jobId)) return;
    attempts += 1;
    let payload;
    try {
      payload = await fetchDocumentJobStatus(state.session, jobId);
    } catch {
      payload = null;
    }
    if (!pendingArtifactPolls.has(jobId)) return;

    if (payload?.job) {
      const mutated = applyJobStatusToPendingArtifact(jobId, payload);
      if (mutated) queueRenderMessages();
      const finished = ["succeeded", "failed", "expired"].includes(payload.job.status);
      if (finished) {
        pendingArtifactPolls.delete(jobId);
        return;
      }
    }
    if (attempts >= PENDING_ARTIFACT_POLL_MAX_ATTEMPTS) {
      pendingArtifactPolls.delete(jobId);
      return;
    }
    const handle = setTimeout(tick, PENDING_ARTIFACT_POLL_INTERVAL_MS);
    pendingArtifactPolls.set(jobId, handle);
  };
  const initial = setTimeout(tick, PENDING_ARTIFACT_POLL_INTERVAL_MS);
  pendingArtifactPolls.set(jobId, initial);
}

function syncPendingArtifactPolls() {
  const live = new Set();
  for (const { jobId } of findPendingArtifacts()) live.add(jobId);
  for (const jobId of Array.from(pendingArtifactPolls.keys())) {
    if (!live.has(jobId)) {
      const handle = pendingArtifactPolls.get(jobId);
      if (handle) clearTimeout(handle);
      pendingArtifactPolls.delete(jobId);
    }
  }
  for (const jobId of live) {
    if (!pendingArtifactPolls.has(jobId)) pollPendingArtifact(jobId);
  }
}

function artifactAttachmentId(artifact) {
  return String(artifact?.attachment_id || artifact?.id || "").trim();
}

function artifactCanView(artifact) {
  const format = artifactFormat(artifact).toLowerCase();
  return Boolean(artifactAttachmentId(artifact) && ["pdf", "docx", "xlsx"].includes(format));
}

function attachmentDownloadHref(attachmentId) {
  return `/api/attachments/${encodeURIComponent(attachmentId)}/download`;
}

function stopDocumentViewerPoll() {
  if (documentViewerPoll) clearTimeout(documentViewerPoll);
  documentViewerPoll = null;
}

function setDocumentViewerState(patch = {}) {
  state.viewer = { ...state.viewer, ...patch };
  renderDocumentViewer();
}

function viewerMetaLabel() {
  const format = String(state.viewer.sourceKind || state.viewer.kind || "").toUpperCase();
  if (state.viewer.loading && state.viewer.jobId) return `${format || "DOCUMENT"} preview is being prepared`;
  if (state.viewer.loading) return "Loading preview";
  if (state.viewer.error) return "Preview unavailable";
  return format ? `${format} preview` : "Preview";
}

function renderDocumentViewer() {
  if (!els.documentViewer) return;
  const viewer = state.viewer;
  document.body.classList.toggle("document-viewer-open", Boolean(viewer.open));
  els.documentViewer.classList.toggle("hidden", !viewer.open);
  els.documentViewerTitle.textContent = viewer.fileName || "Document";
  els.documentViewerMeta.textContent = viewerMetaLabel();

  const downloadAttachmentId = viewer.downloadAttachmentId || viewer.attachmentId;
  const downloadHref = downloadAttachmentId ? attachmentDownloadHref(downloadAttachmentId) : "";
  els.documentViewerDownload.classList.toggle("hidden", !downloadHref);
  if (downloadHref) {
    els.documentViewerDownload.href = downloadHref;
    els.documentViewerDownload.dataset.fileName = viewer.fileName || "download";
    els.documentViewerDownload.setAttribute("download", viewer.fileName || "download");
  } else {
    els.documentViewerDownload.removeAttribute("href");
    els.documentViewerDownload.removeAttribute("download");
  }

  if (!viewer.open) {
    delete els.documentViewerBody.dataset.pdfUrl;
    els.documentViewerBody.innerHTML = `<div class="document-viewer-empty">Select a generated document to preview.</div>`;
    return;
  }
  if (viewer.error) {
    delete els.documentViewerBody.dataset.pdfUrl;
    els.documentViewerBody.innerHTML = `<div class="document-viewer-empty">${escapeHtml(viewer.error)}</div>`;
    return;
  }
  if (viewer.loading) {
    delete els.documentViewerBody.dataset.pdfUrl;
    const label = viewer.jobId ? "Preparing preview…" : "Loading preview…";
    els.documentViewerBody.innerHTML = `<div class="document-viewer-empty"><span class="artifact-spinner" aria-hidden="true"></span>${label}</div>`;
    return;
  }
  if (viewer.url) {
    renderCleanPdfViewer(viewer.url);
    return;
  }
  els.documentViewerBody.innerHTML = `<div class="document-viewer-empty">Preview is not available for this document.</div>`;
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.worker.mjs";
      return pdfjs;
    });
  }
  return pdfJsPromise;
}

function pdfPlaceholderHeight(width) {
  return Math.max(420, Math.round(width * 1.294));
}

function renderCleanPdfViewer(url) {
  if (els.documentViewerBody.dataset.pdfUrl === url) return;
  const token = ++pdfRenderToken;
  els.documentViewerBody.dataset.pdfUrl = url;
  els.documentViewerBody.innerHTML = `
    <div class="pdf-pages" data-pdf-pages>
      <div class="document-viewer-empty"><span class="artifact-spinner" aria-hidden="true"></span>Loading pages…</div>
    </div>
  `;
  loadPdfJs()
    .then((pdfjs) => renderPdfPages(pdfjs, url, token))
    .catch(() => {
      if (token !== pdfRenderToken) return;
      els.documentViewerBody.innerHTML = `<div class="document-viewer-empty">Could not load the clean preview.</div>`;
    });
}

async function renderPdfPages(pdfjs, url, token) {
  const container = els.documentViewerBody.querySelector("[data-pdf-pages]");
  if (!container || token !== pdfRenderToken) return;

  let pdf;
  try {
    pdf = await pdfjs.getDocument({ url }).promise;
  } catch {
    if (token !== pdfRenderToken) return;
    els.documentViewerBody.innerHTML = `<div class="document-viewer-empty">Could not open this PDF preview.</div>`;
    return;
  }
  if (token !== pdfRenderToken) return;

  const bodyWidth = Math.max(320, els.documentViewerBody.clientWidth - 28);
  container.innerHTML = "";
  const placeholders = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const pageEl = document.createElement("div");
    pageEl.className = "pdf-page";
    pageEl.dataset.page = String(pageNumber);
    pageEl.style.minHeight = `${pdfPlaceholderHeight(bodyWidth)}px`;
    pageEl.innerHTML = `<div class="pdf-page-placeholder"><span class="artifact-spinner" aria-hidden="true"></span></div>`;
    container.appendChild(pageEl);
    placeholders.push(pageEl);
  }

  const renderPage = async (pageEl) => {
    if (pageEl.dataset.rendered || token !== pdfRenderToken) return;
    pageEl.dataset.rendered = "1";
    const pageNumber = Number(pageEl.dataset.page);
    const page = await pdf.getPage(pageNumber);
    if (token !== pdfRenderToken) return;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.8, Math.max(0.6, bodyWidth / base.width));
    const viewport = page.getViewport({ scale });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    canvas.setAttribute("aria-label", `Page ${pageNumber}`);
    const context = canvas.getContext("2d", { alpha: false });
    await page.render({
      canvasContext: context,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
    }).promise;
    if (token !== pdfRenderToken) return;
    pageEl.style.minHeight = "";
    pageEl.replaceChildren(canvas);
  };

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        renderPage(entry.target).catch(() => {
          entry.target.innerHTML = `<div class="pdf-page-placeholder">Page failed to render.</div>`;
        });
      }
    }, { root: els.documentViewerBody, rootMargin: "900px 0px" });
    placeholders.forEach((pageEl) => observer.observe(pageEl));
  } else {
    for (const pageEl of placeholders.slice(0, 3)) {
      renderPage(pageEl).catch(() => {
        pageEl.innerHTML = `<div class="pdf-page-placeholder">Page failed to render.</div>`;
      });
    }
  }
}

async function pollDocumentPreviewJob(jobId) {
  stopDocumentViewerPoll();
  let attempts = 0;
  const tick = async () => {
    if (!state.viewer.open || state.viewer.jobId !== jobId) return;
    attempts += 1;
    try {
      const payload = await fetchDocumentJobStatus(state.session, jobId);
      if (!state.viewer.open || state.viewer.jobId !== jobId) return;
      if (payload?.job?.status === "succeeded" && payload.artifact?.attachment_id) {
        await loadDocumentViewerUrl(payload.artifact.attachment_id, {
          downloadAttachmentId: state.viewer.downloadAttachmentId || state.viewer.attachmentId,
          fileName: state.viewer.fileName || payload.artifact.file_name,
          sourceKind: state.viewer.sourceKind
        });
        return;
      }
      if (["failed", "expired"].includes(payload?.job?.status)) {
        setDocumentViewerState({ loading: false, error: "The preview could not be generated." });
        return;
      }
    } catch (err) {
      if (attempts >= 2) setDocumentViewerState({ loading: false, error: err.message || "Preview failed." });
      return;
    }
    if (attempts >= 60) {
      setDocumentViewerState({ loading: false, error: "Preview generation timed out." });
      return;
    }
    documentViewerPoll = setTimeout(tick, 1500);
  };
  documentViewerPoll = setTimeout(tick, 1200);
}

async function loadDocumentViewerUrl(attachmentId, { downloadAttachmentId = "", fileName = "", sourceKind = "" } = {}) {
  if (!state.session?.access_token) {
    setDocumentViewerState({ loading: false, error: "Sign in to view files." });
    return;
  }
  const payload = await fetchAttachmentView(state.session, attachmentId);
  if (payload.status === "processing" && payload.jobId) {
    setDocumentViewerState({
      open: true,
      attachmentId,
      downloadAttachmentId: downloadAttachmentId || state.viewer.downloadAttachmentId || attachmentId,
      jobId: payload.jobId,
      fileName: fileName || payload.fileName || "Document",
      kind: payload.kind || "pdf",
      sourceKind: payload.sourceKind || sourceKind,
      url: "",
      loading: true,
      error: ""
    });
    pollDocumentPreviewJob(payload.jobId);
    return;
  }
  if (!payload.url) throw new Error("Preview URL was not returned.");
  stopDocumentViewerPoll();
  setDocumentViewerState({
    open: true,
    attachmentId,
    downloadAttachmentId: downloadAttachmentId || state.viewer.downloadAttachmentId || attachmentId,
    jobId: "",
    fileName: payload.fileName || fileName || "Document",
    kind: payload.kind || "pdf",
    sourceKind: sourceKind || payload.sourceKind || payload.kind || "pdf",
    url: payload.url,
    loading: false,
    error: ""
  });
}

async function openDocumentViewer({ attachmentId, fileName = "", format = "" }) {
  stopDocumentViewerPoll();
  setDocumentViewerState({
    open: true,
    attachmentId,
    downloadAttachmentId: attachmentId,
    jobId: "",
    fileName: fileName || "Document",
    kind: "pdf",
    sourceKind: format.toLowerCase(),
    url: "",
    loading: true,
    error: ""
  });
  try {
    await loadDocumentViewerUrl(attachmentId, { fileName, sourceKind: format.toLowerCase() });
  } catch (err) {
    setDocumentViewerState({ loading: false, error: err.message || "Preview failed." });
  }
}

function closeDocumentViewer() {
  stopDocumentViewerPoll();
  pdfRenderToken += 1;
  if (els.documentViewerBody) delete els.documentViewerBody.dataset.pdfUrl;
  setDocumentViewerState({
    open: false,
    attachmentId: "",
    downloadAttachmentId: "",
    jobId: "",
    fileName: "",
    kind: "",
    sourceKind: "",
    url: "",
    loading: false,
    error: ""
  });
}

function setDocumentViewerWidth(width) {
  const min = 360;
  const max = Math.max(min, Math.min(window.innerWidth - 460, Math.floor(window.innerWidth * 0.72)));
  const next = Math.max(min, Math.min(max, Math.round(width)));
  document.documentElement.style.setProperty("--document-viewer-w", `${next}px`);
  try {
    localStorage.setItem(VIEWER_WIDTH_KEY, String(next));
  } catch {
    /* Ignore storage failures. */
  }
}

function initDocumentViewerWidth() {
  let saved = 0;
  try {
    saved = Number(localStorage.getItem(VIEWER_WIDTH_KEY) || 0);
  } catch {
    saved = 0;
  }
  setDocumentViewerWidth(saved || Math.round(window.innerWidth * 0.45));
}

function beginDocumentViewerResize(event) {
  if (!state.viewer.open || window.matchMedia("(max-width: 900px)").matches) return;
  event.preventDefault();
  document.body.classList.add("document-viewer-resizing");
  const move = (moveEvent) => {
    setDocumentViewerWidth(window.innerWidth - moveEvent.clientX);
  };
  const stop = () => {
    document.body.classList.remove("document-viewer-resizing");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
  window.addEventListener("pointercancel", stop, { once: true });
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
  return `<div class="message-error"><span>No final response was saved.</span>${renderMessageRetry(message)}</div>`;
}

function rawTextContent(content) {
  if (Array.isArray(content)) return content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  return String(content || "");
}

function messageCopyButton(msg) {
  const text = rawTextContent(msg.content);
  if (!text.trim()) return "";
  return `<button class="msg-copy-btn" type="button" data-copy-msg aria-label="Copy message" title="Copy message"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span></button>`;
}

function renderStandardMessage(raw) {
  const msg = normalizeMessage(raw);
  const role = msg.role === "user" ? "user" : "assistant";
  const content = typeof msg.content === "string" ? msg.content : msg.content;
  const streaming = role === "assistant" && isAssistantMessageStreaming(msg);
  const body = role === "assistant"
    ? renderAssistantContent(content, msg)
    : renderContent(content || "");
  const rawText = rawTextContent(msg.content);

  return `
    <article class="message ${role}" data-raw-text="${escapeHtml(rawText)}">
      <div class="message-avatar">${role === "user" ? "You" : "K"}</div>
      <div class="message-body">
        <div class="message-meta"><strong>${role === "user" ? "You" : "Klui"}</strong>${messageCopyButton(msg)}</div>
        <div class="message-content">${role === "assistant" ? renderReasoning(msg, { streaming }) : ""}${body}${role === "assistant" ? renderArtifacts(msg) : ""}${role === "assistant" ? renderCitations(msg) : ""}${renderMessageError(msg)}${renderMessageNote(msg)}${renderMissingFinal(msg, role)}</div>
      </div>
    </article>
  `;
}

function renderCompareResponse(raw, index) {
  const msg = normalizeMessage(raw);
  const modelId = msg.model || selectedCompareModelIds()[index] || "";
  const model = modelById(modelId);
  const logoUrl = model ? modelBrandLogoUrl(model) : "";
  const content = msg.content || "";
  const streaming = isAssistantMessageStreaming(msg);
  const rawText = rawTextContent(msg.content);

  return `
    <section class="compare-response" data-raw-text="${escapeHtml(rawText)}">
      <header class="compare-response-head">
        <span class="compare-model-mark">
          ${logoUrl
            ? `<img src="${escapeHtml(logoUrl)}" alt="" width="18" height="18" decoding="async">`
            : `<span>${escapeHtml(String(index + 1))}</span>`}
        </span>
        <strong>${escapeHtml(modelDisplayName(modelId) || `Model ${index + 1}`)}</strong>
        ${rawText.trim() ? `<button class="msg-copy-btn compare-copy-btn" type="button" data-copy-msg aria-label="Copy response" title="Copy response"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span></button>` : ""}
      </header>
      <div class="compare-response-body message-content">
        ${renderReasoning(msg, { streaming })}
        ${renderAssistantContent(content, msg)}
        ${renderArtifacts(msg)}
        ${renderCitations(msg)}
        ${renderMessageError(msg)}
        ${renderMessageNote(msg)}
        ${renderMissingFinal(msg, "assistant")}
      </div>
    </section>
  `;
}

function renderCompareMessage(messages) {
  return `
    <article class="message assistant compare-message">
      <div class="message-avatar">K</div>
      <div class="message-body">
        <div class="message-meta"><strong>Klui Compare</strong><span>${messages.length} models</span></div>
        <div class="compare-grid">
          ${messages.map((message, index) => renderCompareResponse(message, index)).join("")}
        </div>
      </div>
    </article>
  `;
}

function renderCouncilStages(council) {
  const stages = [
    { key: "stage1", label: "Panel", status: council.stage1Status || "active" },
    { key: "stage2", label: "Peer review", status: council.stage2Status || "pending" },
    { key: "stage3", label: "Chairman", status: council.stage3Status || "pending" }
  ];
  return `<div class="council-stages">${stages.map((stage, index) => `
    <span class="council-stage ${stage.status}">
      <span class="council-stage-dot"></span>
      <span>${escapeHtml(stage.label)}</span>
    </span>${index < stages.length - 1 ? '<span class="council-stage-sep"></span>' : ""}
  `).join("")}</div>`;
}

function renderCouncilPanelist(panelist, index, totalRanked, peerReviewActive = false) {
  const msg = normalizeMessage(panelist);
  const modelId = msg.model || "";
  const model = modelById(modelId);
  const logoUrl = model ? modelBrandLogoUrl(model) : "";
  const content = msg.content || "";
  const streaming = isAssistantMessageStreaming(msg);
  const rawText = rawTextContent(msg.content);
  const rank = msg.metadata?.council?.peerRank;
  const ballotCount = Number(msg.metadata?.council?.ballotCount || 0);
  const justifications = msg.metadata?.council?.peerJustifications || {};
  const showRank = rank != null && totalRanked > 0 && ballotCount > 0;
  const rankBadge = showRank
    ? `<span class="council-rank-badge rank-${rank}">#${rank}${rank === 1 ? " · Top" : ""}</span>`
    : (peerReviewActive && msg.finishReason && !msg.error ? `<span class="council-rank-pending">Ranking…</span>` : "");
  const justKeys = Object.keys(justifications);
  const justBlock = justKeys.length ? `
    <div class="council-justifications">
      <div class="council-justifications-title">Peer notes</div>
      ${justKeys.map((reviewerId) => {
        const reviewer = modelDisplayName(reviewerId) || reviewerId;
        return `<div class="council-justification"><strong>${escapeHtml(reviewer)}:</strong> ${escapeHtml(justifications[reviewerId] || "")}</div>`;
      }).join("")}
    </div>` : "";

  return `
    <section class="council-panelist ${showRank && rank === 1 ? "rank-1" : ""}" data-raw-text="${escapeHtml(rawText)}">
      <header class="council-panelist-head">
        <span class="compare-model-mark">
          ${logoUrl
            ? `<img src="${escapeHtml(logoUrl)}" alt="" width="18" height="18" decoding="async">`
            : `<span>${escapeHtml(String(index + 1))}</span>`}
        </span>
        <strong>${escapeHtml(modelDisplayName(modelId) || `Model ${index + 1}`)}</strong>
        ${rankBadge}
        ${rawText.trim() ? `<button class="msg-copy-btn compare-copy-btn" type="button" data-copy-msg aria-label="Copy response" title="Copy response"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span></button>` : ""}
      </header>
      <div class="council-panelist-body message-content">
        ${renderReasoning(msg, { streaming })}
        ${renderAssistantContent(content, msg)}
        ${renderArtifacts(msg)}
        ${renderCitations(msg)}
        ${renderMessageError(msg)}
        ${renderMessageNote(msg)}
        ${renderMissingFinal(msg, "assistant")}
      </div>
      ${justBlock}
    </section>
  `;
}

function renderCouncilSynthesis(chairman) {
  if (!chairman) {
    return `<div class="council-synthesis">
      <div class="council-synthesis-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z"/></svg>
        <span>Council Synthesis</span>
      </div>
      <div class="council-synthesis-pending">Waiting for the chairman to synthesize the final answer…</div>
    </div>`;
  }

  const msg = normalizeMessage(chairman);
  const modelId = msg.model || "";
  const content = msg.content || "";
  const streaming = isAssistantMessageStreaming(msg);
  const rawText = rawTextContent(msg.content);
  const modelName = modelDisplayName(modelId) || modelId;

  return `
    <div class="council-synthesis" data-raw-text="${escapeHtml(rawText)}">
      <div class="council-synthesis-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z"/></svg>
        <span>Council Synthesis</span>
        <span class="council-synthesis-model">by ${escapeHtml(modelName)}</span>
        ${rawText.trim() ? `<button class="msg-copy-btn compare-copy-btn" type="button" data-copy-msg aria-label="Copy synthesis" title="Copy synthesis" style="color: white; opacity: 0.85;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span></button>` : ""}
      </div>
      <div class="council-synthesis-body message-content">
        ${renderReasoning(msg, { streaming })}
        ${renderAssistantContent(content, msg)}
        ${renderArtifacts(msg)}
        ${renderCitations(msg)}
        ${renderMessageError(msg)}
        ${renderMessageNote(msg)}
      </div>
    </div>
  `;
}

function renderCouncilMessage(council) {
  const panelists = council.panelists || [];
  const chairman = council.chairman || null;
  const hasAnyRank = panelists.some((p) => p.metadata?.council?.peerRank != null && Number(p.metadata?.council?.ballotCount || 0) > 0);
  const peerReviewActive = council.stage2Status === "active";
  const peerStatusText = council.peerStatus || "";

  return `
    <article class="message assistant council-message">
      <div class="council-shell">
        <header class="council-header">
          <span class="council-header-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 21h7l-1-5a3 3 0 00-3-3H4a3 3 0 00-3 3l-1 5h2"/><circle cx="5" cy="7" r="3"/><path d="M15 21h7l-1-5a3 3 0 00-3-3h-1a3 3 0 00-3 3l-1 5h2"/><circle cx="18" cy="7" r="3"/><circle cx="12" cy="3.5" r="2"/></svg>
          </span>
          <span class="council-header-title">Model Council</span>
          <span class="council-header-sub">${panelists.length} panelists${chairman ? " · 1 chairman" : ""}</span>
        </header>
        ${renderCouncilStages(council)}
        ${peerStatusText ? `<div class="council-peer-status">${escapeHtml(peerStatusText)}</div>` : ""}
        <div class="council-section-label">Panel responses</div>
        <div class="council-panel-grid">
          ${panelists.map((p, idx) => renderCouncilPanelist(p, idx, hasAnyRank ? panelists.length : 0, peerReviewActive)).join("")}
        </div>
        ${renderCouncilSynthesis(chairman)}
      </div>
    </article>
  `;
}

function renderMessages() {
  if (!state.messages.length) {
    els.messages.innerHTML = `<div class="empty-state"><div><h1>${getGreeting()}</h1></div></div>`;
    return;
  }

  captureReasoningOpenState();

  els.messages.innerHTML = messageViews(state.messages)
    .map((view) => {
      if (view.type === "council") return renderCouncilMessage(view.council);
      if (view.type === "compare") return renderCompareMessage(view.messages);
      return renderStandardMessage(view.message);
    })
    .join("");

  if (state.autoScroll) {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  syncPendingArtifactPolls();
  renderContextMeter();
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
  els.imagePreviews.innerHTML = state.images.map((img, i) => `
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

function updatePendingDocument(localId, patch) {
  const item = state.images.find((entry) => entry.localId === localId);
  if (!item) return null;
  Object.assign(item, patch);
  renderImages();
  return item;
}

async function pollUploadedDocument(localId, attachmentId) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const payload = await fetchDocumentStatus(state.session, attachmentId);
    const doc = payload.document || {};
    if (!state.images.some((entry) => entry.localId === localId)) return;
    updatePendingDocument(localId, {
      status: doc.status === "ready" ? "ready" : "processing",
      progress: doc.status === "ready" ? 100 : Math.max(8, Number(doc.progress || 15)),
      documentId: doc.id || "",
      error: doc.error?.message || ""
    });
    if (doc.status === "ready") return;
    if (doc.status === "failed") {
      throw new Error(doc.error?.message || "Document could not be processed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error("Document is still processing. Try again in a moment.");
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
  }
}

function addImages(files) {
  const plan = state.me?.plan || {};
  const accepted = [...files].filter(isSupportedPendingFile);
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
  if (accepted.length > chosen.length) showToast(`Attach up to ${maxImages} images and ${maxDocs} documents.`);
  if ([...files].length && !accepted.length) showToast("Upload images, PDFs, Word, Excel, CSV, or TSV files.");

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
  syncCompareContextBanner();
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

function openAccount() {
  renderAccount();
  els.accountDrawer.classList.add("open");
  els.accountDrawer.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "account";
}

function closeAccount() {
  els.accountDrawer.classList.remove("open");
  els.accountDrawer.setAttribute("aria-hidden", "true");
  if (els.overlay.dataset.mode === "account") {
    els.overlay.hidden = true;
    delete els.overlay.dataset.mode;
  }
}

function openConfirmDialog(conversation) {
  state.pendingDeleteId = conversation.id;
  els.confirmTitle.textContent = "Delete chat?";
  els.confirmBody.textContent = `Delete "${conversation.title || "New chat"}" from your account?`;
  els.confirmDialog.classList.add("open");
  els.confirmDialog.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.overlay.dataset.mode = "confirm";
  els.confirmDeleteButton.focus();
}

function closeConfirmDialog() {
  state.pendingDeleteId = "";
  els.confirmDialog.classList.remove("open");
  els.confirmDialog.setAttribute("aria-hidden", "true");
  if (els.overlay.dataset.mode === "confirm") {
    els.overlay.hidden = true;
    delete els.overlay.dataset.mode;
  }
}

function closeAllDrawers() {
  closeSettings();
  closeAccount();
  closeConfirmDialog();
}

function syncSettingsInputs() {
  els.temperatureInput.value = state.settings.temperature;
  els.topPInput.value = state.settings.top_p;
  els.maxTokensInput.value = state.settings.max_tokens;
  els.seedInput.value = state.settings.seed;
  els.systemPromptInput.value = state.settings.systemPrompt;
}

function setRunning(running) {
  state.running = running;
  els.sendButton.classList.toggle("hidden", running);
  els.stopButton.classList.toggle("hidden", !running);
  els.sendButton.disabled = running || pendingDocumentUploads().length > 0;
  els.promptInput.disabled = running;
  els.imageToggle.disabled = running;
  els.modelButton.disabled = running;
  els.compareButton.disabled = running;
}

function updateSendButton() {
  const hasContent = els.promptInput.value.trim() || state.images.length;
  const blocked = pendingDocumentUploads().length > 0;
  els.sendButton.classList.toggle("active", Boolean(hasContent) && !blocked);
  els.sendButton.disabled = state.running || blocked;
}

function applyComposerHeight() {
  els.promptInput.style.height = "auto";
  els.promptInput.style.height = `${Math.min(200, els.promptInput.scrollHeight)}px`;
}

/* ─── Stream event handling ─── */

function ensureToolState(message) {
  if (!message.toolEvents) message.toolEvents = [];
  if (!message.citations) message.citations = [];
}

function applyToolEvent(message, event) {
  ensureToolState(message);
  if (event.type === "tool:start") {
    let parsedArgs = {};
    try { parsedArgs = JSON.parse(event.arguments || "{}"); } catch {}
    message.toolEvents.push({
      id: event.toolCallId,
      name: event.name,
      query: parsedArgs.query || parsedArgs.url || "",
      status: "running"
    });
    return;
  }
  if (event.type === "tool:result") {
    const entry = message.toolEvents.find((row) => row.id === event.toolCallId);
    if (entry) {
      entry.status = "done";
      entry.cached = Boolean(event.cached);
      entry.provider = event.provider || "";
      entry.resultCount = (event.citations || []).length;
    }
    const offset = message.citations.length;
    for (const citation of event.citations || []) {
      message.citations.push({ ...citation, index: offset + citation.index });
    }
    mergeArtifacts(message, event.artifacts || []);
    return;
  }
  if (event.type === "tool:error") {
    const entry = message.toolEvents.find((row) => row.id === event.toolCallId);
    if (entry) {
      entry.status = "error";
      entry.error = event.error?.message || "Tool failed.";
    } else {
      message.toolEvents.push({ id: event.toolCallId, name: event.name, status: "error", error: event.error?.message || "Tool failed." });
    }
    return;
  }
  if (event.type === "tool:limit") {
    message.toolEvents.push({ id: `limit_${Date.now()}`, name: "limit", status: "limit", limit: event.limit });
  }
}

function applyStreamEvent(message, event) {
  if (event?.type === "error") {
    message.error = event.error || "Model request failed.";
    message.finishReason = "error";
    markReasoningEnded(message);
    return;
  }

  if (event?.type === "done") {
    message.finishReason ||= "stop";
    markReasoningEnded(message);
    return;
  }

  if (typeof event?.type === "string" && event.type.startsWith("tool:")) {
    applyToolEvent(message, event);
    return;
  }

  const choice = event?.choices?.[0];
  const delta = choice?.delta || {};

  const reasoningDelta = extractReasoningDelta(delta);
  if (reasoningDelta) {
    markReasoningStarted(message);
    message.reasoning += reasoningDelta;
  }
  if (typeof delta.content === "string" && delta.content) {
    markReasoningEnded(message);
    message.content += delta.content;
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const callDelta of delta.tool_calls) {
      const index = Number.isInteger(callDelta.index) ? callDelta.index : message.toolCalls.length;
      const existing = message.toolCalls[index] || { id: "", type: "function", function: { name: "", arguments: "" } };
      existing.id = callDelta.id || existing.id;
      existing.type = callDelta.type || existing.type;
      existing.function.name = callDelta.function?.name || existing.function.name;
      existing.function.arguments += callDelta.function?.arguments || "";
      message.toolCalls[index] = existing;
    }
  }

  if (choice?.finish_reason) {
    message.finishReason = choice.finish_reason;
    markReasoningEnded(message);
  }
}

function applyCompareStreamEvent(compareMessage, event) {
  const index = Number(event?.index);
  if (!Number.isInteger(index) || !compareMessage.compareResponses?.[index]) return;
  const target = compareMessage.compareResponses[index];

  if (event.type === "start") {
    target.id = event.assistantMessageId || target.id;
    return;
  }

  if (event.type === "delta") {
    applyStreamEvent(target, event.event);
    return;
  }

  if (event.type === "error") {
    target.error = event.error || "Model request failed.";
    target.finishReason = "error";
    return;
  }

  if (event.type === "done") {
    target.finishReason ||= "stop";
  }
}

function applyCouncilStreamEvent(council, event) {
  const type = event?.type;

  if (type === "council:start") {
    council.sessionId = event.sessionId || council.sessionId;
    return;
  }

  /* Stage 1 events reuse compare-style envelope */
  if (type === "start" || type === "delta" || type === "done" || type === "error") {
    const index = Number(event.index);
    const target = council.panelists?.[index];
    if (!target) return;
    if (type === "start") {
      target.id = event.assistantMessageId || target.id;
      if (!target.metadata) target.metadata = { council: { sessionId: council.sessionId, role: "panelist", stage: 1 } };
    } else if (type === "delta") {
      applyStreamEvent(target, event.event);
    } else if (type === "error") {
      target.error = event.error || "Model request failed.";
      target.finishReason = "error";
    } else if (type === "done") {
      target.finishReason ||= "stop";
    }
    return;
  }

  if (type === "council:peer:start") {
    council.stage1Status = "done";
    council.stage2Status = "active";
    council.peerStatus = "Peers are evaluating each response…";
    return;
  }

  if (type === "council:peer:ballot") {
    if (!council.ballots) council.ballots = [];
    council.ballots.push({
      reviewer: event.reviewerModel,
      valid: event.valid,
      ranking: event.ranking || [],
      justifications: event.justifications || {},
      error: event.error || null
    });
    /* Stream justifications onto panelist metadata so UI updates progressively */
    for (const [modelId, reason] of Object.entries(event.justifications || {})) {
      const target = council.panelists.find((p) => p.model === modelId);
      if (!target) continue;
      if (!target.metadata) target.metadata = { council: {} };
      if (!target.metadata.council) target.metadata.council = {};
      if (!target.metadata.council.peerJustifications) target.metadata.council.peerJustifications = {};
      target.metadata.council.peerJustifications[event.reviewerModel] = reason;
    }
    return;
  }

  if (type === "council:peer:done") {
    council.stage2Status = "done";
    council.peerStatus = "";
    for (const row of event.borda || []) {
      const target = council.panelists.find((p) => p.model === row.modelId);
      if (!target) continue;
      if (!target.metadata) target.metadata = { council: {} };
      if (!target.metadata.council) target.metadata.council = {};
      target.metadata.council.peerRank = row.rank;
      target.metadata.council.bordaScore = row.bordaScore;
      target.metadata.council.ballotCount = row.ballotCount;
    }
    return;
  }

  if (type === "council:peer:error") {
    council.stage2Status = "error";
    council.peerStatus = `Peer review failed: ${event.error || "Unknown error."}`;
    for (const panelist of council.panelists || []) {
      if (!panelist.metadata) panelist.metadata = { council: {} };
      if (!panelist.metadata.council) panelist.metadata.council = {};
      panelist.metadata.council.peerReviewStatus = "error";
      panelist.metadata.council.peerReviewReason = event.error || "Peer review failed.";
    }
    return;
  }

  if (type === "council:peer:skipped") {
    council.stage2Status = "done";
    council.peerStatus = event.reason || "Peer review skipped.";
    for (const panelist of council.panelists || []) {
      if (!panelist.metadata) panelist.metadata = { council: {} };
      if (!panelist.metadata.council) panelist.metadata.council = {};
      panelist.metadata.council.peerReviewStatus = "skipped";
      panelist.metadata.council.peerReviewReason = event.reason || "Peer review skipped.";
    }
    return;
  }

  if (type === "council:chairman:start") {
    council.stage3Status = "active";
    if (!council.chairman) {
      council.chairman = {
        id: event.assistantMessageId || `local_chair_${Date.now()}`,
        role: "assistant",
        model: event.chairmanModel || "",
        content: "",
        reasoning: "",
        toolCalls: [],
        metadata: {
          council: {
            sessionId: council.sessionId,
            role: "chairman",
            stage: 3,
            chairmanModel: event.chairmanModel || ""
          }
        }
      };
    } else {
      council.chairman.model = event.chairmanModel || council.chairman.model;
      council.chairman.id = event.assistantMessageId || council.chairman.id;
    }
    return;
  }

  if (type === "council:chairman:delta") {
    if (!council.chairman) return;
    applyStreamEvent(council.chairman, event.event);
    return;
  }

  if (type === "council:chairman:done") {
    council.stage3Status = "done";
    if (council.chairman) council.chairman.finishReason ||= "stop";
    return;
  }

  if (type === "council:chairman:error") {
    council.stage3Status = "error";
    if (council.chairman) {
      council.chairman.error = event.error || "Chairman synthesis failed.";
      council.chairman.finishReason = "error";
    }
    return;
  }

  if (type === "council:chairman:skipped") {
    council.stage3Status = "skipped";
    return;
  }
}

/* ─── API data loading ─── */

async function loadMe() {
  state.me = await fetchMe(state.session);
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

async function loadConversations({ ensure = true } = {}) {
  const payload = await listConversations(state.session);
  state.conversations = payload.conversations || [];
  if (!state.conversations.length && ensure) {
    const created = await createConversation(state.session, { model: resolveRoutedModel() });
    state.conversations = [created.conversation];
  }
  state.activeConversationId ||= state.conversations[0]?.id || "";
  if (state.activeConversationId) await loadActiveConversation();
}

async function loadActiveConversation() {
  if (!state.activeConversationId) {
    state.messages = [];
    return;
  }
  const payload = await fetchConversation(state.session, state.activeConversationId);
  state.messages = payload.messages || [];
}

async function loadChatApp() {
  await Promise.all([loadModels(), loadConversations()]);
  renderShell();
}

/* ─── Actions ─── */

async function addConversation() {
  try {
    const payload = await createConversation(state.session, { model: resolveRoutedModel({ images: [] }) });
    state.conversations.unshift(payload.conversation);
    state.activeConversationId = payload.conversation.id;
    state.messages = [];
    state.images = [];
    closeDocumentViewer();
    renderImages();
    renderShell();
  } catch (err) {
    showToast(err.message);
  }
}

async function removeConversation(id) {
  try {
    await deleteConversation(state.session, id);
    state.activeConversationId = "";
    await loadConversations();
    closeConfirmDialog();
    renderShell();
    showToast("Chat deleted.");
  } catch (err) {
    showToast(err.message);
  }
}

async function sendPrompt() {
  const text = els.promptInput.value.trim();
  if (!text && !state.images.length) return;
  const compareModels = activeCompareModelIds();
  const pendingDocs = pendingDocumentUploads();
  if (pendingDocs.length) {
    const failed = pendingDocs.find((item) => item.status === "failed");
    showToast(failed ? `Remove or retry ${failed.file.name}.` : "Wait for document processing to finish.");
    return;
  }
  if (state.settings.compareEnabled && selectedCompareModelIds().length < 2) {
    showToast(isCouncilMode() ? "Pick at least 2 models for the council." : "Pick at least 2 models to compare.");
    return;
  }
  closeCompareContextBanner();

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
    )
  });
}

async function waitForDocumentReady(attachmentId, fileName) {
  const deadline = Date.now() + 120000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const payload = await fetchDocumentStatus(state.session, attachmentId);
    const doc = payload.document || {};
    lastStatus = doc.status || "";
    if (doc.status === "ready") return doc;
    if (doc.status === "failed") {
      throw new Error(doc.error?.message || `${fileName || "Document"} could not be processed.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error(`${fileName || "Document"} is still processing. Try again in a moment.`);
}

async function retryFailedAssistant(assistantMessageId) {
  if (state.running || !state.activeConversationId || !assistantMessageId) return;

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
  state.messages[index] = localAssistant;

  state.abortController = new AbortController();
  state.autoScroll = true;
  setRunning(true);
  renderMessages();

  try {
    const retryProvider = activeProvider();
    const retryModel = retryProvider === "openrouter"
      ? resolveRoutedModel({ images: [], userContent: userMsg.content })
      : state.settings.model;
    await streamConversationMessage(state.session, state.activeConversationId, {
      retryAssistantMessageId: assistantMessageId,
      model: retryModel,
      provider: retryProvider,
      settings: {
        ...state.settings,
        reasoning_effort: DEFAULT_REASONING_EFFORT
      },
      agentMode: Boolean(state.settings.agentMode),
      webSearch: state.settings.agentMode && state.settings.webSearchMode !== "off" ? "auto" : "off"
    }, {
      signal: state.abortController.signal,
      onEvent: (event) => {
        applyStreamEvent(localAssistant, event);
        queueRenderMessages();
      }
    });

    await Promise.all([loadMe(), loadConversations({ ensure: false })]);
    await loadActiveConversation();
  } catch (err) {
    if (err.name === "AbortError") {
      localAssistant.stopped = true;
    } else {
      localAssistant.error = err.message;
    }
  } finally {
    state.abortController = null;
    setRunning(false);
    renderShell();
  }
}

async function executeSend({ text, images, compareModels, council = false, describeImages = false, newChat = false }) {
  closeCompareContextBanner();

  if (newChat) {
    const payload = await createConversation(state.session, { model: compareModels[0] || resolveRoutedModel({ images }) });
    state.conversations.unshift(payload.conversation);
    state.activeConversationId = payload.conversation.id;
    state.messages = [];
    renderConversations();
  } else if (!state.activeConversationId) {
    await addConversation();
  }

  const localUser = {
    id: `local_${Date.now()}`,
    role: "user",
    content: images.length
      ? [
          ...(text ? [{ type: "text", text }] : []),
          ...images.map((img) => img.category === "image"
            ? { type: "image_url", image_url: { url: img.previewUrl } }
            : { type: "file", file: { file_name: img.file.name, content_type: img.file.type } })
        ]
      : text
  };

  let localAssistant;
  if (council) {
    localAssistant = {
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
  } else if (compareModels.length) {
    localAssistant = {
      id: `local_compare_${Date.now()}`,
      role: "assistant",
      compareGroup: true,
      compareResponses: compareModels.map((model) => ({
        id: `local_compare_${model}_${Date.now()}`,
        role: "assistant",
        model,
        content: "",
        reasoning: "",
        toolCalls: []
      }))
    };
  } else {
    localAssistant = {
      id: `local_assistant_${Date.now()}`,
      role: "assistant",
      content: "",
      reasoning: "",
      toolCalls: []
    };
  }

  state.messages.push(localUser, localAssistant);
  els.promptInput.value = "";
  applyComposerHeight();
  state.images = [];
  renderImages();

  state.abortController = new AbortController();
  state.autoScroll = true;
  setRunning(true);
  renderMessages();
  let shouldReloadConversation = false;

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
        showToast(`Processing ${img.file.name}...`);
        await waitForDocumentReady(uploadedFile.id, img.file.name);
      }
      uploaded.push(uploadedFile);
      if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
    }

    const provider = activeProvider();
    const effectiveModel = provider === "openrouter" ? resolveRoutedModel({ images }) : state.settings.model;
    updateSetting("model", effectiveModel);
    const payload = {
      text,
      attachments: uploaded.map((item) => item.id),
      model: effectiveModel,
      provider,
      settings: {
        ...state.settings,
        reasoning_effort: DEFAULT_REASONING_EFFORT
      },
      agentMode: Boolean(state.settings.agentMode),
      webSearch: state.settings.agentMode && state.settings.webSearchMode !== "off" ? "auto" : "off",
      ...(describeImages ? { describeImages: true } : {})
    };

    if (council) {
      await streamCompareConversationMessage(state.session, state.activeConversationId, {
        ...payload,
        models: compareModels,
        council: true
      }, {
        signal: state.abortController.signal,
        onEvent: (event) => {
          applyCouncilStreamEvent(localAssistant, event);
          queueRenderMessages();
        }
      });
    } else if (compareModels.length) {
      await streamCompareConversationMessage(state.session, state.activeConversationId, {
        ...payload,
        models: compareModels
      }, {
        signal: state.abortController.signal,
        onEvent: (event) => {
          applyCompareStreamEvent(localAssistant, event);
          queueRenderMessages();
        }
      });
    } else {
      await streamConversationMessage(state.session, state.activeConversationId, payload, {
        signal: state.abortController.signal,
        onEvent: (event) => {
          applyStreamEvent(localAssistant, event);
          queueRenderMessages();
        }
      });
    }

    await Promise.all([loadMe(), loadConversations({ ensure: false })]);
    shouldReloadConversation = true;
  } catch (err) {
    if (err.name === "AbortError") {
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
        localAssistant.error = err.message;
      }
    }
  } finally {
    state.abortController = null;
    setRunning(false);
    if (shouldReloadConversation) {
      await loadActiveConversation().catch(() => {});
    }
    renderShell();
  }
}

async function signOutAndReset() {
  await signOut(state.config, state.session);
  state.session = null;
  state.me = null;
  state.conversations = [];
  state.messages = [];
  closeAllDrawers();
  renderShell();
}

/* ─── Bootstrap ─── */

async function bootstrap() {
  try {
    state.config = await fetchConfig();
    const plansPayload = await fetchPlans();
    state.plans = plansPayload.plans || [];
    state.session = parseSessionFromUrl() || loadSession();
    if (state.session) {
      try {
        state.session = await withTimeout(refreshSession(state.config, state.session), 8000, "Session refresh");
        if (state.session) saveSession(state.session);
      } catch {
        clearSession();
        state.session = null;
      }
    }
    if (state.session) {
      try {
        await withTimeout(loadMe(), 8000, "Account load");
      } catch {
        clearSession();
        state.session = null;
      }
    }
    renderShell();
    if (state.session && hasChatAccess()) await loadChatApp();
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

function isNearBottom(el, threshold = 60) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function bindEvents() {
  initDocumentViewerWidth();

  els.messages.addEventListener("scroll", () => {
    if (!state.running) return;
    state.autoScroll = isNearBottom(els.messages);
  }, { passive: true });
  els.googleButton.addEventListener("click", () => {
    if (!state.config?.auth?.googleEnabled) return;
    window.location.href = googleSignInUrl(state.config);
  });

  els.magicForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await sendMagicLink(state.config, els.emailInput.value.trim());
      els.authNotice.textContent = "Check your email for the sign-in link.";
    } catch (err) {
      els.authNotice.textContent = err.message;
    }
  });

  els.paywallSignOutButton.addEventListener("click", signOutAndReset);
  els.signOutButton.addEventListener("click", signOutAndReset);

  els.sidebarButton.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-expanded");
  });

  els.newChatButton.addEventListener("click", addConversation);
  els.accountButton.addEventListener("click", openAccount);
  els.closeAccountButton.addEventListener("click", closeAccount);
  els.settingsButton.addEventListener("click", openSettings);
  els.settingsButtonAlt.addEventListener("click", () => {
    closeActionMenu();
    openSettings();
  });
  els.closeSettingsButton.addEventListener("click", closeSettings);

  els.overlay.addEventListener("click", () => {
    const mode = els.overlay.dataset.mode;
    if (mode === "confirm") closeConfirmDialog();
    else if (mode === "account") closeAccount();
    else closeSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (els.confirmDialog.classList.contains("open")) { closeConfirmDialog(); return; }
    if (!els.lightbox.classList.contains("hidden")) { closeLightbox(); return; }
    if (state.viewer.open) { closeDocumentViewer(); return; }
    if (!els.composerActionMenu.classList.contains("hidden")) { closeActionMenu(); return; }
    if (!els.compareDropdown.classList.contains("hidden")) { closeCompareDropdown(); return; }
    if (!els.modelDropdown.classList.contains("hidden")) { closeModelDropdown(); return; }
    if (els.accountDrawer.classList.contains("open")) { closeAccount(); return; }
    if (els.settingsDrawer.classList.contains("open")) { closeSettings(); return; }
  });

  els.modelButton.addEventListener("click", (e) => {
    e.stopPropagation();
    closeActionMenu();
    closeCompareDropdown();
    toggleModelDropdown();
  });

  els.compareButton.addEventListener("click", (e) => {
    e.stopPropagation();
    closeActionMenu();
    closeModelDropdown();
    closeCompareDropdown();
    if (state.settings.compareEnabled) {
      cancelCompareMode();
      return;
    }
    activateCompareMode();
  });

  document.addEventListener("click", (e) => {
    if (!els.modelDropdown.contains(e.target) && !els.composerModelWrap.contains(e.target)) {
      closeModelDropdown();
    }
    if (!els.composerActionMenu.contains(e.target) && !els.composerActionMenuWrap.contains(e.target)) {
      closeActionMenu();
    }
    if (!els.compareDropdown.contains(e.target) && !els.compareWrap.contains(e.target)) {
      closeCompareDropdown();
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
    const selected = selectedCompareModelIds();
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
    renderCompareControls();
    syncCompareContextBanner(next);
    els.promptInput.focus();
  });

  els.compareClearButton.addEventListener("click", () => {
    cancelCompareMode();
    els.promptInput.focus();
  });

  if (els.compareModeToggle) {
    els.compareModeToggle.addEventListener("click", (e) => {
      const seg = e.target.closest("[data-compare-mode]");
      if (!seg) return;
      const mode = seg.dataset.compareMode === "council" ? "council" : "compare";
      if (state.settings.compareMode === mode) return;
      updateSetting("compareMode", mode);
      renderCompareControls();
    });
  }

  els.compareContextYes.addEventListener("click", () => {
    state.compareDescribeImages = true;
    closeCompareContextBanner();
    els.promptInput.focus();
  });

  els.compareContextNo.addEventListener("click", async () => {
    closeCompareContextBanner();
    try {
      await startCompareFreshChat();
      els.promptInput.focus();
    } catch (err) {
      showToast(err.message);
    }
  });

  els.compareContextCancel.addEventListener("click", () => {
    cancelCompareMode();
    els.promptInput.focus();
  });

  els.compareInput.addEventListener("input", renderCompareCatalog);

  els.conversationList.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delete-chat-id]");
    if (del) {
      const c = state.conversations.find((item) => item.id === del.dataset.deleteChatId);
      if (c) openConfirmDialog(c);
      return;
    }
    const open = e.target.closest("[data-open-chat-id]");
    if (!open) return;
    state.activeConversationId = open.dataset.openChatId;
    document.body.classList.remove("sidebar-open");
    state.compareDescribeImages = false;
    closeDocumentViewer();
    closeCompareContextBanner();
    try {
      await loadActiveConversation();
      renderShell();
    } catch (err) {
      showToast(err.message);
    }
  });

  els.confirmCancelButton.addEventListener("click", closeConfirmDialog);
  els.confirmDeleteButton.addEventListener("click", () => {
    if (state.pendingDeleteId) removeConversation(state.pendingDeleteId);
  });

  els.actionMenuButton.addEventListener("click", (e) => {
    e.stopPropagation();
    closeModelDropdown();
    closeCompareDropdown();
    toggleActionMenu();
  });

  els.imageToggle.addEventListener("click", () => {
    closeActionMenu();
    els.imageFileInput.click();
  });
  els.imageFileInput.addEventListener("change", (e) => {
    addImages(e.target.files || []);
    e.target.value = "";
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
  if (els.agentModeToggle) {
    els.agentModeToggle.addEventListener("click", toggleAgentMode);
  }

  els.imagePreviews.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove-index]");
    if (removeBtn) {
      e.stopPropagation();
      const [removed] = state.images.splice(Number(removeBtn.dataset.removeIndex), 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      if (removed?.abortController) removed.abortController.abort();
      const deleteId = removed?.attachmentId || removed?.uploadId || "";
      if (deleteId) {
        deleteAttachment(state.session, deleteId).catch((err) => {
          showToast(err.message || "Attachment could not be deleted.");
        });
      }
      renderImages();
      syncCompareContextBanner();
      return;
    }
    const thumb = e.target.closest("[data-preview-src]");
    if (thumb) openLightbox(thumb.dataset.previewSrc);
  });

  els.lightboxClose.addEventListener("click", (e) => { e.stopPropagation(); closeLightbox(); });
  els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) closeLightbox(); });
  els.documentViewerClose?.addEventListener("click", closeDocumentViewer);
  els.documentViewerResizer?.addEventListener("pointerdown", beginDocumentViewerResize);
  els.documentViewerDownload?.addEventListener("click", async (e) => {
    const attachmentId = state.viewer.downloadAttachmentId || state.viewer.attachmentId;
    if (!attachmentId) return;
    e.preventDefault();
    try {
      await downloadAttachment(state.session, attachmentId, state.viewer.fileName || "download");
    } catch (err) {
      showToast(err.message || "Download failed.");
    }
  });

  els.messages.addEventListener("click", async (e) => {
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

    const codeCopy = e.target.closest("[data-copy-code]");
    if (codeCopy) {
      const text = codeCopy.dataset.copyCode;
      navigator.clipboard.writeText(text).then(() => {
        const label = codeCopy.querySelector("span");
        if (label) { label.textContent = "Copied!"; setTimeout(() => { label.textContent = "Copy"; }, 1500); }
      }).catch(() => showToast("Copy failed."));
      return;
    }

    const retryBtn = e.target.closest("[data-retry-assistant-id]");
    if (retryBtn) {
      e.preventDefault();
      const assistantId = retryBtn.dataset.retryAssistantId || "";
      if (assistantId) retryFailedAssistant(assistantId).catch((err) => showToast(err.message || "Retry failed."));
      return;
    }

    const msgCopy = e.target.closest("[data-copy-msg]");
    if (msgCopy) {
      const container = msgCopy.closest("[data-raw-text]");
      const text = container?.dataset.rawText || "";
      navigator.clipboard.writeText(text).then(() => {
        const label = msgCopy.querySelector("span");
        if (label) { label.textContent = "Copied!"; setTimeout(() => { label.textContent = "Copy"; }, 1500); }
      }).catch(() => showToast("Copy failed."));
      return;
    }
  });

  els.sendButton.addEventListener("click", sendPrompt);
  els.stopButton.addEventListener("click", () => state.abortController?.abort());

  els.promptInput.addEventListener("input", () => { applyComposerHeight(); updateSendButton(); renderContextMeter(); });
  els.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
  });
  els.promptInput.addEventListener("paste", (e) => {
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
  });

  els.temperatureInput.addEventListener("input", (e) => updateSetting("temperature", Number(e.target.value)));
  els.topPInput.addEventListener("input", (e) => updateSetting("top_p", Number(e.target.value)));
  els.maxTokensInput.addEventListener("input", (e) => updateSetting("max_tokens", e.target.value));
  els.seedInput.addEventListener("input", (e) => updateSetting("seed", e.target.value));
  els.systemPromptInput.addEventListener("input", (e) => updateSetting("systemPrompt", e.target.value));

  els.loadAdminButton.addEventListener("click", async () => {
    try {
      els.adminOutput.textContent = JSON.stringify(await fetchAdminSummary(state.session), null, 2);
    } catch (err) {
      els.adminOutput.textContent = err.message;
    }
  });
}

bindEvents();
bootstrap();
