export function CourseCreateDialog() {
  return (
    <dialog className="project-create-dialog dojo-course-dialog" id="courseCreateDialog" aria-labelledby="courseCreateTitle">
      <form method="dialog" id="courseCreateForm">
        <button type="button" className="dojo-dialog-close" id="courseCreateClose" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
        {" "}
        <h2 id="courseCreateTitle">New course</h2>
        {" "}
        <p>A home for lectures, notes, flashcards, and quizzes.</p>
        {" "}
        <label htmlFor="courseNameInput">Course name</label>
        {" "}
        <input id="courseNameInput" maxLength={80} autoComplete="off" placeholder="e.g. Organic Chemistry" />
        {" "}
        <label className="course-dialog-field" htmlFor="courseTermInput">
          {"Term "}
          <span>Optional</span>
        </label>
        {" "}
        <input id="courseTermInput" maxLength={40} autoComplete="off" placeholder="e.g. Fall 2026" />
        {" "}
        <button type="submit" className="dojo-dialog-submit">Create course</button>
      </form>
    </dialog>
  );
}
