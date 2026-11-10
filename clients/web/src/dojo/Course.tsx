// A course in the Dojo. With nothing open, the course overview fills the page: lectures,
// materials, Create and your work in a 2×2 grid, and Ask at the bottom. Open anything (a
// lecture, a PDF, a deck, the chat) and it takes the main panel, while the lists move into a slim panel on the right.
// The main panel switches between Ask and whatever is open. Navigation state lives in the
// engine (islands/studyHub.js); this only draws it.
import { useLayoutEffect, useRef } from "react";
import { Icon, Klui, TOOL_ICON } from "./brand";
import { clock, day, joinMeta } from "./fmt";
import { Menu } from "./Menu";
import { NotesTab } from "./Notes";
import { LectureAsk, LecturePage } from "./Lecture";
import { OPEN_ATTR, StudyTab } from "./Study";
import { MaterialsTab } from "./Materials";
import { AskTab } from "./Ask";
import { AskBar, LecturePop, ThinkingPill } from "./AskBar";
import { RecordControl } from "./Record";
import type { CollectionItem, DojoHub, DojoView } from "./types";

type Tab = DojoView["tab"];

const MAKE: [string, string, string][] = [
  ["flashcards", "Flashcards", "flashcards"],
  ["quiz", "Practice test", "practice test"],
  ["mindmap", "Mind map", "mind map"],
  ["notes", "Summary", "summary / detailed notes"],
  ["podcast", "Podcast", "podcast"],
  ["tutor", "AI tutor", "AI tutor (voice call)"],
  ["whiteboard", "Whiteboard", "whiteboard"]
];

const SHORT: Record<string, string> = { flashcards: "Cards", quiz: "Test", mindmap: "Map", notes: "Summary", podcast: "Podcast", tutor: "Tutor", whiteboard: "Board" };
const MATERIAL_ICON: Record<string, string> = { website: "link", text: "type" };
const MATERIAL_WORD: Record<string, string> = { pdf: "PDF", pptx: "Slides", ppt: "Slides", docx: "Document", doc: "Document", website: "Link", text: "Text", image: "Image" };
// Everything you made with Create in this course.
const WORK = "Your work";
const TOOL_WORD: Record<string, string> = { deck: "Flashcards", quiz: "Practice test", podcast: "Podcast", tutor: "Tutor call", whiteboard: "Whiteboard" };

// What the main panel shows for a tab other than Ask (null: the course overview).
type Item = { tab: Tab; word: string; title: string; icon: string; scope: string; lectureId?: string; lectureAsk?: boolean };

function itemFor(view: DojoView, tab: Tab): Item | null {
  if (tab === "notes") {
    const lecture = view.lecture;
    if (!lecture) return null;
    if (lecture.kind === "live") return { tab, word: "Recording", title: "New lecture", icon: "mic", scope: "this course", lectureId: "live" };
    const canAsk = "html" in lecture && !lecture.entry;
    return { tab, word: "Lecture", title: lecture.title, icon: "notes", scope: canAsk ? "this lecture" : "this course", lectureId: lecture.id, lectureAsk: canAsk };
  }
  if (tab === "practice") {
    const studio = view.studio;
    if (!studio) return { tab, word: WORK, title: WORK, icon: "layers", scope: "this course" };
    const made = view.collection?.find((item) => item.kind === studio.kind && item.id === studio.id);
    const word = studio.kind === "note" ? (made?.type === "mindmap" ? "Mind map" : "Summary") : TOOL_WORD[studio.kind] || "Study";
    return { tab, word, title: studio.title || word, icon: TOOL_ICON[made?.type || ""] || "layers", scope: "this course" };
  }
  if (tab === "materials") {
    const material = view.previewId ? view.materials?.find((item) => item.id === view.previewId) : null;
    if (!view.previewId) return { tab, word: "Materials", title: "Slides, PDFs and links", icon: "file", scope: "this course" };
    const word = MATERIAL_WORD[material?.kind || ""] || "File";
    return { tab, word, title: material?.name || word, icon: MATERIAL_ICON[material?.kind || ""] || "file", scope: `this ${word === "PDF" ? "PDF" : word.toLowerCase()}` };
  }
  return null;
}

export function Course({ hub, view }: { hub: DojoHub; view: DojoView }) {
  const { actions } = hub;
  // The thing that was open before you switched to Ask, so the switch can go back to it.
  const last = useRef<Tab>("notes");
  if (view.tab !== "chat") last.current = view.tab;
  const lectureAsk = view.tab === "notes" && view.lecture && view.lecture.kind !== "live" && "tab" in view.lecture && view.lecture.tab === "ask";
  const asking = view.tab === "chat" || Boolean(lectureAsk);
  const item = itemFor(view, view.tab === "chat" ? last.current : view.tab);
  const home = !asking && !item;
  // On narrow screens the main panel and the course lists share one scroll box; opening
  // something else from the lists scrolls back up so it isn't above the screen.
  const body = useRef<HTMLDivElement>(null);
  const shown = [view.tab, asking, view.lecture && "id" in view.lecture ? view.lecture.id : view.lecture ? "live" : "", view.previewId, view.studio ? `${view.studio.kind}:${view.studio.id}` : ""].join("|");
  useLayoutEffect(() => {
    if (body.current && body.current.scrollTop > 0) body.current.scrollTop = 0;
  }, [shown]);

  const toAsk = () => {
    if (item?.lectureAsk && item.lectureId) { actions.selectLecture(item.lectureId, "ask"); return; }
    void actions.ask(item?.tab === "materials" && view.previewId ? view.previewId : "");
  };
  // A lecture keeps you on its notes and answers in a pop-up; everything else moves to Ask on send.
  const pop = view.tab === "notes" && view.lecture && "pop" in view.lecture ? view.lecture.pop || "" : "";
  const askFromBar = (text: string) => {
    if (item?.lectureAsk && item.lectureId) { actions.askLecture(text); return; }
    void actions.askWith(text, item?.tab === "materials" && view.previewId ? view.previewId : "");
  };
  const toItem = () => {
    if (!item) return;
    if (lectureAsk && item.lectureId) { actions.selectLecture(item.lectureId, "notes"); return; }
    void actions.setTab(item.tab);
  };

  return (
    <div className={`d3-page d3-course d3-ws${home ? " is-home" : " is-open"}`}>
      <CourseTop hub={hub} view={view} home={home} />
      {home
        ? <Overview hub={hub} view={view} />
        : (
          <div className="d3-ws-body" ref={body}>
            <section className="d3-main" aria-label={asking ? "Ask" : item?.word}>
              <div className="d3-main-bar">
                <button type="button" className="d3-iconbtn d3-main-back" onClick={() => actions.goHome()} aria-label="Back to the course overview" title="Back to the course"><Icon name="chevL" size={18} /></button>
                <div className="d3-switch" role="group" aria-label="Main panel">
                  <button type="button" aria-pressed={asking} className={asking ? "is-on" : ""} onClick={asking ? undefined : toAsk}><Icon name="chat" size={15} />Ask</button>
                  {item && <button type="button" aria-pressed={!asking} className={asking ? "" : "is-on"} onClick={asking ? toItem : undefined}><Icon name={item.icon} size={15} />{item.word}</button>}
                </div>
              </div>
              <div className="d3-main-body">
                {lectureAsk && view.lecture && "title" in view.lecture && <LectureAsk view={view} title={view.lecture.title} />}
                {!lectureAsk && view.tab === "chat" && <AskTab hub={hub} view={view} />}
                {view.tab === "notes" && view.lecture && !lectureAsk && <LecturePage hub={hub} view={view} lecture={view.lecture} />}
                {view.tab === "practice" && <StudyTab hub={hub} view={view} />}
                {view.tab === "materials" && <MaterialsTab hub={hub} view={view} />}
              </div>
              {!asking && item?.lectureId !== "live" && (
                <div className={`d3-main-dock${pop ? ` is-pop-${pop}` : ""}`}>
                  {pop === "thinking" && <ThinkingPill />}
                  {!pop && <AskBar placeholder={`ask about ${item?.scope || "this course"}…`} onSend={askFromBar} />}
                </div>
              )}
              {!asking && pop && view.lecture && "title" in view.lecture && (
                <LecturePop title={view.lecture.title} open={pop === "open"} onClose={() => actions.closeLecturePop()} onExpand={() => actions.expandLecturePop()} />
              )}
            </section>
            <Side hub={hub} view={view} />
          </div>
        )}
    </div>
  );
}

/* ---------- Top bar: the course and the one Record button ---------- */

function CourseTop({ hub, view, home }: { hub: DojoHub; view: DojoView; home: boolean }) {
  const { actions } = hub;
  const name = view.course?.name || "Course";
  return (
    <header className="d3-top">
      <nav className="d3-crumb" aria-label="Breadcrumb">
        <button type="button" className="d3-crumb-back" onClick={() => void actions.openCourses()}>dojo</button>
        <Icon name="chevR" size={14} />
        {home ? <b>{name}</b> : <button type="button" className="d3-crumb-back is-course" onClick={() => actions.goHome()}>{name}</button>}
      </nav>
      <span className="d3-top-space" />
      <RecordControl hub={hub} view={view} inCourse />
      <Menu label="Course options">
        <button type="button" className="d3-mi" role="menuitem" onClick={() => actions.renameCourse(view.courseId)}><Icon name="edit" size={16} />rename course</button>
        <button type="button" className="d3-mi is-danger" role="menuitem" onClick={() => actions.deleteCourse(view.courseId)}><Icon name="trash" size={16} />delete course</button>
      </Menu>
    </header>
  );
}

/* ---------- Overview (nothing open) ---------- */

function Overview({ hub, view }: { hub: DojoHub; view: DojoView }) {
  return (
    <div className="d3-ws-body is-home">
      <section className="d3-overview" aria-label="Course overview">
        <div className="d3-bento">
          <div className="d3-bento-col">
            <section className="d3-tile is-lectures" aria-label="Lectures">
              <div className="d3-h4">Lectures</div>
              <NotesTab hub={hub} view={view} />
            </section>
            <section className="d3-tile is-fill" aria-label="Materials">
              <MaterialList hub={hub} view={view} />
            </section>
          </div>
          <div className="d3-bento-col">
            <section className="d3-tile" aria-label="Create">
              <div className="d3-h4">Create</div>
              <div className="d3-make">
                {MAKE.map(([type, label, name]) => (
                  <button key={type} type="button" className={`d3-make-btn is-${type}`} data-practice-create={type} aria-label={`Create ${name}`}><Icon name={TOOL_ICON[type] || "notes"} size={18} />{label}</button>
                ))}
              </div>
            </section>
            <section className="d3-tile is-fill" aria-label={WORK}>
              <MadeList hub={hub} view={view} limit={12} />
            </section>
          </div>
        </div>
        <div className="d3-main-dock">
          <AskBar placeholder={`ask ${view.course?.name || "this course"} anything…`} onSend={(text) => void hub.actions.askWith(text)} />
        </div>
      </section>
    </div>
  );
}

/* ---------- The right panel (something open) ---------- */

function Side({ hub, view }: { hub: DojoHub; view: DojoView }) {
  const lectures = (view.lectures || []).filter((row) => row.ready);
  const busy = view.busy || [];
  const openLecture = view.tab === "notes" && view.lecture ? ("id" in view.lecture ? view.lecture.id : "live") : "";
  return (
    <aside className="d3-side" aria-label="Course">
      <div className="d3-grp">
        <div className="d3-h4">Lectures</div>
        {view.live.here && (
          <button type="button" className={`d3-li is-live${openLecture === "live" ? " is-on" : ""}`} data-lecture="live">
            <span className="d3-rdot is-pulse" aria-hidden="true" /><span className="d3-li-text">recording now</span><small data-live-time>{clock(view.live.elapsed)}</small>
          </button>
        )}
        {busy.map((entry) => {
          const id = entry.uploadId ? `up:${entry.uploadId}` : entry.docId;
          return (
            <button key={entry.key} type="button" className={`d3-li${openLecture === id ? " is-on" : ""}`} data-lecture={id}>
              {entry.failed ? <Icon name="alert" size={16} /> : <span className="d3-spin" />}<span className="d3-li-text">{entry.title}</span><small>{entry.failed ? "failed" : "…"}</small>
            </button>
          );
        })}
        {lectures.map((row) => (
          <button key={row.id} type="button" className={`d3-li${openLecture === row.id ? " is-on" : ""}`} data-lecture={row.id} title={row.title}>
            <Wave seed={row.id} /><span className="d3-li-text">{row.title}</span><small>{day(row.createdAt)}</small>
          </button>
        ))}
        {!lectures.length && !busy.length && !view.live.here && <p className="d3-side-empty">no lectures yet — tap Record lecture in class.</p>}
      </div>
      <div className="d3-grp">
        <div className="d3-h4">Create</div>
        <div className="d3-make is-icons">
          {MAKE.map(([type, label, name]) => (
            <button key={type} type="button" className={`d3-make-btn is-${type}`} data-practice-create={type} aria-label={`Create ${name}`} title={label}><Icon name={TOOL_ICON[type] || "notes"} size={18} /><small>{SHORT[type]}</small></button>
          ))}
        </div>
      </div>
      <div className="d3-grp"><MadeList hub={hub} view={view} limit={5} compact /></div>
      <div className="d3-grp"><MaterialList hub={hub} view={view} compact /></div>
    </aside>
  );
}

function MadeList({ hub, view, limit, compact = false }: { hub: DojoHub; view: DojoView; limit: number; compact?: boolean }) {
  const items = view.collection || [];
  const jobs = view.generations || [];
  const seeAll = () => {
    if (view.studio) hub.actions.closeStudio();
    void hub.actions.setTab("practice");
  };
  const isOpen = (item: CollectionItem) => view.tab === "practice" && view.studio?.kind === item.kind && view.studio.id === item.id;
  return (
    <>
      <div className="d3-h4">{WORK}{items.length > 0 && <button type="button" className="d3-h4-link" onClick={seeAll}>{items.length > limit ? `see all ${items.length}` : "see all"}</button>}</div>
      {jobs.map((job) => (
        <div key={job.id} className={`d3-li is-static${job.status === "failed" ? " is-failed" : ""}`} data-gen-id={job.id}>
          {job.status === "failed" ? <Icon name="alert" size={16} /> : <span className="d3-spin" />}
          <span className="d3-li-text">{job.label} · {job.source}</span>
          <small>{job.status === "failed" ? "failed" : job.stage || "making…"}</small>
          {job.status === "failed" && <button type="button" className="d3-iconbtn is-tiny" data-retry-generation={job.id} aria-label="Try again" title="Try again"><Icon name="retry" size={14} /></button>}
        </div>
      ))}
      {items.slice(0, limit).map((item) => (
        <button key={`${item.kind}:${item.id}`} type="button" className={`d3-li${isOpen(item) ? " is-on" : ""}`} {...{ [OPEN_ATTR[item.kind]]: item.id }} disabled={item.preparing} title={item.title}>
          <Icon name={TOOL_ICON[item.type] || "notes"} size={16} className={`d3-tool-ic is-${item.type}`} />
          <span className="d3-li-text">{item.title}</span>
          <small>{item.preparing ? "preparing…" : madeMeta(item, compact)}</small>
        </button>
      ))}
      {!items.length && !jobs.length && <p className="d3-side-empty">flashcards, tests and maps you make show up here.</p>}
    </>
  );
}

function madeMeta(item: CollectionItem, compact: boolean) {
  const progress = item.kind === "deck" ? item.progress : null;
  if (progress?.state === "resume") return `${Math.max(0, progress.total - (progress.seen || 0))} left`;
  if (progress?.state === "done") return `${progress.got}/${progress.total} known`;
  // "Edited Oct 17" already says when, so it needs no second date.
  return compact || /^edited\b/i.test(item.meta || "") ? item.meta : joinMeta(item.meta, day(item.createdAt || ""));
}

function MaterialList({ hub, view, compact = false }: { hub: DojoHub; view: DojoView; compact?: boolean }) {
  const { actions } = hub;
  const items = view.materials || [];
  const pending = view.pendingUploads || [];
  return (
    <>
      <div className="d3-h4">Materials
        <button type="button" className="d3-h4-link" onClick={() => actions.addMaterial("")}><Icon name="plus" size={13} />add</button>
      </div>
      {pending.map((item, index) => (
        <div key={`pending-${index}`} className="d3-li is-static"><span className="d3-spin" /><span className="d3-li-text">{item.name}</span><small>uploading…</small></div>
      ))}
      {items.map((item) => (
        <button key={item.id} type="button" className={`d3-li${view.tab === "materials" && view.previewId === item.id ? " is-on" : ""}`} data-view-source={item.id} title={item.name}>
          <Icon name={MATERIAL_ICON[item.kind] || "file"} size={16} className="d3-mat-ic" />
          <span className="d3-li-text">{item.name}</span>
          <small>{item.status === "reading" ? "reading…" : item.status === "failed" ? "couldn’t read" : compact ? "" : item.pages ? `${item.pages} pages` : MATERIAL_WORD[item.kind] || ""}</small>
        </button>
      ))}
      {!items.length && !pending.length && <p className="d3-side-empty">add your slides, readings or a link — klui uses them in Ask and Create.</p>}
    </>
  );
}

// A small, stable waveform per lecture (decoration only).
function Wave({ seed }: { seed: string }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bars = Array.from({ length: 9 }, () => { h = (h * 1103515245 + 12345) >>> 0; return 4 + (h % 11); });
  return <span className="d3-wave" aria-hidden="true">{bars.map((height, index) => <i key={index} style={{ height }} />)}</span>;
}

