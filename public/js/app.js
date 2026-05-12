import { DEFAULT_BASE_URLS } from "./constants.js";
import { fetchConfig, fetchModels, streamChat } from "./api.js";
import {
  applyStreamEvent,
  buildChatPayload,
  buildUserContent,
  createAssistantMessage,
  createUserMessage,
  titleFromMessage
} from "./chat.js";
import { escapeHtml, normalizeModelList, renderContent, renderModelDetails, renderModelOption } from "./render.js";
import { createConversation, loadState, saveState } from "./storage.js";

const state = loadState();
let serverConfig = {
  allowedBaseUrls: DEFAULT_BASE_URLS,
  serverApiKeyConfigured: false
};
let models = [];
let activeImages = [];
let abortController = null;
let renderQueued = false;
let modelRefreshTimer = null;
let modelAutoRefreshTimer = null;
let modelsLoading = false;
let lastModelRefresh = "";

const els = {
  apiKeyInput: document.querySelector("#apiKeyInput"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  conversationList: document.querySelector("#conversationList"),
  imageAttach: document.querySelector("#imageAttach"),
  imageFileInput: document.querySelector("#imageFileInput"),
  imageList: document.querySelector("#imageList"),
  imageToggle: document.querySelector("#imageToggle"),
  maxTokensInput: document.querySelector("#maxTokensInput"),
  messages: document.querySelector("#messages"),
  modelButton: document.querySelector("#modelButton"),
  modelCatalog: document.querySelector("#modelCatalog"),
  modelDetails: document.querySelector("#modelDetails"),
  modelDropdown: document.querySelector("#modelDropdown"),
  modelInput: document.querySelector("#modelInput"),
  modelLabel: document.querySelector("#modelLabel"),
  modelOptions: document.querySelector("#modelOptions"),
  modelStatus: document.querySelector("#modelStatus"),
  newChatButton: document.querySelector("#newChatButton"),
  overlay: document.querySelector("#overlay"),
  promptInput: document.querySelector("#promptInput"),
  refreshModelsButton: document.querySelector("#refreshModelsButton"),
  rememberKeyInput: document.querySelector("#rememberKeyInput"),
  seedInput: document.querySelector("#seedInput"),
  sendButton: document.querySelector("#sendButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsButtonAlt: document.querySelector("#settingsButtonAlt"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  sidebarButton: document.querySelector("#sidebarButton"),
  stopButton: document.querySelector("#stopButton"),
  stopInput: document.querySelector("#stopInput"),
  systemPromptInput: document.querySelector("#systemPromptInput"),
  temperatureInput: document.querySelector("#temperatureInput"),
  toast: document.querySelector("#toast"),
  toolsInput: document.querySelector("#toolsInput"),
  topPInput: document.querySelector("#topPInput")
};

function activeConversation() {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId) || state.conversations[0];
}

function persist() {
  saveState(state);
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
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("visible"), 3200);
}

function setRunning(isRunning) {
  els.sendButton.classList.toggle("hidden", isRunning);
  els.stopButton.classList.toggle("hidden", !isRunning);
  els.promptInput.disabled = isRunning;
  els.imageFileInput.disabled = isRunning;
}

function openSettings() {
  els.settingsDrawer.classList.add("open");
  els.settingsDrawer.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
}

function closeSettings() {
  els.settingsDrawer.classList.remove("open");
  els.settingsDrawer.setAttribute("aria-hidden", "true");
  els.overlay.hidden = true;
}

function toggleModelDropdown() {
  const isOpen = !els.modelDropdown.classList.contains("hidden");
  els.modelDropdown.classList.toggle("hidden", isOpen);
  if (!isOpen) {
    els.modelInput.value = "";
    renderModelCatalog();
    els.modelInput.focus();
  }
}

function closeModelDropdown() {
  els.modelDropdown.classList.add("hidden");
}

function toggleImageAttach() {
  els.imageAttach.classList.toggle("hidden");
  if (!els.imageAttach.classList.contains("hidden")) {
    els.imageFileInput.focus();
  }
}

function renderBaseUrls() {
  els.baseUrlInput.innerHTML = serverConfig.allowedBaseUrls
    .map((url) => `<option value="${escapeHtml(url)}">${escapeHtml(url)}</option>`)
    .join("");
}

function selectedModel() {
  return models.find((model) => model.id === state.settings.model);
}

function canLoadModels() {
  return Boolean(state.settings.apiKey || serverConfig.serverApiKeyConfigured);
}

function renderModelCatalog() {
  const query = els.modelInput.value.trim().toLowerCase();
  const visibleModels = models
    .filter((model) => {
      const haystack = `${model.id} ${model.name || ""} ${model.quantization || ""}`.toLowerCase();
      return !query || haystack.includes(query);
    })
    .slice(0, 80);

  if (modelsLoading) {
    els.modelStatus.textContent = "Loading CrofAI models...";
  } else if (!canLoadModels()) {
    els.modelStatus.textContent = "Connect a CrofAI key to load live models.";
  } else if (lastModelRefresh) {
    els.modelStatus.textContent = `${models.length} live models · updated ${lastModelRefresh}`;
  } else {
    els.modelStatus.textContent = "Models have not been loaded yet.";
  }

  if (!visibleModels.length) {
    els.modelCatalog.innerHTML = `<div class="model-empty">${models.length ? "No models match your search." : "No models loaded."}</div>`;
    return;
  }

  els.modelCatalog.innerHTML = visibleModels
    .map((model) => renderModelOption(model, model.id === state.settings.model))
    .join("");
}

function renderModelOptions() {
  els.modelOptions.innerHTML = models
    .map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name || model.id)}</option>`)
    .join("");
  els.modelDetails.innerHTML = renderModelDetails(selectedModel());

  const modelName = state.settings.model || "CrofAI";
  els.modelLabel.textContent = modelName;
  els.promptInput.placeholder = `Message ${modelName}`;
  renderModelCatalog();
}

function renderConversationList() {
  els.conversationList.innerHTML = state.conversations
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((conversation) => {
      const active = conversation.id === state.activeConversationId ? "active" : "";
      return `
        <button class="conversation-item ${active}" type="button" data-chat-id="${escapeHtml(conversation.id)}">
          <span>${escapeHtml(conversation.title)}</span>
        </button>
      `;
    })
    .join("");
}

function renderToolCalls(message) {
  if (!message.toolCalls?.length) return "";

  return `
    <div class="tool-call-list">
      ${message.toolCalls
        .map((call) => `
          <details class="tool-call" open>
            <summary>${escapeHtml(call.function?.name || "Tool call")}</summary>
            <pre><code>${escapeHtml(call.function?.arguments || "")}</code></pre>
          </details>
        `)
        .join("")}
    </div>
  `;
}

function renderMessages() {
  const conversation = activeConversation();

  if (!conversation.messages.length) {
    const greeting = getGreeting();
    els.messages.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
        <h1>${greeting}</h1>
      </div>
    `;
    return;
  }

  els.messages.innerHTML = conversation.messages
    .map((message) => `
      <article class="message ${message.role}">
        <div class="message-avatar">${message.role === "user" ? "U" : "C"}</div>
        <div class="message-body">
          <div class="message-meta">
            <strong>${message.role === "user" ? "You" : "CrofAI"}</strong>
            ${message.model ? `<span>${escapeHtml(message.model)}</span>` : ""}
          </div>
          ${
            message.reasoning
              ? `<details class="reasoning" open><summary>Reasoning</summary><div>${renderContent(message.reasoning)}</div></details>`
              : ""
          }
          <div class="message-content">${renderContent(message.content)}</div>
          ${renderToolCalls(message)}
          ${message.error ? `<div class="message-error">${escapeHtml(message.error)}</div>` : ""}
          ${message.stopped ? `<div class="message-note">Stopped</div>` : ""}
        </div>
      </article>
    `)
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

function renderImages() {
  els.imageList.innerHTML = activeImages
    .map((image, index) => `
      <button class="image-chip" type="button" data-image-index="${index}" title="Remove ${escapeHtml(image.name)}">
        <img src="${escapeHtml(image.dataUrl)}" alt="">
        <span>${escapeHtml(image.name)}</span>
        <strong>&times;</strong>
      </button>
    `)
    .join("");
}

function renderSettings() {
  els.apiKeyInput.value = state.settings.apiKey;
  els.rememberKeyInput.checked = state.settings.rememberKey;
  els.baseUrlInput.value = state.settings.baseUrl;
  els.temperatureInput.value = state.settings.temperature;
  els.topPInput.value = state.settings.top_p;
  els.maxTokensInput.value = state.settings.max_tokens;
  els.seedInput.value = state.settings.seed;
  els.stopInput.value = state.settings.stop;
  els.systemPromptInput.value = state.settings.systemPrompt;
  els.toolsInput.value = state.settings.toolsText;
}

function updateSendButton() {
  const hasContent = els.promptInput.value.trim().length > 0 || activeImages.length > 0;
  els.sendButton.classList.toggle("active", hasContent);
}

function renderAll() {
  renderBaseUrls();
  renderModelOptions();
  renderConversationList();
  renderMessages();
  renderImages();
  renderSettings();
  updateSendButton();
}

async function loadModels({ quiet = false } = {}) {
  if (!canLoadModels()) {
    models = [];
    lastModelRefresh = "";
    renderModelOptions();
    if (!quiet) showToast("Add your CrofAI API key first.");
    return;
  }

  modelsLoading = true;
  renderModelCatalog();

  try {
    const payload = await fetchModels(state.settings);
    models = normalizeModelList(payload);
    lastModelRefresh = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    if (!state.settings.model && models[0]) {
      state.settings.model = models[0].id;
    } else if (state.settings.model && models.length && !models.some((model) => model.id === state.settings.model)) {
      state.settings.model = models[0].id;
    }

    renderModelOptions();
    renderSettings();
    persist();
    if (!quiet) showToast(models.length ? "Models refreshed." : "No models returned.");
  } catch (error) {
    if (!quiet) showToast(error.message);
  } finally {
    modelsLoading = false;
    renderModelOptions();
  }
}

function scheduleModelRefresh() {
  window.clearTimeout(modelRefreshTimer);
  modelRefreshTimer = window.setTimeout(() => {
    if (state.settings.apiKey || serverConfig.serverApiKeyConfigured) {
      loadModels({ quiet: true });
    }
  }, 450);
}

function updateSetting(key, value) {
  state.settings[key] = value;
  persist();
  renderSettings();
}

function startModelAutoRefresh() {
  window.clearInterval(modelAutoRefreshTimer);
  modelAutoRefreshTimer = window.setInterval(() => {
    if (canLoadModels() && !document.hidden) {
      loadModels({ quiet: true });
    }
  }, 5 * 60 * 1000);
}

function addConversation() {
  const conversation = createConversation();
  state.conversations.unshift(conversation);
  state.activeConversationId = conversation.id;
  activeImages = [];
  persist();
  renderAll();
  els.promptInput.focus();
  document.body.classList.remove("sidebar-open");
}

function applyComposerHeight() {
  els.promptInput.style.height = "auto";
  els.promptInput.style.height = `${Math.min(200, els.promptInput.scrollHeight)}px`;
}

const maxImageBytes = 6 * 1024 * 1024;
const maxImageCount = 4;
const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!supportedImageTypes.has(file.type)) {
      reject(new Error(`${file.name} is not a supported image type.`));
      return;
    }

    if (file.size > maxImageBytes) {
      reject(new Error(`${file.name} is larger than 6 MB.`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name || "Pasted image",
        type: file.type,
        size: file.size,
        dataUrl: String(reader.result || "")
      });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function addImageFiles(files) {
  const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;

  const remainingSlots = maxImageCount - activeImages.length;
  if (remainingSlots <= 0) {
    showToast(`You can attach up to ${maxImageCount} images.`);
    return;
  }

  const selectedFiles = imageFiles.slice(0, remainingSlots);
  try {
    const images = await Promise.all(selectedFiles.map(readImageFile));
    activeImages.push(...images);
    if (imageFiles.length > selectedFiles.length) {
      showToast(`Attached ${selectedFiles.length}; limit is ${maxImageCount} images.`);
    }
  } catch (error) {
    showToast(error.message);
  }

  renderImages();
  updateSendButton();
}

async function sendPrompt() {
  const text = els.promptInput.value;
  if (!text.trim() && !activeImages.length) return;

  if (!state.settings.model.trim()) {
    showToast("Pick a CrofAI model first.");
    openSettings();
    return;
  }

  let payload;
  const conversation = activeConversation();
  const userMessage = createUserMessage(buildUserContent(text, activeImages));
  const assistantMessage = createAssistantMessage(state.settings.model.trim());

  conversation.messages.push(userMessage, assistantMessage);
  conversation.title = conversation.messages.length === 2 ? titleFromMessage(userMessage.content) : conversation.title;
  conversation.updatedAt = new Date().toISOString();

  els.promptInput.value = "";
  activeImages = [];
  applyComposerHeight();
  renderAll();
  persist();

  try {
    payload = buildChatPayload(conversation, assistantMessage, state.settings);
  } catch (error) {
    assistantMessage.error = error.message;
    renderMessages();
    persist();
    return;
  }

  abortController = new AbortController();
  setRunning(true);

  try {
    await streamChat(payload, state.settings, {
      signal: abortController.signal,
      onEvent: (event) => {
        applyStreamEvent(assistantMessage, event);
        conversation.updatedAt = new Date().toISOString();
        queueRenderMessages();
        persist();
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      assistantMessage.stopped = true;
    } else {
      assistantMessage.error = error.message;
    }
  } finally {
    abortController = null;
    setRunning(false);
    conversation.updatedAt = new Date().toISOString();
    renderAll();
    persist();
  }
}

function bindEvents() {
  els.newChatButton.addEventListener("click", addConversation);
  els.settingsButton.addEventListener("click", openSettings);
  els.settingsButtonAlt.addEventListener("click", openSettings);
  els.closeSettingsButton.addEventListener("click", closeSettings);
  els.overlay.addEventListener("click", closeSettings);

  els.sidebarButton.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-expanded");
  });

  els.modelButton.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleModelDropdown();
  });

  els.imageToggle.addEventListener("click", toggleImageAttach);

  document.addEventListener("click", (e) => {
    if (!els.modelDropdown.contains(e.target) && !els.modelButton.contains(e.target)) {
      closeModelDropdown();
    }
  });

  els.conversationList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-chat-id]");
    if (!item) return;
    state.activeConversationId = item.dataset.chatId;
    document.body.classList.remove("sidebar-open");
    persist();
    renderAll();
  });

  els.modelCatalog.addEventListener("click", (event) => {
    const item = event.target.closest("[data-model-id]");
    if (!item) return;
    updateSetting("model", item.dataset.modelId);
    closeModelDropdown();
    renderModelOptions();
    els.promptInput.focus();
  });

  els.imageList.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-image-index]");
    if (!chip) return;
    activeImages.splice(Number(chip.dataset.imageIndex), 1);
    renderImages();
    updateSendButton();
  });

  els.imageFileInput.addEventListener("change", (event) => {
    addImageFiles(event.target.files);
    event.target.value = "";
  });

  els.sendButton.addEventListener("click", sendPrompt);
  els.stopButton.addEventListener("click", () => abortController?.abort());
  els.refreshModelsButton.addEventListener("click", () => loadModels());

  els.promptInput.addEventListener("input", () => {
    applyComposerHeight();
    updateSendButton();
  });
  els.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  });
  els.promptInput.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    addImageFiles(files);
  });

  els.apiKeyInput.addEventListener("input", (event) => {
    updateSetting("apiKey", event.target.value.trim());
    scheduleModelRefresh();
  });
  els.rememberKeyInput.addEventListener("change", (event) => updateSetting("rememberKey", event.target.checked));
  els.baseUrlInput.addEventListener("change", (event) => {
    updateSetting("baseUrl", event.target.value);
    loadModels({ quiet: true });
  });
  els.modelInput.addEventListener("input", (event) => {
    renderModelCatalog();
  });
  els.modelInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const modelId = event.target.value.trim();
    if (!modelId) return;
    event.preventDefault();
    updateSetting("model", modelId);
    closeModelDropdown();
    renderModelOptions();
  });
  els.temperatureInput.addEventListener("input", (event) => updateSetting("temperature", Number(event.target.value)));
  els.topPInput.addEventListener("input", (event) => updateSetting("top_p", Number(event.target.value)));
  els.maxTokensInput.addEventListener("input", (event) => updateSetting("max_tokens", event.target.value));
  els.seedInput.addEventListener("input", (event) => updateSetting("seed", event.target.value));
  els.stopInput.addEventListener("input", (event) => updateSetting("stop", event.target.value));
  els.systemPromptInput.addEventListener("input", (event) => updateSetting("systemPrompt", event.target.value));
  els.toolsInput.addEventListener("input", (event) => updateSetting("toolsText", event.target.value));
}

async function boot() {
  bindEvents();
  renderAll();
  applyComposerHeight();
  startModelAutoRefresh();

  try {
    serverConfig = { ...serverConfig, ...(await fetchConfig()) };
    if (!serverConfig.allowedBaseUrls.includes(state.settings.baseUrl)) {
      state.settings.baseUrl = serverConfig.defaultBaseUrl;
    }
    renderAll();
    await loadModels({ quiet: true });
  } catch (error) {
    showToast(error.message);
  }
}

boot();
