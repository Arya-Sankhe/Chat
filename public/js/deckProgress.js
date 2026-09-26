// Flashcard progress per deck, kept on this device so a closed review can resume
// and a finished one can hand its missed cards to the next visit.
const STORAGE_KEY = "klui.dojo.deckProgress.v1";
const MAX_DECKS = 80;

function readAll() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch { /* Storage is optional. */ }
}

export function readDeckProgress(deckId) {
  if (!deckId) return null;
  const record = readAll()[deckId];
  return record && Array.isArray(record.order) ? record : null;
}

export function writeDeckProgress(deckId, record) {
  if (!deckId) return;
  const all = readAll();
  all[deckId] = { ...record, updatedAt: Date.now() };
  const ids = Object.keys(all);
  if (ids.length > MAX_DECKS) {
    ids.sort((a, b) => (all[a].updatedAt || 0) - (all[b].updatedAt || 0))
      .slice(0, ids.length - MAX_DECKS)
      .forEach((id) => delete all[id]);
  }
  writeAll(all);
}

export function clearDeckProgress(deckId) {
  const all = readAll();
  if (!(deckId in all)) return;
  delete all[deckId];
  writeAll(all);
}

// Splits a round's cards by how they were marked: 1 = missed, 3 = got it, none = skipped.
export function deckBuckets(cards, marks = {}) {
  const buckets = { missed: [], skipped: [], got: [] };
  for (const card of cards || []) {
    const mark = marks[card.id];
    buckets[mark === 3 ? "got" : mark === 1 ? "missed" : "skipped"].push(card);
  }
  return buckets;
}

// What the deck view should offer, from a saved record and the deck's current card ids.
export function deckProgressSummary(record, cardIds) {
  if (!record) return null;
  const live = new Set(cardIds || []);
  const order = record.order.filter((id) => !cardIds || live.has(id));
  if (!order.length) return null;
  const marks = record.marks || {};
  let got = 0;
  let missed = 0;
  for (const id of order) {
    if (marks[id] === 3) got += 1;
    else if (marks[id] === 1) missed += 1;
  }
  const total = order.length;
  if (!record.done) {
    const seen = Math.min(total, Math.max(1, (record.index || 0) + 1));
    return got + missed || record.index ? { state: "resume", seen, total, got, missed, round: record.round || 1 } : null;
  }
  return { state: "done", total, got, missed, revisit: total - got, round: record.round || 1 };
}
