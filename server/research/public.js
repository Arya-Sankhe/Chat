import { validateReportLinks } from "./engine.js";
import { filterDeniedDomains, mergeDenyDomains } from "../websearch/deny-domains.js";

/**
 * Derive the public-facing sources, report, title, and summary for a
 * stored research run. Legacy rows may still contain denied hosts;
 * filter them at read time without mutating storage. Markdown citations
 * (and bare URLs in title/summary/report) are re-validated against the
 * filtered source registry so denied URLs never reach clients or
 * follow-up model context.
 */
export function sanitizeResearchPublicView(run, config) {
  const sources = filterDeniedDomains(
    Array.isArray(run?.sources) ? run.sources : [],
    mergeDenyDomains(config?.websearch?.denyDomains)
  );
  const reportMarkdown = run?.report_markdown;
  const report = reportMarkdown
    ? validateReportLinks(reportMarkdown, sources)
    : reportMarkdown || null;
  const title = validateReportLinks(String(run?.title || ""), sources);
  const summary = validateReportLinks(String(run?.summary || ""), sources);
  return {
    sources,
    report,
    title,
    summary,
    sourceCount: sources.length
  };
}
