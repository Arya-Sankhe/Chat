export function AppUpdateToast() {
  return (
    <div className="toast app-update-toast" id="appUpdateToast" role="alert" aria-live="assertive">
      <span>Klui has updated.</span>
      {" "}
      <button id="appUpdateReload" type="button" aria-label="Reload" title="Reload">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-6.3-8.6" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>
    </div>
  );
}
