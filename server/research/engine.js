import { fetchPublicPage } from "./fetcher.js";
import { extractPageText, untrustedSourceBlock } from "./extract.js";
import { searchResearchQueries } from "./search.js";
import { RESEARCH_SYSTEM, finalReportPrompt, findingsPrompt, queryPrompt } from "./prompts.js";

function parseStringArray(value, fallback = []) {
  const text = String(value || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : fallback;
  } catch {
    return fallback;
  }
}

function fallbackQueries(question, count) {
  const suffixes = ["overview evidence", "recent analysis", "limitations criticism", "best practices examples"];
  return suffixes.slice(0, count).map((suffix) => `${question} ${suffix}`);
}

function exactAllowedUrl(candidate, allowed) {
  try {
    const target = new URL(candidate).href.replace(/\/$/, "");
    return allowed.has(target) ? target : "";
  } catch {
    return "";
  }
}

export function validateReportLinks(markdown, sources) {
  const allowed = new Set(sources.map((source) => {
    try { return new URL(source.url).href.replace(/\/$/, ""); } catch { return ""; }
  }).filter(Boolean));
  const linked = String(markdown || "").replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (match, label, url) => {
      const valid = exactAllowedUrl(url, allowed);
      return valid ? `[${label}](${valid})` : label;
    });
  return linked.replace(/https?:\/\/[^\s<>)\]]+/g, (url) => exactAllowedUrl(url, allowed) || "");
}

function reportMeta(markdown, question) {
  const lines = String(markdown || "").split("\n");
  const title = (lines.find((line) => /^#\s+/.test(line)) || `# ${question}`).replace(/^#\s+/, "").trim();
  const summary = lines
    .filter((line) => line.trim() && !line.startsWith("#") && !line.startsWith("-"))
    .slice(0, 2)
    .join(" ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .slice(0, 500);
  return { title, summary };
}

async function mapLimit(items, limit, task) {
  const output = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      const result = await task(items[current], current);
      if (result) output.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

export function partialReport(question, findings, sources, reason = "Research stopped before completion.") {
  const body = findings.trim() || "Not enough source material was collected to produce findings.";
  return validateReportLinks(`# Partial research: ${question}\n\n> ${reason}\n\n${body}`, sources);
}

export async function runDeepResearch({
  run,
  config,
  callModel,
  onProgress = async () => {},
  onSnapshot = () => {},
  isCancelled = async () => false,
  signal,
  searchFn = searchResearchQueries,
  fetchPage = fetchPublicPage,
  extractText = extractPageText
}) {
  const started = Date.now();
  const deadline = started + config.research.maxRunMs;
  const sources = [];
  const fetchedUrls = new Set();
  const findings = [];
  const cheapModel = config.research.cheapModel || run.model;

  async function checkpoint(phase, progress) {
    if (signal?.aborted || await isCancelled()) throw new DOMException("Aborted", "AbortError");
    if (Date.now() > deadline) throw new Error("Deep research reached its time limit.");
    await onProgress(phase, progress);
  }

  await checkpoint("planning", { label: "Planning research", percent: 5 });
  const initialRaw = await callModel({
    model: cheapModel,
    system: RESEARCH_SYSTEM,
    prompt: queryPrompt(run.query, config.research.initialQueries)
  });
  const initialQueries = parseStringArray(initialRaw, fallbackQueries(run.query, config.research.initialQueries))
    .slice(0, config.research.initialQueries);

  async function researchRound(queries, round) {
    await checkpoint("searching", { label: "Searching the web", percent: round === 1 ? 15 : 55, round, queries });
    const results = await searchFn(queries, { config, signal });
    const slots = Math.max(0, config.research.maxPages - sources.length);
    const remaining = results.filter((result) => !fetchedUrls.has(result.url))
      .slice(0, slots * 2);

    await checkpoint("reading", { label: "Reading sources", percent: round === 1 ? 30 : 65, round, found: remaining.length });
    const pages = [];
    for (const group of chunk(remaining, config.research.fetchConcurrency)) {
      if (sources.length + pages.length >= config.research.maxPages) break;
      const fetched = await mapLimit(group, config.research.fetchConcurrency, async (result) => {
        fetchedUrls.add(result.url);
        try {
          const page = await fetchPage(result.url, {
            timeoutMs: config.research.fetchTimeoutMs,
            maxBytes: config.research.fetchMaxBytes,
            signal
          });
          const extracted = extractText(page.html, { maxChars: config.research.maxExtractedChars });
          return {
            url: page.url,
            title: extracted.title || result.title,
            snippet: result.snippet || "",
            text: extracted.text
          };
        } catch {
          return null;
        }
      });
      pages.push(...fetched.slice(0, config.research.maxPages - sources.length - pages.length));
    }
    sources.push(...pages);
    onSnapshot({ findings: findings.join("\n\n"), sources });

    await checkpoint("analyzing", { label: "Analyzing findings", percent: round === 1 ? 45 : 75, round, sources: sources.length });
    for (const batch of chunk(pages, 3)) {
      if (!batch.length) continue;
      const material = batch.map(untrustedSourceBlock).join("\n\n");
      findings.push(await callModel({
        model: cheapModel,
        system: RESEARCH_SYSTEM,
        prompt: findingsPrompt(run.query, material)
      }));
      onSnapshot({ findings: findings.join("\n\n"), sources });
    }
  }

  await researchRound(initialQueries, 1);
  if (sources.length < config.research.maxPages && findings.length) {
    const followupRaw = await callModel({
      model: cheapModel,
      system: RESEARCH_SYSTEM,
      prompt: queryPrompt(run.query, config.research.followupQueries, findings.join("\n\n").slice(0, 12_000))
    });
    const followups = parseStringArray(followupRaw, []).slice(0, config.research.followupQueries);
    if (followups.length) await researchRound(followups, 2);
  }

  if (!sources.length) throw new Error("No readable public sources were found.");
  if (sources.length < config.research.minSources) {
    throw new Error(`Only ${sources.length} useful source${sources.length === 1 ? " was" : "s were"} found; at least ${config.research.minSources} are required.`);
  }
  await checkpoint("writing", { label: "Writing report", percent: 90, sources: sources.length });
  const reportRaw = await callModel({
    model: run.model,
    system: RESEARCH_SYSTEM,
    prompt: finalReportPrompt(run.query, findings.join("\n\n"), sources),
    maxTokens: config.research.finalMaxTokens
  });
  const report = validateReportLinks(reportRaw, sources);
  if (report.trim().length < 100) throw new Error("The research model returned an incomplete report.");
  const meta = reportMeta(report, run.query);
  return {
    ...meta,
    report,
    findings: findings.join("\n\n"),
    sources: sources.map(({ text, ...source }) => source),
    elapsedMs: Date.now() - started
  };
}
