// Course › Study: your collection first (resume rows), making something new behind "+ make".
// An open tool (deck, test, podcast, tutor, note) takes over the tab; its body and header are the engine's.
import { Icon, TOOL_ICON } from "./brand";
import { Menu } from "./Menu";
import type { CollectionItem, DojoHub, DojoView } from "./types";

const MAKE: [string, string][] = [
  ["flashcards", "flashcards"],
  ["quiz", "practice test"],
  ["mindmap", "mind map"],
  ["notes", "summary / detailed notes"],
  ["podcast", "podcast"],
  ["tutor", "AI tutor (voice call)"],
  ["whiteboard", "whiteboard"]
];

const OPEN_ATTR: Record<CollectionItem["kind"], string> = {
  deck: "data-open-deck",
  quiz: "data-open-quiz",
  podcast: "data-open-podcast",
  tutor: "data-open-tutor",
  whiteboard: "data-open-whiteboard",
  note: "data-open-note"
};

const ACTION: Record<string, string> = { deck: "resume", quiz: "retake", podcast: "play", tutor: "rejoin", whiteboard: "open", note: "read" };

export function StudyTab({ hub, view }: { hub: DojoHub; view: DojoView }) {
  if (view.studio) {
    return (
      // The tool's own header carries the back arrow and the title.
      <div className="d3-tabbody d3-tool is-studio">
        <div className="d3-tool-slot" data-dojo-studio-slot="" />
      </div>
    );
  }
  const items = view.collection || [];
  const jobs = view.generations || [];
  return (
    <div className="d3-tabbody">
      <div className="d3-toolbar">
        <p className="d3-group">your collection{items.length ? ` · ${items.length}` : ""}</p>
        <span className="d3-top-space" />
        <Menu label="Make something new" align="right" trigger={<span className="d3-btn"><Icon name="plus" size={15} />make<Icon name="chevD" size={14} /></span>}>
          {MAKE.map(([type, label]) => (
            <button key={type} type="button" className="d3-mi" role="menuitem" data-practice-create={type}><Icon name={TOOL_ICON[type] || "notes"} size={16} />{label}</button>
          ))}
        </Menu>
      </div>
      {jobs.length > 0 && (
        <div className="d3-list is-jobs">
          {jobs.map((job) => (
            <div className={`d3-row is-job is-${job.status}`} key={job.id} data-gen-id={job.id}>
              <span className="d3-thumb is-icon">{job.status === "failed" ? <Icon name="alert" /> : <span className="d3-spin" />}</span>
              <div className="d3-row-main is-static">
                <h3>{job.label} · {job.source}</h3>
                <span className="d3-row-meta">
                  {job.meta && <span>{job.meta}</span>}
                  <span className={`d3-chip ${job.status === "failed" ? "is-error" : "is-proc"}`}>{job.status === "failed" ? "couldn’t make it" : `making${job.stage ? ` · ${job.stage}` : "…"}`}</span>
                  {job.elapsed && <span className="study-gen-elapsed">{job.elapsed}</span>}
                </span>
                {job.status === "failed" && job.error && <p className="d3-error">{job.error}</p>}
              </div>
              {job.status === "running" && <button type="button" className="d3-iconbtn" data-cancel-generation={job.id} aria-label="Cancel" title="Cancel"><Icon name="x" /></button>}
              {job.status === "failed" && <button type="button" className="d3-iconbtn" data-retry-generation={job.id} aria-label="Try again" title="Try again"><Icon name="retry" /></button>}
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="d3-list">
          {items.map((item) => <CollectionRow key={`${item.kind}:${item.id}`} item={item} />)}
        </div>
      )}
      {!items.length && !jobs.length && (
        <div className="d3-empty">
          <h3>nothing here yet</h3>
          <p>open a lecture and tap “study this”, or make flashcards, a practice test or a podcast from any of your lectures and materials.</p>
        </div>
      )}
    </div>
  );
}

function CollectionRow({ item }: { item: CollectionItem }) {
  const open = { [OPEN_ATTR[item.kind]]: item.id };
  const progress = item.kind === "deck" ? item.progress : null;
  const pct = progress ? Math.round(((progress.state === "resume" ? (progress.seen || 0) : progress.total) / Math.max(1, progress.total)) * 100) : 0;
  const renameAttr = item.kind === "note" ? null : { [`data-rename-${item.kind}`]: item.id };
  const deleteAttr = { [`data-delete-${item.kind}`]: item.id };
  return (
    <div className={`d3-row is-tool${item.pinned ? " is-pinned" : ""}`}>
      <button type="button" className="d3-row-main is-tool" {...open} disabled={item.preparing}>
        <Thumb item={item} />
        <span className="d3-row-copy">
          <h3>{item.pinned && <Icon name="pin" size={14} className="d3-pin" />}{item.title}</h3>
          <span className="d3-row-meta">
            <span>{item.meta}</span>
            {progress?.state === "resume" && <span>{progress.seen} of {progress.total} seen</span>}
            {progress?.state === "done" && <span>{progress.got} of {progress.total} known</span>}
            {item.preparing && <span className="d3-chip is-proc">preparing…</span>}
          </span>
          {progress && <span className="d3-bar is-progress" aria-hidden="true"><i style={{ transform: `scaleX(${(pct / 100).toFixed(3)})` }} /></span>}
        </span>
        <span className="d3-row-action">{ACTION[item.kind]}</span>
      </button>
      <Menu label={`Options for ${item.title}`}>
        {item.kind === "note" && ([["flashcards", "rapid", "create flashcards"], ["flashcards", "deep", "create deep flashcards"], ["quiz", "", "create practice test"]] as const).map(([type, mode, label]) => <button key={label} type="button" className="d3-mi" role="menuitem" data-study-generate={type} data-gen-kind="note" data-gen-id={item.id} data-mode={mode}>{label}</button>)}
        <button type="button" className="d3-mi" role="menuitem" data-collection-pin-kind={item.kind} data-collection-pin-id={item.id}><Icon name="pin" size={16} />{item.pinned ? "unpin" : "pin to top"}</button>
        {renameAttr && <button type="button" className="d3-mi" role="menuitem" {...renameAttr}><Icon name="edit" size={16} />rename</button>}
        <button type="button" className="d3-mi is-danger" role="menuitem" {...deleteAttr}><Icon name="trash" size={16} />delete</button>
      </Menu>
    </div>
  );
}

// Saved work shows as a small preview of itself where it can (a mind map's branches);
// everything else gets its tool's icon.
function Thumb({ item }: { item: CollectionItem }) {
  if (item.type === "mindmap" && item.outline?.length) {
    return (
      <span className="d3-thumb is-map" aria-hidden="true">
        <span className="d3-tnode is-root">{item.title.split(/\s+/).slice(0, 2).join(" ")}</span>
        <span className="d3-tbranches">{item.outline.map((label) => <span key={label} className="d3-tnode">{label.length > 16 ? `${label.slice(0, 15)}…` : label}</span>)}</span>
      </span>
    );
  }
  return <span className={`d3-thumb is-icon is-${item.type}`} aria-hidden="true"><Icon name={TOOL_ICON[item.type] || "notes"} size={20} /></span>;
}
