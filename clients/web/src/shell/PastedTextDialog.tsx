import { closePastedText, useViewers } from "../state/viewers";

function sizeLabel(value: string) {
  const bytes = new TextEncoder().encode(value).length;
  const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  return `${size} · ${Math.max(1, value.split("\n").length)} lines`;
}

/** A pasted text (or the side chat's context) in full. */
export function PastedTextDialog() {
  const text = useViewers((s) => s.pastedText);
  return (
    <section className={`pasted-text-dialog${text === null ? " hidden" : ""}`} id="pastedTextDialog" role="dialog" aria-modal="true" aria-labelledby="pastedTextDialogTitle" onClick={(event) => { if (event.target === event.currentTarget) closePastedText(); }}>
      <div className="pasted-text-dialog-card">
        <header>
          <div>
            <h2 id="pastedTextDialogTitle">Pasted content</h2>
            <p id="pastedTextDialogMeta">{text === null ? "" : sizeLabel(text)}</p>
          </div>
          {" "}
          <button id="pastedTextDialogClose" type="button" aria-label="Close pasted content" onClick={closePastedText}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <pre id="pastedTextDialogBody">{text || ""}</pre>
      </div>
    </section>
  );
}
