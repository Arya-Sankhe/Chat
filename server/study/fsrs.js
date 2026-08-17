/**
 * FSRS-4.5 scheduler (Free Spaced Repetition Scheduler).
 * Formulas: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
 * Default weights w0..w16 are the published FSRS-4.5 / FSRS-4 paper defaults.
 *
 * Retrievability (FSRS-4.5):
 *   R(t, S) = (1 + FACTOR * t / S) ^ DECAY
 *   DECAY = -0.5, FACTOR = 19/81  so that R(S) = 0.9 when t = S.
 *
 * Initial stability / difficulty (first rating G in 1..4):
 *   S0(G) = w[G-1]
 *   D0(G) = clamp(w4 - e^{w5*(G-2)} + 1, 1, 10)
 *
 * Difficulty update (mean-reversion toward D0(3)):
 *   D' = D - w6*(G-3)
 *   D  = w7*D0(3) + (1-w7)*D'
 *
 * Stability after success (G > 1):
 *   S' = S * (e^{w8} * (11-D) * S^{-w9} * (e^{w10*(1-R)}-1) * hard * easy + 1)
 *   hard = w15 if G=2 else 1; easy = w16 if G=4 else 1
 *
 * Stability after lapse (G = 1):
 *   S' = w11 * D^{-w12} * ((S+1)^{w13}-1) * e^{w14*(1-R)}
 *
 * Next interval at requestRetention=0.9 is S days (fuzz omitted).
 */

const W = [
  0.4, 0.6, 2.4, 5.8, 4.93,
  0.94, 0.86, 0.01, 1.49, 0.14,
  0.94, 2.18, 0.05, 0.34, 1.26,
  0.29, 2.61
];

const DECAY = -0.5;
const FACTOR = 19 / 81;
const MIN_STABILITY = 0.1;
const LEARNING_AGAIN_MS = 10 * 60 * 1000;
const LEARNING_HARD_MS = 24 * 60 * 60 * 1000;

function clampDifficulty(value) {
  return Math.min(10, Math.max(1, value));
}

function clampStability(value) {
  return Math.max(MIN_STABILITY, value);
}

function initDifficulty(rating) {
  return clampDifficulty(W[4] - Math.exp(W[5] * (rating - 2)) + 1);
}

function initStability(rating) {
  return clampStability(W[rating - 1]);
}

function nextDifficulty(difficulty, rating) {
  const next = difficulty - W[6] * (rating - 3);
  return clampDifficulty(W[7] * initDifficulty(3) + (1 - W[7]) * next);
}

function retrievability(elapsedDays, stability) {
  if (!(stability > 0)) return 0;
  return (1 + FACTOR * Math.max(0, elapsedDays) / stability) ** DECAY;
}

function successStability(difficulty, stability, retriev, rating) {
  const hard = rating === 2 ? W[15] : 1;
  const easy = rating === 4 ? W[16] : 1;
  return clampStability(
    stability * (
      Math.exp(W[8])
      * (11 - difficulty)
      * (stability ** -W[9])
      * (Math.exp(W[10] * (1 - retriev)) - 1)
      * hard
      * easy
      + 1
    )
  );
}

function lapseStability(difficulty, stability, retriev) {
  return clampStability(
    W[11]
    * (difficulty ** -W[12])
    * (((stability + 1) ** W[13]) - 1)
    * Math.exp(W[14] * (1 - retriev))
  );
}

function addMs(now, ms) {
  return new Date(now.getTime() + ms);
}

function dueFromStability(now, stability) {
  return addMs(now, clampStability(stability) * 86400000);
}

export function gradeCard(card, rating, now = new Date()) {
  const g = Number(rating);
  const at = now instanceof Date ? now : new Date(now);
  const prevState = card?.state || "new";
  const reps = Math.max(0, Number(card?.reps || 0)) + 1;
  const last = card?.last_reviewed_at ? new Date(card.last_reviewed_at) : null;
  const elapsedDays = last && Number.isFinite(last.getTime())
    ? Math.max(0, (at.getTime() - last.getTime()) / 86400000)
    : 0;
  const first = prevState === "new" || card?.stability == null || card?.difficulty == null;

  let difficulty = first ? initDifficulty(g) : nextDifficulty(Number(card.difficulty), g);
  let stability;
  let state;
  let lapses = Math.max(0, Number(card?.lapses || 0));
  let due;

  if (g === 1) {
    if (!first) lapses += 1;
    stability = first
      ? initStability(g)
      : lapseStability(difficulty, Number(card.stability), retrievability(elapsedDays, Number(card.stability)));
    state = first || prevState === "new" || prevState === "learning" ? "learning" : "relearning";
    due = addMs(at, LEARNING_AGAIN_MS);
  } else if (g === 2 && (first || prevState === "new" || prevState === "learning")) {
    stability = first ? initStability(g) : successStability(
      difficulty,
      Number(card.stability),
      retrievability(elapsedDays, Number(card.stability)),
      g
    );
    state = "learning";
    due = addMs(at, LEARNING_HARD_MS);
  } else {
    stability = first
      ? initStability(g)
      : successStability(
        difficulty,
        Number(card.stability),
        retrievability(elapsedDays, Number(card.stability)),
        g
      );
    state = "review";
    due = dueFromStability(at, stability);
  }

  return {
    state,
    difficulty,
    stability,
    reps,
    lapses,
    due_at: due.toISOString(),
    last_reviewed_at: at.toISOString()
  };
}
