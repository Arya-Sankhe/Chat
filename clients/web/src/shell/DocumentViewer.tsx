/* The document viewer as public/js/documentViewer.js leaves it at startup:
   closed, with its preview toolbar added. The viewer itself arrives with the
   documents slice. */
export function DocumentViewer() {
  return (
    <aside className="document-viewer hidden" id="documentViewer" aria-label="Document viewer">
      <div className="document-viewer-resizer" id="documentViewerResizer" role="separator" aria-orientation="vertical" aria-label="Resize document viewer" />
      <header className="document-viewer-header">
        <div className="document-viewer-title-wrap">
          <span className="document-viewer-file-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
            </svg>
          </span>
          {" "}
          <div className="document-viewer-title-copy">
            <div className="document-viewer-title" id="documentViewerTitle">Document</div>
            <div className="document-viewer-meta" id="documentViewerMeta">Preview</div>
          </div>
        </div>
        <div className="document-viewer-actions">
          <button className="document-viewer-action hidden" id="documentViewerDownload" type="button" aria-haspopup="menu" aria-expanded="false" hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 10l5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            <span>Download</span>
          </button>
          {" "}
          <div className="document-download-menu hidden" id="documentViewerDownloadMenu" role="menu">
            <button type="button" role="menuitem" data-document-export="pdf" hidden>
              <span>PDF</span>
              <small>.pdf</small>
            </button>
            {" "}
            <button type="button" role="menuitem" data-document-export="docx" hidden>
              <span>Word</span>
              <small>.docx</small>
            </button>
            {" "}
            <button type="button" role="menuitem" data-document-export="md" hidden>
              <span>Markdown</span>
              <small>.md</small>
            </button>
          </div>
          {" "}
          <button className="document-viewer-icon-action" id="documentViewerFullscreen" type="button" aria-label="Enter full screen" title="Enter full screen" aria-pressed="false">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
            </svg>
          </button>
          {" "}
          <button className="document-viewer-close" id="documentViewerClose" type="button" aria-label="Close viewer" title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>
      <div className="document-preview-toolbar hidden">
        <div className="document-page-controls" hidden>
          <button type="button" data-pdf-step="-1" aria-label="Previous page" title="Previous page" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m14 7-5 5 5 5" />
            </svg>
          </button>
          {" "}
          <input type="number" min="1" defaultValue="1" aria-label="Page number" inputMode="numeric" max="0" />
          <span className="document-page-total">/ 0</span>
          {" "}
          <button type="button" data-pdf-step="1" aria-label="Next page" title="Next page" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m10 7 5 5-5 5" />
            </svg>
          </button>
        </div>
        <div className="document-preview-tools">
          <label className="document-zoom-control" hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="10" cy="10" r="6" />
              <path d="m15 15 5 5M7 10h6m-3-3v6" />
            </svg>
            <select aria-label="Zoom">
              <option value="1">Fit</option>
              <option value="0.75">75%</option>
              <option value="1.25">125%</option>
              <option value="1.5">150%</option>
              <option value="2">200%</option>
            </select>
          </label>
          {" "}
          <button type="button" data-preview-refresh="" aria-label="Refresh preview" title="Refresh preview">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
            </svg>
          </button>
        </div>
      </div>
      <div className="document-viewer-body" id="documentViewerBody">
        <div className="document-viewer-empty">Select a generated document to preview.</div>
      </div>
    </aside>
  );
}
