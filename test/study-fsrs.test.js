import assert from "node:assert/strict";
import test from "node:test";
import { gradeCard } from "../server/study/fsrs.js";

const NOW = new Date("2026-08-17T00:00:00.000Z");

function daysUntil(dueAt, now = NOW) {
  return (new Date(dueAt).getTime() - now.getTime()) / 86400000;
}

test("first-time good produces a due date about 1-4 days out", () => {
  const next = gradeCard({ state: "new", reps: 0, lapses: 0 }, 3, NOW);
  const days = daysUntil(next.due_at);
  assert.equal(next.state, "review");
  assert.equal(next.reps, 1);
  assert.ok(days >= 1 && days <= 4, `expected 1-4 days, got ${days}`);
});

test("again on a review-state card increments lapses and shortens interval", () => {
  const card = {
    state: "review",
    difficulty: 5,
    stability: 10,
    reps: 4,
    lapses: 0,
    last_reviewed_at: "2026-08-07T00:00:00.000Z",
    due_at: "2026-08-17T00:00:00.000Z"
  };
  const next = gradeCard(card, 1, NOW);
  assert.equal(next.lapses, 1);
  assert.equal(next.state, "relearning");
  assert.ok(daysUntil(next.due_at) < 10, "lapse interval should be shorter than the previous 10-day stability");
});

test("easy interval is longer than good", () => {
  const good = gradeCard({ state: "new", reps: 0, lapses: 0 }, 3, NOW);
  const easy = gradeCard({ state: "new", reps: 0, lapses: 0 }, 4, NOW);
  assert.ok(new Date(easy.due_at) > new Date(good.due_at));
});

test("difficulty stays clamped to [1, 10]", () => {
  let hard = { state: "new", reps: 0, lapses: 0 };
  let easy = { state: "new", reps: 0, lapses: 0 };
  for (let i = 0; i < 40; i += 1) {
    hard = { ...hard, ...gradeCard(hard, 1, NOW) };
    easy = { ...easy, ...gradeCard(easy, 4, NOW) };
  }
  assert.ok(hard.difficulty >= 1 && hard.difficulty <= 10, `again difficulty ${hard.difficulty}`);
  assert.ok(easy.difficulty >= 1 && easy.difficulty <= 10, `easy difficulty ${easy.difficulty}`);
});
