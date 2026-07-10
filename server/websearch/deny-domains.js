/**
 * Shared hostname deny-list for web search and Deep Research.
 *
 * Layered adult filtering (defense in depth):
 *   1. Engine safe-search (SearXNG safesearch=2 / Brave safesearch=strict)
 *   2. Heuristic hostname classifier (TLDs + token patterns below)
 *   3. Curated BUILTIN_ADULT_DENY_DOMAINS (backstop for misses like spankbang.com)
 *   4. WEBSEARCH_DENY_DOMAINS / caller extras (additive — never a replacement)
 */

/** Compact always-on adult deny list (observed leaks + major aliases). */
export const BUILTIN_ADULT_DENY_DOMAINS = Object.freeze([
  "xvideos.com",
  "xvideos.tube",
  "xnxx.com",
  "inxxx.com",
  "pornhub.com",
  "xhamster.com",
  "xhamster.desi",
  "redtube.com",
  "youporn.com",
  "spankbang.com",
  "hqporner.com",
  "eporner.com"
]);

/** ICANN adult / dating TLDs. `.tube` omitted — generic TLD with non-adult use. */
const ADULT_TLDS_RE = /\.(?:xxx|porn|adult|sex|sexy|cam|webcam|dating|singles)$/;

/**
 * Unambiguous adult markers — safe as substrings within a DNS label
 * (e.g. hqporner, eporner, bestpornsites).
 */
const ADULT_SUBSTRING_RE =
  /porn|xvideo|xnxx|xhamster|hentai|redtube|youporn|onlyfans|chaturbate|rule34|brazzers/;

/**
 * Ambiguous or short tokens — label/word boundaries only (`^`, `.`, `-`, `$`)
 * so essex / sussex / middlesex / adultlearning stay clean.
 */
const ADULT_BOUNDARY_RE =
  /(^|[.-])(?:xxx|sex|milf|escorts?|nsfw|nudes?|cam4|jav|adult|bdsm|camgirl|fleshlight|dildo|blowjob|creampie|gangbang|stripchat|bongacams|livejasmin|bangbros|naughtyamerica|erome|motherless|thothub|fapello|javhd|sexcams?|sexchat)([.-]|$)/;

function normalizeHostname(hostname) {
  return String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/**
 * Heuristic adult-hostname classifier (TLD + substring + boundary tokens).
 * Exported for direct unit tests; also folded into hostnameMatchesDenied.
 */
export function isHeuristicallyDeniedHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  return ADULT_TLDS_RE.test(host)
    || ADULT_SUBSTRING_RE.test(host)
    || ADULT_BOUNDARY_RE.test(host);
}

export function normalizeDenyDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/^\.+|\.+$/g, "");
}

/** Merge built-in adult domains with optional configured extras. */
export function mergeDenyDomains(extra = []) {
  const merged = new Set(BUILTIN_ADULT_DENY_DOMAINS);
  for (const entry of Array.isArray(extra) ? extra : []) {
    const domain = normalizeDenyDomain(entry);
    if (domain) merged.add(domain);
  }
  return [...merged];
}

export function hostnameMatchesDenied(hostname, denyDomains) {
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (isHeuristicallyDeniedHostname(host)) return true;
  const deny = Array.isArray(denyDomains) ? denyDomains : [];
  return deny.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Returns true when the URL is denied or cannot be parsed safely.
 * Malformed URLs must not bypass filtering.
 */
export function isDeniedUrl(url, denyDomains) {
  try {
    return hostnameMatchesDenied(new URL(String(url || "")).hostname, denyDomains);
  } catch {
    return true;
  }
}

/**
 * Drop search/discovery results whose URL host matches the deny list.
 * Entries without a usable URL are removed (fail closed), even when the
 * caller supplies an empty deny list — malformed URLs must never bypass.
 */
export function filterDeniedDomains(results, denyDomains) {
  if (!Array.isArray(results) || !results.length) return Array.isArray(results) ? results : [];
  const deny = Array.isArray(denyDomains) ? denyDomains : [];
  return results.filter((entry) => !isDeniedUrl(entry?.url, deny));
}
