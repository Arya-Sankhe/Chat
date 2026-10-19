export function ConfirmDialog() {
  return (
    <section className="confirm-dialog" id="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmBody" aria-hidden="true">
      <button className="confirm-close" id="confirmCloseButton" type="button" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </svg>
      </button>
      {" "}
      <div className="confirm-copy">
        <h2 id="confirmTitle">Delete chat?</h2>
        <p id="confirmBody">This conversation will be removed from your account.</p>
      </div>
      {" "}
      <div className="confirm-actions">
        <button className="confirm-cancel" id="confirmCancelButton" type="button">Cancel</button>
        {" "}
        <button className="confirm-danger" id="confirmDeleteButton" type="button">Delete</button>
      </div>
    </section>
  );
}
