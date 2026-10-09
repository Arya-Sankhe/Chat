// Saving a whiteboard. Every edit is written to a local draft first (IndexedDB in the browser),
// then saved to the server one request at a time against the revision it started from. A save
// that lost to another tab or device never overwrites anything: server saves pause, edits keep
// going to the local draft, and the student chooses what to do.
// Each open board (each tab) keeps its own draft key, so one tab never clears another's draft.

const DEBOUNCE_MS = 1200;
const RETRY_MS = [2000, 5000, 15_000, 30_000];

/** A tiny IndexedDB key-value store; falls back to memory where IndexedDB is unavailable. */
export function draftStore(name = "klui-whiteboards") {
  const memory = new Map();
  const idb = globalThis.indexedDB;
  let opening = null;
  const open = () => {
    if (!idb) return Promise.resolve(null);
    opening ||= new Promise((resolve) => {
      const request = idb.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("drafts");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return opening;
  };
  const run = async (mode, action, fallback) => {
    const db = await open();
    if (!db) return fallback();
    return new Promise((resolve) => {
      const tx = db.transaction("drafts", mode);
      const request = action(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    });
  };
  return {
    /** Every draft whose key starts with `prefix`: [{ key, value }]. */
    list: async (prefix) => {
      const db = await open();
      if (!db) return [...memory].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value }));
      return new Promise((resolve) => {
        const out = [];
        const tx = db.transaction("drafts", "readonly");
        const cursor = tx.objectStore("drafts").openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
        cursor.onsuccess = () => {
          const at = cursor.result;
          if (!at) return;
          out.push({ key: at.key, value: at.value });
          at.continue();
        };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => resolve(out);
        tx.onabort = () => resolve(out);
      });
    },
    get: (key) => run("readonly", (store) => store.get(key), () => memory.get(key)),
    put: (key, value) => run("readwrite", (store) => store.put(value, key), () => { memory.set(key, value); }),
    delete: (key) => run("readwrite", (store) => store.delete(key), () => { memory.delete(key); })
  };
}

/**
 * Holds a lock named `name` while the tab lives, so other tabs can tell a live draft from one
 * left behind by a closed tab. Resolves to a release function.
 */
export async function holdLock(name) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return () => {};
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await new Promise((acquired) => {
    locks.request(name, () => { acquired(); return held; }).catch(() => acquired());
  });
  return release;
}

/** Names of locks held by any tab right now; null when the browser can't tell. */
export async function heldLocks() {
  const locks = globalThis.navigator?.locks;
  if (!locks?.query) return null;
  try {
    const { held = [] } = await locks.query();
    return new Set(held.map((lock) => lock.name));
  } catch {
    return null;
  }
}

/**
 * save({ expectedRevision, scene }) → { revision }; throws errors with .status / .code.
 * onStatus(status, detail): "saved" | "dirty" | "saving" | "offline" | "failed" | "conflict".
 * edit(scene, extra) stores { scene, ...extra } in the draft; `extra` carries what the draft needs
 * beyond the scene (images not uploaded yet).
 */
export function createSaveQueue({ key, revision, save, store, onStatus, debounceMs = DEBOUNCE_MS, timers = globalThis }) {
  let base = revision;
  let seq = 0;
  let savedSeq = 0;
  let latest = null;
  let inflight = null;
  let timer = 0;
  let attempt = 0;
  let conflict = false; // lost to another copy: no server saves until reset()
  let held = false; // waiting on something (image uploads) before the server can take the scene
  let stopped = false;
  let rejected = false; // the server refused this content; wait for the next edit
  let status = "saved";
  let drafting = Promise.resolve();

  const set = (next, detail) => {
    status = next;
    onStatus?.(next, detail);
  };
  const schedule = (ms) => {
    timers.clearTimeout(timer);
    if (stopped || conflict || held) return;
    timer = timers.setTimeout(() => flush(), ms);
  };
  const writeDraft = (record) => {
    drafting = drafting.then(() => store?.put(key, record)).catch(() => {});
    return drafting;
  };

  async function flush() {
    timers.clearTimeout(timer);
    if (inflight) return inflight;
    if (stopped || conflict || held || rejected || seq === savedSeq || !latest) return;
    const sending = { seq, scene: latest };
    set("saving");
    inflight = (async () => {
      try {
        const result = await save({ expectedRevision: base, scene: sending.scene });
        base = result.revision;
        savedSeq = sending.seq;
        attempt = 0;
        if (savedSeq === seq) {
          // Queued behind any draft write, and skipped if an edit arrived meanwhile.
          drafting = drafting.then(() => (savedSeq === seq ? store?.delete(key) : null)).catch(() => {});
          await drafting;
          set(savedSeq === seq ? "saved" : "dirty");
        } else {
          // Edits made while this save was in flight still need saving.
          await writeDraft({ ...latestRecord, baseRevision: base, at: Date.now() });
          set("dirty");
          schedule(debounceMs);
        }
      } catch (error) {
        if (error?.status === 409 && error.code === "revision_conflict") {
          conflict = true;
          set("conflict", error.details || null);
        } else if (error?.status === 422 || error?.status === 413 || error?.status === 404) {
          // Retrying the same content cannot help; wait for the next edit.
          rejected = true;
          set("failed", error.message);
        } else {
          set(globalThis.navigator?.onLine === false ? "offline" : "failed", error?.message || "");
          schedule(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
          attempt += 1;
        }
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  let latestRecord = null;

  return {
    get status() { return status; },
    get revision() { return base; },
    get dirty() { return seq !== savedSeq; },
    get conflict() { return conflict; },
    /** Records an edit: local draft now (always, even after a conflict), server save after a pause. */
    async edit(scene, extra = {}) {
      seq += 1;
      latest = scene;
      rejected = false;
      latestRecord = { ...extra, scene };
      if (!conflict) set("dirty");
      await writeDraft({ ...latestRecord, baseRevision: base, at: Date.now() });
      schedule(debounceMs);
    },
    /** Saves now (leaving the board, the app going to the background). */
    flush,
    /** Saves until nothing is pending, or until saving can't go on (conflict, failure, held). */
    async drain() {
      for (let round = 0; round < 8; round += 1) {
        if (inflight) await inflight;
        if (stopped || conflict || held || rejected || seq === savedSeq) break;
        const before = savedSeq;
        await flush();
        if (savedSeq === before) break; // failed; the draft keeps it
      }
      await drafting;
    },
    /** Pauses server saves (edits still reach the draft) until release(). */
    hold() {
      held = true;
      timers.clearTimeout(timer);
    },
    release() {
      if (!held) return;
      held = false;
      if (seq !== savedSeq) schedule(0);
    },
    /** After a conflict was resolved by loading another copy. */
    reset(nextRevision) {
      timers.clearTimeout(timer);
      base = nextRevision;
      seq = 0;
      savedSeq = 0;
      latest = null;
      latestRecord = null;
      attempt = 0;
      conflict = false;
      rejected = false;
      set("saved");
    },
    stop() {
      stopped = true;
      timers.clearTimeout(timer);
    }
  };
}
