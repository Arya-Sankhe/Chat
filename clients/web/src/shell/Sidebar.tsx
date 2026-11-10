import { Fragment, useLayoutEffect, useRef, type MouseEvent } from "react";
import type { ConversationSummary } from "@klui/shared";
import {
  NATIVE_APP,
  chatHooks,
  closeProfileMenu,
  hasUpgradePlans,
  openAuthDialog,
  openConfirmDialog,
  openRenameDialog,
  openSearchDialog,
  openSettings,
  setSettingsTab,
  sortedConversations,
  startSidebarLogin,
  toggleConversationMenu,
  togglePinChat,
  togglePinnedPopup,
  toggleProfileMenu,
  toggleSidebar,
  useApp
} from "../state/app";
import { addConversation, openConversation, signOutAndReset } from "../state/chat";
import { cx } from "./cx";
import { MOBILE_AT_LOAD } from "./launch";

export function profileInitials(email: string) {
  const local = String(email || "").split("@")[0] || "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] || ""}${parts[1]![0] || ""}`.toUpperCase();
  if (local.length >= 2) return local.slice(0, 2).toUpperCase();
  if (local.length === 1) return local.toUpperCase();
  return "K";
}

export function profileDisplayName(email: string) {
  return String(email || "").split("@")[0] || "Signed in";
}

const FREE_USAGE_ICONS = {
  messages: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  images: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>
};

function freeResetLabel(resetsAt: string) {
  const minutes = Math.max(1, Math.round((Date.parse(resetsAt) - Date.now()) / 60_000));
  if (!Number.isFinite(minutes)) return "Resets daily";
  return minutes < 60 ? `Resets in ${minutes}m` : `Resets in ${Math.round(minutes / 60)}h`;
}

/** renderFreeUsageMarkup(): today's free messages and image uploads. */
function FreeUsage({ free }: { free: any }) {
  const row = (kind: "messages" | "images", label: string) => {
    const item = free[kind];
    const percent = item.limit > 0 ? Math.min(100, Math.round((item.used / item.limit) * 100)) : 100;
    return (
      <div className="free-usage-row">
        <div className="account-usage-head">
          <span className="account-usage-label"><svg viewBox="0 0 24 24" aria-hidden="true">{FREE_USAGE_ICONS[kind]}</svg>{label}</span>
          {" "}
          <span className="account-usage-value">{item.remaining ? `${item.remaining} left` : "Used up"}</span>
        </div>
        {" "}
        <div className="account-usage-track" role="progressbar" aria-label={`${label} used today`} aria-valuemin={0} aria-valuemax={item.limit} aria-valuenow={item.used}>
          <span className={cx("account-usage-fill", { "is-spent": !item.remaining })} style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  };
  return (
    <div className="account-usage free-usage">
      {row("messages", "Messages")}
      {" "}
      {row("images", "Image uploads")}
      {" "}
      <p className="account-usage-note">Free plan · {freeResetLabel(free.resetsAt)}</p>
    </div>
  );
}

/** renderAccountUsageMarkup(): the weekly usage meter. */
export function AccountUsage() {
  const me = useApp((s) => s.me);
  if (!me?.plan) return null;
  if ((me.plan as any).free) {
    const free = (me.usage as any)?.free;
    return free ? <FreeUsage free={free} /> : null;
  }
  const api = me.usage?.api || {};
  const percent = Math.max(0, Math.min(100, Math.floor(Number(api.percent || 0))));
  const resetLabel = api.weekEnd
    ? `Resets ${new Date(api.weekEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "Resets weekly";
  return (
    <div className="account-usage">
      <div className="account-usage-head">
        <span className="account-usage-label">Weekly usage</span>
        {" "}
        <span className="account-usage-value">{percent}%</span>
      </div>
      {" "}
      <div className="account-usage-track" aria-hidden="true">
        <span className="account-usage-fill" style={{ width: `${percent}%` }} />
      </div>
      {" "}
      <p className="account-usage-note">{resetLabel}</p>
    </div>
  );
}

const MENU_ICON = { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" } as const;

/** renderConversationRow() + conversationMenuMarkup(). */
function ConversationRow({ conversation }: { conversation: ConversationSummary }) {
  const active = useApp((s) => s.activeConversationId === conversation.id);
  const pinned = useApp((s) => s.pinnedChatIds.includes(conversation.id));
  const menuOpen = useApp((s) => s.openConversationMenuId === conversation.id);
  const running = useApp((s) => s.runningChatIds.includes(conversation.id));
  const unread = useApp((s) => !running && s.unreadChatIds.includes(conversation.id));
  const menu = useRef<HTMLDivElement>(null);

  // Flip the menu upward when it would run past the bottom of the list.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!menuOpen || !el) return;
    el.classList.remove("conversation-menu--up");
    const scroller = el.closest(".sidebar-mid");
    if (scroller && el.getBoundingClientRect().bottom > scroller.getBoundingClientRect().bottom) {
      el.classList.add("conversation-menu--up");
    }
  }, [menuOpen]);

  return (
    <div className={`conversation-row ${active ? "active" : ""}`} data-chat-id={conversation.id}>
      <button className="conversation-item" type="button" data-open-chat-id={conversation.id}>
        <span className="conversation-title">{conversation.title || "New chat"}</span>
        {running
          ? <span className="conversation-activity is-running" title="Generating" aria-hidden="true" />
          : unread && <span className="conversation-activity is-done" title="New reply" aria-hidden="true" />}
      </button>
      {" "}
      <div className="conversation-menu-wrap">
        <button className="conversation-menu-btn" type="button" data-toggle-menu-id={conversation.id} aria-label="Chat options" aria-haspopup="menu" aria-expanded={menuOpen ? "true" : "false"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
        </button>
        <div className={cx("conversation-menu", { hidden: !menuOpen })} data-menu-id={conversation.id} role="menu" ref={menu}>
          <button className="conversation-menu-item" type="button" role="menuitem" data-pin-chat-id={conversation.id}>
            <span className="conversation-menu-item-icon"><svg {...MENU_ICON}><line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" /></svg></span>
            {" "}
            <span>{pinned ? "Unpin chat" : "Pin chat"}</span>
          </button>
          {" "}
          <button className="conversation-menu-item" type="button" role="menuitem" data-rename-chat-id={conversation.id}>
            <span className="conversation-menu-item-icon"><svg {...MENU_ICON}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg></span>
            {" "}
            <span>Rename chat</span>
          </button>
          {" "}
          <button className="conversation-menu-item conversation-menu-danger" type="button" role="menuitem" data-delete-chat-id={conversation.id}>
            <span className="conversation-menu-item-icon"><svg {...MENU_ICON}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" /></svg></span>
            {" "}
            <span>Delete chat</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** handleConversationListClick(): one delegated handler, as before. */
export function handleConversationListClick(event: MouseEvent) {
  const target = event.target as Element;
  const menuToggle = target.closest<HTMLElement>("[data-toggle-menu-id]");
  if (menuToggle) {
    event.stopPropagation();
    toggleConversationMenu(menuToggle.dataset.toggleMenuId!);
    return;
  }
  const pin = target.closest<HTMLElement>("[data-pin-chat-id]");
  if (pin) return togglePinChat(pin.dataset.pinChatId!);
  const rename = target.closest<HTMLElement>("[data-rename-chat-id]");
  if (rename) return openRenameDialog(rename.dataset.renameChatId!);
  const del = target.closest<HTMLElement>("[data-delete-chat-id]");
  if (del) return openConfirmDialog(del.dataset.deleteChatId!);
  const open = target.closest<HTMLElement>("[data-open-chat-id]");
  if (open) openConversation(open.dataset.openChatId!);
}

export function Sidebar() {
  const signedIn = useApp((s) => s.signedIn);
  const booted = useApp((s) => s.shellRender > 0);
  const mobile = useApp((s) => s.mobile);
  const me = useApp((s) => s.me);
  const conversations = useApp((s) => s.conversations);
  const pinnedChatIds = useApp((s) => s.pinnedChatIds);
  const pinnedPopupOpen = useApp((s) => s.pinnedPopupOpen);
  const profileMenuOpen = useApp((s) => s.profileMenuOpen);
  const sorted = sortedConversations(conversations);
  const pinned = sorted.filter((conversation) => pinnedChatIds.includes(conversation.id));
  const recent = sorted.filter((conversation) => !pinnedChatIds.includes(conversation.id));
  const email = me?.user?.email || "";
  const closeDrawer = () => useApp.setState({ sidebarOpen: false });

  return (
    <aside className="sidebar" aria-label="Navigation">
      <nav className="sidebar-top">
        <div className="sidebar-header">
          <span className="sidebar-brand">Klui</span>
          {" "}
          <button className="sidebar-icon sidebar-toggle" id="sidebarButton" type="button" aria-label="Toggle sidebar" title="Menu" onClick={toggleSidebar}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
          {/* index.html added this only when the page loaded at phone width. */}
          {MOBILE_AT_LOAD && (
            <button className="sidebar-icon sidebar-close" id="sidebarCloseButton" type="button" aria-label="Close navigation" title="Close" onClick={closeDrawer}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          )}
        </div>
        <div className="sidebar-quick">
          <button className="sidebar-nav-item sidebar-new-item" id="newChatButton" type="button" aria-label="New chat" title="New chat" onClick={() => { closeDrawer(); addConversation(); }}>
            <span className="sidebar-nav-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </span>
            {" "}
            <span className="sidebar-nav-label">New chat</span>
          </button>
          {" "}
          <button className="sidebar-nav-item sidebar-search-item" id="searchChatsButton" type="button" aria-label="Search chats" title="Search chats" onClick={() => { closeDrawer(); openSearchDialog(); }}>
            <span className="sidebar-nav-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            {" "}
            <span className="sidebar-nav-label">Search</span>
          </button>
        </div>
        <div className="sidebar-nav">
          <button className="sidebar-nav-item" id="projectsButton" type="button" hidden aria-label="Projects" title="Projects">
            <span className="sidebar-nav-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
              </svg>
            </span>
            {" "}
            <span className="sidebar-nav-label">Projects</span>
          </button>
          {" "}
          <button className="sidebar-nav-item" id="studyHubButton" type="button" aria-label="Dojo" title="Dojo">
            <span className="sidebar-nav-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10 12 5 2 10l10 5 10-5z" />
                <path d="M6 12v5c2.5 2 9.5 2 12 0v-5" />
                <path d="M22 10v6" />
              </svg>
            </span>
            {" "}
            <span className="sidebar-nav-label">Dojo</span>
          </button>
          {" "}
          <div className="sidebar-pin-wrap" id="sidebarPinWrap">
            <button className="sidebar-nav-item sidebar-pin-trigger" id="pinnedChatsButton" type="button" aria-label="Pinned chats" aria-haspopup="menu" aria-expanded={pinnedPopupOpen ? "true" : "false"} title="Pinned chats" onClick={(event) => { event.stopPropagation(); togglePinnedPopup(); }}>
              <span className="sidebar-nav-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="17" x2="12" y2="22" />
                  <path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17z" />
                </svg>
              </span>
              {" "}
              <span className="sidebar-nav-label">Pinned</span>
            </button>
            {" "}
            <div className={cx("pinned-popup", { hidden: !pinnedPopupOpen })} id="pinnedPopup" role="menu" aria-label="Pinned chats">
              <div className="pinned-popup-title">Pinned</div>
              <div className="pinned-popup-list" id="pinnedPopupList" onClick={handleConversationListClick}>
                {booted && (pinned.length ? pinned.map((conversation) => (
                  <button className="pinned-popup-item" type="button" role="menuitem" data-open-chat-id={conversation.id} key={conversation.id}>
                    <span>{conversation.title || "New chat"}</span>
                  </button>
                )) : <div className="pinned-popup-empty">No pinned chats yet.</div>)}
              </div>
            </div>
          </div>
        </div>
      </nav>
      <nav className="sidebar-mid" id="sidebarMid" aria-label="Saved conversations" onClick={handleConversationListClick}>
        <div className={cx("sidebar-section pinned-section", { hidden: !pinned.length })} id="pinnedSection">
          <div className="sidebar-section-label">Pinned</div>
          <div id="pinnedConversationList">
            {pinned.map((conversation) => <Fragment key={conversation.id}>{" "}<ConversationRow conversation={conversation} />{" "}</Fragment>)}
          </div>
        </div>
        <div className="sidebar-section recents-section">
          <div className="sidebar-section-label">Recents</div>
          <div id="conversationList">
            {recent.map((conversation) => <Fragment key={conversation.id}>{" "}<ConversationRow conversation={conversation} />{" "}</Fragment>)}
          </div>
        </div>
      </nav>
      <div className={cx("guest-login-panel", { hidden: !booted || signedIn })} id="guestLoginPanel">
        <button className="guest-login-btn" id="guestLoginButton" type="button" onClick={startSidebarLogin}>Log in</button>
      </div>
      <nav className="sidebar-bottom">
        <div className="sidebar-profile-wrap" id="sidebarProfileWrap">
          <button className="sidebar-profile-btn" id="accountButton" type="button" aria-label="Account" aria-haspopup={booted && mobile ? "dialog" : "menu"} aria-expanded={profileMenuOpen ? "true" : "false"} title="Account" onClick={(event) => { event.stopPropagation(); toggleProfileMenu(openAuthDialog); }}>
            <span className="sidebar-profile-avatar" id="profileAvatar">{signedIn ? profileInitials(email) : "K"}</span>
            {" "}
            <span className="sidebar-profile-meta" id="profileMeta" aria-hidden={booted && signedIn ? "false" : "true"}>
              <span className="sidebar-profile-name" id="profileName">{signedIn ? (me?.user?.name as string) || profileDisplayName(email) : ""}</span>
              {" "}
              <span className="sidebar-profile-plan" id="profilePlan">{signedIn ? me?.plan?.name || "Free" : ""}</span>
            </span>
          </button>
          {" "}
          <div className={cx("profile-menu", { hidden: !profileMenuOpen })} id="profileMenu" role="menu" aria-label="Account menu">
            <div className="profile-menu-email" id="profileMenuEmail">{signedIn ? email || "Signed in" : ""}</div>
            <div className="profile-menu-usage" id="profileMenuUsage">{signedIn && <AccountUsage />}</div>
            <div className="profile-menu-actions">
              <button className={cx("profile-menu-item", { hidden: !signedIn || NATIVE_APP || !hasUpgradePlans() })} type="button" id="profileMenuUpgrade" role="menuitem" onClick={() => chatHooks.openUpgradePlans()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
                {" "}
                <span>Upgrade plan</span>
              </button>
              {" "}
              <button className="profile-menu-item" type="button" id="profileMenuSettings" role="menuitem" onClick={() => { closeProfileMenu(); openSettings(); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
                {" "}
                <span>Settings</span>
              </button>
              {" "}
              <button className="profile-menu-item hidden" type="button" id="profileMenuStorage" role="menuitem" onClick={() => { closeProfileMenu(); openSettings(); setSettingsTab("storage"); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="22" y1="12" x2="2" y2="12" />
                  <path d="M5.45 5.11 2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
                  <line x1="6" y1="16" x2="6.01" y2="16" />
                  <line x1="10" y1="16" x2="10.01" y2="16" />
                </svg>
                {" "}
                <span>Storage</span>
              </button>
              {" "}
              <button className={cx("profile-menu-item", { hidden: !signedIn || me?.profile?.role !== "admin" })} type="button" id="profileMenuAdmin" role="menuitem" onClick={() => chatHooks.openAdminDrawer()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                {" "}
                <span>Admin</span>
              </button>
              {" "}
              <button className="profile-menu-item profile-menu-danger" type="button" id="profileMenuSignOut" role="menuitem" onClick={() => { closeProfileMenu(); void signOutAndReset(); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                {" "}
                <span>Log out</span>
              </button>
            </div>
          </div>
        </div>
      </nav>
    </aside>
  );
}
