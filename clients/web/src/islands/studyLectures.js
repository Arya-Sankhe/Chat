// Dojo lectures: record in class, type if you like, and Klui writes the notes.
// Markup helpers for the lecture list, the recording page, the "writing your notes" state,
// and the finished notes, plus the jots a student types while recording (kept on this device
// until the notes are written).

import { kluiSvgMarkup } from "./klui.js";

export const LECTURE_NOTE_MARK = "<!--klui:lecture-->";
const JOTS_PREFIX = "klui.dojo.jots.";
// The jots in this tab. Storage is only a backup, so a full or blocked storage loses nothing here.
const jotsMemory = new Map();
let kluiId = 0;

export function isLectureNote(note) {
  return String(note?.content || "").startsWith(LECTURE_NOTE_MARK);
}

// Which way the notes are written (class notes unless remade): <!--klui:style:minutes-->.
export function lectureStyleOf(note) {
  const match = /^<!--klui:lecture-->\n?<!--klui:style:([a-z]+)-->/.exec(String(note?.content || ""));
  return match?.[1] || "lecture";
}

export function lectureNoteFor(notes, docId) {
  return (notes || []).find((note) => note.document_file_id === docId && isLectureNote(note)) || null;
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function clockSeconds(text) {
  const parts = String(text).split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

/* ---------- Jots: what the student typed during the lecture ---------- */

function readJots(key) {
  try {
    const value = JSON.parse(localStorage.getItem(JOTS_PREFIX + key) || "null");
    return value && Array.isArray(value.lines) ? value : null;
  } catch {
    return null;
  }
}

export function loadJots(key) {
  return jotsMemory.get(key) || readJots(key)?.lines || [];
}

// Returns false when the device backup failed (the jots still live in this tab).
export function saveJots(key, lines) {
  if (!key) return true;
  jotsMemory.set(key, lines);
  try {
    if (lines.some((line) => line.text.trim())) localStorage.setItem(JOTS_PREFIX + key, JSON.stringify({ lines, savedAt: Date.now() }));
    else localStorage.removeItem(JOTS_PREFIX + key);
    return true;
  } catch {
    return false;
  }
}

export function moveJots(from, to) {
  const lines = loadJots(from);
  if (!lines.length || !to) return;
  jotsMemory.set(to, lines);
  jotsMemory.delete(from);
  try {
    localStorage.setItem(JOTS_PREFIX + to, JSON.stringify({ lines, savedAt: Date.now() }));
    localStorage.removeItem(JOTS_PREFIX + from);
  } catch { /* The copy in memory carries them to the notes. */ }
}

export function forgetJots(key) {
  jotsMemory.delete(key);
  try { localStorage.removeItem(JOTS_PREFIX + key); } catch { /* Storage is optional. */ }
}

// Each line of the notepad keeps the moment it was first typed, so the notes can put it in place.
// Lines unchanged at the start and end keep their times; in the edited middle, lines edited in
// place keep theirs and newly added lines get now.
export function jotsFromText(text, previous, now) {
  const lines = String(text || "").split("\n");
  const old = previous || [];
  let head = 0;
  while (head < lines.length && head < old.length && lines[head] === old[head].text) head += 1;
  let tail = 0;
  while (tail < lines.length - head && tail < old.length - head && lines[lines.length - 1 - tail] === old[old.length - 1 - tail].text) tail += 1;
  return lines.map((line, index) => {
    let before = null;
    if (index < head) before = old[index];
    else if (index >= lines.length - tail) before = old[old.length - (lines.length - index)];
    else before = old[head + (index - head)] && head + (index - head) < old.length - tail ? old[head + (index - head)] : null;
    const t = before && (before.text.trim() || !line.trim()) ? before.t : now;
    return { t, text: line };
  });
}

/* ---------- Mascot ---------- */

export function kluiMarkup(mood = "", size = 32) {
  kluiId += 1;
  return `<span class="dojo-klui" data-mood="${mood}" style="--klui-size:${size}px" aria-hidden="true">${kluiSvgMarkup(`dojo-klui-${kluiId}`)}</span>`;
}

/* ---------- Notes ---------- */

// The model marks the student's own words ⟦like this⟧ and ends points with [mm:ss].
export function lectureNoteHtml(html, escapeHtml) {
  return String(html || "")
    .replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/, "")
    .replace(/⟦([\s\S]*?)⟧/g, (_, text) => `<mark class="dojo-mine">${text}</mark>`)
    .replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (_, time) => `<button class="dojo-cite" type="button" data-cite-time="${clockSeconds(time)}" title="Play from ${escapeHtml(time)}">${escapeHtml(time)}</button>`);
}

// Lecture notes opened outside their lecture (e.g. the recording was removed): highlights, no playback.
export function lectureNoteStaticHtml(html) {
  return String(html || "").replace(/⟦([\s\S]*?)⟧/g, (_, text) => `<mark class="dojo-mine">${text}</mark>`);
}

export function hasMine(body) {
  return /⟦[\s\S]*?⟧/.test(String(body || ""));
}
