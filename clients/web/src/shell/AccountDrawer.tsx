import { useState } from "react";
import { session } from "../app/runtime";
import { approveAdminPayment, fetchAdminSummary, rejectAdminPayment, resolveAdminReport } from "../islands/api.js";
import { closeAccount, showToast, useApp } from "../state/app";
import { signOutAndReset } from "../state/chat";
import { AccountUsage } from "./Sidebar";

/* The account drawer: who's signed in, their plan and usage, and for admins the
   dashboard (totals, plans, the payment and report queues, top users). */

// Ziina periods end the day before the stored date; Stripe's end on it.
function billingDay(periodEnd: string, provider?: string) {
  return new Date(Date.parse(periodEnd) - (provider === "stripe" ? 0 : 1)).toLocaleDateString(undefined, { timeZone: "Asia/Dubai", month: "short", day: "numeric", year: "numeric" });
}

function AccountInfo() {
  const me = useApp((s) => s.me);
  const sub = me?.subscription;
  return (
    <div className="account-info" id="accountInfo">
      <div className="account-label">{me?.user?.email || "Signed in"}</div>
      <p className="account-detail">Plan: {me?.plan?.name || "No active plan"}</p>
      <p className="account-detail">Access: {sub?.status || me?.access?.mode || "none"}</p>
      {sub?.currentPeriodEnd && <p className="account-detail">{sub.cancelAtPeriodEnd ? "Ends" : "Renews"}: {billingDay(sub.currentPeriodEnd, sub.provider)}</p>}
      <AccountUsage />
    </div>
  );
}

function formatCredits(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (n >= 10) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatDate(value: unknown) {
  if (!value) return "Never";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const count = (value: unknown) => Number(value || 0).toLocaleString();
const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const activeStatus = (status: unknown) => ["active", "trialing", "testing"].includes(String(status || "").toLowerCase());

function Row({ title, sub, hint, children, className = "admin-payment-row" }: { title: string; sub: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div>
        <div className="admin-row-title" title={hint}>{title}</div>
        <div className="admin-row-sub">{sub}</div>
      </div>
      {children}
    </div>
  );
}

function AdminDashboard({ summary, reload }: { summary: any; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<"payments" | "reports">("payments");
  const totals = summary?.totals || {};
  const plans = list(summary?.plans);
  const payments = list(summary?.pendingPayments);
  const reports = list(summary?.openReports);
  const users = list(summary?.users);
  const generated = summary?.generatedAt ? new Date(summary.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  // Each queue action refreshes the dashboard; a failure is a toast.
  const act = async (run: () => Promise<unknown>) => {
    try {
      await run();
      await reload();
    } catch (error: any) {
      showToast(error?.message || "Something went wrong.");
    }
  };
  const stat = (value: string, label: string) => (
    <div className="admin-stat">
      <div className="admin-stat-value">{value}</div>
      <div className="admin-stat-label">{label}</div>
    </div>
  );
  return (
    <>
      <p className="admin-meta">{summary?.cached ? "Cached" : "Fresh"} overview{generated ? ` · ${generated}` : ""}</p>
      <div className="admin-stats">
        {stat(count(totals.users), "users")}
        {stat(count(totals.subscribedUsers), "subscribed")}
        {stat(formatCredits(totals.currentWeekCreditsUsed), "week credits")}
        {stat(formatCredits(totals.totalCreditsUsed), "tracked credits")}
      </div>
      <div className="admin-subtitle">Plans</div>
      {plans.length ? plans.map((plan, index) => (
        <Row key={plan.id || index} className="admin-plan-row" title={plan.name || plan.id || "Plan"} sub={`${count(plan.activeUsers)} active · ${count(plan.users)} total`}>
          <div className="admin-row-metric">{formatCredits(plan.creditsUsed)} cr</div>
        </Row>
      )) : <div className="admin-row-sub">No plan data yet.</div>}
      <div className="admin-queue-tabs" role="tablist" aria-label="Queues">
        <button className={`admin-queue-tab${tab === "payments" ? " active" : ""}`} type="button" role="tab" data-admin-tab="payments" aria-selected={tab === "payments"} onClick={() => setTab("payments")}>Payments</button>
        <button className={`admin-queue-tab${tab === "reports" ? " active" : ""}`} type="button" role="tab" data-admin-tab="reports" aria-selected={tab === "reports"} onClick={() => setTab("reports")}>Reports{reports.length ? ` (${reports.length})` : ""}</button>
      </div>
      <div hidden={tab !== "payments"}>
        {payments.length ? payments.map((payment) => (
          <Row key={payment.id} title={payment.email || "Unknown"} hint={payment.email || ""} sub={`${payment.planName || payment.planId || "Plan"} · ${payment.referenceCode || ""}`}>
            <div className="admin-payment-actions">
              <div className="admin-row-metric">{count(payment.amountAed)} AED</div>
              <button className="admin-small-btn" type="button" onClick={() => act(() => approveAdminPayment(session.current(), payment.id))}>Approve</button>
              <button className="admin-small-btn danger" type="button" onClick={() => act(() => rejectAdminPayment(session.current(), payment.id))}>Reject</button>
            </div>
          </Row>
        )) : <div className="admin-row-sub">No pending Ziina payments.</div>}
      </div>
      <div hidden={tab !== "reports"}>
        {reports.length ? reports.map((report) => (
          <div className="admin-payment-row" key={report.id}>
            <div>
              <div className="admin-row-title" title={report.email || ""}>{report.email || "Unknown"}</div>
              <div className="admin-row-sub" title={report.snippet || ""}>{report.snippet || "(no text)"}</div>
            </div>
            <div className="admin-payment-actions">
              <div className="admin-row-metric">{formatDate(report.createdAt)}</div>
              <button className="admin-small-btn" type="button" onClick={() => act(() => resolveAdminReport(session.current(), report.id, "done"))}>Done</button>
              <button className="admin-small-btn danger" type="button" onClick={() => act(() => resolveAdminReport(session.current(), report.id, "reported"))}>Reported</button>
            </div>
          </div>
        )) : <div className="admin-row-sub">No open reports.</div>}
        <div className="admin-row-sub">CSAM or non-consensual intimate images: file <a href="https://report.cybertip.org/" target="_blank" rel="noopener">NCMEC</a> and UAE police, then tap Reported. That removes the message. Do not tap Done for those.</div>
      </div>
      <div className="admin-subtitle">Top Users</div>
      {users.length ? users.map((user, index) => (
        <Row key={user.id || user.email || index} className="admin-user-row" title={user.email || "Unknown"} hint={user.email || ""} sub={`${user.planName || "No plan"} · last use ${formatDate(user.lastUsageAt)}`}>
          <div>
            <div className="admin-row-metric">{formatCredits(user.totalCreditsUsed)} cr</div>
            <div className={`admin-status${activeStatus(user.subscriptionStatus) ? " active" : ""}`}>{user.subscriptionStatus || "none"}</div>
          </div>
        </Row>
      )) : <div className="admin-row-sub">No users yet.</div>}
    </>
  );
}

function AdminSection() {
  const admin = useApp((s) => s.me?.profile?.role === "admin");
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      setSummary(await fetchAdminSummary(session.current()));
      setError("");
    } catch (failure: any) {
      setError(failure?.message || "Could not load the dashboard.");
    } finally {
      setLoading(false);
    }
  };
  if (!admin) return null;
  return (
    <div className="admin-section" id="adminSection">
      <div className="admin-title">Admin</div>
      <button className="admin-load" id="loadAdminButton" type="button" disabled={loading} onClick={() => void load()}>{loading ? "Loading..." : "Refresh dashboard"}</button>
      <div className="admin-output" id="adminOutput">
        {error || (summary && <AdminDashboard summary={summary} reload={load} />)}
      </div>
    </div>
  );
}

export function AccountDrawer() {
  const open = useApp((s) => s.accountOpen);
  return (
    <aside className={`account-drawer${open ? " open" : ""}`} id="accountDrawer" aria-label="Account" aria-hidden={!open}>
      <div className="drawer-header">
        <strong>Account</strong>
        {" "}
        <button className="drawer-close" id="closeAccountButton" type="button" aria-label="Close account" onClick={closeAccount}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {" "}
      <AccountInfo />
      {" "}
      <button className="signout-btn" id="signOutButton" type="button" onClick={() => void signOutAndReset()}>Sign out</button>
      {" "}
      <AdminSection />
    </aside>
  );
}
