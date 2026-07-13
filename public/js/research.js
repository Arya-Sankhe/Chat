export function createResearchController({
  elements,
  state,
  createResearch,
  fetchResearchStatus,
  fetchResearchReport,
  escapeHtml,
  renderContent,
  renderMessages,
  renderShell,
  renderResearchMode,
  setRunning,
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
}) {
  let researchPollTimer = null;
  let researchPollGeneration = 0;

  const REPORT_THEME_KEYWORDS = {
    commerce: ["best", "top", "review", "buy", "buying", "price", "cheap", "budget", "worth", " vs ", "deal", "product", "gadget", "headphone", "laptop", "phone", "fragrance", "perfume", "cologne", "skincare", "shoe", "watch", "mattress", "coffee", "brand", "affordable"],
    science: ["study", "studies", "research", "scientist", "clinical", "health", "medical", "disease", "climate", "environment", "species", "brain", "gene", "quantum", "physics", "biology", "chemistry", "nasa", "space", "vaccine", "therapy"],
    tech: ["software", "app ", "ai ", " ai", "model", "llm", "programming", "code", "developer", "api", "framework", "startup", "crypto", "blockchain", "bitcoin", "cybersecurity", "cloud", "database", "github", "javascript", "python"],
    finance: ["market", "stock", "economy", "economic", "inflation", "invest", "finance", "financial", "revenue", "earnings", "gdp", "interest rate", "currency", "valuation", "etf", "trading"],
    culture: ["history", "art", "film", "movie", "music", "album", "travel", "food", "recipe", "book", "novel", "game", "sport", "football", "fashion", "culture", "festival", "museum", "photography"]
  };

  const REPORT_THEME_KICKERS = {
    editorial: "Deep Research",
    commerce: "Buying Guide",
    science: "Research Briefing",
    tech: "Tech Report",
    finance: "Market Briefing",
    culture: "Feature"
  };

  function researchMeta(message) {
    return message?.metadata?.research || null;
  }

  function reportMarkdownWithoutImages(markdown) {
    return String(markdown || "").replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  }

  function pickReportTheme(payload) {
    const haystack = `${payload?.run?.title || ""} ${payload?.run?.summary || ""} ${String(payload?.report || "").slice(0, 2500)}`.toLowerCase();
    let best = "editorial";
    let bestScore = 0;
    for (const [theme, keywords] of Object.entries(REPORT_THEME_KEYWORDS)) {
      let score = 0;
      for (const keyword of keywords) if (haystack.includes(keyword)) score += 1;
      if (score > bestScore) { bestScore = score; best = theme; }
    }
    return best;
  }

  function reportReadingMeta(payload) {
    const words = String(payload?.report || "").trim().split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.round(words / 220));
    const sources = payload?.sources?.length || payload?.run?.sourceCount || 0;
    const stamp = payload?.run?.finishedAt || payload?.run?.createdAt;
    let dateLabel = "";
    if (stamp) {
      const date = new Date(stamp);
      if (!Number.isNaN(date.getTime())) {
        dateLabel = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      }
    }
    return { minutes, sources, dateLabel };
  }

  function stripLeadingH1(markdown) {
    return String(markdown || "").replace(/^\s*#\s+.*(\r?\n)+/, "");
  }

  function cleanReportSummary(text) {
    return String(text || "")
      .replace(/\*\*/g, "")
      .replace(/__/g, "")
      .replace(/^\s*#+\s*/, "")
      .replace(/^\s*executive summary\s*[:.\-]*\s*/i, "")
      .trim();
  }

  function reportMasthead(payload, theme, meta) {
    const fallbackTitle = (String(payload?.report || "").match(/^\s*#\s+(.+)$/m)?.[1] || "Research report").trim();
    const title = (payload?.run?.title || fallbackTitle).trim();
    const metaParts = [`${meta.minutes} min read`, `${meta.sources} ${meta.sources === 1 ? "source" : "sources"}`];
    if (meta.dateLabel) metaParts.push(meta.dateLabel);
    return `
    <header class="report-masthead">
      <p class="report-kicker">${escapeHtml(REPORT_THEME_KICKERS[theme] || REPORT_THEME_KICKERS.editorial)}</p>
      <h1 class="report-title">${escapeHtml(title)}</h1>
      <div class="report-meta">${metaParts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>
    </header>
  `;
  }

  function reportSourceRows(sources) {
    return (sources || []).map((source) => {
      let href = "";
      try {
        const url = new URL(source.url);
        if (["http:", "https:"].includes(url.protocol)) href = url.href;
      } catch {}
      if (!href) return "";
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(source.title || href)}</strong><span>${escapeHtml(new URL(href).hostname.replace(/^www\./, ""))}</span></a>`;
    }).join("");
  }

  function buildReportToc() {
    if (!elements.researchReportArticle || !elements.researchReportToc) return;
    const headings = [...elements.researchReportArticle.querySelectorAll("h2, h3")];
    elements.researchReportToc.innerHTML = headings.map((heading, index) => {
      const id = `report-section-${index + 1}`;
      heading.id = id;
      return `<a class="level-${heading.tagName.toLowerCase()}" href="#${id}">${escapeHtml(heading.textContent || "Section")}</a>`;
    }).join("");
    elements.researchReportToc.classList.toggle("hidden", !headings.length);
  }

  function renderResearchCard(msg) {
    const research = researchMeta(msg) || {};
    const progress = research.progress || {};
    const active = ["queued", "running"].includes(research.status);
    const complete = research.status === "succeeded" || Boolean(research.partial);
    const label = progress.label || (active ? "Preparing research" : research.status === "cancelled" ? "Research cancelled" : "Research stopped");
    const percent = Math.max(0, Math.min(100, Number(progress.percent || (complete ? 100 : 0))));
    const elapsed = research.elapsedMs ? `${Math.max(1, Math.round(research.elapsedMs / 1000))}s` : "";
    const icon = complete
      ? `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 10.2 2.8 2.8 6.2-6.2"/></svg>`
      : "";
    return `
    <div class="research-card ${active ? "is-active" : complete ? "is-complete" : "is-stopped"}">
      <div class="research-card-main">
        <div class="research-card-heading">
          <span class="research-card-icon" aria-hidden="true">${icon}</span>
          <span class="research-card-kicker">Deep research</span>
        </div>
        <strong>${escapeHtml(research.title || label)}</strong>
        ${cleanReportSummary(research.summary) ? `<p>${escapeHtml(cleanReportSummary(research.summary))}</p>` : msg.error ? `<p>${escapeHtml(msg.error)}</p>` : ""}
        ${active ? `<div class="research-card-progress"><span style="--research-progress:${percent / 100}"></span></div>` : ""}
        <div class="research-card-footer">
          <div class="research-card-meta">
            ${research.sourceCount ? `<span>${research.sourceCount} sources</span>` : ""}
            ${elapsed ? `<span>${elapsed}</span>` : ""}
            ${research.partial ? "<span>Partial report</span>" : ""}
          </div>
          <div class="research-card-actions">
            ${complete ? `<button type="button" data-open-research="${escapeHtml(research.runId || "")}">Open report <span aria-hidden="true">→</span></button>` : ""}
            ${active ? `<button class="secondary" type="button" data-cancel-research="${escapeHtml(research.runId || "")}">Cancel</button>` : ""}
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderResearchReport() {
    const payload = state.researchReport;
    if (!payload) return;
    const theme = pickReportTheme(payload);
    elements.researchReportView.dataset.reportTheme = theme;
    const meta = reportReadingMeta(payload);
    const markdown = stripLeadingH1(reportMarkdownWithoutImages(payload.report));
    elements.researchReportArticle.innerHTML = reportMasthead(payload, theme, meta) + renderContent(markdown);
    elements.researchReportArticle.querySelectorAll("img").forEach((image) => image.remove());
    elements.researchReportSources.innerHTML = reportSourceRows(payload.sources);
    elements.researchReportSourcesSummary.textContent = `Sources (${payload.sources?.length || 0})`;
    elements.researchReportLoading.classList.add("hidden");
    elements.researchReportLayout.classList.remove("hidden");
    buildReportToc();
  }

  function setResearchReportView(mode) {
    const textOnly = mode === "text";
    elements.researchReportView.classList.toggle("text-only", textOnly);
    elements.researchVisualTab.classList.toggle("active", !textOnly);
    elements.researchTextTab.classList.toggle("active", textOnly);
    elements.researchVisualTab.setAttribute("aria-selected", String(!textOnly));
    elements.researchTextTab.setAttribute("aria-selected", String(textOnly));
  }

  function updateResearchMessage(run) {
    const message = state.messages.find((entry) => String(entry.id) === String(run.messageId));
    if (!message) return;
    message.metadata = {
      ...(message.metadata || {}),
      research: {
        ...(message.metadata?.research || {}),
        runId: run.id,
        status: run.status,
        phase: run.phase,
        progress: run.progress || {},
        title: run.title || "",
        summary: run.summary || "",
        sourceCount: run.sourceCount || 0,
        elapsedMs: run.elapsedMs || 0,
        partial: run.partial
      }
    };
    if (run.summary) message.content = run.summary;
    if (run.error?.message) message.error = run.error.message;
  }

  async function pollResearch(runId, failedAttempts = 0, generation = null) {
    // Fresh starts mint a generation; scheduled continuations reuse theirs.
    if (generation == null) {
      generation = ++researchPollGeneration;
    } else if (generation !== researchPollGeneration) {
      return;
    }
    clearTimeout(researchPollTimer);
    researchPollTimer = null;
    if (!runId || !state.session) return;
    try {
      const payload = await fetchResearchStatus(state.session, runId);
      if (generation !== researchPollGeneration) return;
      const run = payload.run;
      updateResearchMessage(run);
      const messageVisible = state.messages.some((entry) => String(entry.id) === String(run.messageId));
      if (messageVisible) renderMessages();
      if (["queued", "running"].includes(run.status)) {
        state.activeResearchId = run.id;
        setRunning(true, run.conversationId);
        researchPollTimer = setTimeout(() => pollResearch(run.id, 0, generation), 2000);
        return;
      }
      state.activeResearchId = "";
      setRunning(false, run.conversationId);
      await Promise.all([loadMe(), loadConversations()]).catch(() => {});
      if (generation !== researchPollGeneration) return;
      if (messageVisible) renderShell();
    } catch (error) {
      if (generation !== researchPollGeneration) return;
      if (failedAttempts < 1 && state.session) {
        researchPollTimer = setTimeout(() => pollResearch(runId, failedAttempts + 1, generation), 2000);
        return;
      }
      state.activeResearchId = "";
      setRunning(false);
      showToast(error.message);
    }
  }

  function stopResearchPolling() {
    clearTimeout(researchPollTimer);
    researchPollTimer = null;
    researchPollGeneration += 1;
    state.activeResearchId = "";
  }

  function abandonResearchPolling() {
    const hadActiveResearch = Boolean(state.activeResearchId);
    stopResearchPolling();
    state.activeResearchId = "";
    if (hadActiveResearch) setRunning(false);
  }

  function isResearchPollingActive() {
    return researchPollTimer !== null;
  }

  function resumeResearchPolling() {
    // Always invalidate any prior chain before inspecting the newly loaded messages.
    stopResearchPolling();
    const running = state.messages.find((message) => {
      const meta = researchMeta(message);
      return meta?.runId && ["queued", "running"].includes(meta.status);
    });
    if (running) {
      state.activeResearchId = running.metadata.research.runId;
      void pollResearch(state.activeResearchId);
      return;
    }
    // Another conversation may still own an active research run; only clear the
    // local stop target. Do not clear a global/composer lock for that other chat.
    state.activeResearchId = "";
  }

  function applyResearchRunUpdate(run) {
    updateResearchMessage(run);
    renderMessages();
  }

  async function openResearchReport(runId, { push = true } = {}) {
    if (!runId || !state.session) return;
    stopResearchPolling();
    state.researchReport = null;
    showOnly(elements.researchReportView);
    setResearchReportView("visual");
    elements.researchReportLoading.textContent = "Loading report...";
    elements.researchReportLoading.classList.remove("hidden");
    elements.researchReportLayout.classList.add("hidden");
    if (push && window.location.pathname !== `/research/${encodeURIComponent(runId)}`) {
      window.history.pushState({ researchId: runId }, "", `/research/${encodeURIComponent(runId)}`);
    }
    try {
      state.researchReport = await fetchResearchReport(state.session, runId);
      renderResearchReport();
    } catch (error) {
      elements.researchReportLoading.textContent = error.message;
    }
  }

  async function closeResearchReport({ push = true } = {}) {
    const conversationId = state.researchReport?.run?.conversationId || state.activeConversationId;
    state.researchReport = null;
    if (push) window.history.pushState({ conversationId }, "", conversationUrl(conversationId));
    showOnly(elements.chatView);
    if (conversationId && state.activeConversationId !== conversationId) {
      state.activeConversationId = conversationId;
      await loadActiveConversation().catch(() => {});
    }
    renderShell();
    resumeResearchPolling();
  }

  async function startDeepResearch(query) {
    if (state.temporaryChat || state.images.length || state.settings.compareEnabled) {
      showToast("Deep Research requires a normal text chat.");
      return;
    }
    try {
      const payload = await createResearch(state.session, {
        query,
        conversationId: state.activeConversationId || undefined,
        model: selectedModelMode() === "pro" ? OPENROUTER_PRO_MODEL : OPENROUTER_TEXT_MODEL,
        temporary: false,
        compare: false,
        council: false,
        hasAttachments: false
      });
      if (!state.activeConversationId) {
        state.activeConversationId = payload.conversation.id;
        state.conversations.unshift(payload.conversation);
        syncConversationUrl();
      }
      state.messages.push(payload.userMessage, payload.assistantMessage);
      state.activeResearchId = payload.run.id;
      state.researchMode = false;
      elements.promptInput.value = "";
      state.pastedText = "";
      applyComposerHeight();
      renderImages();
      renderResearchMode();
      setRunning(true, payload.run.conversationId);
      renderShell();
      await pollResearch(payload.run.id);
    } catch (error) {
      setRunning(false);
      showToast(error.message);
    }
  }

  return {
    researchMeta,
    renderResearchCard,
    renderResearchReport,
    setResearchReportView,
    openResearchReport,
    closeResearchReport,
    stopResearchPolling,
    abandonResearchPolling,
    isResearchPollingActive,
    resumeResearchPolling,
    startDeepResearch,
    applyResearchRunUpdate
  };
}
