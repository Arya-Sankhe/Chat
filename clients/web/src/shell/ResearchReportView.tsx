import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { escapeHtml } from "../islands/escapeHtml.js";
import { copyText } from "../islands/platform/index.js";
import { renderContent } from "../islands/render.js";
import { chatHooks, showToast, useApp } from "../state/app";
import { downloadReport, setReportMenu, setTextOnly, useResearchReport, type ResearchReportPayload, type ResearchSource } from "../state/researchReport";

/* The full-screen Deep Research report: masthead, contents, the report, sources,
   and copy/download. Its theme comes from the report's subject. */

const REPORT_THEME_KEYWORDS: Record<string, string[]> = {
  commerce: ["best", "top", "review", "buy", "buying", "price", "cheap", "budget", "worth", " vs ", "deal", "product", "gadget", "headphone", "laptop", "phone", "fragrance", "perfume", "cologne", "skincare", "shoe", "watch", "mattress", "coffee", "brand", "affordable"],
  science: ["study", "studies", "research", "scientist", "clinical", "health", "medical", "disease", "climate", "environment", "species", "brain", "gene", "quantum", "physics", "biology", "chemistry", "nasa", "space", "vaccine", "therapy"],
  tech: ["software", "app ", "ai ", " ai", "model", "llm", "programming", "code", "developer", "api", "framework", "startup", "crypto", "blockchain", "bitcoin", "cybersecurity", "cloud", "database", "github", "javascript", "python"],
  finance: ["market", "stock", "economy", "economic", "inflation", "invest", "finance", "financial", "revenue", "earnings", "gdp", "interest rate", "currency", "valuation", "etf", "trading"],
  culture: ["history", "art", "film", "movie", "music", "album", "travel", "food", "recipe", "book", "novel", "game", "sport", "football", "fashion", "culture", "festival", "museum", "photography"]
};

const REPORT_THEME_KICKERS: Record<string, string> = {
  editorial: "Deep Research",
  commerce: "Buying Guide",
  science: "Research Briefing",
  tech: "Tech Report",
  finance: "Market Briefing",
  culture: "Feature"
};

function pickReportTheme(payload: ResearchReportPayload) {
  const haystack = `${payload?.run?.title || ""} ${payload?.run?.summary || ""} ${String(payload?.report || "").slice(0, 2500)}`.toLowerCase();
  let best = "editorial";
  let bestScore = 0;
  for (const [theme, keywords] of Object.entries(REPORT_THEME_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) if (haystack.includes(keyword)) score += 1;
    if (score > bestScore) { bestScore = score; best = theme; }
  }
  return best;
}

function reportReadingMeta(payload: ResearchReportPayload) {
  const words = String(payload?.report || "").trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 220));
  const sources = payload?.sources?.length || payload?.run?.sourceCount || 0;
  const stamp = payload?.run?.finishedAt || payload?.run?.createdAt;
  let dateLabel = "";
  if (stamp) {
    const date = new Date(stamp);
    if (!Number.isNaN(date.getTime())) dateLabel = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  return { minutes, sources, dateLabel };
}

const reportMarkdownWithoutImages = (markdown: unknown) => String(markdown || "").replace(/!\[[^\]]*\]\([^)]+\)/g, "");
const stripLeadingH1 = (markdown: string) => markdown.replace(/^\s*#\s+.*(\r?\n)+/, "");

function reportMasthead(payload: ResearchReportPayload, theme: string) {
  const meta = reportReadingMeta(payload);
  const fallbackTitle = (String(payload?.report || "").match(/^\s*#\s+(.+)$/m)?.[1] || "Research report").trim();
  const title = (payload?.run?.title || fallbackTitle).trim();
  const metaParts = [`${meta.minutes} min read`, `${meta.sources} ${meta.sources === 1 ? "source" : "sources"}`];
  if (meta.dateLabel) metaParts.push(meta.dateLabel);
  return `
    <header class="report-masthead">
      <p class="report-kicker">${escapeHtml(REPORT_THEME_KICKERS[theme] || REPORT_THEME_KICKERS.editorial)}</p>
      <h1 class="report-title">${escapeHtml(title)}</h1>
      <div class="report-meta">${metaParts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>
    </header>
  `;
}

/** The article's HTML with images dropped and its h2/h3 numbered for the contents. */
function buildArticle(payload: ResearchReportPayload) {
  const theme = pickReportTheme(payload);
  const template = document.createElement("template");
  template.innerHTML = reportMasthead(payload, theme) + renderContent(stripLeadingH1(reportMarkdownWithoutImages(payload.report)));
  template.content.querySelectorAll("img").forEach((image) => image.remove());
  const toc = [...template.content.querySelectorAll("h2, h3")].map((heading, index) => {
    heading.id = `report-section-${index + 1}`;
    return { id: heading.id, level: heading.tagName.toLowerCase(), label: heading.textContent || "Section" };
  });
  return { theme, html: template.innerHTML, toc };
}

function sourceLinks(sources: ResearchSource[] | undefined) {
  return (sources || []).flatMap((source, index) => {
    try {
      const url = new URL(String(source.url));
      if (!["http:", "https:"].includes(url.protocol)) return [];
      return [{ key: `${index}:${url.href}`, href: url.href, title: source.title || url.href, host: url.hostname.replace(/^www\./, "") }];
    } catch {
      return [];
    }
  });
}

const CHECK_ICON = <svg className="research-report-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>;
const COPY_ICON = (
  <svg className="research-report-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

/** Copy flashes "Copied!" with a check for a moment. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(0), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button id="researchCopy" type="button" aria-label="Copy" className={copied ? "copy-flash" : undefined} onClick={() => {
      copyText(text).then(() => setCopied(Date.now())).catch(() => showToast("Copy failed."));
    }}>
      {copied ? CHECK_ICON : COPY_ICON}
      {" "}
      <span>{copied ? "Copied!" : "Copy"}</span>
    </button>
  );
}

function DownloadMenu() {
  const open = useResearchReport((s) => s.menuOpen);
  const busy = useResearchReport((s) => s.downloading);
  const wrap = useRef<HTMLDivElement>(null);
  // A press anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setReportMenu(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const pick = async (format: string) => {
    setReportMenu(false);
    try {
      await downloadReport(format);
    } catch (error: any) {
      showToast(error?.message || "Download failed.");
    }
  };
  return (
    <div className="research-download-wrap" ref={wrap}>
      <button id="researchDownload" type="button" aria-label="Download" aria-haspopup="menu" aria-expanded={open} aria-busy={busy} disabled={busy} onClick={(event) => {
        event.stopPropagation();
        setReportMenu(!open);
      }}>
        <svg className="research-report-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        {" "}
        <span>Download</span>
        {" "}
        <span className="document-download-chevron" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {" "}
      <div className={`document-download-menu${open ? "" : " hidden"}`} id="researchDownloadMenu" role="menu">
        <button type="button" role="menuitem" data-research-export="pdf" onClick={() => void pick("pdf")}>
          <span>PDF</span>
          <small>.pdf</small>
        </button>
        {" "}
        <button type="button" role="menuitem" data-research-export="docx" onClick={() => void pick("docx")}>
          <span>Word</span>
          <small>.docx</small>
        </button>
      </div>
    </div>
  );
}

export function ResearchReportView() {
  const view = useApp((s) => s.view);
  const payload = useResearchReport((s) => s.payload);
  const message = useResearchReport((s) => s.message);
  const textOnly = useResearchReport((s) => s.textOnly);
  const downloading = useResearchReport((s) => s.downloading);
  const section = useRef<HTMLElement>(null);
  const article = useMemo(() => (payload ? buildArticle(payload) : null), [payload]);
  const sources = useMemo(() => sourceLinks(payload?.sources), [payload]);
  // The theme stays on while the next report loads, as before.
  const theme = useRef<string | undefined>(undefined);
  if (article) theme.current = article.theme;
  // Contents links scroll below the sticky header instead of jumping.
  const scrollToSection = (event: MouseEvent, id: string) => {
    const heading = document.getElementById(id);
    const view = section.current;
    if (!heading || !view) return;
    event.preventDefault();
    const header = view.querySelector<HTMLElement>(".research-report-header");
    const top = heading.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - (header?.offsetHeight || 0) - 20;
    view.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const className = ["research-report-view", view === "research" ? "" : "hidden", textOnly ? "text-only" : ""].filter(Boolean).join(" ");
  return (
    <section ref={section} className={className} id="researchReportView" aria-label="Deep research report" data-report-theme={theme.current}>
      <header className="research-report-header">
        <button className="research-report-back" id="researchReportBack" type="button" aria-label="Back to chat" onClick={() => chatHooks.closeResearchReport()}>
          <svg className="research-report-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          {" "}
          <span>Back to chat</span>
        </button>
        {" "}
        <div className="research-report-tabs" role="tablist" aria-label="Report view">
          <button id="researchVisualTab" type="button" role="tab" aria-selected={!textOnly} onClick={() => setTextOnly(false)}>Visual report</button>
          {" "}
          <button id="researchTextTab" type="button" role="tab" aria-selected={textOnly} onClick={() => setTextOnly(true)}>Text only</button>
        </div>
        {" "}
        <div className="research-report-actions">
          <CopyButton text={payload?.report || ""} />
          {" "}
          <DownloadMenu />
        </div>
      </header>
      <div id="researchDownloadStatus" className={`research-download-status${downloading ? "" : " hidden"}`} role="status" aria-live="polite">Download preparing</div>
      <div className={`research-report-loading${article ? " hidden" : ""}`} id="researchReportLoading">{message}</div>
      <div className={`research-report-layout${article ? "" : " hidden"}`} id="researchReportLayout">
        <aside className={`research-report-toc${article?.toc.length ? "" : " hidden"}`} id="researchReportToc" aria-label="Report sections">
          {article?.toc.map((entry) => (
            <a key={entry.id} className={`level-${entry.level}`} href={`#${entry.id}`} onClick={(event) => scrollToSection(event, entry.id)}>{entry.label}</a>
          ))}
        </aside>
        <article className="research-report-article" id="researchReportArticle" dangerouslySetInnerHTML={{ __html: article?.html || "" }} />
        <details className="research-report-sources">
          <summary id="researchReportSourcesSummary">{payload ? `Sources (${payload.sources?.length || 0})` : "Sources"}</summary>
          <div id="researchReportSources">
            {sources.map((source) => (
              <a key={source.key} href={source.href} target="_blank" rel="noopener noreferrer"><strong>{source.title}</strong><span>{source.host}</span></a>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
