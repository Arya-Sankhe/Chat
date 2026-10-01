// Charts. Column, line, area, combo, stacked and donut are native PowerPoint charts, so their
// data stays editable in PowerPoint. Waterfall, ranked bars, progress bars, 100% strips and
// scatter plots are drawn from shapes, where exact control over labels matters more.
import { plain, textWidthPt } from "./measure.js";
import { statusTone } from "./core.js";

function decimalsOf(values) {
  let max = 0;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    const text = String(value);
    const dot = text.indexOf(".");
    if (dot >= 0) max = Math.max(max, Math.min(2, text.length - dot - 1));
  }
  return max;
}

// Whole numbers next to decimals ("381" beside "41.22") keep their own precision instead of all
// gaining trailing zeros ("381.00").
function mixedPrecision(values) {
  const finite = values.filter((value) => value !== null && Number.isFinite(value));
  return finite.some((value) => Number.isInteger(value)) && finite.some((value) => !Number.isInteger(value));
}

function formatCode(chart, values) {
  const decimals = decimalsOf(values);
  const base = decimals ? (mixedPrecision(values) && values.every((value) => value === null || !Number.isFinite(value) || Math.abs(value) < 1000) ? "General" : `#,##0.${"0".repeat(decimals)}`) : "#,##0";
  const unit = String(chart.format || chart.unit || "");
  if (/%/.test(chart.format || "") || /^%$|percent|share|rate \(%\)/i.test(unit.trim())) return `${base}"%"`;
  if (/^[x×]$/i.test(unit.trim())) return `${base}"×"`;
  if (/^[$€£¥]$/.test(unit.trim())) return `"${unit.trim()}"${base}`;
  return base;
}

export function formatNumber(value, chart, values = [value]) {
  if (value === null || !Number.isFinite(value)) return "";
  const decimals = decimalsOf(values);
  const text = value.toLocaleString("en-US", { minimumFractionDigits: mixedPrecision(values) ? 0 : decimals, maximumFractionDigits: decimals });
  const unit = String(chart.format || chart.unit || "").trim();
  if (/%/.test(chart.format || "") || /^%$/.test(unit)) return `${text}%`;
  if (/^[x×]$/i.test(unit)) return `${text}×`;
  if (/^[$€£¥]$/.test(unit)) return value < 0 ? `-${unit}${text.slice(1)}` : `${unit}${text}`;
  return text;
}

function highlightIndex(chart) {
  if (typeof chart.highlight === "number") return chart.highlight;
  if (chart.highlight) {
    const key = plain(chart.highlight).toLowerCase();
    const index = (chart.categories.length ? chart.categories : chart.points.map((point) => point.label)).findIndex((label) => plain(label).toLowerCase() === key);
    if (index >= 0) return index;
  }
  return -1;
}

function baseOptions(p, box) {
  const c = p.theme.colors;
  const face = p.face("body");
  return {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    chartArea: { fill: { color: c.bg }, border: { color: c.bg, pt: 0 } },
    plotArea: { fill: { color: c.bg } },
    catAxisLabelColor: c.muted,
    catAxisLabelFontFace: face,
    catAxisLabelFontSize: 10,
    catAxisLineShow: true,
    catAxisLineColor: c.rule,
    catAxisMajorTickMark: "none",
    valAxisLabelColor: c.faint,
    valAxisLabelFontFace: face,
    valAxisLabelFontSize: 9,
    valAxisLineShow: false,
    valAxisMajorTickMark: "none",
    valGridLine: { color: c.rule, size: 0.5, style: "dash" },
    dataLabelFontFace: face,
    dataLabelFontSize: 10.5,
    dataLabelColor: c.body,
    legendFontFace: face,
    legendFontSize: 10,
    legendColor: c.muted,
    legendPos: "t",
    showTitle: false
  };
}

function nativeColumn(p, box, chart, { horizontal = false, stacked = false, percent = false } = {}) {
  const c = p.theme.colors;
  const values = chart.series.flatMap((series) => series.values);
  const highlight = highlightIndex(chart);
  const options = {
    ...baseOptions(p, box),
    barDir: horizontal ? "bar" : "col",
    // Few bars stay slim instead of filling the slide with two giant blocks.
    barGapWidthPct: chart.categories.length <= 2 ? 220 : chart.categories.length <= 4 ? 120 : 60,
    showValue: true,
    dataLabelFormatCode: formatCode(chart, values),
    dataLabelPosition: stacked ? "ctr" : "outEnd",
    valAxisHidden: !stacked,
    valGridLine: stacked ? { color: c.rule, size: 0.5, style: "dash" } : { style: "none" },
    valAxisMinVal: Math.min(0, ...values.filter(Number.isFinite)),
    catAxisLabelColor: c.body,
    catAxisLabelFontSize: 11
  };
  let data;
  let colors;
  if (chart.series.length === 1) {
    const series = chart.series[0];
    if (highlight >= 0) {
      // One series split in two so the highlighted bar can take the accent colour.
      data = [
        { name: series.name, labels: chart.categories, values: series.values.map((value, index) => (index === highlight ? null : value)) },
        { name: series.name, labels: chart.categories, values: series.values.map((value, index) => (index === highlight ? value : null)) }
      ];
      colors = [c.chartMuted, p.theme.dark ? c.accent : c.accent2 === c.ink ? c.accent : c.accent2];
      // Fully overlapped clustered bars: each category shows exactly one bar, labels sit above.
      options.barGrouping = "clustered";
      options.barOverlapPct = 100;
      options.dataLabelPosition = "outEnd";
    } else {
      data = [{ name: series.name, labels: chart.categories, values: series.values }];
      colors = [p.theme.dark ? c.accent : c.palette[0]];
    }
    options.showLegend = false;
  } else {
    data = chart.series.map((series) => ({ name: series.name, labels: chart.categories, values: series.values }));
    colors = chart.series.map((_, index) => c.palette[index % c.palette.length]);
    options.showLegend = true;
    if (stacked) options.barGrouping = percent ? "percentStacked" : "stacked";
  }
  if (stacked) options.dataLabelColor = p.theme.dark ? c.bg : "FFFFFF";
  options.chartColors = colors;
  p.slide.addChart(p.pptx.ChartType.bar, data, options);
}

// Value-axis bounds for line and area charts: padded around the data, snapped to a round
// step so both ends stay outside the data and the minimum is always below the maximum.
export function lineAxisBounds(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || Math.abs(max) || 1;
  const step = 10 ** Math.floor(Math.log10(span)) / 2;
  // toPrecision (not toFixed, which stops at 100 decimals) strips float noise at any magnitude.
  const round = (value) => Number(value.toPrecision(12));
  let lower = min >= 0 && min - span * 0.6 < 0 ? 0 : round(Math.floor((min - span * 0.25) / step) * step);
  let upper = round(Math.ceil((max + span * 0.18) / step) * step);
  if (lower > min) lower = round(lower - step);
  if (upper <= max || upper <= lower) upper = round(Math.max(max, lower) + step);
  if (Number.isFinite(lower) && Number.isFinite(upper) && lower <= min && upper >= max && lower < upper) return { min: lower, max: upper };
  // Values near the float limits (the span or a step overflows or underflows): plain padding.
  const clamp = (value) => Math.min(Number.MAX_VALUE, Math.max(-Number.MAX_VALUE, value));
  return { min: min > 0 ? 0 : clamp(min * 2), max: max < 0 ? 0 : max === 0 ? 1 : clamp(max * 2) };
}

function nativeLine(p, box, chart, { area = false } = {}) {
  const c = p.theme.colors;
  const values = chart.series.flatMap((series) => series.values).filter(Number.isFinite);
  const bounds = lineAxisBounds(values);
  const options = {
    ...baseOptions(p, box),
    lineSize: 2.25,
    lineDataSymbol: "circle",
    lineDataSymbolSize: 7,
    showValue: chart.series.length <= 2 && chart.categories.length <= 12,
    dataLabelPosition: "t",
    dataLabelFormatCode: formatCode(chart, values),
    showLegend: chart.series.length > 1,
    chartColors: chart.series.map((_, index) => (p.theme.dark ? c.palette : [c.accent, ...c.palette.filter((color) => color !== c.accent)])[index % c.palette.length]),
    valAxisHidden: false,
    valAxisMinVal: bounds.min,
    valAxisMaxVal: bounds.max
  };
  if (area) options.chartColorsOpacity = 30;
  const data = chart.series.map((series) => ({ name: series.name, labels: chart.categories, values: series.values }));
  p.slide.addChart(area ? p.pptx.ChartType.area : p.pptx.ChartType.line, data, options);
}

function nativeCombo(p, box, chart) {
  const c = p.theme.colors;
  const bars = chart.series.filter((series) => series.type !== "line");
  const lines = chart.series.filter((series) => series.type === "line");
  if (!bars.length || !lines.length) return nativeColumn(p, box, chart);
  const barValues = bars.flatMap((series) => series.values);
  const lineValues = lines.flatMap((series) => series.values);
  const types = [
    {
      type: p.pptx.ChartType.bar,
      data: bars.map((series) => ({ name: series.name, labels: chart.categories, values: series.values })),
      options: { barDir: "col", barGrouping: "clustered", chartColors: bars.map((_, index) => [c.chartMuted, c.palette[3]][index % 2]), showValue: true, dataLabelPosition: "inEnd", dataLabelColor: c.body, dataLabelFormatCode: formatCode(chart, barValues), barGapWidthPct: 70 }
    },
    {
      type: p.pptx.ChartType.line,
      data: lines.map((series) => ({ name: series.name, labels: chart.categories, values: series.values })),
      options: { chartColors: lines.map((_, index) => [c.accent, c.accent3][index % 2]), lineSize: 2.25, lineDataSymbol: "circle", lineDataSymbolSize: 7, secondaryValAxis: true, secondaryCatAxis: true, showValue: true, dataLabelPosition: "t", dataLabelColor: c.accent, dataLabelFormatCode: formatCode({ unit: "" }, lineValues) }
    }
  ];
  p.slide.addChart(types, {
    ...baseOptions(p, box),
    showLegend: true,
    valAxes: [
      { showValAxisTitle: false, valAxisHidden: true, valGridLine: { style: "none" }, valAxisMinVal: 0 },
      { showValAxisTitle: false, valAxisHidden: true, valGridLine: { style: "none" }, valAxisMinVal: 0, valAxisMaxVal: Math.max(...lineValues.filter(Number.isFinite)) * 1.35 }
    ],
    catAxes: [{ catAxisTitle: "" }, { catAxisHidden: true }]
  });
}

// Donut with a drawn legend (swatch, label, value) and the total in the hole.
function donut(p, box, chart, { pie = false } = {}) {
  const c = p.theme.colors;
  const points = chart.points.length
    ? chart.points.map((point) => ({ label: point.label, value: point.value }))
    : chart.categories.map((label, index) => ({ label, value: chart.series[0]?.values[index] ?? null }));
  const clean = points.filter((point) => Number.isFinite(point.value) && point.value > 0).slice(0, 7);
  if (!clean.length) return;
  const size = Math.min(box.h, box.w * 0.48);
  const colors = clean.map((_, index) => c.palette[index % c.palette.length]);
  p.slide.addChart(pie ? p.pptx.ChartType.pie : p.pptx.ChartType.doughnut, [{ name: chart.title || "Share", labels: clean.map((point) => point.label), values: clean.map((point) => point.value) }], {
    ...baseOptions(p, { x: box.x, y: box.y + (box.h - size) / 2, w: size, h: size }),
    holeSize: pie ? undefined : 62,
    showLegend: false,
    showValue: false,
    showPercent: false,
    showLabel: false,
    dataBorder: { pt: 1.5, color: c.bg },
    chartColors: colors,
    firstSliceAng: 0
  });
  const total = clean.reduce((sum, point) => sum + point.value, 0);
  if (!pie) {
    // Centre: the total when it means something, else the largest share and its name.
    const hole = size * 0.5;
    const shares = /%/.test(chart.unit || chart.format || "") || Math.abs(total - 100) < 0.6;
    const lead = clean.reduce((best, point) => (point.value > best.value ? point : best), clean[0]);
    const big = shares ? `${formatNumber(lead.value, { unit: "" }, clean.map((point) => point.value))}%` : formatNumber(total, chart, clean.map((point) => point.value));
    const small = shares ? lead.label : chart.unit;
    p.text(big, { x: box.x + (size - hole) / 2, y: box.y + box.h / 2 - 0.26, w: hole }, { role: "number", size: 20, min: 12, color: "ink", align: "center", maxLines: 1 });
    if (small) p.text(small, { x: box.x + (size - hole) / 2, y: box.y + box.h / 2 + 0.06, w: hole }, { size: 8.5, min: 7, color: "muted", align: "center", maxLines: 2 });
  }
  const legendX = box.x + size + 0.35;
  const legendW = box.w - size - 0.35;
  const rowH = Math.min(0.5, box.h / clean.length);
  let y = box.y + (box.h - rowH * clean.length) / 2;
  clean.forEach((point, index) => {
    p.rect({ x: legendX, y: y + 0.07, w: 0.13, h: 0.13 }, { fill: colors[index] });
    const share = total ? `${Math.round((point.value / total) * 1000) / 10}%` : "";
    const value = /%/.test(chart.unit || chart.format || "") ? formatNumber(point.value, chart) : `${formatNumber(point.value, { unit: "" }, clean.map((entry) => entry.value))}${share ? ` · ${share}` : ""}`;
    const valueW = Math.min(1.6, textWidthPt(value, { face: p.face("body"), size: 10.5, bold: true }) / 72 + 0.05);
    p.text(point.label, { x: legendX + 0.24, y: y + 0.02, w: legendW - 0.3 - valueW }, { size: 10.5, min: 8.5, color: "body", maxLines: 2 });
    p.text(value, { x: legendX + legendW - valueW, y: y + 0.02, w: valueW }, { size: 10.5, min: 8.5, color: "ink", bold: true, align: "right", maxLines: 1 });
    y += rowH;
    if (index < clean.length - 1) p.line(legendX, y - 0.04, legendX + legendW, y - 0.04, { color: "rule", width: 0.5 });
  });
}

// Ranked horizontal bars: label | bar | value, optional note under the label.
function hbars(p, box, chart) {
  const points = chart.points.length
    ? chart.points
    : chart.categories.map((label, index) => ({ label, value: chart.series[0]?.values[index] ?? null, note: "", display: "" }));
  const list = points.filter((point) => Number.isFinite(point.value)).slice(0, 10);
  if (!list.length) return;
  const highlight = highlightIndex(chart);
  const max = Math.max(...list.map((point) => Math.abs(point.value)), chart.target || 0) || 1;
  // Short lists get taller rows and larger type rather than a thin strip at the top of the slide.
  const size = list.length <= 3 ? 13 : list.length <= 5 ? 11.5 : 10.5;
  const labelW = Math.min(3, Math.max(1.2, Math.max(...list.map((point) => textWidthPt(point.label, { face: p.face("body"), size }) / 72)) + 0.2), box.w * 0.34);
  const valueW = Math.max(...list.map((point) => textWidthPt(point.display || formatNumber(point.value, chart, list.map((entry) => entry.value)), { face: p.face("body"), size, bold: true }) / 72)) + 0.15;
  const trackX = box.x + labelW;
  const trackW = box.w - labelW - valueW - 0.1;
  const rowH = Math.min(list.length <= 3 ? 1.35 : 0.95, box.h / list.length);
  const barH = Math.min(list.length <= 3 ? 0.6 : 0.42, rowH * 0.5);
  const hasNotes = list.some((point) => point.note);
  const offset = Math.max(0, (box.h - rowH * list.length) * 0.3);
  list.forEach((point, index) => {
    const y = box.y + offset + index * rowH;
    const focus = highlight >= 0 ? index === highlight : index === 0;
    const tone = statusTone(point.status);
    const labelFit = p.text(point.label, { x: box.x, y: y + (hasNotes ? 0.02 : (rowH - size * 1.25 / 72) / 2), w: labelW - 0.15 }, { size, min: 8.5, color: "ink", bold: focus, maxLines: hasNotes ? 1 : 2 });
    if (point.note) p.text(point.note, { x: box.x, y: y + 0.04 + labelFit.height, w: labelW - 0.15 }, { size: size - 2, min: 7.5, color: "muted", maxLines: 1 });
    const barY = y + (rowH - barH) / 2;
    const w = Math.max(0.03, (Math.abs(point.value) / max) * trackW);
    p.rect({ x: trackX, y: barY, w, h: barH }, { fill: tone || (focus ? (p.theme.dark ? "accent" : "accent2") : "chartMuted") });
    const label = point.display || formatNumber(point.value, chart, list.map((entry) => entry.value));
    p.text(label, { x: trackX + w + 0.08, y: barY + (barH - size * 1.25 / 72) / 2, w: valueW + 0.2 }, { size, min: 9, color: "ink", bold: true, maxLines: 1 });
  });
  if (chart.target) {
    const x = trackX + (chart.target / max) * trackW;
    p.line(x, box.y + offset - 0.05, x, box.y + offset + rowH * list.length, { color: "accent", width: 1, dash: "dash" });
    if (chart.targetLabel) p.text(chart.targetLabel, { x: x - 1, y: box.y + offset - 0.25, w: 2 }, { size: 8.5, color: "accent", align: "center", maxLines: 1 });
  }
}

// Waterfall bridge: first/last (or total: true) bars start at zero; the rest float.
function waterfall(p, box, chart) {
  const c = p.theme.colors;
  const points = chart.points.length
    ? chart.points
    : chart.categories.map((label, index) => ({ label, value: chart.series[0]?.values[index] ?? null, total: index === 0 || index === chart.categories.length - 1 }));
  const list = points.filter((point) => Number.isFinite(point.value)).slice(0, 12);
  if (list.length < 2) return;
  let running = 0;
  const explicitTotals = list.some((point) => point.total);
  const bars = list.map((point, index) => {
    const isTotal = explicitTotals ? point.total : index === 0 || index === list.length - 1;
    let from;
    let to;
    if (isTotal) {
      from = 0;
      to = point.value;
      running = point.value;
    } else {
      from = running;
      to = running + point.value;
      running = to;
    }
    return { ...point, isTotal, from, to };
  });
  let lo = Math.min(0, ...bars.map((bar) => Math.min(bar.from, bar.to)));
  const hi = Math.max(...bars.map((bar) => Math.max(bar.from, bar.to)));
  // Small steps against large totals: start the axis near the lowest step so the steps read.
  const floats = bars.filter((bar) => !bar.isTotal);
  if (lo === 0 && floats.length) {
    const floor = Math.min(...floats.map((bar) => Math.min(bar.from, bar.to)));
    if ((hi - floor) / (hi || 1) < 0.45) lo = Math.max(0, floor - (hi - floor) * 1.1);
  }
  const labelH = 0.42;
  const topPad = 0.28;
  const plotY = box.y + topPad;
  const plotH = box.h - topPad - labelH;
  const scale = (value) => plotY + plotH - ((value - lo) / (hi - lo || 1)) * plotH;
  const slot = box.w / bars.length;
  const barW = Math.min(0.9, slot * 0.58);
  const values = list.map((point) => point.value);
  bars.forEach((bar, index) => {
    const x = box.x + index * slot + (slot - barW) / 2;
    const top = scale(Math.max(bar.from, bar.to, lo));
    const bottom = scale(Math.max(lo, Math.min(bar.from, bar.to)));
    const color = bar.isTotal ? (p.theme.dark ? "accent" : "accent2") : bar.value >= 0 ? "positive" : "negative";
    p.rect({ x, y: top, w: barW, h: Math.max(0.02, bottom - top) }, { fill: color });
    const label = (bar.isTotal || bar.value < 0 ? "" : "+") + formatNumber(bar.value, chart, values);
    p.text(bar.display || label, { x: x - 0.3, y: top - 0.24, w: barW + 0.6 }, { size: 9.5, min: 8, color: bar.isTotal ? "ink" : color, bold: true, align: "center", maxLines: 1 });
    p.text(bar.label, { x: box.x + index * slot + 0.02, y: plotY + plotH + 0.07, w: slot - 0.04 }, { size: 9, min: 7.5, color: "muted", align: "center", maxLines: 2 });
    if (index < bars.length - 1) {
      const y = scale(bar.to);
      p.line(x + barW, y, x + slot, y, { color: "faint", width: 0.5, dash: "dash" });
    }
  });
  p.line(box.x, scale(lo), box.x + box.w, scale(lo), { color: c.rule, width: 0.75 });
}

// Progress bars with status: label + note | track with fill | value.
function progress(p, box, chart) {
  const list = chart.points.slice(0, 7);
  if (!list.length) return;
  const rowH = Math.min(0.85, box.h / list.length);
  const labelW = box.w * 0.34;
  const trackW = box.w - labelW - 0.9;
  list.forEach((point, index) => {
    const y = box.y + index * rowH;
    const tone = statusTone(point.status) || "accent";
    p.text(point.label, { x: box.x, y: y + 0.04, w: labelW - 0.2 }, { size: 11.5, min: 9.5, bold: true, color: "ink", maxLines: 1 });
    if (point.note || point.status) p.text(point.note || point.status, { x: box.x, y: y + 0.28, w: labelW - 0.2 }, { size: 9, min: 8, color: point.note ? "muted" : tone, maxLines: 2 });
    const target = point.target || 100;
    const share = Math.max(0, Math.min(1, (point.value || 0) / target));
    const trackY = y + 0.14;
    p.rect({ x: box.x + labelW, y: trackY, w: trackW, h: 0.1 }, { fill: "surfaceStrong" });
    p.rect({ x: box.x + labelW, y: trackY, w: Math.max(0.02, trackW * share), h: 0.1 }, { fill: tone });
    p.text(point.display || `${formatNumber(point.value, { unit: point.target ? "" : "%" })}`, { x: box.x + labelW + trackW + 0.12, y: y + 0.06, w: 0.8 }, { size: 11, min: 9, bold: true, color: tone === "accent" ? "ink" : tone, maxLines: 1 });
  });
}

// 100% strip(s): segments sized by share with labels inside when they fit.
function strips(p, box, chart) {
  const c = p.theme.colors;
  const rowsData = chart.points.length
    ? [{ label: chart.title || "", parts: chart.points.map((point) => ({ label: point.label, value: point.value })) }]
    : chart.categories.map((label, index) => ({ label, parts: chart.series.map((series) => ({ label: series.name, value: series.values[index] })) }));
  const labelW = rowsData.length > 1 ? Math.min(2, box.w * 0.2) : 0;
  const barH = Math.min(rowsData.length === 1 ? 0.75 : 0.5, (box.h - 1.2) / rowsData.length * 0.6);
  const gap = rowsData.length > 1 ? Math.min(0.35, (box.h - 1.2 - barH * rowsData.length) / rowsData.length) : 0;
  const colors = c.palette;
  const legendRows = 2;
  const blockH = rowsData.length * barH + (rowsData.length - 1) * gap + 0.2 + legendRows * 0.3;
  let y = box.y + Math.max(0, (box.h - blockH) * 0.3);
  rowsData.forEach((row) => {
    const parts = row.parts.filter((part) => Number.isFinite(part.value) && part.value > 0);
    const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
    if (labelW) p.text(row.label, { x: box.x, y: y + (barH - 0.2) / 2, w: labelW - 0.15 }, { size: 10, min: 8, bold: true, color: "ink", maxLines: 2 });
    let x = box.x + labelW;
    const width = box.w - labelW;
    parts.forEach((part, index) => {
      const w = (part.value / total) * width;
      const fill = colors[index % colors.length];
      p.rect({ x, y, w, h: barH }, { fill, line: "bg", lineWidth: 1 });
      const share = `${Math.round((part.value / total) * 100)}%`;
      const inside = rowsData.length === 1 ? `${share}` : share;
      if (w > 0.45) p.text(inside, { x: x + 0.06, y: y + (barH - 0.2) / 2, w: w - 0.1 }, { size: 9.5, min: 8, bold: true, color: fill === c.chartMuted || fill === c.palette[2] || fill === c.palette[3] ? "ink" : "FFFFFF", maxLines: 1 });
      x += w;
    });
    y += barH + gap;
  });
  // Legend under the strips.
  const first = rowsData[0].parts.filter((part) => Number.isFinite(part.value) && part.value > 0);
  let lx = box.x + labelW;
  let ly = y + 0.14;
  first.forEach((part, index) => {
    const valueText = rowsData.length === 1 ? ` ${formatNumber(part.value, chart)}` : "";
    const text = `${part.label}${valueText}`;
    const w = textWidthPt(text, { face: p.face("body"), size: 9.5 }) / 72 + 0.45;
    if (lx + w > box.x + box.w) {
      lx = box.x + labelW;
      ly += 0.3;
    }
    p.rect({ x: lx, y: ly + 0.04, w: 0.12, h: 0.12 }, { fill: colors[index % colors.length] });
    p.text(text, { x: lx + 0.2, y: ly, w: w - 0.2 }, { size: 9.5, min: 8, color: "body", maxLines: 1 });
    lx += w + 0.1;
  });
}

// Round axis ticks (1, 2, 2.5 or 5 x 10^n) covering [min, max].
export function niceTicks(min, max, count = 5) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / Math.max(1, count - 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) || 10 * power;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let value = start; ticks.length < 12; value += step) {
    ticks.push(Number(value.toPrecision(12)));
    if (value >= max - step * 1e-9) break;
  }
  return ticks;
}

function tickText(value, ticks) {
  const decimals = Math.min(2, Math.max(0, ...ticks.map((tick) => (String(tick).split(".")[1] || "").length)));
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Scatter / bubble: gridded plot with tick values, labelled points (placed to avoid each other
// and the plot edge), optional axis titles.
function scatter(p, box, chart) {
  const list = chart.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).slice(0, 14);
  if (!list.length) return;
  const highlight = highlightIndex(chart);
  const bounds = (values) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A little room past the outermost dots, then the tick set (4-7 ticks) that wastes the least
    // plot area: a max of 10 gets 0-12, not 0-15.
    const pad = (max - min || Math.abs(max) || 1) * 0.05;
    const from = min >= 0 && min - pad * 3 < 0 ? 0 : min - pad, to = max + pad;
    const ticks = [4, 5, 6, 7].map((count) => niceTicks(from, to, count))
      .reduce((best, next) => (next.at(-1) - next[0] < best.at(-1) - best[0] - 1e-9 ? next : best));
    return { ticks, lo: ticks[0], hi: ticks[ticks.length - 1] };
  };
  const xAxis = bounds(list.map((point) => point.x));
  const yAxis = bounds(list.map((point) => point.y));
  const tickStyle = { size: 8, min: 7, color: "faint", maxLines: 1 };
  const yTickW = Math.max(...yAxis.ticks.map((tick) => textWidthPt(tickText(tick, yAxis.ticks), { face: p.face("body"), size: 8 }))) / 72 + 0.12;
  const titleH = chart.yLabel ? 0.26 : 0;
  const plot = { x: box.x + yTickW, y: box.y + titleH + 0.06, w: box.w - yTickW - 0.1, h: box.h - titleH - 0.06 - (chart.xLabel ? 0.52 : 0.3) };
  const px = (value) => plot.x + ((value - xAxis.lo) / (xAxis.hi - xAxis.lo || 1)) * plot.w;
  const py = (value) => plot.y + plot.h - ((value - yAxis.lo) / (yAxis.hi - yAxis.lo || 1)) * plot.h;
  for (const tick of yAxis.ticks) {
    const y = py(tick);
    p.line(plot.x, y, plot.x + plot.w, y, { color: "rule", width: 0.5, dash: tick === yAxis.lo ? undefined : "dash" });
    p.text(tickText(tick, yAxis.ticks), { x: box.x, y: y - 0.08, w: yTickW - 0.08 }, { ...tickStyle, align: "right" });
  }
  for (const tick of xAxis.ticks) {
    const x = px(tick);
    if (tick !== xAxis.lo) p.line(x, plot.y, x, plot.y + plot.h, { color: "rule", width: 0.5, dash: "dash" });
    p.text(tickText(tick, xAxis.ticks), { x: x - 0.5, y: plot.y + plot.h + 0.05, w: 1 }, { ...tickStyle, align: "center" });
  }
  p.line(plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h, { color: "ruleStrong", width: 0.75 });
  p.line(plot.x, plot.y, plot.x, plot.y + plot.h, { color: "ruleStrong", width: 0.75 });
  if (chart.xLabel) p.text(chart.xLabel, { x: plot.x, y: plot.y + plot.h + 0.27, w: plot.w }, { size: 9, min: 8, color: "muted", align: "center", maxLines: 1 });
  if (chart.yLabel) p.text(chart.yLabel, { x: box.x, y: box.y, w: box.w * 0.8 }, { size: 9, min: 8, color: "muted", maxLines: 1 });

  const sizes = list.map((point) => point.size).filter(Number.isFinite);
  const maxSize = Math.max(...sizes, 1);
  const face = p.face("body");
  const placed = [];
  const overlaps = (a) => placed.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
  // Points first so every label can avoid every dot, then labels, highlighted point first.
  const dots = list.map((point, index) => {
    const d = sizes.length ? 0.16 + 0.34 * Math.sqrt((point.size || 0) / maxSize) : 0.17;
    const dot = { point, index, d, cx: px(point.x), cy: py(point.y), focus: index === highlight };
    placed.push({ x: dot.cx - d / 2, y: dot.cy - d / 2, w: d, h: d });
    return dot;
  });
  dots.forEach((dot) => p.ellipse({ x: dot.cx - dot.d / 2, y: dot.cy - dot.d / 2, w: dot.d, h: dot.d }, { fill: dot.focus ? "accent" : "chartMuted", transparency: sizes.length ? 15 : 0 }));
  [...dots].sort((a, b) => Number(b.focus) - Number(a.focus)).forEach((dot) => {
    const label = plain(dot.point.label);
    const w = Math.min(2.2, textWidthPt(label, { face, size: 9, bold: dot.focus }) / 72 + 0.08);
    const h = 0.2;
    const gap = dot.d / 2 + 0.05;
    const options = [
      { x: dot.cx + gap, y: dot.cy - h / 2 },
      { x: dot.cx - gap - w, y: dot.cy - h / 2 },
      { x: dot.cx - w / 2, y: dot.cy - gap - h },
      { x: dot.cx - w / 2, y: dot.cy + gap },
      { x: dot.cx + gap, y: dot.cy - h - 0.04 },
      { x: dot.cx + gap, y: dot.cy + 0.04 }
    ].map((spot) => ({ ...spot, w, h }));
    const inside = (spot) => spot.x >= plot.x && spot.x + spot.w <= plot.x + plot.w + 0.1 && spot.y >= plot.y - 0.05 && spot.y + spot.h <= plot.y + plot.h;
    const spot = options.find((option) => inside(option) && !overlaps(option)) || options.find(inside) || options[0];
    placed.push(spot);
    const left = spot.x + spot.w <= dot.cx - gap + 0.001;
    p.text(dot.point.label, { x: left ? spot.x - 0.1 : spot.x, y: spot.y, w: spot.w + 0.1 }, { size: 9, min: 8, color: dot.focus ? "ink" : "body", bold: dot.focus, maxLines: 1, align: left ? "right" : spot.x > dot.cx - w / 2 - 0.001 && spot.x < dot.cx ? "center" : "left" });
  });
}

export function drawChart(p, box, chart) {
  // chart.colors (one chart) or style.chart_colors (deck/slide): the first colour is also the highlight.
  const override = chart.colors?.length ? chart.colors : p.theme.chartColors || [];
  if (!override.length) return drawChartType(p, box, chart);
  const theme = p.theme;
  const palette = [...override, ...theme.colors.palette.filter((color) => !override.includes(color))];
  p.theme = { ...theme, colors: { ...theme.colors, palette, accent: override[0] } };
  try {
    return drawChartType(p, box, chart);
  } finally {
    p.theme = theme;
  }
}

function drawChartType(p, box, chart) {
  switch (chart.type) {
    case "hbar": return hbars(p, box, chart);
    case "waterfall": return waterfall(p, box, chart);
    case "progress": return progress(p, box, chart);
    case "stacked100": return strips(p, box, chart);
    case "scatter": return scatter(p, box, chart);
    case "donut": return donut(p, box, chart);
    case "pie": return donut(p, box, chart, { pie: true });
    case "line": return nativeLine(p, box, chart);
    case "area": return nativeLine(p, box, chart, { area: true });
    case "combo": return nativeCombo(p, box, chart);
    case "stacked": return nativeColumn(p, box, chart, { stacked: true });
    case "stackedbar": return nativeColumn(p, box, chart, { stacked: true, horizontal: true });
    default: return nativeColumn(p, box, chart);
  }
}
