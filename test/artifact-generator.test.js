import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import JSZip from "../worker/node_modules/jszip/lib/index.js";

const execFileAsync = promisify(execFile);

function slideTexts(xml) {
  return [...String(xml || "").matchAll(/<a:t>(.*?)<\/a:t>/g)]
    .map((match) => match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function docxTexts(xml) {
  return [...String(xml || "").matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)]
    .map((match) => match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function runArtifact(input, tmpPrefix) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), tmpPrefix));
  const inputPath = path.join(tmp, "input.json");
  await fs.writeFile(inputPath, JSON.stringify(input));
  const { stdout } = await execFileAsync("node", ["worker/artifact_generator.mjs", inputPath, tmp], {
    cwd: path.resolve(".")
  });
  return { tmp, result: JSON.parse(stdout) };
}

test("DOCX generator promotes plain section labels into real document structure", async () => {
  const { result } = await runArtifact({
    format: "docx",
    title: "Pricing Comparison",
    content: [
      "Executive Summary:",
      "MiMo is cheaper for the tested 60/40 token mix.",
      "",
      "Recommendation:",
      "Use MiMo for cost-sensitive workloads and reserve Qwen for quality-sensitive cases."
    ].join("\n")
  }, "klui-docx-quality-");
  const zip = await JSZip.loadAsync(await fs.readFile(result.path));
  const xml = await zip.file("word/document.xml").async("string");
  const text = docxTexts(xml);

  assert.match(xml, /Heading2/);
  assert.match(text, /Executive Summary/);
  assert.match(text, /Recommendation/);
  assert.match(text, /MiMo is cheaper/);
});

test("PPTX generator repairs title-only and one-line slide plans", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "klui-pptx-quality-"));
  const inputPath = path.join(tmp, "input.json");
  await fs.writeFile(inputPath, JSON.stringify({
    format: "pptx",
    title: "Model Price Comparison",
    instructions: "Make a concise executive comparison deck with a useful recommendation.",
    content: [
      "MiMo is lower cost for the tested token mix.",
      "Qwen costs more mainly because output pricing is higher.",
      "The recommendation is to use MiMo when cost is the deciding factor."
    ].join("\n"),
    data: {
      slides: [
        { title: "Model Price Comparison" },
        { title: "The Question" },
        { title: "Base Pricing", bullets: ["MiMo is cheaper."] },
        { title: "The Verdict" },
        { title: "Bottom Line", bullets: ["Use MiMo for cost-sensitive workloads."] }
      ]
    }
  }));

  const { stdout } = await execFileAsync("node", ["worker/artifact_generator.mjs", inputPath, tmp], {
    cwd: path.resolve(".")
  });
  const result = JSON.parse(stdout);
  const buffer = await fs.readFile(result.path);
  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] || 0) - Number(b.match(/slide(\d+)/)?.[1] || 0));

  assert.ok(slideEntries.length <= 4, "weak one-line slides should be merged into a concise deck");

  const bodyTexts = [];
  for (const entry of slideEntries.slice(1)) {
    bodyTexts.push(slideTexts(await zip.file(entry).async("string")));
  }
  assert.ok(bodyTexts.every((text) => text.length >= 90), "content slides should contain real substance");
  assert.match(bodyTexts.join(" "), /Use MiMo|MiMo is lower cost|Qwen costs more/);
});

test("PPTX generator plans pricing comparisons with a native chart narrative", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "klui-pptx-comparison-"));
  const inputPath = path.join(tmp, "input.json");
  await fs.writeFile(inputPath, JSON.stringify({
    format: "pptx",
    title: "Xiaomi MiMo v2.5 vs Qwen 3.7 Plus",
    instructions: "Create a concise pricing comparison deck.",
    source: "MiMo pricing page; OpenRouter Qwen pricing page",
    tables: [{
      title: "Pricing inputs",
      headers: ["Model", "Input $/1M", "Output $/1M", "Blended $/1M"],
      rows: [
        ["Xiaomi MiMo v2.5", "$0.14", "$0.28", "$0.196"],
        ["Qwen 3.7 Plus", "$0.40", "$1.60", "$0.88"]
      ]
    }],
    data: {
      recommendation: "Use MiMo when token cost is the primary decision factor.",
      slides: [
        { title: "Title" },
        { title: "The Question" },
        { title: "Verdict" }
      ]
    }
  }));

  const { stdout } = await execFileAsync("node", ["worker/artifact_generator.mjs", inputPath, tmp], {
    cwd: path.resolve(".")
  });
  const result = JSON.parse(stdout);
  const zip = await JSZip.loadAsync(await fs.readFile(result.path));
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] || 0) - Number(b.match(/slide(\d+)/)?.[1] || 0));
  const deckText = (await Promise.all(slideEntries.map(async (entry) => slideTexts(await zip.file(entry).async("string"))))).join(" ");
  const chartEntries = Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));

  assert.equal(slideEntries.length, 4);
  assert.ok(chartEntries.length >= 1, "pricing comparison deck should include a native PPTX chart");
  assert.match(deckText, /Pricing Inputs/);
  assert.match(deckText, /Blended \$\/1M/);
  assert.match(deckText, /Bottom Line/);
  assert.match(deckText, /Use MiMo/);
});
