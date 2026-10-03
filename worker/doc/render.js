// Renders a DocSpec to PDF or DOCX. Both come from the same spec; a DOCX also gets a PDF
// preview printed from the spec, so the viewer shows exactly what was designed.

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chartSvgs, renderDocx } from "./docx.js";
import { FONT_DIR, renderHtml } from "./html.js";
import { browser, closeBrowser, htmlToPdf, svgToPng } from "./pdf.js";
import { normalizeDoc } from "./spec.js";
import { resolveStyle } from "./themes.js";

export { closeBrowser, normalizeDoc };

async function chartFontCss(doc) {
  const theme = resolveStyle(doc);
  const faces = { "Inter": ["Inter-Regular", 400, "Inter-SemiBold", 600, "Inter-Bold", 700], "IBM Plex Sans": ["IBMPlexSans-Regular", 400, "IBMPlexSans-SemiBold", 600, "IBMPlexSans-Bold", 700], "Source Serif 4": ["SourceSerif4-Regular", 400, "SourceSerif4-SemiBold", 600, "SourceSerif4-Bold", 700], "Lora": ["Lora-Regular", 400, "Lora-SemiBold", 600, "Lora-Bold", 700], "EB Garamond": ["EBGaramond-Regular", 400, "EBGaramond-SemiBold", 600, "EBGaramond-Bold", 700] };
  const list = faces[theme.fonts.pdf.label] || [];
  const out = [];
  for (let i = 0; i < list.length; i += 2) {
    out.push(`@font-face{font-family:"${theme.fonts.pdf.label}";font-weight:${list[i + 1]};src:url("${pathToFileURL(path.join(FONT_DIR, `${list[i]}.ttf`)).href}");}`);
  }
  return out.join("");
}

export async function renderDocument(rawDoc, format, outputPath, { tmpDir = path.dirname(outputPath) } = {}) {
  const doc = normalizeDoc(rawDoc);
  const warnings = [];
  if (format === "pdf") {
    const info = await htmlToPdf(renderHtml(doc), outputPath, { tmpDir });
    for (const id of info.overflow || []) warnings.push(`block ${id} is wider than the page`);
    return { doc, warnings };
  }
  if (format === "docx") {
    const svgs = chartSvgs(doc);
    let charts = [];
    if (svgs.some(Boolean)) {
      await browser();
      charts = await svgToPng(svgs, { tmpDir, fontCss: await chartFontCss(doc) });
    }
    await renderDocx(doc, outputPath, { charts });
    return { doc, warnings };
  }
  throw new Error(`Unsupported document format: ${format}`);
}

export async function writeDocJson(doc, filePath) {
  await fs.writeFile(filePath, JSON.stringify(doc));
}
