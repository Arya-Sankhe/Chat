// Dojo lectures: record in class, type if you like, and Klui writes the notes.
// Markup helpers for the lecture list, the recording page, the "writing your notes" state,
// and the finished notes, plus the jots a student types while recording (kept on this device
// until the notes are written).

import { kluiSvgMarkup } from "./klui.js";

export const LECTURE_NOTE_MARK = "<!--klui:lecture-->";
const JOTS_PREFIX = "klui.dojo.jots.";
let kluiId = 0;

export function isLectureNote(note) {
  return String(note?.content || "").startsWith(LECTURE_NOTE_MARK);
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
  return readJots(key)?.lines || [];
}

export function saveJots(key, lines) {
  if (!key) return;
  try {
    if (lines.some((line) => line.text.trim())) localStorage.setItem(JOTS_PREFIX + key, JSON.stringify({ lines, savedAt: Date.now() }));
    else localStorage.removeItem(JOTS_PREFIX + key);
  } catch { /* Storage is optional; the notes are written from the lecture alone. */ }
}

export function moveJots(from, to) {
  const saved = readJots(from);
  if (!saved || !to) return;
  try {
    localStorage.setItem(JOTS_PREFIX + to, JSON.stringify(saved));
    localStorage.removeItem(JOTS_PREFIX + from);
  } catch { /* Storage is optional. */ }
}

export function forgetJots(key) {
  try { localStorage.removeItem(JOTS_PREFIX + key); } catch { /* Storage is optional. */ }
}

// Each line of the notepad keeps the moment it was first typed, so the notes can put it in place.
export function jotsFromText(text, previous, now) {
  const lines = String(text || "").split("\n");
  return lines.map((line, index) => {
    const before = previous[index];
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

export function hasMine(body) {
  return /⟦[\s\S]*?⟧/.test(String(body || ""));
}
