export function StudyNoteOverlay() {
  return (
    <dialog className="study-note-overlay hidden" id="studyNoteOverlay" role="dialog" aria-modal="true" aria-labelledby="studyNoteTitle" aria-hidden="true">
      <div className="study-note-panel">
        <header>
          <h2 id="studyNoteTitle">Note</h2>
          <div className="study-note-actions">
            <button className="study-icon-btn" id="studyNoteCopy" type="button" aria-label="Copy note">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
            {" "}
            <div className="study-note-download-wrap">
              <button className="document-viewer-action" id="studyNoteDownload" type="button" aria-haspopup="menu" aria-expanded="false">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v12M7 10l5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
                {" "}
                <span>Download</span>
                {" "}
                <span className="document-download-chevron">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              </button>
              {" "}
              <div className="document-download-menu hidden" id="studyNoteDownloadMenu" role="menu">
                <button type="button" role="menuitem" data-study-note-export="pdf">
                  <span>PDF</span>
                  <small>.pdf</small>
                </button>
                {" "}
                <button type="button" role="menuitem" data-study-note-export="docx">
                  <span>Word</span>
                  <small>.docx</small>
                </button>
                {" "}
                <button type="button" role="menuitem" data-study-note-export="md">
                  <span>Markdown</span>
                  <small>.md</small>
                </button>
              </div>
            </div>
            {" "}
            <button className="study-icon-btn" id="studyNoteClose" type="button" aria-label="Close note">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>
        <div className="study-note-body" id="studyNoteBody" />
      </div>
    </dialog>
  );
}
