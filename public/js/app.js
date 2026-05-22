import {
  createConversation,
  deleteConversation,
  fetchAdminSummary,
  fetchConfig,
  fetchConversation,
  fetchMe,
  fetchModels,
  fetchPlans,
  listConversations,
  streamCompareConversationMessage,
  streamConversationMessage,
  uploadImage
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
  renderContent,
  renderModelDetails,
  renderModelOption,
  resolveDefaultCompareModels
} from "./render.js";

const SETTINGS_KEY = "smartyfy.chat.controls.v1";

const defaultSettings = {
  model: "",
  temperature: 0.7,
  top_p: 1,
  max_tokens: "",
  seed: "",
  systemPrompt: "",
  thinkingEffort: "medium",
  compareEnabled: false,
  compareModels: [],
  compareMode: "compare",
  webSearchMode: "auto"
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
  compareDescribeImages: false
};

let renderQueued = false;

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
  messages: document.querySelector("#messages"),
  promptInput: document.querySelector("#promptInput"),
  imagePreviews: document.querySelector("#imagePreviews"),
  imageFileInput: document.querySelector("#imageFileInput"),
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
  modelLogoImg: document.querySelector("#modelLogoImg"),
  modelFallbackIcon: document.querySelector("#modelFallbackIcon"),
  modelLabel: document.querySelector("#modelLabel"),
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
  webSearchToggle: document.querySelector("#webSearchToggle")
};

function imageDescription(part) {
  return String(part?.image_url?.description || part?.image_url?.alt_text || "").trim();
}

function messageHasUndescribedImages(content) {
  return Array.isArray(content) && content.some((part) => part?.type === "image_url" && !imageDescription(part));
}

function chatHistoryHasUndescribedImages() {
  return state.messages.some((message) => message.role === "user" && messageHasUndescribedImages(message.content));
}

function pendingPromptHasImages() {
  return state.images.length > 0;
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
  if (state.settings.compareEnabled && !state.compareDescribeImages && shouldPromptCompareImageContext(modelIds)) {
    openCompareContextBanner();
  } else {
    closeCompareContextBanner();
  }
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
  const seeded = resolveDefaultCompareModels(state.models);
  if (seeded.length < 2) {
    const current = state.settings.model || state.models[0]?.id || "";
    return [
      current,
      ...state.models.map((model) => model.id)
    ].filter((id, index, list) => id && list.indexOf(id) === index).slice(0, 4);
  }
  return seeded;
}

async function activateCompareMode() {
  const defaults = seedCompareModels();
  if (defaults.length < 2) {
    showToast("Not enough models loaded for compare.");
    return;
  }

  updateSetting("compareModels", defaults);
  updateSetting("compareEnabled", true);
  state.compareDescribeImages = false;
  renderCompareControls();
  syncCompareContextBanner(defaults);
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
    loaded.compareEnabled = Boolean(loaded.compareEnabled);
    loaded.compareMode = loaded.compareMode === "council" ? "council" : "compare";
    loaded.webSearchMode = loaded.webSearchMode === "off" ? "off" : "auto";
    return loaded;
  } catch {
    return { ...defaultSettings };
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
  return Boolean(s.supabase && s.access && s.crof);
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
  renderThinkingEffort();
  renderWebSearchToggle();
  renderMessages();
  syncCompareContextBanner();
}

function renderServices() {
  const services = state.config?.services || {};
  els.serviceList.innerHTML = Object.entries({
    supabase: "Supabase Auth & Postgres",
    access: "Access mode",
    r2: "Cloudflare R2 storage",
    crof: "Managed model API key"
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
  const model = modelById(id);
  return compactModelDisplayName(model?.name || model?.rawName || id) || id;
}

function selectedCompareModelIds() {
  const ids = Array.isArray(state.settings.compareModels) ? state.settings.compareModels : [];
  const unique = ids.filter((id, index) => id && ids.indexOf(id) === index);
  const valid = state.models.length ? unique.filter((id) => modelById(id)) : unique;
  return valid.slice(0, 4);
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
    els.modelInput.value = "";
    renderModelCatalog();
    els.modelInput.focus();
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

function renderModelCatalog() {
  const query = els.modelInput.value.trim().toLowerCase();
  const visible = state.models
    .filter((m) => {
      const h = `${m.id} ${m.name || ""}`.toLowerCase();
      return !query || h.includes(query);
    })
    .slice(0, 80);

  if (!state.models.length) {
    els.modelCatalog.innerHTML = `<div class="model-empty">Loading models…</div>`;
    return;
  }

  if (!visible.length) {
    els.modelCatalog.innerHTML = `<div class="model-empty">No matches.</div>`;
    return;
  }

  els.modelCatalog.innerHTML = visible
    .map((m) => renderModelOption(m, m.id === state.settings.model))
    .join("");
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
  const ids = selectedCompareModelIds();
  const active = state.settings.compareEnabled && ids.length >= 2;
  const council = active && isCouncilMode();
  els.compareButton.classList.toggle("active", active);
  els.compareButton.classList.toggle("council-active", council);
  if (active) {
    els.compareLabel.textContent = council ? `Council ${ids.length}` : `Compare ${ids.length}`;
    els.promptInput.placeholder = council
      ? `Convene ${ids.length} models as a council`
      : `Compare ${ids.length} models`;
  } else {
    els.compareLabel.textContent = "Compare";
    els.promptInput.placeholder = `Message ${modelDisplayName(state.settings.model) || "Smartyfy"}`;
  }
  if (els.compareModeToggle) {
    for (const btn of els.compareModeToggle.querySelectorAll("[data-compare-mode]")) {
      const isActive = btn.dataset.compareMode === state.settings.compareMode;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-checked", String(isActive));
    }
  }
  if (els.compareModeDesc) {
    els.compareModeDesc.textContent = isCouncilMode()
      ? "Models answer, critique each other anonymously, then a chairman synthesizes the final answer."
      : "Side-by-side answers from each model.";
  }
  renderCompareCatalog();
}

function renderModelOptions() {
  els.modelDetails.innerHTML = renderModelDetails(selectedModel());

  const selected = selectedModel();
  const displayName = compactModelDisplayName(selected?.name || state.settings.model) || "Model";
  const logoUrl = selected ? modelBrandLogoUrl(selected) : "";

  els.modelButton.setAttribute("aria-label", `Model: ${displayName}`);
  els.modelButton.classList.toggle("has-brand-logo", Boolean(logoUrl));

  if (logoUrl) {
    els.modelLogoImg.src = logoUrl;
    els.modelLogoImg.classList.remove("hidden");
    els.modelLogoImg.removeAttribute("aria-hidden");
    els.modelLabel.classList.add("hidden");
    els.modelFallbackIcon?.classList.add("hidden");
  } else {
    els.modelLogoImg.removeAttribute("src");
    els.modelLogoImg.classList.add("hidden");
    els.modelLogoImg.setAttribute("aria-hidden", "true");
    els.modelLabel.classList.remove("hidden");
    els.modelFallbackIcon?.classList.remove("hidden");
  }

  els.modelLabel.textContent = displayName;
  els.promptInput.placeholder = `Message ${displayName}`;
  renderModelCatalog();
  renderCompareControls();
}

/* ─── Thinking Effort ─── */

function renderThinkingEffort() {
  const current = state.settings.thinkingEffort || "medium";
  for (const btn of els.thinkingEffort.querySelectorAll(".effort-seg")) {
    const active = btn.dataset.effort === current;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", String(active));
  }
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

function renderReasoning(message) {
  if (!message.reasoning) return "";
  return `<details class="reasoning"><summary>Thinking</summary><div>${renderContent(message.reasoning)}</div></details>`;
}

function renderToolCalls() {
  return "";
}

function renderMessageError(message) {
  return message.error ? `<div class="message-error">${escapeHtml(message.error)}</div>` : "";
}

function renderToolStatuses() {
  return "";
}

function citationListFromMessage(message) {
  if (Array.isArray(message?.citations) && message.citations.length) return message.citations;
  const meta = message?.metadata?.websearch;
  if (meta && Array.isArray(meta.citations) && meta.citations.length) return meta.citations;
  return [];
}

function citationHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function citationFaviconUrl(url) {
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
  const title = String(entry.title || "").trim();
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
    const title = entry.title || host || entry.url;
    return `
      <a class="inline-source-row" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">
        ${rowIcon ? `<img src="${escapeHtml(rowIcon)}" alt="" width="14" height="14" decoding="async">` : ""}
        <span class="inline-source-row-title">${escapeHtml(title)}</span>
        ${host ? `<span class="inline-source-row-host">${escapeHtml(host)}</span>` : ""}
      </a>
    `;
  }).join("");

  return `<details class="inline-source-pill"><summary class="inline-source-pill-trigger">${icon ? `<img class="inline-source-favicon" src="${escapeHtml(icon)}" alt="" width="14" height="14" decoding="async">` : ""}<span class="inline-source-pill-label">${escapeHtml(sourceShortLabel(primary))}</span>${extra > 0 ? `<span class="inline-source-pill-more">+${extra}</span>` : ""}</summary><div class="inline-source-panel">${rows}</div></details>`;
}

function injectInlineCitationPills(text, citations) {
  if (!text || !citations?.length) return text;

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
    const cleaned = block.replace(/\s*\[(\d+)\]/g, "").trimEnd();
    return `${cleaned} ${renderInlineSourcePill(sources)}`;
  });

  return processed.join("\n\n");
}

function renderAssistantContent(content, message, { thinking = false } = {}) {
  const citations = citationListFromMessage(message);
  const fallback = thinking && !content ? "Thinking…" : "";

  if (Array.isArray(content)) {
    if (!citations.length) return renderContent(content.length ? content : fallback);
    const enriched = content.map((part) => {
      if (part?.type !== "text") return part;
      return { ...part, text: injectInlineCitationPills(part.text || "", citations) };
    });
    return renderContent(enriched.length ? enriched : fallback);
  }

  const text = typeof content === "string" ? content : "";
  if (!citations.length) return renderContent(text || fallback);
  return renderContent(injectInlineCitationPills(text, citations) || fallback);
}

function renderCitations(message) {
  const citations = citationListFromMessage(message);
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
    return `
      <a class="sources-row" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">
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

function renderMessageNote(message) {
  return message.stopped ? `<div class="message-note">Stopped by user.</div>` : "";
}

function renderMissingFinal(message, role) {
  const hasFinal = String(message.content || "").trim() || (Array.isArray(message.toolCalls) && message.toolCalls.length);
  if (role !== "assistant" || state.running || message.error || message.stopped || hasFinal) return "";
  return `<div class="message-error">No final response was saved.</div>`;
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
  const thinking = state.running && role === "assistant";
  const body = role === "assistant"
    ? renderAssistantContent(content, msg, { thinking })
    : renderContent(content || "");
  const rawText = rawTextContent(msg.content);

  return `
    <article class="message ${role}" data-raw-text="${escapeHtml(rawText)}">
      <div class="message-avatar">${role === "user" ? "You" : "S"}</div>
      <div class="message-body">
        <div class="message-meta"><strong>${role === "user" ? "You" : "Smartyfy"}</strong>${messageCopyButton(msg)}</div>
        <div class="message-content">${renderReasoning(msg)}${body}${role === "assistant" ? renderCitations(msg) : ""}${renderMessageError(msg)}${renderMessageNote(msg)}${renderMissingFinal(msg, role)}</div>
      </div>
    </article>
  `;
}

function renderCompareResponse(raw, index) {
  const msg = normalizeMessage(raw);
  const modelId = msg.model || selectedCompareModelIds()[index] || "";
  const model = modelById(modelId);
  const logoUrl = model ? modelBrandLogoUrl(model) : "";
  const content = msg.content || (state.running && !msg.error && !msg.finishReason ? "Thinking…" : "");
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
        ${renderReasoning(msg)}
        ${renderAssistantContent(content, msg, { thinking: state.running && !msg.error && !msg.finishReason })}
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
      <div class="message-avatar">S</div>
      <div class="message-body">
        <div class="message-meta"><strong>Smartyfy Compare</strong><span>${messages.length} models</span></div>
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
  const content = msg.content || (state.running && !msg.error && !msg.finishReason ? "Thinking…" : "");
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
        ${renderReasoning(msg)}
        ${renderAssistantContent(content, msg, { thinking: state.running && !msg.error && !msg.finishReason })}
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
  const content = msg.content || (state.running && !msg.error && !msg.finishReason ? "Synthesizing…" : "");
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
        ${renderReasoning(msg)}
        ${renderAssistantContent(content, msg, { thinking: state.running && !msg.error && !msg.finishReason })}
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

function renderImages() {
  els.imagePreviews.innerHTML = state.images.map((img, i) => `
    <div class="preview-thumb" data-preview-src="${escapeHtml(img.previewUrl)}">
      <img src="${escapeHtml(img.previewUrl)}" alt="${escapeHtml(img.file.name)}">
      <button class="preview-remove" type="button" data-remove-index="${i}" aria-label="Remove">×</button>
    </div>
  `).join("");
  updateSendButton();
}

function addImages(files) {
  const max = state.me?.plan?.maxImagesPerMessage || 4;
  const accepted = [...files].filter((f) => f.type.startsWith("image/"));
  const remaining = Math.max(0, max - state.images.length);
  const chosen = accepted.slice(0, remaining);
  if (accepted.length > chosen.length) showToast(`Attach up to ${max} images.`);

  for (const file of chosen) {
    state.images.push({ file, previewUrl: URL.createObjectURL(file) });
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
  els.promptInput.disabled = running;
  els.imageToggle.disabled = running;
  els.modelButton.disabled = running;
  els.compareButton.disabled = running;
}

function updateSendButton() {
  const hasContent = els.promptInput.value.trim() || state.images.length;
  els.sendButton.classList.toggle("active", Boolean(hasContent));
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
    return;
  }

  if (event?.type === "done") {
    message.finishReason ||= "stop";
    return;
  }

  if (typeof event?.type === "string" && event.type.startsWith("tool:")) {
    applyToolEvent(message, event);
    return;
  }

  const choice = event?.choices?.[0];
  const delta = choice?.delta || {};

  if (typeof delta.reasoning_content === "string") message.reasoning += delta.reasoning_content;
  if (typeof delta.content === "string") message.content += delta.content;

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

  if (choice?.finish_reason) message.finishReason = choice.finish_reason;
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
  try {
    const payload = await fetchModels(state.session);
    state.models = normalizeModelList(payload);
    if (!state.settings.model && state.models[0]) {
      state.settings.model = state.models[0].id;
      saveSettings();
    }
  } catch (err) {
    showToast(err.message);
  }
}

async function loadConversations({ ensure = true } = {}) {
  const payload = await listConversations(state.session);
  state.conversations = payload.conversations || [];
  if (!state.conversations.length && ensure) {
    const created = await createConversation(state.session, { model: state.settings.model });
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
    const payload = await createConversation(state.session, { model: state.settings.model });
    state.conversations.unshift(payload.conversation);
    state.activeConversationId = payload.conversation.id;
    state.messages = [];
    state.images = [];
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
  if (!compareModels.length && !state.settings.model) {
    showToast("Pick a model first.");
    return;
  }
  if (state.settings.compareEnabled && selectedCompareModelIds().length < 2) {
    showToast(isCouncilMode() ? "Pick at least 2 models for the council." : "Pick at least 2 models to compare.");
    return;
  }
  if (compareModels.length && !state.compareDescribeImages && shouldPromptCompareImageContext(compareModels)) {
    openCompareContextBanner();
  }
  if (!els.compareContextBanner.classList.contains("hidden")) {
    showToast("Choose how to handle chat images for compare.");
    return;
  }

  await executeSend({
    text,
    images: state.images.map((img) => ({ file: img.file, previewUrl: img.previewUrl })),
    compareModels,
    council: Boolean(compareModels.length && isCouncilMode()),
    describeImages: Boolean(
      compareModels.length &&
      state.compareDescribeImages &&
      (chatHistoryHasUndescribedImages() || pendingPromptHasImages()) &&
      compareIncludesTextOnlyModels(compareModels)
    )
  });
}

async function executeSend({ text, images, compareModels, council = false, describeImages = false, newChat = false }) {
  closeCompareContextBanner();

  if (newChat) {
    const payload = await createConversation(state.session, { model: compareModels[0] || state.settings.model });
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
          ...images.map((img) => ({ type: "image_url", image_url: { url: img.previewUrl } }))
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
      uploaded.push(await uploadImage(state.session, img.file));
      URL.revokeObjectURL(img.previewUrl);
    }

    const payload = {
      text,
      attachments: uploaded.map((item) => item.id),
      model: state.settings.model,
      settings: {
        ...state.settings,
        reasoning_effort: state.settings.thinkingEffort || "medium"
      },
      webSearch: state.settings.webSearchMode === "off" ? "off" : "auto",
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
  els.settingsButtonAlt.addEventListener("click", openSettings);
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
    if (!els.compareDropdown.classList.contains("hidden")) { closeCompareDropdown(); return; }
    if (!els.modelDropdown.classList.contains("hidden")) { closeModelDropdown(); return; }
    if (els.accountDrawer.classList.contains("open")) { closeAccount(); return; }
    if (els.settingsDrawer.classList.contains("open")) { closeSettings(); return; }
  });

  els.modelButton.addEventListener("click", (e) => {
    e.stopPropagation();
    closeCompareDropdown();
    toggleModelDropdown();
  });

  els.compareButton.addEventListener("click", (e) => {
    e.stopPropagation();
    closeModelDropdown();
    if (state.settings.compareEnabled) {
      toggleCompareDropdown();
      return;
    }
    activateCompareMode();
  });

  document.addEventListener("click", (e) => {
    if (!els.modelDropdown.contains(e.target) && !els.composerModelWrap.contains(e.target)) {
      closeModelDropdown();
    }
    if (!els.compareDropdown.contains(e.target) && !els.compareWrap.contains(e.target)) {
      closeCompareDropdown();
    }
  });

  els.modelCatalog.addEventListener("click", (e) => {
    const item = e.target.closest("[data-model-id]");
    if (!item) return;
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
      showToast("Compare up to 4 models.");
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

  els.thinkingEffort.addEventListener("click", (e) => {
    const seg = e.target.closest("[data-effort]");
    if (!seg) return;
    updateSetting("thinkingEffort", seg.dataset.effort);
    renderThinkingEffort();
  });

  els.modelInput.addEventListener("input", renderModelCatalog);
  els.compareInput.addEventListener("input", renderCompareCatalog);
  els.modelInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const id = e.target.value.trim();
    if (!id) return;
    e.preventDefault();
    updateSetting("model", id);
    closeModelDropdown();
    renderModelOptions();
  });

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

  els.imageToggle.addEventListener("click", () => els.imageFileInput.click());
  els.imageFileInput.addEventListener("change", (e) => {
    addImages(e.target.files || []);
    e.target.value = "";
  });

  if (els.webSearchToggle) {
    els.webSearchToggle.addEventListener("click", toggleWebSearchMode);
  }

  els.imagePreviews.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove-index]");
    if (removeBtn) {
      e.stopPropagation();
      const [removed] = state.images.splice(Number(removeBtn.dataset.removeIndex), 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      renderImages();
      syncCompareContextBanner();
      return;
    }
    const thumb = e.target.closest("[data-preview-src]");
    if (thumb) openLightbox(thumb.dataset.previewSrc);
  });

  els.lightboxClose.addEventListener("click", (e) => { e.stopPropagation(); closeLightbox(); });
  els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) closeLightbox(); });

  els.messages.addEventListener("click", (e) => {
    const codeCopy = e.target.closest("[data-copy-code]");
    if (codeCopy) {
      const text = codeCopy.dataset.copyCode;
      navigator.clipboard.writeText(text).then(() => {
        const label = codeCopy.querySelector("span");
        if (label) { label.textContent = "Copied!"; setTimeout(() => { label.textContent = "Copy"; }, 1500); }
      }).catch(() => showToast("Copy failed."));
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

  els.promptInput.addEventListener("input", () => { applyComposerHeight(); updateSendButton(); });
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
