import { fetchPublicPage } from "./fetcher.js";
import { extractPageText, untrustedSourceBlock } from "./extract.js";
import { searchResearchQueries } from "./search.js";
import { isDeniedUrl, mergeDenyDomains } from "../websearch/deny-domains.js";
import {
  RESEARCH_CATEGORIES,
  RESEARCH_SYSTEM,
  categoryPrompt,
  extractPrompt,
  finalReportPrompt,
  planPrompt,
  queryPrompt,
  stopPrompt,
  synthesizePrompt
} from "./prompts.js";

const LOW_QUALITY_MARKERS = [
  "no relevant information",
  "not relevant to",
  "does not contain",
  "unable to extract",
  "completely unrelated",
  "insufficient to",
  "no substantive"
];

function stripCodeFence(value) {
  return String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseJsonArray(value) {
  const text = stripCodeFence(value);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {
    // Fall back to recovering the last bracketed array in the reply (models
    // sometimes echo the example array before their real answer).
  }
  let last = null;
  for (const match of text.matchAll(/\[[\s\S]*?\]/g)) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) last = parsed;
    } catch { /* keep scanning */ }
  }
  if (last) return last.map(String).map((item) => item.trim()).filter(Boolean);
  const quoted = [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim()).filter(Boolean);
  return quoted;
}

function parseJsonObject(value) {
  const text = stripCodeFence(value);
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* ignore */ }
    }
  }
  return null;
}

function isLowQuality(text) {
  const value = String(text || "").toLowerCase();
  if (!value.trim()) return true;
  return LOW_QUALITY_MARKERS.some((marker) => value.includes(marker));
}

function fallbackQueries(question, count) {
  const suffixes = ["overview", "reviews and opinions", "comparison", "recent analysis", "limitations criticism"];
  return suffixes.slice(0, count).map((suffix) => `${question} ${suffix}`);
}

function planSummary(plan) {
  if (!plan || typeof plan !== "object") return "";
  const parts = [];
  if (Array.isArray(plan.sub_questions) && plan.sub_questions.length) {
    parts.push(`Sub-questions: ${plan.sub_questions.map(String).join("; ")}`);
  }
  if (Array.isArray(plan.key_topics) && plan.key_topics.length) {
    parts.push(`Key topics: ${plan.key_topics.map(String).join(", ")}`);
  }
  if (plan.success_criteria) parts.push(`Success: ${String(plan.success_criteria)}`);
  return parts.join("\n");
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

function formatFindings(findings) {
  return findings.map((finding, index) => {
    const body = finding.summary || finding.evidence || "(no content)";
    return `**Finding ${index + 1}** — [${finding.title || finding.url}](${finding.url})\n${body}`;
  }).join("\n\n");
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 0 }, worker));
  return output;
}

export function partialReport(question, findings, sources, reason = "Research stopped before completion.") {
  const body = String(findings || "").trim() || "Not enough source material was collected to produce findings.";
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
  now = new Date(),
  searchFn = searchResearchQueries,
  fetchPage = fetchPublicPage,
  extractText = extractPageText
}) {
  const settings = config.research;
  const denyDomains = mergeDenyDomains(config.websearch?.denyDomains);
  const started = Date.now();
  const deadline = started + settings.maxRunMs;
  const cheapModel = settings.cheapModel || run.model;

  const fetchedUrls = new Set();
  const queriesUsed = new Set();
  const findings = [];
  const sources = [];
  let report = "";

  async function checkpoint(phase, progress) {
    if (signal?.aborted || await isCancelled()) throw new DOMException("Aborted", "AbortError");
    if (Date.now() > deadline) throw new Error("Deep research reached its time limit.");
    await onProgress(phase, progress);
  }

  function roundPercent(round, fraction) {
    const step = 78 / settings.maxRounds;
    return Math.min(88, Math.round(10 + (round - 1) * step + step * fraction));
  }

  // PLAN
  await checkpoint("planning", { label: "Planning research", percent: 5 });
  const planRaw = await callModel({
    model: cheapModel,
    system: RESEARCH_SYSTEM,
    prompt: planPrompt(run.query, now),
    maxTokens: 900
  }).catch(() => "");
  const plan = planSummary(parseJsonObject(planRaw)) || stripCodeFence(planRaw);

  const categoryRaw = await callModel({
    model: cheapModel,
    system: RESEARCH_SYSTEM,
    prompt: categoryPrompt(run.query),
    maxTokens: 12,
    temperature: 0
  }).catch(() => "");
  const categoryWord = String(categoryRaw || "").toLowerCase().trim().split(/\s+/)[0]?.replace(/[^a-z]/g, "") || "";
  const category = RESEARCH_CATEGORIES.find((entry) => categoryWord === entry || categoryWord.includes(entry)) || "";

  let emptyRounds = 0;

  for (let round = 1; round <= settings.maxRounds; round += 1) {
    await checkpoint("searching", {
      label: round === 1 ? "Searching the web" : "Searching for more detail",
      percent: roundPercent(round, 0),
      round
    });
    if (sources.length >= settings.maxPages) break;

    // THINK: generate queries
    const count = round === 1 ? settings.initialQueries : settings.followupQueries;
    const queryRaw = await callModel({
      model: cheapModel,
      system: RESEARCH_SYSTEM,
      prompt: queryPrompt({ question: run.query, plan, report, round, count, now }),
      maxTokens: 600,
      temperature: 0.5
    }).catch(() => "");
    let queries = parseJsonArray(queryRaw).filter((query) => !queriesUsed.has(query)).slice(0, count);
    if (!queries.length && round === 1) queries = fallbackQueries(run.query, count);
    if (!queries.length) break;
    queries.forEach((query) => queriesUsed.add(query));

    // SEARCH
    const results = await searchFn(queries, { config, signal });
    const slots = Math.max(0, settings.maxPages - sources.length);
    const candidates = results
      .filter((result) => !fetchedUrls.has(result.url))
      .filter((result) => !isDeniedUrl(result.url, denyDomains))
      .slice(0, Math.min(slots, settings.maxUrlsPerRound * queries.length));

    // READ + EXTRACT (goal-based; irrelevant pages are dropped, not cited)
    await checkpoint("reading", {
      label: "Reading sources",
      percent: roundPercent(round, 0.4),
      round,
      found: candidates.length
    });
    const roundFindings = await mapLimit(candidates, settings.fetchConcurrency, async (result) => {
      fetchedUrls.add(result.url);
      try {
        const page = await fetchPage(result.url, {
          timeoutMs: settings.fetchTimeoutMs,
          maxBytes: settings.fetchMaxBytes,
          signal,
          denyDomains
        });
        // Defense in depth for injected/custom fetchers that skip the boundary check.
        if (isDeniedUrl(page.url, denyDomains)) return null;
        const extracted = extractText(page.html, { maxChars: settings.maxExtractedChars });
        const raw = await callModel({
          model: cheapModel,
          system: RESEARCH_SYSTEM,
          prompt: `${extractPrompt(run.query)}\n\n${untrustedSourceBlock({ url: page.url, text: extracted.text })}`,
          maxTokens: settings.extractMaxTokens
        });
        const parsed = parseJsonObject(raw);
        const summary = parsed?.summary || (parsed ? "" : stripCodeFence(raw).slice(0, 800));
        if (parsed?.relevant === false || isLowQuality(summary)) return null;
        return {
          url: page.url,
          title: extracted.title || result.title || page.url,
          snippet: result.snippet || "",
          summary,
          evidence: parsed?.evidence || ""
        };
      } catch {
        return null;
      }
    });

    if (roundFindings.length) {
      emptyRounds = 0;
      for (const finding of roundFindings) {
        findings.push(finding);
        sources.push({ url: finding.url, title: finding.title, snippet: finding.snippet });
      }
    } else {
      emptyRounds += 1;
    }

    // SYNTHESIZE: keep an evolving report so partial saves stay coherent.
    if (findings.length) {
      await checkpoint("analyzing", {
        label: "Analyzing findings",
        percent: roundPercent(round, 0.7),
        round,
        sources: sources.length
      });
      const window = findings.slice(-12);
      report = await callModel({
        model: cheapModel,
        system: RESEARCH_SYSTEM,
        prompt: synthesizePrompt(run.query, report, formatFindings(window)),
        maxTokens: settings.synthesisMaxTokens
      }).catch(() => report);
      onSnapshot({ findings: report, sources });
    }

    if (emptyRounds >= settings.maxEmptyRounds) break;

    // DECIDE: let the model stop once the report is comprehensive.
    if (round >= settings.minRounds && round < settings.maxRounds && findings.length) {
      const decision = await callModel({
        model: cheapModel,
        system: RESEARCH_SYSTEM,
        prompt: stopPrompt(run.query, report, round, settings.maxRounds),
        maxTokens: 80,
        temperature: 0
      }).catch(() => "");
      if (/^[\s*_`"'>#-]*yes/i.test(String(decision || ""))) break;
    }
  }

  if (!sources.length) throw new Error("No relevant public sources were found for this question.");
  if (sources.length < settings.minSources) {
    throw new Error(`Only ${sources.length} relevant source${sources.length === 1 ? " was" : "s were"} found; at least ${settings.minSources} are required.`);
  }

  // FINAL REPORT — written with the user's selected model.
  await checkpoint("writing", { label: "Writing report", percent: 92, sources: sources.length });
  const reportRaw = await callModel({
    model: run.model,
    system: RESEARCH_SYSTEM,
    prompt: finalReportPrompt({ question: run.query, report, sources, category, now }),
    maxTokens: settings.finalMaxTokens
  });
  const finalReport = validateReportLinks(reportRaw, sources);
  if (finalReport.trim().length < 100) throw new Error("The research model returned an incomplete report.");
  const meta = reportMeta(finalReport, run.query);
  return {
    ...meta,
    report: finalReport,
    findings: report,
    sources,
    elapsedMs: Date.now() - started
  };
}
