// Practice test markup: the exam, marking, report, and answer review.
// The same markup runs in the Create side panel and full screen; studyHub owns state and events.

const svg = (paths, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  back: svg('<path d="M19 12H5m6-6-6 6 6 6"/>'),
  full: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  dock: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14 4v16"/><path d="m8 10 2 2-2 2"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 14),
  prev: svg('<path d="m15 18-6-6 6-6"/>', 15),
  next: svg('<path d="m9 18 6-6-6-6"/>', 15),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 15),
  send: svg('<path d="M5 12h13m-5-5 5 5-5 5"/>', 15),
  spark: svg('<path d="M12 3.5 13.9 10l6.6 2-6.6 2L12 20.5 10.1 14l-6.6-2 6.6-2Z"/>', 15),
  sprout: svg('<path d="M12 20v-8m0 0c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5Zm0 0C12 8.5 9.5 6.5 5.5 6.5c0 3.5 2.5 5.5 6.5 5.5Z"/>', 15),
  compass: svg('<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8Z"/>', 15),
  note: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 14)
};

const STATUS = {
  full: "Full marks",
  partial: "Partial credit",
  revisit: "Worth revisiting",
  skipped: "Not answered"
};

// Marks come with each question; older tests without them use the same defaults as the server.
export function questionMarks(question) {
  const marks = Number(question?.marks);
  if (Number.isInteger(marks) && marks >= 1 && marks <= 5) return marks;
  return question?.type === "short" ? 3 : 1;
}

export function isAnswered(question, value) {
  return question?.type === "short" ? Boolean(String(value || "").trim()) : Number.isInteger(value) && value >= 0;
}

export function answeredCount(session) {
  return session.quiz.questions.reduce((sum, question, index) => sum + (isAnswered(question, session.answers[index]) ? 1 : 0), 0);
}

export function testSummary(questions) {
  const marks = questions.reduce((sum, question) => sum + questionMarks(question), 0);
  const minutes = Math.max(1, Math.round(questions.reduce((sum, question) => sum + (question.type === "short" ? 1.5 + questionMarks(question) * 0.5 : 1), 0)));
  return { marks, minutes };
}

export function formatClock(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (!m) return `${s}s`;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function sessionElapsed(session) {
  return session.phase === "test" || session.phase === "marking" ? Date.now() - session.startedAt : session.elapsedMs;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function head(session, { escapeHtml, host }) {
  const live = session.phase === "test" || session.phase === "marking";
  const tools = host === "panel"
    ? `<button class="study-icon-btn" type="button" data-test-host="full" aria-label="Continue in full screen" title="Full screen">${ICONS.full}</button>`
    : `<button class="study-icon-btn" type="button" data-test-host="panel" aria-label="Continue in the side panel" title="Side panel">${ICONS.dock}</button>
       <button class="study-icon-btn" type="button" data-test-exit aria-label="Close test" title="Close">${ICONS.close}</button>`;
  return `<header class="study-test-top">
    ${host === "panel" ? `<button class="study-icon-btn" type="button" data-test-exit aria-label="Leave test" title="Back">${ICONS.back}</button>` : ""}
    <div class="study-test-title"><small>Practice test</small><h2 title="${escapeHtml(session.quiz.title || "Practice test")}">${escapeHtml(session.quiz.title || "Practice test")}</h2></div>
    <span class="study-test-clock${live ? " is-live" : ""}" title="${live ? "Time so far" : "Time taken"}">${ICONS.clock}<span data-test-clock>${formatClock(sessionElapsed(session))}</span></span>
    ${tools}
  </header>`;
}

function examMarkup(session, helpers) {
  const { escapeHtml } = helpers;
  const questions = session.quiz.questions;
  const total = questions.length;
  const index = Math.min(session.index, total - 1);
  const question = questions[index] || {};
  const value = session.answers[index];
  const marks = questionMarks(question);
  const short = question.type === "short";
  const answered = answeredCount(session);
  const last = index >= total - 1;
  const left = total - answered;
  const dots = questions.map((item, i) => {
    const done = isAnswered(item, session.answers[i]);
    return `<button class="study-test-dot${i === index ? " is-current" : ""}${done ? " is-answered" : ""}" type="button" data-test-go="${i}" aria-label="Question ${i + 1}${done ? ", answered" : ""}"${i === index ? ' aria-current="step"' : ""}>${i + 1}</button>`;
  }).join("");
  const choices = (question.choices || []).map((choice, i) => {
    const picked = value === i;
    return `<button class="study-test-choice${picked ? " is-picked" : ""}" type="button" role="radio" aria-checked="${picked}" data-test-pick="${i}">
      <span class="study-test-letter">${"ABCD"[i] || i + 1}</span><span class="study-test-choice-text">${escapeHtml(choice)}</span><span class="study-test-tick">${ICONS.check}</span>
    </button>`;
  }).join("");
  const words = String(value || "").trim().split(/\s+/).filter(Boolean).length;
  const body = short
    ? `<label class="study-test-written"><span class="study-test-written-label">Your answer</span>
        <textarea data-test-written rows="7" placeholder="Explain it in your own words…" spellcheck="true">${escapeHtml(value || "")}</textarea>
        <span class="study-test-written-foot"><span>Aim for ${plural(marks, "clear point")}</span><span data-test-words>${plural(words, "word")}</span></span>
      </label>`
    : `<div class="study-test-choices" role="radiogroup" aria-label="Answer choices">${choices}</div>`;
  const submit = `<button class="study-test-submit" type="button" data-test-submit>Submit for marking ${ICONS.send}</button>`;
  return `<div class="study-test-scroll dojo-view-body">
    <section class="study-test-nav" aria-label="Questions">
      <div class="study-test-nav-top"><strong>Question ${index + 1} <span>of ${total}</span></strong><span class="study-test-count"><b data-test-answered>${answered}</b> answered</span></div>
      <div class="study-test-dots">${dots}</div>
    </section>
    <article class="study-test-card">
      <div class="study-test-card-top"><span class="study-test-kind is-${short ? "short" : "mcq"}">${short ? "Written answer" : "Multiple choice"}</span>${question.topic ? `<span class="study-test-topic">${escapeHtml(question.topic)}</span>` : ""}<span class="study-test-marks">${plural(marks, "mark")}</span></div>
      <h3 class="study-test-q">${escapeHtml(question.q || "")}</h3>
      ${body}
    </article>
  </div>
  <footer class="study-test-foot">
    <button class="study-test-step" type="button" data-test-go="${index - 1}"${index ? "" : " disabled"}>${ICONS.prev}<span>Previous</span></button>
    ${last ? `<span class="study-test-left" data-test-left>${left ? `${left} unanswered` : "All answered"}</span>${submit}` : `<button class="study-test-step is-next" type="button" data-test-go="${index + 1}"><span>Next</span>${ICONS.next}</button>`}
  </footer>`;
}

function markingMarkup(session) {
  const written = session.quiz.questions.filter((question, index) => question.type === "short" && isAnswered(question, session.answers[index])).length;
  return `<div class="study-test-scroll dojo-view-body"><div class="study-test-marking" role="status">
    <span class="study-test-marking-orb" aria-hidden="true"><span></span></span>
    <strong>Marking your test</strong>
    <p>${written ? `Reading your ${plural(written, "written answer")} and preparing feedback…` : "Adding up your marks and preparing feedback…"}</p>
  </div></div>`;
}

function band(pct) {
  if (pct >= 85) return { tone: "top", label: "Outstanding" };
  if (pct >= 70) return { tone: "high", label: "Strong work" };
  if (pct >= 50) return { tone: "mid", label: "Good progress" };
  return { tone: "grow", label: "Building foundations" };
}

function list(items, escapeHtml) {
  return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function reportMarkup(session, { escapeHtml }) {
  const { report, quiz } = session;
  const pct = report.total ? Math.round((report.score / report.total) * 100) : 0;
  const { tone, label } = band(pct);
  const counts = { full: 0, partial: 0, revisit: 0, skipped: 0 };
  for (const row of report.results) counts[row.status] = (counts[row.status] || 0) + 1;
  const summary = report.summary || {};
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const strip = report.results.map((row, i) => `<button class="study-report-q is-${row.status}" type="button" data-test-review="${i}" title="Question ${i + 1}: ${row.earned} of ${plural(row.marks, "mark")}"><span>Q${i + 1}</span><b>${row.earned}/${row.marks}</b></button>`).join("");
  const notes = [
    ["strengths", "Strengths", ICONS.spark, summary.strengths],
    ["growth", "Room to grow", ICONS.sprout, summary.growth],
    ["next", "What to study next", ICONS.compass, summary.next]
  ].filter(([, , , items]) => items?.length).map(([kind, title, icon, items]) => `<article class="study-report-note is-${kind}"><h3><span>${icon}</span>${title}</h3>${list(items, escapeHtml)}</article>`).join("");
  return `<div class="study-test-scroll dojo-view-body"><div class="study-report is-${tone}">
    <section class="study-report-hero">
      <div class="study-report-ring" role="img" aria-label="${pct} percent, ${report.score} of ${report.total} marks">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="study-report-track" cx="50" cy="50" r="${radius}"/><circle class="study-report-value" cx="50" cy="50" r="${radius}" style="stroke-dasharray:${circumference.toFixed(1)};--ring-offset:${(circumference * (1 - pct / 100)).toFixed(1)};--ring-full:${circumference.toFixed(1)}"/></svg>
        <span><strong>${pct}%</strong><small>${report.score} / ${report.total} marks</small></span>
      </div>
      <div class="study-report-copy">
        <span class="study-report-band">${label}</span>
        <h2>${escapeHtml(summary.headline || "Here's how you did.")}</h2>
        <dl class="study-report-stats">
          <div><dt>Time</dt><dd>${ICONS.clock}${formatDuration(session.elapsedMs)}</dd></div>
          <div><dt>Questions</dt><dd>${quiz.questions.length}</dd></div>
          <div><dt>Full marks</dt><dd>${counts.full}</dd></div>
          ${counts.partial ? `<div><dt>Partial</dt><dd>${counts.partial}</dd></div>` : ""}
        </dl>
      </div>
    </section>
    <section class="study-report-strip" aria-label="Marks by question">${strip}</section>
    <section class="study-report-notes">${notes}</section>
    ${report.marker === "estimate" ? `<p class="study-report-fine">Written answers were estimated from key ideas this time — check them in the review.</p>` : ""}
    <div class="study-report-actions">
      <button class="study-report-btn" type="button" data-quiz-lookback>Review answers</button>
      <button class="study-report-btn" type="button" data-test-finish>Finish</button>
      <button class="study-report-btn is-primary" type="button" data-quiz-retake>Retake test</button>
    </div>
  </div></div>`;
}

function answerCard(session, index, { escapeHtml, spinner }) {
  const question = session.quiz.questions[index];
  const row = session.report.results[index];
  const short = question.type === "short";
  const whys = (question.whys || []).map(why => String(why || "").trim());
  const hasWhys = whys.some(Boolean);
  const choices = short ? "" : `<ol class="study-answer-choices">${(question.choices || []).map((choice, i) => {
    const correct = i === row.answer;
    const picked = i === row.yourAnswer;
    const tag = correct && picked ? "Your answer" : correct ? "Correct answer" : picked ? "Your answer" : "";
    return `<li class="${correct ? "is-correct" : ""}${picked ? " is-picked" : ""}"><span class="study-test-letter">${"ABCD"[i]}</span><div><p>${escapeHtml(choice)}${tag ? ` <em>${tag}</em>` : ""}</p>${whys[i] ? `<small>${escapeHtml(whys[i])}</small>` : ""}</div></li>`;
  }).join("")}</ol>`;
  const written = short ? `<div class="study-answer-block"><small>Your answer</small><p>${row.status === "skipped" ? "<i>Not answered</i>" : escapeHtml(session.answers[index] || "")}</p></div>
    <div class="study-answer-block is-model"><small>Model answer</small><p>${escapeHtml(question.choices?.[0] || "")}</p></div>` : "";
  const feedback = row.feedback ? `<p class="study-answer-feedback">${ICONS.note}<span>${escapeHtml(row.feedback)}</span></p>` : "";
  const explain = question.explanation && (short || !hasWhys) ? `<p class="study-answer-explain">${escapeHtml(question.explanation)}</p>` : "";
  const already = session.added?.has(index);
  return `<article class="study-answer is-${row.status}" id="study-answer-${index}">
    <header><span class="study-answer-num">Q${index + 1}</span><span class="study-answer-kind">${short ? "Written" : "Multiple choice"}${question.topic ? ` · ${escapeHtml(question.topic)}` : ""}</span><span class="study-answer-score">${row.earned}<small>/${row.marks}</small></span></header>
    <span class="study-answer-status">${STATUS[row.status] || ""}</span>
    <h3>${escapeHtml(question.q || "")}</h3>
    ${choices}${written}${feedback}${explain}
    <button class="study-chip-btn study-answer-add" type="button" data-add-missed="${index}" ${already || session.adding === index ? "disabled" : ""}>
      ${session.adding === index ? spinner() : already ? "Added" : "Add to flashcards"}
    </button>
  </article>`;
}

function reviewMarkup(session, helpers) {
  const results = session.report.results;
  const revisit = results.map((row, i) => (row.status === "full" ? -1 : i)).filter(i => i >= 0);
  const filter = session.reviewFilter === "revisit" && revisit.length ? "revisit" : "all";
  const shown = filter === "revisit" ? revisit : results.map((_, i) => i);
  return `<div class="study-test-scroll dojo-view-body"><div class="study-answers">
    <div class="study-answers-head">
      <button class="study-test-step" type="button" data-quiz-recap>${ICONS.prev}<span>Results</span></button>
      <div class="study-answers-filter" role="tablist" aria-label="Filter answers">
        <button type="button" role="tab" data-test-filter="all" aria-selected="${filter === "all"}">All <span>${results.length}</span></button>
        ${revisit.length ? `<button type="button" role="tab" data-test-filter="revisit" aria-selected="${filter === "revisit"}">To revisit <span>${revisit.length}</span></button>` : ""}
      </div>
    </div>
    ${shown.map(i => answerCard(session, i, helpers)).join("")}
    <div class="study-report-actions">
      <button class="study-report-btn" type="button" data-quiz-recap>Back to results</button>
      <button class="study-report-btn is-primary" type="button" data-quiz-retake>Retake test</button>
    </div>
  </div></div>`;
}

// helpers: { escapeHtml, spinner, host: "panel" | "full" }
export function testMarkup(session, helpers) {
  const body = session.phase === "marking" ? markingMarkup(session)
    : session.phase === "results" ? reportMarkup(session, helpers)
      : session.phase === "review" ? reviewMarkup(session, helpers)
        : examMarkup(session, helpers);
  // Entrances play only when the screen changes, never on repaints of the same screen.
  return `<div class="study-test is-${helpers.host} is-${session.phase}${session.enter ? " is-entering" : ""}" data-test>${head(session, helpers)}${body}</div>`;
}
