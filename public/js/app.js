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
  normalizeModelList,
  renderContent,
  renderModelDetails,
  renderModelOption
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
  compareModels: []
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
  abortController: null,
  pendingDeleteId: ""
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
  lightboxImg: document.querySelector("#lightboxImg")
};

function loadSettings() {
  try {
    const loaded = { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    loaded.compareModels = Array.isArray(loaded.compareModels) ? loaded.compareModels.slice(0, 4) : [];
    loaded.compareEnabled = Boolean(loaded.compareEnabled);
    return loaded;
  } catch {
    return { ...defaultSettings };
  }
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
  renderMessages();
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

function seedCompareModels() {
  const current = state.settings.model || state.models[0]?.id || "";
  const seeded = [
    current,
    ...state.models.map((model) => model.id)
  ].filter((id, index, list) => id && list.indexOf(id) === index).slice(0, 4);
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
    if (!selectedCompareModelIds().length) seedCompareModels();
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
  els.compareButton.classList.toggle("active", active);
  els.compareLabel.textContent = active ? `Compare ${ids.length}` : "Compare";
  els.promptInput.placeholder = active
    ? `Compare ${ids.length} models`
    : `Message ${modelDisplayName(state.settings.model) || "Smartyfy"}`;
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

function messageViews(messages) {
  const views = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = normalizeMessage(messages[i]);
    if (msg.compareGroup) {
      views.push({ type: "compare", messages: msg.compareResponses || [] });
      continue;
    }

    const role = msg.role === "user" ? "user" : "assistant";
    if (role !== "assistant") {
      views.push({ type: "message", message: msg });
      continue;
    }

    const group = [msg];
    while (i + 1 < messages.length) {
      const next = normalizeMessage(messages[i + 1]);
      if (next.compareGroup || next.role === "user") break;
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

function renderToolCalls(message) {
  let toolHtml = "";
  const calls = message.toolCalls || [];
  for (const call of calls) {
    if (!call?.function?.name) continue;
    toolHtml += `<details class="tool-call"><summary>Tool: ${escapeHtml(call.function.name)}</summary><pre>${escapeHtml(call.function.arguments || "")}</pre></details>`;
  }
  return toolHtml;
}

function renderMessageError(message) {
  return message.error ? `<div class="message-error">${escapeHtml(message.error)}</div>` : "";
}

function renderMessageNote(message) {
  return message.stopped ? `<div class="message-note">Stopped by user.</div>` : "";
}

function renderStandardMessage(raw) {
  const msg = normalizeMessage(raw);
  const role = msg.role === "user" ? "user" : "assistant";
  const content = typeof msg.content === "string" ? msg.content : msg.content;
  const body = renderContent(content || (state.running && role === "assistant" ? "Thinking…" : ""));

  return `
    <article class="message ${role}">
      <div class="message-avatar">${role === "user" ? "You" : "S"}</div>
      <div class="message-body">
        <div class="message-meta"><strong>${role === "user" ? "You" : "Smartyfy"}</strong></div>
        <div class="message-content">${renderReasoning(msg)}${body}${renderToolCalls(msg)}${renderMessageError(msg)}${renderMessageNote(msg)}</div>
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

  return `
    <section class="compare-response">
      <header class="compare-response-head">
        <span class="compare-model-mark">
          ${logoUrl
            ? `<img src="${escapeHtml(logoUrl)}" alt="" width="18" height="18" decoding="async">`
            : `<span>${escapeHtml(String(index + 1))}</span>`}
        </span>
        <strong>${escapeHtml(modelDisplayName(modelId) || `Model ${index + 1}`)}</strong>
      </header>
      <div class="compare-response-body message-content">
        ${renderReasoning(msg)}
        ${renderContent(content)}
        ${renderToolCalls(msg)}
        ${renderMessageError(msg)}
        ${renderMessageNote(msg)}
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

function renderMessages() {
  if (!state.messages.length) {
    els.messages.innerHTML = `<div class="empty-state"><div><h1>${getGreeting()}</h1></div></div>`;
    return;
  }

  els.messages.innerHTML = messageViews(state.messages)
    .map((view) => view.type === "compare" ? renderCompareMessage(view.messages) : renderStandardMessage(view.message))
    .join("");

  els.messages.scrollTop = els.messages.scrollHeight;
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

function applyStreamEvent(message, event) {
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
    showToast("Pick at least 2 models to compare.");
    return;
  }

  if (!state.activeConversationId) await addConversation();

  const localUser = {
    id: `local_${Date.now()}`,
    role: "user",
    content: state.images.length
      ? [
          ...(text ? [{ type: "text", text }] : []),
          ...state.images.map((img) => ({ type: "image_url", image_url: { url: img.previewUrl } }))
        ]
      : text
  };
  const localAssistant = compareModels.length
    ? {
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
      }
    : {
        id: `local_assistant_${Date.now()}`,
        role: "assistant",
        content: "",
        reasoning: "",
        toolCalls: []
      };

  state.messages.push(localUser, localAssistant);
  const images = state.images;
  state.images = [];
  els.promptInput.value = "";
  applyComposerHeight();
  renderImages();
  renderMessages();

  state.abortController = new AbortController();
  setRunning(true);

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
      }
    };

    if (compareModels.length) {
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
  } catch (err) {
    if (err.name === "AbortError") {
      if (localAssistant.compareGroup) {
        for (const response of localAssistant.compareResponses) response.stopped = true;
      } else {
        localAssistant.stopped = true;
      }
    } else {
      if (localAssistant.compareGroup) {
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
    await loadActiveConversation().catch(() => {});
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
      state.session = await refreshSession(state.config, state.session);
      if (state.session) saveSession(state.session);
    }
    if (state.session) {
      try {
        await loadMe();
      } catch {
        clearSession();
        state.session = null;
      }
    }
    renderShell();
    if (state.session && hasChatAccess()) await loadChatApp();
  } catch (err) {
    showToast(err.message);
  }
}

/* ─── Event binding ─── */

function bindEvents() {
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
    toggleCompareDropdown();
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
    renderCompareControls();
    els.promptInput.focus();
  });

  els.compareClearButton.addEventListener("click", () => {
    updateSetting("compareEnabled", false);
    updateSetting("compareModels", []);
    closeCompareDropdown();
    renderCompareControls();
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

  els.imagePreviews.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove-index]");
    if (removeBtn) {
      e.stopPropagation();
      const [removed] = state.images.splice(Number(removeBtn.dataset.removeIndex), 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      renderImages();
      return;
    }
    const thumb = e.target.closest("[data-preview-src]");
    if (thumb) openLightbox(thumb.dataset.previewSrc);
  });

  els.lightboxClose.addEventListener("click", (e) => { e.stopPropagation(); closeLightbox(); });
  els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) closeLightbox(); });

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
