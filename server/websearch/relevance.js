// Relevance filter shared by every search provider: drops results that do not mention the query,
// ranks the rest, and keeps at most two per host.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for", "from", "how",
  "i", "in", "is", "it", "me", "of", "on", "or", "the", "this", "to", "what", "with", "you"
]);

function normalizeQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 400);
}

function terms(value) {
  return [...new Set(
    String(value || "").toLowerCase().match(/[\p{L}\p{N}]+/gu)
      ?.filter((token) => token.length >= 2 && !STOPWORDS.has(token)) || []
  )];
}

function termSet(value) {
  return new Set(terms(value));
}

function resultHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function overlapScore(result, queryTerms, questionTerms, exactQuery) {
  const title = String(result.title || "").toLowerCase();
  const body = `${result.title || ""} ${result.snippet || ""} ${result.url || ""}`.toLowerCase();
  const bodyTerms = termSet(body);
  const titleTerms = termSet(title);
  const queryHits = queryTerms.filter((term) => bodyTerms.has(term)).length;
  const questionHits = questionTerms.filter((term) => bodyTerms.has(term)).length;
  const titleHits = queryTerms.filter((term) => titleTerms.has(term)).length;
  // Cross-engine agreement is a ranking boost, never a requirement.
  const engineBoost = Array.isArray(result.engines) && result.engines.length > 1 ? 1 : 0;
  return {
    queryHits,
    score: queryHits * 3 + titleHits * 2 + Math.min(questionHits, 3) + engineBoost + (exactQuery && body.includes(exactQuery) ? 4 : 0)
  };
}

export function selectRelevantResults(candidates, query, originalQuestion = query, limit = 8) {
  const queryTerms = terms(query).slice(0, 16);
  const questionTerms = terms(originalQuestion).slice(0, 24);
  const exactQuery = normalizeQuery(query).toLowerCase();
  // Queries made of stopwords/short tokens produce no terms; don't filter on them.
  const minHits = queryTerms.length ? (queryTerms.length >= 3 ? 2 : 1) : 0;
  const perHost = new Map();

  return candidates
    .map((result, order) => ({ result, order, ...overlapScore(result, queryTerms, questionTerms, exactQuery) }))
    .filter((entry) => entry.queryHits >= minHits || (exactQuery.length >= 8 && String(entry.result.title || "").toLowerCase().includes(exactQuery)))
    .sort((a, b) => b.score - a.score || Number(b.result.score || 0) - Number(a.result.score || 0) || a.order - b.order)
    .filter(({ result }) => {
      const host = resultHost(result.url);
      const count = perHost.get(host) || 0;
      if (count >= 2) return false;
      perHost.set(host, count + 1);
      return true;
    })
    .slice(0, Math.min(8, Math.max(1, Number(limit) || 5)))
    .map((entry, index) => ({ ...entry.result, index: index + 1 }));
}
