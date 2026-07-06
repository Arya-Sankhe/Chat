export function createCompareController({
  elements,
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
}) {
  function compareModelAlias(index) {
    return `Model ${String.fromCharCode(65 + index)}`;
  }

  function selectedCompareModelIds() {
    const fixedIds = state.settings.compareMode === "council" ? DEFAULT_COUNCIL_MODELS : DEFAULT_COMPARE_MODELS;
    const ids = state.settings.compareEnabled ? fixedIds : (Array.isArray(state.settings.compareModels) ? state.settings.compareModels : []);
    const unique = ids.filter((id, index) => id && ids.indexOf(id) === index);
    return unique.slice(0, state.settings.compareMode === "council" ? 4 : 2);
  }

  function activeCompareModelIds() {
    const ids = selectedCompareModelIds();
    return state.settings.compareEnabled && ids.length >= 2 ? ids : [];
  }

  function seedCompareModels() {
    return state.settings.compareMode === "council" ? DEFAULT_COUNCIL_MODELS : DEFAULT_COMPARE_MODELS;
  }

  function closeCompareContextBanner() {
    elements.compareContextBanner.classList.add("hidden");
  }

  function syncCompareContextBanner(modelIds = selectedCompareModelIds()) {
    closeCompareContextBanner();
  }

  function closeCompareDropdown() {
    elements.compareDropdown.classList.add("hidden");
    elements.compareButton.setAttribute("aria-expanded", "false");
    elements.compareWrap.classList.remove("is-open");
  }

  function cancelCompareMode() {
    state.compareDescribeImages = false;
    updateSetting("compareEnabled", false);
    updateSetting("compareModels", []);
    closeCompareDropdown();
    closeCompareContextBanner();
    renderCompareControls();
  }

  async function activateCompareMode() {
    updateSetting("compareMode", "compare");
    updateSetting("compareModels", DEFAULT_COMPARE_MODELS);
    updateSetting("compareEnabled", true);
    state.compareDescribeImages = false;
    renderCompareControls();
  }

  function seedCompareModelsForDropdown() {
    if (selectedCompareModelIds().length) return;
    const seeded = seedCompareModels();
    updateSetting("compareModels", seeded);
    updateSetting("compareEnabled", seeded.length >= 2);
  }

  function toggleCompareDropdown() {
    const isOpen = !elements.compareDropdown.classList.contains("hidden");
    elements.compareDropdown.classList.toggle("hidden", isOpen);
    const nowOpen = !elements.compareDropdown.classList.contains("hidden");
    elements.compareButton.setAttribute("aria-expanded", String(nowOpen));
    elements.compareWrap.classList.toggle("is-open", nowOpen);
    if (!isOpen) {
      seedCompareModelsForDropdown();
      elements.compareInput.value = "";
      renderCompareCatalog();
      renderCompareControls();
      elements.compareInput.focus();
    }
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
    const query = elements.compareInput.value.trim().toLowerCase();
    const selectedIds = selectedCompareModelIds();
    const visible = state.models
      .filter((m) => {
        const h = `${m.id} ${m.name || ""}`.toLowerCase();
        return !query || h.includes(query);
      })
      .slice(0, 80);

    if (!state.models.length) {
      elements.compareCatalog.innerHTML = `<div class="model-empty">Loading models…</div>`;
      return;
    }

    if (!visible.length) {
      elements.compareCatalog.innerHTML = `<div class="model-empty">No matches.</div>`;
      return;
    }

    elements.compareCatalog.innerHTML = visible
      .map((m) => renderCompareModelOption(m, selectedIds.includes(m.id), selectedIds.length >= 4 && !selectedIds.includes(m.id)))
      .join("");
  }

  function renderCompareControls() {
    if (!elements.compareWrap) return;
    elements.compareWrap.classList.remove("hidden");
    elements.councilWrap?.classList.remove("hidden");
    closeCompareContextBanner();
    closeCompareDropdown();
    const compareActive = Boolean(!state.temporaryChat && state.settings.compareEnabled && state.settings.compareMode !== "council");
    const councilActive = Boolean(!state.temporaryChat && state.settings.compareEnabled && state.settings.compareMode === "council");
    elements.compareButton.classList.toggle("active", compareActive);
    elements.compareButton.classList.remove("council-active");
    elements.compareButton.setAttribute("aria-pressed", String(compareActive));
    elements.compareButton.setAttribute("aria-expanded", "false");
    elements.compareButton.disabled = state.running || state.temporaryChat;
    elements.compareButton.setAttribute("title", state.temporaryChat ? "Temporary chat uses one model" : (compareActive ? "Compare mode on" : "Compare two answers"));
    elements.compareLabel.textContent = compareActive ? "Compare on" : "Compare";
    if (elements.councilButton) {
      elements.councilButton.classList.toggle("active", councilActive);
      elements.councilButton.classList.toggle("council-active", councilActive);
      elements.councilButton.setAttribute("aria-pressed", String(councilActive));
      elements.councilButton.disabled = state.running || state.temporaryChat;
      elements.councilButton.setAttribute("title", state.temporaryChat ? "Temporary chat uses one model" : (councilActive ? "Council mode on" : "Council mode"));
    }
    if (elements.councilLabel) elements.councilLabel.textContent = councilActive ? "Council on" : "Council";
  }

  async function startCompareFreshChat() {
    const compareModels = selectedCompareModelIds();
    const shouldDescribePendingImages = pendingPromptHasImages() && compareIncludesTextOnlyModels(compareModels);
    openNewChat({ replaceUrl: false });
    updateSetting("compareModels", compareModels);
    updateSetting("compareEnabled", compareModels.length >= 2);
    state.messages = [];
    state.compareDescribeImages = shouldDescribePendingImages;
    renderShell();
  }

  function renderCompareResponse(raw, index) {
    const msg = normalizeMessage(raw);
    const rawText = rawTextContent(msg.content);
    const idAttr = msg.id ? ` data-message-id="${escapeHtml(String(msg.id))}"` : "";

    return `
    <section class="compare-response"${idAttr} data-raw-text="${escapeHtml(rawText)}">
      <header class="compare-response-head">
        <strong>${escapeHtml(compareModelAlias(index))}</strong>
        ${rawText.trim() ? `<button class="msg-copy-btn compare-copy-btn" type="button" data-copy-msg aria-label="Copy response" title="Copy response"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span></button>` : ""}
      </header>
      <div class="compare-response-body message-content">${renderAssistantMessageContent(msg)}</div>
    </section>
  `;
  }

  function renderCompareMessage(messages) {
    const sharedCitations = (messages || []).map((m) => renderCitations(m)).find((html) => html);
    return `
    <article class="message assistant compare-message">
      <div class="message-body">
        <div class="compare-message-label">Klui Compare</div>
        <div class="compare-grid">
          ${messages.map((message, index) => renderCompareResponse(message, index)).join("")}
        </div>
        ${sharedCitations ? `<div class="message-footer-sources">${sharedCitations}</div>` : ""}
      </div>
    </article>
  `;
  }

  return {
    compareModelAlias,
    selectedCompareModelIds,
    activeCompareModelIds,
    seedCompareModels,
    closeCompareContextBanner,
    syncCompareContextBanner,
    closeCompareDropdown,
    cancelCompareMode,
    activateCompareMode,
    seedCompareModelsForDropdown,
    toggleCompareDropdown,
    renderCompareCatalog,
    renderCompareControls,
    startCompareFreshChat,
    renderCompareResponse,
    renderCompareMessage
  };
}
