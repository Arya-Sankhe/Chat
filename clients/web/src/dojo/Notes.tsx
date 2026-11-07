import { LectureMenu } from "./LectureMenu";
// Course › Notes: the lecture notes, newest first, as one flat notebook list.
import { Icon, Klui } from "./brand";
import { clock, day, joinMeta, minutes, thisWeek } from "./fmt";
import type { DojoHub, DojoView, LectureRow } from "./types";

export function NotesTab({ hub, view }: { hub: DojoHub; view: DojoView }) {
  const lectures = view.lectures || [];
  const busy = view.busy || [];
  const busyDocs = new Set(busy.map((entry) => entry.docId).filter(Boolean));
  const ready = lectures.filter((row) => row.ready && !busyDocs.has(row.id));
  const week = ready.filter((row) => thisWeek(row.createdAt));
  const earlier = ready.filter((row) => !thisWeek(row.createdAt));
  const live = view.live.here;
  const empty = !ready.length && !busy.length && !live;
  return (
    <div className="d3-tabbody">
      {(live || busy.length > 0) && (
        <>
          <p className="d3-group">in progress</p>
          <div className="d3-list">
            {live && (
              <div className="d3-row is-live">
                <button type="button" className="d3-row-main" data-lecture="live">
                  <h3><span className="d3-rdot is-pulse" aria-hidden="true" />{view.live.state === "paused" ? "paused" : "recording now"}</h3>
                  <span className="d3-row-meta"><span data-live-time>{clock(view.live.elapsed)}</span><span>tap to open your notepad</span></span>
                </button>
              </div>
            )}
            {busy.map((entry) => {
              const id = entry.uploadId ? `up:${entry.uploadId}` : entry.docId;
              const target = entry.uploadId ? { "data-audio-upload": entry.uploadId } : { "data-audio-doc": entry.docId };
              return (
                <div className={`d3-row${entry.failed ? " is-failed" : ""}`} key={entry.key} data-audio-card={entry.key} data-phase={entry.phase}>
                  <button type="button" className="d3-row-main" data-lecture={id}>
                    <h3>{entry.title}</h3>
                    <span className="d3-row-meta">
                      <span className={`d3-chip ${entry.failed ? "is-error" : "is-proc"}`} data-audio-label>{entry.label}</span>
                      <span data-audio-detail>{entry.detail}</span>
                    </span>
                    {entry.progress != null && !entry.failed && <span className="d3-bar" aria-hidden="true"><i data-audio-bar style={{ transform: `scaleX(${entry.progress.toFixed(4)})` }} /></span>}
                  </button>
                  {entry.failed && <button type="button" className="d3-iconbtn" data-audio-retry="" {...target} aria-label="Try again" title="Try again"><Icon name="retry" /></button>}
                  {entry.phase !== "queuing" && <button type="button" className="d3-iconbtn" data-audio-remove="" {...target} aria-label={entry.failed ? "Remove" : "Cancel"} title={entry.failed ? "Remove" : "Cancel"}><Icon name="x" /></button>}
                </div>
              );
            })}
          </div>
        </>
      )}
      {week.length > 0 && <LectureGroup title="this week" rows={week} hub={hub} view={view} />}
      {earlier.length > 0 && <LectureGroup title={week.length ? "earlier" : "all lectures"} rows={earlier} hub={hub} view={view} />}
      {empty && view.loaded && (
        <div className="d3-empty">
          <Klui size={56} />
          <h3>no lecture notes yet</h3>
          <p>tap record in your next class. klui listens, and the notes show up here on their own.</p>
          <button type="button" className="d3-quietlink" onClick={() => hub.actions.uploadRecording()}>have an audio file? upload a recording</button>
        </div>
      )}
      {!empty && (
        <button type="button" className="d3-askbar" onClick={() => void hub.actions.setTab("chat")}>
          <Klui size={24} />
          <span>ask {view.course?.name || "this course"} anything…</span>
          <span className="d3-sendbtn"><Icon name="send" size={16} /></span>
        </button>
      )}
    </div>
  );
}

function LectureGroup({ title, rows, hub, view }: { title: string; rows: LectureRow[]; hub: DojoHub; view: DojoView }) {
  return (
    <>
      <p className="d3-group">{title}</p>
      <div className="d3-list">
        {rows.map((row) => (
          <div className="d3-row" key={row.id}>
            <button type="button" className="d3-row-main" data-lecture={row.id}>
              <h3>{row.title}</h3>
              {row.gist && <p>{row.gist}</p>}
              <span className="d3-row-meta">
                <span>{joinMeta(day(row.createdAt), minutes(row.duration))}</span>
                {row.writing && <span className="d3-chip is-proc">klui is writing…</span>}
                {!row.writing && row.noteError && <span className="d3-chip is-error">notes didn’t finish</span>}
              </span>
            </button>
            <button type="button" className="d3-playbtn" aria-label={`Play ${row.title}`} title="Play" onClick={() => playLecture(hub, row.id)}><Icon name="play" size={12} /></button>
            <LectureMenu hub={hub} view={view} id={row.id} title={row.title} />
          </div>
        ))}
      </div>
    </>
  );
}

// ▶ on a row opens the lecture and starts its audio from the top.
export function playLecture(hub: DojoHub, id: string) {
  hub.actions.selectLecture(id);
  requestAnimationFrame(() => (document.querySelector("#studyView [data-strip-toggle]") as HTMLButtonElement | null)?.click());
}
