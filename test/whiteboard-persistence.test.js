import test from "node:test";
import assert from "node:assert/strict";
import { createSaveQueue } from "../public/js/whiteboard/persistence.js";

// Manual timers: run() fires whatever is scheduled.
function clock() {
  let pending = null;
  return {
    setTimeout(fn) { pending = fn; return 1; },
    clearTimeout() { pending = null; },
    async run() { const fn = pending; pending = null; await fn?.(); }
  };
}

function memoryStore() {
  const map = new Map();
  return { map, get: async (key) => map.get(key), put: async (key, value) => { map.set(key, value); }, delete: async (key) => { map.delete(key); } };
}

test("edits go to the local draft first, then save against the revision they started from", async () => {
  const timers = clock();
  const store = memoryStore();
  const calls = [];
  const statuses = [];
  const queue = createSaveQueue({
    key: "u:b", revision: 4, store, timers, onStatus: (status) => statuses.push(status),
    save: async (body) => { calls.push(body); return { revision: body.expectedRevision + 1 }; }
  });
  await queue.edit({ elements: [1] });
  assert.deepEqual(store.map.get("u:b").scene, { elements: [1] });
  await timers.run();
  assert.deepEqual(calls, [{ expectedRevision: 4, scene: { elements: [1] } }]);
  assert.equal(queue.revision, 5);
  assert.equal(store.map.has("u:b"), false, "a saved draft is cleared");
  assert.equal(statuses.at(-1), "saved");
});

test("an edit made while a save is in flight stays dirty and is saved next", async () => {
  const timers = clock();
  const store = memoryStore();
  let release;
  const calls = [];
  const queue = createSaveQueue({
    key: "k", revision: 0, store, timers,
    save: (body) => { calls.push(body); return new Promise((resolve) => { release = () => resolve({ revision: body.expectedRevision + 1 }); }); }
  });
  await queue.edit({ v: 1 });
  const first = queue.flush();
  await queue.edit({ v: 2 });
  release();
  await first;
  assert.equal(queue.dirty, true);
  assert.equal(queue.status, "dirty");
  assert.ok(store.map.has("k"), "the newer edit is still kept locally");
  const second = timers.run();
  await Promise.resolve();
  release();
  await second;
  assert.deepEqual(calls.map((call) => [call.expectedRevision, call.scene.v]), [[0, 1], [1, 2]]);
  assert.equal(queue.dirty, false);
});

test("a save that lost to another tab stops autosaving and keeps the local copy", async () => {
  const timers = clock();
  const store = memoryStore();
  const statuses = [];
  let calls = 0;
  const queue = createSaveQueue({
    key: "k", revision: 2, store, timers, onStatus: (status) => statuses.push(status),
    save: async () => { calls += 1; throw Object.assign(new Error("changed"), { status: 409, code: "revision_conflict" }); }
  });
  await queue.edit({ mine: true });
  await timers.run();
  assert.equal(statuses.at(-1), "conflict");
  assert.deepEqual(store.map.get("k").scene, { mine: true });
  await queue.edit({ mine: 2 });
  await timers.run();
  assert.equal(calls, 1, "no more saves until the student decides");
  assert.deepEqual(store.map.get("k").scene, { mine: 2 }, "edits after the conflict still reach the local draft");
  assert.equal(queue.status, "conflict");
  queue.reset(7);
  await queue.edit({ fresh: true });
  assert.equal(queue.status, "dirty");
});

test("network failures retry; rejected content waits for the next edit", async () => {
  const timers = clock();
  let fail = true;
  const statuses = [];
  const queue = createSaveQueue({
    key: "k", revision: 0, store: memoryStore(), timers, onStatus: (status) => statuses.push(status),
    save: async (body) => { if (fail) throw new Error("network"); return { revision: body.expectedRevision + 1 }; }
  });
  await queue.edit({ a: 1 });
  await timers.run();
  assert.equal(statuses.at(-1), "failed");
  fail = false;
  await timers.run(); // the retry
  assert.equal(statuses.at(-1), "saved");

  const rejecting = createSaveQueue({
    key: "k2", revision: 0, store: memoryStore(), timers,
    save: async () => { throw Object.assign(new Error("bad"), { status: 422 }); }
  });
  await rejecting.edit({ a: 1 });
  await timers.run();
  assert.equal(rejecting.status, "failed");
  let retried = false;
  await timers.run().then(() => { retried = rejecting.status !== "failed"; });
  assert.equal(retried, false);
});

test("held saves wait (the draft doesn't), and drain saves everything before leaving", async () => {
  const timers = clock();
  const store = memoryStore();
  const calls = [];
  const queue = createSaveQueue({
    key: "k", revision: 0, store, timers,
    save: async (body) => { calls.push(body.scene.v); return { revision: body.expectedRevision + 1 }; }
  });
  queue.hold();
  await queue.edit({ v: 1 }, { files: { f: { id: "f", dataURL: "data:x" } } });
  assert.equal(store.map.get("k").files.f.id, "f", "images not uploaded yet ride along in the draft");
  await queue.flush();
  assert.deepEqual(calls, [], "nothing is sent while held");
  await queue.edit({ v: 2 });
  queue.release();
  await queue.drain();
  assert.deepEqual(calls, [2]);
  assert.equal(store.map.has("k"), false);
  assert.equal(queue.dirty, false);
});

test("a tab's save only clears its own draft", async () => {
  const timers = clock();
  const store = memoryStore();
  store.map.set("u:b:other-tab", { scene: { theirs: true }, baseRevision: 0 });
  const queue = createSaveQueue({ key: "u:b:mine", revision: 0, store, timers, save: async () => ({ revision: 1 }) });
  await queue.edit({ mine: true });
  await queue.drain();
  assert.ok(store.map.has("u:b:other-tab"));
  assert.equal(store.map.has("u:b:mine"), false);
});
