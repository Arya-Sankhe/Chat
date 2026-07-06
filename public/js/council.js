export function createCouncilController({
  elements,
  state,
  DEFAULT_COUNCIL_MODELS,
  updateSetting,
  escapeHtml,
  normalizeMessage,
  rawTextContent,
  renderAssistantMessageContent,
  isPlaceholderPeerReason,
  compareModelAlias,
  renderCompareControls
}) {
  let councilDetailsOpenIds = new Set();

  function councilModelAlias(modelId, fallbackIndex = -1) {
    const index = DEFAULT_COUNCIL_MODELS.indexOf(modelId);
    if (index >= 0) return compareModelAlias(index);
    return compareModelAlias(fallbackIndex >= 0 ? fallbackIndex : 0);
  }

  async function activateCouncilMode() {
    updateSetting("compareMode", "council");
    updateSetting("compareModels", DEFAULT_COUNCIL_MODELS);
    updateSetting("compareEnabled", true);
    state.compareDescribeImages = false;
    renderCompareControls();
  }

  function captureCouncilDetailsOpenState() {
    councilDetailsOpenIds = new Set();
    for (const el of elements.messages.querySelectorAll("details.council-details[open][data-council-id]")) {
      councilDetailsOpenIds.add(el.dataset.councilId);
    }
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

  function councilProgressState(council) {
    const panelists = council.panelists || [];
    const total = Math.max(1, panelists.length || DEFAULT_COUNCIL_MODELS.length);
    const completePanelists = panelists.filter((p) => p.finishReason || p.error).length;
    const stage1 = council.stage1Status || "active";
    const stage2 = council.stage2Status || "pending";
    const stage3 = council.stage3Status || "pending";
    let label = "Individual models are answering";
    let percent = Math.max(8, Math.round((completePanelists / total) * 48));

    if (stage3 === "done") {
      label = "Council complete";
      percent = 100;
    } else if (stage3 === "active") {
      label = "Final answer is being written";
      percent = 88;
    } else if (stage2 === "active" || stage2 === "done" || stage2 === "skipped") {
      label = "Answers are being gathered and ranked";
      percent = stage2 === "active" ? 68 : 78;
    } else if (stage1 === "done") {
      label = "Answers are being gathered and ranked";
      percent = 58;
    }

    if (stage1 === "error" || stage2 === "error" || stage3 === "error") {
      label = "Council hit an error";
      percent = Math.max(percent, 50);
    }

    const sub = stage1 === "active"
      ? `${Math.min(completePanelists, total)}/${total} model${total === 1 ? "" : "s"} answered`
      : (stage3 === "done" ? "Final answer ready" : "Reviewing panel answers");
    return { label, sub, percent: Math.max(0, Math.min(100, percent)) };
  }

  function renderCouncilProgress(council) {
    const progress = councilProgressState(council);
    return `
    <div class="council-progress" role="status" aria-live="polite">
      <div class="council-progress-copy">
        <span>${escapeHtml(progress.label)}</span>
        <small>${escapeHtml(progress.sub)}</small>
      </div>
      <div class="council-progress-track" aria-hidden="true">
        <span style="width: ${progress.percent}%"></span>
      </div>
    </div>
  `;
  }

  function renderCouncilPanelist(panelist, index, totalRanked, peerReviewActive = false) {
    const msg = normalizeMessage(panelist);
    const modelId = msg.model || "";
    const modelAlias = councilModelAlias(modelId, index);
    const rawText = rawTextContent(msg.content);
    const idAttr = msg.id ? ` data-message-id="${escapeHtml(String(msg.id))}"` : "";
    const rank = msg.metadata?.council?.peerRank;
    const ballotCount = Number(msg.metadata?.council?.ballotCount || 0);
    const justifications = msg.metadata?.council?.peerJustifications || {};
    const showRank = rank != null && totalRanked > 0 && ballotCount > 0;
    const rankBadge = showRank
      ? `<span class="council-rank-badge rank-${rank}">#${rank}${rank === 1 ? " · Top" : ""}</span>`
      : (peerReviewActive && msg.finishReason && !msg.error ? `<span class="council-rank-pending">Ranking…</span>` : "");
    const justKeys = Object.keys(justifications).filter((reviewerId) => !isPlaceholderPeerReason(justifications[reviewerId]));
    const justBlock = justKeys.length ? `
    <div class="council-justifications">
      <div class="council-justifications-title">Peer notes</div>
      ${justKeys.map((reviewerId) => {
        const reviewer = councilModelAlias(reviewerId);
        return `<div class="council-justification"><strong>${escapeHtml(reviewer)}:</strong> ${escapeHtml(justifications[reviewerId] || "")}</div>`;
      }).join("")}
    </div>` : "";

    return `
    <section class="council-panelist ${showRank && rank === 1 ? "rank-1" : ""}"${idAttr} data-raw-text="${escapeHtml(rawText)}">
      <header class="council-panelist-head">
        <span class="compare-model-mark">
          <span>${escapeHtml(modelAlias.replace("Model ", ""))}</span>
        </span>
        <strong>${escapeHtml(modelAlias)}</strong>
        ${rankBadge}
        ${rawText.trim() ? `<button class="msg-copy-btn compare-copy-btn" type="button" data-copy-msg aria-label="Copy response" title="Copy response"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span></button>` : ""}
      </header>
      <div class="council-panelist-body message-content">${renderAssistantMessageContent(msg)}</div>
      ${justBlock}
    </section>
  `;
  }

  function renderCouncilSynthesis(chairman) {
    if (!chairman) {
      return `<div class="council-synthesis">
      <div class="council-synthesis-head">
        <span>Council Synthesis</span>
      </div>
      <div class="council-synthesis-pending">Waiting for the chairman to synthesize the final answer…</div>
    </div>`;
    }

    const msg = normalizeMessage(chairman);
    const modelId = msg.model || "";
    const rawText = rawTextContent(msg.content);
    const modelName = councilModelAlias(modelId);
    const idAttr = msg.id ? ` data-message-id="${escapeHtml(String(msg.id))}"` : "";

    return `
    <div class="council-synthesis"${idAttr} data-raw-text="${escapeHtml(rawText)}">
      <div class="council-synthesis-head">
        <span>Council Synthesis</span>
        <span class="council-synthesis-model">by ${escapeHtml(modelName)}</span>
        ${rawText.trim() ? `<button class="msg-copy-btn compare-copy-btn" type="button" data-copy-msg aria-label="Copy synthesis" title="Copy synthesis"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span></button>` : ""}
      </div>
      <div class="council-synthesis-body message-content">${renderAssistantMessageContent(msg)}</div>
    </div>
  `;
  }

  function renderCouncilMessage(council) {
    const panelists = council.panelists || [];
    const chairman = council.chairman || null;
    const hasAnyRank = panelists.some((p) => p.metadata?.council?.peerRank != null && Number(p.metadata?.council?.ballotCount || 0) > 0);
    const peerReviewActive = council.stage2Status === "active";
    const peerStatusText = council.peerStatus || "";
    const councilId = String(council.sessionId || council.id || "current-council");
    const detailsOpen = councilDetailsOpenIds.has(councilId) ? " open" : "";

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
        ${renderCouncilProgress(council)}
        ${renderCouncilSynthesis(chairman)}
        <details class="council-details"${detailsOpen} data-council-id="${escapeHtml(councilId)}">
          <summary>
            <span>How the council worked</span>
            <small>${hasAnyRank ? "Rankings and individual answers" : "Individual answers and review progress"}</small>
          </summary>
          <div class="council-details-body">
            ${renderCouncilStages(council)}
            ${peerStatusText ? `<div class="council-peer-status">${escapeHtml(peerStatusText)}</div>` : ""}
            <div class="council-section-label">Individual answers</div>
            <div class="council-panel-grid">
              ${panelists.map((p, idx) => renderCouncilPanelist(p, idx, hasAnyRank ? panelists.length : 0, peerReviewActive)).join("")}
            </div>
          </div>
        </details>
      </div>
    </article>
  `;
  }

  return {
    councilModelAlias,
    activateCouncilMode,
    captureCouncilDetailsOpenState,
    renderCouncilMessage
  };
}
