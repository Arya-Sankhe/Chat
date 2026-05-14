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
import { escapeHtml, normalizeModelList, renderContent } from "./render.js";

const SETTINGS_KEY = "smartyfy.chat.controls.v1";

const defaultSettings = {
  temperature: 0.7,
  top_p: 1,
  max_tokens: "",
  seed: "",
  systemPrompt: ""
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

const els = {
  setupView: document.querySelector("#setupView"),
  authView: document.querySelector("#authView"),
  paywallView: document.querySelector("#paywallView"),
  chatView: document.querySelector("#chatView"),
  serviceList: document.querySelector("#serviceList"),
  publicPlans: document.querySelector("#publicPlans"),
  paywallPlans: document.querySelector("#paywallPlans"),
  googleButton: document.querySelector("#googleButton"),
  magicForm: document.querySelector("#magicForm"),
  emailInput: document.querySelector("#emailInput"),
  authNotice: document.querySelector("#authNotice"),
  refreshAuthButton: document.querySelector("#refreshAuthButton"),
  paywallEmail: document.querySelector("#paywallEmail"),
  paywallSignOutButton: document.querySelector("#paywallSignOutButton"),
  conversationList: document.querySelector("#conversationList"),
  newChatButton: document.querySelector("#newChatButton"),
  accountButton: document.querySelector("#accountButton"),
  modelSelect: document.querySelector("#modelSelect"),
  usagePill: document.querySelector("#usagePill"),
  messages: document.querySelector("#messages"),
  promptInput: document.querySelector("#promptInput"),
  imagePreviews: document.querySelector("#imagePreviews"),
  imageFileInput: document.querySelector("#imageFileInput"),
  imageButton: document.querySelector("#imageButton"),
  sendButton: document.querySelector("#sendButton"),
  stopButton: document.querySelector("#stopButton"),
  settingsButton: document.querySelector("#settingsButton"),
  accountDrawer: document.querySelector("#accountDrawer"),
  closeAccountButton: document.querySelector("#closeAccountButton"),
  accountSummary: document.querySelector("#accountSummary"),
  signOutButton: document.querySelector("#signOutButton"),
  adminSection: document.querySelector("#adminSection"),
  loadAdminButton: document.querySelector("#loadAdminButton"),
  adminOutput: document.querySelector("#adminOutput"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  temperatureInput: document.querySelector("#temperatureInput"),
  topPInput: document.querySelector("#topPInput"),
  maxTokensInput: document.querySelector("#maxTokensInput"),
  seedInput: document.querySelector("#seedInput"),
  systemPromptInput: document.querySelector("#systemPromptInput"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmText: document.querySelector("#confirmText"),
  cancelDeleteButton: document.querySelector("#cancelDeleteButton"),
  confirmDeleteButton: document.querySelector("#confirmDeleteButton"),
  overlay: document.querySelector("#overlay"),
  toast: document.querySelector("#toast")
};

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function applyStreamEvent(message, event) {
  const choice = event?.choices?.[0];
  const delta = choice?.delta || {};

  if (typeof delta.reasoning_content === "string") message.reasoning += delta.reasoning_content;
  if (typeof delta.content === "string") message.content += delta.content;

  if (Array.isArray(delta.tool_calls)) {
    for (const callDelta of delta.tool_calls) {
      const index = Number.isInteger(callDelta.index) ? callDelta.index : message.toolCalls.length;
      const existing = message.toolCalls[index] || {
        id: "",
        type: "function",
        function: { name: "", arguments: "" }
      };
      existing.id = callDelta.id || existing.id;
      existing.type = callDelta.type || existing.type;
      existing.function.name = callDelta.function?.name || existing.function.name;
      existing.function.arguments += callDelta.function?.arguments || "";
      message.toolCalls[index] = existing;
    }
  }

  if (choice?.finish_reason) message.finishReason = choice.finish_reason;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function showOnly(view) {
  [els.setupView, els.authView, els.paywallView, els.chatView].forEach((el) => el.classList.add("hidden"));
  view.classList.remove("hidden");
}

function servicesReady() {
  const services = state.config?.services || {};
  return Boolean(services.supabase && services.access && services.r2 && services.crof);
}

function hasChatAccess() {
  return Boolean(state.me?.access?.active || ["active", "trialing", "testing"].includes(state.me?.subscription?.status));
}

function renderServices() {
  const services = state.config?.services || {};
  els.serviceList.innerHTML = Object.entries({
    supabase: "Supabase Auth and Postgres",
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

function planCard(plan) {
  return `
    <article class="plan-card">
      <h3>${escapeHtml(plan.name)}</h3>
      <div class="price">${escapeHtml(plan.priceLabel)}</div>
      <p>${escapeHtml(plan.description)}</p>
      <ul>
        <li>${Number(plan.dailyMessageLimit).toLocaleString()} messages per day</li>
        <li>${Number(plan.monthlyImageLimit).toLocaleString()} images per month</li>
        <li>${Number(plan.maxImagesPerMessage).toLocaleString()} images per message</li>
      </ul>
    </article>
  `;
}

function renderPlans() {
  els.publicPlans.innerHTML = state.plans.map((plan) => planCard(plan)).join("");
  els.paywallPlans.innerHTML = state.plans.map((plan) => planCard(plan)).join("");
}

function renderShell() {
  renderPlans();

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
    showOnly(els.paywallView);
    return;
  }

  showOnly(els.chatView);
  renderUsage();
  renderAccount();
  renderConversations();
  renderModels();
  renderMessages();
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
  els.accountSummary.innerHTML = `
    <div class="section-title">${escapeHtml(state.me?.user?.email || "Signed in")}</div>
    <p class="muted">Plan: ${escapeHtml(plan?.name || "No active plan")}</p>
    <p class="muted">Access: ${escapeHtml(sub?.status || state.me?.access?.mode || "none")}</p>
    ${sub?.currentPeriodEnd ? `<p class="muted">Renews: ${escapeHtml(new Date(sub.currentPeriodEnd).toLocaleDateString())}</p>` : ""}
  `;
  els.adminSection.classList.toggle("hidden", state.me?.profile?.role !== "admin");
}

function renderConversations() {
  els.conversationList.innerHTML = state.conversations.map((conversation) => `
    <div class="conversation-row ${conversation.id === state.activeConversationId ? "active" : ""}">
      <button class="conversation-open" type="button" data-open-conversation="${escapeHtml(conversation.id)}">${escapeHtml(conversation.title || "New chat")}</button>
      <button class="conversation-delete" type="button" data-delete-conversation="${escapeHtml(conversation.id)}" aria-label="Delete chat">x</button>
    </div>
  `).join("");
}

function renderModels() {
  const active = state.settings.model;
  els.modelSelect.innerHTML = state.models.length
    ? state.models.map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === active ? "selected" : ""}>${escapeHtml(model.name || model.id)}</option>`).join("")
    : `<option value="">No models loaded</option>`;
  els.modelSelect.disabled = !state.models.length;
}

function normalizeMessage(message) {
  return {
    ...message,
    toolCalls: message.toolCalls || message.tool_calls || []
  };
}

function renderMessages() {
  if (!state.messages.length) {
    els.messages.innerHTML = `<div class="empty-state"><div><h1>Good to see you.</h1><p>Start a new Smartyfy conversation below.</p></div></div>`;
    return;
  }

  els.messages.innerHTML = state.messages.map((raw) => {
    const message = normalizeMessage(raw);
    const role = message.role === "user" ? "user" : "assistant";
    const body = renderContent(message.content || (state.running && role === "assistant" ? "Thinking..." : ""));
    const reasoning = message.reasoning ? `<div class="reasoning">${renderContent(message.reasoning)}</div>` : "";
    const error = message.error ? `<div class="reasoning">${escapeHtml(message.error)}</div>` : "";
    return `
      <article class="message ${role}">
        <div class="avatar">${role === "user" ? "You" : "S"}</div>
        <div class="bubble">${reasoning}${body}${error}</div>
      </article>
    `;
  }).join("");
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderImages() {
  els.imagePreviews.innerHTML = state.images.map((image, index) => `
    <div class="preview">
      <img src="${escapeHtml(image.previewUrl)}" alt="${escapeHtml(image.file.name)}">
      <button type="button" data-remove-image="${index}" aria-label="Remove image">x</button>
    </div>
  `).join("");
}

function setRunning(running) {
  state.running = running;
  els.sendButton.classList.toggle("hidden", running);
  els.stopButton.classList.toggle("hidden", !running);
  els.promptInput.disabled = running;
  els.imageButton.disabled = running;
}

async function loadMeState() {
  state.me = await fetchMe(state.session);
}

async function loadModelsState() {
  try {
    const payload = await fetchModels(state.session);
    state.models = normalizeModelList(payload);
    if (!state.settings.model && state.models[0]) {
      state.settings.model = state.models[0].id;
      saveSettings();
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function loadConversationsState({ ensure = true } = {}) {
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
  await Promise.all([loadModelsState(), loadConversationsState()]);
  renderShell();
}

async function addConversation() {
  const payload = await createConversation(state.session, { model: state.settings.model });
  state.conversations.unshift(payload.conversation);
  state.activeConversationId = payload.conversation.id;
  state.messages = [];
  renderShell();
}

function addImages(files) {
  const max = state.me?.plan?.maxImagesPerMessage || 4;
  const accepted = [...files].filter((file) => file.type.startsWith("image/"));
  const remaining = Math.max(0, max - state.images.length);
  const chosen = accepted.slice(0, remaining);
  if (accepted.length > chosen.length) showToast(`Attach up to ${max} images.`);

  for (const file of chosen) {
    state.images.push({ file, previewUrl: URL.createObjectURL(file) });
  }
  renderImages();
}

async function sendPrompt() {
  const text = els.promptInput.value.trim();
  if (!text && !state.images.length) return;
  if (!state.settings.model) {
    showToast("Choose a model first.");
    return;
  }

  if (!state.activeConversationId) await addConversation();

  const localUser = {
    id: `local_${Date.now()}`,
    role: "user",
    content: state.images.length
      ? [
          ...(text ? [{ type: "text", text }] : []),
          ...state.images.map((image) => ({ type: "image_url", image_url: { url: image.previewUrl } }))
        ]
      : text
  };
  const localAssistant = {
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
  renderImages();
  renderMessages();

  state.abortController = new AbortController();
  setRunning(true);

  try {
    const uploaded = [];
    for (const image of images) {
      uploaded.push(await uploadImage(state.session, image.file));
      URL.revokeObjectURL(image.previewUrl);
    }

    await streamConversationMessage(state.session, state.activeConversationId, {
      text,
      attachments: uploaded.map((item) => item.id),
      model: state.settings.model,
      settings: state.settings
    }, {
      signal: state.abortController.signal,
      onEvent: (event) => {
        applyStreamEvent(localAssistant, event);
        renderMessages();
      }
    });

    await Promise.all([loadMeState(), loadConversationsState({ ensure: false })]);
  } catch (error) {
    if (error.name === "AbortError") {
      localAssistant.error = "Stopped.";
    } else {
      localAssistant.error = error.message;
    }
  } finally {
    state.abortController = null;
    setRunning(false);
    await loadActiveConversation().catch(() => {});
    renderShell();
  }
}

function openDrawer(drawer) {
  els.overlay.classList.remove("hidden");
  drawer.classList.remove("hidden");
}

function closeDrawers() {
  els.overlay.classList.add("hidden");
  els.accountDrawer.classList.add("hidden");
  els.settingsDrawer.classList.add("hidden");
  els.confirmDialog.classList.add("hidden");
}

function syncSettingsInputs() {
  els.temperatureInput.value = state.settings.temperature;
  els.topPInput.value = state.settings.top_p;
  els.maxTokensInput.value = state.settings.max_tokens;
  els.seedInput.value = state.settings.seed;
  els.systemPromptInput.value = state.settings.systemPrompt;
}

function updateSetting(key, value) {
  state.settings[key] = value;
  saveSettings();
}

async function signOutAndReset() {
  await signOut(state.config, state.session);
  state.session = null;
  state.me = null;
  state.conversations = [];
  state.messages = [];
  closeDrawers();
  renderShell();
}

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
        await loadMeState();
      } catch {
        clearSession();
        state.session = null;
      }
    }
    renderShell();
    if (state.session && hasChatAccess()) await loadChatApp();
  } catch (error) {
    showToast(error.message);
  }
}

function bindEvents() {
  els.googleButton.addEventListener("click", () => {
    window.location.href = googleSignInUrl(state.config);
  });

  els.magicForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await sendMagicLink(state.config, els.emailInput.value.trim());
      els.authNotice.textContent = "Check your email for the sign-in link.";
    } catch (error) {
      els.authNotice.textContent = error.message;
    }
  });

  els.refreshAuthButton.addEventListener("click", bootstrap);
  els.paywallSignOutButton.addEventListener("click", signOutAndReset);
  els.signOutButton.addEventListener("click", signOutAndReset);

  els.newChatButton.addEventListener("click", () => addConversation().catch((error) => showToast(error.message)));
  els.accountButton.addEventListener("click", () => openDrawer(els.accountDrawer));
  els.closeAccountButton.addEventListener("click", closeDrawers);
  els.settingsButton.addEventListener("click", () => {
    syncSettingsInputs();
    openDrawer(els.settingsDrawer);
  });
  els.closeSettingsButton.addEventListener("click", closeDrawers);
  els.overlay.addEventListener("click", closeDrawers);

  els.modelSelect.addEventListener("change", () => {
    updateSetting("model", els.modelSelect.value);
  });

  els.conversationList.addEventListener("click", async (event) => {
    const open = event.target.closest("[data-open-conversation]");
    const remove = event.target.closest("[data-delete-conversation]");
    if (open) {
      state.activeConversationId = open.dataset.openConversation;
      await loadActiveConversation();
      renderShell();
    }
    if (remove) {
      state.pendingDeleteId = remove.dataset.deleteConversation;
      const conversation = state.conversations.find((item) => item.id === state.pendingDeleteId);
      els.confirmText.textContent = `Delete "${conversation?.title || "New chat"}" from your account?`;
      openDrawer(els.confirmDialog);
    }
  });

  els.cancelDeleteButton.addEventListener("click", closeDrawers);
  els.confirmDeleteButton.addEventListener("click", async () => {
    if (!state.pendingDeleteId) return;
    try {
      await deleteConversation(state.session, state.pendingDeleteId);
      state.pendingDeleteId = "";
      state.activeConversationId = "";
      await loadConversationsState();
      closeDrawers();
      renderShell();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.imageButton.addEventListener("click", () => els.imageFileInput.click());
  els.imageFileInput.addEventListener("change", (event) => {
    addImages(event.target.files || []);
    event.target.value = "";
  });
  els.imagePreviews.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-image]");
    if (!button) return;
    const [removed] = state.images.splice(Number(button.dataset.removeImage), 1);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    renderImages();
  });

  els.sendButton.addEventListener("click", () => sendPrompt());
  els.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  });
  els.stopButton.addEventListener("click", () => state.abortController?.abort());

  els.temperatureInput.addEventListener("input", () => updateSetting("temperature", Number(els.temperatureInput.value)));
  els.topPInput.addEventListener("input", () => updateSetting("top_p", Number(els.topPInput.value)));
  els.maxTokensInput.addEventListener("input", () => updateSetting("max_tokens", els.maxTokensInput.value));
  els.seedInput.addEventListener("input", () => updateSetting("seed", els.seedInput.value));
  els.systemPromptInput.addEventListener("input", () => updateSetting("systemPrompt", els.systemPromptInput.value));

  els.loadAdminButton.addEventListener("click", async () => {
    try {
      els.adminOutput.textContent = JSON.stringify(await fetchAdminSummary(state.session), null, 2);
    } catch (error) {
      els.adminOutput.textContent = error.message;
    }
  });
}

bindEvents();
bootstrap();
