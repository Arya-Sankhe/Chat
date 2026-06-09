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
