// The one record control, shared by the Dojo home and a course: a quiet capsule with
// Record first, then (on the home page) the course it saves to, then an upload icon.
import { clock } from "./fmt";
import { Icon, toneFor } from "./brand";
import { Menu } from "./Menu";
import type { DojoHub, DojoView } from "./types";

export function RecordControl({ hub, view, inCourse = false }: { hub: DojoHub; view: DojoView; inCourse?: boolean }) {
  const { actions } = hub;
  const live = view.live.courseId;

  if (live) {
    const here = inCourse && live === view.courseId;
    const course = view.courses.find((item) => item.id === live);
    return (
      <div className="d3-rec is-live">
        <button type="button" className="d3-rec-go" onClick={() => (here ? actions.selectLecture("live") : actions.openLive(live))} aria-label="Open the lecture you're recording">
          <span className="d3-rec-dot is-pulse" aria-hidden="true" />
          <span className="d3-rec-time" data-live-time>{clock(view.live.elapsed)}</span>
          <span className="d3-rec-sub">{view.live.state === "paused" ? "paused" : "recording"}{!here && course ? ` · ${course.name}` : ""}</span>
        </button>
      </div>
    );
  }

  if (inCourse) {
    return (
      <div className="d3-rec">
        <button type="button" className="d3-rec-go" data-lecture-record="">
          <span className="d3-rec-dot" aria-hidden="true" />Record lecture
        </button>
        <button type="button" className="d3-rec-up" onClick={() => actions.uploadRecording()} aria-label="Upload a recording" title="Upload a recording">
          <Icon name="upload" size={16} />
        </button>
      </div>
    );
  }

  const target = view.courses.find((course) => course.id === view.recordTo) || view.courses[0];
  if (!target) {
    return (
      <div className="d3-rec">
        <button type="button" className="d3-rec-go" onClick={() => void actions.recordUnsorted()}>
          <span className="d3-rec-dot" aria-hidden="true" />Record lecture
        </button>
      </div>
    );
  }
  const toneOf = (id: string) => toneFor(Math.max(0, view.courses.findIndex((course) => course.id === id)));
  return (
    <div className="d3-rec">
      <button type="button" className="d3-rec-go" onClick={() => actions.recordInto(target.id)}>
        <span className="d3-rec-dot" aria-hidden="true" />Record lecture
      </button>
      <Menu
        label={`Saving to ${target.name}. Change course`}
        className="d3-rec-to"
        trigger={<><span className="d3-rec-into">into</span><span className="d3-course-dot" data-tone={toneOf(target.id)} /><b>{target.name}</b><Icon name="chevD" size={14} /></>}
      >
        <div className="d3-menu-label">save lectures to</div>
        {view.courses.map((course) => (
          <button key={course.id} type="button" className={`d3-mi${course.id === target.id ? " is-on" : ""}`} role="menuitem" onClick={() => actions.setRecordTo(course.id)}>
            <span className="d3-course-dot" data-tone={toneOf(course.id)} />
            <span className="d3-mi-text">{course.name}</span>
            {course.id === target.id && <Icon name="check" size={15} />}
          </button>
        ))}
      </Menu>
      <button
        type="button"
        className="d3-rec-up"
        onClick={() => void actions.openCourse(target.id).then(() => actions.uploadRecording())}
        aria-label={`Upload a recording to ${target.name}`}
        title="Upload a recording"
      >
        <Icon name="upload" size={16} />
      </button>
    </div>
  );
}
