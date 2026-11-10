import { useLayoutEffect, useRef } from "react";
import { useApp } from "../state/app";

export function ResearchReportView() {
  // showOnly(): the research controller also toggles .text-only on this
  // section, so React flips only .hidden and leaves the class list alone.
  const ref = useRef<HTMLElement>(null);
  const view = useApp((s) => s.view);
  useLayoutEffect(() => { ref.current!.classList.toggle("hidden", view !== "research"); }, [view]);
  return (
    <section ref={ref} className="research-report-view hidden" id="researchReportView" aria-label="Deep research report">
      <header className="research-report-header">
        <button className="research-report-back" id="researchReportBack" type="button" aria-label="Back to chat">
          <svg className="research-report-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          {" "}
          <span>Back to chat</span>
        </button>
        {" "}
        <div className="research-report-tabs" role="tablist" aria-label="Report view">
          <button id="researchVisualTab" type="button" role="tab" aria-selected="true">Visual report</button>
          {" "}
          <button id="researchTextTab" type="button" role="tab" aria-selected="false">Text only</button>
        </div>
        {" "}
        <div className="research-report-actions">
          <button id="researchCopy" type="button" aria-label="Copy">
            <svg className="research-report-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            {" "}
            <span>Copy</span>
          </button>
          {" "}
          <div className="research-download-wrap">
            <button id="researchDownload" type="button" aria-label="Download" aria-haspopup="menu" aria-expanded="false">
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
            <div className="document-download-menu hidden" id="researchDownloadMenu" role="menu">
              <button type="button" role="menuitem" data-research-export="pdf">
                <span>PDF</span>
                <small>.pdf</small>
              </button>
              {" "}
              <button type="button" role="menuitem" data-research-export="docx">
                <span>Word</span>
                <small>.docx</small>
              </button>
            </div>
          </div>
        </div>
      </header>
      <div id="researchDownloadStatus" className="research-download-status hidden" role="status" aria-live="polite">Download preparing</div>
      <div className="research-report-loading" id="researchReportLoading">Loading report...</div>
      <div className="research-report-layout hidden" id="researchReportLayout">
        <aside className="research-report-toc" id="researchReportToc" aria-label="Report sections" />
        <article className="research-report-article" id="researchReportArticle" />
        <details className="research-report-sources">
          <summary id="researchReportSourcesSummary">Sources</summary>
          <div id="researchReportSources" />
        </details>
      </div>
    </section>
  );
}
