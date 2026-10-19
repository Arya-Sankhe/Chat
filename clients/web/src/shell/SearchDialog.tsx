export function SearchDialog() {
  return (
    <section className="search-dialog hidden" id="searchDialog" role="dialog" aria-modal="true" aria-label="Search chats" aria-hidden="true">
      <div className="search-dialog-inner">
        <div className="search-dialog-input-wrap">
          <svg className="search-dialog-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {" "}
          <input id="searchChatInput" type="search" autoComplete="off" spellCheck="false" placeholder="Search chats" />
          {" "}
          <button className="search-dialog-close" id="searchDialogClose" type="button" aria-label="Close search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="search-dialog-results" id="searchChatResults" />
        <div className="sr-only" id="searchChatStatus" aria-live="polite" aria-atomic="true" />
      </div>
    </section>
  );
}
