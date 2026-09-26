// Serves public/index.html with every script and stylesheet addressed by a content hash, so browsers
// keep them for a year (static.js marks "?v=" requests immutable) instead of re-checking each file
// on every visit. It also flattens the load: the styles.css @import list becomes direct links, and
// the whole static module graph under app.js is preloaded at once instead of import by import.
// An import map points each module's plain URL at its hashed URL, so the modules' own relative
// imports get the same caching without a build step. Browsers without import maps still work;
// they just fetch the plain, revalidated URLs as before.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const publicDir = path.resolve(process.cwd(), "public");
const APP_ENTRY = "/js/app.js";

// Absolute file path -> { key, hash, text }; entries refresh when a file's size or mtime changes.
const files = new Map();

async function readAsset(urlPath) {
  const filePath = path.resolve(publicDir, `.${urlPath}`);
  if (!filePath.startsWith(`${publicDir}${path.sep}`)) return null;
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const key = `${stat.size}:${stat.mtimeMs}`;
  const cached = files.get(filePath);
  if (cached?.key === key) return cached;
  const buffer = await fs.promises.readFile(filePath);
  const entry = {
    key,
    hash: crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12),
    text: /\.(m?js|css|html)$/.test(filePath) ? buffer.toString("utf8") : ""
  };
  files.set(filePath, entry);
  return entry;
}

// `import x from "./a.js"`, `import "./a.js"` and `export … from "./a.js"` at the start of a statement.
const STATIC_IMPORT = /(?:^|[;\n}])\s*(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"'\n]+)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"'\n]+)["']\s*\)/g;

function resolveSpecifier(specifier, fromUrlPath) {
  if (!/^(?:\.{1,2}\/|\/)/.test(specifier)) return null; // bare specifiers (e.g. @capacitor/*) stay as they are
  const resolved = new URL(specifier, `https://app.invalid${fromUrlPath}`).pathname;
  return /\.m?js$/.test(resolved) ? resolved : null;
}

// Walks the module graph from app.js. `preload` is what app.js needs before it runs, in load order;
// `all` also holds lazily imported modules, which get hashed URLs but still load on demand.
async function moduleGraph() {
  const all = new Map(); // urlPath -> hash
  const walk = async (entries) => {
    const reached = [];
    const lazy = [];
    const queue = [...entries];
    while (queue.length) {
      const urlPath = queue.shift();
      if (all.has(urlPath)) continue;
      const asset = await readAsset(urlPath);
      if (!asset) continue;
      all.set(urlPath, asset.hash);
      reached.push(urlPath);
      for (const match of asset.text.matchAll(STATIC_IMPORT)) {
        const next = resolveSpecifier(match[1], urlPath);
        if (next) queue.push(next);
      }
      for (const match of asset.text.matchAll(DYNAMIC_IMPORT)) {
        const next = resolveSpecifier(match[1], urlPath);
        if (next) lazy.push(next);
      }
    }
    return { reached, lazy };
  };
  const eager = await walk([APP_ENTRY]);
  let lazy = eager.lazy;
  while (lazy.length) lazy = (await walk(lazy)).lazy;
  return { preload: eager.reached, all };
}

const versioned = (urlPath, hash) => `${urlPath}?v=${hash}`;
const escapeAttr = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// A stylesheet link, expanded into one link per @import when it is an @import-only root.
async function stylesheetLinks(urlPath) {
  const asset = await readAsset(urlPath);
  if (!asset) return null;
  const imports = [...asset.text.matchAll(/@import\s+url\(\s*["']?([^"')]+)["']?\s*\)\s*;/g)].map((match) => match[1]);
  const rest = asset.text.replace(/@import\s+url\([^)]*\)\s*;/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!imports.length || rest) return `<link rel="stylesheet" href="${escapeAttr(versioned(urlPath, asset.hash))}">`;
  const links = [];
  for (const specifier of imports) {
    const child = new URL(specifier, `https://app.invalid${urlPath}`).pathname;
    const childAsset = await readAsset(child);
    if (!childAsset) return `<link rel="stylesheet" href="${escapeAttr(versioned(urlPath, asset.hash))}">`;
    links.push(`<link rel="stylesheet" href="${escapeAttr(versioned(child, childAsset.hash))}">`);
  }
  return links.join("\n    ");
}

async function renderShell(source) {
  const { preload, all } = await moduleGraph();
  let html = source;

  const stylesheets = [...html.matchAll(/<link rel="stylesheet" href="(\/[^"?#]+\.css)">/g)];
  for (const [tag, urlPath] of stylesheets) {
    const replacement = await stylesheetLinks(urlPath);
    if (replacement) html = html.replace(tag, replacement);
  }

  const scripts = [...html.matchAll(/<script (defer |type="module" )src="(\/[^"?#]+\.js)"><\/script>/g)];
  for (const [tag, attrs, urlPath] of scripts) {
    const hash = all.get(urlPath) || (await readAsset(urlPath))?.hash;
    if (hash) html = html.replace(tag, `<script ${attrs}src="${escapeAttr(versioned(urlPath, hash))}"></script>`);
  }

  if (all.size) {
    const imports = Object.fromEntries([...all].map(([urlPath, hash]) => [urlPath, versioned(urlPath, hash)]));
    const importMap = JSON.stringify({ imports }).replace(/</g, "\\u003c");
    const preloads = preload.map((urlPath) => `<link rel="modulepreload" href="${escapeAttr(versioned(urlPath, all.get(urlPath)))}">`);
    // The import map must come before any module loads, including modulepreload.
    html = html.replace("</head>", `    <script type="importmap">${importMap}</script>\n    ${preloads.join("\n    ")}\n  </head>`);
  }
  return html;
}

let rendered = null; // { sourceKey, filesKey, html, etag }

// Size and mtime of every file read so far; a change means the shell must be rendered again.
function trackedFilesKey() {
  return [...files.keys()].map((filePath) => {
    try {
      const stat = fs.statSync(filePath);
      return `${filePath}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return `${filePath}:missing`;
    }
  }).join("|");
}

// The versioned index.html, rendered again when index.html or any asset it references changes.
export async function appShellHtml() {
  const source = await readAsset("/index.html");
  if (!source) return null;
  try {
    if (rendered && rendered.sourceKey === source.key && rendered.filesKey === trackedFilesKey()) return rendered;
    const html = await renderShell(source.text);
    rendered = {
      sourceKey: source.key,
      filesKey: trackedFilesKey(),
      html,
      etag: `W/"shell-${crypto.createHash("sha256").update(html).digest("hex").slice(0, 16)}"`
    };
    return rendered;
  } catch (error) {
    console.error("App shell render failed; serving index.html unversioned.", error);
    return { html: source.text, etag: `W/"shell-raw-${source.hash}"` };
  }
}
