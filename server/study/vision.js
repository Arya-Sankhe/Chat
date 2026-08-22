const TINY_PAGE_CHARS = 40;
const MAX_VISION_PAGES = 24;
const VISION_BATCH = 6;
export const STUDY_VISION_VERSION = 1;

function pageKey(meta = {}) {
  const page = Number(meta.page ?? meta.page_number);
  if (Number.isInteger(page) && page > 0) return page;
  const slide = Number(meta.slide);
  if (Number.isInteger(slide) && slide > 0) return slide;
  return null;
}

function textLen(value) {
  return String(value || "").trim().length;
}

function hasFigureSignal(meta = {}) {
  const figures = Number(meta.figure_count ?? meta.figures ?? 0);
  if (Number.isFinite(figures) && figures > 0) return true;
  return Boolean(meta.has_visual || meta.has_figures || meta.has_chart || meta.has_diagram);
}

export function collectDigitalPageText(chunks = []) {
  const byPage = new Map();
  for (const chunk of chunks || []) {
    const n = pageKey(chunk.metadata || {});
    if (!n) continue;
    const prev = byPage.get(n) || "";
    const piece = String(chunk.text || "").trim();
    byPage.set(n, prev ? `${prev}\n${piece}` : piece);
  }
  return byPage;
}

export function selectVisionCandidates({ kind, chunks = [], pages = [], max = MAX_VISION_PAGES } = {}) {
  const digital = collectDigitalPageText(chunks);
  const pageRows = new Map((pages || []).map((page) => [Number(page.page_number), page]));
  const numbers = new Set([...digital.keys(), ...pageRows.keys()]);
  for (const chunk of chunks || []) {
    const n = pageKey(chunk.metadata || {});
    if (n) numbers.add(n);
  }

  const candidates = [];
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const page = pageRows.get(n);
    const digitalText = digital.get(n) || "";
    const cached = String(page?.text || "").trim();
    const meta = page?.metadata && typeof page.metadata === "object" ? page.metadata : {};
    const tiny = textLen(digitalText) < TINY_PAGE_CHARS;
    const visual = hasFigureSignal(meta) || hasFigureSignal(chunkMetaForPage(chunks, n));
    const isPptx = kind === "pptx";
    const wantsVision = tiny || visual || (isPptx && (tiny || Boolean(meta.has_visual)));
    if (!wantsVision && textLen(digitalText) >= TINY_PAGE_CHARS) continue;
    if (!wantsVision && !page?.image_key) continue;
    if (!page?.image_key && !cached) continue;
    candidates.push({
      pageNumber: n,
      digitalText,
      cachedText: cached,
      imageKey: page?.image_key || "",
      metadata: meta,
      needsVision: !cached && Boolean(page?.image_key)
    });
  }

  const totalCandidates = candidates.length;
  const selected = candidates.slice(0, max);
  return {
    candidates: selected,
    totalCandidates,
    truncated: totalCandidates > max,
    skipped: Math.max(0, totalCandidates - selected.length)
  };
}

function chunkMetaForPage(chunks, pageNumber) {
  for (const chunk of chunks || []) {
    if (pageKey(chunk.metadata || {}) === pageNumber) return chunk.metadata || {};
  }
  return {};
}

export function mergePageTexts({ digitalByPage, visionByPage }) {
  const numbers = new Set([
    ...[...(digitalByPage || new Map()).keys()],
    ...[...(visionByPage || new Map()).keys()]
  ]);
  const parts = [];
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const digital = String(digitalByPage?.get(n) || "").trim();
    const vision = String(visionByPage?.get(n) || "").trim();
    if (digital && vision) {
      // Prefer digital body; append vision only when it adds non-duplicate content.
      if (vision === digital || digital.includes(vision)) parts.push(digital);
      else if (vision.includes(digital)) parts.push(vision);
      else parts.push(`${digital}\n\n${vision}`);
    } else {
      const text = digital || vision;
      if (text) parts.push(text);
    }
  }
  return parts.join("\n\n").trim();
}

export async function enrichSourceWithSelectiveVision({
  context,
  config,
  documentFile,
  chunks,
  signal,
  streamVision,
  onStage
}) {
  if (!documentFile?.id) {
    return { text: "", warning: null, visionCount: 0 };
  }
  const pages = await context.db.listDocumentPages(context.user.id, documentFile.id, {
    limit: Math.max(Number(documentFile.page_count) || 200, 200),
    signal
  }) || [];
  const { candidates, truncated, skipped } = selectVisionCandidates({
    kind: documentFile.kind,
    chunks,
    pages
  });

  const digitalByPage = collectDigitalPageText(chunks);
  const visionByPage = new Map();
  let visionCount = 0;

  for (const candidate of candidates) {
    if (candidate.cachedText) {
      visionByPage.set(candidate.pageNumber, candidate.cachedText);
      continue;
    }
  }

  const uncached = candidates.filter((row) => row.needsVision && !visionByPage.has(row.pageNumber));
  if (uncached.length && typeof streamVision === "function") {
    onStage?.("vision");
    for (let i = 0; i < uncached.length; i += VISION_BATCH) {
      if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      const batch = uncached.slice(i, i + VISION_BATCH);
      const urls = batch.map((row) => ({
        pageNumber: row.pageNumber,
        url: context.r2.readUrl(row.imageKey)
      })).filter((row) => row.url);
      if (!urls.length) continue;
      try {
        const transcript = await streamVision({
          pages: urls,
          signal
        });
        const byPage = splitVisionTranscript(transcript, urls.map((row) => row.pageNumber));
        for (const row of batch) {
          const text = String(byPage.get(row.pageNumber) || "").trim();
          if (!text) continue;
          visionByPage.set(row.pageNumber, text);
          visionCount += 1;
          const prevMeta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
          await context.db.updateDocumentPage(context.user.id, documentFile.id, row.pageNumber, {
            text,
            char_count: text.length,
            metadata: {
              ...prevMeta,
              vision_model: config?.study?.visionModel || "xiaomi/mimo-v2.5",
              vision_version: STUDY_VISION_VERSION,
              vision_at: new Date().toISOString()
            }
          }, { signal }).catch(() => {});
        }
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw error;
        // Visual enrichment is best-effort; digital text still proceeds.
      }
    }
  }

  // Chunks without page metadata still contribute as whole-document digital text.
  const orphan = (chunks || [])
    .filter((chunk) => pageKey(chunk.metadata || {}) == null)
    .map((chunk) => String(chunk.text || "").trim())
    .filter(Boolean)
    .join("\n");

  const merged = [orphan, mergePageTexts({ digitalByPage, visionByPage })].filter(Boolean).join("\n\n").trim();
  const warning = truncated
    ? `Vision limited to ${MAX_VISION_PAGES} pages; ${skipped} additional visual candidates were skipped.`
    : null;
  return { text: merged, warning, visionCount, candidateCount: candidates.length };
}

export function splitVisionTranscript(transcript, pageNumbers = []) {
  const text = String(transcript || "");
  const map = new Map();
  if (!pageNumbers.length) return map;
  const markers = pageNumbers.map((n) => ({
    n,
    re: new RegExp(`(?:^|\\n)\\s*(?:page|slide)\\s*${n}\\b[:\\s-]*`, "i")
  }));
  const hits = [];
  for (const marker of markers) {
    const match = marker.re.exec(text);
    if (match) hits.push({ n: marker.n, index: match.index + (match[0].startsWith("\n") ? 1 : 0), len: match[0].trimStart().length });
  }
  hits.sort((a, b) => a.index - b.index);
  if (!hits.length) {
    map.set(pageNumbers[0], text.trim());
    return map;
  }
  for (let i = 0; i < hits.length; i += 1) {
    const start = hits[i].index + hits[i].len;
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
    map.set(hits[i].n, text.slice(start, end).trim());
  }
  return map;
}
