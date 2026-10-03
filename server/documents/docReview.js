// Deterministic review of a written DocSpec before it is rendered: the problems a reader would
// notice at a glance (placeholders, empty sections, fake-looking data, the wrong furniture for a
// formal format, a length far from what was asked). Each note tells the writer exactly what to
// fix; the score ranks drafts.
import { blockText, plain } from "../../worker/doc/spec.js";

const PLACEHOLDER = /\[(?:your|insert|name|date|company|course|instructor|student|title|address|phone|email|link|x+)[^\]]{0,40}\]|\bTBD\b|\bTBA\b|lorem ipsum|\bXX+%?|\?\?\?|<[a-z ]+here>/i;
const LEAK = /\b(?:the (?:provided|supplied|given) (?:material|text|notes|content)|the material (?:says|shows|provided)|as requested by the user|the brief|the assistant)\b/i;
const FORMAL = new Set(["mla", "apa"]);
const CV = new Set(["cv", "cv_modern"]);

function words(text) {
  return plain(text).split(/\s+/).filter(Boolean).length;
}

function requestedLength(request) {
  const text = String(request || "").toLowerCase();
  const wordsMatch = text.match(/(\d[\d,]{1,6})\s*(?:-|to|–)?\s*(\d[\d,]{1,6})?\s*words?\b/);
  if (wordsMatch) {
    const low = Number(wordsMatch[1].replace(/,/g, ""));
    const high = wordsMatch[2] ? Number(wordsMatch[2].replace(/,/g, "")) : low;
    if (low >= 100 && low <= 20000) return { words: (low + high) / 2, low, high };
  }
  const pagesMatch = text.match(/\b(\d{1,2}|one|two|three|four|five|six|eight|ten)[\s-]*(?:-|to)?\s*(?:\d{1,2})?\s*pages?\b/);
  if (pagesMatch) {
    const map = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10 };
    const pages = map[pagesMatch[1]] || Number(pagesMatch[1]);
    if (pages >= 1 && pages <= 40) return { pages };
  }
  return null;
}

function requestedCount(request, noun) {
  const text = String(request || "").toLowerCase();
  const match = text.match(new RegExp(`\\b(\\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:\\w+\\s+){0,2}${noun}`));
  if (!match) return 0;
  const map = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return map[match[1]] || Number(match[1]);
}

export function reviewDoc(doc, { userRequest = "" } = {}) {
  const notes = [];
  let score = 0;
  const note = (text, weight = 1) => {
    if (notes.length < 14) notes.push(text);
    score += weight;
  };
  const blocks = doc?.blocks || [];
  const style = doc?.style || "report";
  const texts = [doc?.title, doc?.subtitle, doc?.kicker, ...(doc?.meta || []).map((item) => `${item.label} ${item.value}`), ...blocks.map(blockText)].filter(Boolean);
  const all = texts.join("\n");
  const totalWords = blocks.reduce((sum, block) => sum + words(blockText(block)), 0);

  const placeholder = all.match(PLACEHOLDER);
  if (placeholder) note(`Placeholder text "${placeholder[0]}" appears; replace it with the real detail from the request or remove that line.`, 4);
  const leak = all.match(LEAK);
  if (leak) note(`The text mentions "${leak[0]}"; the reader never saw the brief, so name the real source or rephrase.`, 3);
  if (!doc?.title && !CV.has(style)) note("The document has no title; add one in the front matter.", 2);
  // A token mixing scripts ("−0.ола", "Rеvenue") is a generation glitch the reader will spot.
  const garbled = all.match(/[0-9A-Za-z.,][\u0400-\u04FF\u0370-\u03FF]+|[\u0400-\u04FF]+[A-Za-z0-9]/);
  if (garbled && !/[\u0400-\u04FF]{4,}\s+[\u0400-\u04FF]{4,}/.test(all)) note(`The text contains a garbled token "${garbled[0]}"; write the intended value.`, 3);

  // Sections that are only a heading.
  blocks.forEach((block, index) => {
    const next = blocks[index + 1];
    if (block.type === "heading" && (!next || (next.type === "heading" && next.level <= block.level))) {
      note(`The section "${plain(block.text)}" has no content; write it or remove the heading.`, 2);
    }
  });
  // A heading that only restates the problem box right under it doubles the label.
  const doubled = blocks.find((block, index) => block.type === "heading" && blocks[index + 1]?.type === "problem");
  if (doubled) note(`"${plain(doubled.text)}" repeats the problem box below it; drop such headings and give the :::problem its title.`, 1);
  const headings = blocks.filter((block) => block.type === "heading").map((block) => plain(block.text).toLowerCase());
  const duplicate = headings.find((heading, index) => headings.indexOf(heading) !== index);
  if (duplicate) note(`The heading "${duplicate}" appears twice; merge or rename the sections.`, 1);

  // Length against the request.
  const length = requestedLength(userRequest);
  if (length?.words) {
    if (totalWords < length.low * 0.85) note(`The request asks for about ${length.low}${length.high !== length.low ? `-${length.high}` : ""} words but the draft has about ${totalWords}; develop the sections further with real content.`, 3);
    else if (totalWords > length.high * 1.25) note(`The request asks for about ${length.high} words but the draft has about ${totalWords}; tighten it.`, 2);
  } else if (length?.pages) {
    const perPage = FORMAL.has(style) ? 280 : CV.has(style) ? 450 : 430;
    const estimate = totalWords / perPage + blocks.filter((block) => block.type === "chart").length * 0.35 + blocks.filter((block) => block.type === "table").reduce((sum, block) => sum + block.rows.length * 0.03, 0);
    if (estimate < length.pages * 0.7) note(`The request asks for ${length.pages} page(s); the draft fills about ${estimate.toFixed(1)}. Add substance (not padding) to reach the length.`, 3);
    if (estimate > length.pages * 1.4 + 0.5) note(`The request asks for ${length.pages} page(s); the draft would run to about ${estimate.toFixed(1)}. Cut it down.`, 2);
  }

  // Counted items the user asked for.
  const problems = blocks.filter((block) => block.type === "problem").length;
  const askedProblems = requestedCount(userRequest, "(?:problems?|questions?|exercises?)");
  if (askedProblems && problems && problems < askedProblems) note(`The request asks for ${askedProblems} problems but the draft has ${problems}.`, 4);
  if (style === "homework" && problems) {
    const answers = blocks.filter((block) => block.type === "answer").length;
    if (answers < problems) note(`${problems} problems but ${answers} answer boxes; end every worked solution with an :::answer.`, 2);
  }

  // Formal formats keep their conventions.
  if (FORMAL.has(style)) {
    const furniture = blocks.filter((block) => ["callout", "stats", "cards", "chart", "steps"].includes(block.type));
    if (furniture.length) note(`An ${style.toUpperCase()} paper should be plain prose; remove the ${[...new Set(furniture.map((block) => block.type))].join(", ")} blocks and write them as paragraphs.`, 3);
    if (style === "mla" && !blocks.some((block) => block.type === "references") && /\b(cite|quot|source|works cited|reference)/i.test(userRequest + all)) note("An MLA essay that quotes or cites needs a Works Cited list (:::references).", 2);
  }
  if (style === "letter" && !/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/i.test(blocks.slice(0, 4).map(blockText).join(" ") + (doc.date || ""))) {
    note("A letter needs its date line above the recipient block.", 1);
  }
  if (CV.has(style)) {
    const furniture = blocks.filter((block) => ["table", "chart", "callout", "stats", "cards", "steps", "figure"].includes(block.type));
    if (furniture.length) note(`A CV must stay ATS-safe: replace the ${[...new Set(furniture.map((block) => block.type))].join(", ")} with entries, bullet lists or a skills :::fields block.`, 3);
    if (!blocks.some((block) => block.type === "entry")) note("Write each role, school and project as an :::entry (title, org, location, dates, bullets).", 3);
    for (const entry of blocks.filter((block) => block.type === "entry")) {
      if (entry.bullets.length > 6) note(`"${entry.title || entry.org}" has ${entry.bullets.length} bullets; keep the strongest 3-5.`, 1);
      const long = entry.bullets.find((bullet) => plain(bullet).length > 230);
      if (long) note(`A bullet under "${entry.title || entry.org}" runs over two lines; tighten it to one impact statement.`, 1);
    }
    if (!doc?.contact?.length) note("Add the contact line (email, phone, city, LinkedIn) in the front matter \"contact\" list.", 2);
    if (totalWords > 900) note(`At about ${totalWords} words the CV will run past one page; cut weaker bullets and older roles.`, 2);
  }

  // Data blocks.
  for (const block of blocks) {
    if (block.type === "chart") {
      const values = (block.series || []).flatMap((series) => series.values).filter((value) => value !== null);
      const points = block.chart === "scatter" ? (block.points || []).length : values.length;
      if (points < 2) note(`The chart "${block.title || block.caption || block.chart}" has under two data points; use a sentence or a table instead.`, 2);
      else if (block.chart !== "scatter" && new Set(values).size === 1) note(`Every value in the chart "${block.title || block.chart}" is the same; a chart adds nothing there.`, 1);
      if (["pie", "donut"].includes(block.chart) && (block.categories || []).length > 7) note(`The ${block.chart} chart "${block.title}" has more than 7 slices; use a bar chart.`, 1);
      if (!block.title && !block.caption) note("Every chart needs a title saying what it shows.", 1);
    }
    if (block.type === "table") {
      const width = block.columns.length;
      if (width > 8) note(`The table "${block.caption || block.columns.join(", ").slice(0, 60)}" has ${width} columns; split it or drop columns so it fits the page.`, 2);
      block.columns.forEach((column, index) => {
        if (block.rows.length >= 2 && block.rows.every((row) => !plain(row[index] || "").trim())) note(`The table column "${typeof column === "string" ? column : column.label}" is empty; remove it.`, 2);
      });
      const prose = block.rows.flat().find((cell) => plain(cell).length > 320);
      if (prose) note(`A table cell holds a long paragraph ("${plain(prose).slice(0, 50)}…"); tables need short cells, so move the prose into the text.`, 1);
      const filler = block.rows.flat().filter((cell) => /^(n\/?a|not (?:reported|available|stated)|unknown|—|-)$/i.test(plain(cell).trim())).length;
      if (filler > Math.max(2, block.rows.length * width * 0.25)) note(`The table "${block.caption || ""}" is mostly "N/A"; keep rows and columns that have data.`, 2);
    }
    if (block.type === "stats") {
      const bad = block.items.find((item) => !/\d/.test(item.value));
      if (bad) note(`The key-figures row shows "${bad.value}", which is not a figure; key figures are numbers from the material.`, 2);
    }
  }
  const callouts = blocks.filter((block) => block.type === "callout").length;
  if (!FORMAL.has(style) && callouts > Math.max(4, Math.ceil(totalWords / 320))) note(`${callouts} callout boxes is too many; keep the few that matter most and write the rest as text.`, 1);
  const visuals = blocks.filter((block) => ["cards", "steps", "stats", "callout"].includes(block.type)).length;
  if (!FORMAL.has(style) && !CV.has(style) && totalWords > 300 && visuals > blocks.filter((block) => block.type === "paragraph").length) note("Boxes and cards outnumber paragraphs; the document should read as prose with a few supporting elements.", 1);

  if (/\b(cite|citations?|sources|references|bibliography|works cited)\b/i.test(userRequest) && !blocks.some((block) => block.type === "references")) {
    note("The request asks for sources; add a :::references list with the works cited in the text.", 2);
  }
  return { notes, score };
}
