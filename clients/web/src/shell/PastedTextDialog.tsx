export function PastedTextDialog() {
  return (
    <section className="pasted-text-dialog hidden" id="pastedTextDialog" role="dialog" aria-modal="true" aria-labelledby="pastedTextDialogTitle">
      <div className="pasted-text-dialog-card">
        <header>
          <div>
            <h2 id="pastedTextDialogTitle">Pasted content</h2>
            <p id="pastedTextDialogMeta" />
          </div>
          {" "}
          <button id="pastedTextDialogClose" type="button" aria-label="Close pasted content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <pre id="pastedTextDialogBody" />
      </div>
    </section>
  );
}
