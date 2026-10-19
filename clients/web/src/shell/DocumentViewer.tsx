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
            <div className="document-viewer-meta" id="documentViewerMeta" />
          </div>
        </div>
        <div className="document-viewer-actions">
          <button className="document-viewer-action hidden" id="documentViewerDownload" type="button" aria-haspopup="menu" aria-expanded="false" hidden>Download</button>
          {" "}
          <div className="document-download-menu hidden" id="documentViewerDownloadMenu" role="menu">
            <button type="button" role="menuitem" data-document-export="pdf">
              <span>PDF</span>
              <small>.pdf</small>
            </button>
            {" "}
            <button type="button" role="menuitem" data-document-export="docx">
              <span>Word</span>
              <small>.docx</small>
            </button>
            {" "}
            <button type="button" role="menuitem" data-document-export="md">
              <span>Markdown</span>
              <small>.md</small>
            </button>
          </div>
          {" "}
          <button className="document-viewer-icon-action" id="documentViewerFullscreen" type="button" aria-label="Enter full screen" title="Enter full screen" />
          {" "}
          <button className="document-viewer-close" id="documentViewerClose" type="button" aria-label="Close viewer" title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>
      <div className="document-viewer-body" id="documentViewerBody">
        <div className="document-viewer-empty">Select a generated document to preview.</div>
      </div>
    </aside>
  );
}
