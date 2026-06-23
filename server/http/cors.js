const METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const HEADERS = "Authorization, Content-Type, Accept";

export function normalizeAllowedOrigins(values = []) {
  return [...new Set((values || [])
    .map((value) => String(value || "").trim().replace(/\/+$/, ""))
    .filter(Boolean))];
}

export function applyApiCors(req, res, allowedOrigins = []) {
  const origin = String(req.headers?.origin || "").trim().replace(/\/+$/, "");
  const allowed = origin && allowedOrigins.includes(origin);
  res.setHeader?.("Vary", "Origin");
  if (allowed) {
    res.setHeader?.("Access-Control-Allow-Origin", origin);
    res.setHeader?.("Access-Control-Allow-Methods", METHODS);
    res.setHeader?.("Access-Control-Allow-Headers", HEADERS);
    res.setHeader?.("Access-Control-Max-Age", "86400");
  }
  return { origin, allowed };
}

export function handleApiPreflight(req, res, allowedOrigins = []) {
  if (req.method !== "OPTIONS") return false;
  const { origin, allowed } = applyApiCors(req, res, allowedOrigins);
  if (origin && !allowed) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Origin not allowed");
    return true;
  }
  res.writeHead(204);
  res.end();
  return true;
}
