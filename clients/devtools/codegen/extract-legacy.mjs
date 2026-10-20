// Copies top-level declarations out of public/js/app.js so a slice of the old
// app can move into an island verbatim. Prints them in source order, plus the
// free names they use that the target island does not declare yet.
// Usage: node extract-legacy.mjs <island.js> <root,...> [stop,...]
//   Follows references from the roots through app.js, skipping names in the
//   stop list and names the island already declares or imports. A root the
//   island already declares contributes the names it uses.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("acorn");
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const appSource = fs.readFileSync(path.join(repo, "public/js/app.js"), "utf8");

function visit(node, cb) {
  if (!node || typeof node.type !== "string") return;
  cb(node);
  for (const key in node) {
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => visit(child, cb));
    else if (value && typeof value.type === "string") visit(value, cb);
  }
}

function declarations(source) {
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const decls = new Map();
  const imported = new Set();
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") for (const s of node.specifiers) imported.add(s.local.name);
    const n = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (!n) continue;
    if (n.type === "FunctionDeclaration") decls.set(n.id.name, n);
    else if (n.type === "VariableDeclaration") {
      for (const d of n.declarations) {
        if (d.id.type === "Identifier") decls.set(d.id.name, n);
        else visit(d.id, (x) => { if (x.type === "Identifier") decls.set(x.name, n); });
      }
    }
  }
  return { decls, imported };
}

const [islandPath, rootList = "", stopList = ""] = process.argv.slice(2);
const island = fs.existsSync(islandPath) ? declarations(fs.readFileSync(islandPath, "utf8")) : { decls: new Map(), imported: new Set() };
const have = new Set([...island.decls.keys(), ...island.imported]);
const stop = new Set(stopList.split(",").filter(Boolean));
const app = declarations(appSource);

const names = (node) => { const s = new Set(); visit(node, (x) => { if (x.type === "Identifier") s.add(x.name); }); return s; };
const picked = new Set();
const free = new Set();
const queue = rootList.split(",").filter(Boolean);
const roots = new Set(queue);
const walkedIsland = new Set();
while (queue.length) {
  const name = queue.shift();
  // A root the island already has: follow what it uses.
  if (island.decls.has(name) && !walkedIsland.has(name)) {
    walkedIsland.add(name);
    if (roots.has(name)) for (const ref of names(island.decls.get(name))) queue.push(ref);
    continue;
  }
  if (picked.has(name) || have.has(name)) continue;
  if (stop.has(name) || !app.decls.has(name)) { if (app.decls.has(name) || app.imported.has(name)) free.add(name); continue; }
  const node = app.decls.get(name);
  // A multi-name declaration (const { a, b } = ...) is picked once.
  for (const [other, n] of app.decls) if (n === node) picked.add(other);
  for (const ref of names(node)) if (!picked.has(ref)) queue.push(ref);
}
const nodes = [...new Set([...picked].map((name) => app.decls.get(name)))].sort((a, b) => a.start - b.start);
// Keep the comment block directly above each declaration.
function withComments(node) {
  let start = node.start;
  for (;;) {
    const lineEnd = appSource.lastIndexOf("\n", start - 1);
    if (lineEnd < 0) break;
    const lineStart = appSource.lastIndexOf("\n", lineEnd - 1) + 1;
    const line = appSource.slice(lineStart, lineEnd).trim();
    if (line.endsWith("*/")) {
      // A block comment: take it whole, from the line that opens it.
      const open = appSource.lastIndexOf("/*", lineEnd);
      start = appSource.lastIndexOf("\n", open) + 1;
      continue;
    }
    if (!line.startsWith("//")) break;
    start = lineStart;
  }
  return appSource.slice(start, node.end);
}
process.stdout.write(nodes.map(withComments).join("\n\n") + "\n");
const unresolved = [...free].filter((name) => !have.has(name)).sort();
process.stderr.write(`${nodes.length} declarations, ${nodes.reduce((sum, n) => sum + appSource.slice(n.start, n.end).split("\n").length, 0)} lines\nfree: ${unresolved.join(" ")}\n`);
