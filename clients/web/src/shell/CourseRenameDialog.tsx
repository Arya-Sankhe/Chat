export function CourseRenameDialog() {
  return (
    <dialog className="project-create-dialog dojo-course-dialog" id="courseRenameDialog" aria-labelledby="courseRenameTitle">
      <form method="dialog" id="courseRenameForm">
        <button type="button" className="dojo-dialog-close" id="courseRenameClose" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
        {" "}
        <h2 id="courseRenameTitle">Rename course</h2>
        {" "}
        <p>Update the name or term.</p>
        {" "}
        <label htmlFor="courseRenameNameInput">Course name</label>
        {" "}
        <input id="courseRenameNameInput" maxLength={80} autoComplete="off" />
        {" "}
        <label className="course-dialog-field" htmlFor="courseRenameTermInput">
          {"Term "}
          <span>Optional</span>
        </label>
        {" "}
        <input id="courseRenameTermInput" maxLength={40} autoComplete="off" />
        {" "}
        <button type="submit" className="dojo-dialog-submit">Save changes</button>
      </form>
    </dialog>
  );
}
