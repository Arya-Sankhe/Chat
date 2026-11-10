// Lecture notes: what a recorded lecture becomes once it is transcribed. The model reads the
// timed transcript and anything the student typed during class, and writes study notes in
// which every point links back to the moment it was said ([mm:ss]) and the student's own
// lines are kept, marked ⟦like this⟧, so the page can show which words were theirs.

import { HttpError } from "../http/responses.js";

export const LECTURE_NOTE_MARK = "<!--klui:lecture-->";
const TRANSCRIPT_CAP = 160_000;
const JOT_LINES = 200;
const JOT_CHARS = 400;

// Every style keeps the same ground rules: a short H1 title, [mm:ss] times from the
// transcript, the student's own words kept inside ⟦ ⟧, and nothing the recording didn't say.
const TITLE_RULE = "# A short title naming the topic, 2–6 words, e.g. # Cell Cycle Checkpoints (never \"Lecture notes\", \"Meeting minutes\", a date or the file name)";
const TIME_RULE = "End every bullet with the time it comes from, written exactly like [12:41] (the start time of the transcript line it relies on). Use only times that appear in the transcript.";
const JOT_RULE = "If the student typed notes: keep each meaningful line, copied word for word inside ⟦ and ⟧, as the start of the bullet it belongs to, then complete it with what the recording actually said, e.g. - ⟦G2/M → DNA damage?⟧ — damage keeps CDK1 switched off, so the cell can't start mitosis. [04:12]";
const CLOSING_RULE = "Skip greetings, admin and small talk unless the style asks for it. Fix obvious transcription slips using context, but never add facts the recording didn't say.";

// The ways a recording can be written up. "lecture" is the default.
export const LECTURE_STYLES = {
  lecture: {
    label: "Class notes",
    role: "You turn a recorded university lecture into the notes a top student would want to revise from.",
    shape: [
      TITLE_RULE,
      "**In short:** two sentences on what the lecture was about and the one idea to remember.",
      "Then 2–6 ## sections that follow the lecture's own structure. Under each, bullets: one idea per bullet, written plainly and concisely, keeping definitions, mechanisms, formulas, worked examples and numbers exact.",
      TIME_RULE,
      "When the lecturer explicitly says something matters (\"this will be on the exam\", \"make sure you know\", \"remember this\"), add a blockquote right after that point: > **Your lecturer stressed this:** \"their words, lightly cleaned up\" [mm:ss]. Never invent emphasis or predict exam questions.",
      JOT_RULE,
      "If the student typed questions (lines with ?, ASK, why, how), add a final ## Your questions section answering each from the lecture, starting with the question inside ⟦ ⟧. If the lecture doesn't answer one, say so briefly."
    ]
  },
  recap: {
    label: "Quick recap",
    role: "You turn a recording into a short recap someone can read in two minutes.",
    shape: [
      TITLE_RULE,
      "**In short:** two sentences on what it was about and the one idea to remember.",
      "## Key points: 5–8 bullets, the most important ideas only, one short line each.",
      "## Worth remembering: up to 4 bullets with exact definitions, formulas or numbers, only if the recording gave any.",
      TIME_RULE,
      JOT_RULE
    ]
  },
  cornell: {
    label: "Cornell notes",
    role: "You turn a recorded lecture into Cornell-style notes for self-testing.",
    shape: [
      TITLE_RULE,
      "Then 2–6 ## sections that follow the lecture's own structure. Each section is a markdown table with two columns, | Cue | Notes |: the cue is a short question or keyword a student would quiz themselves with, the notes are the answer in one or two plain sentences ending with its time.",
      "End with ## Summary: three or four sentences tying the lecture together.",
      "End every Notes cell with the time it comes from, written exactly like [12:41]. Use only times that appear in the transcript.",
      "If the student typed notes, keep each meaningful line word for word inside ⟦ and ⟧ at the start of the Notes cell it belongs to."
    ]
  },
  guide: {
    label: "Study guide",
    role: "You turn a recorded lecture into a study guide for revising before a test.",
    shape: [
      TITLE_RULE,
      "## Key terms: bullets of **term** — exact definition as given.",
      "## Main ideas: bullets, one idea each, with mechanisms, formulas and worked examples kept exact.",
      "## Check yourself: 5–8 questions that the lecture answers, each followed on the next line by a short answer.",
      TIME_RULE,
      JOT_RULE
    ]
  },
  minutes: {
    label: "Meeting minutes",
    role: "You turn a recorded meeting into clear, neutral minutes.",
    shape: [
      TITLE_RULE,
      "**Summary:** two sentences on what the meeting was for and where it landed.",
      "## Discussion: bullets per topic, in the order discussed, noting the different views raised. Name people only if the recording names them.",
      "## Decisions: bullets of what was agreed. Write \"None recorded\" if nothing was decided.",
      "## Action items: bullets of - [ ] the task — owner, deadline (only owners and deadlines the recording states).",
      "## Open questions: anything left unresolved, if any.",
      TIME_RULE,
      JOT_RULE
    ]
  }
};

export function lectureStyle(value) {
  return Object.hasOwn(LECTURE_STYLES, value) ? value : "lecture";
}

export function lectureNotesSystemPrompt(style = "lecture") {
  const picked = LECTURE_STYLES[lectureStyle(style)];
  return [
    picked.role,
    "You get the transcript, one line per moment as [mm:ss] text, and sometimes the student's own notes typed during it, each with the time it was typed.",
    "Reply with clean markdown only, with no code fences and no commentary, in this shape:",
    ...picked.shape,
    CLOSING_RULE
  ].join("\n");
}

export const LECTURE_NOTES_SYSTEM_PROMPT = lectureNotesSystemPrompt("lecture");

// A remade note records its style right after the lecture mark: <!--klui:style:minutes-->.
export function lectureStyleMark(style) {
  const picked = lectureStyle(style);
  return picked === "lecture" ? "" : `<!--klui:style:${picked}-->\n`;
}

export function lectureStyleOf(content) {
  const match = /^<!--klui:lecture-->\n?<!--klui:style:([a-z]+)-->/.exec(String(content || ""));
  return lectureStyle(match?.[1]);
}

// The student's own lines, read back out of written notes so a remake keeps them:
// each ⟦line⟧ with the first [mm:ss] after it on the same line.
export function jotsFromNote(content) {
  const jots = [];
  for (const line of String(content || "").split("\n")) {
    const time = /\[(\d+(?::\d{2}){1,2})\]/.exec(line);
    const seconds = time ? time[1].split(":").reduce((total, n) => total * 60 + Number(n), 0) : 0;
    for (const match of line.matchAll(/⟦([\s\S]*?)⟧/g)) jots.push({ t: seconds, text: match[1] });
  }
  return cleanJots(jots);
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function isLectureNote(note) {
  return String(note?.content || "").startsWith(LECTURE_NOTE_MARK);
}

export function cleanJots(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((jot) => ({
      t: Math.max(0, Number(jot?.t) || 0),
      text: String(jot?.text || "").replace(/[⟦⟧]/g, "").replace(/\s+/g, " ").trim().slice(0, JOT_CHARS)
    }))
    .filter((jot) => jot.text)
    .slice(0, JOT_LINES);
}

export function transcriptLines(documentFile) {
  const meta = documentFile?.metadata && typeof documentFile.metadata === "object" ? documentFile.metadata : {};
  const segments = Array.isArray(meta.segments) ? meta.segments : [];
  return segments
    .filter((line) => Array.isArray(line) && line.length >= 3 && String(line[2] || "").trim())
    .map(([start, , text]) => `[${formatClock(start)}] ${String(text).trim()}`);
}

export function buildLectureInput({ documentFile, jots = [] }) {
  if (documentFile?.kind !== "audio") throw new HttpError(400, "Lecture notes need a recorded lecture.");
  const lines = transcriptLines(documentFile);
  if (!lines.length) throw new HttpError(409, "This lecture has no transcript yet.");
  let transcript = "";
  for (const line of lines) {
    if (transcript.length + line.length + 1 > TRANSCRIPT_CAP) break;
    transcript += `${line}\n`;
  }
  const typed = cleanJots(jots);
  const parts = [`Transcript:\n${transcript.trim()}`];
  if (typed.length) parts.push(`The student's own notes, typed during class:\n${typed.map((jot) => `[${formatClock(jot.t)}] ${jot.text}`).join("\n")}`);
  else parts.push("The student did not type anything during this recording.");
  return parts.join("\n\n");
}
