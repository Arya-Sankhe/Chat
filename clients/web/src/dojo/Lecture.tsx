import { navigateTabs } from "./tabs";
// One lecture on a sheet of paper: the live notepad while recording, "klui is writing" after
// Finish, then the notes (with Transcript and Ask on the same page).
import { useLayoutEffect, useRef, useState } from "react";
import { jotsFromText, loadJots } from "../islands/studyLectures.js";
import { Icon, Klui } from "./brand";
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
          <Klui mood={paused ? "" : "listening"} size={44} />
          <div className="d3-listen-copy">
            <strong>{waiting ? "waiting for the microphone…" : paused ? "paused — tap resume when you’re ready" : "klui is listening"}</strong>
            <span>{joinMeta(view.course?.name)} · <span data-live-time>{clock(view.live.elapsed)}</span></span>
          </div>
          <span className="d3-levels" data-live-levels aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} />)}</span>
          <button type="button" className="d3-btn" data-rec-inline-pause="" disabled={waiting}>{paused ? <><Icon name="play" size={12} />resume</> : <><Icon name="pause" size={15} />pause</>}</button>
          <button type="button" className="d3-btn is-filled" data-rec-inline-finish="" disabled={waiting}><Icon name="check" size={15} />finish</button>
        </div>
        <div className="d3-pad">
          <p className="d3-pad-title">new lecture · {day(new Date().toISOString())}</p>
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
              aria-label="Your notes"
              defaultValue={text}
              onInput={(event) => onInput(event.currentTarget.value)}
              placeholder={"jot anything — a question, a “this’ll be on the exam”, or nothing at all."}
            />
          </div>
        </div>
        <p className={`d3-paperfoot${view.live.quiet ? " is-warning" : ""}`} data-rec-quiet>
          {view.live.quiet ? "Klui can barely hear anything. Move closer to the speaker if you can." : "Your recording is saved on this device as you go."}
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
          <Klui mood={failed ? "" : "writing"} size={44} />
          <div className="d3-listen-copy">
            <strong>{failed ? (step === 0 ? "we couldn’t save this recording yet" : step === 1 ? "we couldn’t transcribe this recording" : "we couldn’t write these notes") : step === 0 ? "saving your lecture…" : step === 1 ? "listening back to your lecture…" : "klui is writing your notes…"}</strong>
            <span>{failed ? `your audio${jots.length ? ` and your ${jots.length} ${jots.length === 1 ? "jot" : "jots"}` : ""} are safe` : step === 0 ? "keep this tab open until it’s saved" : "you can leave this page — we’ll keep writing."}</span>
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

type NoteLecture = Extract<OpenLecture, { html: string }>;

function NotePaper({ view, lecture }: { hub: DojoHub; view: DojoView; lecture: NoteLecture }) {
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
            {([["notes", "Notes"], ["transcript", "Transcript"], ["ask", "Ask"]] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" id={`d3-lecture-tab-${key}`} aria-controls="d3-lecture-panel" tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} className={tab === key ? "is-on" : ""} data-lecture-tab={key}>{label}</button>
            ))}
          </div>
          <span className="d3-paper-meta">{meta}</span>
          <Menu label="Lecture options">
            <button type="button" className="d3-mi" role="menuitem" data-lecture-tab="transcript"><Icon name="file" size={16} />transcript</button>
            <button type="button" className="d3-mi is-danger" role="menuitem" data-delete-doc={lecture.id}><Icon name="trash" size={16} />delete lecture</button>
          </Menu>
        </div>
        <div id="d3-lecture-panel" role="tabpanel" aria-labelledby={`d3-lecture-tab-${tab}`} style={{ display: "contents" }}>
        {tab !== "transcript" && lecture.html && (
          <div className="d3-player dojo-lec-strip" data-lec-strip>
            <button type="button" className="d3-pbtn" data-strip-toggle="" aria-label="Play lecture" title="Play lecture"><Icon name="play" size={12} /></button>
            <span className="d3-player-now" data-strip-time>0:00</span>
            <span className="d3-player-track" data-strip-track=""><i data-strip-bar /></span>
            <span className="d3-player-dur">{clock(lecture.duration)}</span>
          </div>
        )}
        {tab === "notes" && !lecture.html && <WritingBody lecture={lecture} />}
        {tab === "notes" && lecture.html && (
          <div className="d3-paper-body" data-lec-scroll>
            <h1>{lecture.title}</h1>
            <div className="d3-studyline">
              <span className="d3-studyline-label">study this</span>
              <button type="button" className="d3-slink" data-practice-create="flashcards"><Icon name="layers" size={16} />flashcards</button>
              <button type="button" className="d3-slink" data-practice-create="quiz"><Icon name="test" size={16} />practice test</button>
              <button type="button" className="d3-slink" data-practice-create="podcast"><Icon name="podcast" size={16} />podcast</button>
              <Menu label="More ways to study" className="d3-studyline-more" align="left" trigger={<span className="d3-slink">more<Icon name="chevD" size={14} /></span>}>
                <button type="button" className="d3-mi" role="menuitem" data-practice-create="mindmap"><Icon name="mindmap" size={16} />mind map</button>
                <button type="button" className="d3-mi" role="menuitem" data-practice-create="notes"><Icon name="notes" size={16} />summary / detailed notes</button>
                <button type="button" className="d3-mi" role="menuitem" data-practice-create="tutor"><Icon name="tutor" size={16} />AI tutor (voice call)</button>
                <button type="button" className="d3-mi" role="menuitem" data-practice-create="whiteboard"><Icon name="pen" size={16} />whiteboard</button>
              </Menu>
            </div>
            {contents.length > 1 && (
              <nav className="d3-contents" aria-label="Contents">
                <b>contents</b>
                {contents.map((item) => <button type="button" key={item.id} onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{item.text}</button>)}
              </nav>
            )}
            <div className="d3-note dojo-lec-body" ref={body} dangerouslySetInnerHTML={{ __html: lecture.html }} />
          </div>
        )}
        {tab === "transcript" && <div className="d3-paper-body is-transcript"><div className="dojo-lec-audio-slot" /></div>}
        {tab === "ask" && (
          <div className="d3-paper-body is-ask">
            <div className="d3-scope"><Icon name="lock" size={14} />this lecture · {lecture.title}</div>
            <div className="dojo-chat-content d3-chat">
              <div className="dojo-messages-slot" />
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
          </div>
        )}
        </div>
        <div className="d3-paperfoot is-ask">
          {tab === "ask"
            ? <div className="study-composer-slot" />
            : (
              <button type="button" className="d3-askbar" data-lecture-tab="ask">
                <Klui mood="happy" size={24} />
                <span>ask about this lecture…</span>
                <span className="d3-sendbtn"><Icon name="send" size={16} /></span>
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
