export function createAdminPanel({
  elements,
  state,
  fetchAdminSummary,
  updateAdminSettings,
  approveAdminPayment,
  rejectAdminPayment,
  resolveAdminReport,
  escapeHtml,
  isAdminUser,
  showToast,
  saveSettings,
  syncSettingsInputs
}) {
  let queueTab = "payments";
  function formatAdminCredits(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "0";
    if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (n >= 10) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  function formatAdminDate(value) {
    if (!value) return "Never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Never";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function activeSubscriptionStatus(status) {
    return ["active", "trialing", "testing"].includes(String(status || "").toLowerCase());
  }

  function renderAdminDashboard(summary) {
    const totals = summary?.totals || {};
    const plans = Array.isArray(summary?.plans) ? summary.plans : [];
    const pendingPayments = Array.isArray(summary?.pendingPayments) ? summary.pendingPayments : [];
    const openReports = Array.isArray(summary?.openReports) ? summary.openReports : [];
    const users = Array.isArray(summary?.users) ? summary.users : [];
    const generated = summary?.generatedAt ? new Date(summary.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    elements.adminOutput.innerHTML = `
    <p class="admin-meta">${summary?.cached ? "Cached" : "Fresh"} overview${generated ? ` · ${escapeHtml(generated)}` : ""}</p>
    <div class="admin-stats">
      <div class="admin-stat">
        <div class="admin-stat-value">${Number(totals.users || 0).toLocaleString()}</div>
        <div class="admin-stat-label">users</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-value">${Number(totals.subscribedUsers || 0).toLocaleString()}</div>
        <div class="admin-stat-label">subscribed</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-value">${formatAdminCredits(totals.currentWeekCreditsUsed)}</div>
        <div class="admin-stat-label">week credits</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-value">${formatAdminCredits(totals.totalCreditsUsed)}</div>
        <div class="admin-stat-label">tracked credits</div>
      </div>
    </div>
    <div class="admin-subtitle">Plans</div>
    ${plans.length ? plans.map((plan) => `
      <div class="admin-plan-row">
        <div>
          <div class="admin-row-title">${escapeHtml(plan.name || plan.id || "Plan")}</div>
          <div class="admin-row-sub">${Number(plan.activeUsers || 0).toLocaleString()} active · ${Number(plan.users || 0).toLocaleString()} total</div>
        </div>
        <div class="admin-row-metric">${formatAdminCredits(plan.creditsUsed)} cr</div>
      </div>
    `).join("") : `<div class="admin-row-sub">No plan data yet.</div>`}
    <div class="admin-queue-tabs">
      <button class="admin-queue-tab${queueTab === "payments" ? " active" : ""}" type="button" data-admin-tab="payments">Payments</button>
      <button class="admin-queue-tab${queueTab === "reports" ? " active" : ""}" type="button" data-admin-tab="reports">Reports${openReports.length ? ` (${openReports.length})` : ""}</button>
    </div>
    <div data-admin-panel="payments"${queueTab === "payments" ? "" : " hidden"}>
    ${pendingPayments.length ? pendingPayments.map((payment) => `
      <div class="admin-payment-row">
        <div>
          <div class="admin-row-title" title="${escapeHtml(payment.email || "")}">${escapeHtml(payment.email || "Unknown")}</div>
          <div class="admin-row-sub">${escapeHtml(payment.planName || payment.planId || "Plan")} · ${escapeHtml(payment.referenceCode || "")}</div>
        </div>
        <div class="admin-payment-actions">
          <div class="admin-row-metric">${Number(payment.amountAed || 0).toLocaleString()} AED</div>
          <button class="admin-small-btn" type="button" data-approve-payment="${escapeHtml(payment.id)}">Approve</button>
          <button class="admin-small-btn danger" type="button" data-reject-payment="${escapeHtml(payment.id)}">Reject</button>
        </div>
      </div>
    `).join("") : `<div class="admin-row-sub">No pending Ziina payments.</div>`}
    </div>
    <div data-admin-panel="reports"${queueTab === "reports" ? "" : " hidden"}>
    ${openReports.length ? openReports.map((report) => `
      <div class="admin-payment-row">
        <div>
          <div class="admin-row-title" title="${escapeHtml(report.email || "")}">${escapeHtml(report.email || "Unknown")}</div>
          <div class="admin-row-sub" title="${escapeHtml(report.snippet || "")}">${escapeHtml(report.snippet || "(no text)")}</div>
        </div>
        <div class="admin-payment-actions">
          <div class="admin-row-metric">${escapeHtml(formatAdminDate(report.createdAt))}</div>
          <button class="admin-small-btn" type="button" data-resolve-report="${escapeHtml(report.id)}" data-resolve-status="done">Done</button>
          <button class="admin-small-btn danger" type="button" data-resolve-report="${escapeHtml(report.id)}" data-resolve-status="reported">Reported</button>
        </div>
      </div>
    `).join("") : `<div class="admin-row-sub">No open reports.</div>`}
    <div class="admin-row-sub">CSAM or non-consensual intimate images: file <a href="https://report.cybertip.org/" target="_blank" rel="noopener">NCMEC</a> and UAE police, then tap Reported. That removes the message. Do not tap Done for those.</div>
    </div>
    <div class="admin-subtitle">Top Users</div>
    ${users.length ? users.map((user) => `
      <div class="admin-user-row">
        <div>
          <div class="admin-row-title" title="${escapeHtml(user.email || "")}">${escapeHtml(user.email || "Unknown")}</div>
          <div class="admin-row-sub">${escapeHtml(user.planName || "No plan")} · last use ${escapeHtml(formatAdminDate(user.lastUsageAt))}</div>
        </div>
        <div>
          <div class="admin-row-metric">${formatAdminCredits(user.totalCreditsUsed)} cr</div>
          <div class="admin-status ${activeSubscriptionStatus(user.subscriptionStatus) ? "active" : ""}">${escapeHtml(user.subscriptionStatus || "none")}</div>
        </div>
      </div>
    `).join("") : `<div class="admin-row-sub">No users yet.</div>`}
  `;
  }

  async function loadAdminDashboard() {
    elements.loadAdminButton.disabled = true;
    elements.loadAdminButton.textContent = "Loading...";
    try {
      renderAdminDashboard(await fetchAdminSummary(state.session));
    } catch (err) {
      elements.adminOutput.textContent = err.message;
    } finally {
      elements.loadAdminButton.disabled = false;
      elements.loadAdminButton.textContent = "Refresh dashboard";
    }
  }

  async function saveGlobalSystemPrompt() {
    if (!isAdminUser() || !elements.saveSystemPromptButton) return;
    const systemPrompt = elements.systemPromptInput.value.trim();
    if (!systemPrompt) {
      showToast("System prompt cannot be empty.");
      return;
    }

    elements.saveSystemPromptButton.disabled = true;
    elements.saveSystemPromptButton.textContent = "Saving...";
    try {
      const payload = await updateAdminSettings(state.session, { systemPrompt });
      state.settings.systemPrompt = payload.settings?.systemPrompt || systemPrompt;
      if (state.me) {
        state.me.settings = {
          ...(state.me.settings || {}),
          systemPrompt: state.settings.systemPrompt
        };
      }
      saveSettings();
      syncSettingsInputs();
      showToast("Global system prompt saved.");
    } catch (err) {
      showToast(err.message);
    } finally {
      elements.saveSystemPromptButton.disabled = false;
      elements.saveSystemPromptButton.textContent = "Save global prompt";
    }
  }

  function setAdminQueueTab(tab) {
    queueTab = tab === "reports" ? "reports" : "payments";
    elements.adminOutput?.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.adminTab === queueTab);
    });
    elements.adminOutput?.querySelectorAll("[data-admin-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.adminPanel !== queueTab;
    });
  }

  async function updateAdminPayment(id, action) {
    if (!id) return;
    try {
      if (action === "approve") await approveAdminPayment(state.session, id);
      else await rejectAdminPayment(state.session, id);
      await loadAdminDashboard();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function resolveReport(id, status) {
    if (!id) return;
    try {
      await resolveAdminReport(state.session, id, status);
      await loadAdminDashboard();
    } catch (err) {
      showToast(err.message);
    }
  }

  return {
    renderAdminDashboard,
    loadAdminDashboard,
    saveGlobalSystemPrompt,
    updateAdminPayment,
    setAdminQueueTab,
    resolveReport
  };
}
