import { mountDocumentEditor } from "./documentEditor.js";
import { selectionPlainText } from "./documentSelection.js";

const viewerSvg = (content) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const DOWNLOAD_ICON = viewerSvg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>');
const CHEVRON_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const EXPAND_ICON = viewerSvg('<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>');
const COLLAPSE_ICON = viewerSvg('<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>');
// The Klui mascot, front-facing and still (the composer's sprite without its laptop).
const KLUI_ICON = '<svg class="doc-ask-klui" viewBox="1 3.5 14 8.5" shape-rendering="crispEdges" aria-hidden="true"><g fill="#8fd3fb"><rect x="5" y="9.5" width="1" height="2.5"/><rect x="10" y="9.5" width="1" height="2.5"/><rect x="3" y="3.5" width="10" height="6"/><rect x="1" y="5.5" width="2" height="2"/><rect x="13" y="5.5" width="2" height="2"/></g><g fill="#16202e"><rect x="5" y="5" width="1" height="1.5"/><rect x="10" y="5" width="1" height="1.5"/></g></svg>';
const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';

export function createDocumentViewer({
  elements,
  state,
  fetchDocumentJobStatus,
  fetchAttachmentView,
  saveEditableDocument,
  reviseEditableDocument,
  exportEditableDocument,
  downloadAttachment,
  showToast,
  queueRenderMessages,
  escapeHtml,
  artifactListFromMessage,
  replacePendingArtifact,
  askDocument = null,
  onDocumentEdited = null
}) {
  const pendingArtifactPolls = new Map();
  const PENDING_ARTIFACT_POLL_INTERVAL_MS = 2000;
  const PENDING_ARTIFACT_POLL_MAX_ATTEMPTS = 60;
  const VIEWER_WIDTH_KEY = "klui.documentViewer.width.v1";
  let documentViewerPoll = null;
  let pdfJsPromise = null;
  let pdfRenderToken = 0;
  let officeScriptPromise = null;
  let officeEditor = null;
  let officeAttachmentId = "";
  let editorController = null;
  let editorAttachmentId = "";
  let editorSaveTimer = null;
  let editorSavePromise = null;
  let pendingMarkdown = "";
  let isFullscreen = false;
  let fullscreenReturnParent = null;
  let fullscreenReturnNext = null;
  let fullscreenAnimation = null;
  let viewerAnimation = null;
  let viewerTransitionToken = 0;
  // Bumped whenever the viewer opens another document or closes: work started for one document
  // (an Ask edit still rendering) checks it before touching the viewer.
  let viewerSession = 0;
  let inlineViewer = false;
  let onViewerClose = null;
  const viewerHome = document.createComment("document-viewer-home");
  elements.documentViewer?.before(viewerHome);
  let pdfDocument = null;
  let pdfObserver = null;
  let pdfLoadTask = null;
  const pdfPageTasks = new Set();
  let pdfZoom = 1;
  let currentPdfPage = 1;
  let initialPdfPage = 1;
  let resizeTimer = null;
  // Inline Dojo sources tick pages for the chat: { isOn(page), toggle(page, on) }.
  let pagePicker = null;
  const toolbar = document.createElement("div");
  toolbar.className = "document-preview-toolbar hidden";
  toolbar.innerHTML = `<div class="document-page-controls" hidden>
    <button type="button" data-pdf-step="-1" aria-label="Previous page" title="Previous page">${viewerSvg('<path d="m14 7-5 5 5 5"/>')}</button>
    <input type="number" min="1" value="1" aria-label="Page number" inputmode="numeric"><span class="document-page-total"></span>
    <button type="button" data-pdf-step="1" aria-label="Next page" title="Next page">${viewerSvg('<path d="m10 7 5 5-5 5"/>')}</button>
  </div><div class="document-preview-tools">
    <label class="document-zoom-control" hidden>${viewerSvg('<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6m-3-3v6"/>')}<select aria-label="Zoom">${[[1, "Fit"], [.75, "75%"], [1.25, "125%"], [1.5, "150%"], [2, "200%"]].map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
    <button type="button" data-preview-refresh aria-label="Refresh preview" title="Refresh preview">${viewerSvg('<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>')}</button>
  </div>`;
  elements.documentViewerBody?.before(toolbar);
  elements.documentViewerBody?.addEventListener("change", (event) => {
    const box = event.target.closest?.("[data-pick-page]");
    if (!box || !pagePicker) return;
    const pageNumber = Number(box.dataset.pickPage);
    pagePicker.toggle(pageNumber, box.checked, box.checked ? pageThumb(pageNumber) : "");
    syncPagePicks();
  });

  // A small render of a page for its card in the composer; empty until the page has drawn.
  function pageThumb(pageNumber) {
    const canvas = elements.documentViewerBody?.querySelector(`[data-page="${pageNumber}"] canvas`);
    if (!canvas?.width) return "";
    try {
      const width = 128;
      const thumb = document.createElement("canvas");
      thumb.width = width;
      thumb.height = Math.round(canvas.height * (width / canvas.width));
      thumb.getContext("2d").drawImage(canvas, 0, 0, thumb.width, thumb.height);
      return thumb.toDataURL("image/jpeg", 0.75);
    } catch {
      return "";
    }
  }

  function pagePickMarkup(pageNumber) {
    const noun = elements.documentViewer?.dataset.sourceFormat === "slides" ? "Slide" : "Page";
    const on = Boolean(pagePicker?.isOn(pageNumber));
    return `<input type="checkbox" data-pick-page="${pageNumber}"${on ? " checked" : ""}><span class="pdf-page-pick-box" aria-hidden="true">${viewerSvg('<path d="m5 12.5 4.5 4.5L19 7.5"/>')}</span><span class="pdf-page-pick-label">${noun} ${pageNumber}</span><span class="pdf-page-pick-hint">${on ? "In chat" : "Ask about this"}</span>`;
  }

  // Ticks follow the chat's selection, which the composer can also clear.
  function syncPagePicks() {
    elements.documentViewerBody?.querySelectorAll(".pdf-page-pick").forEach((label) => {
      const pageNumber = Number(label.dataset.pickFor);
      const on = Boolean(pagePicker?.isOn(pageNumber));
      label.classList.toggle("is-on", on);
      const box = label.querySelector("input");
      if (box) box.checked = on;
      const hint = label.querySelector(".pdf-page-pick-hint");
      if (hint) hint.textContent = on ? "In chat" : "Ask about this";
    });
  }

  function resetPdf({ destroy = true } = {}) {
    pdfRenderToken += 1;
    pdfObserver?.disconnect();
    pdfObserver = null;
    pdfPageTasks.forEach(task => task.cancel());
    pdfPageTasks.clear();
    clearTimeout(resizeTimer);
    if (destroy) {
      if (pdfLoadTask) void pdfLoadTask.destroy().catch(() => {});
      else if (pdfDocument) void pdfDocument.destroy().catch(() => {});
      pdfLoadTask = null;
      pdfDocument = null;
    }
  }

  function syncPageControls() {
    const total = pdfDocument?.numPages || 0;
    toolbar.querySelector(".document-page-controls").hidden = !total;
    toolbar.querySelector(".document-zoom-control").hidden = !total;
    const input = toolbar.querySelector("input");
    if (document.activeElement !== input) input.value = String(currentPdfPage);
    input.max = String(total);
    toolbar.querySelector(".document-page-total").textContent = `/ ${total}`;
    toolbar.querySelector('[data-pdf-step="-1"]').disabled = currentPdfPage <= 1;
    toolbar.querySelector('[data-pdf-step="1"]').disabled = currentPdfPage >= total;
  }

  function goToPdfPage(value) {
    if (!pdfDocument) return;
    currentPdfPage = Math.max(1, Math.min(pdfDocument.numPages, Math.trunc(Number(value)) || 1));
    const page = elements.documentViewerBody.querySelector(`[data-page="${currentPdfPage}"]`);
    if (page) elements.documentViewerBody.scrollTop += page.getBoundingClientRect().top - elements.documentViewerBody.getBoundingClientRect().top - 12;
    toolbar.querySelector("input").value = String(currentPdfPage);
    syncPageControls();
  }

  function redrawPdf() {
    if (!pdfDocument || !state.viewer.open) return;
    const page = currentPdfPage;
    resetPdf({ destroy: false });
    void renderPdfPages(null, state.viewer.url, pdfRenderToken, pdfDocument).then(() => goToPdfPage(page));
  }

  toolbar.addEventListener("click", event => {
    const step = event.target.closest("[data-pdf-step]");
    if (step) goToPdfPage(currentPdfPage + Number(step.dataset.pdfStep));
    if (event.target.closest("[data-preview-refresh]")) {
      if (!state.viewer.open || state.viewer.loading || state.viewer.kind === "editable") return;
      const { downloadAttachmentId, attachmentId, fileName, sourceKind } = state.viewer;
      const requestToken = ++viewerTransitionToken;
      stopDocumentPreviewPoll();
      resetPdf();
      delete elements.documentViewerBody.dataset.pdfUrl;
      setDocumentViewerState({ loading: true, error: "" });
      void loadDocumentViewerUrl(downloadAttachmentId || attachmentId, { fileName, sourceKind }).catch(error => {
        if (requestToken === viewerTransitionToken) setDocumentViewerState({ loading: false, error: error.message || "Preview failed." });
      });
    }
  });
  toolbar.querySelector("input").addEventListener("change", event => goToPdfPage(event.target.value));
  toolbar.querySelector("input").addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); goToPdfPage(event.target.value); }
  });
  toolbar.querySelector("select").addEventListener("change", event => {
    pdfZoom = Number(event.target.value) || 1;
    redrawPdf();
  });
  elements.documentViewerBody?.addEventListener("scroll", () => {
    if (!pdfDocument) return;
    const top = elements.documentViewerBody.getBoundingClientRect().top;
    const pages = [...elements.documentViewerBody.querySelectorAll("[data-page]")];
    const visible = pages.find(page => page.getBoundingClientRect().bottom > top + 30);
    if (visible) { currentPdfPage = Number(visible.dataset.page); syncPageControls(); }
  }, { passive: true });
  if (typeof ResizeObserver !== "undefined" && elements.documentViewerBody) {
    let lastWidth = 0;
    new ResizeObserver(entries => {
      const width = Math.round(entries[0].contentRect.width);
      if (!width || width === lastWidth) return;
      lastWidth = width;
      clearTimeout(resizeTimer);
      if (pdfDocument) resizeTimer = setTimeout(redrawPdf, 120);
    }).observe(elements.documentViewerBody);
  }


  function findPendingArtifacts() {
    const out = [];
    for (const message of state.messages || []) {
      const artifacts = artifactListFromMessage(message);
      for (const artifact of artifacts) {
        if (artifact?.pending && artifact?.job_id) {
          const failed = ["failed", "expired"].includes(String(artifact.status || "").toLowerCase());
          if (failed) continue;
          out.push({ messageId: message.id, jobId: artifact.job_id });
        }
      }
    }
    return out;
  }

  function applyJobStatusToPendingArtifact(jobId, payload) {
    if (!payload || !payload.job) return false;
    const job = payload.job;
    const messages = state.messages || [];
    let mutated = false;

    if (job.status === "succeeded" && payload.artifact) {
      for (const message of messages) {
        if (replacePendingArtifact(message, jobId, payload.artifact)) mutated = true;
      }
    } else if (job.status === "failed" || job.status === "expired") {
      for (const message of messages) {
        const lists = [];
        if (Array.isArray(message.artifacts)) lists.push(message.artifacts);
        const metaArtifacts = message.metadata?.documents?.artifacts;
        if (Array.isArray(metaArtifacts)) lists.push(metaArtifacts);
        for (const list of lists) {
          for (const entry of list) {
            if (entry?.pending && entry?.job_id === jobId) {
              entry.status = job.status;
              mutated = true;
            }
          }
        }
      }
    }
    return mutated;
  }

  async function pollPendingArtifact(jobId) {
    if (!jobId || !state.session?.access_token) return;
    let attempts = 0;
    const tick = async () => {
      if (!pendingArtifactPolls.has(jobId)) return;
      attempts += 1;
      let payload;
      try {
        payload = await fetchDocumentJobStatus(state.session, jobId);
      } catch {
        payload = null;
      }
      if (!pendingArtifactPolls.has(jobId)) return;

      if (payload?.job) {
        const mutated = applyJobStatusToPendingArtifact(jobId, payload);
        if (mutated) queueRenderMessages();
        const finished = ["succeeded", "failed", "expired"].includes(payload.job.status);
        if (finished) {
          pendingArtifactPolls.delete(jobId);
          return;
        }
      }
      if (attempts >= PENDING_ARTIFACT_POLL_MAX_ATTEMPTS) {
        pendingArtifactPolls.delete(jobId);
        return;
      }
      const handle = setTimeout(tick, PENDING_ARTIFACT_POLL_INTERVAL_MS);
      pendingArtifactPolls.set(jobId, handle);
    };
    const initial = setTimeout(tick, PENDING_ARTIFACT_POLL_INTERVAL_MS);
    pendingArtifactPolls.set(jobId, initial);
  }

  function syncPendingArtifactPolls() {
    const live = new Set();
    for (const { jobId } of findPendingArtifacts()) live.add(jobId);
    for (const jobId of Array.from(pendingArtifactPolls.keys())) {
      if (!live.has(jobId)) {
        const handle = pendingArtifactPolls.get(jobId);
        if (handle) clearTimeout(handle);
        pendingArtifactPolls.delete(jobId);
      }
    }
    for (const jobId of live) {
      if (!pendingArtifactPolls.has(jobId)) pollPendingArtifact(jobId);
    }
  }

  function attachmentDownloadHref(attachmentId) {
    return `/api/attachments/${encodeURIComponent(attachmentId)}/download`;
  }

  function stopDocumentPreviewPoll() {
    if (documentViewerPoll) clearTimeout(documentViewerPoll);
    documentViewerPoll = null;
  }

  function isDocumentPreviewPollActive() {
    return documentViewerPoll !== null;
  }

  function stopPendingArtifactPolls() {
    for (const jobId of Array.from(pendingArtifactPolls.keys())) {
      const handle = pendingArtifactPolls.get(jobId);
      if (handle) clearTimeout(handle);
      pendingArtifactPolls.delete(jobId);
    }
  }

  function isPendingArtifactPollsActive() {
    return pendingArtifactPolls.size > 0;
  }

  function setDocumentViewerState(patch = {}) {
    state.viewer = { ...state.viewer, ...patch };
    renderDocumentViewer();
  }

  function syncFullscreenButton() {
    if (!elements.documentViewerFullscreen) return;
    elements.documentViewerFullscreen.innerHTML = isFullscreen ? COLLAPSE_ICON : EXPAND_ICON;
    elements.documentViewerFullscreen.setAttribute("aria-pressed", String(isFullscreen));
    elements.documentViewerFullscreen.setAttribute("aria-label", isFullscreen ? "Exit full screen" : "Enter full screen");
    elements.documentViewerFullscreen.title = isFullscreen ? "Exit full screen" : "Enter full screen";
  }

  function setFullscreen(next, { animate = true } = {}) {
    const value = Boolean(next);
    if (value === isFullscreen || !elements.documentViewer) return;
    const before = elements.documentViewer.getBoundingClientRect();
    if (value) {
      fullscreenReturnParent = elements.documentViewer.parentNode;
      fullscreenReturnNext = elements.documentViewer.nextSibling;
      document.body.append(elements.documentViewer);
    } else {
      const host = fullscreenReturnParent?.isConnected
        ? fullscreenReturnParent
        : document.querySelector(".dojo-source-preview-slot");
      if (host) host.insertBefore(elements.documentViewer, fullscreenReturnNext?.parentNode === host ? fullscreenReturnNext : null);
      else viewerHome.after(elements.documentViewer);
      fullscreenReturnParent = null;
      fullscreenReturnNext = null;
    }
    isFullscreen = value;
    document.body.classList.toggle("document-viewer-fullscreen", isFullscreen);
    elements.documentViewerDownloadMenu?.classList.add("hidden");
    syncFullscreenButton();
    const after = elements.documentViewer.getBoundingClientRect();
    fullscreenAnimation?.cancel();
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !before.width || !after.width || typeof elements.documentViewer.animate !== "function") return;
    const transform = `translate3d(${before.left - after.left}px, ${before.top - after.top}px, 0) scale(${before.width / after.width}, ${before.height / after.height})`;
    fullscreenAnimation = elements.documentViewer.animate([
      { transform, transformOrigin: "top left" },
      { transform: "translate3d(0, 0, 0) scale(1)", transformOrigin: "top left" }
    ], { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  }

  function animateViewer(opening) {
    viewerAnimation?.cancel();
    if (typeof elements.documentViewer?.animate !== "function") return Promise.resolve();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frames = reducedMotion
      ? [{ opacity: opening ? 0.7 : 1 }, { opacity: opening ? 1 : 0 }]
      : opening
        ? [{ opacity: 0, transform: "translate3d(18px, 0, 0) scale(0.995)" }, { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }]
        : [{ opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }, { opacity: 0, transform: "translate3d(14px, 0, 0) scale(0.997)" }];
    viewerAnimation = elements.documentViewer.animate(frames, {
      duration: reducedMotion ? 120 : opening ? 220 : 160,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      fill: opening ? "none" : "forwards"
    });
    return viewerAnimation.finished.catch(() => {});
  }

  function viewerMetaLabel() {
    const format = String(state.viewer.sourceKind || state.viewer.kind || "").toUpperCase();
    if (state.viewer.loading && state.viewer.jobId) return `${format || "DOCUMENT"} preview is being prepared`;
    if (state.viewer.loading) return "Loading preview";
    if (state.viewer.error) return "Preview unavailable";
    if (state.viewer.kind === "editable") return `${format || "DOCUMENT"} · EDITABLE`;
    if (state.viewer.sheets?.length) return `${format || "XLSX"} · ${state.viewer.sheets.length} sheet${state.viewer.sheets.length === 1 ? "" : "s"}`;
    return format ? `${format} preview` : "Preview";
  }

  function columnLabel(index) {
    let value = index + 1;
    let label = "";
    while (value > 0) {
      value -= 1;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return label;
  }

  function renderSheetViewer() {
    const sheets = state.viewer.sheets || [];
    const activeSheet = Math.min(Math.max(Number(state.viewer.activeSheet) || 0, 0), sheets.length - 1);
    const rows = sheets[activeSheet]?.rows || [];
    const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
    delete elements.documentViewerBody.dataset.pdfUrl;
    elements.documentViewerBody.innerHTML = `
      <div class="sheet-viewer">
        <div class="sheet-tabs" role="tablist" aria-label="Workbook sheets">
          ${sheets.map((sheet, index) => `<button type="button" role="tab" aria-selected="${index === activeSheet}" data-sheet-index="${index}">${escapeHtml(sheet.name || `Sheet ${index + 1}`)}</button>`).join("")}
        </div>
        <div class="sheet-grid">
          <table>
            <thead><tr><th class="sheet-corner" aria-hidden="true"></th>${Array.from({ length: columns }, (_, index) => `<th scope="col">${columnLabel(index)}</th>`).join("")}</tr></thead>
            <tbody>${rows.map((row, rowIndex) => `<tr><th scope="row">${rowIndex + 1}</th>${Array.from({ length: columns }, (_, columnIndex) => `<td>${escapeHtml(row[columnIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody>
          </table>
        </div>
      </div>`;
  }

  function destroyOfficeViewer() {
    officeEditor?.destroyEditor?.();
    officeEditor = null;
    officeAttachmentId = "";
  }

  function loadOnlyOffice(url) {
    if (window.DocsAPI?.DocEditor) return Promise.resolve();
    if (!officeScriptPromise) {
      officeScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `${String(url).replace(/\/+$/, "")}/web-apps/apps/api/documents/api.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Spreadsheet viewer is unavailable."));
        document.head.appendChild(script);
      }).catch((error) => {
        officeScriptPromise = null;
        throw error;
      });
    }
    return officeScriptPromise;
  }

  async function showSheetFallback() {
    try {
      await loadDocumentViewerUrl(state.viewer.downloadAttachmentId || state.viewer.attachmentId, {
        downloadAttachmentId: state.viewer.downloadAttachmentId || state.viewer.attachmentId,
        fileName: state.viewer.fileName,
        sourceKind: "xlsx",
        sheetFallback: true
      });
    } catch (error) {
      setDocumentViewerState({ loading: false, error: error.message || "Workbook preview is unavailable." });
    }
  }

  function renderOfficeViewer() {
    if (officeEditor && officeAttachmentId === state.viewer.attachmentId) return;
    destroyOfficeViewer();
    const attachmentId = state.viewer.attachmentId;
    officeAttachmentId = attachmentId;
    elements.documentViewerBody.innerHTML = '<div id="klui-office-viewer" class="office-viewer"><div class="document-viewer-empty"><span class="artifact-spinner" aria-hidden="true"></span>Loading workbook…</div></div>';
    loadOnlyOffice(state.viewer.officeUrl)
      .then(() => {
        if (!state.viewer.open || state.viewer.attachmentId !== attachmentId) return;
        const config = structuredClone(state.viewer.officeConfig);
        config.events = { onError: showSheetFallback };
        officeEditor = new window.DocsAPI.DocEditor("klui-office-viewer", config);
      })
      .catch(showSheetFallback);
  }

  function renderDocumentViewer() {
    if (!elements.documentViewer) return;
    const viewer = state.viewer;
    document.body.classList.toggle("document-viewer-open", Boolean(viewer.open && !inlineViewer));
    toolbar.classList.toggle("hidden", !viewer.open);
    toolbar.querySelector("[data-preview-refresh]").disabled = Boolean(viewer.loading);
    syncPageControls();
    elements.documentViewer.classList.toggle("hidden", !viewer.open);
    elements.documentViewerTitle.textContent = viewer.fileName || "Document";
    elements.documentViewerMeta.textContent = viewerMetaLabel();

    const downloadAttachmentId = viewer.downloadAttachmentId || viewer.attachmentId;
    const downloadHref = downloadAttachmentId ? attachmentDownloadHref(downloadAttachmentId) : "";
    const editable = viewer.kind === "editable";
    const formatMenu = !editable && (viewer.exportFormats || []).length > 1;
    toolbar.querySelector("[data-preview-refresh]").hidden = editable;
    syncAskUi();
    elements.documentViewerBody.classList.toggle("is-editable", editable);
    elements.documentViewerDownload.classList.toggle("hidden", !downloadHref || inlineViewer);
    elements.documentViewerDownload.toggleAttribute("hidden", !downloadHref || inlineViewer);
    elements.documentViewerDownload.innerHTML = `${DOWNLOAD_ICON}<span>Download</span>${editable || formatMenu ? `<span class="document-download-chevron">${CHEVRON_ICON}</span>` : ""}`;
    elements.documentViewerDownload.setAttribute("aria-expanded", String((editable || formatMenu) && !elements.documentViewerDownloadMenu?.classList.contains("hidden")));
    if (!editable && !formatMenu) elements.documentViewerDownloadMenu?.classList.add("hidden");
    elements.documentViewerDownloadMenu?.querySelectorAll?.("[data-document-export]").forEach((button) => {
      const format = button.dataset.documentExport;
      button.hidden = editable ? false : !(viewer.exportFormats || []).includes(format);
    });
    if (downloadHref) {
      // Anchor attrs no longer apply (the element is now a <button> so the
      // WebView does not open the Android share sheet). Click handler reads
      // these dataset values and routes through the Capacitor-aware download.
      elements.documentViewerDownload.dataset.attachmentId = downloadAttachmentId || "";
      elements.documentViewerDownload.dataset.fileName = viewer.fileName || "download";
    } else {
      delete elements.documentViewerDownload.dataset.attachmentId;
      delete elements.documentViewerDownload.dataset.fileName;
    }

    if (!viewer.open) {
      if (isFullscreen) setFullscreen(false, { animate: false });
      destroyEditor();
      destroyOfficeViewer();
      delete elements.documentViewerBody.dataset.pdfUrl;
      elements.documentViewerBody.innerHTML = `<div class="document-viewer-empty">Select a generated document to preview.</div>`;
      return;
    }
    if (viewer.error) {
      destroyOfficeViewer();
      delete elements.documentViewerBody.dataset.pdfUrl;
      elements.documentViewerBody.innerHTML = `<div class="document-viewer-empty">${escapeHtml(viewer.error)}</div>`;
      return;
    }
    if (viewer.loading) {
      destroyOfficeViewer();
      delete elements.documentViewerBody.dataset.pdfUrl;
      const label = viewer.jobId ? "Preparing preview…" : "Loading preview…";
      elements.documentViewerBody.innerHTML = `<div class="document-viewer-empty"><span class="artifact-spinner" aria-hidden="true"></span>${label}</div>`;
      return;
    }
    if (editable) {
      destroyOfficeViewer();
      renderEditableDocument();
      return;
    }
    destroyEditor();
    if (viewer.officeUrl && viewer.officeConfig) {
      renderOfficeViewer();
      return;
    }
    destroyOfficeViewer();
    if (viewer.kind === "text") {
      const sourceUrl = /^https?:\/\//i.test(viewer.sourceUrl || "") ? viewer.sourceUrl : "";
      elements.documentViewerBody.innerHTML = `<article class="source-text-preview">${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open original website ↗</a>` : ""}<pre>${escapeHtml(viewer.markdown)}</pre></article>`;
      return;
    }
    if (viewer.sheets?.length) {
      renderSheetViewer();
      return;
    }
    if (viewer.url) {
      renderCleanPdfViewer(viewer.url);
      return;
    }
    elements.documentViewerBody.innerHTML = `<div class="document-viewer-empty">Preview is not available for this document.</div>`;
  }

  function destroyEditor() {
    if (editorSaveTimer) clearTimeout(editorSaveTimer);
    editorSaveTimer = null;
    editorController?.destroy();
    editorController = null;
    editorAttachmentId = "";
    pendingMarkdown = "";
  }

  function markEditorStatus(label) {
    if (state.viewer.kind === "editable") elements.documentViewerMeta.textContent = `${String(state.viewer.sourceKind || "DOCUMENT").toUpperCase()} · ${label}`;
  }

  async function saveEditorNow() {
    if (editorSavePromise) await editorSavePromise;
    if (!editorController || !pendingMarkdown || !state.session?.access_token) return;
    if (editorSaveTimer) clearTimeout(editorSaveTimer);
    editorSaveTimer = null;
    const markdown = pendingMarkdown;
    pendingMarkdown = "";
    markEditorStatus("SAVING");
    editorSavePromise = (async () => {
      const result = await saveEditableDocument(
        state.session,
        state.viewer.attachmentId,
        markdown,
        state.viewer.revision
      );
      state.viewer.revision = Number(result.revision || state.viewer.revision);
      state.viewer.markdown = markdown;
      markEditorStatus("SAVED");
    })();
    try {
      await editorSavePromise;
    } catch (error) {
      if (!pendingMarkdown) pendingMarkdown = markdown;
      markEditorStatus("SAVE FAILED");
      showToast?.(error.message || "Document save failed.");
      throw error;
    } finally {
      editorSavePromise = null;
    }
  }

  async function renderEditableDocument() {
    if (editorController && editorAttachmentId === state.viewer.attachmentId) return;
    destroyEditor();
    const attachmentId = state.viewer.attachmentId;
    editorAttachmentId = attachmentId;
    elements.documentViewerBody.innerHTML = `<div class="document-viewer-empty"><span class="artifact-spinner" aria-hidden="true"></span>Loading editor…</div>`;
    try {
      const mounted = await mountDocumentEditor({
        container: elements.documentViewerBody,
        markdown: state.viewer.markdown,
        onChange: (markdown) => {
          pendingMarkdown = markdown;
          markEditorStatus("UNSAVED");
          if (editorSaveTimer) clearTimeout(editorSaveTimer);
          editorSaveTimer = setTimeout(() => saveEditorNow().catch(() => {}), 900);
        },
        onRevise: async ({ selection, instruction, markdown, signal }) => {
          markEditorStatus("REVISING");
          try {
            const result = await reviseEditableDocument(state.session, state.viewer.attachmentId, {
              markdown,
              selection,
              instruction,
              signal
            });
            return result.replacement;
          } catch (error) {
            if (error?.name !== "AbortError") markEditorStatus("UNSAVED");
            else markEditorStatus("SAVED");
            throw error;
          }
        }
      });
      if (!state.viewer.open || state.viewer.attachmentId !== attachmentId) {
        mounted.destroy();
        destroyEditor();
        return;
      }
      editorController = mounted;
      markEditorStatus("SAVED");
    } catch (error) {
      editorController = null;
      elements.documentViewerBody.innerHTML = `<div class="document-viewer-empty">${escapeHtml(error.message || "The editor could not be loaded.")}</div>`;
    }
  }

  // What pdf.js's own viewer adds on top of its TextLayer so a drag selects precisely. Each layer
  // ends with an .endOfContent block; while a selection is being made it is moved next to the
  // span under the moving end, so dragging over empty space (table gaps, margins) extends the
  // selection by at most that span instead of jumping to the end of the page.
  const pdfTextLayers = new Map();
  let pdfSelectionBound = false;
  function trackPdfTextLayer(layer) {
    const end = document.createElement("div");
    end.className = "endOfContent";
    layer.append(end);
    layer.addEventListener("mousedown", () => layer.classList.add("selecting"));
    for (const known of pdfTextLayers.keys()) if (!known.isConnected) pdfTextLayers.delete(known);
    pdfTextLayers.set(layer, end);
    if (pdfSelectionBound) return;
    pdfSelectionBound = true;
    const reset = (endDiv, textLayer) => {
      textLayer.append(endDiv);
      endDiv.style.width = "";
      endDiv.style.height = "";
      textLayer.classList.remove("selecting");
    };
    let pointerDown = false;
    let prevRange = null;
    document.addEventListener("pointerdown", () => { pointerDown = true; });
    document.addEventListener("pointerup", () => {
      pointerDown = false;
      pdfTextLayers.forEach(reset);
    });
    window.addEventListener("blur", () => {
      pointerDown = false;
      pdfTextLayers.forEach(reset);
    });
    document.addEventListener("keyup", () => {
      if (!pointerDown) pdfTextLayers.forEach(reset);
    });
    document.addEventListener("selectionchange", () => {
      if (!pdfTextLayers.size) return;
      const selection = document.getSelection();
      if (!selection.rangeCount) {
        pdfTextLayers.forEach(reset);
        return;
      }
      const range = selection.getRangeAt(0);
      for (const [textLayer, endDiv] of pdfTextLayers) {
        if (!textLayer.isConnected) pdfTextLayers.delete(textLayer);
        else if (range.intersectsNode(textLayer)) textLayer.classList.add("selecting");
        else reset(endDiv, textLayer);
      }
      // Firefox keeps a selection in place over empty space by itself.
      if (CSS.supports("-moz-user-select", "none")) return;
      const modifyStart = prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
      let anchor = modifyStart ? range.startContainer : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
      if (!modifyStart && range.endOffset === 0) {
        do {
          while (!anchor.previousSibling) anchor = anchor.parentNode;
          anchor = anchor.previousSibling;
        } while (!anchor.childNodes.length);
      }
      const textLayer = anchor.parentElement?.closest(".textLayer");
      const endDiv = pdfTextLayers.get(textLayer);
      if (endDiv) {
        endDiv.style.width = textLayer.style.width;
        endDiv.style.height = textLayer.style.height;
        anchor.parentElement.insertBefore(endDiv, modifyStart ? anchor : anchor.nextSibling);
      }
      prevRange = range.cloneRange();
    });
  }

  async function loadPdfJs() {
    if (!pdfJsPromise) {
      pdfJsPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.mjs").then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.worker.mjs";
        return pdfjs;
      });
    }
    return pdfJsPromise;
  }

  function pdfPlaceholderHeight(width) {
    return Math.max(80, Math.round(width * 1.294));
  }

  function renderCleanPdfViewer(url) {
    if (elements.documentViewerBody.dataset.pdfUrl === url) return;
    resetPdf();
    const token = pdfRenderToken;
    elements.documentViewerBody.dataset.pdfUrl = url;
    elements.documentViewerBody.innerHTML = `
    <div class="pdf-pages" data-pdf-pages>
      <div class="document-viewer-empty"><span class="artifact-spinner" aria-hidden="true"></span>Loading pages…</div>
    </div>
  `;
    loadPdfJs()
      .then((pdfjs) => renderPdfPages(pdfjs, url, token))
      .catch(() => {
        if (token !== pdfRenderToken) return;
        elements.documentViewerBody.innerHTML = `<div class="document-viewer-empty">Could not load the clean preview.</div>`;
      });
  }

  async function renderPdfPages(pdfjs, url, token, loadedPdf = null) {
    const container = elements.documentViewerBody.querySelector("[data-pdf-pages]");
    if (!container || token !== pdfRenderToken) return;

    let pdf;
    try {
      if (loadedPdf) pdf = loadedPdf;
      else {
        pdfLoadTask = pdfjs.getDocument({ url });
        pdf = await pdfLoadTask.promise;
      }
    } catch {
      if (token !== pdfRenderToken) return;
      elements.documentViewerBody.innerHTML = `<div class="document-viewer-empty">Could not open this PDF preview.</div>`;
      return;
    }
    if (token !== pdfRenderToken) return;

    pdfDocument = pdf;
    syncPageControls();
    const bodyWidth = Math.max(160, elements.documentViewerBody.clientWidth - 28) * pdfZoom;
    container.style.width = `${bodyWidth}px`;
    container.style.minWidth = "100%";
    container.innerHTML = "";
    const placeholders = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const pageEl = document.createElement("div");
      pageEl.className = "pdf-page";
      pageEl.dataset.page = String(pageNumber);
      pageEl.style.width = `${bodyWidth}px`;
      pageEl.style.minHeight = `${pdfPlaceholderHeight(bodyWidth)}px`;
      pageEl.innerHTML = `<div class="pdf-page-placeholder"><span class="artifact-spinner" aria-hidden="true"></span></div>`;
      container.appendChild(pageEl);
      placeholders.push(pageEl);
      if (pagePicker) {
        const pick = document.createElement("label");
        pick.className = `pdf-page-pick${pagePicker.isOn(pageNumber) ? " is-on" : ""}`;
        pick.dataset.pickFor = String(pageNumber);
        pick.style.width = `${bodyWidth}px`;
        pick.innerHTML = pagePickMarkup(pageNumber);
        container.appendChild(pick);
      }
    }
    // Citations open a source at the cited page; placeholders already reserve each page's height.
    if (initialPdfPage > 1) goToPdfPage(initialPdfPage);
    initialPdfPage = 1;

    const renderPage = async (pageEl) => {
      if (pageEl.dataset.rendered || token !== pdfRenderToken) return;
      pageEl.dataset.rendered = "1";
      const pageNumber = Number(pageEl.dataset.page);
      const page = await pdf.getPage(pageNumber);
      if (token !== pdfRenderToken) return;
      const base = page.getViewport({ scale: 1 });
      const scale = bodyWidth / base.width;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.setAttribute("aria-label", `Page ${pageNumber}`);
      const context = canvas.getContext("2d", { alpha: false });
      const task = page.render({
        canvasContext: context,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
      });
      pdfPageTasks.add(task);
      try { await task.promise; } finally { pdfPageTasks.delete(task); }
      if (token !== pdfRenderToken) return;
      pageEl.style.minHeight = "";
      pageEl.replaceChildren(canvas);
      if (pagePicker?.isOn(pageNumber)) pagePicker.thumb?.(pageNumber, pageThumb(pageNumber));
      // Selectable text over the page, so a selection can be sent to Ask Klui.
      try {
        const pdfjsLib = await loadPdfJs();
        if (pdfjsLib.TextLayer && token === pdfRenderToken) {
          const layer = document.createElement("div");
          layer.className = "textLayer";
          layer.style.setProperty("--total-scale-factor", String(viewport.scale));
          layer.style.setProperty("--scale-factor", String(viewport.scale));
          pageEl.append(layer);
          const textLayer = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
          await textLayer.render();
          if (token === pdfRenderToken) trackPdfTextLayer(layer);
        }
      } catch {
        /* Text selection is optional; the page itself has rendered. */
      }
    };

    if ("IntersectionObserver" in window) {
      const observer = pdfObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          renderPage(entry.target).catch(() => {
            if (token === pdfRenderToken) entry.target.innerHTML = `<div class="pdf-page-placeholder">Page failed to render.</div>`;
          });
        }
      }, { root: elements.documentViewerBody, rootMargin: "900px 0px" });
      placeholders.forEach((pageEl) => observer.observe(pageEl));
    } else {
      for (const pageEl of placeholders.slice(0, 3)) {
        renderPage(pageEl).catch(() => {
          pageEl.innerHTML = `<div class="pdf-page-placeholder">Page failed to render.</div>`;
        });
      }
    }
  }

  const retriedPreviewJobs = new Set();

  async function pollDocumentPreviewJob(jobId) {
    stopDocumentPreviewPoll();
    let attempts = 0;
    const tick = async () => {
      if (!state.viewer.open || state.viewer.jobId !== jobId) return;
      attempts += 1;
      try {
        const payload = await fetchDocumentJobStatus(state.session, jobId);
        if (!state.viewer.open || state.viewer.jobId !== jobId) return;
        if (payload?.job?.status === "succeeded" && payload.artifact?.attachment_id) {
          // Reopen the original file, not the PDF preview: the server now serves the cached preview
          // with the original's actions, so Ask and downloads keep targeting the Word/PowerPoint file.
          await loadDocumentViewerUrl(state.viewer.attachmentId, {
            downloadAttachmentId: state.viewer.downloadAttachmentId || state.viewer.attachmentId,
            fileName: state.viewer.fileName,
            sourceKind: state.viewer.sourceKind,
            previewReady: payload.artifact.attachment_id
          });
          return;
        }
        if (["failed", "expired"].includes(payload?.job?.status)) {
          if (state.viewer.sourceKind === "xlsx") {
            await loadDocumentViewerUrl(state.viewer.downloadAttachmentId || state.viewer.attachmentId, {
              downloadAttachmentId: state.viewer.downloadAttachmentId || state.viewer.attachmentId,
              fileName: state.viewer.fileName,
              sourceKind: "xlsx",
              sheetFallback: true
            });
            return;
          }
          // A fresh file can hit a transient storage error; ask for one new conversion first.
          if (!retriedPreviewJobs.has(jobId)) {
            retriedPreviewJobs.add(jobId);
            await loadDocumentViewerUrl(state.viewer.attachmentId, {
              downloadAttachmentId: state.viewer.downloadAttachmentId || state.viewer.attachmentId,
              fileName: state.viewer.fileName,
              sourceKind: state.viewer.sourceKind,
              retryOf: jobId
            });
            return;
          }
          setDocumentViewerState({ loading: false, error: "The preview could not be generated." });
          return;
        }
      } catch (err) {
        if (attempts >= 2) setDocumentViewerState({ loading: false, error: err.message || "Preview failed." });
        return;
      }
      if (attempts >= 60) {
        setDocumentViewerState({ loading: false, error: "Preview generation timed out." });
        return;
      }
      documentViewerPoll = setTimeout(tick, 1500);
    };
    documentViewerPoll = setTimeout(tick, 1200);
  }

  async function loadDocumentViewerUrl(attachmentId, {
    downloadAttachmentId = "",
    fileName = "",
    sourceKind = "",
    sheetFallback = false,
    retryOf = "",
    previewReady = ""
  } = {}) {
    if (!state.session?.access_token) {
      setDocumentViewerState({ loading: false, error: "Sign in to view files." });
      return;
    }
    const requestToken = viewerTransitionToken;
    const payload = await fetchAttachmentView(state.session, attachmentId, { sheetFallback });
    if (!state.viewer.open || requestToken !== viewerTransitionToken) return;
    if (payload.status === "processing" && payload.jobId && previewReady) {
      // The finished preview is not linked to the file yet: show it, still editing the original.
      const original = state.viewer.downloadAttachmentId || attachmentId;
      await loadDocumentViewerUrl(previewReady, { downloadAttachmentId: original, fileName, sourceKind });
      if (state.viewer.open && requestToken === viewerTransitionToken) {
        setDocumentViewerState({ attachmentId: original, editAttachmentId: "", previewAttachmentId: previewReady, canAsk: false, designed: false, exportFormats: [] });
      }
      return;
    }
    if (payload.status === "processing" && payload.jobId) {
      setDocumentViewerState({
        open: true,
        attachmentId,
        downloadAttachmentId: downloadAttachmentId || state.viewer.downloadAttachmentId || attachmentId,
        jobId: payload.jobId,
        fileName: fileName || payload.fileName || "Document",
        kind: payload.kind || "pdf",
        sourceKind: payload.sourceKind || sourceKind,
        url: "",
        loading: true,
        error: ""
      });
      // The server may hand back the same failed job; never retry it twice.
      if (retryOf && payload.jobId !== retryOf) retriedPreviewJobs.add(payload.jobId);
      pollDocumentPreviewJob(payload.jobId);
      return;
    }
    if (!payload.url && !payload.sheets?.length && !payload.markdown && !payload.officeConfig) throw new Error("Preview was not returned.");
    stopDocumentPreviewPoll();
    setDocumentViewerState({
      open: true,
      attachmentId,
      downloadAttachmentId: downloadAttachmentId || state.viewer.downloadAttachmentId || attachmentId,
      jobId: "",
      fileName: payload.fileName || fileName || "Document",
      kind: payload.kind || "pdf",
      sourceKind: sourceKind || payload.sourceKind || payload.kind || "pdf",
      url: payload.url || "",
      officeUrl: String(payload.officeUrl || ""),
      officeConfig: payload.officeConfig || null,
      sheets: Array.isArray(payload.sheets) ? payload.sheets : [],
      activeSheet: 0,
      markdown: String(payload.markdown || ""),
      sourceUrl: String(payload.sourceUrl || ""),
      revision: Number(payload.revision || 0),
      editAttachmentId: String(payload.editAttachmentId || ""),
      previewAttachmentId: payload.editAttachmentId && payload.attachmentId !== payload.editAttachmentId ? String(payload.attachmentId || "") : "",
      canAsk: Boolean(payload.canAsk),
      designed: Boolean(payload.designed),
      exportFormats: Array.isArray(payload.exportFormats) ? payload.exportFormats : [],
      loading: false,
      error: ""
    });
  }

  async function openDocumentViewer({ attachmentId, fileName = "", format = "", container = null, onClose = null, page = 1, pagePick = null }) {
    resetPdf();
    pagePicker = container ? pagePick : null;
    if (isFullscreen) setFullscreen(false, { animate: false });
    if (!container) onViewerClose?.();
    inlineViewer = Boolean(container);
    onViewerClose = onClose;
    const ext = String(format || fileName.split(".").pop()).toLowerCase();
    elements.documentViewer.dataset.sourceFormat = ["ppt", "pptx"].includes(ext) ? "slides" : ["doc", "docx"].includes(ext) ? "word" : ext;
    elements.documentViewer.classList.toggle("is-inline-source", inlineViewer);
    if (container) container.append(elements.documentViewer);
    else viewerHome.after(elements.documentViewer);
    pdfZoom = 1;
    currentPdfPage = 1;
    initialPdfPage = Math.max(1, Math.trunc(Number(page)) || 1);
    toolbar.querySelector("select").value = "1";
    viewerTransitionToken += 1;
    viewerSession += 1;
    stopDocumentPreviewPoll();
    setDocumentViewerState({
      open: true,
      attachmentId,
      downloadAttachmentId: attachmentId,
      jobId: "",
      fileName: fileName || "Document",
      kind: "pdf",
      sourceKind: format.toLowerCase(),
      url: "",
      officeUrl: "",
      officeConfig: null,
      sheets: [],
      activeSheet: 0,
      markdown: "",
      revision: 0,
      editAttachmentId: "",
      previewAttachmentId: "",
      canAsk: false,
      designed: false,
      exportFormats: [],
      loading: true,
      error: ""
    });
    resetAsk();
    animateViewer(true);
    const requestToken = viewerTransitionToken;
    try {
      await loadDocumentViewerUrl(attachmentId, { fileName, sourceKind: format.toLowerCase() });
    } catch (err) {
      if (requestToken === viewerTransitionToken) setDocumentViewerState({ loading: false, error: err.message || "Preview failed." });
    }
  }

  async function closeDocumentViewer(event) {
    if (!state.viewer.open) return;
    const transitionToken = ++viewerTransitionToken;
    viewerSession += 1;
    askController?.abort();
    const exitAnimation = animateViewer(false);
    if (editorController) {
      pendingMarkdown = editorController.getMarkdown();
      void saveEditorNow().catch(() => {});
    }
    await exitAnimation;
    if (transitionToken !== viewerTransitionToken) return;
    destroyEditor();
    destroyOfficeViewer();
    if (isFullscreen) setFullscreen(false, { animate: false });
    stopDocumentPreviewPoll();
    resetPdf();
    if (elements.documentViewerBody) delete elements.documentViewerBody.dataset.pdfUrl;
    setDocumentViewerState({
      open: false,
      attachmentId: "",
      downloadAttachmentId: "",
      jobId: "",
      fileName: "",
      kind: "",
      sourceKind: "",
      url: "",
      officeUrl: "",
      officeConfig: null,
      sheets: [],
      activeSheet: 0,
      markdown: "",
      revision: 0,
      editAttachmentId: "",
      previewAttachmentId: "",
      canAsk: false,
      designed: false,
      exportFormats: [],
      loading: false,
      error: ""
    });
    resetAsk();
    inlineViewer = false;
    elements.documentViewer.classList.remove("is-inline-source");
    viewerHome.after(elements.documentViewer);
    const closed = onViewerClose;
    onViewerClose = null;
    closed?.(event);
  }

  elements.documentViewerBody?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-sheet-index]");
    if (!tab) return;
    setDocumentViewerState({ activeSheet: Number(tab.dataset.sheetIndex) || 0 });
  });

  function markdownFileName() {
    return String(state.viewer.fileName || "document").replace(/\.(docx|pdf|md)$/i, "") + ".md";
  }

  function downloadMarkdown(markdown) {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = markdownFileName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function abortError() {
    return new DOMException("The operation was aborted.", "AbortError");
  }

  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function waitForExport(jobId, signal = null) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await pause(1000, signal);
      const payload = await fetchDocumentJobStatus(state.session, jobId);
      if (signal?.aborted) throw abortError();
      if (payload?.job?.status === "succeeded" && payload.artifact?.attachment_id) return payload.artifact;
      if (["failed", "expired"].includes(payload?.job?.status)) throw new Error(payload.job.error?.message || "Export failed.");
    }
    throw new Error("Export is still processing. Try again shortly.");
  }

  async function exportEditable(format) {
    const markdown = editorController?.getMarkdown() || state.viewer.markdown;
    if (!markdown) return;
    if (format === "md") {
      downloadMarkdown(markdown);
      return;
    }
    await saveEditorNow();
    const result = await exportEditableDocument(state.session, state.viewer.attachmentId, format, markdown);
    const artifact = result.artifact || (result.jobId ? await waitForExport(result.jobId) : null);
    if (!artifact?.attachment_id) throw new Error("Export did not return a file.");
    await downloadAttachment(state.session, artifact.attachment_id, artifact.file_name || `document.${format}`);
  }

  elements.documentViewerDownload?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (state.viewer.kind === "editable" || (state.viewer.exportFormats || []).length > 1) {
      elements.documentViewerDownloadMenu?.classList.toggle("hidden");
      elements.documentViewerDownload.setAttribute("aria-expanded", String(!elements.documentViewerDownloadMenu?.classList.contains("hidden")));
      return;
    }
    const attachmentId = state.viewer.downloadAttachmentId || state.viewer.attachmentId;
    if (!attachmentId || !state.session?.access_token) return showToast?.("Please sign in to download.");
    try {
      elements.documentViewerDownload.disabled = true;
      await downloadAttachment(state.session, attachmentId, state.viewer.fileName || "download");
    } catch (error) {
      showToast?.(error.message || "Download failed.");
    } finally {
      elements.documentViewerDownload.disabled = false;
    }
  });

  // A document in either format: the file itself, its PDF preview, or a render of its spec.
  async function downloadFormat(format) {
    const viewer = state.viewer;
    const source = viewer.editAttachmentId || viewer.downloadAttachmentId || viewer.attachmentId;
    const base = String(viewer.fileName || "document").replace(/\.(docx|pdf|pptx)$/i, "");
    if (format === viewer.sourceKind) return downloadAttachment(state.session, viewer.downloadAttachmentId || source, viewer.fileName || `${base}.${format}`);
    if (format === "pdf" && viewer.previewAttachmentId) return downloadAttachment(state.session, viewer.previewAttachmentId, `${base}.pdf`);
    const result = await exportEditableDocument(state.session, source, format);
    const artifact = result.artifact || (result.jobId ? await waitForExport(result.jobId) : null);
    if (!artifact?.attachment_id) throw new Error("Export did not return a file.");
    await downloadAttachment(state.session, artifact.attachment_id, artifact.file_name || `${base}.${format}`);
  }

  // ---------------------------------------------------------------------------------------------
  // Ask Klui: a bar at the bottom edits the whole document; a pill at a text selection edits only
  // what is selected. Every edit makes a new version, which replaces the one on screen.

  // Built on first use, so a viewer without Ask Klui never creates it.
  let ask = null;
  let pill = null;
  function ensureAskUi() {
    if (ask || !elements.documentViewer) return Boolean(ask);
    ask = document.createElement("div");
    ask.className = "doc-ask hidden";
    ask.innerHTML = `<button type="button" class="doc-ask-open" data-ask-open>${KLUI_ICON}<span>Ask Klui</span></button>
    <form class="doc-ask-form" data-ask-form="document" hidden>
      <textarea rows="1" maxlength="4000" placeholder="Ask Klui to change this document…" aria-label="Describe the change"></textarea>
      <button type="submit" class="doc-ask-send" aria-label="Apply change" title="Apply change">${SEND_ICON}</button>
    </form>
    <div class="doc-ask-status" hidden role="status"><span class="artifact-spinner" aria-hidden="true"></span><span data-ask-status-text>Editing…</span></div>`;
    pill = document.createElement("form");
    pill.className = "doc-ask-pill hidden";
    pill.dataset.askForm = "selection";
    pill.innerHTML = `<textarea rows="1" maxlength="4000" placeholder="Ask Klui to change the selection…" aria-label="Describe the change to the selected text"></textarea><button type="submit" class="doc-ask-send" aria-label="Apply change" title="Apply change">${SEND_ICON}</button>`;
    elements.documentViewer.append(ask, pill);
    ask.addEventListener("click", (event) => {
      if (event.target.closest("[data-ask-open]")) setAskOpen(true);
    });
    bindAskForm(ask.querySelector("[data-ask-form]"), () => null);
    bindAskForm(pill, () => pendingSelection);
    return true;
  }
  let askBusy = false;
  let askController = null;
  let pendingSelection = null;

  function askAvailable() {
    const viewer = state.viewer;
    return Boolean(askDocument && viewer.open && viewer.canAsk && !viewer.loading && !viewer.error && viewer.kind === "pdf" && !inlineViewer);
  }

  function syncAskUi() {
    const available = askAvailable();
    if (!available && !ask) return;
    if (!ensureAskUi()) return;
    ask.classList.toggle("hidden", !available && !askBusy);
    if (!available && !askBusy) hidePill();
  }

  // Shows or hides an Ask Klui element: it pops in (CSS) and fades out before it is hidden.
  // Showing it again cancels a hide still in progress.
  const askLeaving = new WeakMap();
  function setAskShown(el, shown, setHidden = (hidden) => { el.hidden = hidden; }) {
    if (!el || (!shown && askLeaving.has(el))) return;
    clearTimeout(askLeaving.get(el));
    askLeaving.delete(el);
    el.classList.remove("is-leaving");
    if (shown || !el.getClientRects().length || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setHidden(!shown);
      return;
    }
    el.classList.add("is-leaving");
    askLeaving.set(el, setTimeout(() => {
      askLeaving.delete(el);
      el.classList.remove("is-leaving");
      setHidden(true);
    }, 150));
  }
  const setPillShown = (shown) => setAskShown(pill, shown, (hidden) => pill.classList.toggle("hidden", hidden));

  function setAskOpen(open) {
    const form = ask.querySelector("[data-ask-form]");
    setAskShown(form, open);
    setAskShown(ask.querySelector("[data-ask-open]"), !open && !askBusy);
    ask.classList.toggle("is-open", open);
    if (open) form.querySelector("textarea").focus();
  }

  function setAskBusy(busy, label = "Editing…") {
    askBusy = busy;
    ask.classList.toggle("is-busy", busy);
    const status = ask.querySelector(".doc-ask-status");
    setAskShown(status, busy);
    status.querySelector("[data-ask-status-text]").textContent = label;
    if (busy) {
      setAskShown(ask.querySelector("[data-ask-form]"), false);
      setAskShown(ask.querySelector("[data-ask-open]"), false);
      ask.classList.remove("hidden");
    } else {
      setAskShown(ask.querySelector("[data-ask-open]"), true);
    }
    elements.documentViewerBody?.classList.toggle("is-asking", busy);
    syncAskUi();
  }

  function clearMarks() {
    elements.documentViewerBody?.querySelectorAll(".doc-ask-mark").forEach((mark) => mark.remove());
  }

  // The selection pill replaces the Ask Klui button (and the bar) while it is up.
  function hidePill() {
    if (pill) setPillShown(false);
    ask?.classList.remove("is-behind-pill");
    pendingSelection = null;
    if (!askBusy) clearMarks();
  }

  function resetAsk() {
    askController?.abort();
    askController = null;
    askBusy = false;
    if (!ask) return;
    ask.classList.remove("is-busy", "is-open");
    setAskShown(ask.querySelector(".doc-ask-status"), false);
    setAskShown(ask.querySelector("[data-ask-form]"), false);
    setAskShown(ask.querySelector("[data-ask-open]"), true);
    ask.querySelectorAll("textarea").forEach((area) => { area.value = ""; });
    pill.querySelector("textarea").value = "";
    elements.documentViewerBody?.classList.remove("is-asking");
    hidePill();
  }

  // The selection as text plus a little context and its page, and marks that keep it visible
  // while the user types (focusing the input clears the browser's own highlight).
  function captureSelection() {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const layer = (range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest?.(".textLayer, .pdf-pages");
    if (!layer || !elements.documentViewerBody?.contains(layer)) return null;
    const text = selectionPlainText(selection.toString()).trim();
    if (text.length < 2) return null;
    const startPage = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest?.("[data-page]");
    const pageNumber = Number(startPage?.dataset.page || 0) || null;
    let before = "";
    let after = "";
    const pageLayer = startPage?.querySelector(".textLayer");
    if (pageLayer) {
      try {
        const head = document.createRange();
        head.setStart(pageLayer, 0);
        head.setEnd(range.startContainer, range.startOffset);
        before = selectionPlainText(head.toString()).slice(-200);
        const endPage = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement)?.closest?.("[data-page]");
        const endLayer = endPage?.querySelector(".textLayer") || pageLayer;
        const tail = document.createRange();
        tail.setStart(range.endContainer, range.endOffset);
        tail.setEnd(endLayer, endLayer.childNodes.length);
        after = selectionPlainText(tail.toString()).slice(0, 200);
      } catch {
        /* Context is a hint for matching; the selected text alone still works. */
      }
    }
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1);
    return { text: text.slice(0, 12000), before, after, page: pageNumber, rects };
  }

  function markSelection(rects) {
    clearMarks();
    const pages = [...(elements.documentViewerBody?.querySelectorAll("[data-page]") || [])];
    for (const rect of rects.slice(0, 400)) {
      const page = pages.find((entry) => {
        const box = entry.getBoundingClientRect();
        return rect.top >= box.top - 2 && rect.bottom <= box.bottom + 2;
      });
      if (!page) continue;
      const box = page.getBoundingClientRect();
      const mark = document.createElement("span");
      mark.className = "doc-ask-mark";
      mark.style.left = `${rect.left - box.left}px`;
      mark.style.top = `${rect.top - box.top}px`;
      mark.style.width = `${rect.width}px`;
      mark.style.height = `${rect.height}px`;
      page.append(mark);
    }
  }

  function showPill(captured) {
    pendingSelection = captured;
    markSelection(captured.rects);
    const host = elements.documentViewer.getBoundingClientRect();
    const last = captured.rects[captured.rects.length - 1];
    const first = captured.rects[0];
    const width = Math.min(380, host.width - 24);
    let left = Math.min(Math.max(12, (first.left + last.right) / 2 - host.left - width / 2), host.width - width - 12);
    let top = last.bottom - host.top + 10;
    if (top > host.height - 70) top = Math.max(60, first.top - host.top - 58);
    pill.style.width = `${width}px`;
    pill.style.left = `${left}px`;
    pill.style.top = `${top}px`;
    setPillShown(true);
    ask.classList.add("is-behind-pill");
  }

  async function runAsk(instruction, selection) {
    const viewer = state.viewer;
    const target = viewer.editAttachmentId || viewer.downloadAttachmentId || viewer.attachmentId;
    if (!instruction || !target || askBusy) return;
    const page = currentPdfPage;
    const session = viewerSession;
    const controller = new AbortController();
    askController = controller;
    setAskBusy(true, selection ? "Editing the selection…" : "Editing the document…");
    setPillShown(false);
    try {
      let result = await askDocument(state.session, target, {
        instruction,
        selection: selection ? { text: selection.text, before: selection.before, after: selection.after, page: selection.page } : null,
        signal: controller.signal
      });
      if (result.status === "processing" && result.jobId) {
        // The chat already holds the request and a pending card for this job; show them now.
        onDocumentEdited?.(result);
        const artifact = await waitForExport(result.jobId, controller.signal);
        result = { ...result, status: "ready", artifact, recorded: true };
      }
      // The viewer moved on to another document (or closed) while this edit ran.
      if (controller.signal.aborted || session !== viewerSession || !state.viewer.open) return;
      if (result.status === "unchanged") {
        showToast?.(result.summary || "Nothing was changed.");
        return;
      }
      const artifact = result.artifact;
      if (!artifact?.attachment_id) throw new Error("The edited document was not returned.");
      ask.querySelectorAll("textarea").forEach((area) => { area.value = ""; });
      pill.querySelector("textarea").value = "";
      await showVersion(artifact, page);
      showToast?.(result.summary || "Updated.");
      if (!result.recorded) onDocumentEdited?.(result);
    } catch (error) {
      if (error?.name !== "AbortError" && session === viewerSession) showToast?.(error.message || "The edit failed.");
    } finally {
      // A newer viewer session owns the Ask controls now: leave them alone.
      if (askController === controller) {
        askController = null;
        setAskBusy(false);
        clearMarks();
        pendingSelection = null;
      }
    }
  }

  async function showVersion(artifact, page) {
    const format = String(artifact.format || state.viewer.sourceKind || "pdf").toLowerCase();
    initialPdfPage = Math.max(1, page || 1);
    resetPdf();
    if (elements.documentViewerBody) delete elements.documentViewerBody.dataset.pdfUrl;
    const requestToken = ++viewerTransitionToken;
    setDocumentViewerState({
      attachmentId: artifact.attachment_id,
      downloadAttachmentId: artifact.attachment_id,
      editAttachmentId: artifact.attachment_id,
      fileName: artifact.file_name || state.viewer.fileName,
      sourceKind: format,
      loading: true,
      error: ""
    });
    try {
      await loadDocumentViewerUrl(artifact.attachment_id, { downloadAttachmentId: artifact.attachment_id, fileName: artifact.file_name, sourceKind: format });
    } catch (error) {
      if (requestToken === viewerTransitionToken) setDocumentViewerState({ loading: false, error: error.message || "Preview failed." });
    }
  }

  function bindAskForm(form, getSelection) {
    const area = form.querySelector("textarea");
    const submit = () => {
      const instruction = area.value.trim();
      if (!instruction) return;
      const selection = getSelection();
      if (form === pill) hidePill();
      else setAskOpen(false);
      void runAsk(instruction, selection);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    area.addEventListener("input", () => {
      area.style.height = "auto";
      area.style.height = `${Math.min(120, area.scrollHeight)}px`;
    });
    area.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (form === pill) hidePill();
        else setAskOpen(false);
      }
    });
  }
  elements.documentViewerBody?.addEventListener("pointerup", () => {
    if (!askAvailable() || askBusy) return;
    // Let the browser finish updating the selection first.
    setTimeout(() => {
      const captured = captureSelection();
      if (captured && ensureAskUi()) showPill(captured);
    }, 0);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!pill || pill.classList.contains("hidden") || pill.contains(event.target)) return;
    if (elements.documentViewerBody?.contains(event.target) || !elements.documentViewer?.contains(event.target)) hidePill();
  });
  // Clicking away closes an empty Ask bar; a typed request stays until it is sent or cleared.
  document.addEventListener("pointerdown", (event) => {
    if (!ask?.classList.contains("is-open") || ask.contains(event.target)) return;
    if (!ask.querySelector("[data-ask-form] textarea").value.trim()) setAskOpen(false);
  });
  elements.documentViewerBody?.addEventListener("scroll", () => {
    if (pill && !pill.classList.contains("hidden") && document.activeElement !== pill.querySelector("textarea")) hidePill();
  }, { passive: true });

  elements.documentViewerFullscreen?.addEventListener("click", (event) => {
    if (state.viewer.open) setFullscreen(!isFullscreen, { animate: Boolean(event.detail) });
  });

  document.addEventListener("pointerdown", (event) => {
    if (elements.documentViewerDownloadMenu?.classList.contains("hidden")) return;
    if (elements.documentViewerDownload.contains(event.target) || elements.documentViewerDownloadMenu.contains(event.target)) return;
    elements.documentViewerDownloadMenu.classList.add("hidden");
    elements.documentViewerDownload.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!elements.documentViewerDownloadMenu?.classList.contains("hidden")) {
      elements.documentViewerDownloadMenu.classList.add("hidden");
      elements.documentViewerDownload.setAttribute("aria-expanded", "false");
    } else if (isFullscreen) {
      setFullscreen(false);
    }
  });

  elements.documentViewerDownloadMenu?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-document-export]");
    if (!button) return;
    elements.documentViewerDownloadMenu.classList.add("hidden");
    try {
      elements.documentViewerDownload.disabled = true;
      if (state.viewer.kind === "editable") await exportEditable(button.dataset.documentExport);
      else await downloadFormat(button.dataset.documentExport);
    } catch (error) {
      showToast?.(error.message || "Export failed.");
    } finally {
      elements.documentViewerDownload.disabled = false;
    }
  });

  syncFullscreenButton();

  function setDocumentViewerWidth(width) {
    const min = 360;
    const max = Math.max(min, Math.min(window.innerWidth - 460, Math.floor(window.innerWidth * 0.72)));
    const next = Math.max(min, Math.min(max, Math.round(width)));
    document.documentElement.style.setProperty("--document-viewer-w", `${next}px`);
    try {
      localStorage.setItem(VIEWER_WIDTH_KEY, String(next));
    } catch {
      /* Ignore storage failures. */
    }
  }

  function initDocumentViewerWidth() {
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(VIEWER_WIDTH_KEY) || 0);
    } catch {
      saved = 0;
    }
    setDocumentViewerWidth(saved || Math.round(window.innerWidth * 0.45));
  }

  function beginDocumentViewerResize(event) {
    if (!state.viewer.open || window.matchMedia("(max-width: 900px)").matches) return;
    event.preventDefault();
    document.body.classList.add("document-viewer-resizing");
    const move = (moveEvent) => {
      setDocumentViewerWidth(window.innerWidth - moveEvent.clientX);
    };
    const stop = () => {
      document.body.classList.remove("document-viewer-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }

  return {
    openDocumentViewer,
    closeDocumentViewer,
    syncPagePicks,
    renderDocumentViewer,
    setDocumentViewerState,
    syncPendingArtifactPolls,
    stopPendingArtifactPolls,
    isPendingArtifactPollsActive,
    stopDocumentPreviewPoll,
    isDocumentPreviewPollActive,
    initDocumentViewerWidth,
    beginDocumentViewerResize
  };
}
