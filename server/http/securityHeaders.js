/**
 * Baseline headers for every response. Routes that need stricter ones (the OAuth pages,
 * whiteboard files) set their own in writeHead, which takes precedence over these.
 * There is no script-src policy yet: the app still loads marked from a CDN and the
 * visualization frames inherit a page policy through srcdoc.
 */
export function securityHeaders({ https = false } = {}) {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    // No other site may frame ours (clickjacking). Nothing frames our pages today; the
    // visualization frames are srcdoc children, which this still allows.
    "x-frame-options": "SAMEORIGIN",
    "content-security-policy": "frame-ancestors 'self'; object-src 'none'",
    // Voice and camera capture run on our origin; embedded third-party frames get neither.
    "permissions-policy": "camera=(self), microphone=(self), geolocation=()",
    // Caddy terminates TLS; browsers ignore this header on plain HTTP anyway.
    ...(https ? { "strict-transport-security": "max-age=31536000" } : {})
  };
}

export function applySecurityHeaders(res, options) {
  for (const [name, value] of Object.entries(securityHeaders(options))) res.setHeader(name, value);
}
