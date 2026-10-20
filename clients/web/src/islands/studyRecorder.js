// Lecture recorder for Dojo audio sources.
// Records in one-second slices and writes every slice to IndexedDB as it arrives, so a
// closed tab, crash, or dead battery never loses more than a second of a lecture. The
// saved copy is removed only once the server has queued the recording.

const DB_NAME = "klui-dojo-recorder";
const DB_VERSION = 1;
const SLICE_MS = 1000;
const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm"
];

let dbPromise = null;

function openDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  dbPromise ||= new Promise((resolve) => {
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("recordings")) db.createObjectStore("recordings", { keyPath: "id" });
      if (!db.objectStoreNames.contains("chunks")) {
        db.createObjectStore("chunks", { autoIncrement: true }).createIndex("recordingId", "recordingId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    // Private windows can refuse storage; recording still works, just without recovery.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(db, stores, mode, work) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    const result = work(transaction);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function saveMeta(meta) {
  const db = await openDb();
  if (!db) return false;
  try {
    await tx(db, ["recordings"], "readwrite", (t) => t.objectStore("recordings").put(meta));
    return true;
  } catch {
    return false;
  }
}

async function saveChunk(recordingId, seq, blob) {
  const db = await openDb();
  if (!db) return false;
  try {
    await tx(db, ["chunks"], "readwrite", (t) => t.objectStore("chunks").add({ recordingId, seq, blob }));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSavedRecording(id) {
  const db = await openDb();
  if (!db || !id) return;
  await tx(db, ["recordings", "chunks"], "readwrite", (t) => {
    t.objectStore("recordings").delete(id);
    const index = t.objectStore("chunks").index("recordingId");
    index.openKeyCursor(IDBKeyRange.only(id)).onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      t.objectStore("chunks").delete(cursor.primaryKey);
      cursor.continue();
    };
  }).catch(() => {});
}

// Recordings left behind by a closed tab, newest first.
export async function listSavedRecordings(courseId) {
  const db = await openDb();
  if (!db) return [];
  const rows = await tx(db, ["recordings"], "readonly", (t) => {
    const out = [];
    t.objectStore("recordings").openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      out.push(cursor.value);
      cursor.continue();
    };
    return out;
  }).catch(() => []);
  return rows
    .filter((row) => (!courseId || row.courseId === courseId) && row.durationSeconds >= 1)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export async function loadSavedRecording(id) {
  const db = await openDb();
  if (!db) return null;
  const [meta, parts] = await tx(db, ["recordings", "chunks"], "readonly", (t) => {
    const found = [null, []];
    t.objectStore("recordings").get(id).onsuccess = (event) => { found[0] = event.target.result || null; };
    t.objectStore("chunks").index("recordingId").openCursor(IDBKeyRange.only(id)).onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      found[1].push(cursor.value);
      cursor.continue();
    };
    return found;
  }).catch(() => [null, []]);
  if (!meta || !parts.length) return null;
  parts.sort((a, b) => a.seq - b.seq);
  return { ...meta, blob: new Blob(parts.map((part) => part.blob), { type: meta.mimeType }) };
}

export function recordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export function recordingExtension(mimeType) {
  const type = String(mimeType || "");
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

export function recordingTitle(date = new Date()) {
  const when = date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `Recording · ${when}`;
}

function newId() {
  return crypto.randomUUID?.() || `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function createLectureRecorder({ onChange }) {
  let state = "idle";
  let error = "";
  let stream = null;
  let recorder = null;
  let audioContext = null;
  let analyser = null;
  let samples = null;
  let wakeLock = null;
  let chunks = [];
  let seq = 0;
  let meta = null;
  let elapsedBefore = 0;
  let runningSince = 0;
  let persisted = true;
  const writes = new Set();
  let stopped = null;
  let result = null;

  const set = (next, message = "") => {
    state = next;
    error = message;
    onChange?.(state);
  };

  // The UI promises the recording survives a closed tab; once a write fails that is no
  // longer true, so say so instead.
  const markUnsaved = (ok) => {
    if (ok || !persisted) return;
    persisted = false;
    if (result) result.persisted = false;
    onChange?.(state);
  };
  // Slice writes run in the background; stop() waits for them so the review step knows
  // whether the backup is complete.
  const track = (write) => {
    const pending = write.then(markUnsaved);
    writes.add(pending);
    void pending.finally(() => writes.delete(pending));
  };

  const elapsed = () => (elapsedBefore + (state === "recording" ? performance.now() - runningSince : 0)) / 1000;

  async function holdWakeLock() {
    try {
      const lock = await navigator.wakeLock?.request("screen");
      wakeLock = lock || null;
      // The browser drops the lock when the page is hidden; a released lock can't be reused.
      lock?.addEventListener?.("release", () => { if (wakeLock === lock) wakeLock = null; });
    } catch {
      wakeLock = null;
    }
  }

  function releaseDevices() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    audioContext?.close().catch(() => {});
    audioContext = null;
    analyser = null;
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  }

  // Screens that dim release the wake lock; take it back when the page is visible again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state === "recording" && (!wakeLock || wakeLock.released)) void holdWakeLock();
  });

  async function start(courseId) {
    if (!["idle", "stopped"].includes(state)) return;
    if (!recordingSupported()) {
      set("idle", "Recording isn't supported in this browser. Upload an audio file instead.");
      return;
    }
    result = null;
    set("requesting");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Far-away lecturers need gain; echo cancellation only helps calls and can eat speech.
        audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
    } catch (err) {
      releaseDevices();
      set("idle", err?.name === "NotAllowedError" || err?.name === "SecurityError"
        ? "Microphone access was blocked. Allow it in your browser's site settings and try again."
        : err?.name === "NotFoundError" ? "No microphone was found." : "The microphone could not be started.");
      return;
    }
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
    try {
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48000 });
    } catch {
      releaseDevices();
      set("idle", "This browser can't record audio here. Upload an audio file instead.");
      return;
    }
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      samples = new Uint8Array(analyser.fftSize);
      audioContext.createMediaStreamSource(stream).connect(analyser);
    } catch {
      analyser = null;
    }
    chunks = [];
    seq = 0;
    elapsedBefore = 0;
    persisted = true;
    meta = {
      id: newId(),
      courseId,
      startedAt: Date.now(),
      mimeType: recorder.mimeType || mimeType || "audio/webm",
      durationSeconds: 0,
      title: recordingTitle()
    };
    markUnsaved(await saveMeta(meta));
    recorder.ondataavailable = (event) => {
      if (!event.data?.size) return;
      chunks.push(event.data);
      const index = seq++;
      meta.durationSeconds = Math.round(elapsed());
      track(saveChunk(meta.id, index, event.data));
      track(saveMeta(meta));
    };
    recorder.onstop = () => {
      stopped?.();
      stopped = null;
    };
    // A mic that disappears (unplugged, permission revoked) ends the recording cleanly.
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (state === "recording" || state === "paused") void stop("The microphone disconnected, so recording stopped.");
    });
    recorder.start(SLICE_MS);
    runningSince = performance.now();
    await holdWakeLock();
    set("recording");
  }

  function pause() {
    if (state !== "recording" || recorder?.state !== "recording") return;
    recorder.pause();
    elapsedBefore += performance.now() - runningSince;
    set("paused");
  }

  function resume() {
    if (state !== "paused" || recorder?.state !== "paused") return;
    recorder.resume();
    runningSince = performance.now();
    set("recording");
  }

  async function stop(message = "") {
    if (!["recording", "paused"].includes(state)) return result;
    const duration = elapsed();
    elapsedBefore = duration * 1000;
    state = "finishing"; // Freezes the clock while the last slice flushes.
    if (recorder && recorder.state !== "inactive") {
      const done = new Promise((resolve) => { stopped = resolve; });
      recorder.stop();
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    releaseDevices();
    await Promise.allSettled([...writes]);
    meta.durationSeconds = Math.round(duration);
    markUnsaved(await saveMeta(meta));
    result = {
      id: meta.id,
      blob: new Blob(chunks, { type: meta.mimeType }),
      mimeType: meta.mimeType,
      durationSeconds: duration,
      title: meta.title,
      startedAt: meta.startedAt,
      courseId: meta.courseId,
      persisted
    };
    recorder = null;
    set("stopped", message);
    return result;
  }

  // Load a recording recovered from IndexedDB into the review step.
  function adopt(saved) {
    if (["recording", "paused", "requesting"].includes(state)) return;
    result = { ...saved };
    meta = { ...saved };
    persisted = true;
    set("stopped");
  }

  async function discard() {
    if (["recording", "paused"].includes(state)) await stop();
    const id = result?.id || meta?.id;
    result = null;
    meta = null;
    chunks = [];
    elapsedBefore = 0;
    set("idle");
    await deleteSavedRecording(id);
  }

  // Hand the recording off. The saved copy is kept (deleteSaved=false) until the server
  // has queued it; the uploader deletes it then.
  function release(deleteSaved = true) {
    const id = result?.id || meta?.id;
    result = null;
    meta = null;
    chunks = [];
    elapsedBefore = 0;
    set("idle");
    return deleteSaved ? deleteSavedRecording(id) : Promise.resolve();
  }

  function level() {
    if (!analyser || state !== "recording") return 0;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const value = (samples[i] - 128) / 128;
      sum += value * value;
    }
    return Math.min(1, Math.sqrt(sum / samples.length) * 3.2);
  }

  // Per-bar loudness from the mic's real spectrum (speech band, ~80 Hz–5 kHz), so the
  // meter moves with what the device actually hears and lies flat in silence.
  let spectrum = null;
  function levels(count) {
    const out = new Array(count).fill(0);
    if (!analyser || state !== "recording") return out;
    spectrum ||= new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(spectrum);
    const hz = (audioContext?.sampleRate || 48000) / analyser.fftSize;
    const low = Math.max(1, Math.floor(80 / hz));
    const high = Math.min(spectrum.length - 1, Math.ceil(5000 / hz));
    // Log-spaced bands, then mirrored so the loudest speech band sits in the middle.
    const half = Math.ceil(count / 2);
    for (let band = 0; band < half; band += 1) {
      const from = Math.floor(low * (high / low) ** (band / half));
      const to = Math.max(from + 1, Math.floor(low * (high / low) ** ((band + 1) / half)));
      let peak = 0;
      for (let i = from; i < to; i += 1) peak = Math.max(peak, spectrum[i]);
      const value = Math.max(0, (peak - 60) / 150); // Ignore the room's noise floor.
      out[half - 1 - band] = value;
      out[count - half + band] = value;
    }
    return out.map((value) => Math.min(1, value));
  }

  return {
    start, pause, resume, stop, adopt, discard, release, level, levels,
    get state() { return state; },
    get error() { return error; },
    get active() { return state === "recording" || state === "paused"; },
    get elapsed() { return elapsed(); },
    get result() { return result; },
    get courseId() { return meta?.courseId || ""; },
    get persisted() { return persisted; },
    setTitle(title) {
      if (meta) meta.title = title;
      if (result) result.title = title;
      if (meta) void saveMeta(meta);
    }
  };
}
