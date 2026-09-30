// Style overrides: how a deck (deck.style) or one slide (slide.style) departs from its theme.
// This is what makes "make the titles dark green", "remove the footer" or "use Georgia for
// headings" an exact, re-renderable edit instead of a hand-patched file.
//
// style
//   colors        { <theme colour token>: "RRGGBB" }   e.g. accent, accent2, ink, body, bg, surface
//   title_color, subtitle_color, eyebrow_color, body_color, takeaway_color, takeaway_fill,
//   footer_color, background                            "RRGGBB" for that one element
//   chart_colors  ["RRGGBB", ...]                        series / bar colours, in order
//   title_font, body_font                                one of FONT_CHOICES
//   hide          [HIDEABLE...]   show [HIDEABLE...]     slide.style.show re-enables a deck-wide hide
import { THEMES } from "./themes.js";

export const HIDEABLE = ["footer", "page_number", "source", "footer_label", "running_header", "nav", "eyebrow", "subtitle", "takeaway", "top_bar", "header_rule", "decoration"];

// Office fonts whose metrics the renderer can measure (directly or through a close twin), so
// text still fits after a font change and the preview matches PowerPoint.
export const FONT_CHOICES = ["Arial", "Arial Narrow", "Calibri", "Georgia", "Cambria", "Times New Roman"];

const ROLE_KEYS = {
  title_color: "title",
  subtitle_color: "subtitle",
  eyebrow_color: "eyebrow",
  body_color: "body",
  takeaway_color: "takeaway",
  takeaway_fill: "takeawayFill",
  footer_color: "footer",
  background: "background"
};

const TOKENS = new Set(Object.keys(THEMES.boardroom.colors).filter((key) => key !== "palette"));

export function hex(value) {
  const text = String(value ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(text)) return text.split("").map((char) => char + char).join("").toUpperCase();
  return "";
}

function names(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  return list.map((entry) => String(entry).toLowerCase().replace(/[\s-]+/g, "_").replace(/^page_numbers$/, "page_number")).filter((entry) => HIDEABLE.includes(entry));
}

function font(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return FONT_CHOICES.find((choice) => choice.toLowerCase() === text) || "";
}

export function normalizeStyle(raw) {
  if (!raw || typeof raw !== "object") return null;
  const colors = {};
  for (const [key, value] of Object.entries(raw.colors && typeof raw.colors === "object" ? raw.colors : {})) {
    const color = hex(value);
    if (color && TOKENS.has(key)) colors[key] = color;
  }
  const roles = {};
  for (const [key, role] of Object.entries(ROLE_KEYS)) {
    const color = hex(raw[key]);
    if (color) roles[role] = color;
  }
  const chartColors = (Array.isArray(raw.chart_colors) ? raw.chart_colors : []).map(hex).filter(Boolean).slice(0, 8);
  const out = {
    colors,
    roles,
    chartColors,
    titleFont: font(raw.title_font),
    bodyFont: font(raw.body_font),
    hide: names(raw.hide),
    show: names(raw.show)
  };
  const empty = !Object.keys(colors).length && !Object.keys(roles).length && !chartColors.length && !out.titleFont && !out.bodyFont && !out.hide.length && !out.show.length;
  return empty ? null : out;
}

// The theme one slide is drawn with: base theme + deck style + slide style.
export function styledTheme(theme, deckStyle, slideStyle) {
  const layers = [deckStyle, slideStyle].filter(Boolean);
  const hidden = new Set();
  const roles = {};
  const colors = { ...theme.colors };
  const fonts = { ...theme.fonts };
  for (const layer of layers) {
    Object.assign(colors, layer.colors);
    Object.assign(roles, layer.roles);
    if (layer.chartColors.length) colors.palette = [...layer.chartColors, ...theme.colors.palette.filter((color) => !layer.chartColors.includes(color))];
    // Big numbers follow the headline face when the theme pairs them, otherwise the body face.
    const numberFollowsTitle = theme.fonts.number === theme.fonts.title;
    if (layer.titleFont) Object.assign(fonts, { title: layer.titleFont, display: layer.titleFont }, numberFollowsTitle ? { number: layer.titleFont } : {});
    if (layer.bodyFont) Object.assign(fonts, { body: layer.bodyFont, label: layer.bodyFont }, numberFollowsTitle ? {} : { number: layer.bodyFont });
    layer.hide.forEach((name) => hidden.add(name));
    layer.show.forEach((name) => hidden.delete(name));
  }
  if (roles.background) colors.bg = roles.background;
  if (roles.body) colors.body = roles.body;
  const chartColors = [...layers].reverse().find((layer) => layer.chartColors.length)?.chartColors || [];
  return { ...theme, colors, fonts, roles, hidden, chartColors };
}
