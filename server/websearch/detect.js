/**
 * Cheap heuristic detector used to (a) decide whether to expose the
 * `web_search` tool to the model in Auto mode, and (b) optionally
 * nudge the system prompt for obviously search-y prompts. The model
 * still makes the final decision via tool-calling — this is a hint,
 * not a hard gate.
 */

const URL_PATTERN = /\bhttps?:\/\/[^\s)<>"']+/gi;

const TIME_TRIGGERS = [
  /\btoday\b/i,
  /\byesterday\b/i,
  /\btonight\b/i,
  /\bthis\s+(week|month|year|morning|afternoon)\b/i,
  /\blast\s+(week|month|year|night)\b/i,
  /\brecent(?:ly)?\b/i,
  /\bcurrent(?:ly)?\b/i,
  /\blatest\b/i,
  /\bright\s+now\b/i,
  /\bup[\s-]?to[\s-]?date\b/i,
  /\bbreaking\b/i
];

const TOPIC_TRIGGERS = [
  /\bnews\b/i,
  /\bweather\b/i,
  /\bforecast\b/i,
  /\bprice\s+of\b/i,
  /\bstock\s+price\b/i,
  /\bshare\s+price\b/i,
  /\bexchange\s+rate\b/i,
  /\bscore\b/i,
  /\bwho\s+won\b/i,
  /\bwho\s+is\s+winning\b/i,
  /\belection\b/i,
  /\bearnings\b/i,
  /\brelease\s+date\b/i,
  /\bschedule\b/i,
  /\bflight\s+status\b/i
];

const COMMAND_TRIGGERS = [
  /\bsearch\s+(?:for|the\s+web|online|google|bing)\b/i,
  /\blook\s+(?:up|online)\b/i,
  /\bgoogle\s+(?:it|this|for)\b/i,
  /\bcheck\s+online\b/i,
  /\bfind\s+(?:online|on\s+the\s+web)\b/i,
  /\bfact[\s-]?check\b/i
];

function currentYear() {
  return new Date().getUTCFullYear();
}

/**
 * Extract URLs from arbitrary text — used so the model can be hinted to
 * call `read_url` directly instead of `web_search` when the user pastes
 * a link.
 */
export function extractUrls(text) {
  if (typeof text !== "string" || !text) return [];
  const matches = text.match(URL_PATTERN) || [];
  const cleaned = matches
    .map((url) => url.replace(/[).,;:!?'"]+$/g, ""))
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    });
  return Array.from(new Set(cleaned));
}

/**
 * Returns { score, reasons } describing how likely the prompt benefits
 * from fresh web context. Anything > 0 is a positive signal. The model
 * still decides — we just nudge the system prompt when score is high.
 */
export function detectSearchNeed(text) {
  const reasons = [];
  if (typeof text !== "string" || !text.trim()) {
    return { score: 0, reasons, hasUrls: false, urls: [] };
  }

  const urls = extractUrls(text);
  if (urls.length) reasons.push("contains-url");

  for (const pattern of COMMAND_TRIGGERS) {
    if (pattern.test(text)) {
      reasons.push("explicit-search-command");
      break;
    }
  }

  for (const pattern of TIME_TRIGGERS) {
    if (pattern.test(text)) {
      reasons.push("time-sensitive");
      break;
    }
  }

  for (const pattern of TOPIC_TRIGGERS) {
    if (pattern.test(text)) {
      reasons.push("live-data-topic");
      break;
    }
  }

  const year = currentYear();
  const yearMatch = text.match(/\b(19|20)\d{2}\b/g);
  if (yearMatch && yearMatch.some((y) => Number(y) >= year)) {
    reasons.push("current-year-mention");
  }

  return {
    score: reasons.length,
    reasons,
    hasUrls: urls.length > 0,
    urls
  };
}

/**
 * One-line hint appended to the system prompt when score >= 1. Keeps
 * it short so it doesn't dominate the user's own system prompt. The
 * heuristic NEVER forces a search — the model can still ignore the
 * hint if it knows the answer.
 */
export function buildSearchSystemHint(detection) {
  if (!detection || detection.score < 1) return "";
  if (detection.hasUrls) {
    return "The user's message contains one or more URLs. If their question depends on the content of those URLs, call the `read_url` tool to fetch the page contents before answering.";
  }
  return "The user's question appears to involve current events, live data, or external facts. If the answer depends on information you may not have, call the `web_search` tool with a concise query.";
}
