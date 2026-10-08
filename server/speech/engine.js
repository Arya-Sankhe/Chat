import { joinMp3, readMp3 } from "../study/mp3.js";

// Live speech engines. Self-hosted Pocket TTS (ops/pocket-tts: two workers, one generation each)
// is preferred because it is several times faster than Kokoro through OpenRouter; Kokoro is the
// fallback when Pocket is saturated or down.
//
// The two engines are different voices, so a speech session (one voice-mode conversation, one
// tutor call) picks its engine once and keeps it: the voice never changes inside a reply. If
// Pocket fails after a reply has started speaking, the rest of that reply is text only and the
// session moves to Kokoro from the next reply.

// Each persona keeps its Kokoro voice id (stored in prefs and sessions); this is its Pocket voice.
export const POCKET_VOICES = {
  af_heart: "jane",
  af_bella: "anna",
  bf_emma: "caro_davy",
  am_michael: "michael",
  am_fenrir: "javert",
  am_puck: "george"
};

const DOWN_MS = 30_000;
const QUEUE_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
// The workers take at most 1000 characters; longer text is spoken in pieces and joined.
const MAX_PIECE_CHARS = 900;

export class PocketUnavailable extends Error {}
class PocketRejected extends Error {}

/** A fixed set of Pocket workers, each running one generation at a time. */
export class PocketPool {
  constructor({ urls = [], fetchImpl = fetch, now = Date.now, queueTimeoutMs = QUEUE_TIMEOUT_MS, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.workers = urls.map((url) => ({ url, busy: false, downUntil: 0 }));
    this.waiting = [];
    this.fetch = fetchImpl;
    this.now = now;
    this.queueTimeoutMs = queueTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  up() {
    return this.workers.filter((worker) => worker.downUntil <= this.now());
  }

  // A new session starts on Pocket while a worker is free, or at most one chunk is already
  // waiting per worker; past that it would queue behind other people's speech, so it uses Kokoro.
  canAdmit() {
    const up = this.up();
    return up.length > 0 && (up.some((worker) => !worker.busy) || this.waiting.length < up.length);
  }

  // Waits for a free worker that this chunk has not already tried. A `bounded` chunk (one that
  // can still go to Kokoro without changing a voice mid-reply) does not join a full queue.
  acquire(signal, tried = new Set(), bounded = false) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const eligible = this.up().filter((worker) => !tried.has(worker));
    if (!eligible.length) return Promise.reject(new PocketUnavailable("Pocket TTS is down."));
    const free = eligible.find((worker) => !worker.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    if (bounded && this.waiting.length >= eligible.length) return Promise.reject(new PocketUnavailable("Pocket TTS is busy."));
    return new Promise((resolve, reject) => {
      const waiter = {
        tried,
        resolve: (worker) => { done(); resolve(worker); },
        reject: (error) => { done(); reject(error); }
      };
      const onAbort = () => waiter.reject(signal.reason);
      const timer = setTimeout(() => waiter.reject(new PocketUnavailable("Pocket TTS is busy.")), this.queueTimeoutMs);
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.waiting = this.waiting.filter((item) => item !== waiter);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(waiter);
    });
  }

  release(worker) {
    worker.busy = false;
    // A worker just went down: anyone left with no worker to wait for gives up now.
    for (const waiter of [...this.waiting]) {
      if (!this.up().some((item) => !waiter.tried.has(item))) waiter.reject(new PocketUnavailable("Pocket TTS is down."));
    }
    if (worker.downUntil > this.now()) return;
    const next = this.waiting.find((waiter) => !waiter.tried.has(worker));
    if (next) {
      worker.busy = true;
      next.resolve(worker);
    }
  }

  /** One MP3 clip, or throws PocketUnavailable when no worker could make it. */
  async speak({ text, voice, speed = 1, signal, bounded = false }) {
    let lastError = null;
    const tried = new Set();
    for (;;) {
      let worker;
      try {
        worker = await this.acquire(signal, tried, bounded);
      } catch (error) {
        throw (error instanceof PocketUnavailable && lastError) || error;
      }
      tried.add(worker);
      try {
        const timeout = AbortSignal.timeout(this.requestTimeoutMs);
        const response = await this.fetch(`${worker.url}/tts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, voice, speed }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
        if (response.ok) return Buffer.from(await response.arrayBuffer());
        await response.body?.cancel().catch(() => {});
        // 4xx is our request, not the worker: trying again elsewhere would fail the same way.
        if (response.status >= 400 && response.status < 500 && response.status !== 499) throw new PocketRejected(`Pocket TTS rejected the request (${response.status}).`);
        // 503 means the worker is generating for someone else (e.g. a request we gave up on is
        // still finishing); it is healthy, so only another worker is worth trying.
        if (response.status !== 503) worker.downUntil = this.now() + DOWN_MS;
        lastError = new PocketUnavailable(`Pocket TTS returned ${response.status}.`);
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error instanceof PocketRejected) throw error;
        worker.downUntil = this.now() + DOWN_MS;
        lastError = new PocketUnavailable(error?.message || "Pocket TTS failed.");
      } finally {
        this.release(worker);
      }
    }
  }
}

/** Splits text over `max` characters at sentence, then clause, then word boundaries. */
export function splitLongText(text, max = MAX_PIECE_CHARS) {
  const pieces = [];
  let rest = String(text || "").trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    const at = (pattern) => [...window.matchAll(pattern)].map((match) => match.index + match[0].length).filter((end) => end <= max && end >= max / 3).at(-1);
    const cut = at(/[.!?]+["')\]]*\s/g) ?? at(/[,;:]\s/g) ?? at(/\s/g) ?? max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * One conversation's speech. `kokoro({ text, voice, speed, signal })` is the fallback engine.
 * speak() resolves to { audio, engine }. Call beginReply() at the start of each reply.
 */
export function createSpeechSession({ pool, kokoro }) {
  let engine = null;
  let reply = 0;
  let spokenReply = -1; // the latest reply that has produced Pocket audio
  let switchNextReply = false;
  let chain = Promise.resolve();

  const viaKokoro = async (args) => ({ audio: await kokoro(args), engine: "kokoro" });
  async function viaPocket(args, at) {
    if (engine === "kokoro") return viaKokoro(args); // switched while this chunk was queued
    const speaking = spokenReply === at;
    try {
      const voice = POCKET_VOICES[args.voice] || POCKET_VOICES.af_heart;
      const pieces = splitLongText(args.text);
      const clips = [];
      for (const text of pieces) {
        // Until this reply is speaking it can still move to Kokoro, so it does not wait in a full queue.
        clips.push(await pool.speak({ text, voice, speed: args.speed, signal: args.signal, bounded: !speaking }));
      }
      if (at === reply) spokenReply = at;
      return { audio: clips.length === 1 ? clips[0] : joinMp3(clips.map(readMp3)), engine: "pocket" };
    } catch (error) {
      if (args.signal?.aborted || !(error instanceof PocketUnavailable) || at !== reply) throw error;
      // Nothing of this reply has been heard yet: switch now. Otherwise keep the voice and
      // switch from the next reply.
      if (!speaking) {
        engine = "kokoro";
        return viaKokoro(args);
      }
      switchNextReply = true;
      throw error;
    }
  }

  return {
    get engine() { return engine; },
    get reply() { return reply; },
    beginReply() {
      reply += 1;
      if (switchNextReply) engine = "kokoro";
      switchNextReply = false;
      return reply;
    },
    speak(args) {
      // Decided synchronously on the first chunk, so chunks requested together agree. Admission
      // is only a first guess: a burst that overfills the queue still moves to Kokoro before any
      // of its audio is heard (bounded acquire above).
      engine ??= pool?.canAdmit() ? "pocket" : "kokoro";
      if (engine === "kokoro") return viaKokoro(args);
      const at = reply;
      // One chunk at a time per session, in order, so one conversation never holds both workers.
      const run = chain.then(() => viaPocket(args, at));
      chain = run.catch(() => {});
      return run;
    }
  };
}

let sharedPool = null;
let sharedUrls = "";

/** The process-wide Pocket pool for this config, or null when Pocket is not configured. */
export function pocketPool(config) {
  const urls = config?.speech?.pocketUrls || [];
  if (!urls.length) return null;
  const key = urls.join(",");
  if (!sharedPool || sharedUrls !== key) {
    sharedPool = new PocketPool({ urls });
    sharedUrls = key;
  }
  return sharedPool;
}

/** Sessions kept between requests (voice mode makes one request per sentence). */
export function createSessionStore({ ttlMs = 30 * 60_000, max = 2000, now = Date.now } = {}) {
  const sessions = new Map();
  return {
    get(key, create) {
      const hit = sessions.get(key);
      if (hit && now() - hit.at < ttlMs) {
        hit.at = now();
        sessions.delete(key);
        sessions.set(key, hit); // most recently used last
        return hit.session;
      }
      const session = create();
      sessions.set(key, { at: now(), session });
      while (sessions.size > max) sessions.delete(sessions.keys().next().value);
      return session;
    },
    clear() { sessions.clear(); }
  };
}
