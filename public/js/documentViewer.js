import { mountDocumentEditor } from "./documentEditor.js";

const viewerSvg = (content) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const DOWNLOAD_ICON = viewerSvg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>');
const CHEVRON_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const EXPAND_ICON = viewerSvg('<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>');
const COLLAPSE_ICON = viewerSvg('<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>');

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
  replacePendingArtifact
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
  let fullscreenAnimation = null;
  let viewerAnimation = null;
  let viewerTransitionToken = 0;

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
    document.body.classList.toggle("document-viewer-open", Boolean(viewer.open));
    elements.documentViewer.classList.toggle("hidden", !viewer.open);
    elements.documentViewerTitle.textContent = viewer.fileName || "Document";
    elements.documentViewerMeta.textContent = viewerMetaLabel();

    const downloadAttachmentId = viewer.downloadAttachmentId || viewer.attachmentId;
    const downloadHref = downloadAttachmentId ? attachmentDownloadHref(downloadAttachmentId) : "";
    const editable = viewer.kind === "editable";
    elements.documentViewerBody.classList.toggle("is-editable", editable);
    elements.documentViewerDownload.classList.toggle("hidden", !downloadHref);
    elements.documentViewerDownload.toggleAttribute("hidden", !downloadHref);
    elements.documentViewerDownload.innerHTML = `${DOWNLOAD_ICON}<span>Download</span>${editable ? `<span class="document-download-chevron">${CHEVRON_ICON}</span>` : ""}`;
    elements.documentViewerDownload.setAttribute("aria-expanded", String(editable && !elements.documentViewerDownloadMenu?.classList.contains("hidden")));
    if (!editable) elements.documentViewerDownloadMenu?.classList.add("hidden");
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
              model: state.activeConversation?.model || state.settings?.model,
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
    return Math.max(420, Math.round(width * 1.294));
  }

  function renderCleanPdfViewer(url) {
    if (elements.documentViewerBody.dataset.pdfUrl === url) return;
    const token = ++pdfRenderToken;
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

  async function renderPdfPages(pdfjs, url, token) {
    const container = elements.documentViewerBody.querySelector("[data-pdf-pages]");
    if (!container || token !== pdfRenderToken) return;

    let pdf;
    try {
      pdf = await pdfjs.getDocument({ url }).promise;
    } catch {
      if (token !== pdfRenderToken) return;
      elements.documentViewerBody.innerHTML = `<div class="document-viewer-empty">Could not open this PDF preview.</div>`;
      return;
    }
    if (token !== pdfRenderToken) return;

    const bodyWidth = Math.max(320, elements.documentViewerBody.clientWidth - 28);
    container.innerHTML = "";
    const placeholders = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const pageEl = document.createElement("div");
      pageEl.className = "pdf-page";
      pageEl.dataset.page = String(pageNumber);
      pageEl.style.minHeight = `${pdfPlaceholderHeight(bodyWidth)}px`;
      pageEl.innerHTML = `<div class="pdf-page-placeholder"><span class="artifact-spinner" aria-hidden="true"></span></div>`;
      container.appendChild(pageEl);
      placeholders.push(pageEl);
    }

    const renderPage = async (pageEl) => {
      if (pageEl.dataset.rendered || token !== pdfRenderToken) return;
      pageEl.dataset.rendered = "1";
      const pageNumber = Number(pageEl.dataset.page);
      const page = await pdf.getPage(pageNumber);
      if (token !== pdfRenderToken) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1.8, Math.max(0.6, bodyWidth / base.width));
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.setAttribute("aria-label", `Page ${pageNumber}`);
      const context = canvas.getContext("2d", { alpha: false });
      await page.render({
        canvasContext: context,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
      }).promise;
      if (token !== pdfRenderToken) return;
      pageEl.style.minHeight = "";
      pageEl.replaceChildren(canvas);
    };

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          renderPage(entry.target).catch(() => {
            entry.target.innerHTML = `<div class="pdf-page-placeholder">Page failed to render.</div>`;
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
          await loadDocumentViewerUrl(payload.artifact.attachment_id, {
            downloadAttachmentId: state.viewer.downloadAttachmentId || state.viewer.attachmentId,
            fileName: state.viewer.fileName || payload.artifact.file_name,
            sourceKind: state.viewer.sourceKind
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
    sheetFallback = false
  } = {}) {
    if (!state.session?.access_token) {
      setDocumentViewerState({ loading: false, error: "Sign in to view files." });
      return;
    }
    const payload = await fetchAttachmentView(state.session, attachmentId, { sheetFallback });
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
      revision: Number(payload.revision || 0),
      loading: false,
      error: ""
    });
  }

  async function openDocumentViewer({ attachmentId, fileName = "", format = "" }) {
    viewerTransitionToken += 1;
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
      loading: true,
      error: ""
    });
    animateViewer(true);
    try {
      await loadDocumentViewerUrl(attachmentId, { fileName, sourceKind: format.toLowerCase() });
    } catch (err) {
      setDocumentViewerState({ loading: false, error: err.message || "Preview failed." });
    }
  }

  async function closeDocumentViewer() {
    if (!state.viewer.open) return;
    const transitionToken = ++viewerTransitionToken;
    const exitAnimation = animateViewer(false);
    let savePromise = Promise.resolve();
    if (editorController) {
      pendingMarkdown = editorController.getMarkdown();
      savePromise = saveEditorNow().catch(() => {});
    }
    await Promise.all([exitAnimation, savePromise]);
    if (transitionToken !== viewerTransitionToken) return;
    destroyEditor();
    destroyOfficeViewer();
    if (isFullscreen) setFullscreen(false, { animate: false });
    stopDocumentPreviewPoll();
    pdfRenderToken += 1;
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
      loading: false,
      error: ""
    });
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

  async function waitForExport(jobId) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const payload = await fetchDocumentJobStatus(state.session, jobId);
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
    if (state.viewer.kind === "editable") {
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

  elements.documentViewerFullscreen?.addEventListener("click", () => {
    if (state.viewer.open) setFullscreen(!isFullscreen);
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
      await exportEditable(button.dataset.documentExport);
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
