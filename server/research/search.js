import { filterDeniedDomains, mergeDenyDomains } from "../websearch/deny-domains.js";
import { searxngSearch } from "../websearch/searxng.js";

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export async function searchResearchQueries(queries, { config, signal }) {
  const denyDomains = mergeDenyDomains(config.websearch?.denyDomains);
  const searches = await Promise.all(queries.map((query) => searxngSearch({
    query,
    numResults: config.research.searchResultsPerQuery,
    baseUrl: config.websearch.searxng.baseUrl,
    engines: config.websearch.searxng.engines,
    timeoutMs: config.websearch.fetchTimeoutMs,
    signal,
    raw: true
  }).catch(() => ({ query, results: [] }))));

  const urls = new Set();
  const domains = new Map();
  const results = [];
  for (const search of searches) {
    const allowed = filterDeniedDomains(search.results || [], denyDomains);
    for (const result of allowed) {
      const url = normalizedUrl(result.url);
      if (!url || urls.has(url)) continue;
      const host = new URL(url).hostname.replace(/^www\./, "");
      if ((domains.get(host) || 0) >= 2) continue;
      urls.add(url);
      domains.set(host, (domains.get(host) || 0) + 1);
      results.push({ ...result, url, query: search.query });
    }
  }
  return results;
}
