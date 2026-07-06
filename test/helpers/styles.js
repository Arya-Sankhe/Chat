import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

// public/styles.css is an @import-only root (see docs/REFACTORING_RFC.md § 12).
// Tests that assert against the stylesheet read the concatenated content, which
// is byte-identical to the pre-split file (verified by scripts/verify-css-split.mjs).
export function readStylesheet() {
  const root = readFileSync(resolve(publicDir, "styles.css"), "utf8");
  return root.replace(/^@import url\("\.\/(.+?)"\);\n?/gm, (_, relativePath) =>
    readFileSync(resolve(publicDir, relativePath), "utf8")
  );
}
