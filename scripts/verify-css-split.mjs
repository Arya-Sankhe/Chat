#!/usr/bin/env node
/**
 * Verifies public/styles.css @import split concatenates to the committed
 * approved checksum baseline (scripts/css-split-baseline.json).
 *
 * Does not read historical Git objects — works in shallow CI checkouts.
 * To refresh the baseline after intentional CSS changes, see the fixture's
 * updateInstructions.
 *
 * Usage: node scripts/verify-css-split.mjs
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stylesRoot = path.join(repoRoot, "public", "styles.css");
const publicDir = path.join(repoRoot, "public");
const baselinePath = path.join(repoRoot, "scripts", "css-split-baseline.json");

export function loadBaseline(filePath = baselinePath) {
  const baseline = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Number.isInteger(baseline.utf8ByteLength) || baseline.utf8ByteLength <= 0) {
    throw new Error("css-split-baseline.json: utf8ByteLength must be a positive integer");
  }
  if (!/^[a-f0-9]{64}$/.test(String(baseline.sha256 || ""))) {
    throw new Error("css-split-baseline.json: sha256 must be a 64-char hex digest");
  }
  return baseline;
}

export function parseImports(stylesRootContent) {
  const imports = [];
  for (const line of stylesRootContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("/*")) continue;
    const match = trimmed.match(/^@import\s+url\(["']?(\.\/[^"')]+)["']?\)\s*;$/);
    if (!match) {
      throw new Error(`Unexpected line in styles.css: ${trimmed}`);
    }
    imports.push(match[1]);
  }
  if (imports.length === 0) {
    throw new Error("No @import entries found in public/styles.css");
  }
  return imports;
}

export function concatenateImports(imports, { publicDirectory = publicDir, readFile = fs.readFileSync } = {}) {
  let out = "";
  for (const rel of imports) {
    const filePath = path.join(publicDirectory, rel.replace(/^\.\//, ""));
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing imported file: ${rel} (${filePath})`);
    }
    out += readFile(filePath, "utf8");
  }
  return out;
}

export function checksumUtf8(content) {
  const bytes = Buffer.byteLength(content, "utf8");
  const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
  return { utf8ByteLength: bytes, sha256 };
}

export function verifyCssSplit({
  rootContent,
  publicDirectory = publicDir,
  baseline = loadBaseline(),
  readFile = fs.readFileSync
} = {}) {
  const imports = parseImports(rootContent);
  const concatenated = concatenateImports(imports, { publicDirectory, readFile });
  const actual = checksumUtf8(concatenated);
  const byteMatch = actual.utf8ByteLength === baseline.utf8ByteLength;
  const hashMatch = actual.sha256 === baseline.sha256;
  return {
    imports,
    concatenated,
    actual,
    baseline,
    ok: byteMatch && hashMatch,
    byteMatch,
    hashMatch
  };
}

function main() {
  const root = fs.readFileSync(stylesRoot, "utf8");
  const result = verifyCssSplit({ rootContent: root });

  console.log(`Imported files (${result.imports.length}):`);
  for (const rel of result.imports) {
    console.log(`  ${rel}`);
  }
  console.log(`Baseline source:    ${result.baseline.source || "(unspecified)"}`);
  console.log(`Baseline bytes:     ${result.baseline.utf8ByteLength}`);
  console.log(`Concatenated bytes: ${result.actual.utf8ByteLength}`);
  console.log(`Baseline sha256:    ${result.baseline.sha256}`);
  console.log(`Concatenated sha256:${result.actual.sha256}`);
  console.log(`Checksum match: ${result.ok ? "yes" : "no"}`);

  if (!result.ok) {
    if (!result.byteMatch) {
      console.error(
        `Byte-length mismatch: baseline=${result.baseline.utf8ByteLength}, concatenated=${result.actual.utf8ByteLength}`
      );
    }
    if (!result.hashMatch) {
      console.error("SHA-256 mismatch against scripts/css-split-baseline.json");
      console.error("If this CSS change is intentional, update the baseline fixture (see updateInstructions).");
    }
    process.exit(1);
  }

  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();
