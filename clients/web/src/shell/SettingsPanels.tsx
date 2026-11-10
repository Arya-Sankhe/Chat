import { useEffect, useRef, useState } from "react";
import { session } from "../app/runtime";
import { cancelMamoSubscription, createStripePortal, deleteAccount, downloadAccountData } from "../islands/api.js";
import { isNative, openExternal } from "../islands/platform/index.js";
import { clearMemorySummary, saveMemoryContent, setMemoryEnabled, setMemoryNotice, useAccount, type StorageItem } from "../state/account";
import { loadMe } from "../state/boot";
import { closeAccount, closeSettings, openDeleteConfirm, showToast, useApp } from "../state/app";
import { openConversation, signOutAndReset } from "../state/chat";
import { profileDisplayName } from "./Sidebar";

/* The Storage file list, the Account tab and the Memory tab of Settings. */

export function formatStorageBytes(bytes: unknown) {
  const value = Math.max(0, Number(bytes || 0));
  if (value < 1024 * 1024) return `${Math.max(0, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 * 1024 ? 0 : 1)} GB`;
}

/** Access runs through the end of the Dubai renewal day; Mamo charges on that day, so show it. */
export function billingDay(periodEnd: string, provider?: string) {
  return new Date(Date.parse(periodEnd) - (provider === "stripe" ? 0 : 1)).toLocaleDateString(undefined, { timeZone: "Asia/Dubai", month: "short", day: "numeric", year: "numeric" });
}

function storageItemWhere(item: StorageItem) {
  const where = item.conversationId
    ? (item.conversationTitle ? `Chat ${item.conversationTitle}` : "Chat")
    : item.projectId
      ? (item.projectName ? `Project ${item.projectName}` : "Project")
      : "Not in a chat";
  if (item.status && item.status !== "uploaded") return `${where} · Incomplete upload`;
  return where;
}

function deleteFile(item: StorageItem) {
  const searchNote = item.projectId ? " This also deletes search data for that project file." : "";
  openDeleteConfirm({ title: "Delete file?", body: `Remove "${item.fileName || "this file"}"?${searchNote}`, attachmentId: item.id });
}

function deleteChat(item: StorageItem) {
  if (!item.conversationId) return;
  const title = item.conversationTitle || "New chat";
  const others = Math.max(0, Number(item.siblingCount || 0) - 1);
  const extra = others
    ? ` This also deletes ${others} other file${others === 1 ? "" : "s"} in '${title}' (${formatStorageBytes(item.siblingBytes)} in that chat).`
    : "";
  openDeleteConfirm({ title: "Delete chat?", body: `Delete "${title}" from your account?${extra}`, chatId: item.conversationId });
}

function openChat(item: StorageItem) {
  closeAccount();
  closeSettings();
  void openConversation(item.conversationId!);
}

export function StorageList() {
  const items = useAccount((s) => s.storageItems);
  const message = useAccount((s) => s.storageMessage);
  return (
    <div className="storage-list" id="settingsStorageList">
      {!items ? <p className="storage-list-empty">{message}</p>
        : !items.length ? <p className="storage-list-empty">No files yet.</p>
        : items.map((item) => (
          <div className="storage-row" key={item.id}>
            <div className="storage-row-copy">
              <strong>{item.fileName || "File"}</strong>
              <small>{formatStorageBytes(item.sizeBytes)} · {storageItemWhere(item)}</small>
            </div>
            <div className="storage-row-actions">
              {item.canDelete
                ? <button className="admin-small-btn danger" type="button" onClick={() => deleteFile(item)}>Delete</button>
                : item.conversationId && (
                  <>
                    <button className="admin-small-btn" type="button" onClick={() => openChat(item)}>Open chat</button>
                    <button className="admin-small-btn danger" type="button" onClick={() => deleteChat(item)}>Delete chat</button>
                  </>
                )}
            </div>
          </div>
        ))}
    </div>
  );
}

async function deleteAccountAndReset() {
  const current = session.current();
  if (!current) return;
  try {
    await deleteAccount(current);
    await signOutAndReset();
    showToast("Account deleted.");
  } catch (error: any) {
    showToast(error?.message || "Could not delete account.");
  }
}

async function cancelSubscriptionAndRefresh() {
  const current = session.current();
  if (!current) return;
  try {
    await cancelMamoSubscription(current);
    await loadMe();
    showToast("Subscription will end at period end.");
  } catch (error: any) {
    showToast(error?.message || "Could not cancel subscription.");
  }
}

async function openBillingPortal() {
  try {
    const portal = await createStripePortal(session.current());
    await openExternal(portal.url);
  } catch (error: any) {
    showToast(error?.message || "Could not open billing.");
  }
}

export function AccountPanel({ hidden }: { hidden: boolean }) {
  const signedIn = useApp((s) => s.signedIn);
  const me = useApp((s) => s.me);
  const [exporting, setExporting] = useState(false);
  const sub = me?.subscription;
  const canCancel = signedIn
    && ["mamo", "stripe"].includes(sub?.provider as string)
    && ["active", "trialing", "past_due"].includes(sub?.status as string)
    && !sub?.cancelAtPeriodEnd;
  const showBilling = signedIn && Boolean(me?.billingPortalAvailable) && !isNative();
  const email = (me?.user?.email as string) || "Signed in";
  const exportData = async () => {
    const current = session.current();
    if (!current) return;
    setExporting(true);
    try {
      await downloadAccountData(current);
      showToast("Download started.");
    } catch (error: any) {
      showToast(error?.message || "Could not download your data.");
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="settings-section" data-settings-panel="account" hidden={hidden}>
      {signedIn ? (
        <div className="account-fields" id="settingsAccountFields">
          <div className="account-field">
            <span>Name</span>
            {" "}
            <span id="settingsAccountName">{(me?.user?.name as string) || profileDisplayName(email)}</span>
          </div>
          <div className="account-field">
            <span>Email</span>
            {" "}
            <span id="settingsAccountEmail">{email}</span>
          </div>
          <div className="account-field">
            <span>Download my data</span>
            {" "}
            <button className="account-export-btn" id="exportAccountButton" type="button" disabled={exporting} onClick={() => void exportData()}>Download</button>
          </div>
          <div className={`account-field${canCancel ? "" : " hidden"}`} id="settingsAccountCancelRow">
            <span>{canCancel && sub?.currentPeriodEnd ? `Subscription · renews ${billingDay(sub.currentPeriodEnd as string, sub.provider as string)}` : "Subscription"}</span>
            {" "}
            <button className="account-export-btn" id="cancelSubscriptionButton" type="button" onClick={() => openDeleteConfirm({
              title: "Cancel subscription?",
              body: "You'll keep access until the end of the current period. Then it stops.",
              confirmLabel: "Stop renewal",
              onConfirm: cancelSubscriptionAndRefresh
            })}>Cancel</button>
          </div>
          <div className={`account-field${showBilling ? "" : " hidden"}`} id="settingsAccountBillingRow">
            <span>Billing &amp; invoices</span>
            {" "}
            <button className="account-export-btn" id="billingPortalButton" type="button" onClick={() => void openBillingPortal()}>Manage</button>
          </div>
          <div className="account-field">
            <span>Delete account</span>
            {" "}
            <button className="account-delete-btn" id="deleteAccountButton" type="button" onClick={() => openDeleteConfirm({
              title: "Delete account?",
              body: "This permanently deletes your account, chats, files, and data. This cannot be undone.",
              onConfirm: deleteAccountAndReset
            })}>Delete</button>
          </div>
        </div>
      ) : <p className="memory-empty" id="settingsAccountGuest">Sign in to see your account.</p>}
    </section>
  );
}

export function MemoryPanel({ hidden }: { hidden: boolean }) {
  const memory = useAccount((s) => s.memory);
  const notice = useAccount((s) => s.memoryNotice);
  const busy = useAccount((s) => s.memoryBusy);
  const enabled = Boolean(memory?.enabled);
  // The summary is edited locally until saved, so a reload never eats a draft.
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);
  // Typing on while it saves keeps the newer text as the draft.
  const save = async () => {
    const submitted = draft ?? memory?.content ?? "";
    if (await saveMemoryContent(submitted)) setDraft((current) => (current === submitted ? null : current));
  };
  // Clearing asks once more; the ask lapses after five seconds.
  const clear = async () => {
    clearTimeout(confirmTimer.current);
    if (!confirming) {
      setConfirming(true);
      setMemoryNotice("This permanently removes the whole memory summary.");
      confirmTimer.current = setTimeout(() => setConfirming(false), 5000);
      return;
    }
    setConfirming(false);
    if (await clearMemorySummary()) setDraft(null);
  };
  return (
    <section className="settings-section" data-settings-panel="memory" hidden={hidden}>
      <div className="memory-toggle-card">
        <label className="settings-switch-row" htmlFor="memoryEnabledInput">
          <span>
            <strong>Enable memory</strong>
            {" "}
            <small>Let Klui remember useful details for future chats.</small>
          </span>
          {" "}
          <input id="memoryEnabledInput" type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={(event) => void setMemoryEnabled(event.target.checked)} />
        </label>
      </div>
      <p className="memory-privacy">Memory starts with messages you send after you turn it on. Klui never learns from AI replies, uploaded files, images, tool results, generated documents, or temporary chats.</p>
      {enabled ? (
        <div className="memory-editor" id="memoryEditor">
          <label htmlFor="memoryContentInput">Memory summary</label>
          {" "}
          <textarea id="memoryContentInput" rows={12} maxLength={6000} spellCheck="true" placeholder="Klui keeps a short profile here: who you are, what you are working on, and how you like answers." value={draft ?? memory?.content ?? ""} onChange={(event) => setDraft(event.target.value)} />
          {" "}
          <div className="memory-actions">
            <button className="admin-load danger" id="clearMemoryButton" type="button" disabled={busy} onClick={() => void clear()}>{confirming ? "Confirm clear" : "Clear memory"}</button>
            {" "}
            <button className="admin-load" id="saveMemoryButton" type="button" disabled={busy} onClick={() => void save()}>Save changes</button>
          </div>
        </div>
      ) : <div className="memory-empty" id="memoryEmpty">Turn memory on to start building a private, editable summary from your future messages.</div>}
      <p className="settings-notice" id="memoryNotice" role="status" aria-live="polite">{notice}</p>
    </section>
  );
}
