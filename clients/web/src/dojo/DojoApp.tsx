import { navigateTabs } from "./tabs";
// The Dojo: an AI note app for lectures. Home (record + recent notes + courses) and a course
// (Notes · Study · Materials · Ask). Navigation state lives in the engine; this only draws it.
import { useEffect } from "react";
import { Folder, Icon, Klui, Wordmark, toneFor } from "./brand";
import { clock, day, joinMeta, minutes } from "./fmt";
import { Menu } from "./Menu";
import { NotesTab } from "./Notes";
import { LecturePage } from "./Lecture";
import { StudyTab } from "./Study";
import { MaterialsTab } from "./Materials";
import { AskTab } from "./Ask";
import type { DojoHub, DojoView, RecentRow } from "./types";

export function DojoApp({ hub, view }: { hub: DojoHub; view: DojoView }) {
  if (!view.courseId) return <Home hub={hub} view={view} />;
  return <Course hub={hub} view={view} />;
}

/* ---------- Home ---------- */

function Home({ hub, view }: { hub: DojoHub; view: DojoView }) {
  const { actions } = hub;
  useEffect(() => { void hub.loadRecentLectures(); }, [hub, view.courses.length]);
  const toneOf = (id: string) => toneFor(Math.max(0, view.courses.findIndex((course) => course.id === id)));
  return (
    <div className="d3-page d3-home">
      <div className="d3-scroll">
        <div className="d3-wrap">
          <header className="d3-hero-head">
            <Wordmark />
            <p className="d3-tagline">be here. we’ll take notes.</p>
          </header>
          <RecordHero hub={hub} view={view} />
          <RecentNotes rows={view.recent?.rows} loading={!view.recent && view.courses.length > 0} hub={hub} toneOf={toneOf} />
          <section className="d3-section">
            <div className="d3-section-head">
              <h2>your courses</h2>
              <button type="button" className="d3-textbtn" onClick={() => actions.createCourse()}><Icon name="plus" size={15} />new course</button>
            </div>
            <div className="d3-shelf">
              {view.courses.map((course, index) => {
                const counts = view.recent?.counts[course.id];
                return (
                  <div className="d3-shelf-item" key={course.id}>
                    <button type="button" className="d3-shelf-open" onClick={() => void actions.openCourse(course.id)}>
                      <Folder tone={toneFor(index)} />
                      <strong>{course.name}</strong>
                      <small>{counts ? joinMeta(`${counts.lectures} lecture ${counts.lectures === 1 ? "note" : "notes"}`, `${counts.materials} ${counts.materials === 1 ? "material" : "materials"}`) : " "}</small>
                    </button>
                    <Menu label={`Options for ${course.name}`}>
                      <button type="button" className="d3-mi" role="menuitem" onClick={() => actions.renameCourse(course.id)}><Icon name="edit" size={16} />rename</button>
                      <button type="button" className="d3-mi is-danger" role="menuitem" onClick={() => actions.deleteCourse(course.id)}><Icon name="trash" size={16} />delete</button>
                    </Menu>
                  </div>
                );
              })}
              <button type="button" className="d3-shelf-open d3-shelf-new" onClick={() => actions.createCourse()}>
                <Folder add />
                <strong>new course</strong>
                <small>&nbsp;</small>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function RecordHero({ hub, view }: { hub: DojoHub; view: DojoView }) {
  const { actions } = hub;
  const live = view.live.courseId;
  if (live) {
    const course = view.courses.find((item) => item.id === live);
    return (
      <section className="d3-hero is-live">
        <Klui mood="listening" size={64} />
        <div className="d3-hero-copy">
          <h2>{view.live.state === "paused" ? "paused" : "klui is listening"}{course ? ` · ${course.name}` : ""}</h2>
          <p><span className="d3-rdot is-pulse" aria-hidden="true" /> <span data-live-time>{clock(view.live.elapsed)}</span></p>
        </div>
        <div className="d3-hero-actions">
          <button type="button" className="d3-btn is-filled" onClick={() => actions.openLive(live)}>open your notes</button>
        </div>
      </section>
    );
  }
  const hasCourses = view.courses.length > 0;
  const target = view.courses.find((course) => course.id === view.recordTo) || view.courses[0];
  return (
    <section className="d3-hero">
      <Klui size={72} />
      <div className="d3-hero-copy">
        <h2>in class?</h2>
        <p>tap record — klui listens and writes the notes.<br />jot if you want, or just listen.</p>
      </div>
      <div className="d3-hero-actions">
        <button type="button" className="d3-btn is-filled is-big" onClick={() => (target ? actions.recordInto(target.id) : void actions.recordUnsorted())}>
          <span className="d3-rdot" aria-hidden="true" />record a lecture
        </button>
        <label className="d3-saving">
          <span>saving to</span>
          {hasCourses
            ? (
              <select value={target?.id || ""} onChange={(event) => actions.setRecordTo(event.target.value)} aria-label="Course to save the lecture to">
                {view.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            )
            : <b>Unsorted</b>}
        </label>
        {hasCourses && (
          <button type="button" className="d3-quietlink" onClick={() => { if (target) void actions.openCourse(target.id).then(() => actions.uploadRecording()); }}>
            have an audio file? upload a recording
          </button>
        )}
      </div>
    </section>
  );
}

function RecentNotes({ rows, loading, hub, toneOf }: { rows?: RecentRow[]; loading: boolean; hub: DojoHub; toneOf: (id: string) => string }) {
  if (!rows?.length && !loading) return null;
  return (
    <section className="d3-section">
      <div className="d3-section-head"><h2>recent notes</h2></div>
      <div className="d3-list">
        {loading && !rows?.length && <div className="d3-row is-skeleton"><span className="d3-skel" /><span className="d3-skel is-short" /></div>}
        {rows?.map((row) => (
          <div className="d3-row" key={row.id}>
            <button type="button" className="d3-row-main" onClick={() => hub.actions.openLecture(row.courseId, row.id)}>
              <h3>{row.title}</h3>
              {row.gist && <p>{row.gist}</p>}
              <span className="d3-row-meta">
                <span className="d3-course-dot" data-tone={toneOf(row.courseId)} />{row.courseName}
                <span>{joinMeta(day(row.createdAt), minutes(row.duration))}</span>
                {row.status === "writing" && <span className="d3-chip is-proc">klui is writing…</span>}
                {row.status === "transcribing" && <span className="d3-chip is-proc">transcribing…</span>}
                {row.status === "failed" && <span className="d3-chip is-error">couldn’t transcribe</span>}
                {row.made > 0 && row.status === "ready" && <span className="d3-made"><Icon name="layers" size={14} />{row.made} made from it</span>}
              </span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- Course ---------- */

const TABS: [DojoView["tab"], string][] = [["notes", "Notes"], ["practice", "Study"], ["materials", "Materials"], ["chat", "Ask"]];

function Course({ hub, view }: { hub: DojoHub; view: DojoView }) {
  const { actions } = hub;
  const index = view.courses.findIndex((course) => course.id === view.courseId);
  const name = view.course?.name || "Course";
  const lecture = view.lecture;
  const lectureCount = view.lectures?.length || 0;
  const materialCount = view.materials?.length || 0;
  const recordFilled = view.tab === "notes" && !lecture;
  const recording = Boolean(view.live.courseId);
  const record = !recording && (
    <button type="button" className={`d3-btn ${recordFilled ? "is-filled" : "is-ghost"}`} data-lecture-record="">
      <span className="d3-rdot" aria-hidden="true" />{recordFilled ? "record a lecture" : "record"}
    </button>
  );
  if (lecture) {
    return (
      <div className="d3-page d3-course is-lecture">
        <header className="d3-top">
          <nav className="d3-crumb" aria-label="Breadcrumb">
            <button type="button" className="d3-crumb-back" onClick={() => actions.closeLecture()} aria-label={`Back to ${name}`}><Icon name="chevL" size={16} />{name}</button>
            <Icon name="chevR" size={14} />
            <b>{lecture.kind === "live" ? "new lecture" : "title" in lecture ? lecture.title : "lecture"}</b>
          </nav>
          <span className="d3-top-space" />
          {record}
        </header>
        <LecturePage hub={hub} view={view} lecture={lecture} />
      </div>
    );
  }
  return (
    <div className="d3-page d3-course">
      <header className="d3-top">
        <nav className="d3-crumb" aria-label="Breadcrumb">
          <button type="button" className="d3-crumb-back" onClick={() => void actions.openCourses()}><Icon name="chevL" size={16} />dojo</button>
          <Icon name="chevR" size={14} />
          <b>{name}</b>
        </nav>
        <span className="d3-top-space" />
        {recording && view.live.courseId === view.courseId && (
          <button type="button" className="d3-btn is-live" onClick={() => actions.selectLecture("live")}><span className="d3-rdot is-pulse" aria-hidden="true" /><span data-live-time>{clock(view.live.elapsed)}</span></button>
        )}
        {record}
      </header>
      <div className="d3-scroll">
        <div className="d3-wrap is-wide">
          <div className="d3-coursehead">
            <Folder tone={toneFor(Math.max(0, index))} size={56} />
            <div className="d3-coursehead-copy">
              <h1>{name}</h1>
              <p>{view.loaded ? joinMeta(`${lectureCount} lecture ${lectureCount === 1 ? "note" : "notes"}`, `${materialCount} ${materialCount === 1 ? "material" : "materials"}`) : " "}</p>
            </div>
            <Menu label="Course options" className="d3-coursehead-menu">
              <button type="button" className="d3-mi" role="menuitem" onClick={() => actions.renameCourse(view.courseId)}><Icon name="edit" size={16} />rename course</button>
              <button type="button" className="d3-mi is-danger" role="menuitem" onClick={() => actions.deleteCourse(view.courseId)}><Icon name="trash" size={16} />delete course</button>
            </Menu>
            <div className="d3-tabs" role="tablist" onKeyDown={navigateTabs} aria-label="Course sections">
              {TABS.map(([tab, label]) => (
                <button key={tab} type="button" role="tab" id={`d3-course-tab-${tab}`} aria-controls="d3-course-panel" tabIndex={view.tab === tab ? 0 : -1} aria-selected={view.tab === tab} className={view.tab === tab ? "is-on" : ""} onClick={() => void actions.setTab(tab)}>{label}</button>
              ))}
            </div>
          </div>
          <div id="d3-course-panel" role="tabpanel" aria-labelledby={`d3-course-tab-${view.tab}`}>
          {view.tab === "notes" && <NotesTab hub={hub} view={view} />}
          {view.tab === "practice" && <StudyTab hub={hub} view={view} />}
          {view.tab === "materials" && <MaterialsTab hub={hub} view={view} />}
          {view.tab === "chat" && <AskTab hub={hub} view={view} />}
          </div>
        </div>
      </div>
    </div>
  );
}
