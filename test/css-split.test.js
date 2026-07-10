import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checksumUtf8,
  loadBaseline,
  parseImports,
  verifyCssSplit
} from "../scripts/verify-css-split.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "scripts", "css-split-baseline.json");

test("css-split baseline fixture matches the approved snapshot size and digest shape", () => {
  const baseline = loadBaseline(baselinePath);
  assert.equal(baseline.utf8ByteLength, 220323);
  assert.match(baseline.sha256, /^[a-f0-9]{64}$/);
  assert.match(String(baseline.source || ""), /approved-concatenated-css-snapshot/);
});

test("parseImports accepts only @import-only roots", () => {
  assert.deepEqual(
    parseImports('@import url("./styles/base.css");\n@import url("./styles/research.css");\n'),
    ["./styles/base.css", "./styles/research.css"]
  );
  assert.throws(() => parseImports("body { color: red; }\n"), /Unexpected line/);
  assert.throws(() => parseImports("/* empty */\n"), /No @import/);
});

test("verifyCssSplit passes current public stylesheet against the committed baseline", () => {
  const root = fs.readFileSync(path.join(repoRoot, "public", "styles.css"), "utf8");
  const result = verifyCssSplit({ rootContent: root });
  assert.equal(result.imports.length, 13);
  assert.equal(result.ok, true);
  assert.equal(result.actual.utf8ByteLength, 220323);
  assert.equal(result.actual.sha256, "f523b8d8f1acb44397e116479c56c4a4dd018c4ece49bfa60ee9a514168ec8ea");
});

test("verifyCssSplit fails when concatenated CSS diverges from the baseline", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "css-split-"));
  try {
    const stylesDir = path.join(tempDir, "styles");
    fs.mkdirSync(stylesDir);
    fs.writeFileSync(path.join(stylesDir, "a.css"), "/* changed */\n", "utf8");
    const rootContent = '@import url("./styles/a.css");\n';
    const baseline = {
      utf8ByteLength: 219258,
      sha256: "309b3e1222a405e7542b144a34e1448e2ae9288c139daca8463cfd839d052546"
    };
    const result = verifyCssSplit({
      rootContent,
      publicDirectory: tempDir,
      baseline
    });
    assert.equal(result.ok, false);
    assert.equal(result.byteMatch, false);
    assert.equal(result.hashMatch, false);
    assert.deepEqual(result.actual, checksumUtf8("/* changed */\n"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
