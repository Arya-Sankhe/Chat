export function ProjectCreateDialog() {
  return (
    <dialog className="project-create-dialog" id="projectCreateDialog" aria-labelledby="projectCreateTitle">
      <form method="dialog" id="projectCreateForm">
        <div className="project-dialog-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
        </div>
        {" "}
        <h2 id="projectCreateTitle">Create a project</h2>
        {" "}
        <p>Keep related chats, instructions, and files together.</p>
        {" "}
        <label htmlFor="projectNameInput">Project name</label>
        {" "}
        <input id="projectNameInput" maxLength={80} autoComplete="off" placeholder="e.g. Product launch" />
        {" "}
        <div className="project-dialog-actions">
          <button type="button" id="projectCreateCancel">Cancel</button>
          {" "}
          <button type="submit" className="project-dialog-primary">Create project</button>
        </div>
      </form>
    </dialog>
  );
}
