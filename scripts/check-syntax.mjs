#!/usr/bin/env node
/**
 * Syntax-checks every JavaScript file in the repo's server and client
 * source trees with `node --check`. Files are enumerated explicitly with
 * fs.readdir recursion (never shell `**` globs, whose expansion is
 * shell-dependent and silently incomplete).
 *
 * Usage: node scripts/check-syntax.mjs
 * Exits non-zero if any file fails to parse.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const roots = ["server", "public/js", "scripts", "test"];
const extensions = new Set([".js", ".mjs"]);
const skipDirectories = new Set(["node_modules", "dist-mobile"]);

function collect(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirectories.has(entry.name)) collect(path.join(dir, entry.name), files);
      continue;
    }
    if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
process.chdir(repoRoot);

const files = roots
  .filter((root) => fs.existsSync(root))
  .flatMap((root) => collect(root))
  .sort();

if (!files.length) {
  console.error("check-syntax: no JavaScript files found — check the roots list.");
  process.exit(1);
}

const failures = [];
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    failures.push({ file, message: error.stderr?.toString() || error.message });
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`SYNTAX ERROR: ${failure.file}\n${failure.message}`);
  }
  console.error(`check-syntax: ${failures.length}/${files.length} files failed.`);
  process.exit(1);
}

console.log(`check-syntax: ${files.length} files OK.`);
