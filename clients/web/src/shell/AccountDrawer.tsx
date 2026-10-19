export function AccountDrawer() {
  return (
    <aside className="account-drawer" id="accountDrawer" aria-label="Account" aria-hidden="true">
      <div className="drawer-header">
        <strong>Account</strong>
        {" "}
        <button className="drawer-close" id="closeAccountButton" type="button" aria-label="Close account">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {" "}
      <div className="account-info" id="accountInfo" />
      {" "}
      <button className="signout-btn" id="signOutButton" type="button">Sign out</button>
      {" "}
      <div className="admin-section hidden" id="adminSection">
        <div className="admin-title">Admin</div>
        {" "}
        <button className="admin-load" id="loadAdminButton" type="button">Refresh dashboard</button>
        {" "}
        <div className="admin-output" id="adminOutput" />
      </div>
    </aside>
  );
}
