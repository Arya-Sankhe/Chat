// Slide compositions: shared chrome (header, section tracker, takeaway, footer), the content
// layouts for each slide type, and one cover design per theme.
import { plain, textWidthPt } from "./measure.js";
import { W, H, MX, CW, chip, drawKpi, drawTable, kpiRow, kpiStack, measureKpi, rows, statusLabel, statusTone } from "./core.js";
import { drawChart } from "./charts.js";

// ---------------------------------------------------------------------------------------------
// Colour helpers

function hexToRgb(hex) {
  const value = parseInt(String(hex).replace(/^#/, ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function mix(a, b, amount) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const channel = (x, y) => Math.round(x + (y - x) * amount).toString(16).padStart(2, "0");
  return `${channel(r1, r2)}${channel(g1, g2)}${channel(b1, b2)}`.toUpperCase();
}

const pad2 = (value) => String(value).padStart(2, "0");

// ---------------------------------------------------------------------------------------------
// Decoration

// Diagonal hatching clipped to a circle (the striped-disc motif).
function hatchedDisc(p, cx, cy, r, color, count = 9) {
  const step = (2 * r) / (count + 1);
  for (let index = 1; index <= count; index += 1) {
    const d = -r + index * step;
    const half = Math.sqrt(Math.max(0, r * r - d * d));
    // Lines run up-right; offset d along the (1,1)/√2 normal.
    const nx = d / Math.SQRT2;
    const ny = d / Math.SQRT2;
    const tx = half / Math.SQRT2;
    const ty = -half / Math.SQRT2;
    p.line(cx + nx - tx, cy + ny - ty, cx + nx + tx, cy + ny + ty, { color, width: 2.25 });
  }
}

// Soft light: stacked, nearly transparent discs read as a radial falloff.
// Many thin layers keep the steps between rings too small to read as bands.
function glow(p, cx, cy, r, color, strength = 1) {
  for (let step = 0; step < 10; step += 1) {
    const rr = r * (1 - step * 0.075);
    p.ellipse({ x: cx - rr, y: cy - rr, w: rr * 2, h: rr * 2 }, { fill: color, transparency: 100 - Math.max(1, Math.round(1.5 * strength)) });
  }
}

function lineFan(p, origin, targets, color, width = 0.5) {
  targets.forEach(([x, y]) => p.line(origin[0], origin[1], x, y, { color, width }));
}

function background(p, s, { cover = false } = {}) {
  p.slide.background = { color: p.color("bg") };
  if (cover) return;
  drawMotifs(p);
}

// Relative luminance, for choosing text that reads on a fill.
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The theme's dark or light text colour, whichever reads on this fill.
export function onFill(p, fill) {
  const ink = p.color("ink");
  const bg = p.color("bg");
  const inkIsDark = luminance(ink) < luminance(bg);
  return luminance(p.color(fill)) > 0.3 ? (inkIsDark ? ink : bg) : (inkIsDark ? "FFFFFF" : ink);
}

// Background motifs for content slides. They stay in the margins (or sit faintly behind the
// content), so any layout can be drawn over them; "hide decoration" removes them.
const MOTIFS = {
  glow(p) {
    glow(p, W - 1.2, -0.9, 3.6, p.color("accent"));
    glow(p, -0.4, H + 0.6, 3.0, p.color("accent3"), 0.8);
  },
  arcs(p) {
    const cx = W + 3.3;
    const cy = H * 0.55;
    [2.95, 3.25, 3.55, 3.85].forEach((r, index) => {
      p.ellipse({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, { line: index === 1 ? mix(p.color("accent"), p.color("bg"), 0.35) : "rule", lineWidth: 0.75 });
    });
  },
  blob(p) {
    p.ellipse({ x: W - 2.3, y: -1.95, w: 3.6, h: 2.55 }, { fill: "surfaceStrong" });
    p.ellipse({ x: W - 1.05, y: -0.9, w: 1.7, h: 1.45 }, { fill: "accent", transparency: 78 });
    p.ellipse({ x: -1.5, y: H - 0.7, w: 3.0, h: 1.9 }, { fill: "surfaceStrong" });
  },
  leaves(p) {
    const leaf = (x, y, size, rotate, transparency = 15) => p.shape("teardrop", { x, y, w: size, h: size }, { fill: "accent", transparency, rotate });
    leaf(W - 0.95, -0.28, 0.72, 225);
    leaf(W - 1.55, -0.38, 0.55, 250, 40);
    leaf(W - 0.55, 0.3, 0.48, 200, 40);
    leaf(-0.3, H - 0.62, 0.7, 45);
    leaf(0.32, H - 0.36, 0.44, 20, 40);
    p.shape("star4", { x: W - 2.05, y: 0.18, w: 0.2, h: 0.2 }, { fill: "accent2" });
  },
  dots(p) {
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        p.ellipse({ x: W - 0.5 - col * 0.15, y: 0.14 + row * 0.13, w: 0.055, h: 0.055 }, { fill: row === 0 && col < 2 ? "accent" : "faint" });
      }
    }
  },
  block(p) {
    p.rect({ x: W - 0.3, y: 0, w: 0.3, h: 1.2 }, { fill: "accent" });
    p.rect({ x: W - 0.3, y: 1.2, w: 0.3, h: 0.42 }, { fill: "accent3" });
  },
  sidebar(p) {
    p.rect({ x: 0, y: 0, w: 0.2, h: H }, { fill: "accent2" });
  },
  frame(p) {
    p.rect({ x: 0.2, y: 0.2, w: W - 0.4, h: H - 0.4 }, { line: "rule", lineWidth: 0.75 });
  },
  baseline(p) {
    p.rect({ x: 0, y: H - 0.09, w: W, h: 0.09 }, { fill: "accent2" });
    p.rect({ x: 0, y: H - 0.09, w: W * 0.22, h: 0.09 }, { fill: "accent" });
  },
  brackets(p) {
    const inset = 0.24;
    const len = 0.46;
    const corner = (x, y, dx, dy) => {
      p.line(x, y, x + dx * len, y, { color: "ink", width: 1.25 });
      p.line(x, y, x, y + dy * len, { color: "ink", width: 1.25 });
    };
    corner(inset, inset, 1, 1);
    corner(W - inset, inset, -1, 1);
    corner(inset, H - inset, 1, -1);
    corner(W - inset, H - inset, -1, -1);
  },
  tabs(p) {
    p.rect({ x: 0.3, y: -0.2, w: 0.3, h: 0.52 }, { fill: "accent3", radius: 0.12 });
    p.rect({ x: W - 0.6, y: -0.2, w: 0.3, h: 0.52 }, { fill: "accent3", radius: 0.12 });
  },
  ribbons(p) {
    p.shape("rtTriangle", { x: W - 1.15, y: 0, w: 1.15, h: 0.78 }, { fill: "accent2", rotate: 180 });
    p.shape("rtTriangle", { x: W - 1.6, y: 0, w: 0.45, h: 0.3 }, { fill: "accent3", rotate: 180 });
    p.shape("rtTriangle", { x: 0, y: H - 0.78, w: 1.15, h: 0.78 }, { fill: "accent2" });
    p.shape("rtTriangle", { x: 1.15, y: H - 0.3, w: 0.45, h: 0.3 }, { fill: "accent3" });
  },
  margin(p) {
    p.line(0.42, 0, 0.42, H, { color: "accent", width: 1.25 });
  },
  disc(p) {
    hatchedDisc(p, W - 0.55, H - 1.05, 0.26, p.color("accent"), 7);
  }
};

function drawMotifs(p) {
  if (p.hidden("decoration")) return;
  const corner = p.theme.chrome.corner;
  for (const name of Array.isArray(corner) ? corner : [corner]) MOTIFS[name]?.(p);
}

// ---------------------------------------------------------------------------------------------
// Chrome

function sectionIndex(deck, s) {
  return s.section ? deck.sections.indexOf(s.section) : -1;
}

function navRuns(p, deck, s, size) {
  const current = sectionIndex(deck, s);
  return deck.sections.map((name, index) => ({ name, current: index === current, size }));
}

function drawNav(p, deck, s, right, y, maxW) {
  if (p.theme.chrome.nav !== "text" || deck.sections.length < 2 || p.hidden("nav")) return 0;
  const size = 8.5;
  const face = p.face("label");
  const items = navRuns(p, deck, s, size);
  const sep = "  ·  ";
  const text = items.map((item) => item.name).join(sep);
  const width = textWidthPt(text, { face, size, bold: false }) / 72 + 0.3;
  if (width > maxW) return 0;
  const runs = [];
  items.forEach((item, index) => {
    runs.push({ text: item.name, options: item.current ? { bold: true, color: p.color("accent") } : { color: p.color("faint") } });
    if (index < items.length - 1) runs.push({ text: sep, options: { color: p.color("faint") } });
  });
  p.slide.addText(runs, { x: right - width, y, w: width, h: 0.22, fontFace: face, fontSize: size, align: "right", valign: "top", margin: 0, fit: "none" });
  return width;
}

function header(p, deck, s) {
  const chrome = p.theme.chrome;
  const eyebrow = p.hidden("eyebrow") ? "" : s.eyebrow || s.section || "";
  const subtitle = p.hidden("subtitle") ? "" : s.subtitle;
  let y = 0.42;

  if (chrome.titleBand) {
    const title = p.measure(s.title, CW, { role: "title", size: 22, min: 17, maxLines: 2 });
    const bandH = 0.36 + title.height + 0.3;
    p.rect({ x: 0, y: 0, w: W, h: bandH }, { fill: "accent2" });
    p.rect({ x: 0, y: bandH - 0.05, w: W, h: 0.05 }, { fill: "accent" });
    p.text(s.title, { x: MX, y: 0.36, w: CW }, { name: "Title", role: "title", size: 22, min: 17, maxLines: 2, color: p.role("title", "FFFFFF"), em: { color: "accent3" } });
    y = bandH + 0.16;
    const index = sectionIndex(deck, s);
    const label = eyebrow ? [index >= 0 ? pad2(index + 1) : "", eyebrow].filter(Boolean).join(" | ") : "";
    const navW = drawNav(p, deck, s, MX + CW, y + 0.02, CW * 0.5);
    if (label) p.text(label, { x: MX, y, w: CW - navW - 0.2 }, { name: "Eyebrow", role: "label", size: 10, bold: true, color: p.role("eyebrow", "accent"), maxLines: 1 });
    y += label || navW ? 0.3 : 0;
    if (subtitle) y += p.text(subtitle, { x: MX, y, w: CW }, { name: "Subtitle", size: 10.5, min: 9.5, color: p.role("subtitle", "muted"), maxLines: 2 }).height;
    return y + 0.26;
  }

  if (chrome.topBar === "ink" && !p.hidden("top_bar")) {
    p.rect({ x: MX, y: 0.3, w: CW * 0.7, h: 0.06 }, { fill: "ruleStrong" });
    y = 0.5;
  }
  if (chrome.topBar === "accent" && !p.hidden("top_bar")) {
    p.rect({ x: 0, y: 0.24, w: W, h: 0.035 }, { fill: "accent" });
    y = 0.44;
  }

  if (chrome.runningHeader && !p.hidden("running_header")) {
    // "course": kicker · section on the left, deck label on the right; "report": label left, date right.
    const course = chrome.runningHeader === "course";
    const left = course ? [deck.kicker, eyebrow].filter(Boolean).join(" · ") : deck.footer;
    const right = course ? deck.footer : (deck.date || deck.kicker || "");
    const rightW = right ? Math.min(CW * 0.4, textWidthPt(right, { face: p.face("label"), size: 8.5 }) / 72 + 0.2) : 0;
    if (left) p.text(left, { x: MX, y, w: CW - rightW - 0.3 }, { name: "Running header", role: "label", size: 8.5, caps: course, spacing: course ? 0.6 : 0, color: "muted", maxLines: 1 });
    if (right) p.text(right, { x: MX + CW - rightW, y, w: rightW }, { name: "Running header right", role: "label", size: 8.5, color: "muted", align: "right", maxLines: 1 });
    y += 0.5;
    if (!course && eyebrow) {
      y += p.text(eyebrow, { x: MX, y, w: CW }, { name: "Eyebrow", role: "label", size: 9, caps: true, spacing: 1.2, color: p.role("eyebrow", "accent"), maxLines: 1 }).height + 0.1;
    }
  } else {
    if (chrome.runningHeader && eyebrow) {
      y += p.text(eyebrow, { x: MX, y, w: CW }, { name: "Eyebrow", role: "label", size: 9, caps: true, spacing: 1.1, bold: true, color: p.role("eyebrow", chrome.eyebrowColor), maxLines: 1 }).height + 0.12;
    }
    const navW = chrome.runningHeader ? 0 : drawNav(p, deck, s, MX + CW, y + 0.01, CW * 0.55);
    if (eyebrow && !chrome.runningHeader) {
      y += p.text(eyebrow, { x: MX, y, w: CW - navW - 0.3 }, { name: "Eyebrow", role: "label", size: 9, caps: true, spacing: 1.1, bold: true, color: p.role("eyebrow", chrome.eyebrowColor), maxLines: 1 }).height + 0.12;
    } else if (navW) {
      y += 0.3;
    }
  }

  const emphasis = chrome.emphasis === "bold" ? { bold: true, color: "ink" } : { bold: p.theme.fonts.titleBold, color: "accent" };
  const titleFit = p.text(s.title, { x: MX, y, w: CW }, { name: "Title", role: "title", size: 24, min: 18, maxLines: 2, color: p.role("title", "ink"), em: emphasis });
  y += titleFit.height + 0.08;
  if (subtitle) y += p.text(subtitle, { x: MX, y, w: CW }, { name: "Subtitle", size: 11, min: 9.5, color: p.role("subtitle", "muted"), maxLines: 2 }).height;
  if (chrome.headerRule && !p.hidden("header_rule")) {
    y += 0.14;
    p.line(MX, y, MX + CW, y, { color: "ruleStrong", width: 1 });
  }
  return y + 0.3;
}

function footer(p, deck, s, index, total) {
  const chrome = p.theme.chrome;
  const y = 7.02;
  if (p.hidden("footer")) return H - 0.4;
  const muted = p.role("footer", "muted");
  const page = p.hidden("page_number") ? "" : `${pad2(index + 1)} / ${pad2(total)}`;
  const pageW = page ? textWidthPt(page, { face: p.face("label"), size: 8 }) / 72 + 0.1 : 0;
  const source = p.hidden("source") ? "" : s.source || deck.source;
  const label = p.hidden("footer_label") ? "" : deck.footer;
  if (!page && !source && !label) return H - 0.4;
  if (chrome.footerRule) p.line(MX, y - 0.1, MX + CW, y - 0.1, { color: "rule", width: 0.5 });
  const labelW = label ? Math.min(3.2, textWidthPt(label, { face: p.face("label"), size: 8 }) / 72 + 0.1) : 0;
  if (page) p.text(page, { x: MX + CW - pageW, y, w: pageW }, { name: "Page number", role: "label", size: 8, color: muted, align: "right", maxLines: 1 });
  if (source) {
    p.text(`Source: ${plain(source).replace(/^sources?:\s*/i, "")}`, { x: MX, y, w: CW - pageW - labelW - 0.5 }, { name: "Source", role: "label", size: 8, min: 7, color: muted, maxLines: 2, lineHeight: 1.15 });
    if (label) p.text(label, { x: MX + CW - pageW - labelW - 0.25, y, w: labelW }, { name: "Footer label", role: "label", size: 8, min: 7, color: p.role("footer", "faint"), align: "right", maxLines: 1 });
  } else if (label) {
    p.text(label, { x: MX, y, w: CW - pageW - 0.4 }, { name: "Footer label", role: "label", size: 8, color: muted, maxLines: 1 });
  }
  return y - 0.2;
}

function takeaway(p, s, bottom) {
  if (!s.takeaway || p.hidden("takeaway")) return bottom;
  const style = p.theme.chrome.takeaway;
  const defaults = { "rule-label": "Takeaway", band: "So what", bar: "", block: "", panel: "Key takeaway" };
  const label = s.takeawayLabel || defaults[style] || "";
  const text = label ? `**${label}:** ${s.takeaway}` : s.takeaway;
  const inset = style === "band" || style === "panel" || style === "block" ? 0.22 : style === "bar" ? 0.22 : 0;
  const textW = CW - inset * 2;
  const size = 11.5;
  const fit = p.measure(text, textW, { size, min: 10, maxLines: 3 });
  const padY = style === "rule-label" ? 0.14 : 0.13;
  const h = fit.height + padY * 2;
  const y = bottom - h;
  const onDark = style === "block";
  const fill = p.role("takeawayFill", style === "block" ? "ink" : "surface");
  if (style === "rule-label") p.line(MX, y, MX + CW, y, { color: "ruleStrong", width: 0.75 });
  if (style === "band") p.rect({ x: MX, y, w: CW, h }, { fill, name: "Takeaway background" });
  if (style === "panel") {
    p.rect({ x: MX, y, w: CW, h }, { fill, name: "Takeaway background" });
    p.rect({ x: MX, y, w: 0.06, h }, { fill: "accent" });
  }
  if (style === "block") p.rect({ x: MX, y, w: CW, h }, { fill, name: "Takeaway background" });
  if (style === "bar") p.rect({ x: MX, y: y + 0.06, w: 0.05, h: h - 0.12 }, { fill: "accent" });
  p.text(text, { x: MX + inset, y: y + padY, w: textW }, {
    name: "Takeaway",
    size,
    min: 10,
    maxLines: 3,
    color: p.role("takeaway", onDark ? "bg" : "body"),
    em: { bold: true, color: onDark ? "bg" : style === "panel" ? "accent" : "ink" }
  });
  return y - 0.26;
}

function frame(p, deck, s, index, total) {
  background(p, s);
  const top = header(p, deck, s);
  const footerTop = footer(p, deck, s, index, total);
  const bottom = takeaway(p, s, footerTop);
  return { x: MX, y: top, w: CW, h: Math.max(1.2, bottom - top) };
}

// ---------------------------------------------------------------------------------------------
// Exhibit header above a chart or table: "Exhibit 01 | Title" in the theme's voice.

function exhibitHeader(p, ctx, box, title, unit) {
  if (!title && !unit) return 0;
  ctx.exhibit += 1;
  const label = p.theme.chrome.exhibitLabel;
  const text = [plain(title), unit && !plain(title).includes(unit) ? `(${unit})` : ""].filter(Boolean).join(" ");
  if (label === "Fig.") {
    const tag = `Fig. ${ctx.exhibit}`;
    const tagW = textWidthPt(tag, { face: p.face("label"), size: 8.5 }) / 72 + 0.18;
    p.text(tag, { x: box.x, y: box.y + 0.03, w: tagW }, { role: "label", size: 8.5, color: "muted", maxLines: 1 });
    return p.text(text, { x: box.x + tagW, y: box.y, w: box.w - tagW }, { role: "title", size: 12, min: 10, color: "ink", maxLines: 2, bold: false }).height + 0.12;
  }
  if (label === "Exhibit") {
    return p.text(`EXHIBIT ${pad2(ctx.exhibit)} | ${text}`, { x: box.x, y: box.y, w: box.w }, { role: "label", size: 9, min: 8, bold: true, spacing: 0.4, color: "accent2", maxLines: 2 }).height + 0.12;
  }
  return p.text(text, { x: box.x, y: box.y, w: box.w }, { size: 11, min: 9.5, bold: true, color: "ink", maxLines: 2 }).height + 0.12;
}

function chartBlock(p, ctx, box, chart) {
  const head = exhibitHeader(p, ctx, box, chart.title, chart.unit);
  const note = chart.note ? p.measure(chart.note, box.w, { size: 8.5, min: 7.5, maxLines: 2 }) : null;
  const noteH = note ? note.height + 0.1 : 0;
  const area = { x: box.x, y: box.y + head, w: box.w, h: box.h - head - noteH };
  drawChart(p, area, chart);
  if (note) p.text(chart.note, { x: box.x, y: box.y + box.h - note.height, w: box.w }, { size: 8.5, min: 7.5, color: "muted", maxLines: 2 });
}

function divider(p, x, y, h) {
  p.line(x, y, x, y + h, { color: "rule", width: 0.75 });
}

function rail(p, box, s, { numbered = true } = {}) {
  if (s.kpis?.length) return kpiStack(p, box, s.kpis, { size: 28 });
  if (s.insights?.length) {
    return rows(p, box, s.insights, { numbered, numberStyle: "accent", titleSize: 12, bodySize: 10.5, divider: true, maxGap: 0.3 });
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Content layouts

const LAYOUTS = {
  summary(p, s, box) {
    const hasRail = s.kpis.length > 0;
    const mainW = hasRail ? box.w * 0.65 : box.w;
    rows(p, { x: box.x, y: box.y, w: mainW, h: box.h }, s.findings, { numbered: true, numberStyle: p.theme.chrome.numberStyle || "muted", titleSize: 13.5, bodySize: 11, maxGap: 0.4 });
    if (hasRail) {
      divider(p, box.x + mainW + 0.32, box.y, box.h);
      kpiStack(p, { x: box.x + mainW + 0.62, y: box.y, w: box.w - mainW - 0.62, h: box.h }, s.kpis, { size: 32 });
    }
  },

  chart(p, s, box, ctx) {
    const hasRail = s.kpis.length > 0 || s.insights.length > 0;
    const mainW = hasRail ? box.w * 0.63 : box.w;
    const charts = s.charts;
    if (charts.length === 2 && !hasRail) {
      const w = (box.w - 0.5) / 2;
      chartBlock(p, ctx, { x: box.x, y: box.y, w, h: box.h }, charts[0]);
      divider(p, box.x + w + 0.25, box.y, box.h);
      chartBlock(p, ctx, { x: box.x + w + 0.5, y: box.y, w, h: box.h }, charts[1]);
    } else if (charts.length === 2) {
      const h = (box.h - 0.3) / 2;
      chartBlock(p, ctx, { x: box.x, y: box.y, w: mainW, h }, charts[0]);
      chartBlock(p, ctx, { x: box.x, y: box.y + h + 0.3, w: mainW, h }, charts[1]);
    } else {
      chartBlock(p, ctx, { x: box.x, y: box.y, w: mainW, h: box.h }, charts[0]);
    }
    if (hasRail) {
      divider(p, box.x + mainW + 0.3, box.y, box.h);
      rail(p, { x: box.x + mainW + 0.6, y: box.y, w: box.w - mainW - 0.6, h: box.h }, s);
    }
  },

  table(p, s, box, ctx) {
    const hasRail = s.kpis.length > 0 || s.insights.length > 0;
    const mainW = hasRail ? box.w * 0.7 : box.w;
    const head = exhibitHeader(p, ctx, { x: box.x, y: box.y, w: mainW }, s.table.title, "");
    const note = s.table.note ? p.measure(s.table.note, mainW, { size: 8.5, maxLines: 2 }) : null;
    const used = drawTable(p, { x: box.x, y: box.y + head, w: mainW, h: box.h - head - (note ? note.height + 0.12 : 0) }, s.table);
    if (note) p.text(s.table.note, { x: box.x, y: box.y + head + used + 0.1, w: mainW }, { size: 8.5, color: "muted", maxLines: 2 });
    if (hasRail) {
      divider(p, box.x + mainW + 0.28, box.y, box.h);
      rail(p, { x: box.x + mainW + 0.56, y: box.y, w: box.w - mainW - 0.56, h: box.h }, s, { numbered: false });
    }
  },

  kpis(p, s, box) {
    let y = box.y;
    if (s.body) y += p.text(s.body, { x: box.x, y, w: box.w * 0.82 }, { size: 14, min: 11, color: "body", maxLines: 3 }).height + 0.3;
    const list = s.kpis;
    const cols = list.length <= 4 ? list.length : 3;
    const rowCount = Math.ceil(list.length / cols);
    const gapX = 0.4;
    const gapY = 0.4;
    const w = (box.w - gapX * (cols - 1)) / cols;
    const avail = box.y + box.h - y;
    const cellMax = (avail - gapY * (rowCount - 1)) / rowCount;
    // Largest type scale whose tallest cell fits; sparse walls grow instead of floating at the top.
    let plan;
    for (const scale of [1.5, 1.4, 1.3, 1.2, 1.1, 1, 0.9, 0.8]) {
      const sizes = { value: (cols >= 4 ? 34 : 42) * scale, label: Math.min(12 * scale, 16), note: Math.min(10 * scale, 13) };
      const cellH = Math.max(...list.map((item) => {
        const value = measureKpi(p, { ...item, label: "", note: "" }, w, { size: sizes.value }).height;
        const label = item.label ? p.measure(item.label, w, { size: sizes.label, bold: true, maxLines: 2 }).height + 0.08 : 0;
        const note = item.note ? p.measure(item.note, w, { size: sizes.note, maxLines: 4 }).height + 0.1 : 0;
        return 0.24 + value + 0.12 + label + note + (item.delta ? 0.34 : 0);
      }));
      plan = { sizes, cellH };
      if (cellH <= cellMax * (scale > 1 ? 0.78 : 1)) break;
    }
    const blockH = plan.cellH * rowCount + gapY * (rowCount - 1);
    const top = y + Math.max(0, (avail - blockH) * 0.4);
    // Values, labels and notes line up across each row.
    const rowValueH = [];
    const rowLabelH = [];
    list.forEach((item, index) => {
      const row = Math.floor(index / cols);
      rowValueH[row] = Math.max(rowValueH[row] || 0, measureKpi(p, { ...item, label: "", note: "" }, w, { size: plan.sizes.value }).height);
      rowLabelH[row] = Math.max(rowLabelH[row] || 0, item.label ? p.measure(item.label, w, { size: plan.sizes.label, bold: true, maxLines: 2 }).height : 0);
    });
    list.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = box.x + col * (w + gapX);
      const cellTop = top + row * (plan.cellH + gapY);
      p.line(x, cellTop, x + w, cellTop, { color: index === 0 ? "accent" : "ruleStrong", width: index === 0 ? 2.5 : 1 });
      let cy = cellTop + 0.24;
      drawKpi(p, { ...item, note: "", label: "" }, { x, y: cy, w }, { size: plan.sizes.value, color: index === 0 ? "accent" : "ink" });
      cy += rowValueH[row] + 0.12;
      if (item.label) p.text(item.label, { x, y: cy, w }, { size: plan.sizes.label, min: 10, bold: true, color: "ink", maxLines: 2 });
      cy += rowLabelH[row] + (rowLabelH[row] ? 0.08 : 0);
      if (item.note) cy += p.text(item.note, { x, y: cy, w }, { size: plan.sizes.note, min: 9, color: "muted", maxLines: 4 }).height + 0.1;
      if (item.delta) {
        const tone = statusTone(item.status || item.delta);
        chip(p, item.delta, x, cy, { size: Math.min(plan.sizes.note - 0.5, 11), fill: tone || (p.theme.dark ? "surfaceStrong" : "surface"), color: tone ? "onAccent" : "ink" });
      }
    });
  },

  comparison(p, s, box) {
    const columns = s.columns;
    // Key/value lists only when every point on the slide is a short "Label: value" pair, so all
    // columns read the same way.
    const pairOf = (point) => {
      const match = point.match(/^([^:]{2,40}):\s+(.+)$/);
      const value = match ? plain(match[2]) : "";
      return match && (value.length <= 14 || (/\d/.test(value) && value.length <= 28)) ? { key: match[1], value: match[2] } : null;
    };
    const usePairs = columns.every((column) => column.points.length && column.points.every((point) => pairOf(point)));
    const gap = 0.35;
    const w = (box.w - gap * (columns.length - 1)) / columns.length;
    columns.forEach((column, index) => {
      const x = box.x + index * (w + gap);
      const focus = column.highlight;
      if (focus) p.rect({ x: x - 0.14, y: box.y - 0.12, w: w + 0.28, h: box.h + 0.24 }, { fill: "surface" });
      let y = box.y;
      const tagW = column.tag ? Math.min(w * 0.45, textWidthPt(column.tag, { face: p.face("label"), size: 8.5, bold: true }) / 72 + 0.24) : 0;
      const titleFit = p.text(column.title, { x, y, w: w - tagW - 0.1 }, { size: 16, min: 12, bold: true, color: focus ? "accent" : "ink", maxLines: 2 });
      if (column.tag) chip(p, column.tag, x + w - tagW, y + 0.02, { size: 8.5, fill: focus ? "accent" : p.theme.dark ? "surfaceStrong" : "surfaceStrong", color: focus ? "onAccent" : "ink" });
      y += titleFit.height + 0.12;
      p.line(x, y, x + w, y, { color: focus ? "accent" : "ruleStrong", width: focus ? 2.5 : 1 });
      y += 0.2;
      if (column.metric) {
        y += drawKpi(p, column.metric, { x, y, w }, { size: 34, color: focus ? "accent" : "ink" }).height + 0.22;
      }
      if (column.status) {
        y += statusLabel(p, column.status, { x, y, w }, { size: 10 }).height + 0.12;
      }
      // "Label: short value" points read as a key/value list; longer points stay as notes.
      const pairs = [];
      const notes = [];
      column.points.forEach((point) => {
        const pair = usePairs ? pairOf(point) : null;
        const match = point.match(/^([^:]{2,40}):\s+(.+)$/);
        if (pair) pairs.push(pair);
        else notes.push(match ? { title: match[1], body: match[2] } : { title: "", body: point });
      });
      const rowH = 0.4;
      pairs.forEach((pair) => {
        p.text(pair.key, { x, y: y + 0.09, w: w * 0.55 }, { size: 11, min: 9.5, color: "muted", maxLines: 1 });
        p.text(pair.value, { x: x + w * 0.45, y: y + 0.08, w: w * 0.55 }, { size: 12, min: 10, bold: true, color: "ink", align: "right", maxLines: 1 });
        y += rowH;
        p.line(x, y, x + w, y, { color: "rule", width: 0.5 });
      });
      if (notes.length) rows(p, { x, y, w, h: box.y + box.h - y }, notes, { marker: true, titleSize: 12, bodySize: 11, divider: false, maxGap: 0.16, labelColor: "accent" });
    });
  },

  timeline(p, s, box) {
    const list = s.items;
    const n = list.length;
    const gap = 0.22;
    const colW = (box.w - gap * (n - 1)) / n;
    const pad = 0.22;
    const textW = colW - pad * 2;
    let plan;
    for (const scale of [1.35, 1.25, 1.15, 1.05, 1, 0.92, 0.84]) {
      const sizes = { date: Math.min(13 * scale, 18), title: Math.min(13.5 * scale, 18), body: Math.min(10.5 * scale, 13.5) };
      const itemH = Math.max(...list.map((entry) => {
        const title = entry.title ? p.measure(entry.title, textW, { size: sizes.title, bold: true, maxLines: 3 }).height + 0.1 : 0;
        const body = entry.body ? p.measure(entry.body, textW, { size: sizes.body, maxLines: 8 }).height + 0.16 : 0;
        return title + body + (entry.tag ? 0.42 : 0);
      }));
      const dateH = sizes.date * 1.3 / 72;
      const total = dateH + 0.26 + 0.34 + itemH + pad * 2;
      plan = { sizes, total, dateH, itemH };
      if (total <= box.h * (scale > 1 ? 0.8 : 1)) break;
    }
    const top = box.y;
    const axisY = top + plan.dateH + 0.26;
    p.line(box.x, axisY, box.x + box.w, axisY, { color: "ruleStrong", width: 1.25 });
    const cardTop = axisY + 0.32;
    const cardH = Math.min(box.y + box.h - cardTop, Math.max(plan.itemH + pad * 2 + 0.2, (box.y + box.h - cardTop) * 0.8));
    const style = p.theme.chrome.cardStyle;
    list.forEach((entry, index) => {
      const x = box.x + index * (colW + gap);
      const cx = x + pad;
      const focus = entry.highlight;
      const d = focus ? 0.26 : 0.2;
      if (entry.date) p.text(entry.date, { x, y: top, w: colW - 0.1 }, { role: "title", size: plan.sizes.date, min: 10, bold: true, color: focus ? "accent" : "ink", maxLines: 1 });
      p.ellipse({ x: cx - d / 2, y: axisY - d / 2, w: d, h: d }, { fill: focus ? "accent" : "bg", line: focus ? "accent" : "ruleStrong", lineWidth: 1.5 });
      p.line(cx, axisY + d / 2, cx, cardTop, { color: focus ? "accent" : "rule", width: 0.75 });
      if (style === "rule") p.line(x, cardTop, x + colW, cardTop, { color: focus ? "accent" : "ruleStrong", width: 1.5 });
      else p.rect({ x, y: cardTop, w: colW, h: cardH }, { fill: focus && style === "block" ? "accent" : "surface", line: style === "outline" ? (focus ? "accent" : "rule") : focus ? "accent" : undefined, lineWidth: focus ? 1.25 : 0.75, radius: style === "soft" ? 0.07 : 0 });
      const onAccent = focus && style === "block";
      let y = cardTop + pad;
      if (entry.title) y += p.text(entry.title, { x: cx, y, w: textW }, { size: plan.sizes.title, min: 10.5, bold: true, color: onAccent ? "onAccent" : "ink", maxLines: 3 }).height + 0.1;
      const tagH = entry.tag ? 0.45 : 0;
      if (entry.body) p.text(entry.body, { x: cx, y, w: textW, h: cardTop + cardH - y - tagH - pad }, { size: plan.sizes.body, min: 9, color: onAccent ? "onAccent" : "body", maxLines: 8 });
      if (entry.tag) chip(p, entry.tag, cx, style === "rule" ? Math.min(y + (entry.body ? p.measure(entry.body, textW, { size: plan.sizes.body, maxLines: 8 }).height + 0.18 : 0), cardTop + cardH - pad - 0.28) : cardTop + cardH - pad - 0.28, { size: Math.min(plan.sizes.body - 1.5, 10), fill: onAccent ? "bg" : focus ? "accent" : p.theme.dark ? "surfaceStrong" : "bg", color: onAccent ? "accent" : focus ? "onAccent" : "ink", maxW: textW });
    });
  },

  process(p, s, box) {
    const steps = s.steps;
    const n = steps.length;
    const arrowW = 0.42;
    const w = (box.w - arrowW * (n - 1)) / n;
    const noteFit = s.note ? p.measure(s.note, box.w, { size: 10, maxLines: 2 }) : null;
    const available = box.h - (noteFit ? noteFit.height + 0.25 : 0);
    const inner = w - 0.4;
    let sizes;
    let contentH;
    for (const scale of [1.35, 1.25, 1.15, 1.05, 1, 0.92, 0.85]) {
      sizes = { title: Math.min(13 * scale, 17), body: Math.min(10.5 * scale, 13.5), metric: Math.min(11.5 * scale, 14) };
      contentH = Math.max(...steps.map((step) => {
        const title = p.measure(step.title, inner, { size: sizes.title, bold: true, maxLines: 3 });
        const body = step.body ? p.measure(step.body, inner, { size: sizes.body, maxLines: 8 }) : { height: 0 };
        return 0.2 + 0.42 + 0.16 + title.height + 0.1 + body.height + (step.metric ? 0.5 : 0) + 0.24;
      }));
      if (contentH <= available * (scale > 1 ? 0.8 : 1)) break;
    }
    const h = Math.min(available, Math.max(contentH, available * 0.72));
    const style = p.theme.chrome.cardStyle;
    steps.forEach((step, index) => {
      const x = box.x + index * (w + arrowW);
      const y = box.y;
      if (style === "block") p.rect({ x, y, w, h }, { fill: index === n - 1 ? "accent" : "surface" });
      else if (style === "outline") p.rect({ x, y, w, h }, { fill: "surface", line: "rule", lineWidth: 0.75 });
      else if (style === "rule") { p.rect({ x, y, w, h }, { fill: "surface" }); p.rect({ x, y, w, h: 0.05 }, { fill: "ruleStrong" }); }
      else p.rect({ x, y, w, h }, { fill: "surface", radius: style === "soft" ? 0.08 : 0 });
      const onAccent = style === "block" && index === n - 1;
      const badge = 0.42;
      p.ellipse({ x: x + 0.2, y: y + 0.2, w: badge, h: badge }, { fill: onAccent ? "bg" : "accent" });
      p.text(pad2(index + 1), { x: x + 0.2, y: y + 0.2 + (badge - 0.2) / 2, w: badge }, { role: "label", size: 11, bold: true, color: onAccent ? "accent" : "onAccent", align: "center", maxLines: 1 });
      let ty = y + 0.2 + badge + 0.16;
      ty += p.text(step.title, { x: x + 0.2, y: ty, w: inner }, { size: sizes.title, min: 11, bold: true, color: onAccent ? "onAccent" : "ink", maxLines: 3 }).height + 0.1;
      if (step.body) p.text(step.body, { x: x + 0.2, y: ty, w: inner, h: y + h - ty - (step.metric ? 0.55 : 0.2) }, { size: sizes.body, min: 9, color: onAccent ? "onAccent" : "body", maxLines: 8 });
      if (step.metric) {
        p.line(x + 0.2, y + h - 0.58, x + w - 0.2, y + h - 0.58, { color: onAccent ? "bg" : "rule", width: 0.5 });
        p.text(step.metric, { x: x + 0.2, y: y + h - 0.46, w: inner, h: 0.4 }, { size: sizes.metric, min: 8.5, bold: true, color: onAccent ? "onAccent" : "accent", maxLines: 2, lineHeight: 1.1 });
      }
      if (index < n - 1) {
        const ax = x + w + 0.08;
        p.shape("rightArrow", { x: ax, y: y + h / 2 - 0.13, w: arrowW - 0.16, h: 0.26 }, { fill: "accent" });
      }
    });
    if (noteFit) p.text(s.note, { x: box.x, y: box.y + h + 0.25, w: box.w }, { size: 10, color: "muted", maxLines: 2 });
  },

  cards(p, s, box) {
    const cards = s.cards;
    const n = cards.length;
    const cols = n <= 3 ? n : n === 4 ? (cards.every((card) => plain(card.body).length < 130) ? 4 : 2) : 3;
    const rowCount = Math.ceil(n / cols);
    const gap = 0.24;
    const w = (box.w - gap * (cols - 1)) / cols;
    const h = (box.h - gap * (rowCount - 1)) / rowCount;
    const style = p.theme.chrome.cardStyle;
    const blockFills = ["accent", "accent2", "ink", "accent"];
    const padX = style === "rule" ? 0 : 0.26;
    const inner = w - padX * 2;
    const serif = p.theme.chrome.serifCards;
    let plan;
    for (const scale of [1.45, 1.35, 1.25, 1.15, 1.05, 1, 0.92, 0.85, 0.78, 0.72]) {
      const sizes = { metric: (style === "block" ? 40 : 32) * scale, kicker: Math.min(8.5 * scale, 11), title: Math.min(14.5 * scale, 19), body: Math.min(10.5 * scale, 13.5) };
      const contentH = Math.max(...cards.map((card) => {
        let height = style === "rule" ? 0.22 : 0.26;
        if (card.metric) height += measureKpi(p, card.metric, inner, { size: sizes.metric }).height + 0.18;
        if (card.kicker && style !== "block") height += sizes.kicker * 1.3 / 72 + 0.1;
        if (card.title) height += p.measure(card.title, inner, { role: serif ? "title" : "body", size: sizes.title, bold: !serif, maxLines: 3 }).height + 0.1;
        if (card.body) height += p.measure(card.body, inner, { size: sizes.body, maxLines: 9 }).height;
        return height + (style === "block" && card.kicker ? 0.55 : 0.24);
      }));
      plan = { sizes, contentH };
      if (contentH <= h * (scale > 1 ? 0.82 : 1)) break;
    }
    // Bottom-anchored text blocks share one top edge per row so titles line up.
    const textHeights = cards.map((card) => {
      let textH = 0;
      if (card.kicker && style !== "block") textH += plan.sizes.kicker * 1.2 / 72 + 0.1;
      if (card.title) textH += p.measure(card.title, inner, { role: serif ? "title" : "body", size: plan.sizes.title, bold: !serif, maxLines: 3 }).height + 0.1;
      if (card.body) textH += p.measure(card.body, inner, { size: plan.sizes.body, maxLines: 9 }).height;
      return textH;
    });
    // One row of sparse cards would stretch into tall empty panels; cap it near its content.
    const cardH = rowCount === 1 ? Math.min(h, Math.max(plan.contentH + 1.4, 2.9)) : h;
    const rowTextH = [];
    textHeights.forEach((value, index) => {
      const row = Math.floor(index / cols);
      rowTextH[row] = Math.max(rowTextH[row] || 0, value);
    });
    cards.forEach((card, index) => {
      const h = cardH;
      const x = box.x + (index % cols) * (w + gap);
      const y = box.y + Math.floor(index / cols) * (h + gap);
      let text = "ink";
      let muted = "body";
      let accent = "accent";
      if (style === "block") {
        p.rect({ x, y, w, h }, { fill: blockFills[index % blockFills.length] });
        text = "FFFFFF";
        muted = "FFFFFF";
        accent = "FFFFFF";
      } else if (style === "outline") {
        p.rect({ x, y, w, h }, { fill: "surface", line: "rule" });
      } else if (style === "rule") {
        p.line(x, y, x + w, y, { color: index === 0 ? "accent" : "ruleStrong", width: 1.75 });
      } else if (style === "top") {
        p.rect({ x, y, w, h }, { fill: "FFFFFF" });
        p.rect({ x, y, w, h: 0.06 }, { fill: index === 0 ? "accent" : "accent2" });
      } else {
        p.rect({ x, y, w, h }, { fill: "surface", radius: style === "soft" ? 0.07 : 0 });
      }
      let cy = y + (style === "rule" ? 0.22 : 0.26);
      // Tall filled cards: metric (or a big index) holds the top, the text block sits at the bottom.
      const anchorBottom = style !== "rule" && h - plan.contentH > 0.9;
      if (anchorBottom && !card.metric) {
        p.text(pad2(index + 1), { x: x + padX, y: cy, w: inner }, { role: "number", size: Math.min(44, h * 9), color: style === "block" ? "FFFFFF" : "accent", maxLines: 1, lineHeight: 1 });
      }
      if (anchorBottom) {
        const textH = rowTextH[Math.floor(index / cols)];
        const bottomPadA = style === "block" && card.kicker ? 0.62 : 0.3;
        if (card.metric) {
          drawKpi(p, card.metric, { x: x + padX, y: cy, w: inner }, { size: plan.sizes.metric, labelSize: Math.min(10 * plan.sizes.body / 10.5, 12.5), color: style === "block" ? "FFFFFF" : "accent", labelColor: muted, noteColor: muted, unitColor: style === "block" ? "FFFFFF" : "muted" });
        }
        cy = y + h - bottomPadA - textH;
        if (card.kicker && style !== "block") cy += p.text(card.kicker, { x: x + padX, y: cy, w: inner }, { role: "label", size: plan.sizes.kicker, caps: true, spacing: 0.8, bold: true, color: accent, maxLines: 1 }).height + 0.1;
        if (card.title) cy += p.text(card.title, { x: x + padX, y: cy, w: inner }, { role: serif ? "title" : "body", size: plan.sizes.title, min: 11.5, bold: !serif, color: text, maxLines: 3 }).height + 0.1;
        if (card.body) p.text(card.body, { x: x + padX, y: cy, w: inner }, { size: plan.sizes.body, min: 9, color: muted, maxLines: 9 });
        if (card.kicker && style === "block") p.text(card.kicker, { x: x + padX, y: y + h - 0.42, w: inner }, { role: "label", size: 9.5, caps: true, spacing: 1.5, color: "FFFFFF", maxLines: 1 });
        return;
      }
      if (card.metric) {
        cy += drawKpi(p, card.metric, { x: x + padX, y: cy, w: inner }, { size: plan.sizes.metric, labelSize: Math.min(10 * plan.sizes.body / 10.5, 12.5), color: style === "block" ? "FFFFFF" : "accent", labelColor: muted, noteColor: muted, unitColor: style === "block" ? "FFFFFF" : "muted" }).height + 0.18;
      }
      if (card.kicker && style !== "block") cy += p.text(card.kicker, { x: x + padX, y: cy, w: inner }, { role: "label", size: plan.sizes.kicker, caps: true, spacing: 0.8, bold: true, color: accent, maxLines: 1 }).height + 0.1;
      if (card.title) cy += p.text(card.title, { x: x + padX, y: cy, w: inner }, { role: serif ? "title" : "body", size: plan.sizes.title, min: 11.5, bold: !serif, color: text, maxLines: 3 }).height + 0.1;
      const bottomPad = style === "block" && card.kicker ? 0.55 : 0.2;
      if (card.body) p.text(card.body, { x: x + padX, y: cy, w: inner, h: y + h - cy - bottomPad }, { size: plan.sizes.body, min: 9, color: muted, maxLines: 9 });
      if (card.kicker && style === "block") p.text(card.kicker, { x: x + padX, y: y + h - 0.42, w: inner }, { role: "label", size: 9.5, caps: true, spacing: 1.5, color: "FFFFFF", maxLines: 1 });
    });
  },

  statement(p, s, box) {
    const hasPoints = s.points.length > 0;
    const w = hasPoints ? box.w * 0.58 : box.w * 0.82;
    // A quotation mark only for real quotes; otherwise a short accent rule opens the statement.
    let y = box.y + 0.15;
    if (s.attribution) {
      p.text("“", { x: box.x - 0.04, y: box.y, w: 1 }, { role: "title", size: 60, color: "accent", maxLines: 1, lineHeight: 1 });
      y = box.y + 0.75;
    } else {
      p.rect({ x: box.x, y, w: 0.8, h: 0.06 }, { fill: "accent" });
      y += 0.4;
    }
    const fit = p.text(s.statement, { x: box.x, y, w, h: box.h - 1.2 }, { role: "title", size: 30, min: 18, color: "ink", maxLines: 7, lineHeight: 1.18, em: { color: "accent", bold: p.theme.fonts.titleBold } });
    y += fit.height + 0.25;
    if (s.attribution) p.text(`— ${plain(s.attribution).replace(/^[—-]\s*/, "")}`, { x: box.x, y, w }, { size: 12, color: "muted", maxLines: 2 });
    if (hasPoints) {
      const x = box.x + box.w * 0.64;
      divider(p, x - 0.3, box.y, box.h);
      rows(p, { x, y: box.y, w: box.w * 0.36, h: box.h }, s.points, { titleSize: 12.5, bodySize: 10.5, divider: true, maxGap: 0.4 });
    }
  },

  bignumber(p, s, box) {
    const leftW = box.w * 0.46;
    const face = p.face("number");
    let size = 120;
    while (size > 48 && textWidthPt(s.value, { face, size, bold: p.theme.fonts.numberBold }) / 72 + (s.unit ? textWidthPt(s.unit, { face, size: size * 0.35 }) / 72 + 0.1 : 0) > leftW) size -= 4;
    const valueH = size * 1.0 / 72;
    let y = box.y + Math.max(0, (box.h - valueH - 1.6) / 2 - 0.2);
    drawKpi(p, { value: s.value, unit: s.unit }, { x: box.x, y, w: leftW }, { size, color: "accent" });
    y += valueH + 0.12;
    if (s.label) y += p.text(s.label, { x: box.x, y, w: leftW }, { size: 15, min: 12, bold: true, color: "ink", maxLines: 2 }).height + 0.1;
    if (s.body) p.text(s.body, { x: box.x, y, w: leftW, h: box.y + box.h - y }, { size: 11.5, min: 10, color: "body", maxLines: 6 });
    const x = box.x + leftW + 0.6;
    const rw = box.w - leftW - 0.6;
    divider(p, x - 0.3, box.y, box.h);
    let ry = box.y;
    if (s.compare) {
      ry += drawKpi(p, s.compare, { x, y: ry, w: rw }, { size: 40, color: "ink", labelColor: "body" }).height + 0.3;
      if (s.points.length) p.line(x, ry - 0.15, x + rw, ry - 0.15, { color: "rule", width: 0.75 });
    }
    if (s.points.length) rows(p, { x, y: ry, w: rw, h: box.y + box.h - ry }, s.points, { titleSize: 12.5, bodySize: 10.5, divider: true, maxGap: 0.35 });
  },

  matrix(p, s, box) {
    const axisW = 0.42;
    const axisH = 0.4;
    const grid = { x: box.x + axisW, y: box.y, w: box.w - axisW, h: box.h - axisH };
    const gap = 0.1;
    const cw = (grid.w - gap) / 2;
    const ch = (grid.h - gap) / 2;
    // Quadrant order: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
    s.quadrants.forEach((quadrant, index) => {
      const x = grid.x + (index % 2) * (cw + gap);
      const y = grid.y + Math.floor(index / 2) * (ch + gap);
      const focus = index === s.highlight;
      p.rect({ x, y, w: cw, h: ch }, { fill: focus ? "surfaceStrong" : "surface", line: focus ? "accent" : undefined, lineWidth: 1.75 });
      let ty = y + 0.2;
      if (quadrant.title) ty += p.text(quadrant.title, { x: x + 0.22, y: ty, w: cw - 0.44 }, { size: 13, min: 11, bold: true, color: focus ? "accent" : "ink", maxLines: 2 }).height + 0.06;
      if (quadrant.body) ty += p.text(quadrant.body, { x: x + 0.22, y: ty, w: cw - 0.44, h: y + ch - ty - 0.15 }, { size: 10.5, min: 9, color: "body", maxLines: 4 }).height + 0.08;
      let cx = x + 0.22;
      for (const entry of quadrant.items) {
        const size = 9;
        const wChip = Math.min(cw - 0.44, textWidthPt(entry, { face: p.face("label"), size, bold: true }) / 72 + 0.22);
        if (cx + wChip > x + cw - 0.2) { cx = x + 0.22; ty += 0.32; }
        if (ty + 0.28 > y + ch - 0.08) break;
        chip(p, entry, cx, ty, { size, fill: focus ? "accent" : p.theme.dark ? "surfaceStrong" : "bg", color: focus ? "onAccent" : "ink" });
        cx += wChip + 0.08;
      }
    });
    const xa = s.xAxis;
    const ya = s.yAxis;
    const bottom = grid.y + grid.h + 0.1;
    if (xa.low) p.text(xa.low, { x: grid.x, y: bottom, w: 2.5 }, { size: 9, color: "muted", maxLines: 1 });
    if (xa.label) p.text(`${xa.label} →`, { x: grid.x + grid.w / 2 - 2, y: bottom, w: 4 }, { size: 9.5, bold: true, color: "ink", align: "center", maxLines: 1 });
    if (xa.high) p.text(xa.high, { x: grid.x + grid.w - 2.5, y: bottom, w: 2.5 }, { size: 9, color: "muted", align: "right", maxLines: 1 });
    if (ya.label || ya.low || ya.high) {
      const label = [ya.low, ya.label ? `${ya.label} →` : "", ya.high].filter(Boolean).join("      ");
      p.text(label, { x: box.x - grid.h / 2 + 0.12, y: grid.y + grid.h / 2 - 0.12, w: grid.h }, { size: 9.5, bold: true, color: "ink", align: "center", maxLines: 1, rotate: 270 });
    }
  },

  decision(p, s, box) {
    const hasRail = Boolean(s.rail && s.rail.items.length);
    const mainW = hasRail ? box.w * 0.66 : box.w;
    const metaW = s.items.some((item) => item.owner || item.due || item.status) ? Math.min(2.4, mainW * 0.28) : 0;
    const list = s.items.map((item) => ({ title: item.title, body: item.body, meta: [item.owner, item.due].filter(Boolean).join("\n"), status: item.status }));
    rows(p, { x: box.x, y: box.y, w: mainW, h: box.h }, list, { numbered: true, numberStyle: "accent", titleSize: 13.5, bodySize: 11, metaW, maxGap: 0.4 });
    if (hasRail) {
      const x = box.x + mainW + 0.6;
      const w = box.w - mainW - 0.6;
      divider(p, x - 0.3, box.y, box.h);
      let y = box.y;
      if (s.rail.title) y += p.text(s.rail.title, { x, y, w }, { role: p.theme.chrome.serifCards ? "title" : "body", size: 15, bold: !p.theme.chrome.serifCards, color: "ink", maxLines: 2 }).height + 0.15;
      rows(p, { x, y, w, h: box.y + box.h - y }, s.rail.items, { titleSize: 12, bodySize: 10, divider: true, maxGap: 0.3, titleColor: "ink" });
    }
  },

  agenda(p, s, box) {
    rows(p, box, s.items, { numbered: true, numberStyle: "accent", titleSize: 17, bodySize: 11.5, metaW: s.items.some((item) => item.meta) ? 1.6 : 0, maxGap: 0.5 });
  },

  bullets(p, s, box, ctx) {
    const points = s.points;
    if (points.length >= 2 && points.length <= 4 && points.every((point) => point.title && point.body)) {
      return LAYOUTS.cards(p, { ...s, cards: points.map((point) => ({ kicker: point.label, title: point.title, body: point.body, metric: null })) }, box, ctx);
    }
    if (points.length <= 5) {
      rows(p, { x: box.x, y: box.y, w: box.w * 0.86, h: box.h }, points, { marker: true, titleSize: 14, bodySize: 12, divider: true, maxGap: 0.45 });
      return;
    }
    const half = Math.ceil(points.length / 2);
    const w = (box.w - 0.6) / 2;
    rows(p, { x: box.x, y: box.y, w, h: box.h }, points.slice(0, half), { marker: true, titleSize: 13, bodySize: 11, divider: true });
    rows(p, { x: box.x + w + 0.6, y: box.y, w, h: box.h }, points.slice(half), { marker: true, titleSize: 13, bodySize: 11, divider: true });
  }
};

// ---------------------------------------------------------------------------------------------
// Section divider

function section(p, deck, s, index, total) {
  const style = p.theme.chrome.sectionStyle;
  if (style === "light" || style === "split") return SECTIONS[style](p, deck, s, index, total);
  const dark = p.theme.dark;
  const fill = dark ? "surface" : p.theme.chrome.sectionFill || "accent2";
  p.slide.background = { color: p.color(fill) };
  const number = s.number || pad2(Math.max(1, sectionIndex(deck, s) + 1));
  const light = dark ? "ink" : "FFFFFF";
  p.text(number, { x: MX, y: 1.6, w: 4 }, { role: "number", size: 110, color: dark ? "accent" : mix(p.color(fill), "FFFFFF", 0.35), maxLines: 1, lineHeight: 1 });
  p.rect({ x: MX, y: 3.45, w: 0.9, h: 0.05 }, { fill: dark || fill === "ink" ? "accent" : "accent3" });
  const fit = p.text(s.title, { x: MX, y: 3.75, w: CW * 0.75 }, { name: "Title", role: "title", size: 38, min: 26, color: p.role("title", light), maxLines: 2 });
  if (s.subtitle) p.text(s.subtitle, { x: MX, y: 3.95 + fit.height, w: CW * 0.7 }, { name: "Subtitle", size: 15, min: 12, color: dark ? "body" : mix(p.color(fill), "FFFFFF", 0.7), maxLines: 3 });
  if (!p.hidden("page_number") && !p.hidden("footer")) p.text(`${pad2(index + 1)} / ${pad2(total)}`, { x: MX + CW - 1.2, y: 7.02, w: 1.2 }, { name: "Page number", role: "label", size: 8, color: dark ? "muted" : mix(p.color(fill), "FFFFFF", 0.6), align: "right", maxLines: 1 });
}

// ---------------------------------------------------------------------------------------------
// Covers

function coverMeta(deck, s) {
  return [...s.meta, deck.date, deck.author].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).slice(0, 3);
}

function coverKpis(p, s, box, { size = 34, colors } = {}) {
  if (!s.kpis.length) return 0;
  return kpiRow(p, box, s.kpis.slice(0, box.w > 7 ? 4 : 3), { size, colors });
}

const COVERS = {
  ledger(p, deck, s) {
    const panelX = 8.55;
    p.rect({ x: panelX, y: 0, w: W - panelX, h: H }, { fill: "accent2" });
    const gold = mix(p.color("accent3"), p.color("accent2"), 0.35);
    const targets = [];
    for (let index = 0; index <= 26; index += 1) targets.push([panelX + (W - panelX) * (index / 26), 0]);
    for (let index = 1; index <= 10; index += 1) targets.push([W, (H * 0.55) * (index / 10)]);
    lineFan(p, [panelX, H], targets, gold, 0.5);
    p.rect({ x: panelX, y: 0, w: 0.06, h: H }, { fill: "accent" });
    const left = { x: MX + 0.1, w: panelX - MX - 0.8 };
    let y = 0.85;
    if (s.kicker || deck.kicker) y += p.text(s.kicker || deck.kicker, { x: left.x, y, w: left.w }, { name: "Kicker", role: "label", size: 10, caps: true, spacing: 2, bold: true, color: "accent", maxLines: 2 }).height + 0.12;
    p.rect({ x: left.x, y, w: 0.7, h: 0.035 }, { fill: "accent" });
    y += 0.35;
    y += p.text(s.title, { x: left.x, y, w: left.w }, { name: "Title", role: "title", size: 46, min: 30, color: p.role("title", "ink"), maxLines: 4, lineHeight: 1.05, em: { color: "accent", bold: false } }).height + 0.3;
    if (s.subtitle) y += p.text(s.subtitle, { x: left.x, y, w: left.w * 0.92 }, { name: "Subtitle", size: 14, min: 11.5, color: p.role("subtitle", "body"), maxLines: 3 }).height;
    if (s.kpis.length) {
      const kpis = s.kpis.slice(0, 3);
      const top = Math.max(y + 0.45, 4.95);
      p.rect({ x: left.x, y: top, w: 0.05, h: 0.95 }, { fill: "accent" });
      kpiRow(p, { x: left.x + 0.25, y: top, w: left.w - 0.25 }, kpis, { size: 34 });
    }
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("   ·   "), { x: left.x, y: 6.85, w: left.w }, { role: "label", size: 9, caps: true, spacing: 1, color: "muted", maxLines: 1 });
    if (s.tagline) p.text(s.tagline, { x: panelX + 0.55, y: H - 1.6, w: W - panelX - 1.0 }, { name: "Tagline", role: "title", size: 17, min: 13, color: "FFFFFF", maxLines: 4, italic: true });
  },

  boardroom(p, deck, s) {
    const soft = mix(p.color("accent"), "FFFFFF", 0.78);
    const targets = [];
    for (let index = 0; index <= 30; index += 1) targets.push([7.2 + index * 0.2, 0]);
    lineFan(p, [W, H], targets, soft, 0.5);
    const targets2 = [];
    for (let index = 0; index <= 22; index += 1) targets2.push([W, index * 0.22]);
    lineFan(p, [8.6, H], targets2, mix(p.color("accent3"), "FFFFFF", 0.8), 0.5);
    const header = s.kicker || deck.kicker;
    if (header) p.text(header, { x: MX, y: 0.5, w: CW * 0.6 }, { role: "label", size: 10, caps: true, spacing: 1.5, bold: true, color: "ink", maxLines: 1 });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("  ·  "), { x: MX + CW * 0.55, y: 0.5, w: CW * 0.45 }, { role: "label", size: 9, caps: true, spacing: 1, color: "muted", align: "right", maxLines: 1 });
    p.line(MX, 0.85, MX + CW, 0.85, { color: "ink", width: 1 });
    const titleW = 7.9;
    const fit = p.measure(s.title, titleW, { role: "title", size: 44, min: 28, maxLines: 4, lineHeight: 1.05 });
    const y = 1.75;
    p.rect({ x: MX, y: y + 0.08, w: 0.16, h: fit.height - 0.1 }, { fill: "accent3" });
    p.text(s.title, { x: MX + 0.45, y, w: titleW }, { name: "Title", role: "title", size: 44, min: 28, maxLines: 4, lineHeight: 1.05, color: p.role("title", "ink"), em: { color: "accent", bold: true } });
    let after = y + fit.height + 0.35;
    if (s.subtitle) after += p.text(s.subtitle, { x: MX + 0.45, y: after, w: titleW }, { name: "Subtitle", size: 15, min: 12, color: p.role("subtitle", "body"), maxLines: 3 }).height;
    if (s.kpis.length) {
      const top = Math.max(after + 0.5, 5.25);
      p.line(MX, top - 0.25, MX + CW * 0.62, top - 0.25, { color: "rule", width: 0.75 });
      coverKpis(p, s, { x: MX, y: top, w: CW * 0.62 }, { size: 32 });
    }
    if (s.tagline) p.text(s.tagline, { x: MX, y: 6.9, w: CW * 0.6 }, { name: "Tagline", size: 10, color: "muted", maxLines: 1 });
  },

  midnight(p, deck, s) {
    glow(p, 10.6, 3.3, 4.2, p.color("accent"));
    glow(p, 12.8, 6.8, 2.2, p.color("accent3"));
    const cx = 10.4;
    const cy = 3.5;
    [3.2, 2.5, 1.85, 1.25].forEach((r, index) => {
      p.ellipse({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, { line: index === 1 ? "accent" : "rule", lineWidth: index === 1 ? 1 : 0.75 });
    });
    [[cx + 2.5 * Math.cos(-0.6), cy + 2.5 * Math.sin(-0.6), "accent"], [cx + 1.85 * Math.cos(2.4), cy + 1.85 * Math.sin(2.4), "accent2"], [cx + 3.2 * Math.cos(1.1), cy + 3.2 * Math.sin(1.1), "accent3"]].forEach(([x, y, color]) => {
      p.ellipse({ x: x - 0.08, y: y - 0.08, w: 0.16, h: 0.16 }, { fill: color });
    });
    const left = { x: MX, w: 7.2 };
    let y = 1.0;
    if (s.kicker || deck.kicker) y += p.text(s.kicker || deck.kicker, { x: left.x, y, w: left.w }, { name: "Kicker", role: "label", size: 9.5, caps: true, spacing: 2.5, color: "muted", maxLines: 1 }).height + 0.35;
    y += p.text(s.title, { x: left.x, y, w: left.w }, { name: "Title", role: "display", size: 44, min: 28, caps: true, color: p.role("title", "ink"), maxLines: 4, lineHeight: 1.02, em: { color: "accent", bold: true } }).height + 0.3;
    if (s.subtitle) y += p.text(s.subtitle, { x: left.x, y, w: left.w }, { name: "Subtitle", size: 14, min: 11.5, color: p.role("subtitle", "body"), maxLines: 3 }).height;
    if (s.kpis.length) coverKpis(p, s, { x: left.x, y: Math.max(y + 0.55, 4.9), w: left.w }, { size: 36, colors: ["ink", "ink", "ink", "ink"] });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("   ·   "), { x: left.x, y: 6.85, w: CW }, { role: "label", size: 9, color: "muted", maxLines: 1 });
  },

  atelier(p, deck, s) {
    const panelX = 8.2;
    p.shape("parallelogram", { x: panelX - 1.1, y: 0, w: W - panelX + 1.1, h: H }, { fill: "accent2" });
    const hero = s.kpis[0];
    if (hero) {
      drawKpi(p, { value: hero.value, unit: hero.unit }, { x: panelX + 0.3, y: 1.3, w: W - panelX - 0.8 }, { size: 96, color: "FFFFFF", unitColor: mix(p.color("accent2"), "FFFFFF", 0.65) });
      if (hero.label) p.text(hero.label, { x: panelX + 0.35, y: 2.85, w: W - panelX - 0.9 }, { size: 13, min: 11, color: "FFFFFF", maxLines: 3 });
    }
    if (s.tagline) {
      p.rect({ x: panelX + 0.25, y: 5.95, w: W - panelX - 0.25, h: 0.62 }, { fill: "accent" });
      p.text(s.tagline, { x: panelX + 0.45, y: 6.1, w: W - panelX - 0.75 }, { name: "Tagline", size: 12.5, min: 10, bold: true, color: "FFFFFF", maxLines: 1 });
    }
    const leftW = panelX - MX - 1.5;
    let y = 0.55;
    const kicker = s.kicker || deck.kicker;
    if (kicker) {
      const k = p.text(kicker, { x: MX, y, w: leftW }, { size: 11, bold: true, color: "ink", maxLines: 1 });
      const width = Math.min(leftW, textWidthPt(plain(kicker), { face: p.face("body"), size: k.size, bold: true }) / 72);
      p.rect({ x: MX, y: y + k.height + 0.05, w: width, h: 0.04 }, { fill: "accent2" });
    }
    y = 1.35;
    const fit = p.text(s.title, { x: MX, y, w: leftW }, { name: "Title", role: "display", size: 58, min: 34, caps: true, color: p.role("title", "ink"), maxLines: 4, lineHeight: 0.98, em: { color: "accent", bold: true } });
    y += fit.height + 0.3;
    if (s.subtitle) y += p.text(s.subtitle, { x: MX, y, w: leftW * 0.95 }, { name: "Subtitle", size: 13, min: 11, color: p.role("subtitle", "body"), maxLines: 3 }).height + 0.25;
    const rest = s.kpis.slice(hero ? 1 : 0, 4);
    if (rest.length) {
      const top = Math.max(y + 0.2, 5.15);
      p.rect({ x: MX, y: top - 0.2, w: 0.8, h: 0.05 }, { fill: "accent" });
      kpiRow(p, { x: MX, y: top, w: leftW }, rest, { size: 28, colors: ["accent", "accent", "accent"] });
    }
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("   |   "), { x: MX, y: 6.85, w: leftW }, { size: 9, color: "muted", maxLines: 1 });
  },

  academy(p, deck, s) {
    p.slide.background = { color: p.color("ink") };
    p.rect({ x: 0, y: 0, w: 0.14, h: H }, { fill: "accent" });
    const faint = mix(p.color("ink"), "FFFFFF", 0.45);
    const kicker = s.kicker || deck.kicker;
    if (kicker) p.text(kicker, { x: MX, y: 0.5, w: CW * 0.6 }, { role: "label", size: 8.5, caps: true, spacing: 1.5, color: faint, maxLines: 1 });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("  ·  "), { x: MX + CW * 0.5, y: 0.5, w: CW * 0.5 }, { role: "label", size: 8.5, caps: true, spacing: 1.2, color: faint, align: "right", maxLines: 1 });
    p.line(MX, 0.82, MX + CW, 0.82, { color: mix(p.color("ink"), "FFFFFF", 0.18), width: 0.75 });
    const agenda = deck.slides.find((entry) => entry.type === "agenda")?.items || deck.sections.map((name) => ({ title: name, body: "" }));
    const list = agenda.slice(0, 4);
    const leftW = list.length ? 6.6 : CW * 0.8;
    let y = 1.55;
    if (s.eyebrow) y += p.text(s.eyebrow, { x: MX, y, w: leftW }, { role: "label", size: 10, caps: true, spacing: 1.5, bold: true, color: "accent", maxLines: 1 }).height + 0.3;
    y += p.text(s.title, { x: MX, y, w: leftW }, { name: "Title", role: "title", size: 40, min: 26, bold: true, color: p.role("title", "FFFFFF"), maxLines: 4, lineHeight: 1.08, em: { color: mix(p.color("accent"), "FFFFFF", 0.25), bold: true } }).height + 0.35;
    if (s.subtitle) {
      p.rect({ x: MX, y: y + 0.03, w: 0.04, h: 0.36 }, { fill: "accent" });
      y += p.text(s.subtitle, { x: MX + 0.2, y, w: leftW - 0.2 }, { name: "Subtitle", size: 13, min: 11, color: mix(p.color("ink"), "FFFFFF", 0.75), maxLines: 3 }).height;
    }
    if (list.length) {
      const x = 8.1;
      const w = MX + CW - x;
      p.text("IN THIS SESSION", { x, y: 1.6, w }, { role: "label", size: 8.5, spacing: 1.5, color: faint, maxLines: 1 });
      p.line(x, 1.9, x + w, 1.9, { color: mix(p.color("ink"), "FFFFFF", 0.18), width: 0.75 });
      const rowH = Math.min(1.05, 4.2 / list.length);
      list.forEach((entry, index) => {
        const ry = 2.05 + index * rowH;
        p.text(pad2(index + 1), { x, y: ry + 0.02, w: 0.5 }, { role: "label", size: 11, bold: true, color: "accent", maxLines: 1 });
        const t = p.text(entry.title, { x: x + 0.55, y: ry, w: w - 0.55 }, { size: 13, min: 11, bold: true, color: "FFFFFF", maxLines: 2 });
        if (entry.body) p.text(entry.body, { x: x + 0.55, y: ry + t.height + 0.04, w: w - 0.55 }, { size: 9.5, min: 8.5, color: faint, maxLines: 2 });
        p.line(x, ry + rowH - 0.08, x + w, ry + rowH - 0.08, { color: mix(p.color("ink"), "FFFFFF", 0.14), width: 0.5 });
      });
    }
    if (s.kpis.length) kpiRow(p, { x: MX, y: 5.35, w: leftW }, s.kpis.slice(0, 3), { size: 30, colors: ["FFFFFF", "FFFFFF", "FFFFFF"], labelColor: mix(p.color("ink"), "FFFFFF", 0.75), noteColor: faint });
    if (s.tagline) p.text(s.tagline, { x: MX, y: 6.85, w: leftW }, { name: "Tagline", role: "label", size: 9, bold: true, color: faint, maxLines: 1 });
    hatchedDisc(p, W - 0.85, H - 0.8, 0.32, p.color("accent"), 8);
  },

  verdant(p, deck, s) {
    const kicker = s.kicker || deck.kicker;
    if (kicker) p.text(kicker, { x: MX, y: 0.5, w: CW * 0.55 }, { role: "label", size: 9.5, caps: true, spacing: 1.2, bold: true, color: "accent2", maxLines: 1 });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("  ·  "), { x: MX + CW * 0.5, y: 0.5, w: CW * 0.5 }, { role: "label", size: 9, caps: true, spacing: 1, color: "accent2", align: "right", maxLines: 1 });
    p.line(MX, 0.85, MX + CW, 0.85, { color: "rule", width: 0.75 });
    const hero = s.kpis[0];
    const leftW = hero ? 7.6 : CW * 0.8;
    let y = 1.5;
    if (s.eyebrow) y += p.text(s.eyebrow, { x: MX, y, w: leftW }, { role: "label", size: 11, caps: true, bold: true, color: "accent2", maxLines: 1 }).height + 0.2;
    y += p.text(s.title, { x: MX, y, w: leftW }, { name: "Title", role: "display", size: 46, min: 28, caps: true, color: p.role("title", "accent2"), maxLines: 3, lineHeight: 1.02, em: { color: "accent", bold: true } }).height + 0.2;
    p.rect({ x: MX, y, w: 0.8, h: 0.07 }, { fill: "accent3" });
    y += 0.35;
    if (s.subtitle) p.text(s.subtitle, { x: MX, y, w: leftW }, { name: "Subtitle", size: 13, min: 11, caps: false, color: p.role("subtitle", "ink"), maxLines: 3 });
    if (hero) {
      const x = 8.9;
      const w = MX + CW - x;
      drawKpi(p, { value: hero.value, unit: hero.unit }, { x, y: 1.35, w }, { size: 120, color: "accent2", align: "center" });
      if (hero.label) p.text(hero.label, { x, y: 3.25, w }, { role: "label", size: 10.5, caps: true, spacing: 0.8, bold: true, color: "accent2", align: "center", maxLines: 2 });
    }
    // Ruler motif: ticks with a few filled markers and one solid run.
    const rulerY = 4.55;
    p.line(MX, rulerY, MX + CW, rulerY, { color: "faint", width: 0.75 });
    for (let x = MX; x <= MX + CW + 0.001; x += 0.121) {
      const major = Math.round((x - MX) / 0.121) % 5 === 0;
      p.line(x, rulerY - (major ? 0.13 : 0.07), x, rulerY + (major ? 0.13 : 0.07), { color: "faint", width: 0.5 });
    }
    p.rect({ x: MX + CW * 0.68, y: rulerY - 0.035, w: CW * 0.26, h: 0.07 }, { fill: "accent2" });
    [[0.03, "surfaceStrong"], [0.3, "accent"], [0.68, "accent2"], [0.94, "accent3"]].forEach(([t, color]) => {
      p.rect({ x: MX + CW * t - 0.1, y: rulerY - 0.1, w: 0.2, h: 0.2 }, { fill: color });
    });
    const rest = s.kpis.slice(hero ? 1 : 0, 4);
    if (rest.length) kpiRow(p, { x: MX, y: 5.2, w: CW * 0.55 }, rest, { size: 26, colors: ["accent2", "accent2", "accent2"] });
    const blockX = MX + CW * 0.62;
    p.rect({ x: blockX, y: 5.85, w: W - blockX, h: H - 5.85 }, { fill: "accent2" });
    const pageLabel = `01 / ${pad2(deck.slides.length)}`;
    if (s.tagline) p.text(s.tagline, { x: blockX + 0.35, y: 6.15, w: W - blockX - 1.5 }, { name: "Tagline", role: "label", size: 10.5, caps: true, bold: true, spacing: 0.6, color: "FFFFFF", maxLines: 2 });
    p.text(pageLabel, { x: W - 1.3, y: 6.2, w: 0.8 }, { role: "label", size: 10, color: "FFFFFF", align: "right", maxLines: 1 });
  }
};

// ---------------------------------------------------------------------------------------------
// Section dividers beyond the full-bleed default

const SECTIONS = {
  // Page-coloured divider: oversized accent numeral, rule, title.
  light(p, deck, s, index, total) {
    background(p, s);
    const number = s.number || pad2(Math.max(1, sectionIndex(deck, s) + 1));
    p.text(number, { x: MX, y: 1.3, w: 5 }, { name: "Section number", role: "number", size: 120, color: "accent", maxLines: 1, lineHeight: 1 });
    p.rect({ x: MX, y: 3.45, w: 0.9, h: 0.05 }, { fill: "accent" });
    const fit = p.text(s.title, { x: MX, y: 3.75, w: CW * 0.75 }, { name: "Title", role: "title", size: 38, min: 26, color: p.role("title", "ink"), maxLines: 2 });
    if (s.subtitle) p.text(s.subtitle, { x: MX, y: 3.95 + fit.height, w: CW * 0.7 }, { name: "Subtitle", size: 15, min: 12, color: p.role("subtitle", "muted"), maxLines: 3 });
    sectionPage(p, index, total, "muted");
  },

  // Coloured panel holding the numeral, title on the page colour beside it.
  split(p, deck, s, index, total) {
    p.slide.background = { color: p.color("bg") };
    const fill = p.theme.chrome.sectionFill || "accent2";
    const panelW = 4.6;
    p.rect({ x: 0, y: 0, w: panelW, h: H }, { fill, name: "Section panel" });
    const on = onFill(p, fill);
    const number = s.number || pad2(Math.max(1, sectionIndex(deck, s) + 1));
    p.text(number, { x: 0.4, y: 2.35, w: panelW - 0.8 }, { name: "Section number", role: "number", size: 120, color: on, align: "center", maxLines: 1, lineHeight: 1 });
    const x = panelW + 0.75;
    const w = W - x - MX;
    const title = p.measure(s.title, w, { role: "title", size: 38, min: 26, maxLines: 3 });
    const top = Math.max(1.2, H / 2 - title.height / 2 - 0.3);
    p.rect({ x, y: top - 0.35, w: 0.9, h: 0.05 }, { fill: "accent" });
    p.text(s.title, { x, y: top, w }, { name: "Title", role: "title", size: 38, min: 26, color: p.role("title", "ink"), maxLines: 3 });
    if (s.subtitle) p.text(s.subtitle, { x, y: top + title.height + 0.22, w }, { name: "Subtitle", size: 15, min: 12, color: p.role("subtitle", "muted"), maxLines: 3 });
    sectionPage(p, index, total, "muted");
  }
};

function sectionPage(p, index, total, color) {
  if (p.hidden("page_number") || p.hidden("footer")) return;
  p.text(`${pad2(index + 1)} / ${pad2(total)}`, { x: MX + CW - 1.2, y: 7.02, w: 1.2 }, { name: "Page number", role: "label", size: 8, color, align: "right", maxLines: 1 });
}

// ---------------------------------------------------------------------------------------------
// Cover compositions for the extended catalog. Each takes its type and colours from the theme
// (chrome.coverFill, coverCaps, coverSpacing), so one composition serves many themes.

function coverKicker(deck, s) {
  return s.kicker || deck.kicker || "";
}

function coverTitleStyle(p, extra = {}) {
  const chrome = p.theme.chrome;
  return { name: "Title", role: "display", caps: Boolean(chrome.coverCaps), spacing: chrome.coverSpacing || 0, lineHeight: 1.04, em: { color: "accent", bold: true }, ...extra };
}

// Kicker, title, rule and subtitle centred on the slide; KPIs and meta below.
function centeredBlock(p, deck, s, { w = CW * 0.78 } = {}) {
  const x = (W - w) / 2;
  const kicker = coverKicker(deck, s);
  const titleStyle = coverTitleStyle(p, { size: 50, min: 30, maxLines: 3, align: "center", color: p.role("title", "ink") });
  const title = p.measure(s.title, w, titleStyle);
  const subStyle = { name: "Subtitle", size: 15, min: 12, maxLines: 3, align: "center", color: p.role("subtitle", "muted") };
  const sub = s.subtitle ? p.measure(s.subtitle, w * 0.86, subStyle) : { height: 0 };
  const block = (kicker ? 0.55 : 0) + title.height + 0.5 + sub.height;
  let y = Math.max(0.9, (H - block) / 2 - (s.kpis.length ? 0.6 : 0.15));
  if (kicker) {
    p.text(kicker, { x, y, w }, { name: "Kicker", role: "label", size: 10, caps: true, spacing: 3, color: "muted", align: "center", maxLines: 1 });
    y += 0.55;
  }
  p.text(s.title, { x, y, w }, titleStyle);
  y += title.height + 0.22;
  p.rect({ x: W / 2 - 0.4, y, w: 0.8, h: 0.045 }, { fill: "accent" });
  y += 0.28;
  if (s.subtitle) y += p.text(s.subtitle, { x: x + w * 0.07, y, w: w * 0.86 }, subStyle).height;
  if (s.kpis.length) {
    const kpis = s.kpis.slice(0, 3);
    const kw = Math.min(CW * 0.72, 2.9 * kpis.length);
    kpiRow(p, { x: (W - kw) / 2, y: Math.max(y + 0.5, 5.0), w: kw }, kpis, { size: 30, align: "center" });
  }
  const meta = coverMeta(deck, s);
  if (s.tagline) p.text(s.tagline, { x, y: 6.35, w }, { name: "Tagline", size: 11, italic: true, color: "muted", align: "center", maxLines: 1 });
  if (meta.length) p.text(meta.join("   ·   "), { x, y: 6.75, w }, { role: "label", size: 9, caps: true, spacing: 1, color: "muted", align: "center", maxLines: 1 });
}

// Numbered list for the right side of a cover: the agenda, else the sections.
function coverAgenda(deck) {
  return (deck.slides.find((entry) => entry.type === "agenda")?.items || deck.sections.map((name) => ({ title: name, body: "" }))).slice(0, 4);
}

Object.assign(COVERS, {
  centered(p, deck, s) {
    drawMotifs(p);
    centeredBlock(p, deck, s);
  },

  organic(p, deck, s) {
    p.ellipse({ x: -1.7, y: -1.9, w: 5.4, h: 4.1 }, { fill: "surfaceStrong" });
    p.ellipse({ x: -0.9, y: -1.25, w: 3.0, h: 2.4 }, { fill: "accent", transparency: 80 });
    p.ellipse({ x: W - 3.7, y: H - 2.3, w: 5.5, h: 4.2 }, { fill: "surfaceStrong" });
    p.ellipse({ x: W - 2.2, y: H - 1.45, w: 2.9, h: 2.3 }, { fill: "accent2", transparency: 82 });
    drawMotifs(p);
    centeredBlock(p, deck, s, { w: CW * 0.7 });
  },

  split(p, deck, s) {
    const fill = p.theme.chrome.coverFill || "accent2";
    const panelW = 7.1;
    p.rect({ x: 0, y: 0, w: panelW, h: H }, { fill, name: "Cover panel" });
    const on = onFill(p, fill);
    const soft = mix(p.color(fill), on, 0.68);
    const w = panelW - MX - 0.7;
    p.rect({ x: MX, y: 0.62, w: 0.55, h: 0.07 }, { fill: "accent3" });
    let y = 0.95;
    const kicker = coverKicker(deck, s);
    if (kicker) y += p.text(kicker, { x: MX, y, w }, { name: "Kicker", role: "label", size: 9.5, caps: true, spacing: 1.6, bold: true, color: soft, maxLines: 2 }).height;
    y = Math.max(y + 0.55, 1.9);
    y += p.text(s.title, { x: MX, y, w }, coverTitleStyle(p, { size: 44, min: 28, maxLines: 4, color: p.role("title", on), em: { color: "accent3", bold: true } })).height + 0.3;
    if (s.subtitle) p.text(s.subtitle, { x: MX, y, w }, { name: "Subtitle", size: 14, min: 11.5, color: p.role("subtitle", soft), maxLines: 3 });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("   ·   "), { x: MX, y: 6.8, w }, { role: "label", size: 9, caps: true, spacing: 1, color: soft, maxLines: 1 });
    const x = panelW + 0.65;
    const rw = W - x - MX;
    if (s.kpis.length) {
      const kpis = s.kpis.slice(0, 3);
      const stackH = Math.min(4.9, kpis.length * 1.45);
      kpiStack(p, { x, y: (H - stackH) / 2, w: rw, h: stackH }, kpis, { size: 40 });
    } else {
      const list = coverAgenda(deck);
      if (list.length) {
        p.text("CONTENTS", { x, y: 1.1, w: rw }, { role: "label", size: 9, spacing: 2, bold: true, color: "accent", maxLines: 1 });
        const rowH = Math.min(1.15, 4.6 / list.length);
        list.forEach((entry, index) => {
          const ry = 1.6 + index * rowH;
          p.text(pad2(index + 1), { x, y: ry, w: 0.6 }, { role: "number", size: 20, color: "accent", maxLines: 1 });
          p.text(entry.title, { x: x + 0.7, y: ry + 0.06, w: rw - 0.7 }, { size: 13, min: 11, bold: true, color: "ink", maxLines: 2 });
          p.line(x, ry + rowH - 0.12, x + rw, ry + rowH - 0.12, { color: "rule", width: 0.5 });
        });
      }
    }
    if (s.tagline) p.text(s.tagline, { x, y: 6.55, w: rw }, { name: "Tagline", size: 11, italic: true, color: "muted", maxLines: 2 });
  },

  poster(p, deck, s) {
    const fill = p.theme.chrome.coverFill || "accent";
    p.slide.background = { color: p.color(fill) };
    const on = onFill(p, fill);
    const soft = mix(p.color(fill), on, 0.7);
    p.ellipse({ x: W - 3.4, y: H - 2.9, w: 5.4, h: 5.4 }, { line: mix(p.color(fill), on, 0.3), lineWidth: 1 });
    const kicker = coverKicker(deck, s);
    if (kicker) p.text(kicker, { x: MX, y: 0.5, w: CW * 0.55 }, { name: "Kicker", role: "label", size: 10, caps: true, spacing: 1.4, bold: true, color: on, maxLines: 1 });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("  ·  "), { x: MX + CW * 0.5, y: 0.5, w: CW * 0.5 }, { role: "label", size: 9, caps: true, spacing: 1, color: soft, align: "right", maxLines: 1 });
    let y = 1.05;
    y += p.text(s.title, { x: MX, y, w: CW * 0.86 }, coverTitleStyle(p, { size: 84, min: 42, maxLines: 4, caps: p.theme.chrome.coverCaps !== false, lineHeight: 0.92, color: p.role("title", on), em: { color: soft, bold: true } })).height + 0.3;
    if (s.subtitle) y += p.text(s.subtitle, { x: MX, y, w: CW * 0.58 }, { name: "Subtitle", size: 15, min: 12, color: p.role("subtitle", on), maxLines: 3 }).height;
    if (s.kpis.length) {
      const top = Math.max(y + 0.45, 5.0);
      p.line(MX, top - 0.2, MX + CW * 0.7, top - 0.2, { color: soft, width: 0.75 });
      kpiRow(p, { x: MX, y: top, w: CW * 0.7 }, s.kpis.slice(0, 3), { size: 32, colors: [on, on, on], labelColor: soft, noteColor: soft, unitColor: soft, dividerColor: soft });
    }
    if (s.tagline) p.text(s.tagline, { x: MX + CW * 0.55, y: 6.75, w: CW * 0.45 }, { name: "Tagline", role: "label", size: 10, caps: true, spacing: 1, bold: true, color: on, align: "right", maxLines: 1 });
  },

  arcs(p, deck, s) {
    const cx = W - 0.1;
    const cy = H * 0.47;
    for (let index = 0; index < 7; index += 1) {
      const r = 1.0 + index * 0.42;
      p.ellipse({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, { line: index === 2 ? "accent" : mix(p.color("accent"), p.color("bg"), 0.55 + index * 0.05), lineWidth: index === 2 ? 1.25 : 0.75 });
    }
    const w = 7.6;
    let y = 1.55;
    const kicker = coverKicker(deck, s);
    if (kicker) {
      p.rect({ x: MX, y: y + 0.07, w: 0.3, h: 0.04 }, { fill: "accent" });
      y += p.text(kicker, { x: MX + 0.45, y, w: w - 0.45 }, { name: "Kicker", role: "label", size: 9, caps: true, spacing: 1.4, bold: true, color: "accent", maxLines: 1 }).height + 0.45;
    }
    y += p.text(s.title, { x: MX, y, w }, coverTitleStyle(p, { role: "title", size: 42, min: 28, maxLines: 3, color: p.role("title", "ink") })).height + 0.3;
    if (s.subtitle) y += p.text(s.subtitle, { x: MX, y, w }, { name: "Subtitle", role: "title", size: 20, min: 14, color: p.role("subtitle", "accent"), maxLines: 2 }).height + 0.3;
    p.line(MX, y + 0.1, MX + 5.6, y + 0.1, { color: "rule", width: 0.75 });
    if (s.kpis.length) kpiRow(p, { x: MX, y: Math.max(y + 0.5, 4.8), w }, s.kpis.slice(0, 3), { size: 28 });
    if (s.tagline) p.text(s.tagline, { x: MX, y: 6.35, w }, { name: "Tagline", size: 10.5, italic: true, color: "body", maxLines: 1 });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("   ·   "), { x: MX, y: 6.8, w }, { role: "label", size: 9, color: "muted", maxLines: 1 });
  },

  geometric(p, deck, s) {
    const chrome = p.theme.chrome;
    const size = 0.5;
    for (let index = 0; index < 5; index += 1) {
      const x = 0.55;
      const y = 0.72 + index * 1.28;
      if (chrome.geoStyle === "dots") {
        const color = p.theme.colors.palette[index % p.theme.colors.palette.length];
        p.ellipse({ x, y, w: size, h: size }, { fill: color });
      } else if (index % 2 === 0) {
        p.line(x, y, x + size, y + size, { color: "accent2", width: 5 });
        p.line(x, y + size, x + size, y, { color: "accent2", width: 5 });
      } else {
        p.ellipse({ x: x + 0.03, y: y + 0.03, w: size - 0.06, h: size - 0.06 }, { line: "accent3", lineWidth: 5 });
      }
    }
    p.rect({ x: W - 1.65, y: H - 1.25, w: 0.55, h: 0.55 }, { fill: "accent3" });
    p.ellipse({ x: W - 1.05, y: H - 1.85, w: 0.5, h: 0.5 }, { line: "accent2", lineWidth: 4 });
    const x = 2.0;
    const w = W - x - 1.9;
    let y = 1.35;
    const kicker = coverKicker(deck, s);
    if (kicker) y += p.text(kicker, { x, y, w }, { name: "Kicker", role: "label", size: 10, caps: true, spacing: 1.4, bold: true, color: "muted", maxLines: 1 }).height + 0.3;
    y += p.text(s.title, { x, y, w }, coverTitleStyle(p, { size: 54, min: 32, maxLines: 3, color: p.role("title", "accent2") })).height + 0.25;
    p.rect({ x, y, w: 0.85, h: 0.1 }, { fill: "accent3" });
    y += 0.4;
    if (s.subtitle) y += p.text(s.subtitle, { x, y, w: w * 0.85 }, { name: "Subtitle", size: 14, min: 11.5, color: p.role("subtitle", "body"), maxLines: 3 }).height;
    if (s.kpis.length) kpiRow(p, { x, y: Math.max(y + 0.5, 5.1), w: w * 0.85 }, s.kpis.slice(0, 3), { size: 30, colors: ["accent2", "accent2", "accent2"] });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("   ·   "), { x, y: 6.8, w }, { role: "label", size: 9, color: "muted", maxLines: 1 });
  },

  band(p, deck, s) {
    const chrome = p.theme.chrome;
    const fill = chrome.coverFill || "accent3";
    const on = onFill(p, fill);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 8; col += 1) p.ellipse({ x: W - 0.75 - col * 0.24, y: 0.55 + row * 0.24, w: 0.07, h: 0.07 }, { fill: row + col < 4 ? "accent" : "rule" });
    }
    let y = 0.62;
    const kicker = coverKicker(deck, s);
    if (kicker) {
      p.rect({ x: MX, y: y + 0.08, w: 0.4, h: 0.04 }, { fill: "accent" });
      p.text(kicker, { x: MX + 0.55, y, w: CW * 0.6 }, { name: "Kicker", role: "label", size: 9, caps: true, spacing: 1.5, color: "muted", maxLines: 1 });
    }
    y = 1.45;
    y += p.text(s.title, { x: MX, y, w: CW * 0.78 }, coverTitleStyle(p, { role: "title", size: 50, min: 30, maxLines: 3, color: p.role("title", "ink") })).height + 0.25;
    if (s.subtitle) y += p.text(s.subtitle, { x: MX, y, w: CW * 0.72 }, { name: "Subtitle", size: 14, min: 11.5, bold: true, caps: Boolean(chrome.coverCaps), spacing: chrome.coverCaps ? 0.6 : 0, color: p.role("subtitle", "body"), maxLines: 2 }).height;
    const bandY = Math.max(y + 0.45, 5.0);
    p.rect({ x: 0, y: bandY, w: W, h: 0.9 }, { fill, name: "Cover band" });
    const items = s.kpis.slice(0, 4).map((item) => `**${item.value}${item.unit ? ` ${item.unit}` : ""}** ${item.label || ""}`.trim());
    const bandText = items.length ? items.join("      |      ") : s.tagline;
    if (bandText) p.text(bandText, { x: MX, y: bandY + 0.29, w: CW }, { name: items.length ? "Cover figures" : "Tagline", size: 14, min: 10, color: on, em: { color: on, bold: true }, maxLines: 1 });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("   ·   "), { x: MX, y: bandY + 1.15, w: CW }, { role: "label", size: 9, color: "muted", maxLines: 1 });
  },

  gradient(p, deck, s) {
    glow(p, W - 2.2, 0.7, 5.2, p.color("accent"), 4);
    glow(p, W * 0.5, H + 0.9, 4.2, p.color("accent3"), 3);
    const kicker = coverKicker(deck, s);
    p.rect({ x: MX, y: 0.55, w: 0.2, h: 0.2 }, { fill: "accent", radius: 0.04 });
    if (kicker) p.text(kicker, { x: MX + 0.32, y: 0.53, w: CW * 0.5 }, { name: "Kicker", size: 11, bold: true, color: "ink", maxLines: 1 });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("  ·  "), { x: MX + CW * 0.5, y: 0.55, w: CW * 0.5 }, { role: "label", size: 9.5, color: "muted", align: "right", maxLines: 1 });
    const w = s.kpis.length ? 7.4 : CW * 0.85;
    const titleStyle = coverTitleStyle(p, { size: 64, min: 36, maxLines: 3, lineHeight: 0.98, color: p.role("title", "ink") });
    const title = p.measure(s.title, w, titleStyle);
    const subStyle = { name: "Subtitle", size: 16, min: 12, color: p.role("subtitle", "body"), maxLines: 2 };
    const sub = s.subtitle ? p.measure(s.subtitle, w * 0.9, subStyle) : { height: 0 };
    let y = Math.min(3.2, 6.55 - title.height - (sub.height ? sub.height + 0.25 : 0));
    p.text(s.title, { x: MX, y, w }, titleStyle);
    y += title.height + 0.25;
    if (s.subtitle) p.text(s.subtitle, { x: MX, y, w: w * 0.9 }, subStyle);
    if (s.kpis.length) kpiStack(p, { x: MX + CW - 3.6, y: 1.6, w: 3.6, h: 4.6 }, s.kpis.slice(0, 3), { size: 32 });
    if (s.tagline) p.text(s.tagline, { x: MX, y: 6.85, w: CW * 0.6 }, { name: "Tagline", size: 10, color: "muted", maxLines: 1 });
  },

  magazine(p, deck, s) {
    const cx = 2.6;
    const cy = H / 2;
    const faint = mix(p.color("accent"), p.color("bg"), 0.62);
    for (let r = 0.35; r <= 2.45; r += 0.35) p.ellipse({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, { line: faint, lineWidth: 0.5 });
    p.line(cx, 0.4, cx, H - 0.4, { color: faint, width: 0.5 });
    p.line(0.3, cy, 5.0, cy, { color: faint, width: 0.5 });
    for (let x = 0.35; x < 1.2; x += 0.09) p.line(x, 0.5, x, H - 0.5, { color: faint, width: 0.5 });
    p.ellipse({ x: cx - 0.09, y: cy - 0.09, w: 0.18, h: 0.18 }, { fill: "accent" });
    p.line(5.35, 0.9, 5.35, H - 0.9, { color: "accent", width: 1.25 });
    const x = 5.8;
    const w = W - x - MX;
    let y = 1.5;
    const kicker = coverKicker(deck, s);
    if (kicker) y += p.text(kicker, { x, y, w }, { name: "Kicker", role: "label", size: 9.5, caps: true, spacing: 1.4, bold: true, color: "accent", maxLines: 1 }).height + 0.3;
    y += p.text(s.title, { x, y, w }, coverTitleStyle(p, { size: 38, min: 26, maxLines: 4, color: p.role("title", "ink") })).height + 0.25;
    if (s.subtitle) y += p.text(s.subtitle, { x, y, w }, { name: "Subtitle", size: 13, min: 11, color: p.role("subtitle", "body"), maxLines: 3, em: { color: "accent", bold: true } }).height;
    if (s.kpis.length) kpiRow(p, { x, y: Math.max(y + 0.5, 4.9), w }, s.kpis.slice(0, 3), { size: 54, colors: ["ink", "ink", "ink"] });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("   ·   "), { x, y: 6.8, w }, { role: "label", size: 9, color: "muted", maxLines: 1 });
  },

  stack(p, deck, s) {
    const kicker = coverKicker(deck, s);
    if (kicker) p.text(kicker, { x: MX, y: 0.5, w: CW * 0.55 }, { name: "Kicker", role: "label", size: 9.5, caps: true, spacing: 1.2, bold: true, color: "accent", maxLines: 1 });
    const meta = coverMeta(deck, s);
    if (meta.length) p.text(meta.join("  ·  "), { x: MX + CW * 0.5, y: 0.5, w: CW * 0.5 }, { role: "label", size: 9, caps: true, spacing: 1, color: "muted", align: "right", maxLines: 1 });
    p.line(MX, 0.88, MX + CW, 0.88, { color: "rule", width: 0.75 });
    p.rect({ x: MX, y: 0.855, w: 1.2, h: 0.06 }, { fill: "accent" });
    const hero = s.kpis[0];
    const w = hero ? 7.7 : CW * 0.85;
    let y = 1.55;
    if (s.eyebrow) y += p.text(s.eyebrow, { x: MX, y, w }, { role: "label", size: 10.5, caps: true, bold: true, color: "accent2", maxLines: 1 }).height + 0.25;
    y += p.text(s.title, { x: MX, y, w }, coverTitleStyle(p, { size: 50, min: 30, maxLines: 4, lineHeight: 1.0, color: p.role("title", "ink") })).height + 0.3;
    p.rect({ x: MX, y, w: 0.8, h: 0.06 }, { fill: "accent" });
    y += 0.3;
    if (s.subtitle) p.text(s.subtitle, { x: MX, y, w: w * 0.95 }, { name: "Subtitle", size: 14, min: 11.5, color: p.role("subtitle", "body"), maxLines: 3 });
    if (hero) {
      const hx = 8.9;
      const hw = MX + CW - hx;
      drawKpi(p, { value: hero.value, unit: hero.unit }, { x: hx, y: 1.5, w: hw }, { size: 96, color: "accent", align: "right" });
      if (hero.label) p.text(hero.label, { x: hx, y: 3.05, w: hw }, { role: "label", size: 10, caps: true, spacing: 0.6, bold: true, color: "ink", align: "right", maxLines: 2 });
    }
    const rest = s.kpis.slice(hero ? 1 : 0, 4);
    if (rest.length) {
      p.line(MX, 5.3, MX + CW, 5.3, { color: "rule", width: 0.75 });
      kpiRow(p, { x: MX, y: 5.5, w: CW * 0.75 }, rest, { size: 26, colors: ["ink", "ink", "ink"] });
    }
    if (s.tagline) p.text(s.tagline, { x: MX, y: 6.72, w: CW }, { name: "Tagline", size: 10, color: "muted", maxLines: 1 });
    p.rect({ x: 0, y: H - 0.12, w: W, h: 0.12 }, { fill: "accent2" });
  }
});

// ---------------------------------------------------------------------------------------------

export function renderSlide(p, deck, s, index, total, ctx) {
  if (s.type === "cover") {
    background(p, s, { cover: true });
    (COVERS[p.theme.cover] || COVERS.boardroom)(p, deck, s);
    return;
  }
  if (s.type === "section") {
    section(p, deck, s, index, total);
    return;
  }
  const box = frame(p, deck, s, index, total);
  (LAYOUTS[s.type] || LAYOUTS.bullets)(p, s, box, ctx);
}
