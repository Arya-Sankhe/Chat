// Charts as SVG. The PDF embeds the SVG (vector, sharp in print); the DOCX embeds a PNG of the
// same drawing. Charts follow one visual system: light dashed grid, no chart junk, values
// labelled directly where they fit, the highlighted category in the accent colour and the
// others muted, a legend only when there is more than one series.

import { plain } from "./spec.js";

const W = 640;

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function decimalsOf(values) {
  let max = 0;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    const text = String(value);
    const dot = text.indexOf(".");
    if (dot >= 0 && !text.includes("e")) max = Math.max(max, Math.min(2, text.length - dot - 1));
  }
  return max;
}

export function formatValue(value, unit = "", values = [value], compact = false) {
  if (value === null || !Number.isFinite(value)) return "";
  const u = String(unit || "").trim();
  let decimals = decimalsOf(values);
  let number = value;
  let suffix = "";
  if (compact && Math.abs(value) >= 10_000) {
    const scale = Math.abs(value) >= 1e9 ? [1e9, "B"] : Math.abs(value) >= 1e6 ? [1e6, "M"] : [1e3, "k"];
    number = value / scale[0];
    suffix = scale[1];
    decimals = Math.abs(number) < 10 ? 1 : 0;
  }
  const text = Math.abs(number).toLocaleString("en-US", { minimumFractionDigits: compact ? 0 : decimals, maximumFractionDigits: decimals });
  const sign = number < 0 ? "−" : "";
  if (/^[$€£¥₹]$/.test(u)) return `${sign}${u}${text}${suffix}`;
  // "€bn", "$M", "$k": the symbol leads, the scale follows ("€6.8bn").
  if (/^[$€£¥₹][a-z]{1,3}$/i.test(u)) return `${sign}${u[0]}${text}${suffix}${u.slice(1)}`;
  if (u === "%") return `${sign}${text}${suffix}%`;
  if (/^[x×]$/i.test(u)) return `${sign}${text}${suffix}×`;
  return `${sign}${text}${suffix}${u && u.length <= 4 && !/\s/.test(u) ? (/^[a-z]/i.test(u) && u.length > 1 ? ` ${u}` : u) : ""}`;
}

function niceStep(range, ticks) {
  const raw = range / Math.max(1, ticks);
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

function scale(minValue, maxValue, ticks = 5, zero = true) {
  let min = zero ? Math.min(0, minValue) : minValue;
  let max = zero ? Math.max(0, maxValue) : maxValue;
  if (min === max) {
    max = min + (min === 0 ? 1 : Math.abs(min) * 0.2);
    if (!zero) min -= Math.abs(min) * 0.2 || 1;
  }
  if (!zero) {
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }
  const step = niceStep(max - min, ticks);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const values = [];
  for (let v = lo; v <= hi + step / 2; v += step) values.push(Math.round(v / step) * step);
  return { min: lo, max: hi, ticks: values };
}

function textWidth(text, size) {
  // Average glyph width of the bundled sans faces is close to 0.55 em.
  return String(text).length * size * 0.55;
}

function truncateLabel(text, maxWidth, size) {
  const value = plain(text);
  if (textWidth(value, size) <= maxWidth) return value;
  const chars = Math.max(3, Math.floor(maxWidth / (size * 0.55)) - 1);
  return `${value.slice(0, chars).trim()}…`;
}

function wrapLabel(text, maxWidth, size, maxLines = 2) {
  const words = plain(text).split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (textWidth(next, size) <= maxWidth || !current) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = truncateLabel(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, maxWidth, size);
    return kept;
  }
  return lines;
}

function mix(hexColor, amount, toward = "FFFFFF") {
  const a = hexColor.match(/../g).map((v) => parseInt(v, 16));
  const b = toward.match(/../g).map((v) => parseInt(v, 16));
  return a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function seriesColors(chart, theme, count) {
  const palette = chart.colors?.length ? chart.colors : theme.colors.palette;
  return Array.from({ length: count }, (_, i) => chart.series?.[i]?.color || palette[i % palette.length]);
}

function frame(height, body, theme, fonts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" font-family="${esc(fonts.label)}, sans-serif" role="img">${body}</svg>`;
}

function legend(names, colors, theme, y, shape = "rect") {
  let x = 0;
  const items = names.map((name, i) => {
    const label = truncateLabel(name, 180, 10.5);
    const marker = shape === "line"
      ? `<line x1="${x}" y1="${y - 3.5}" x2="${x + 14}" y2="${y - 3.5}" stroke="#${colors[i]}" stroke-width="2.5" stroke-linecap="round"/>`
      : `<rect x="${x}" y="${y - 9}" width="10" height="10" rx="2" fill="#${colors[i]}"/>`;
    const out = `${marker}<text x="${x + (shape === "line" ? 19 : 15)}" y="${y}" font-size="10.5" fill="#${theme.colors.text}">${esc(label)}</text>`;
    x += (shape === "line" ? 19 : 15) + textWidth(label, 10.5) + 18;
    return out;
  });
  return items.join("");
}

function valueAxis(s, plot, theme, unit, values, horizontal = false) {
  const c = theme.colors;
  return s.ticks.map((tick) => {
    const label = formatValue(tick, unit, values, true);
    if (horizontal) {
      const x = plot.x + ((tick - s.min) / (s.max - s.min)) * plot.w;
      return `<line x1="${x}" y1="${plot.y}" x2="${x}" y2="${plot.y + plot.h}" stroke="#${tick === 0 ? c.faint : c.rule}" stroke-width="${tick === 0 ? 1 : 0.8}" ${tick === 0 ? "" : 'stroke-dasharray="3 3"'}/>`
        + `<text x="${x}" y="${plot.y + plot.h + 14}" font-size="9.5" fill="#${c.muted}" text-anchor="middle">${esc(label)}</text>`;
    }
    const y = plot.y + plot.h - ((tick - s.min) / (s.max - s.min)) * plot.h;
    return `<line x1="${plot.x}" y1="${y}" x2="${plot.x + plot.w}" y2="${y}" stroke="#${tick === 0 ? c.faint : c.rule}" stroke-width="${tick === 0 ? 1 : 0.8}" ${tick === 0 ? "" : 'stroke-dasharray="3 3"'}/>`
      + `<text x="${plot.x - 8}" y="${y + 3.5}" font-size="9.5" fill="#${c.muted}" text-anchor="end">${esc(label)}</text>`;
  }).join("");
}

// Axis titles (x_label under the categories, y_label up the value axis) when the chart has them.
function axisTitles(chart, theme, plot, height) {
  const c = theme.colors;
  let out = "";
  if (chart.x_label) out += `<text x="${plot.x + plot.w / 2}" y="${height - 3}" font-size="9.5" fill="#${c.muted}" text-anchor="middle">${esc(chart.x_label)}</text>`;
  if (chart.y_label) out += `<text x="${plot.x - 6}" y="${plot.y - 6}" font-size="9.5" fill="#${c.muted}" text-anchor="start">${esc(chart.y_label)}</text>`;
  return out;
}

function axisWidth(s, unit, values) {
  return Math.max(...s.ticks.map((tick) => textWidth(formatValue(tick, unit, values, true), 9.5))) + 12;
}

// Vertical bars: one series, grouped series, stacked or 100% stacked.
function columnChart(chart, theme, fonts, { stacked = false } = {}) {
  const c = theme.colors;
  const categories = chart.categories;
  const series = chart.series.filter((entry) => entry.type !== "line");
  const lineSeries = chart.chart === "combo" ? chart.series.filter((entry) => entry.type === "line") : [];
  const colors = seriesColors(chart, theme, chart.series.length);
  const multi = series.length > 1;
  const percent = stacked && chart.percent;
  const totals = categories.map((_, i) => series.reduce((sum, entry) => sum + Math.max(0, entry.values[i] || 0), 0));
  const all = stacked ? (percent ? [0, 100] : totals) : series.flatMap((entry) => entry.values).filter((v) => v !== null);
  const s = scale(Math.min(0, ...all), Math.max(...all, 0), 5);
  const unit = percent ? "%" : chart.unit;
  const legendH = multi || lineSeries.length ? 26 : 0;
  const longest = Math.max(...categories.map((label) => textWidth(plain(label), 10)));
  const slot0 = (W - 60) / Math.max(1, categories.length);
  const labelLines = longest > slot0 - 6 ? 2 : 1;
  const rotate = categories.length > 8 && longest > slot0 * 1.8;
  const bottom = rotate ? Math.min(90, longest * 0.72 + 14) : 18 + labelLines * 12;
  const titled = (chart.x_label ? 14 : 0) + (chart.y_label ? 10 : 0);
  const height = Math.round(250 + legendH + (bottom - 30) + titled);
  const left = axisWidth(s, unit, all);
  const right = lineSeries.length ? 52 : 6;
  const plot = { x: left, y: 14 + legendH + (chart.y_label ? 10 : 0), w: W - left - right, h: height - 14 - legendH - bottom - titled };
  const slot = plot.w / categories.length;
  const groupW = Math.min(slot * 0.68, multi && !stacked ? 30 * series.length : 46);
  const barW = stacked ? groupW : groupW / series.length;
  const y = (value) => plot.y + plot.h - ((value - s.min) / (s.max - s.min)) * plot.h;
  let body = valueAxis(s, plot, theme, unit, all);
  const highlight = chart.highlight;
  const showLabels = categories.length * (stacked ? 1 : series.length) <= 16;
  categories.forEach((category, i) => {
    const cx = plot.x + slot * i + slot / 2;
    let stackBase = 0;
    series.forEach((entry, j) => {
      const raw = entry.values[i];
      if (raw === null || raw === undefined) return;
      const value = percent ? (totals[i] ? (Math.max(0, raw) / totals[i]) * 100 : 0) : raw;
      const x = stacked ? cx - groupW / 2 : cx - groupW / 2 + j * barW;
      const from = stacked ? stackBase : 0;
      const to = stacked ? stackBase + value : value;
      const top = y(Math.max(from, to));
      const h = Math.max(0.5, Math.abs(y(from) - y(to)));
      let fill = colors[chart.series.indexOf(entry)];
      if (!multi && highlight !== undefined) fill = i === highlight ? c.accent : mix(theme.colors.palette[0] === c.accent ? c.muted : colors[0], 0.55);
      else if (!multi && highlight === undefined) fill = colors[0];
      const radius = Math.min(3, barW / 4);
      body += `<path d="M${x},${top + h} V${top + radius} Q${x},${top} ${x + radius},${top} H${x + barW - radius} Q${x + barW},${top} ${x + barW},${top + radius} V${top + h} Z" fill="#${fill}"/>`;
      if (stacked) {
        if (h > 14 && barW > 26) body += `<text x="${x + barW / 2}" y="${top + h / 2 + 3.5}" font-size="9" fill="#FFFFFF" text-anchor="middle" font-weight="600">${esc(formatValue(value, unit, all, true))}</text>`;
        stackBase += value;
      } else if (showLabels) {
        const label = formatValue(raw, chart.unit, all, true);
        if (textWidth(label, 9.5) <= barW + 16) body += `<text x="${x + barW / 2}" y="${value >= 0 ? top - 5 : top + h + 12}" font-size="9.5" fill="#${!multi && highlight === i ? c.ink : c.text}" font-weight="${!multi && highlight === i ? 700 : 500}" text-anchor="middle">${esc(label)}</text>`;
      }
    });
    if (stacked && !percent && showLabels) body += `<text x="${cx}" y="${y(totals[i]) - 5}" font-size="9.5" fill="#${c.text}" font-weight="600" text-anchor="middle">${esc(formatValue(totals[i], unit, all, true))}</text>`;
    if (rotate) {
      body += `<text transform="translate(${cx + 3},${plot.y + plot.h + 10}) rotate(-35)" font-size="9.5" fill="#${c.muted}" text-anchor="end">${esc(truncateLabel(category, 120, 9.5))}</text>`;
    } else {
      wrapLabel(category, slot - 6, 10, 2).forEach((text, k) => {
        body += `<text x="${cx}" y="${plot.y + plot.h + 15 + k * 12}" font-size="10" fill="#${highlight === i && !multi ? c.ink : c.muted}" font-weight="${highlight === i && !multi ? 600 : 400}" text-anchor="middle">${esc(text)}</text>`;
      });
    }
  });
  if (lineSeries.length) {
    const lineValues = lineSeries.flatMap((entry) => entry.values).filter((v) => v !== null);
    const ls = scale(Math.min(0, ...lineValues), Math.max(...lineValues), 5);
    const ly = (value) => plot.y + plot.h - ((value - ls.min) / (ls.max - ls.min)) * plot.h;
    lineSeries.forEach((entry) => {
      const color = colors[chart.series.indexOf(entry)];
      const points = entry.values.map((value, i) => (value === null ? null : [plot.x + slot * i + slot / 2, ly(value)])).filter(Boolean);
      body += `<polyline points="${points.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#${color}" stroke-width="2.4" stroke-linejoin="round"/>`;
      points.forEach((p) => { body += `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" fill="#FFFFFF" stroke="#${color}" stroke-width="2"/>`; });
    });
    ls.ticks.forEach((tick) => {
      body += `<text x="${plot.x + plot.w + 8}" y="${ly(tick) + 3.5}" font-size="9.5" fill="#${c.muted}">${esc(formatValue(tick, lineSeries[0].unit || "", lineValues, true))}</text>`;
    });
  }
  body += axisTitles(chart, theme, plot, height);
  if (legendH) body = legend(chart.series.map((entry) => entry.name), colors, theme, 14) + body;
  return frame(height, body, theme, fonts);
}

// Horizontal bars: rankings and long category names. Stacked when asked.
function barChart(chart, theme, fonts, { stacked = false } = {}) {
  const c = theme.colors;
  const categories = chart.categories;
  const series = chart.series;
  const colors = seriesColors(chart, theme, series.length);
  const multi = series.length > 1;
  const percent = stacked && chart.percent;
  const totals = categories.map((_, i) => series.reduce((sum, entry) => sum + Math.max(0, entry.values[i] || 0), 0));
  const all = stacked ? (percent ? [0, 100] : totals) : series.flatMap((entry) => entry.values).filter((v) => v !== null);
  const s = scale(Math.min(0, ...all), Math.max(...all, 0), 5);
  const unit = percent ? "%" : chart.unit;
  const labelW = Math.min(200, Math.max(60, ...categories.map((label) => textWidth(plain(label), 10.5))) + 12);
  const rowH = multi && !stacked ? 12 * series.length + 12 : 26;
  const legendH = multi ? 26 : 0;
  const height = Math.round(legendH + 14 + categories.length * rowH + 26);
  const plot = { x: labelW, y: legendH + 8, w: W - labelW - 56, h: categories.length * rowH };
  const x = (value) => plot.x + ((value - s.min) / (s.max - s.min)) * plot.w;
  let body = valueAxis(s, plot, theme, unit, all, true);
  categories.forEach((category, i) => {
    const top = plot.y + i * rowH;
    const label = truncateLabel(category, labelW - 12, 10.5);
    const highlighted = !multi && chart.highlight === i;
    body += `<text x="${labelW - 10}" y="${top + rowH / 2 + 3.5}" font-size="10.5" fill="#${highlighted ? c.ink : c.text}" font-weight="${highlighted ? 700 : 400}" text-anchor="end">${esc(label)}</text>`;
    let base = 0;
    series.forEach((entry, j) => {
      const raw = entry.values[i];
      if (raw === null || raw === undefined) return;
      const value = percent ? (totals[i] ? (Math.max(0, raw) / totals[i]) * 100 : 0) : raw;
      const barH = stacked || !multi ? rowH * 0.62 : 10;
      const y0 = stacked || !multi ? top + (rowH - barH) / 2 : top + 6 + j * 12;
      const from = stacked ? base : 0;
      const to = stacked ? base + value : value;
      const x0 = x(Math.min(from, to));
      const w = Math.max(0.5, Math.abs(x(to) - x(from)));
      let fill = colors[j];
      if (!multi && chart.highlight !== undefined) fill = highlighted ? c.accent : mix(colors[0], 0.5);
      body += `<rect x="${x0}" y="${y0}" width="${w}" height="${barH}" rx="2" fill="#${fill}"/>`;
      if (stacked) {
        if (w > 30) body += `<text x="${x0 + w / 2}" y="${y0 + barH / 2 + 3.5}" font-size="9" fill="#FFFFFF" font-weight="600" text-anchor="middle">${esc(formatValue(value, unit, all, true))}</text>`;
        base += value;
      } else {
        body += `<text x="${value >= 0 ? x0 + w + 5 : x0 - 5}" y="${y0 + barH / 2 + 3.5}" font-size="9.5" fill="#${c.text}" font-weight="${highlighted ? 700 : 500}" text-anchor="${value >= 0 ? "start" : "end"}">${esc(formatValue(raw, chart.unit, all, true))}</text>`;
      }
    });
  });
  if (legendH) body = legend(series.map((entry) => entry.name), colors, theme, 14) + body;
  return frame(height, body, theme, fonts);
}

function lineChart(chart, theme, fonts, { area = false } = {}) {
  const c = theme.colors;
  const categories = chart.categories;
  const series = chart.series;
  const colors = seriesColors(chart, theme, series.length);
  const all = series.flatMap((entry) => entry.values).filter((v) => v !== null);
  const zero = area || Math.min(...all) <= 0 || (Math.min(...all) / Math.max(...all)) < 0.35;
  const s = scale(Math.min(...all), Math.max(...all), 5, zero);
  const multi = series.length > 1;
  const legendH = multi ? 26 : 0;
  const longest = Math.max(...categories.map((label) => textWidth(plain(label), 10)));
  const titled = chart.x_label ? 14 : 0;
  const height = 260 + legendH + titled + (chart.y_label ? 10 : 0);
  const left = axisWidth(s, chart.unit, all);
  const plot = { x: left, y: 16 + legendH + (chart.y_label ? 10 : 0), w: W - left - 18, h: height - 16 - legendH - 34 - titled - (chart.y_label ? 10 : 0) };
  const step = categories.length > 1 ? plot.w / (categories.length - 1) : 0;
  const px = (i) => (categories.length > 1 ? plot.x + step * i : plot.x + plot.w / 2);
  const py = (v) => plot.y + plot.h - ((v - s.min) / (s.max - s.min)) * plot.h;
  let body = valueAxis(s, plot, theme, chart.unit, all);
  const every = Math.max(1, Math.ceil((longest + 10) / Math.max(1, step)));
  categories.forEach((category, i) => {
    if (i % every !== 0 && i !== categories.length - 1) return;
    const anchor = i === 0 ? "start" : i === categories.length - 1 ? "end" : "middle";
    body += `<text x="${px(i)}" y="${plot.y + plot.h + 16}" font-size="10" fill="#${c.muted}" text-anchor="${anchor}">${esc(truncateLabel(category, Math.max(40, step * every - 4), 10))}</text>`;
  });
  const labelPoints = !multi && categories.length <= 12;
  series.forEach((entry, j) => {
    const color = colors[j];
    const points = entry.values.map((value, i) => (value === null ? null : [px(i), py(value), value, i])).filter(Boolean);
    if (!points.length) return;
    if (area) {
      const baseY = py(Math.max(s.min, 0));
      body += `<path d="M${points[0][0]},${baseY} ${points.map((p) => `L${p[0]},${p[1]}`).join(" ")} L${points[points.length - 1][0]},${baseY} Z" fill="#${color}" fill-opacity="${multi ? 0.14 : 0.16}"/>`;
    }
    body += `<polyline points="${points.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="none" stroke="#${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (points.length <= 24) points.forEach((p) => { body += `<circle cx="${p[0]}" cy="${p[1]}" r="${chart.highlight === p[3] ? 4.5 : 3}" fill="${chart.highlight === p[3] ? `#${c.accent}` : "#FFFFFF"}" stroke="#${chart.highlight === p[3] ? c.accent : color}" stroke-width="2"/>`; });
    if (labelPoints) {
      points.forEach((p, k) => {
        const prev = points[k - 1]?.[1] ?? p[1];
        const next = points[k + 1]?.[1] ?? p[1];
        const below = p[1] > prev && p[1] > next;
        body += `<text x="${p[0]}" y="${below ? p[1] + 15 : p[1] - 8}" font-size="9.5" fill="#${chart.highlight === p[3] ? c.ink : c.text}" font-weight="${chart.highlight === p[3] ? 700 : 500}" text-anchor="${k === 0 ? "start" : k === points.length - 1 ? "end" : "middle"}">${esc(formatValue(p[2], chart.unit, all, true))}</text>`;
      });
    }
  });
  body += axisTitles(chart, theme, plot, height);
  if (legendH) body = legend(series.map((entry) => entry.name), colors, theme, 14, "line") + body;
  return frame(height, body, theme, fonts);
}

function pieChart(chart, theme, fonts, { donut = false } = {}) {
  const c = theme.colors;
  const entries = chart.categories.map((label, i) => ({ label, value: Math.max(0, chart.series[0].values[i] || 0) })).filter((entry) => entry.value > 0);
  const total = entries.reduce((sum, entry) => sum + entry.value, 0) || 1;
  const palette = chart.colors?.length ? chart.colors : theme.colors.palette;
  const colors = entries.map((_, i) => palette[i % palette.length]);
  const rowH = 24;
  const height = Math.max(220, entries.length * rowH + 40);
  const r = Math.min(95, height / 2 - 14);
  const cx = 150;
  const cy = height / 2;
  const inner = donut ? r * 0.6 : 0;
  let angle = -Math.PI / 2;
  let body = "";
  entries.forEach((entry, i) => {
    const sweep = (entry.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (radius, a) => `${cx + radius * Math.cos(a)},${cy + radius * Math.sin(a)}`;
    if (entries.length === 1) {
      body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#${colors[i]}"/>${donut ? `<circle cx="${cx}" cy="${cy}" r="${inner}" fill="#FFFFFF"/>` : ""}`;
      return;
    }
    const d = donut
      ? `M${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} L${p(inner, a1)} A${inner},${inner} 0 ${large} 0 ${p(inner, a0)} Z`
      : `M${cx},${cy} L${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} Z`;
    body += `<path d="${d}" fill="#${colors[i]}" stroke="#FFFFFF" stroke-width="1.5"/>`;
    const share = entry.value / total;
    if (share >= 0.06) {
      const mid = a0 + sweep / 2;
      const lr = donut ? (r + inner) / 2 : r * 0.64;
      body += `<text x="${cx + lr * Math.cos(mid)}" y="${cy + lr * Math.sin(mid) + 3.5}" font-size="10" font-weight="700" fill="#FFFFFF" text-anchor="middle">${Math.round(share * 100)}%</text>`;
    }
  });
  if (donut && chart.title === undefined && chart.unit !== undefined) {
    // nothing: totals are in the legend
  }
  if (donut) {
    body += `<text x="${cx}" y="${cy - 2}" font-size="17" font-weight="700" fill="#${c.ink}" text-anchor="middle">${esc(formatValue(total, chart.unit, entries.map((e) => e.value), true))}</text>`
      + `<text x="${cx}" y="${cy + 14}" font-size="9.5" fill="#${c.muted}" text-anchor="middle">Total</text>`;
  }
  const lx = 300;
  const top = cy - (entries.length * rowH) / 2 + 12;
  entries.forEach((entry, i) => {
    const y = top + i * rowH;
    const value = formatValue(entry.value, chart.unit, entries.map((e) => e.value));
    body += `<rect x="${lx}" y="${y - 9}" width="11" height="11" rx="2.5" fill="#${colors[i]}"/>`
      + `<text x="${lx + 19}" y="${y}" font-size="10.5" fill="#${c.text}">${esc(truncateLabel(entry.label, 200, 10.5))}</text>`
      + `<text x="${W - 70}" y="${y}" font-size="10.5" fill="#${c.ink}" font-weight="600" text-anchor="end">${esc(value)}</text>`
      + `<text x="${W - 8}" y="${y}" font-size="10.5" fill="#${c.muted}" text-anchor="end">${(entry.value / total * 100).toFixed(entry.value / total < 0.1 ? 1 : 0)}%</text>`;
    if (i < entries.length - 1) body += `<line x1="${lx}" y1="${y + 8}" x2="${W - 8}" y2="${y + 8}" stroke="#${c.rule}" stroke-width="0.8"/>`;
  });
  return frame(height, body, theme, fonts);
}

function scatterChart(chart, theme, fonts) {
  const c = theme.colors;
  const points = chart.points.filter((p) => p.x !== null && p.y !== null);
  const xs = scale(Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x)), 5, false);
  const ys = scale(Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.y)), 5, false);
  const height = 290;
  const left = axisWidth(ys, chart.unit, points.map((p) => p.y)) + (chart.y_label ? 16 : 0);
  const plot = { x: left, y: 12, w: W - left - 20, h: height - 12 - 44 };
  const px = (v) => plot.x + ((v - xs.min) / (xs.max - xs.min)) * plot.w;
  const py = (v) => plot.y + plot.h - ((v - ys.min) / (ys.max - ys.min)) * plot.h;
  let body = valueAxis(ys, plot, theme, chart.unit, points.map((p) => p.y));
  xs.ticks.forEach((tick) => {
    body += `<text x="${px(tick)}" y="${plot.y + plot.h + 15}" font-size="9.5" fill="#${c.muted}" text-anchor="middle">${esc(formatValue(tick, "", points.map((p) => p.x), true))}</text>`;
  });
  if (chart.x_label) body += `<text x="${plot.x + plot.w / 2}" y="${height - 6}" font-size="10" fill="#${c.muted}" text-anchor="middle">${esc(chart.x_label)}</text>`;
  if (chart.y_label) body += `<text transform="translate(11,${plot.y + plot.h / 2}) rotate(-90)" font-size="10" fill="#${c.muted}" text-anchor="middle">${esc(chart.y_label)}</text>`;
  // A least-squares trend line when the points look like a measurement series.
  if (chart.trend !== false && points.length >= 4) {
    const n = points.length;
    const mx = points.reduce((s, p) => s + p.x, 0) / n;
    const my = points.reduce((s, p) => s + p.y, 0) / n;
    const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    const sxy = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
    const syy = points.reduce((s, p) => s + (p.y - my) ** 2, 0);
    const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
    if (chart.trend === true || r2 > 0.8) {
      const slope = sxy / sxx;
      const x0 = Math.min(...points.map((p) => p.x));
      const x1 = Math.max(...points.map((p) => p.x));
      body += `<line x1="${px(x0)}" y1="${py(my + slope * (x0 - mx))}" x2="${px(x1)}" y2="${py(my + slope * (x1 - mx))}" stroke="#${c.accent}" stroke-width="1.6" stroke-dasharray="5 4" opacity="0.8"/>`;
    }
  }
  const color = (chart.colors?.[0]) || theme.colors.palette[0];
  points.forEach((p, i) => {
    const highlighted = chart.highlight === i;
    body += `<circle cx="${px(p.x)}" cy="${py(p.y)}" r="${highlighted ? 5.5 : 4.2}" fill="#${highlighted ? c.accent : color}" fill-opacity="${highlighted ? 1 : 0.85}" stroke="#FFFFFF" stroke-width="1.2"/>`;
    if (p.label && points.length <= 14) body += `<text x="${px(p.x) + 7}" y="${py(p.y) - 6}" font-size="9.5" fill="#${c.text}">${esc(truncateLabel(p.label, 120, 9.5))}</text>`;
  });
  return frame(height, body, theme, fonts);
}

// SVG for a chart block, sized to the full content width; renderers scale it.
export function chartSvg(chart, theme, fonts) {
  try {
    switch (chart.chart) {
      case "bar": return barChart(chart, theme, fonts);
      case "stacked_bar": return barChart(chart, theme, fonts, { stacked: true });
      case "stacked": return columnChart(chart, theme, fonts, { stacked: true });
      case "line": return lineChart(chart, theme, fonts);
      case "area": return lineChart(chart, theme, fonts, { area: true });
      case "pie": return pieChart(chart, theme, fonts);
      case "donut": return pieChart(chart, theme, fonts, { donut: true });
      case "scatter": return scatterChart(chart, theme, fonts);
      case "combo":
      case "column":
      default: return columnChart(chart, theme, fonts);
    }
  } catch (error) {
    return "";
  }
}
