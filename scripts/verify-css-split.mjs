#!/usr/bin/env node
/**
 * Verifies public/styles.css @import split is byte-identical to the effective
 * stylesheet at HEAD. Before the split is committed, HEAD is the old monolithic
 * file; after it is committed, HEAD is expanded from its own imports.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stylesRoot = path.join(repoRoot, "public", "styles.css");
const publicDir = path.join(repoRoot, "public");

function readOriginalFromGit() {
  return readGitFile("public/styles.css");
}

function readGitFile(filePath) {
  return execFileSync("git", ["show", `HEAD:${filePath}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
}

function isImportOnlyStylesheet(content) {
  try {
    parseImports(content);
    return true;
  } catch {
    return false;
  }
}

function parseImports(stylesRootContent) {
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

function concatenateImports(imports) {
  let out = "";
  for (const rel of imports) {
    const filePath = path.join(publicDir, rel.replace(/^\.\//, ""));
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing imported file: ${rel} (${filePath})`);
    }
    out += fs.readFileSync(filePath, "utf8");
  }
  return out;
}

function concatenateGitImports(imports) {
  let out = "";
  for (const rel of imports) {
    out += readGitFile(path.posix.join("public", rel.replace(/^\.\//, "")));
  }
  return out;
}

function main() {
  const originalRoot = readOriginalFromGit();
  const original = isImportOnlyStylesheet(originalRoot)
    ? concatenateGitImports(parseImports(originalRoot))
    : originalRoot;
  const root = fs.readFileSync(stylesRoot, "utf8");
  const imports = parseImports(root);
  const concatenated = concatenateImports(imports);
  const identical = concatenated === original;

  console.log(`Imported files (${imports.length}):`);
  for (const rel of imports) {
    console.log(`  ${rel}`);
  }
  console.log(`Original bytes:     ${Buffer.byteLength(original, "utf8")}`);
  console.log(`Concatenated bytes: ${Buffer.byteLength(concatenated, "utf8")}`);
  console.log(`Byte-identical: ${identical ? "yes" : "no"}`);

  if (!identical) {
    const max = Math.max(original.length, concatenated.length);
    for (let i = 0; i < max; i++) {
      if (original[i] !== concatenated[i]) {
        console.error(`First difference at byte offset ${i}`);
        console.error(`  original:     ${JSON.stringify(original.slice(i, i + 60))}`);
        console.error(`  concatenated: ${JSON.stringify(concatenated.slice(i, i + 60))}`);
        process.exit(1);
      }
    }
    console.error(`Length mismatch: original=${original.length}, concatenated=${concatenated.length}`);
    process.exit(1);
  }

  process.exit(0);
}

main();
