// Deck themes. Every font is one PowerPoint ships with (Georgia, Calibri, Arial, Arial Narrow),
// so a downloaded deck opens with the intended type; the worker previews with metric twins.
//
// Tokens
//   colors      page, text and accent colours (hex, no #)
//   fonts       title / body / display faces and the title weight
//   chrome      how the shared slide furniture is drawn (header rule, nav, takeaway, footer)
//   cover       which cover composition the renderer uses

export const THEMES = {
  // Editorial research memo: warm paper, serif claims, brick-red exhibit labels.
  ledger: {
    name: "ledger",
    label: "Ledger",
    dark: false,
    colors: {
      bg: "FAF7F1",
      surface: "F1EBE0",
      surfaceStrong: "E6DDCD",
      ink: "15171C",
      body: "2D3037",
      muted: "6A6D75",
      faint: "A4A6AC",
      rule: "D8D1C3",
      ruleStrong: "15171C",
      accent: "A43C28",
      accent2: "1E2D4A",
      accent3: "B58B45",
      positive: "2E7A57",
      negative: "A43C28",
      warn: "B7791F",
      onAccent: "FFFFFF",
      chartMuted: "BDB6A8",
      palette: ["1E2D4A", "A43C28", "8E97A6", "B58B45", "5C7A8A", "3F4A3C"]
    },
    fonts: { title: "Georgia", titleBold: false, body: "Calibri", display: "Georgia", displayBold: false, number: "Georgia", numberBold: false, label: "Calibri" },
    chrome: { topBar: "ink", eyebrowColor: "accent", nav: "none", headerRule: false, takeaway: "rule-label", footerRule: true, exhibitLabel: "Fig.", emphasis: "accent", cardStyle: "rule", tableHeader: "rule", corner: "none", serifCards: true },
    cover: "ledger"
  },

  // Swiss consulting deck: white, navy type, electric-blue signal, chapter tracker.
  boardroom: {
    name: "boardroom",
    label: "Boardroom",
    dark: false,
    colors: {
      bg: "FFFFFF",
      surface: "F2F5FA",
      surfaceStrong: "E3E9F3",
      ink: "0A1633",
      body: "243149",
      muted: "63708A",
      faint: "A6AEBF",
      rule: "D6DCE7",
      ruleStrong: "0A1633",
      accent: "1F4FE0",
      accent2: "0A1633",
      accent3: "10A5D8",
      positive: "15803D",
      negative: "D92D20",
      warn: "D97706",
      onAccent: "FFFFFF",
      chartMuted: "C3CAD6",
      palette: ["0A1633", "1F4FE0", "7FA7F5", "A3ACBD", "10A5D8", "4A5878"]
    },
    fonts: { title: "Arial", titleBold: true, body: "Arial", display: "Arial", displayBold: true, number: "Arial", numberBold: false, label: "Arial" },
    chrome: { topBar: "none", eyebrowColor: "muted", nav: "text", headerRule: true, takeaway: "band", footerRule: true, exhibitLabel: "Exhibit", emphasis: "accent", cardStyle: "surface", tableHeader: "rule", corner: "none" },
    cover: "boardroom"
  },

  // Dark product / operations review: near-black canvas, cyan and amber signals, soft glows.
  midnight: {
    name: "midnight",
    label: "Midnight",
    dark: true,
    colors: {
      bg: "0A0E16",
      surface: "121A28",
      surfaceStrong: "1A2436",
      ink: "F4F6FA",
      body: "C5CEDB",
      muted: "8592A6",
      faint: "4C586C",
      rule: "253045",
      ruleStrong: "C5CEDB",
      accent: "22CCEE",
      accent2: "F4B740",
      accent3: "A78BFA",
      positive: "34D399",
      negative: "F87171",
      warn: "F4B740",
      onAccent: "0A0E16",
      chartMuted: "3A465A",
      palette: ["22CCEE", "F4B740", "A78BFA", "64748B", "34D399", "F87171"]
    },
    fonts: { title: "Calibri", titleBold: false, body: "Calibri", display: "Calibri", displayBold: true, number: "Calibri", numberBold: false, label: "Calibri" },
    chrome: { topBar: "none", eyebrowColor: "accent", nav: "none", headerRule: false, takeaway: "bar", footerRule: false, exhibitLabel: "", emphasis: "bold", cardStyle: "outline", tableHeader: "rule", corner: "glow", runningHeader: "report" },
    cover: "midnight"
  },

  // Warm campaign / brand deck: cream stock, vermilion + cobalt blocks, condensed display caps.
  atelier: {
    name: "atelier",
    label: "Atelier",
    dark: false,
    colors: {
      bg: "F3EADB",
      surface: "FBF6EE",
      surfaceStrong: "E8DCC7",
      ink: "141414",
      body: "2A2A2A",
      muted: "6F665A",
      faint: "A89E8F",
      rule: "D6C9B3",
      ruleStrong: "141414",
      accent: "E5532D",
      accent2: "2449D6",
      accent3: "141414",
      positive: "2449D6",
      negative: "E5532D",
      warn: "C98A1C",
      onAccent: "FFFFFF",
      chartMuted: "BDB09B",
      palette: ["E5532D", "2449D6", "141414", "B7AA93", "F0A43A", "6C8FD9"]
    },
    fonts: { title: "Arial", titleBold: true, body: "Arial", display: "Arial Narrow", displayBold: true, number: "Arial", numberBold: false, label: "Arial" },
    chrome: { topBar: "none", eyebrowColor: "accent", nav: "none", headerRule: false, takeaway: "block", footerRule: false, exhibitLabel: "", emphasis: "accent", cardStyle: "block", tableHeader: "rule", corner: "none" },
    cover: "atelier"
  },

  // Courseware / lecture / academic defence: clean white, one blue line, friendly callouts.
  academy: {
    name: "academy",
    label: "Academy",
    dark: false,
    colors: {
      bg: "FFFFFF",
      surface: "F3F6FC",
      surfaceStrong: "E4ECFA",
      ink: "15213A",
      body: "2C3A52",
      muted: "6A7790",
      faint: "A9B3C6",
      rule: "DCE3EE",
      ruleStrong: "15213A",
      accent: "2F6BEB",
      accent2: "F07B32",
      accent3: "12A37A",
      positive: "12A37A",
      negative: "E0483E",
      warn: "F07B32",
      onAccent: "FFFFFF",
      chartMuted: "C6D0E0",
      palette: ["2F6BEB", "F07B32", "12A37A", "8A97AD", "7C5CE0", "15213A"]
    },
    fonts: { title: "Calibri", titleBold: false, body: "Calibri", display: "Calibri", displayBold: true, number: "Calibri", numberBold: false, label: "Calibri" },
    chrome: { topBar: "accent", eyebrowColor: "muted", nav: "none", headerRule: false, takeaway: "panel", footerRule: false, exhibitLabel: "", emphasis: "accent", cardStyle: "soft", tableHeader: "rule", corner: "none", runningHeader: "course", sectionFill: "ink" },
    cover: "academy"
  },

  // Strategy / sustainability board paper: deep pine title band, mint panels, lime signal.
  verdant: {
    name: "verdant",
    label: "Verdant",
    dark: false,
    colors: {
      bg: "F7F6F1",
      surface: "E6F3EA",
      surfaceStrong: "D2EADB",
      ink: "0F2119",
      body: "2A3931",
      muted: "66756C",
      faint: "A5B1AA",
      rule: "D3DAD2",
      ruleStrong: "0F2119",
      accent: "0E7A5A",
      accent2: "0B3A2C",
      accent3: "8FCB3F",
      positive: "0E7A5A",
      negative: "C2412D",
      warn: "C98A1C",
      onAccent: "FFFFFF",
      chartMuted: "B9C6BE",
      palette: ["0B3A2C", "0E7A5A", "5DBE8C", "A9B8AF", "8FCB3F", "3E6B8A"]
    },
    fonts: { title: "Arial", titleBold: true, body: "Arial", display: "Arial", displayBold: true, number: "Arial", numberBold: true, label: "Arial" },
    chrome: { topBar: "none", eyebrowColor: "accent", nav: "text", headerRule: false, takeaway: "panel", footerRule: false, exhibitLabel: "", emphasis: "accent", cardStyle: "top", tableHeader: "fill", corner: "none", titleBand: true, numberStyle: "accent" },
    cover: "verdant"
  }
};

// ---------------------------------------------------------------------------------------------
// Extended catalog. Each preset names its page, ink and three accents; neutrals (body, muted,
// rules, surfaces) are derived so every theme keeps readable contrast. accent must read as text
// on bg; accent2 is dark enough to carry white text; accent3 may be a light highlight colour.

function mixHex(a, b, amount) {
  const parse = (hex) => [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return x.map((value, index) => Math.round(value + (y[index] - value) * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function lum(hex) {
  const [r, g, b] = [0, 2, 4].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const FONTS = {
  arial: { title: "Arial", titleBold: true, body: "Arial", display: "Arial", displayBold: true, number: "Arial", numberBold: true, label: "Arial" },
  arialLight: { title: "Arial", titleBold: false, body: "Arial", display: "Arial", displayBold: false, number: "Arial", numberBold: false, label: "Arial" },
  calibri: { title: "Calibri", titleBold: true, body: "Calibri", display: "Calibri", displayBold: true, number: "Calibri", numberBold: false, label: "Calibri" },
  calibriLight: { title: "Calibri", titleBold: false, body: "Calibri", display: "Calibri", displayBold: false, number: "Calibri", numberBold: false, label: "Calibri" },
  condensed: { title: "Arial Narrow", titleBold: true, body: "Arial", display: "Arial Narrow", displayBold: true, number: "Arial Narrow", numberBold: true, label: "Arial" },
  georgia: { title: "Georgia", titleBold: false, body: "Calibri", display: "Georgia", displayBold: false, number: "Georgia", numberBold: false, label: "Calibri" },
  georgiaBold: { title: "Georgia", titleBold: true, body: "Calibri", display: "Georgia", displayBold: true, number: "Georgia", numberBold: true, label: "Calibri" },
  georgiaArial: { title: "Georgia", titleBold: false, body: "Arial", display: "Georgia", displayBold: false, number: "Georgia", numberBold: false, label: "Arial" },
  cambria: { title: "Cambria", titleBold: true, body: "Calibri", display: "Cambria", displayBold: true, number: "Cambria", numberBold: false, label: "Calibri" },
  times: { title: "Times New Roman", titleBold: true, body: "Arial", display: "Times New Roman", displayBold: true, number: "Arial Narrow", numberBold: true, label: "Arial" }
};

const BASE_CHROME = { topBar: "none", eyebrowColor: "accent", nav: "none", headerRule: false, takeaway: "panel", footerRule: false, exhibitLabel: "", emphasis: "accent", cardStyle: "soft", tableHeader: "rule", corner: "none" };

function preset({ name, label, dark = false, bg, ink, accent, accent2, accent3, palette, fonts, chrome = {}, cover, colors = {}, meta }) {
  const tint = (amount) => mixHex(dark ? bg : accent, dark ? ink : bg, amount);
  const derived = dark
    ? { surface: mixHex(bg, ink, 0.07), surfaceStrong: mixHex(bg, ink, 0.13), body: mixHex(ink, bg, 0.2), muted: mixHex(ink, bg, 0.42), faint: mixHex(ink, bg, 0.66), rule: mixHex(ink, bg, 0.8), chartMuted: mixHex(ink, bg, 0.72) }
    : { surface: tint(0.92), surfaceStrong: tint(0.84), body: mixHex(ink, bg, 0.14), muted: mixHex(ink, bg, 0.45), faint: mixHex(ink, bg, 0.66), rule: mixHex(ink, bg, 0.84), chartMuted: mixHex(ink, bg, 0.74) };
  return {
    name,
    label,
    dark,
    colors: {
      bg,
      ...derived,
      ink,
      ruleStrong: ink,
      accent,
      accent2,
      accent3,
      positive: "2E8B57",
      negative: "D14343",
      warn: "D08A1C",
      onAccent: lum(accent) > 0.35 ? (dark ? bg : ink) : "FFFFFF",
      palette: palette || [accent, accent2, accent3, mixHex(ink, bg, 0.55), mixHex(accent, ink, 0.45), mixHex(accent3, bg, 0.35)],
      ...colors
    },
    fonts: FONTS[fonts] || FONTS.calibri,
    chrome: { ...BASE_CHROME, ...chrome },
    cover,
    meta
  };
}

const EXTENDED = [
  // Students: lectures & courses
  preset({ name: "atlas", label: "Deep Blue Atlas", bg: "FFFFFF", ink: "17285A", accent: "2476C9", accent2: "17285A", accent3: "7FC4E8", fonts: "calibriLight", cover: "arcs",
    chrome: { corner: "arcs", takeaway: "bar", cardStyle: "outline", runningHeader: "course", sectionStyle: "light" },
    meta: { group: "students", category: "lecture", description: "Navy and sky blue with concentric arcs: calm, spacious courseware for lectures and workshops.", use: "lectures, workshops, course modules, research methods" } }),
  preset({ name: "pastel", label: "Pastel Derivation", bg: "E7EFF8", ink: "16233F", accent: "2E5EA8", accent2: "16233F", accent3: "E07A3F", fonts: "condensed", cover: "stack",
    chrome: { corner: "dots", runningHeader: "course", coverCaps: true, sectionStyle: "split", sectionFill: "accent" },
    meta: { group: "students", category: "lecture", description: "Pastel blueprint paper with condensed headings, built for derivations and step-by-step lectures.", use: "maths, physics and engineering lectures, derivations, problem sets" } }),
  preset({ name: "chalk", label: "Chalkboard", dark: true, bg: "1E3A34", ink: "F3EFE2", accent: "F2C94C", accent2: "3F7A6C", accent3: "F28B6B", fonts: "georgia", cover: "centered",
    chrome: { corner: "frame", takeaway: "bar", cardStyle: "outline", sectionStyle: "light" },
    meta: { group: "students", category: "lecture", description: "A green chalkboard with warm chalk colours: friendly for teaching, revision and classroom talks.", use: "teaching, revision sessions, school lessons" } }),
  // Students: research & thesis
  preset({ name: "defense", label: "Teal Academic Defense", bg: "FFFFFF", ink: "13302E", accent: "0F7C74", accent2: "0B3B38", accent3: "F07A2B", fonts: "arialLight", cover: "split",
    chrome: { nav: "text", headerRule: true, footerRule: true, cardStyle: "top", tableHeader: "fill", sectionStyle: "split", exhibitLabel: "Fig." },
    meta: { group: "students", category: "research", description: "Deep teal with an orange signal and a section tracker: a rigorous look for thesis defences.", use: "thesis and dissertation defences, research proposals, lab talks" } }),
  preset({ name: "paper", label: "Paper White Study", bg: "FAF6EE", ink: "1D3B2A", accent: "2F7D4F", accent2: "1D3B2A", accent3: "F0835A", fonts: "calibri", cover: "arcs",
    chrome: { takeaway: "rule-label", cardStyle: "rule", sectionStyle: "light", exhibitLabel: "Fig." },
    meta: { group: "students", category: "research", description: "Warm paper, forest-green headings and a coral highlight for findings-driven study reports.", use: "study reports, experiment write-ups, psychology and social-science findings" } }),
  preset({ name: "journal", label: "Wine Red Data", bg: "FBF4F2", ink: "2A1215", accent: "9B1B30", accent2: "5C0F1C", accent3: "C9A27E", fonts: "condensed", cover: "magazine",
    chrome: { headerRule: true, cardStyle: "top", exhibitLabel: "Fig." },
    meta: { group: "students", category: "research", description: "Blush paper and wine-red data ink with a technical-drawing cover. Made for quantitative results.", use: "quantitative research, data-heavy results, industry analysis papers" } }),
  preset({ name: "scholar", label: "Scholar", bg: "F7F3EA", ink: "1F2A24", accent: "7A5C1E", accent2: "1F3D33", accent3: "B8913A", fonts: "cambria", cover: "centered",
    chrome: { corner: "frame", takeaway: "rule-label", cardStyle: "rule", serifCards: true, exhibitLabel: "Fig.", sectionFill: "accent2" },
    meta: { group: "students", category: "research", description: "Classic serif on ivory with deep green and antique gold: humanities seminars and literature reviews.", use: "humanities, history, literature reviews, philosophy seminars" } }),
  // Students: group projects
  preset({ name: "sage", label: "Sage Group Project", bg: "FBF8EF", ink: "2F3A1C", accent: "5F7432", accent2: "3E4A22", accent3: "A9BF8A", fonts: "georgiaBold", cover: "organic",
    chrome: { corner: "leaves", sectionStyle: "light" },
    meta: { group: "students", category: "group", description: "Soft sage leaves on cream with an olive serif: a gentle, aesthetic group-project deck.", use: "group projects, biology, environment and wellbeing topics" } }),
  preset({ name: "meadow", label: "Green Meadow", bg: "E8F1DE", ink: "1F3510", accent: "3F6B1F", accent2: "1F3510", accent3: "8CB369", fonts: "arial", cover: "organic",
    chrome: { corner: "leaves", coverCaps: true, sectionStyle: "split" },
    meta: { group: "students", category: "group", description: "Fresh mint with bold dark-green caps and leaf corners. Bright and upbeat for team presentations.", use: "group projects, school presentations, nature and sustainability" } }),
  preset({ name: "lagoon", label: "Lagoon", bg: "DDEFEC", ink: "12403C", accent: "1C716B", accent2: "12403C", accent3: "7CC6BC", fonts: "georgia", cover: "arcs",
    chrome: { corner: "blob", sectionStyle: "light" },
    meta: { group: "students", category: "group", description: "Seafoam with deep-teal serif titles and soft blobs: elegant for technology or science group work.", use: "technology group projects, cybersecurity, science topics" } }),
  preset({ name: "terracotta", label: "Terracotta", bg: "FBEBDD", ink: "3E2418", accent: "A0522D", accent2: "4A2C1D", accent3: "E4B58F", fonts: "arial", cover: "poster",
    chrome: { corner: "blob", coverCaps: true, coverFill: "accent3", sectionStyle: "split" },
    meta: { group: "students", category: "group", description: "Peach and chocolate with bold caps and organic shapes. Warm and playful.", use: "arts, design, culture and creative group projects" } }),
  // Students: class presentations
  preset({ name: "sunny", label: "Blue & Yellow Geometric", bg: "FFFFFF", ink: "13265C", accent: "1D3F9A", accent2: "1D3F9A", accent3: "F2D300", fonts: "arial", cover: "geometric",
    chrome: { corner: "block", takeaway: "block", cardStyle: "outline", tableHeader: "fill", sectionStyle: "split", sectionFill: "accent" },
    meta: { group: "students", category: "class", description: "Cobalt and sunshine yellow with rings and crosses. Energetic frameworks and business-class assignments.", use: "class assignments, business studies, frameworks like SWOT or lean canvas" } }),
  preset({ name: "mindmap", label: "Colourful Mind Map", bg: "F8F7FD", ink: "2B2350", accent: "6A4FE8", accent2: "2B2350", accent3: "FF8A65", fonts: "arial", cover: "geometric",
    palette: ["6A4FE8", "F25F7A", "1FB5A8", "F2A516", "4F86E8", "8C5BD6"],
    chrome: { corner: "dots", geoStyle: "dots", sectionStyle: "light" },
    meta: { group: "students", category: "class", description: "Playful multicolour infographics on lavender white, for concept maps, brainstorms and explainers.", use: "concept maps, brainstorms, explainers, younger audiences" } }),
  preset({ name: "bloom", label: "Pink Minimalist", bg: "F7EDEF", ink: "3A2530", accent: "9A4F6B", accent2: "5E3346", accent3: "E8B8C8", fonts: "georgia", cover: "centered",
    chrome: { corner: "frame", coverCaps: true, coverSpacing: 6, sectionStyle: "light" },
    meta: { group: "students", category: "class", description: "Blush pink, widely spaced serif caps and a fine frame: a soft, minimal proposal look.", use: "proposals, personal projects, fashion, lifestyle and design classes" } }),
  preset({ name: "minimal", label: "Black & Yellow Minimal", bg: "FFFFFF", ink: "111111", accent: "9A6F12", accent2: "111111", accent3: "F6E3B0", fonts: "arial", cover: "centered",
    chrome: { corner: ["brackets", "tabs"], coverCaps: true, takeaway: "rule-label", cardStyle: "rule", sectionStyle: "light" },
    meta: { group: "students", category: "class", description: "Crisp black type, corner brackets and butter-yellow tabs. A clean default for any class talk.", use: "general class presentations, reports, short talks" } }),
  preset({ name: "studio", label: "Final Project", bg: "F8F4EC", ink: "2D2A26", accent: "8C6D46", accent2: "3B342C", accent3: "CDBA96", fonts: "calibriLight", cover: "stack",
    chrome: { runningHeader: "course", takeaway: "rule-label", cardStyle: "rule", sectionStyle: "light" },
    meta: { group: "students", category: "class", description: "Beige, taupe and light type with a running header. Quiet and considered for final projects.", use: "final projects, design and UX case studies, capstones" } }),
  preset({ name: "notebook", label: "Notebook", bg: "FDFCF8", ink: "1F2A44", accent: "C8413A", accent2: "2F5DA8", accent3: "F7DC6F", fonts: "calibri", cover: "band",
    chrome: { corner: "margin", takeaway: "rule-label", cardStyle: "rule", sectionStyle: "light" },
    meta: { group: "students", category: "class", description: "Exercise-book white with a red margin line and a highlighter-yellow band, for study notes and revision.", use: "study notes, revision summaries, book reports, school subjects" } }),

  // Work: business & strategy
  preset({ name: "harbor", label: "Blue Company Profile", bg: "F6F7F9", ink: "0E1B3D", accent: "1747C9", accent2: "1747C9", accent3: "8FB0F5", fonts: "arial", cover: "split",
    chrome: { corner: "sidebar", takeaway: "band", cardStyle: "surface", tableHeader: "fill", sectionStyle: "split", sectionFill: "accent" },
    meta: { group: "work", category: "business", description: "Royal blue panels on cool white: a confident company profile or proposal.", use: "company profiles, business proposals, services overviews" } }),
  preset({ name: "cobalt", label: "Navy & Gold", bg: "FFFFFF", ink: "1B2A5C", accent: "2A4FA8", accent2: "1B2A5C", accent3: "D4A93C", fonts: "arial", cover: "centered",
    chrome: { corner: "ribbons", coverCaps: true, takeaway: "band", cardStyle: "outline", sectionFill: "accent2" },
    meta: { group: "work", category: "business", description: "Navy with gold ribbon corners and spaced caps. Polished and formal.", use: "formal business presentations, methodology, institutional updates" } }),
  preset({ name: "onyx", label: "Onyx", dark: true, bg: "1B1B1B", ink: "F2F2F2", accent: "A9C4FF", accent2: "3A3A3A", accent3: "8A8A8A", fonts: "arialLight", cover: "gradient",
    chrome: { corner: "none", takeaway: "bar", cardStyle: "outline", sectionStyle: "light" },
    meta: { group: "work", category: "business", description: "Charcoal and white with light type: understated and modern, lets the content lead.", use: "general business talks, portfolios, product and design reviews" } }),
  // Work: pitch decks
  preset({ name: "launch", label: "Startup Launch", bg: "F3F5F8", ink: "2E3136", accent: "2F6FE0", accent2: "2E3136", accent3: "A7C7F2", fonts: "arial", cover: "gradient",
    chrome: { corner: "glow", sectionStyle: "split", sectionFill: "accent2" },
    meta: { group: "work", category: "pitch", description: "Frosted blue gradients with heavy charcoal type. A modern startup pitch.", use: "startup pitch decks, product launches, fundraising" } }),
  preset({ name: "aurora", label: "Aurora", dark: true, bg: "07090F", ink: "F1F3F8", accent: "6E9BFF", accent2: "2A3550", accent3: "F5A25D", fonts: "arialLight", cover: "gradient",
    chrome: { corner: "glow", takeaway: "bar", cardStyle: "outline", sectionStyle: "light" },
    meta: { group: "work", category: "pitch", description: "Night-sky black with blue and amber light, for keynotes and bold pitches.", use: "keynotes, AI and tech pitches, vision talks" } }),
  preset({ name: "crimson", label: "Red & Pink Bold", bg: "FFF1F3", ink: "5E0B16", accent: "A3162B", accent2: "6E0F1A", accent3: "F7B8C4", fonts: "condensed", cover: "poster",
    chrome: { coverCaps: true, coverFill: "accent2", takeaway: "block", cardStyle: "top", sectionFill: "accent2" },
    meta: { group: "work", category: "pitch", description: "Wine red and blush with huge condensed caps: a loud, confident pitch.", use: "bold pitches, consulting offers, sales decks" } }),
  preset({ name: "coral", label: "Coral Minimal", bg: "FFFFFF", ink: "1A1A1A", accent: "D9472F", accent2: "1A1A1A", accent3: "F6B7A8", fonts: "arial", cover: "gradient",
    chrome: { takeaway: "bar", cardStyle: "rule", sectionStyle: "light" },
    meta: { group: "work", category: "pitch", description: "White, black and one coral glow. A clean, professional company pitch.", use: "company pitch decks, SaaS, B2B software" } }),
  preset({ name: "mint", label: "Mint Startup", bg: "EEF2EC", ink: "173B33", accent: "1F6F5C", accent2: "173B33", accent3: "9CCFBF", fonts: "arial", cover: "stack",
    chrome: { corner: "dots", cardStyle: "outline", sectionStyle: "split" },
    meta: { group: "work", category: "pitch", description: "Soft mint and deep teal with outlined cards, fresh for startup and services pitches.", use: "startup pitches, services, health and fintech" } }),
  preset({ name: "linen", label: "Cream Neutral", bg: "ECEAE4", ink: "2B2B2B", accent: "6E5B45", accent2: "2B2B2B", accent3: "B9A88E", fonts: "georgia", cover: "stack",
    chrome: { runningHeader: "course", takeaway: "rule-label", cardStyle: "rule", serifCards: true, sectionStyle: "light" },
    meta: { group: "work", category: "pitch", description: "Warm linen, serif headlines and spaced labels. Calm and premium.", use: "new-business pitches, agencies, mission and vision decks" } }),
  // Work: reports & reviews
  preset({ name: "violet", label: "Electric Violet", bg: "FFFFFF", ink: "15121F", accent: "5B2BE0", accent2: "15121F", accent3: "A78BFA", fonts: "arial", cover: "split",
    chrome: { nav: "text", cardStyle: "top", sectionStyle: "split", sectionFill: "accent" },
    meta: { group: "work", category: "report", description: "Black panels and electric violet data for sharp quarterly and operations reviews.", use: "quarterly business reviews, operations reports, KPI scorecards" } }),
  preset({ name: "sky", label: "Sky Blue Wayfinding", bg: "FFFFFF", ink: "0F2350", accent: "1F5FD6", accent2: "0F2350", accent3: "9CC3F5", fonts: "georgiaArial", cover: "band",
    chrome: { corner: "block", coverFill: "accent", takeaway: "band", cardStyle: "surface", sectionFill: "accent" },
    meta: { group: "work", category: "report", description: "Clear blues with serif headlines and a wayfinding band. Public-service and operations reports.", use: "public-sector reports, service reviews, operations updates" } }),
  preset({ name: "lifeline", label: "Aqua Impact Report", bg: "F6F3EA", ink: "1C2B3A", accent: "1C6FB8", accent2: "1C2B3A", accent3: "F5C400", fonts: "georgia", cover: "band",
    chrome: { coverCaps: true, coverSpacing: 3, takeaway: "rule-label", cardStyle: "top", tableHeader: "fill", sectionStyle: "light" },
    meta: { group: "work", category: "report", description: "Spaced serif caps, water blue and a sunshine-yellow band, for impact and charity reports.", use: "impact reports, NGOs and charities, conservation, annual summaries" } }),
  preset({ name: "annual", label: "Annual Report", bg: "FAF7EF", ink: "141414", accent: "946600", accent2: "141414", accent3: "F2C14E", fonts: "condensed", cover: "magazine",
    chrome: { coverCaps: true, takeaway: "block", cardStyle: "rule", sectionStyle: "split", sectionFill: "accent2" },
    meta: { group: "work", category: "report", description: "Black condensed caps with golden-yellow figures. A board-ready annual operations report.", use: "annual reports, board reviews, operations results" } }),
  preset({ name: "clay", label: "Warm Clay", bg: "FBF6EE", ink: "3A2A20", accent: "B0532A", accent2: "5A3522", accent3: "E7B89A", fonts: "georgia", cover: "arcs",
    chrome: { corner: "blob", takeaway: "rule-label", cardStyle: "soft", sectionStyle: "light" },
    meta: { group: "work", category: "report", description: "Terracotta and cream with a soft serif. Warm for impact summaries and people-focused reports.", use: "impact summaries, community programmes, HR and people reports" } }),
  preset({ name: "slate", label: "Slate History", dark: true, bg: "2A2724", ink: "EDE6DA", accent: "D2B48C", accent2: "8C7A62", accent3: "C9A77C", fonts: "georgia", cover: "poster",
    chrome: { corner: "frame", coverCaps: true, coverFill: "bg", takeaway: "bar", cardStyle: "outline", sectionStyle: "light" },
    meta: { group: "work", category: "report", description: "Sepia charcoal with tall serif caps and a fine frame, for history, heritage and retrospectives.", use: "history, heritage, retrospectives, project histories" } }),
  // Work: finance & investment
  preset({ name: "goldleaf", label: "Black Gold Ledger", dark: true, bg: "0F0F10", ink: "F4EFE4", accent: "D4A64A", accent2: "5E4A1F", accent3: "E8C77A", fonts: "condensed", cover: "stack",
    chrome: { coverCaps: true, takeaway: "bar", cardStyle: "outline", sectionStyle: "light" },
    meta: { group: "work", category: "finance", description: "Black and gold with condensed caps. Premium for VC, market monitors and investor updates.", use: "venture capital reports, market monitors, investor updates" } }),
  preset({ name: "indigo", label: "Indigo Due Diligence", bg: "FFFFFF", ink: "141B3D", accent: "2432A0", accent2: "141B3D", accent3: "7C8BE0", fonts: "georgia", cover: "boardroom",
    chrome: { nav: "text", headerRule: true, footerRule: true, takeaway: "band", cardStyle: "surface", exhibitLabel: "Exhibit" },
    meta: { group: "work", category: "finance", description: "Indigo line work and serif titles in a banker's layout, for due diligence and valuation.", use: "due diligence, M&A, valuation, investment committee papers" } }),
  preset({ name: "memo", label: "Honey Investment Memo", bg: "F5EEE2", ink: "1E2433", accent: "C0501C", accent2: "1E2433", accent3: "E8A33D", fonts: "times", cover: "stack",
    chrome: { nav: "text", headerRule: true, takeaway: "block", cardStyle: "top", tableHeader: "fill", sectionStyle: "split" },
    meta: { group: "work", category: "finance", description: "Honey paper, navy and rust with a headline number, for investment-committee memos.", use: "investment memos, credit papers, deal approvals" } }),
  preset({ name: "ebony", label: "Ebony Ledger", bg: "F3EFE8", ink: "1C1C1C", accent: "2E7D5B", accent2: "1C1C1C", accent3: "9CC5AE", fonts: "georgiaArial", cover: "ledger",
    chrome: { topBar: "ink", takeaway: "rule-label", footerRule: true, cardStyle: "rule", serifCards: true, exhibitLabel: "Fig." },
    meta: { group: "work", category: "finance", description: "Editorial serif on stone with a green ledger accent: asset allocation and strategy notes.", use: "asset allocation, economic outlooks, strategy notes" } }),
  // Work: marketing & brand
  preset({ name: "brief", label: "Red Creative Brief", bg: "FFFFFF", ink: "111111", accent: "D9321C", accent2: "111111", accent3: "FF6A4D", fonts: "condensed", cover: "poster",
    chrome: { corner: "block", coverCaps: true, takeaway: "block", cardStyle: "block", sectionFill: "accent" },
    meta: { group: "work", category: "marketing", description: "Signal red and black condensed caps: a punchy creative brief or campaign deck.", use: "creative briefs, campaigns, social media plans, agencies" } }),
  preset({ name: "magazine", label: "Silk Yellow Magazine", bg: "EDEAE3", ink: "1A1A1A", accent: "C23A24", accent2: "1A1A1A", accent3: "F4D03F", fonts: "arial", cover: "band",
    chrome: { coverCaps: true, takeaway: "block", tableHeader: "fill", sectionStyle: "split", sectionFill: "accent2" },
    meta: { group: "work", category: "marketing", description: "Magazine grey with yellow tabs and bold caps, for trend reports and consumer insight.", use: "trend reports, consumer insight, retail and hospitality" } }),
  preset({ name: "luxe", label: "Silver Luxury", bg: "F6F5F2", ink: "1E1E1E", accent: "8C6A2E", accent2: "1E1E1E", accent3: "CDB27A", fonts: "georgia", cover: "split",
    chrome: { corner: "frame", takeaway: "rule-label", cardStyle: "rule", serifCards: true, sectionStyle: "light" },
    meta: { group: "work", category: "marketing", description: "Silver, black and champagne gold with a quiet serif, for luxury brands and annual brand reviews.", use: "luxury and lifestyle brands, brand reviews, premium products" } })
];

const CORE_META = {
  ledger: { group: "work", category: "finance", description: "Warm paper, serif claims and brick-red exhibit labels: an editorial research memo.", use: "investment memos, research, economics, policy, history, literature, annual reports" },
  boardroom: { group: "work", category: "business", description: "Crisp Swiss consulting look in navy and electric blue, with a chapter tracker.", use: "business strategy, operations, market analysis, proposals; the general professional default" },
  midnight: { group: "work", category: "report", description: "Near-black canvas with cyan and amber signals, for product and engineering reviews.", use: "technology, AI, software, product launches, engineering reviews" },
  atelier: { group: "work", category: "marketing", description: "Cream stock with vermilion and cobalt blocks and condensed display caps.", use: "marketing, brand, events, campaigns, travel, food, culture, creative pitches" },
  academy: { group: "students", category: "lecture", description: "Navy title slide, then clean white pages with one blue line and friendly callouts: courseware for lectures and study sessions.", use: "lectures, courses, study notes, school or university topics, tutorials" },
  verdant: { group: "work", category: "business", description: "Deep pine title bands, mint panels and a lime signal, for strategy and sustainability papers.", use: "sustainability, climate, health, science outreach, ESG, green-brand strategy" }
};
for (const [name, meta] of Object.entries(CORE_META)) THEMES[name].meta = meta;
for (const entry of EXTENDED) THEMES[entry.name] = entry;

export const THEME_GROUPS = [
  { id: "students", label: "Students", categories: [
    { id: "lecture", label: "Lectures & courses" },
    { id: "research", label: "Research & thesis" },
    { id: "group", label: "Group projects" },
    { id: "class", label: "Class presentations" }
  ] },
  { id: "work", label: "Work", categories: [
    { id: "business", label: "Business & strategy" },
    { id: "pitch", label: "Pitch decks" },
    { id: "report", label: "Reports & reviews" },
    { id: "finance", label: "Finance & investment" },
    { id: "marketing", label: "Marketing & brand" }
  ] }
];

export const THEME_NAMES = Object.keys(THEMES);

// Fallback theme choice when the deck writer did not pick one.
export function chooseTheme(text = "") {
  const value = String(text).toLowerCase();
  if (/\b(lecture|lesson|course|class|module|student|teach|exam|study|thesis|defen[cs]e|research method|homework|university|school|chapter|syllabus|tutorial)\b/.test(value)) return "academy";
  if (/\b(sustainab|climate|esg|carbon|energy transition|green|environment|wetland|biodiversity|health|wellbeing|agricultur|nature)\b/.test(value)) return "verdant";
  if (/\b(brand|campaign|marketing|event|festival|launch party|creative|design|fashion|travel|tourism|food|restaurant|culture|community)\b/.test(value)) return "atelier";
  if (/\b(ai|software|product|platform|tech|engineering|robot|autonomous|cyber|data platform|cloud|startup|devops|operations review|fleet)\b/.test(value)) return "midnight";
  if (/\b(investment|due diligence|valuation|m&a|acquisition|equity|portfolio|memo|macro|research report|annual report|economics|policy|history|literature)\b/.test(value)) return "ledger";
  return "boardroom";
}

export function resolveTheme(name, text = "") {
  return THEMES[String(name || "").toLowerCase()] || THEMES[chooseTheme(text)];
}
