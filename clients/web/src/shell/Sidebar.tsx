export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Navigation">
      <nav className="sidebar-top">
        <div className="sidebar-header">
          <span className="sidebar-brand">Klui</span>
          {" "}
          <button className="sidebar-icon sidebar-toggle" id="sidebarButton" type="button" aria-label="Toggle sidebar" title="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        </div>
        <div className="sidebar-quick">
          <button className="sidebar-nav-item sidebar-new-item" id="newChatButton" type="button" aria-label="New chat" title="New chat">
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
          <button className="sidebar-nav-item sidebar-search-item" id="searchChatsButton" type="button" aria-label="Search chats" title="Search chats">
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
            <button className="sidebar-nav-item sidebar-pin-trigger" id="pinnedChatsButton" type="button" aria-label="Pinned chats" aria-haspopup="menu" aria-expanded="false" title="Pinned chats">
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
            <div className="pinned-popup hidden" id="pinnedPopup" role="menu" aria-label="Pinned chats">
              <div className="pinned-popup-title">Pinned</div>
              <div className="pinned-popup-list" id="pinnedPopupList" />
            </div>
          </div>
        </div>
      </nav>
      <nav className="sidebar-mid" id="sidebarMid" aria-label="Saved conversations">
        <div className="sidebar-section pinned-section hidden" id="pinnedSection">
          <div className="sidebar-section-label">Pinned</div>
          <div id="pinnedConversationList" />
        </div>
        <div className="sidebar-section recents-section">
          <div className="sidebar-section-label">Recents</div>
          <div id="conversationList" />
        </div>
      </nav>
      <div className="guest-login-panel hidden" id="guestLoginPanel">
        <button className="guest-login-btn" id="guestLoginButton" type="button">Log in</button>
      </div>
      <nav className="sidebar-bottom">
        <div className="sidebar-profile-wrap" id="sidebarProfileWrap">
          <button className="sidebar-profile-btn" id="accountButton" type="button" aria-label="Account" aria-haspopup="menu" aria-expanded="false" title="Account">
            <span className="sidebar-profile-avatar" id="profileAvatar">K</span>
            {" "}
            <span className="sidebar-profile-meta" id="profileMeta" aria-hidden="true">
              <span className="sidebar-profile-name" id="profileName" />
              {" "}
              <span className="sidebar-profile-plan" id="profilePlan" />
            </span>
          </button>
          {" "}
          <div className="profile-menu hidden" id="profileMenu" role="menu" aria-label="Account menu">
            <div className="profile-menu-email" id="profileMenuEmail" />
            <div className="profile-menu-usage" id="profileMenuUsage" />
            <div className="profile-menu-actions">
              <button className="profile-menu-item hidden" type="button" id="profileMenuUpgrade" role="menuitem">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
                {" "}
                <span>Upgrade plan</span>
              </button>
              {" "}
              <button className="profile-menu-item" type="button" id="profileMenuSettings" role="menuitem">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
                {" "}
                <span>Settings</span>
              </button>
              {" "}
              <button className="profile-menu-item hidden" type="button" id="profileMenuStorage" role="menuitem">
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
              <button className="profile-menu-item hidden" type="button" id="profileMenuAdmin" role="menuitem">
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
              <button className="profile-menu-item profile-menu-danger" type="button" id="profileMenuSignOut" role="menuitem">
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
