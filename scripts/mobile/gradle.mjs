#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const androidDir = resolve(root, "android");
const isWindows = process.platform === "win32";
const gradle = isWindows ? "gradlew.bat" : "./gradlew";
const gradlePath = resolve(androidDir, isWindows ? "gradlew.bat" : "gradlew");

if (!existsSync(gradlePath)) {
  console.error(`Missing Gradle wrapper: ${gradlePath}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/mobile/gradle.mjs <gradle-task> [...args]");
  process.exit(1);
}

const result = spawnSync(gradle, args, {
  cwd: androidDir,
  stdio: "inherit",
  shell: isWindows,
  env: process.env
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
