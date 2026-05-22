import { createHash } from "node:crypto";

/**
 * Two-tier search cache:
 *   L1 — in-process LRU (microsecond hits, free)
 *   L2 — Supabase `search_cache` table (survives restarts, shared across
 *        multiple instances if we ever scale horizontally)
 *
 * Jina itself also caches server-side, so an L1+L2 miss still hits a
 * sub-second response. The L2 write is fire-and-forget so a slow DB
 * never blocks a chat turn.
 */

export function hashKey(parts) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(parts));
  return hash.digest("hex");
}

export class SearchCache {
  constructor({ maxEntries = 500, ttlMs = 15 * 60 * 1000, persistent = null } = {}) {
    this.maxEntries = Math.max(1, maxEntries);
    this.ttlMs = Math.max(1, ttlMs);
    this.entries = new Map();
    this.persistent = persistent;
  }

  /**
   * @param {string} key
   * @returns {Promise<any|null>}
   */
  async get(key) {
    const local = this.peekLocal(key);
    if (local !== null) return local;

    if (this.persistent) {
      try {
        const row = await this.persistent.get(key);
        if (row && row.expires_at && new Date(row.expires_at).getTime() > Date.now()) {
          const remainingMs = new Date(row.expires_at).getTime() - Date.now();
          this.setLocal(key, row.results, remainingMs);
          return row.results;
        }
      } catch {
        /* never let a cache-read failure break the turn */
      }
    }

    return null;
  }

  async set(key, value, { query, provider } = {}) {
    this.setLocal(key, value, this.ttlMs);

    if (this.persistent) {
      const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
      this.persistent
        .set({
          query_hash: key,
          query: typeof query === "string" ? query.slice(0, 1000) : "",
          provider: provider || "unknown",
          results: value,
          expires_at: expiresAt
        })
        .catch(() => {
          /* fire-and-forget; persistent cache is best-effort */
        });
    }
  }

  /* ── internal LRU plumbing ── */

  peekLocal(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  setLocal(key, value, ttlMs) {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
