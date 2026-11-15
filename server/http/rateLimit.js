import ipaddr from "ipaddr.js";
import { HttpError } from "./responses.js";

const counters = new Map();
const PROXY_RANGES = new Set(["loopback", "private", "uniqueLocal"]);

function parsedAddress(value) {
  try {
    return ipaddr.process(String(value || "").trim());
  } catch {
    return null;
  }
}

/**
 * The caller's address. In production Caddy on the same host proxies to the app, so the
 * socket peer is loopback or the Docker gateway. Caddy appends the address it saw to
 * X-Forwarded-For, so the rightmost entry is the only one a client cannot forge. Forwarded
 * headers from any other peer (someone reaching the port directly) are ignored.
 */
export function clientAddress(req) {
  const peer = parsedAddress(req.socket?.remoteAddress);
  if (peer && PROXY_RANGES.has(peer.range())) {
    const header = req.headers?.["x-forwarded-for"];
    const hops = (Array.isArray(header) ? header.join(",") : String(header || "")).split(",");
    const forwarded = parsedAddress(hops.at(-1));
    if (forwarded) return forwarded.toString();
  }
  return peer ? peer.toString() : "unknown";
}

export function enforceRateLimit(req, bucket, limit, windowMs = 60_000, principal = "") {
  const now = Date.now();
  const identity = principal ? String(principal).slice(0, 64) : clientAddress(req);
  const key = `${bucket}:${identity}`;
  const current = counters.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  entry.count += 1;
  counters.set(key, entry);
  if (entry.count > limit) throw new HttpError(429, "Too many requests. Try again shortly.", { code: "rate_limited", retryable: true });
  if (counters.size > 10_000) for (const [candidate, value] of counters) if (value.resetAt <= now) counters.delete(candidate);
}

/** A per-account limit for code that runs after sign-in, away from the request itself. */
export function enforceAccountRateLimit(bucket, limit, windowMs, accountId) {
  if (!accountId) throw new Error("enforceAccountRateLimit needs an account id.");
  enforceRateLimit(null, bucket, limit, windowMs, accountId);
}
