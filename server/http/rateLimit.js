import { HttpError } from "./responses.js";

const counters = new Map();

export function enforceRateLimit(req, bucket, limit, windowMs = 60_000) {
  const now = Date.now();
  const cloudflareAddress = Array.isArray(req.headers?.["cf-connecting-ip"])
    ? req.headers["cf-connecting-ip"][0]
    : req.headers?.["cf-connecting-ip"];
  const address = String(cloudflareAddress || req.socket?.remoteAddress || "unknown").slice(0, 64);
  const key = `${bucket}:${address}`;
  const current = counters.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  entry.count += 1;
  counters.set(key, entry);
  if (entry.count > limit) throw new HttpError(429, "Too many requests. Try again shortly.", { code: "rate_limited", retryable: true });
  if (counters.size > 10_000) for (const [candidate, value] of counters) if (value.resetAt <= now) counters.delete(candidate);
}
