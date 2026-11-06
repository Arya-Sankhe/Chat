// Lecture notes: what a recorded lecture becomes once it is transcribed. The model reads the
// timed transcript and anything the student typed during class, and writes study notes in
// which every point links back to the moment it was said ([mm:ss]) and the student's own
// lines are kept, marked ⟦like this⟧, so the page can show which words were theirs.

import { HttpError } from "../http/responses.js";

export const LECTURE_NOTE_MARK = "<!--klui:lecture-->";
const TRANSCRIPT_CAP = 160_000;
const JOT_LINES = 200;
const JOT_CHARS = 400;

export const LECTURE_NOTES_SYSTEM_PROMPT = [
  "You turn a recorded university lecture into the notes a top student would want to revise from.",
  "You get the lecture transcript, one line per moment as [mm:ss] text, and sometimes the student's own notes typed during class, each with the time it was typed.",
  "Reply with clean markdown only, with no code fences and no commentary, in this shape:",
  "# A short, specific title for the lecture (the topic, not \"Lecture notes\")",
  "**In short:** two sentences on what the lecture was about and the one idea to remember.",
  "Then 2–6 ## sections that follow the lecture's own structure. Under each, bullets: one idea per bullet, written plainly and concisely, keeping definitions, mechanisms, formulas, worked examples and numbers exact.",
  "End every bullet with the time it comes from, written exactly like [12:41] (the start time of the transcript line it relies on). Use only times that appear in the transcript.",
  "When the lecturer explicitly says something matters (\"this will be on the exam\", \"make sure you know\", \"remember this\"), add a blockquote right after that point: > **Your lecturer stressed this:** \"their words, lightly cleaned up\" [mm:ss]. Never invent emphasis or predict exam questions.",
  "If the student typed notes: keep each meaningful line, copied word for word inside ⟦ and ⟧, as the start of the bullet it belongs to, then complete it with what the lecture actually said, e.g. - ⟦G2/M → DNA damage?⟧ — damage keeps CDK1 switched off, so the cell can't start mitosis. [04:12]",
  "If the student typed questions (lines with ?, ASK, why, how), add a final ## Your questions section answering each from the lecture, starting with the question inside ⟦ ⟧. If the lecture doesn't answer one, say so briefly.",
  "Skip greetings, admin and small talk. Fix obvious transcription slips using context, but never add facts the lecture didn't say."
].join("\n");

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
  const parts = [`Lecture transcript:\n${transcript.trim()}`];
  if (typed.length) parts.push(`The student's own notes, typed during class:\n${typed.map((jot) => `[${formatClock(jot.t)}] ${jot.text}`).join("\n")}`);
  else parts.push("The student did not type anything during this lecture.");
  return parts.join("\n\n");
}
