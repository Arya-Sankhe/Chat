import { Slot } from "./Slot";
import { LectureMenu } from "./LectureMenu";
import { navigateTabs } from "./tabs";
// One lecture on a sheet of paper: the live notepad while recording, "klui is writing" after
// Finish, then the notes (with Transcript and Ask on the same page).
import { useLayoutEffect, useRef, useState } from "react";
import { jotsFromText, loadJots } from "../islands/studyLectures.js";
import { Buddy, Icon } from "./brand";
import { clock, day, joinMeta, minutes } from "./fmt";
import { Menu } from "./Menu";
import type { DojoHub, DojoView, Jot, OpenLecture } from "./types";

export function LecturePage({ hub, view, lecture }: { hub: DojoHub; view: DojoView; lecture: OpenLecture }) {
  if (lecture.kind === "live") return <Recording view={view} jots={lecture.jots} recordingId={lecture.recordingId} />;
  // Once transcribed, the paper (with Transcript and Ask) is there even while notes are written.
  if (!("html" in lecture) || lecture.entry) return <Writing lecture={lecture} />;
  return <NotePaper hub={hub} view={view} lecture={lecture} />;
}

/* ---------- Recording ---------- */

function Recording({ view, jots, recordingId }: { view: DojoView; jots: Jot[]; recordingId: string }) {
  const waiting = view.live.state === "requesting";
  const paused = view.live.state === "paused";
  const [text, setText] = useState(() => jots.map((line) => line.text).join("\n"));
  const [times, setTimes] = useState<Jot[]>(jots);
  const area = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<number[]>([]);
  // The gutter shows when each line was first written; the engine saved the real times.
  const onInput = (value: string) => {
    setText(value);
    requestAnimationFrame(() => {
      setTimes(recordingId ? loadJots(recordingId) : jotsFromText(value, times, view.live.elapsed));
    });
  };
  useLayoutEffect(() => {
    const node = mirror.current;
    if (!node) return;
    setTops([...node.children].map((child) => (child as HTMLElement).offsetTop));
  }, [text]);
  const lines = text.split("\n");
  const timeFor = (line: string, index: number) => {
    if (!line.trim()) return "";
    const match = times.filter((item) => item.text === line.trim());
    const hit = match[0] || times[index];
    return hit ? clock(hit.t) : "";
  };
  return (
    <div className="d3-stage">
      <div className="d3-paper is-recording" data-live>
        <div className={`d3-listen${paused ? " is-paused" : ""}${waiting ? " is-waiting" : ""}`}>
          <Buddy mood={paused || waiting ? "paused" : "listening"} />
          <div className="d3-listen-copy">
            <strong>{waiting ? "finding your mic…" : paused ? "taking a breather" : "locked in — i’ll take the notes"}</strong>
            <span>{joinMeta(view.course?.name)} · <span data-live-time>{clock(view.live.elapsed)}</span></span>
          </div>
          <span className="d3-levels" data-live-levels aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} />)}</span>
          <button type="button" className="d3-btn" data-rec-inline-pause="" disabled={waiting}>{paused ? <><Icon name="play" size={12} />resume</> : <><Icon name="pause" size={15} />pause</>}</button>
          <button type="button" className="d3-btn is-filled" data-rec-inline-finish="" disabled={waiting}><Icon name="check" size={15} />finish</button>
        </div>
        <div className="d3-pad">
          <p className="d3-pad-title"><b>your jots</b> · {day(new Date().toISOString())}</p>
          <p className="d3-pad-hint">anything you type lands in your notes, next to the moment it was said.</p>
          <div className="d3-pad-box">
            <div className="d3-pad-gutter" aria-hidden="true">
              {lines.map((line, index) => {
                const label = timeFor(line, index);
                return label ? <span key={index} style={{ top: tops[index] || 0 }}>{label}</span> : null;
              })}
            </div>
            <div className="d3-pad-mirror" ref={mirror} aria-hidden="true">
              {lines.map((line, index) => <div key={index}>{line || "​"}</div>)}
            </div>
            <textarea
              ref={area}
              className="d3-pad-text"
              data-jots=""
              spellCheck
              aria-label="Your jots"
              defaultValue={text}
              onInput={(event) => onInput(event.currentTarget.value)}
              placeholder={"a question, a “this’ll be on the exam”, a thought… or nothing at all."}
            />
          </div>
        </div>
        <p className={`d3-paperfoot${view.live.quiet ? " is-warning" : ""}`} data-rec-quiet>
          {view.live.quiet ? "Klui can barely hear anything. Move closer to the speaker if you can." : ""}
        </p>
      </div>
    </div>
  );
}

/* ---------- Writing ---------- */

function Writing({ lecture }: { lecture: Exclude<OpenLecture, { kind: "live" }> }) {
  return (
    <div className="d3-stage">
      <div className="d3-paper is-writing" role="status"><WritingBody lecture={lecture} /></div>
    </div>
  );
}

function WritingBody({ lecture }: { lecture: Exclude<OpenLecture, { kind: "live" }> }) {
  const entry = lecture.entry;
  const noteError = "noteError" in lecture ? lecture.noteError || "" : "";
  const uploading = Boolean(entry?.uploadId);
  const transcribing = Boolean(entry?.docId);
  const step = uploading ? 0 : transcribing ? 1 : 2;
  const failed = Boolean(entry?.failed || (!entry && noteError && !("writing" in lecture && lecture.writing)));
  const raw = entry?.failed ? entry.error : noteError;
  // A bare server code (e.g. transcription_queue_full) isn't something to show a student.
  const error = /^[a-z0-9_]+$/.test(raw || "")
    ? (raw.includes("queue_full") ? "You already have several recordings waiting. Try again once one finishes." : "Something went wrong. Please try again.")
    : raw;
  const jots = lecture.jots.filter((line) => line.text.trim());
  const labels = ["saved", "transcribed", "writing your notes"];
  const doing = ["saving your recording", "transcribing", "writing your notes"];
  const target = entry?.uploadId ? { "data-audio-upload": entry.uploadId } : entry?.docId ? { "data-audio-doc": entry.docId } : {};
  return (
    <>
        <div className="d3-listen is-writing">
          <Buddy mood={failed ? "sad" : "writing"} />
          <div className="d3-listen-copy">
            <strong>{failed ? (step === 0 ? "we couldn’t save this recording yet" : step === 1 ? "we couldn’t transcribe this recording" : "we couldn’t write these notes") : step === 0 ? "saving your lecture…" : step === 1 ? "on it — turning this into notes" : "almost there — writing it up"}</strong>
            <span>{failed ? `your audio${jots.length ? ` and your ${jots.length} ${jots.length === 1 ? "jot" : "jots"}` : ""} are safe` : step === 0 ? "keep this tab open for a sec" : "feel free to leave — i’ll keep going"}</span>
          </div>
        </div>
        <div className="d3-paper-body">
          <h1>{lecture.title}</h1>
          <ol className="d3-steps">
            {labels.map((label, index) => {
              const done = index < step;
              const now = index === step;
              return (
                <li key={label} className={done ? "is-done" : now ? (failed ? "is-failed" : "is-now") : ""}>
                  <span className="d3-step-dot" aria-hidden="true">{done ? <Icon name="check" size={14} /> : now && failed ? <Icon name="alert" size={14} /> : now ? <span className="d3-spin" /> : null}</span>
                  <span>{now ? doing[index] : label}{now && index === 2 && jots.length > 0 && !failed ? ` — weaving in your ${jots.length} ${jots.length === 1 ? "jot" : "jots"}` : ""}</span>
                  {now && entry && !entry.failed && <small data-audio-center={entry.key}>{entry.detail}</small>}
                </li>
              );
            })}
          </ol>
          {failed && <p className="d3-error">{error || "Please try again."}</p>}
          {failed && (entry
            ? <button type="button" className="d3-btn is-filled" data-audio-retry="" {...target}><Icon name="retry" size={15} />try again</button>
            : "id" in lecture && <button type="button" className="d3-btn is-filled" data-lecture-retry={lecture.id}><Icon name="retry" size={15} />try again</button>)}
          {jots.length > 0 && (
            <div className="d3-kept">
              <p className="d3-kept-title">your words — kept safe</p>
              {jots.map((line, index) => <p key={index}><span className="d3-ts is-static"><Icon name="play" size={9} />{clock(line.t)}</span>{line.text}</p>)}
            </div>
          )}
          {!failed && <div className="d3-skeleton" aria-hidden="true"><span /><span /><span className="is-short" /><span /><span className="is-short" /></div>}
        </div>
    </>
  );
}

/* ---------- Finished notes ---------- */

// The ways the same transcript can be written up; the server has the matching prompts.
const NOTE_STYLES = [
  ["lecture", "Class notes", "sections that follow the lecture"],
  ["recap", "Quick recap", "the key points, two-minute read"],
  ["cornell", "Cornell notes", "cues and answers to quiz yourself"],
  ["guide", "Study guide", "terms, main ideas, check-yourself questions"],
  ["minutes", "Meeting minutes", "discussion, decisions, action items"]
] as const;

const styleLabel = (key = "lecture") => NOTE_STYLES.find(([id]) => id === key)?.[1] || "Class notes";

function NoteStyle({ hub, lecture }: { hub: DojoHub; lecture: NoteLecture }) {
  const current = lecture.restyling || lecture.style || "lecture";
  return (
    <Menu label="Note style" className="d3-stylemenu" trigger={<span className="d3-stylebtn"><Icon name="notes" size={14} />{styleLabel(current)}<Icon name="chevD" size={13} /></span>}>
      <p className="d3-menu-head">rewrite these notes as…</p>
      {NOTE_STYLES.map(([key, label, hint]) => (
        <button key={key} type="button" role="menuitemradio" aria-checked={current === key} disabled={Boolean(lecture.restyling)} className={`d3-mi d3-style-item${current === key ? " is-current" : ""}`} onClick={() => hub.actions.restyleLecture(key)}>
          <span className="d3-style-copy"><b>{label}</b><small>{hint}</small></span>
          {current === key && <Icon name="check" size={15} />}
        </button>
      ))}
    </Menu>
  );
}

type NoteLecture = Extract<OpenLecture, { html: string }>;

function NotePaper({ hub, view, lecture }: { hub: DojoHub; view: DojoView; lecture: NoteLecture }) {
  const tab = lecture.tab;
  const body = useRef<HTMLDivElement>(null);
  const [contents, setContents] = useState<{ id: string; text: string }[]>([]);
  useLayoutEffect(() => {
    if (tab !== "notes" || !body.current) { setContents([]); return; }
    const heads = [...body.current.querySelectorAll("h2")];
    heads.forEach((head, index) => { head.id = `d3-sec-${index}`; });
    setContents(heads.slice(0, 7).map((head, index) => ({ id: `d3-sec-${index}`, text: head.textContent || "" })));
  }, [lecture.html, tab]);
  const meta = joinMeta(day(lecture.createdAt), minutes(lecture.duration), view.course?.name);
  return (
    <div className="d3-stage">
      <div className={`d3-paper is-note is-${tab}`}>
        <div className="d3-paper-top">
          <div className="d3-seg" role="tablist" onKeyDown={navigateTabs} aria-label="Lecture">
            {([["notes", "Notes"], ["transcript", "Transcript"]] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" id={`d3-lecture-tab-${key}`} aria-controls="d3-lecture-panel" tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} className={tab === key ? "is-on" : ""} data-lecture-tab={key}>{label}</button>
            ))}
          </div>
          {tab === "notes" && lecture.html && <NoteStyle hub={hub} lecture={lecture} />}
          <span className="d3-paper-meta">{meta}</span>
          <LectureMenu hub={hub} view={view} id={lecture.id} title={lecture.title} />
        </div>
        <div id="d3-lecture-panel" role="tabpanel" aria-labelledby={`d3-lecture-tab-${tab}`} style={{ display: "contents" }}>
        {tab === "notes" && !lecture.html && <WritingBody lecture={lecture} />}
        {tab === "notes" && lecture.html && (
          <div className="d3-paper-body" data-lec-scroll>
            <h1>{lecture.title}</h1>
            <div className="d3-studyline">
              <span className="d3-studyline-label">study this</span>
              <button type="button" className="d3-slink is-flashcards" data-practice-create="flashcards"><Icon name="layers" size={16} />flashcards</button>
              <button type="button" className="d3-slink is-quiz" data-practice-create="quiz"><Icon name="test" size={16} />practice test</button>
              <button type="button" className="d3-slink is-podcast" data-practice-create="podcast"><Icon name="podcast" size={16} />podcast</button>
              <Menu label="More ways to study" className="d3-studyline-more" align="left" trigger={<span className="d3-slink">more<Icon name="chevD" size={14} /></span>}>
                <button type="button" className="d3-mi is-mindmap" role="menuitem" data-practice-create="mindmap"><Icon name="mindmap" size={16} />mind map</button>
                <button type="button" className="d3-mi is-notes" role="menuitem" data-practice-create="notes"><Icon name="notes" size={16} />summary / detailed notes</button>
                <button type="button" className="d3-mi is-tutor" role="menuitem" data-practice-create="tutor"><Icon name="tutor" size={16} />AI tutor (voice call)</button>
                <button type="button" className="d3-mi is-whiteboard" role="menuitem" data-practice-create="whiteboard"><Icon name="pen" size={16} />whiteboard</button>
              </Menu>
            </div>
            {contents.length > 1 && (
              <nav className="d3-contents" aria-label="Contents">
                <b>contents</b>
                {contents.map((item) => <button type="button" key={item.id} onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{item.text}</button>)}
              </nav>
            )}
            {lecture.restyling && (
              <div className="d3-restyle" role="status"><Buddy mood="writing" size={26} /><span>rewriting as {styleLabel(lecture.restyling).toLowerCase()}</span><span className="d3-dots" aria-hidden="true"><i /><i /><i /></span></div>
            )}
            <div className={`d3-note dojo-lec-body${lecture.restyling ? " is-restyling" : ""}`} ref={body} dangerouslySetInnerHTML={{ __html: lecture.html }} />
          </div>
        )}
        {tab === "transcript" && <div className="d3-paper-body is-transcript"><Slot className="dojo-lec-audio-slot" /></div>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Ask about one lecture ---------- */

// The lecture's own chat (scoped to it by the engine); the composer and messages are the chat core's.
export function LectureAsk({ view, title }: { view: DojoView; title: string }) {
  return (
    <div className="d3-tabbody d3-ask">
      <div className="d3-scope"><Icon name="lock" size={14} />this lecture · {title}</div>
      <div className="dojo-chat-content d3-chat">
        <Slot className="dojo-messages-slot" />
        {!view.hasMessages && (
          <div className="d3-chat-welcome">
            <h2>ask about this lecture</h2>
            <div className="d3-prompts">
              {[["key points", "What are the key points of this lecture?"], ["hardest part", "Explain the hardest part of this lecture simply"], ["quiz me", "Ask me 3 questions about this lecture"]].map(([label, prompt]) => (
                <button key={label} type="button" data-dojo-prompt={prompt}>{label}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Slot className="d3-composer study-composer-slot" />
    </div>
  );
}
