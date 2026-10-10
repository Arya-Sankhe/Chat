import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../server/config.js";
import { API_DEPENDENCIES } from "../server/routes/context.js";
import { handleStudyTutorBoard, handleStudyTutorTurn } from "../server/routes/tutor.js";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const SESSION = "00000000-0000-4000-9000-0000000000aa";

function fakeDb({ board = { steps: [{ blocks: [{ key: "rule", type: "note", text: "MAP is CO times TPR." }] }] }, status = "ready" } = {}) {
  const boards = new Map();
  let n = 0;
  const session = { id: SESSION, user_id: USER, project_id: "course-1", title: "Blood pressure", status, plan: { goal: "g", steps: [{ title: "MAP", points: [] }], notes: "", board }, transcript: [] };
  return {
    boards,
    session,
    async upsertProfile(user) { return { id: user.id }; },
    async getProject(userId, projectId) { return projectId === "course-1" && userId === USER ? { id: "course-1", kind: "course", name: "Physiology" } : null; },
    async getStudyTutorSession(userId, id) { return userId === USER && id === SESSION ? structuredClone(session) : null; },
    async updateStudyTutorSession(userId, id, patch) { Object.assign(session, structuredClone(patch)); return structuredClone(session); },
    async createStudyWhiteboard(userId, row) {
      // Slow enough that two opens overlap.
      await new Promise((resolve) => setTimeout(resolve, 10));
      const made = { id: `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`, user_id: userId, revision: 0, scene: { schemaVersion: 1, elements: [], appState: {} }, created_at: "t", updated_at: "t", ...row };
      boards.set(made.id, made);
      return made;
    },
    async getStudyWhiteboard(userId, id) { const row = boards.get(id); return row && row.user_id === userId ? structuredClone(row) : null; },
    async getLatestSubscription() { return null; },
    async checkApiBudget() { return { allowed: true }; }
  };
}

function harness(options, userId = USER) {
  const db = fakeDb(options);
  const config = {
    ...loadConfig({ OPENROUTER_API_KEY: "k" }),
    [API_DEPENDENCIES]: { createDb: () => db, createR2: () => ({}), verifyUser: async () => ({ id: userId, email: "a@b.c" }) }
  };
  return { db, config };
}

function request(method, body) {
  const raw = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  return {
    method,
    url: "/",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    socket: { remoteAddress: `10.0.1.${Math.floor(Math.random() * 250)}` },
    signal: new AbortController().signal,
    async *[Symbol.asyncIterator]() { if (raw.length) yield raw; }
  };
}

function response() {
  return {
    status: 0, headers: {}, body: "", headersSent: false, writableEnded: false,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; this.headersSent = true; },
    write(chunk) { this.body += chunk; return true; },
    end(chunk = "") { this.body += chunk; this.writableEnded = true; },
    on() {},
    off() {},
    json() { return JSON.parse(this.body); }
  };
}

test("a lesson gets one whiteboard in its course, however many times the call opens it", async () => {
  const h = harness();
  const [a, b] = [response(), response()];
  await Promise.all([handleStudyTutorBoard(request("POST"), a, h.config, SESSION), handleStudyTutorBoard(request("POST"), b, h.config, SESSION)]);
  assert.equal(h.db.boards.size, 1);
  assert.equal(a.json().board.id, b.json().board.id);
  assert.equal(a.json().board.courseId, "course-1");
  assert.equal(a.json().board.title, "Blood pressure · board");
  assert.equal(h.db.session.plan.boardId, a.json().board.id);
  assert.equal(h.db.session.plan.board.steps[0].blocks[0].key, "rule", "saving the board id keeps the planned board");
  // Reopened after the call ended: the same board, never a new one.
  h.db.session.status = "ended";
  const again = response();
  await handleStudyTutorBoard(request("POST"), again, h.config, SESSION);
  assert.equal(again.json().board.id, a.json().board.id);
});

test("lessons without a board, other people's lessons, and ended lessons can't make one", async () => {
  await assert.rejects(handleStudyTutorBoard(request("POST"), response(), harness({ board: null }).config, SESSION), (error) => error.status === 409);
  await assert.rejects(handleStudyTutorBoard(request("POST"), response(), harness({}, OTHER).config, SESSION), (error) => error.status === 404);
  await assert.rejects(handleStudyTutorBoard(request("POST"), response(), harness({ status: "ended" }).config, SESSION), (error) => error.status === 409);
  await assert.rejects(handleStudyTutorBoard(request("GET"), response(), harness().config, SESSION), (error) => error.status === 405);
});

test("a turn with a bad board snapshot is refused before anything runs", async () => {
  const h = harness({}, USER);
  await assert.rejects(handleStudyTutorTurn(request("POST", { mode: "reply", text: "hi", board: { image: { data: "@@" } } }), response(), h.config, SESSION), (error) => error.status === 413);
});
