import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POCKET_VOICES, PocketPool, PocketUnavailable, createSessionStore, createSpeechSession, pocketPool } from "../server/speech/engine.js";

const mp3 = (label) => new Response(Buffer.from(label), { status: 200 });

// A fake Pocket worker per URL: each call waits until the test releases it.
function fakeWorkers() {
  const calls = [];
  const fetchImpl = (url, options) => new Promise((resolve, reject) => {
    const call = { url: String(url), body: JSON.parse(options.body), resolve, reject };
    options.signal?.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    calls.push(call);
  });
  return { calls, fetchImpl };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("every persona has its own Pocket voice", () => {
  const voices = Object.values(POCKET_VOICES);
  assert.equal(new Set(voices).size, voices.length);
  for (const id of ["af_heart", "af_bella", "bf_emma", "am_michael", "am_fenrir", "am_puck"]) assert.ok(POCKET_VOICES[id], id);
});

test("pocketPool is null without workers and shared with them", () => {
  assert.equal(pocketPool({ speech: { pocketUrls: [] } }), null);
  const config = { speech: { pocketUrls: ["http://a:8000", "http://b:8000"] } };
  assert.equal(pocketPool(config), pocketPool(config));
});

test("each worker takes one chunk; the next one waits for a free worker", async () => {
  const { calls, fetchImpl } = fakeWorkers();
  const pool = new PocketPool({ urls: ["http://a", "http://b"], fetchImpl });
  const first = pool.speak({ text: "one", voice: "jane" });
  const second = pool.speak({ text: "two", voice: "jane" });
  assert.equal(pool.canAdmit(), true); // both busy, nobody waiting yet
  const third = pool.speak({ text: "three", voice: "jane" });
  await tick();
  assert.deepEqual(calls.map((call) => call.url), ["http://a/tts", "http://b/tts"]);
  assert.equal(pool.waiting.length, 1);
  calls[0].resolve(mp3("1"));
  assert.equal(String(await first), "1");
  await tick();
  assert.equal(calls[2].url, "http://a/tts");
  assert.equal(calls[2].body.text, "three");
  calls[1].resolve(mp3("2"));
  calls[2].resolve(mp3("3"));
  assert.deepEqual([String(await second), String(await third)], ["2", "3"]);
});

test("admission stops at one waiting chunk per worker", async () => {
  const { fetchImpl } = fakeWorkers();
  const pool = new PocketPool({ urls: ["http://a", "http://b"], fetchImpl });
  for (let i = 0; i < 3; i += 1) pool.speak({ text: `${i}`, voice: "jane" }).catch(() => {});
  await tick();
  assert.equal(pool.canAdmit(), true); // 2 running, 1 waiting
  pool.speak({ text: "4", voice: "jane" }).catch(() => {});
  await tick();
  assert.equal(pool.canAdmit(), false); // 2 running, 2 waiting
});

test("a failing worker is skipped for a while and the chunk goes to the other one", async () => {
  let now = 1000;
  const urls = [];
  const pool = new PocketPool({
    urls: ["http://a", "http://b"],
    now: () => now,
    fetchImpl: async (url) => { urls.push(String(url)); return String(url).startsWith("http://a") ? new Response("boom", { status: 500 }) : mp3("ok"); }
  });
  assert.equal(String(await pool.speak({ text: "hi", voice: "jane" })), "ok");
  assert.deepEqual(urls, ["http://a/tts", "http://b/tts"]);
  assert.equal(pool.up().length, 1);
  now += 31_000;
  assert.equal(pool.up().length, 2);
});

test("a busy (503) worker is not marked down", async () => {
  const pool = new PocketPool({
    urls: ["http://a", "http://b"],
    fetchImpl: async (url) => String(url).startsWith("http://a") ? new Response("busy", { status: 503 }) : mp3("ok")
  });
  assert.equal(String(await pool.speak({ text: "hi", voice: "jane" })), "ok");
  assert.equal(pool.up().length, 2);
});

test("a rejected request is not retried and does not mark the worker down", async () => {
  let calls = 0;
  const pool = new PocketPool({ urls: ["http://a", "http://b"], fetchImpl: async () => { calls += 1; return new Response("bad", { status: 422 }); } });
  await assert.rejects(pool.speak({ text: "hi", voice: "jane" }), /rejected/);
  assert.equal(calls, 1);
  assert.equal(pool.up().length, 2);
});

test("all workers down is reported as unavailable straight away", async () => {
  const pool = new PocketPool({ urls: ["http://a"], fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  await assert.rejects(pool.speak({ text: "hi", voice: "jane" }), PocketUnavailable);
  await assert.rejects(pool.speak({ text: "hi", voice: "jane" }), PocketUnavailable);
  assert.equal(pool.canAdmit(), false);
});

test("a cancelled chunk leaves the queue and cancels its request", async () => {
  const { calls, fetchImpl } = fakeWorkers();
  const pool = new PocketPool({ urls: ["http://a"], fetchImpl });
  const running = new AbortController();
  const queued = new AbortController();
  const first = pool.speak({ text: "one", voice: "jane", signal: running.signal });
  const second = pool.speak({ text: "two", voice: "jane", signal: queued.signal });
  await tick();
  queued.abort(new Error("interrupted"));
  await assert.rejects(second, /interrupted/);
  assert.equal(pool.waiting.length, 0);
  running.abort(new Error("interrupted"));
  await assert.rejects(first, /interrupted/);
  assert.equal(calls.length, 1);
  assert.equal(pool.up().length, 1); // a cancel is not a failure
  assert.equal(pool.workers[0].busy, false);
});

test("a session picks its engine once, and chunks requested together agree", async () => {
  const { calls, fetchImpl } = fakeWorkers();
  const pool = new PocketPool({ urls: ["http://a", "http://b"], fetchImpl });
  const session = createSpeechSession({ pool, kokoro: async () => Buffer.from("kokoro") });
  const chunks = ["one", "two", "three"].map((text) => session.speak({ text, voice: "am_puck", speed: 1.15 }));
  assert.equal(session.engine, "pocket");
  await tick();
  // One chunk at a time per session, so one conversation never holds both workers.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { text: "one", voice: "george", speed: 1.15 });
  for (let i = 0; i < 3; i += 1) {
    calls[i].resolve(mp3(`p${i}`));
    await tick(); await tick();
  }
  assert.deepEqual((await Promise.all(chunks)).map(({ audio, engine }) => `${engine}:${audio}`), ["pocket:p0", "pocket:p1", "pocket:p2"]);
});

test("a session that starts while Pocket is full uses Kokoro for good", async () => {
  const { fetchImpl } = fakeWorkers();
  const pool = new PocketPool({ urls: ["http://a"], fetchImpl });
  for (let i = 0; i < 2; i += 1) pool.speak({ text: `${i}`, voice: "jane" }).catch(() => {});
  await tick();
  const session = createSpeechSession({ pool, kokoro: async ({ text }) => Buffer.from(`k:${text}`) });
  assert.equal(String((await session.speak({ text: "hi", voice: "af_heart" })).audio), "k:hi");
  assert.equal(session.engine, "kokoro");
});

test("without Pocket every session uses Kokoro", async () => {
  const session = createSpeechSession({ pool: null, kokoro: async () => Buffer.from("k") });
  assert.deepEqual(await session.speak({ text: "hi", voice: "af_heart" }), { audio: Buffer.from("k"), engine: "kokoro" });
});

test("Pocket failing before a reply is heard switches to Kokoro at once", async () => {
  const pool = new PocketPool({ urls: ["http://a"], fetchImpl: async () => { throw new Error("down"); } });
  const session = createSpeechSession({ pool, kokoro: async () => Buffer.from("k") });
  session.beginReply();
  const results = await Promise.all([session.speak({ text: "a", voice: "af_heart" }), session.speak({ text: "b", voice: "af_heart" })]);
  assert.deepEqual(results.map((item) => item.engine), ["kokoro", "kokoro"]);
});

test("Pocket failing mid-reply keeps the voice: the rest is text only, Kokoro from the next reply", async () => {
  let up = true;
  const pool = new PocketPool({ urls: ["http://a"], fetchImpl: async () => { if (up) return mp3("p"); throw new Error("down"); } });
  pool.now = () => 0; // keep the failed worker eligible so the test controls availability
  const session = createSpeechSession({ pool, kokoro: async () => Buffer.from("k") });
  session.beginReply();
  assert.equal((await session.speak({ text: "a", voice: "af_heart" })).engine, "pocket");
  up = false;
  await assert.rejects(session.speak({ text: "b", voice: "af_heart" }), PocketUnavailable);
  assert.equal(session.engine, "pocket");
  session.beginReply();
  assert.equal(session.engine, "kokoro");
  assert.equal((await session.speak({ text: "c", voice: "af_heart" })).engine, "kokoro");
});

test("session store reuses live sessions and forgets idle ones", () => {
  let now = 0;
  const store = createSessionStore({ ttlMs: 1000, max: 2, now: () => now });
  const first = store.get("a", () => ({ id: 1 }));
  assert.equal(store.get("a", () => ({ id: 2 })), first);
  now = 2000;
  assert.notEqual(store.get("a", () => ({ id: 3 })), first);
  store.get("b", () => ({}));
  store.get("c", () => ({}));
  assert.equal(store.get("a", () => ({ id: 4 })).id, 4); // evicted as least recently used
});

test("a burst of new sessions beyond the queue limit goes to Kokoro instead of waiting", async () => {
  const { calls, fetchImpl } = fakeWorkers();
  const pool = new PocketPool({ urls: ["http://a", "http://b"], fetchImpl });
  const sessions = Array.from({ length: 12 }, () => createSpeechSession({ pool, kokoro: async () => Buffer.from("k") }));
  const results = sessions.map((session) => session.speak({ text: "hi", voice: "af_heart" }));
  await tick(); await tick();
  assert.equal(calls.length, 2);
  assert.equal(pool.waiting.length, 2);
  const settled = await Promise.all(results.slice(4));
  assert.deepEqual(settled.map((item) => item.engine), Array(8).fill("kokoro"));
  for (const session of sessions.slice(4)) assert.equal(session.engine, "kokoro");
  for (let i = 0; i < 4; i += 1) {
    calls[i].resolve(mp3("p"));
    await tick(); await tick();
  }
  assert.deepEqual((await Promise.all(results.slice(0, 4))).map((item) => item.engine), Array(4).fill("pocket"));
});

test("a chunk of an earlier reply finishing late does not count as the new reply speaking", async () => {
  const { calls, fetchImpl } = fakeWorkers();
  const pool = new PocketPool({ urls: ["http://a"], fetchImpl, now: () => 0 });
  const session = createSpeechSession({ pool, kokoro: async () => Buffer.from("k") });
  session.beginReply();
  const old = session.speak({ text: "old", voice: "af_heart" });
  await tick();
  session.beginReply(); // the user cut in
  calls[0].resolve(mp3("late"));
  await old;
  // The new reply's first chunk fails: nothing of it was heard, so it falls back at once.
  pool.workers[0].downUntil = 1;
  const fresh = await session.speak({ text: "new", voice: "af_heart" });
  assert.equal(fresh.engine, "kokoro");
});

test("text longer than a worker accepts is spoken in pieces and joined into one clip", async () => {
  const frame = readFileSync(new URL("../public/audio/voices/pocket/af_heart.mp3", import.meta.url)); // a real Pocket clip
  const bodies = [];
  const pool = new PocketPool({ urls: ["http://a"], fetchImpl: async (url, options) => { bodies.push(JSON.parse(options.body).text); return new Response(frame); } });
  const session = createSpeechSession({ pool, kokoro: async () => Buffer.from("k") });
  const sentence = "This sentence is about forty characters. ";
  const { audio, engine } = await session.speak({ text: sentence.repeat(60).trim(), voice: "af_heart" });
  assert.equal(engine, "pocket");
  assert.ok(bodies.length >= 3);
  assert.ok(bodies.every((text) => text.length <= 900 && /\.$/.test(text)));
  assert.ok(audio.length > frame.length * (bodies.length - 1));
});
