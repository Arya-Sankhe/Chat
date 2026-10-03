// Print HTML to PDF with headless Chromium. One browser per generator run; pages are cheap.

import fs from "node:fs";
import puppeteer from "puppeteer-core";

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter(Boolean);

export function chromiumPath() {
  const found = CANDIDATES.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!found) throw new Error("chromium_not_found: set CHROMIUM_PATH");
  return found;
}

let browserPromise = null;

export async function browser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: chromiumPath(),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--font-render-hinting=none",
        "--allow-file-access-from-files",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--mute-audio"
      ]
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const current = await browserPromise.catch(() => null);
  browserPromise = null;
  await current?.close().catch(() => {});
}

// The renderer only ever loads local fonts and images the spec carries; block the network so
// a figure URL cannot make the worker fetch arbitrary hosts at print time.
async function guardedPage() {
  const page = await (await browser()).newPage();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("file:") || url.startsWith("data:") || url === "about:blank") request.continue();
    else request.abort();
  });
  return page;
}

async function loadHtml(page, html, tmpDir) {
  // Loading from a file URL lets the page read the bundled fonts.
  const file = `${tmpDir}/doc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`;
  await fs.promises.writeFile(file, html);
  try {
    await page.goto(`file://${file}`, { waitUntil: "load", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
  } finally {
    fs.promises.unlink(file).catch(() => {});
  }
}

export async function htmlToPdf(html, outputPath, { tmpDir = "/tmp" } = {}) {
  const page = await guardedPage();
  try {
    await loadHtml(page, html, tmpDir);
    await page.pdf({ path: outputPath, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, timeout: 120_000, tagged: true, outline: true });
    // Where each block landed, for warnings (overflowing tables, a lone heading at a page end).
    return await page.evaluate(() => {
      const overflow = [];
      for (const element of document.querySelectorAll("[data-block]")) {
        if (element.scrollWidth > element.clientWidth + 2 && element.tagName !== "PRE") overflow.push(element.dataset.block);
      }
      return { overflow };
    });
  } finally {
    await page.close().catch(() => {});
  }
}

// PNGs of SVG charts for the DOCX, at 2x for print sharpness.
export async function svgToPng(svgs, { tmpDir = "/tmp", fontCss = "" } = {}) {
  if (!svgs.length) return [];
  const page = await guardedPage();
  try {
    await page.setViewport({ width: 700, height: 600, deviceScaleFactor: 2.5 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss} body{margin:0;background:#fff;} .c{display:inline-block;padding:0;background:#fff;} svg{display:block;}</style></head><body>${svgs.map((svg, i) => `<div class="c" id="c${i}">${svg}</div>`).join("")}</body></html>`;
    await loadHtml(page, html, tmpDir);
    const out = [];
    for (let i = 0; i < svgs.length; i += 1) {
      if (!svgs[i]) {
        out.push(null);
        continue;
      }
      const element = await page.$(`#c${i}`);
      const box = await element.boundingBox();
      out.push({ png: await element.screenshot({ type: "png", omitBackground: false }), width: box.width, height: box.height });
    }
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}
