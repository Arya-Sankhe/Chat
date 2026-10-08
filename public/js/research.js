export function createResearchController({
  elements,
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
  renderKluiThinkingStatus = null,
  updateKluiBar = null
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

  // Older runs stored summaries hard-cut mid-sentence; end them on the last full one.
  function wholeSentences(text) {
    const value = String(text || "").trim();
    if (!value || /[.!?…:]["')\]*]?$/.test(value)) return value;
    const end = Math.max(value.lastIndexOf(". "), value.lastIndexOf("! "), value.lastIndexOf("? "));
    return end >= value.length * 0.4 ? value.slice(0, end + 1) : `${value.replace(/\s+\S*$/, "")}…`;
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

  function formatElapsed(ms) {
    const seconds = Math.max(1, Math.round(Number(ms || 0) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }

  function researchCardModel(msg) {
    const research = researchMeta(msg) || {};
    const progress = research.progress || {};
    const active = ["queued", "running"].includes(research.status);
    const complete = research.status === "succeeded" || Boolean(research.partial);
    const label = progress.label || (active ? "Preparing research" : research.status === "cancelled" ? "Research cancelled" : "Research stopped");
    const percent = Math.max(0, Math.min(100, Number(progress.percent || (complete ? 100 : 0))));
    const elapsed = research.elapsedMs ? formatElapsed(research.elapsedMs) : "";
    const meta = [
      research.sourceCount ? `${research.sourceCount} source${research.sourceCount === 1 ? "" : "s"}` : "",
      elapsed,
      research.partial ? "Partial report" : ""
    ].filter(Boolean);
    return { research, active, complete, label, percent, meta, status: active ? "is-active" : complete ? "is-complete" : "is-stopped" };
  }

  function researchMetaMarkup(meta) {
    return meta.map((part) => `<span>${escapeHtml(part)}</span>`).join("");
  }

  const REPORT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8Z"/><path d="M14 3v5h5"/><path d="M8.75 12.5h6.5M8.75 16h4.5"/></svg>`;
  const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>`;

  // A finished run reads like any other answer: a quiet status line, the report as a
  // compact file row, then the summary as normal message text.
  function renderResearchResult(msg, { research, complete, label, meta }) {
    const runId = escapeHtml(research.runId || "");
    const elapsed = research.elapsedMs ? formatElapsed(research.elapsedMs) : "";
    const sources = research.sourceCount ? `${research.sourceCount} source${research.sourceCount === 1 ? "" : "s"}` : "";
    const finished = complete && !research.partial;
    const status = finished ? (elapsed ? `Researched ${elapsed}` : "Researched") : label;
    const details = finished ? [sources] : meta.filter((part) => part !== "Partial report");
    const summary = wholeSentences(cleanReportSummary(research.summary));
    const note = summary || msg.error || "";
    const title = research.title || "Research report";
    const artifact = complete && research.runId ? `
      <div class="research-artifact">
        <button class="research-artifact-open" type="button" data-open-research="${runId}" aria-label="Open report: ${escapeHtml(title)}">
          <span class="research-artifact-icon">${REPORT_ICON}</span>
          <span class="research-artifact-info">
            <strong>${escapeHtml(title)}</strong>
            <span>${research.partial ? "Partial research report" : "Deep research report"}</span>
          </span>
        </button>
        <div class="research-artifact-download">
          <button class="research-artifact-action" type="button" data-research-card-download="${runId}" aria-label="Download report" aria-haspopup="menu" aria-expanded="false">${DOWNLOAD_ICON}</button>
          <div class="document-download-menu hidden" role="menu">
            <button type="button" role="menuitem" data-research-card-export="pdf" data-run-id="${runId}"><span>PDF</span><small>.pdf</small></button>
            <button type="button" role="menuitem" data-research-card-export="docx" data-run-id="${runId}"><span>Word</span><small>.docx</small></button>
          </div>
        </div>
      </div>` : "";
    return `
    <div class="research-result ${complete ? "is-complete" : "is-stopped"}" data-research-run="${runId}">
      <p class="research-result-status">${escapeHtml(status)}${details.filter(Boolean).map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</p>
      ${artifact}
      ${note ? `<div class="message-content research-result-summary${summary ? "" : " is-error"}"><p>${escapeHtml(note)}</p></div>` : ""}
    </div>`;
  }

  function renderResearchCard(msg) {
    const model = researchCardModel(msg);
    const { research, active, label, percent, meta, status } = model;
    if (!active) return renderResearchResult(msg, model);
    const summary = cleanReportSummary(research.summary);
    // While it runs, Klui narrates the current phase; the title waits until the plan names it.
    const live = renderKluiThinkingStatus
      ? renderKluiThinkingStatus({ id: `research-${research.runId || msg.id || "run"}` }, { label, active: true })
      : "";
    return `
    <div class="research-card ${status}" data-research-run="${escapeHtml(research.runId || "")}">
      <div class="research-card-main">
        <div class="research-card-heading">
          <span class="research-card-icon" aria-hidden="true">${REPORT_ICON}</span>
          <span class="research-card-kicker">Deep research</span>
          <span class="research-card-meta">${researchMetaMarkup(meta)}</span>
          <button class="research-card-cancel" type="button" data-cancel-research="${escapeHtml(research.runId || "")}">Cancel</button>
        </div>
        ${research.title ? `<strong class="research-card-title">${escapeHtml(research.title)}</strong>` : ""}
        ${live ? `<div class="research-card-live">${live}</div>` : ""}
        ${summary ? `<p>${escapeHtml(summary)}</p>` : msg.error ? `<p>${escapeHtml(msg.error)}</p>` : ""}
        <div class="research-card-progress" role="progressbar" aria-label="Research progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="--research-progress:${percent / 100}"></span></div>
      </div>
    </div>`;
  }

  // Polls refresh the running card in place, so Klui keeps animating instead of remounting every 2s.
  function patchResearchCard(msg) {
    const id = msg?.id ? String(msg.id) : "";
    if (!id || !updateKluiBar) return false;
    const article = [...elements.messages.querySelectorAll("article.message[data-message-id]")]
      .find((node) => node.dataset.messageId === id);
    const card = article?.querySelector(".research-card.is-active");
    const model = researchCardModel(msg);
    if (!card || !model.active) return false;
    const title = card.querySelector(".research-card-title");
    if (Boolean(title) !== Boolean(model.research.title)) return false;
    // Summary or error text appearing mid-run changes the layout; let the full render handle it.
    const note = cleanReportSummary(model.research.summary) || msg.error || "";
    if ((card.querySelector(".research-card-main > p")?.textContent || "") !== note) return false;
    if (title && title.textContent !== model.research.title) title.textContent = model.research.title;
    const meta = card.querySelector(".research-card-meta");
    const metaHtml = researchMetaMarkup(model.meta);
    if (meta && meta.innerHTML !== metaHtml) meta.innerHTML = metaHtml;
    const progress = card.querySelector(".research-card-progress");
    progress?.setAttribute("aria-valuenow", String(model.percent));
    progress?.querySelector("span")?.style.setProperty("--research-progress", String(model.percent / 100));
    const bar = card.querySelector(".klui-bar");
    if (bar) updateKluiBar(bar, { label: model.label, active: true });
    return true;
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
      const message = state.messages.find((entry) => String(entry.id) === String(run.messageId));
      const messageVisible = Boolean(message);
      if (messageVisible && !patchResearchCard(message)) renderMessages();
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
    closeDownloadMenu();
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

  async function startDeepResearch(query, displayQuery = query) {
    if (state.temporaryChat || state.images.length || state.settings.compareEnabled) {
      showToast("Deep Research requires a normal text chat.");
      return;
    }
    try {
      const payload = await createResearch(state.session, {
        query,
        displayQuery,
        conversationId: state.activeConversationId || undefined,
        ...(!state.activeConversationId && state.studyOpen && state.activeCourseId ? { projectId: state.activeCourseId } : {}),
        role: selectedModelMode() === "pro" ? "pro" : "think",
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
      if (elements.promptInput) {
        elements.promptInput.replaceChildren();
        elements.promptInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
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

  function closeDownloadMenu() {
    elements.researchDownloadMenu?.classList.add("hidden");
    elements.researchDownload?.setAttribute("aria-expanded", "false");
  }

  function setDownloadBusy(busy) {
    if (elements.researchDownload) {
      elements.researchDownload.disabled = busy;
      elements.researchDownload.setAttribute("aria-busy", String(busy));
    }
    elements.researchReportView?.querySelector("#researchDownloadStatus")?.classList.toggle("hidden", !busy);
  }

  async function waitForExport(jobId) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const payload = await fetchDocumentJobStatus(state.session, jobId);
      if (payload?.job?.status === "succeeded" && payload.artifact?.attachment_id) return payload.artifact;
      if (["failed", "expired"].includes(payload?.job?.status)) {
        throw new Error(payload.job.error?.message || "Download failed.");
      }
    }
    throw new Error("Download is still processing. Try again shortly.");
  }

  async function exportReportFile(runId, format) {
    const result = await exportResearchReport(state.session, runId, format);
    const artifact = result.artifact || (result.jobId ? await waitForExport(result.jobId) : null);
    if (!artifact?.attachment_id) throw new Error("Download did not return a file.");
    await downloadAttachment(state.session, artifact.attachment_id, artifact.file_name || `research.${format}`);
  }

  async function downloadReport(format) {
    const runId = state.researchReport?.run?.id;
    if (!runId) return;
    if (!state.session?.access_token) return showToast("Please sign in to download.");
    setDownloadBusy(true);
    try {
      await exportReportFile(runId, format);
    } finally {
      setDownloadBusy(false);
    }
  }

  function closeCardDownloadMenus(except = null) {
    elements.messages?.querySelectorAll(".research-artifact-download").forEach((wrap) => {
      if (wrap === except) return;
      wrap.querySelector(".document-download-menu")?.classList.add("hidden");
      wrap.querySelector("[data-research-card-download]")?.setAttribute("aria-expanded", "false");
    });
  }

  // The chat card exports in place; the report view keeps its own header menu.
  async function downloadFromCard(button) {
    const runId = button.dataset.runId;
    const toggle = button.closest(".research-artifact-download")?.querySelector("[data-research-card-download]");
    // aria-disabled (not disabled) keeps keyboard focus on the toggle while it works.
    if (!runId || toggle?.getAttribute("aria-disabled") === "true") return;
    if (!state.session?.access_token) return showToast("Please sign in to download.");
    toggle?.setAttribute("aria-busy", "true");
    toggle?.setAttribute("aria-disabled", "true");
    showToast("Preparing download…");
    try {
      await exportReportFile(runId, button.dataset.researchCardExport);
    } catch (error) {
      showToast(error.message || "Download failed.");
    } finally {
      toggle?.removeAttribute("aria-busy");
      toggle?.removeAttribute("aria-disabled");
    }
  }

  elements.messages?.addEventListener("click", (event) => {
    const exportButton = event.target.closest("[data-research-card-export]");
    if (exportButton) {
      const toggle = exportButton.closest(".research-artifact-download")?.querySelector("[data-research-card-download]");
      closeCardDownloadMenus();
      toggle?.focus();
      void downloadFromCard(exportButton);
      return;
    }
    const toggle = event.target.closest("[data-research-card-download]");
    if (!toggle) return;
    const wrap = toggle.closest(".research-artifact-download");
    const menu = wrap?.querySelector(".document-download-menu");
    if (!menu || toggle.getAttribute("aria-disabled") === "true") return;
    closeCardDownloadMenus(wrap);
    const open = menu.classList.toggle("hidden") === false;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("[role=menuitem]")?.focus();
  });

  // Menu keys: arrows move between items, Escape closes and hands focus back to the toggle.
  elements.messages?.addEventListener("keydown", (event) => {
    const wrap = event.target.closest?.(".research-artifact-download");
    const menu = wrap?.querySelector(".document-download-menu");
    if (!menu || menu.classList.contains("hidden")) return;
    const items = [...menu.querySelectorAll("[role=menuitem]")];
    const index = items.indexOf(event.target);
    if (event.key === "Escape" || event.key === "Tab") {
      closeCardDownloadMenus();
      if (event.key === "Escape") {
        event.preventDefault();
        wrap.querySelector("[data-research-card-download]")?.focus();
      }
      return;
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step || !items.length) return;
    event.preventDefault();
    items[(index + step + items.length) % items.length].focus();
  });

  elements.researchDownload?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!elements.researchDownloadMenu || elements.researchDownload.disabled) return;
    const open = elements.researchDownloadMenu.classList.toggle("hidden") === false;
    elements.researchDownload.setAttribute("aria-expanded", String(open));
  });
  elements.researchDownloadMenu?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-research-export]");
    if (!button) return;
    closeDownloadMenu();
    try {
      await downloadReport(button.dataset.researchExport);
    } catch (error) {
      showToast(error.message || "Download failed.");
    }
  });
  globalThis.document?.addEventListener("pointerdown", (event) => {
    if (!event.target?.closest?.(".research-artifact-download")) closeCardDownloadMenus();
    if (!elements.researchDownloadMenu || elements.researchDownloadMenu.classList.contains("hidden")) return;
    if (elements.researchDownload?.contains(event.target) || elements.researchDownloadMenu.contains(event.target)) return;
    closeDownloadMenu();
  });

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
