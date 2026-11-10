export function StudyCreateDialog() {
  return (
    <dialog className="project-create-dialog" id="studyCreateDialog" aria-labelledby="studyCreateTitle">
      <form method="dialog" id="studyCreateForm">
        <button type="button" className="study-icon-btn study-create-close" id="studyCreateClose" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
        {" "}
        <h2 id="studyCreateTitle">Create flashcards</h2>
        {" "}
        <p id="studyCreateHint">Select the materials to include.</p>
        {" "}
        <div className="dojo-create-body">
          <aside className="dojo-create-sources">
            <label htmlFor="studyCreateSearch">
              {"Sources "}
              <span id="studyCreateCount">Up to 5</span>
            </label>
            {" "}
            <div className="dojo-create-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              {" "}
              <input id="studyCreateSearch" type="search" maxLength={80} autoComplete="off" placeholder="Search sources" />
            </div>
            {" "}
            <div id="studyCreateList" className="study-create-list" />
          </aside>
          <div id="dojoCreateOptions" className="dojo-create-options" />
        </div>
        {" "}
        <div className="project-dialog-actions">
          <div id="studyCreateActions" className="study-create-modes" />
        </div>
      </form>
    </dialog>
  );
}
