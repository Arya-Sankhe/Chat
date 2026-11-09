// The Dojo: an AI note app for lectures. Home (your course folders, with one record control)
// and a course (overview, or whatever is open with Ask beside it; see Course.tsx).
// Navigation state lives in the engine; this only draws it.
import { Folder, Icon, Wordmark, toneFor } from "./brand";
import { Menu } from "./Menu";
import { Course } from "./Course";
import { RecordControl } from "./Record";
import type { DojoHub, DojoView } from "./types";

export function DojoApp({ hub, view }: { hub: DojoHub; view: DojoView }) {
  if (!view.courseId) return <Home hub={hub} view={view} />;
  return <Course hub={hub} view={view} />;
}

/* ---------- Home ---------- */

// The original Dojo library (study-hub.css styles these classes), now drawn by React.
function Home({ hub, view }: { hub: DojoHub; view: DojoView }) {
  const { actions } = hub;
  const count = view.courses.length;
  return (
    <div className="d3-page d3-home">
      <div className="d3-scroll d3-lib-scroll">
        <div className="study-page study-page--library">
          <header className="dojo-library-head d3-lib-head">
            <div className="d3-lib-brand">
              <Wordmark />
              <div className="dojo-library-title"><h1>Your courses</h1></div>
            </div>
            <RecordControl hub={hub} view={view} />
          </header>
          <div className="study-course-grid">
            <button type="button" className="study-course-card study-course-new dojo-tone--new" onClick={() => actions.createCourse()}>
              <Folder add fluid />
              <span className="dojo-course-label"><strong>New course</strong></span>
            </button>
            {view.courses.map((course, index) => {
              const tone = toneFor(index);
              return (
                <article className={`study-course-card dojo-tone--${tone}`} key={course.id}>
                  <button type="button" className="study-course-open" onClick={() => void actions.openCourse(course.id)}>
                    <Folder tone={tone} fluid />
                    <span className="dojo-course-label"><strong>{course.name}</strong></span>
                    <span className="dojo-course-enter"><Icon name="arrow" size={18} /></span>
                  </button>
                  <Menu label={`Options for ${course.name}`}>
                    <button type="button" className="d3-mi" role="menuitem" onClick={() => actions.renameCourse(course.id)}><Icon name="edit" size={16} />rename</button>
                    <button type="button" className="d3-mi is-danger" role="menuitem" onClick={() => actions.deleteCourse(course.id)}><Icon name="trash" size={16} />delete</button>
                  </Menu>
                </article>
              );
            })}
          </div>
          {!count && <p className="dojo-first-hint">One folder for every subject. Add your sources, ask questions, and turn what you learn into practice.</p>}
        </div>
      </div>
    </div>
  );
}
