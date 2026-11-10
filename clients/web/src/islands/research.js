import { beginReport, clearReport, reportPayload, settleReport } from "../state/researchReport";

// Island change: the report view is React's (shell/ResearchReportView.tsx).
// Island change: a new run's conversation is added by replacing `state.conversations`
// (a store-owned list) instead of unshift().
export function createResearchController({
  elements,
  state,
  createResearch,
  fetchResearchStatus,
  fetchResearchReport,
  escapeHtml,
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
  renderImages
}) {
  let researchPollTimer = null;
  let researchPollGeneration = 0;

  function researchMeta(message) {
    return message?.metadata?.research || null;
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
      </div>` : "";
    return `
    <div class="research-result ${complete ? "is-complete" : "is-stopped"}" data-research-run="${runId}">
      <p class="research-result-status">${escapeHtml(status)}${details.filter(Boolean).map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</p>
      ${artifact}
      ${note ? `<div class="message-content research-result-summary${summary ? "" : " is-error"}"><p>${escapeHtml(note)}</p></div>` : ""}
    </div>`;
  }

  // The pixel Klui walks along the progress track while the run works, holding something for
  // each phase: a thought while planning, a magnifier while searching, a book while reading,
  // sparkles while analyzing and a pencil while writing. Colors match the composer mascot.
  const RESEARCH_PHASES = ["planning", "searching", "reading", "analyzing", "writing"];
  const rect = (x, y, w, h, fill, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;
  const RESEARCH_KLUI = `<svg class="rk-svg" viewBox="-2 -1 22 13" shape-rendering="crispEdges" aria-hidden="true">
      <g class="rk-prop rk-think" fill="currentColor">${rect(14, 0, 1, 1, "inherit", ' class="rk-dot"')}${rect(16, 0, 1, 1, "inherit", ' class="rk-dot"')}${rect(18, 0, 1, 1, "inherit", ' class="rk-dot"')}</g>
      <g class="rk-prop rk-spark" fill="#f2c14e">
        <g class="rk-star">${rect(2, 0, 0.5, 1.5, "inherit")}${rect(1.5, 0.5, 1.5, 0.5, "inherit")}</g>
        <g class="rk-star">${rect(15.5, -0.5, 0.5, 1.5, "inherit")}${rect(15, 0, 1.5, 0.5, "inherit")}</g>
        <g class="rk-star">${rect(18, 2.5, 0.5, 1.5, "inherit")}${rect(17.5, 3, 1.5, 0.5, "inherit")}</g>
      </g>
      <g class="rk-body" fill="#8fd3fb">
        <g class="rk-leg rk-leg-a">${rect(5, 9.5, 1, 2.5, "inherit")}</g>
        <g class="rk-leg rk-leg-b">${rect(10, 9.5, 1, 2.5, "inherit")}</g>
        ${rect(3, 3.5, 10, 6, "inherit")}${rect(1, 5.5, 2, 2, "inherit")}${rect(13, 5.5, 2, 2, "inherit")}
        <g class="rk-eyes" fill="#16202e">${rect(5, 5, 1, 1.5, "inherit")}${rect(10, 5, 1, 1.5, "inherit")}</g>
      </g>
      <g class="rk-prop rk-lens">${rect(16, 1.5, 2, 2, "#bfe6ff", ' opacity=".7"')}<g fill="#56637f">${rect(16, 0.5, 2, 1, "inherit")}${rect(15, 1.5, 1, 2, "inherit")}${rect(18, 1.5, 1, 2, "inherit")}${rect(16, 3.5, 2, 1, "inherit")}${rect(14.5, 4.5, 1, 1, "inherit")}</g></g>
      <g class="rk-prop rk-book">${rect(3.5, 7, 4.5, 2.5, "#f4efe4")}${rect(8, 7, 4.5, 2.5, "#e9e2d2")}${rect(7.75, 7, 0.5, 2.5, "#b9ad95")}<g fill="#cfc5b0">${rect(4.5, 7.75, 2.5, 0.4, "inherit")}${rect(4.5, 8.5, 2, 0.4, "inherit")}${rect(9, 7.75, 2.5, 0.4, "inherit")}${rect(9, 8.5, 1.5, 0.4, "inherit")}</g></g>
      <g class="rk-prop rk-pencil">${rect(15.5, 3, 1, 1, "#e98c8c")}${rect(15.5, 4, 1, 4, "#f2c14e")}${rect(15.5, 8, 1, 1, "#56637f")}</g>
    </svg>`;

  function researchPhase(research) {
    const phase = String(research.phase || "");
    if (RESEARCH_PHASES.includes(phase)) return phase;
    return research.status === "queued" ? "planning" : "searching";
  }

  function renderResearchCard(msg) {
    const model = researchCardModel(msg);
    const { research, active, label, percent, meta, status } = model;
    if (!active) return renderResearchResult(msg, model);
    const summary = cleanReportSummary(research.summary);
    const note = summary || msg.error || "";
    const progress = Math.max(0.02, percent / 100);
    return `
    <div class="research-card ${status}" data-research-run="${escapeHtml(research.runId || "")}" data-phase="${researchPhase(research)}" style="--research-progress:${progress}">
      <div class="research-card-heading">
        <span class="research-card-kicker">Deep research</span>
        <span class="research-card-meta">${researchMetaMarkup(meta)}</span>
        <button class="research-card-cancel" type="button" data-cancel-research="${escapeHtml(research.runId || "")}">Cancel</button>
      </div>
      ${research.title ? `<strong class="research-card-title">${escapeHtml(research.title)}</strong>` : ""}
      <div class="research-walk" role="progressbar" aria-label="Research progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <span class="research-walk-track" aria-hidden="true"><span></span></span>
        <span class="research-klui" aria-hidden="true"><span class="rk-sprite">${RESEARCH_KLUI}</span></span>
      </div>
      <p class="research-card-status" aria-live="polite"><span class="research-card-label" data-label="${escapeHtml(label)}">${escapeHtml(label)}</span></p>
      ${note ? `<p class="research-card-note">${escapeHtml(note)}</p>` : ""}
    </div>`;
  }

  // Polls refresh the running card in place, so Klui keeps walking instead of remounting every 2s.
  function patchResearchCard(msg) {
    const id = msg?.id ? String(msg.id) : "";
    if (!id || !elements.messages) return false;
    const article = [...elements.messages.querySelectorAll("article.message[data-message-id]")]
      .find((node) => node.dataset.messageId === id);
    const card = article?.querySelector(".research-card.is-active");
    const model = researchCardModel(msg);
    if (!card || !model.active) return false;
    const title = card.querySelector(".research-card-title");
    if (Boolean(title) !== Boolean(model.research.title)) return false;
    // Summary or error text appearing mid-run changes the layout; let the full render handle it.
    const note = cleanReportSummary(model.research.summary) || msg.error || "";
    if ((card.querySelector(".research-card-note")?.textContent || "") !== note) return false;
    if (title && title.textContent !== model.research.title) title.textContent = model.research.title;
    const meta = card.querySelector(".research-card-meta");
    const metaHtml = researchMetaMarkup(model.meta);
    if (meta && meta.innerHTML !== metaHtml) meta.innerHTML = metaHtml;
    card.dataset.phase = researchPhase(model.research);
    const labelEl = card.querySelector(".research-card-label");
    if (labelEl && labelEl.textContent !== model.label) {
      labelEl.textContent = model.label;
      labelEl.dataset.label = model.label;
    }
    const walk = card.querySelector(".research-walk");
    const progress = Math.max(0.02, model.percent / 100);
    if (walk && Number(card.style.getPropertyValue("--research-progress")) < progress) {
      // Klui only walks while it is actually moving forward.
      card.style.setProperty("--research-progress", String(progress));
      card.classList.add("is-walking");
      clearTimeout(card._walkTimer);
      card._walkTimer = setTimeout(() => card.classList.remove("is-walking"), 900);
    }
    walk?.setAttribute("aria-valuenow", String(model.percent));
    return true;
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

  // The report itself is React's (ResearchReportView); this opens, loads and closes it.
  async function openResearchReport(runId, { push = true } = {}) {
    if (!runId || !state.session) return;
    stopResearchPolling();
    beginReport(runId);
    showOnly(elements.researchReportView);
    if (push && window.location.pathname !== `/research/${encodeURIComponent(runId)}`) {
      window.history.pushState({ researchId: runId }, "", `/research/${encodeURIComponent(runId)}`);
    }
    try {
      settleReport(runId, await fetchResearchReport(state.session, runId));
    } catch (error) {
      settleReport(runId, null, error.message);
    }
  }

  async function closeResearchReport({ push = true } = {}) {
    const conversationId = reportPayload()?.run?.conversationId || state.activeConversationId;
    clearReport();
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
        state.conversations = [payload.conversation, ...state.conversations];
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

  return {
    researchMeta,
    renderResearchCard,
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
