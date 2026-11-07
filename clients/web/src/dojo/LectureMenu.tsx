import { useEffect, useRef, useState } from "react";
import { Icon } from "./brand";
import { Menu } from "./Menu";
import type { DojoHub, DojoView } from "./types";

export function LectureMenu({ hub, view, id, title, paper = false }: { hub: DojoHub; view: DojoView; id: string; title: string; paper?: boolean }) {
  const [mode, setMode] = useState<"rename" | "move" | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const destinations = view.courses.filter(course => course.id !== view.courseId);
  useEffect(() => { if (mode) dialog.current?.showModal(); }, [mode]);
  function open(next: "rename" | "move") {
    setError(""); setValue(next === "rename" ? title : destinations[0]?.id || ""); setMode(next);
  }
  async function save() {
    setBusy(true); setError("");
    try {
      await hub.actions.manageLecture(id, mode === "rename" ? { title: value.trim() } : { targetCourseId: value });
      setMode(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this lecture."); }
    finally { setBusy(false); }
  }
  return <>
    <Menu label={`Options for ${title}`}>
      {paper
        ? <button type="button" className="d3-mi" role="menuitem" data-lecture-tab="transcript"><Icon name="file" size={16} />transcript</button>
        : <button type="button" className="d3-mi" role="menuitem" data-lecture={id}><Icon name="notes" size={16} />open notes</button>}
      <button type="button" className="d3-mi" role="menuitem" onClick={() => open("rename")}><Icon name="edit" size={16} />rename</button>
      <button type="button" className="d3-mi" role="menuitem" disabled={!destinations.length} onClick={() => open("move")}><Icon name="folder" size={16} />move to course</button>
      <button type="button" className="d3-mi" role="menuitem" disabled={busy} onClick={() => {
        setBusy(true); setError("");
        void hub.actions.downloadLecture(id).catch(failure => { setError(failure.message || "Download failed."); }).finally(() => setBusy(false));
      }}><Icon name="download" size={16} />download audio</button>
      <button type="button" className="d3-mi is-danger" role="menuitem" data-delete-doc={id}><Icon name="trash" size={16} />delete lecture</button>
    </Menu>
    {error && !mode && <span role="alert" className="d3-error">{error}</span>}
    {mode && <dialog ref={dialog} className="d3-lecture-dialog" aria-labelledby={`lecture-manage-${id}`} onCancel={event => { if (busy) event.preventDefault(); else setMode(null); }}>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2 id={`lecture-manage-${id}`}>{mode === "rename" ? "Rename lecture" : "Move lecture"}</h2>
        <label>{mode === "rename" ? "Lecture title" : "Destination course"}
          {mode === "rename"
            ? <input autoFocus required maxLength={120} value={value} disabled={busy} onChange={event => setValue(event.target.value)} />
            : <select autoFocus required value={value} disabled={busy} onChange={event => setValue(event.target.value)}>{destinations.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select>}
        </label>
        {mode === "move" && <p>The recording, transcript and lecture notes move together. Study tools you already created stay in this course.</p>}
        {error && <p role="alert" className="d3-error">{error}</p>}
        <div className="d3-dialog-actions">
          <button type="button" className="d3-btn" disabled={busy} onClick={() => setMode(null)}>cancel</button>
          <button type="submit" className="d3-btn is-filled" disabled={busy || !value.trim()}>{busy ? "saving…" : mode === "rename" ? "save" : "move lecture"}</button>
        </div>
      </form>
    </dialog>}
  </>;
}
