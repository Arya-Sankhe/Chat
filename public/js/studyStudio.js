// Markup for decks, notes, and tests opened inside the Create panel.
// studyHub owns the state and events; everything here is a pure function of it.
import { questionMarks, testSummary } from "./studyTest.js";

export const DECK_LAYOUTS = [["flip", "Flip"], ["column", "Column"], ["list", "List"], ["toggle", "Toggle"], ["typing", "Typing"]];
export const DECK_SORTS = [["original", "Original order"], ["source", "Source page"], ["alpha", "A–Z"], ["starred", "Starred first"]];

const svg = paths => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  back: svg('<path d="M19 12H5m6-6-6 6 6 6"/>'),
  full: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'),
  sort: svg('<path d="M7 4v16m0 0-3-3m3 3 3-3M14 6h6m-6 6h4m-4 6h2"/>'),
  learn: svg('<path d="m2 9 10-5 10 5-10 5-10-5ZM6 11v6c4 3 8 3 12 0v-6"/>'),
  play: svg('<path d="M7 5v14l11-7z"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  prev: svg('<path d="m15 18-6-6 6-6"/>'),
  next: svg('<path d="m9 18 6-6-6-6"/>'),
  enter: svg('<path d="M20 5v7a3 3 0 0 1-3 3H5m4-4-4 4 4 4"/>'),
  column: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16"/>'),
  list: svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>'),
  toggle: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  typing: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>'),
  flip: svg('<rect x="5" y="3" width="14" height="18" rx="2" stroke-dasharray="3 3"/><path d="M12 3v18"/>'),
  arrowPrev: svg('<path d="M19 12H5m6-6-6 6 6 6"/>'),
  arrowNext: svg('<path d="M5 12h14m-6-6 6 6-6 6"/>'),
  miss: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  got: svg('<path d="m5 12 5 5L20 7"/>'),
  again: svg('<path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5"/>')
};

function cardText(text, escapeHtml) {
  return escapeHtml(text || "").replaceAll("___", '<span class="study-blank" aria-label="blank"></span>');
}

function firstPage(card) {
  const page = (card.sources || []).find(item => item.page)?.page;
  return Number.isInteger(page) ? page : Infinity;
}

export function visibleDeckCards(view) {
  const query = view.query.trim().toLocaleLowerCase();
  // A flip revisit round keeps to the cards it was started with.
  const pool = view.layout === "flip" && view.pool ? new Set(view.pool) : null;
  const cards = (view.cards || []).filter(card => (!pool || pool.has(card.id)) && (!query || `${card.front}\n${card.back}`.toLocaleLowerCase().includes(query)));
  if (view.sort === "alpha") cards.sort((a, b) => a.front.localeCompare(b.front, undefined, { sensitivity: "base", numeric: true }));
  else if (view.sort === "starred") cards.sort((a, b) => Number(b.starred) - Number(a.starred));
  else if (view.sort === "source") cards.sort((a, b) => firstPage(a) - firstPage(b));
  return cards;
}

// sourceName(documentFileId) returns the display name, or "" when the file is gone.
export function citePills(card, { escapeHtml, sourceName, interactive = true }) {
  const pills = (card.sources || []).flatMap(item => {
    const name = sourceName(item.documentFileId);
    if (!name) return [];
    const inner = `<span class="dojo-cite-name">${escapeHtml(name)}</span>${item.page ? `<span>p.${escapeHtml(String(item.page))}</span>` : ""}`;
    const label = `${name}${item.page ? `, page ${item.page}` : ""}`;
    return interactive
      ? [`<button class="dojo-cite" type="button" data-cite-doc="${escapeHtml(item.documentFileId)}" data-cite-page="${escapeHtml(String(item.page || ""))}" title="Open ${escapeHtml(label)}">${inner}</button>`]
      : [`<span class="dojo-cite" title="${escapeHtml(label)}">${inner}</span>`];
  });
  return pills.length ? `<span class="dojo-cites">${pills.join("")}</span>` : "";
}

function viewHeader(title, count, { escapeHtml, fullLabel }) {
  return `<header class="dojo-view-head">
    <button class="study-icon-btn" type="button" data-studio-back aria-label="Back to Create" title="Back">${ICONS.back}</button>
    <h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3>${count == null ? "" : `<span class="dojo-view-count">${escapeHtml(String(count))}</span>`}
    <button class="study-icon-btn dojo-view-full" type="button" data-studio-full aria-label="${escapeHtml(fullLabel)}" title="${escapeHtml(fullLabel)}">${ICONS.full}</button>
  </header>`;
}

export function typingCardMarkup(card, view, helpers) {
  const { escapeHtml } = helpers;
  const checked = view.checked.has(card.id);
  return `<article class="dojo-qa is-typing${checked ? " is-checked" : ""}" data-card-id="${escapeHtml(card.id)}">
    ${citePills(card, helpers)}
    <p class="dojo-q"><span>Q:</span> ${cardText(card.front, escapeHtml)}</p>
    <textarea data-typing-answer placeholder="Type your answer…" rows="3" aria-label="Your answer"${checked ? " readonly" : ""}>${escapeHtml(view.typed[card.id] || "")}</textarea>
    ${checked
      ? `<div class="dojo-typing-result"><span>Answer</span><p>${cardText(card.back, escapeHtml)}</p><button class="study-chip-btn" type="button" data-typing-retry>Try again</button></div>`
      : `<button class="dojo-typing-check" type="button" data-typing-check${(view.typed[card.id] || "").trim() ? "" : " disabled"}>Check answer ${ICONS.enter}</button>`}
  </article>`;
}

export function deckBodyMarkup(view, helpers) {
  const { escapeHtml, starIcon } = helpers;
  if (view.error) return `<div class="study-empty"><strong>Could not load this deck</strong><p>${escapeHtml(view.error)}</p></div>`;
  if (!view.cards) return `<div class="study-empty" role="status"><span class="study-spin" aria-hidden="true"></span><p>Loading cards…</p></div>`;
  const cards = visibleDeckCards(view);
  if (!cards.length) return `<div class="study-empty"><strong>${view.query ? "No cards match" : "This deck is empty"}</strong><p>${view.query ? "Try a different word." : "Generate or save cards to fill it."}</p></div>`;
  if (view.layout === "flip") {
    const index = Math.min(view.flipIndex, cards.length - 1);
    const card = cards[index];
    const marks = view.marks || {};
    const got = cards.filter(item => marks[item.id] === 3).length;
    const missed = cards.filter(item => marks[item.id] === 1).length;
    const round = view.pool ? `<p class="dojo-flip-round-note">Revisiting ${cards.length} card${cards.length === 1 ? "" : "s"} · <button type="button" data-flip-round="all">Show all</button></p>` : "";
    if (got + missed === cards.length) {
      const left = cards.length - got;
      return `<div class="dojo-flip-wrap">
        ${round}
        <div class="dojo-flip-done" role="status">
          <span class="dojo-flip-done-ring" style="--got:${Math.round((got / cards.length) * 100)}%"><strong>${got}</strong><small>of ${cards.length}</small></span>
          <h4>${left ? "Round done" : "All right. Nice."}</h4>
          <p>${left ? `${got} right · ${missed} to revisit` : "Every card in this round was a tick."}</p>
          <div class="dojo-flip-done-actions">
            ${left ? `<button class="study-primary-btn" type="button" data-flip-round="revisit">${ICONS.again}Revisit ${left}</button>` : ""}
            <button class="study-chip-btn" type="button" data-flip-round="restart">Start over</button>
          </div>
        </div>
      </div>`;
    }
    const mark = marks[card.id];
    const atEnd = index >= cards.length - 1;
    return `<div class="dojo-flip-wrap">
      ${round}
      <div class="dojo-flip-progress"><span class="dojo-flip-track" role="progressbar" aria-valuemin="1" aria-valuemax="${cards.length}" aria-valuenow="${index + 1}" aria-label="Card ${index + 1} of ${cards.length}"><span style="width:${((index + 1) / cards.length) * 100}%"></span></span><span class="dojo-flip-count">${index + 1} / ${cards.length}</span></div>
      <div class="dojo-flip${view.flipped ? " is-flipped" : ""}${mark === 3 ? " is-got" : mark === 1 ? " is-miss" : ""}" role="button" tabindex="0" data-studio-flip aria-label="${view.flipped ? "Show question" : "Show answer"}">
        <div class="dojo-flip-inner">
          <div class="dojo-flip-face">${citePills(card, helpers)}<p>${cardText(card.front, escapeHtml)}</p><small>Click to see answer</small></div>
          <div class="dojo-flip-face is-back"><span class="dojo-flip-kicker">Answer</span><p>${cardText(card.back, escapeHtml)}</p><small>Click to see question</small></div>
        </div>
      </div>
      <div class="dojo-flip-controls">
        <button class="dojo-flip-nav" type="button" data-flip-nav="-1" aria-label="Previous card" title="Previous card"${index ? "" : " disabled"}>${ICONS.arrowPrev}</button>
        <button class="dojo-flip-grade is-miss" type="button" data-flip-grade="1" aria-pressed="${mark === 1}" aria-label="Missed it (${missed} so far)" title="Missed it · 1">${ICONS.miss}<span>${missed}</span></button>
        <button class="dojo-flip-grade is-got" type="button" data-flip-grade="3" aria-pressed="${mark === 3}" aria-label="Got it (${got} so far)" title="Got it · 2"><span>${got}</span>${ICONS.got}</button>
        <button class="dojo-flip-nav is-next" type="button" data-flip-nav="1" aria-label="Next card" title="Next card"${atEnd ? " disabled" : ""}>${ICONS.arrowNext}</button>
      </div>
      <p class="dojo-flip-hint">Space to flip · ← → to move · 1 missed · 2 got it</p>
    </div>`;
  }
  return cards.map(card => {
    const id = escapeHtml(card.id);
    if (view.layout === "typing") return typingCardMarkup(card, view, helpers);
    if (view.layout === "toggle") {
      return `<details class="dojo-qa is-toggle" data-card-id="${id}"${view.open.has(card.id) ? " open" : ""}><summary><span class="dojo-toggle-chevron">${ICONS.chevron}</span><span>${citePills(card, helpers)}<strong>${cardText(card.front, escapeHtml)}</strong></span></summary><p>${cardText(card.back, escapeHtml)}</p></details>`;
    }
    if (view.layout === "list") {
      return `<article class="dojo-qa is-list" data-card-id="${id}"><div class="dojo-qa-top">${citePills(card, helpers) || "<span></span>"}<button class="study-icon-btn dojo-card-star${card.starred ? " is-on" : ""}" type="button" data-deck-star="${id}" aria-pressed="${card.starred}" aria-label="${card.starred ? "Unstar card" : "Star card"}">${starIcon(card.starred)}</button></div><strong>${cardText(card.front, escapeHtml)}</strong><p>${cardText(card.back, escapeHtml)}</p></article>`;
    }
    return `<article class="dojo-qa is-column" data-card-id="${id}"><strong>${cardText(card.front, escapeHtml)}</strong><p>${cardText(card.back, escapeHtml)}</p>${citePills(card, helpers)}</article>`;
  }).join("");
}

// The last round on this device: resume a paused one, or revisit what was missed.
function deckProgressMarkup(progress) {
  if (!progress) return "";
  if (progress.state === "resume") {
    const marked = [progress.got && `${progress.got} got it`, progress.missed && `${progress.missed} missed`].filter(Boolean).join(" · ");
    return `<div class="dojo-deck-progress is-resume"><span class="dojo-deck-progress-bar" style="--done:${Math.round((progress.seen / progress.total) * 100)}%"></span><p><strong>Paused at card ${progress.seen} of ${progress.total}</strong>${marked ? `<small>${marked}</small>` : ""}</p><button class="study-chip-btn" type="button" data-deck-fresh>Start over</button><button class="study-primary-btn" type="button" data-studio-learn>Resume</button></div>`;
  }
  if (!progress.revisit) return `<div class="dojo-deck-progress is-clear"><p><strong>Last round: all ${progress.total} right</strong><small>Nothing left to revisit.</small></p></div>`;
  return `<div class="dojo-deck-progress is-revisit"><p><strong>${progress.revisit} card${progress.revisit === 1 ? "" : "s"} to revisit</strong><small>Last round: ${progress.got} of ${progress.total} right</small></p><button class="study-primary-btn" type="button" data-deck-revisit>Review ${progress.revisit}</button></div>`;
}

export function deckViewMarkup(view, deck, helpers) {
  const { escapeHtml } = helpers;
  const count = view.cards?.length ?? deck.cardCount ?? 0;
  const shown = view.cards ? visibleDeckCards(view).length : count;
  return `<div class="dojo-studio-content dojo-studio-view" data-studio-kind="deck" data-layout="${escapeHtml(view.layout)}">
    ${viewHeader(deck.title || "Flashcards", count, { escapeHtml, fullLabel: "Open full screen" })}
    <div class="dojo-view-modes" role="tablist" aria-label="Deck layout">${DECK_LAYOUTS.map(([value, label]) => `<button type="button" role="tab" data-deck-layout="${value}" aria-selected="${view.layout === value}">${ICONS[value]}<span>${label}</span></button>`).join("")}</div>
    <div class="dojo-view-tools">
      <button class="dojo-view-action" type="button" data-studio-learn${count ? "" : " disabled"}>${ICONS.learn}<span>${helpers.progress?.state === "resume" ? "Resume" : "Learn"}</span><span class="dojo-view-badge">${escapeHtml(String(count))}</span></button>
      <span class="dojo-view-tools-end">
        <button class="study-icon-btn${view.searchOpen ? " is-on" : ""}" type="button" data-deck-search aria-expanded="${view.searchOpen}" aria-label="Search cards" title="Search cards">${ICONS.search}</button>
        <details class="dojo-source-sort dojo-deck-sort"><summary class="study-icon-btn" aria-label="Sort cards" title="Sort cards">${ICONS.sort}</summary><div class="dojo-sort-menu" role="group" aria-label="Card order">${DECK_SORTS.map(([value, label]) => `<button type="button" data-deck-sort="${value}" aria-pressed="${view.sort === value}">${label}<span aria-hidden="true">${view.sort === value ? "✓" : ""}</span></button>`).join("")}</div></details>
      </span>
    </div>
    ${deckProgressMarkup(helpers.progress)}
    ${view.searchOpen ? `<label class="dojo-view-search">${ICONS.search}<input type="search" data-deck-query value="${escapeHtml(view.query)}" placeholder="Search questions and answers" aria-label="Search cards" autocomplete="off"><span data-deck-shown>${shown} / ${count}</span></label>` : ""}
    <div class="dojo-view-body" data-deck-body>${deckBodyMarkup(view, helpers)}</div>
  </div>`;
}


export function noteViewMarkup(note, bodyHtml, { escapeHtml, label }) {
  return `<div class="dojo-studio-content dojo-studio-view" data-studio-kind="note">
    ${viewHeader(note.title || label, null, { escapeHtml, fullLabel: "Open full screen" })}
    <div class="dojo-view-body dojo-view-note${label === "Mind map" ? " is-mindmap" : ""}">${bodyHtml}</div>
  </div>`;
}

export function quizViewMarkup(view, quiz, { escapeHtml }) {
  const questions = view.questions;
  const body = view.error
    ? `<div class="study-empty"><strong>Could not load this test</strong><p>${escapeHtml(view.error)}</p></div>`
    : !questions ? `<div class="study-empty" role="status"><span class="study-spin" aria-hidden="true"></span><p>Loading questions…</p></div>`
      : questions.map((question, index) => {
        const short = question.type === "short";
        const answer = Number(question.answer);
        const choices = short ? "" : `<ol class="dojo-quiz-choices">${(question.choices || []).map((choice, i) => `<li${i === answer ? ' class="is-answer"' : ""}><span>${"ABCD"[i]}</span>${escapeHtml(choice)}</li>`).join("")}</ol>`;
        const model = short ? `<p class="dojo-quiz-model"><span>Model answer</span>${escapeHtml(question.choices?.[0] || "")}</p>` : "";
        const marks = questionMarks(question);
        return `<details class="dojo-qa is-toggle" data-question-index="${index}"${view.open.has(index) ? " open" : ""}><summary><span class="dojo-toggle-chevron">${ICONS.chevron}</span><span><small class="dojo-quiz-num">Question ${index + 1}${question.topic ? ` · ${escapeHtml(question.topic)}` : ""}<span class="dojo-quiz-marks">${marks} mark${marks === 1 ? "" : "s"}</span></small><strong>${escapeHtml(question.q || "")}</strong></span></summary>${choices}${model}${question.explanation ? `<p>${escapeHtml(question.explanation)}</p>` : ""}</details>`;
      }).join("");
  const count = questions?.length ?? quiz.questionCount ?? 0;
  const summary = questions?.length ? testSummary(questions) : null;
  return `<div class="dojo-studio-content dojo-studio-view" data-studio-kind="quiz">
    ${viewHeader(quiz.title || "Practice test", count, { escapeHtml, fullLabel: "Take test full screen" })}
    <div class="dojo-view-tools"><button class="dojo-view-action is-primary" type="button" data-studio-learn${count ? "" : " disabled"}>${ICONS.play}<span>Start test</span></button>${summary ? `<small class="dojo-view-tip">${summary.marks} marks · about ${summary.minutes} min</small>` : ""}</div>
    <div class="dojo-view-body">${body}</div>
  </div>`;
}
