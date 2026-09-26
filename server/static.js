import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { applyApiCors } from "./http/cors.js";
import { appShellHtml } from "./appShell.js";

const publicDir = path.resolve(process.cwd(), "public");
const homeDir = path.join(publicDir, "home");
const legacyWebHosts = new Set(["klui.tech", "www.klui.tech"]);
const marketingWebHosts = new Set(["home.klui.ai", "www.home.klui.ai"]);
const marketingPagePaths = new Set([
  "/legal",
  "/privacy",
  "/terms",
  "/cookies",
  "/subprocessors",
  "/account-delete",
  "/status",
  "/accuracy"
]);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
  [".mp3", "audio/mpeg"],
  [".avif", "image/avif"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
  [".apk", "application/vnd.android.package-archive"],
  [".exe", "application/vnd.microsoft.portable-executable"]
]);

const directoryIndexes = new Map([
  ["/download/android", "/download/android/index.html"],
  ["/download/android/", "/download/android/index.html"],
  ["/download/windows", "/download/windows/index.html"],
  ["/download/windows/", "/download/windows/index.html"],
  ["/home", "/home/index.html"],
  ["/home/", "/home/index.html"]
]);

const compressibleTypes = ["text/", "application/json", "application/javascript", "application/xml", "image/svg+xml"];

function responseEncoding(req, type, size) {
  if (size < 1024 || !compressibleTypes.some((value) => type.startsWith(value))) return "";
  const header = req.headers["accept-encoding"];
  if (header == null) return "";
  const qualities = new Map();
  let wildcard = null;
  for (const item of String(header).split(",")) {
    const [namePart, ...parameters] = item.split(";");
    const name = namePart.trim().toLowerCase();
    if (!name) continue;
    const qParameter = parameters.find((parameter) => /^\s*q\s*=\s*/i.test(parameter));
    const rawQuality = qParameter?.replace(/^\s*q\s*=\s*/i, "").trim() || "1";
    const quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(rawQuality)
      ? Number(rawQuality)
      : 0;
    if (name === "*") wildcard = Math.max(wildcard ?? 0, quality);
    else qualities.set(name, Math.max(qualities.get(name) ?? 0, quality));
  }
  const qualityFor = (name) => qualities.has(name) ? qualities.get(name) : (wildcard ?? 0);
  const candidates = ["br", "gzip"]
    .map((name, preference) => ({ name, quality: qualityFor(name), preference }))
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.preference - b.preference);
  if (candidates[0]) return candidates[0].name;
  const identityQuality = qualities.has("identity") ? qualities.get("identity") : (wildcard === 0 ? 0 : 1);
  return identityQuality > 0 ? "" : null;
}

function etagMatches(req, etag) {
  return String(req.headers["if-none-match"] || "")
    .split(",")
    .map((value) => value.trim())
    .includes(etag);
}

function hostnameOf(req) {
  return String(req.headers.host || "")
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
}

function isDocumentMethod(req) {
  return req.method === "GET" || req.method === "HEAD";
}

function safePathAndQuery(url) {
  let pathname = String(url.pathname || "/").replace(/\/{2,}/g, "/");
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\") || /[\r\n]/.test(pathname)) {
    pathname = "/";
  }
  const search = String(url.search || "");
  if (/[\r\n]/.test(search)) return pathname;
  return `${pathname}${search}`;
}

function isHomeDocumentPath(pathname) {
  return pathname === "/home" || pathname === "/home/" || pathname === "/home/index.html";
}

function isMovedDocumentPath(pathname) {
  return pathname === "/moved" || pathname === "/moved/" || pathname === "/moved/index.html";
}

export function marketingPageLocation(pathname, search = "") {
  const stripped = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (!marketingPagePaths.has(stripped)) return null;
  const query = String(search || "");
  if (/[\r\n]/.test(query)) return `https://home.klui.ai${stripped}/`;
  return `https://home.klui.ai${stripped}/${query}`;
}

function isAndroidLatestJson(pathname) {
  return pathname === "/downloads/android/latest.json";
}

function addMovedQuery(pathAndQuery) {
  if (/[?&]moved=/.test(pathAndQuery)) return pathAndQuery;
  return pathAndQuery.includes("?") ? `${pathAndQuery}&moved=1` : `${pathAndQuery}?moved=1`;
}

function legacyRedirectLocation(url) {
  const pathname = String(url.pathname || "/");
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") {
    return `https://klui.ai${pathname}`;
  }
  return `https://klui.ai${addMovedQuery(safePathAndQuery(url))}`;
}

export function isLegacyWebNavigation(req, url) {
  const hostname = hostnameOf(req);
  const pathname = String(url.pathname || "/");
  return isDocumentMethod(req)
    && legacyWebHosts.has(hostname)
    && !pathname.startsWith("/oauth/")
    && !isAndroidLatestJson(pathname);
}

export function isMarketingHost(req) {
  return marketingWebHosts.has(hostnameOf(req));
}

export function hostRedirectLocation(req, url) {
  if (!isDocumentMethod(req)) return null;
  const hostname = hostnameOf(req);
  const pathname = String(url.pathname || "/");

  if (hostname === "www.klui.ai") {
    if (pathname === "/home" || pathname.startsWith("/home/")) return "https://home.klui.ai/";
    const marketingPage = marketingPageLocation(pathname, url.search);
    if (marketingPage) return marketingPage;
    if (isMovedDocumentPath(pathname)) return "https://klui.ai/";
    return `https://klui.ai${safePathAndQuery(url)}`;
  }
  if (hostname === "www.home.klui.ai") return `https://home.klui.ai${safePathAndQuery(url)}`;
  if (hostname === "klui.ai") {
    if (isHomeDocumentPath(pathname)) return "https://home.klui.ai/";
    const marketingPage = marketingPageLocation(pathname, url.search);
    if (marketingPage) return marketingPage;
    if (isMovedDocumentPath(pathname)) return "https://klui.ai/";
    return null;
  }
  if (isLegacyWebNavigation(req, url)) return legacyRedirectLocation(url);
  return null;
}

function isInside(dir, filePath) {
  const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
  return filePath === dir || filePath.startsWith(prefix);
}

function isSharedMarketingAsset(filePath) {
  const relative = path.relative(publicDir, filePath);
  return relative === "favicon.svg"
    || relative === "favicon.ico"
    || relative === `.well-known${path.sep}gpc.json`
    || relative.startsWith(`icons${path.sep}`);
}

async function resolvePublicFile(pathname) {
  const mapped = directoryIndexes.get(pathname);
  const candidates = mapped
    ? [mapped]
    : pathname.endsWith("/")
      ? [`${pathname}index.html`]
      : [pathname, `${pathname}/index.html`];

  for (const candidate of candidates) {
    const filePath = path.resolve(publicDir, `.${candidate}`);
    if (!isInside(publicDir, filePath)) continue;
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isFile()) return filePath;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

async function resolveMarketingFile(pathname) {
  const homePath = pathname === "/home" || pathname.startsWith("/home/")
    ? pathname
    : pathname === "/"
      ? "/home/index.html"
      : `/home${pathname}`;
  const homeFile = await resolvePublicFile(homePath);
  if (homeFile && isInside(homeDir, homeFile)) return homeFile;

  const shared = await resolvePublicFile(pathname);
  if (shared && isSharedMarketingAsset(shared)) return shared;
  return null;
}

function sendRedirect(res, location) {
  res.writeHead(301, {
    location,
    "cache-control": "public, max-age=300"
  });
  res.end();
}

function sendNotFound(res) {
  const notFound = path.join(homeDir, "404.html");
  res.writeHead(404, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache"
  });
  if (fs.existsSync(notFound)) {
    fs.createReadStream(notFound).pipe(res);
    return;
  }
  res.end("<!doctype html><html lang=\"en\"><title>Not found</title><h1>Not found</h1></html>");
}

function compressBuffer(buffer, encoding) {
  if (encoding === "gzip") return zlib.gzipSync(buffer, { level: 9 });
  return zlib.brotliCompressSync(buffer, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length
    }
  });
}

// Text assets compressed once at maximum quality. Brotli 11 is about 20% smaller than the quality 4
// used for streaming but takes around half a second on app.js, so it runs off the request path
// and requests stream at quality 4 until it is ready.
const compressedCache = new Map(); // `${filePath}:${encoding}` -> { key, buffer } or { key, pending: true }
const MAX_CACHED_ASSET_BYTES = 4 * 1024 * 1024;

function cachedCompression(filePath, stat, encoding) {
  if (!encoding || stat.size > MAX_CACHED_ASSET_BYTES) return null;
  const cacheKey = `${filePath}:${encoding}`;
  const key = `${stat.size}:${stat.mtimeMs}`;
  const cached = compressedCache.get(cacheKey);
  if (cached?.key === key) return cached.buffer || null;
  compressedCache.set(cacheKey, { key, pending: true });
  fs.promises.readFile(filePath)
    .then((buffer) => new Promise((resolve, reject) => {
      const done = (error, output) => (error ? reject(error) : resolve(output));
      if (encoding === "gzip") zlib.gzip(buffer, { level: 9 }, done);
      else {
        zlib.brotliCompress(buffer, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length
          }
        }, done);
      }
    }))
    .then((output) => {
      if (compressedCache.get(cacheKey)?.key === key) compressedCache.set(cacheKey, { key, buffer: output });
    })
    .catch(() => compressedCache.delete(cacheKey));
  return null;
}

// The app page, with hashed asset URLs (see appShell.js). Its own compressed copy is small, so it
// is made synchronously and kept until the page changes.
let shellCompressed = { etag: "", variants: new Map() };

async function sendAppShell(req, res) {
  const shell = await appShellHtml();
  if (!shell) {
    sendNotFound(res);
    return;
  }
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
    etag: shell.etag,
    vary: "Accept-Encoding"
  };
  if (etagMatches(req, shell.etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const buffer = Buffer.from(shell.html);
  const encoding = responseEncoding(req, headers["content-type"], buffer.length);
  if (encoding === null) {
    res.writeHead(406, { vary: "Accept-Encoding" });
    res.end();
    return;
  }
  if (shellCompressed.etag !== shell.etag) shellCompressed = { etag: shell.etag, variants: new Map() };
  let body = buffer;
  if (encoding) {
    if (!shellCompressed.variants.has(encoding)) {
      shellCompressed.variants.set(encoding, compressBuffer(buffer, encoding));
    }
    body = shellCompressed.variants.get(encoding);
  }
  res.writeHead(200, { ...headers, ...(encoding ? { "content-encoding": encoding } : {}) });
  res.end(req.method === "HEAD" ? undefined : body);
}

// A missing script, stylesheet, font or image must not get the app page back with a 200.
const ASSET_EXTENSION = /\.(?:m?js|css|map|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|mp3|mp4|webm|wasm|json|webmanifest)$/i;

function sendMissingAsset(res) {
  res.writeHead(404, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-cache"
  });
  res.end("Not found");
}

function isHomePreviewPath(pathname) {
  return pathname === "/home" || pathname.startsWith("/home/");
}

export async function serveStatic(req, res, url, { allowedOrigins = [], supabaseUrl = "" } = {}) {
  const redirectTo = hostRedirectLocation(req, url);
  if (redirectTo) {
    sendRedirect(res, redirectTo);
    return;
  }

  const requestedPath = url.pathname || "/";
  const marketing = isMarketingHost(req);
  const pathname = !marketing && requestedPath === "/"
    ? "/index.html"
    : requestedPath;

  if (pathname === "/downloads/android/latest.json") {
    applyApiCors(req, res, allowedOrigins);
  }

  const filePath = marketing
    ? await resolveMarketingFile(pathname)
    : await resolvePublicFile(pathname);

  if (!filePath) {
    if (marketing || isHomePreviewPath(requestedPath)) {
      sendNotFound(res);
      return;
    }
    if (ASSET_EXTENSION.test(requestedPath)) {
      sendMissingAsset(res);
      return;
    }
    await sendAppShell(req, res);
    return;
  }

  if (!marketing && filePath === path.join(publicDir, "index.html")) {
    await sendAppShell(req, res);
    return;
  }

  const type = contentTypes.get(path.extname(filePath)) || "application/octet-stream";
  const versioned = url.searchParams.has("v");
  const cacheControl = type.includes("text/html")
    ? "no-cache"
    : versioned
      ? "public, max-age=31536000, immutable"
      : type.includes("text/javascript") || type.includes("text/css")
        ? "no-cache"
        : "public, max-age=300";
  const stat = await fs.promises.stat(filePath);
  const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const variesByEncoding = stat.size >= 1024 && compressibleTypes.some((value) => type.startsWith(value));
  if (etagMatches(req, etag)) {
    res.writeHead(304, {
      "cache-control": cacheControl,
      etag,
      ...(variesByEncoding ? { vary: "Accept-Encoding" } : {})
    });
    res.end();
    return;
  }
  const encoding = responseEncoding(req, type, stat.size);
  if (encoding === null) {
    res.writeHead(406, { vary: "Accept-Encoding" });
    res.end();
    return;
  }
  const consentHeaders = pathname.startsWith("/oauth/consent") ? {
    "content-security-policy": `default-src 'self'; script-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; connect-src 'self' ${supabaseUrl}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY"
  } : {};
  res.writeHead(200, {
    "content-type": type,
    "cache-control": cacheControl,
    etag,
    ...(encoding ? { "content-encoding": encoding } : {}),
    ...(variesByEncoding ? { vary: "Accept-Encoding" } : {}),
    ...consentHeaders
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const precompressed = cachedCompression(filePath, stat, encoding);
  if (precompressed) {
    res.end(precompressed);
    return;
  }
  const stream = fs.createReadStream(filePath);
  if (encoding === "br") {
    stream.pipe(zlib.createBrotliCompress({
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 }
    })).pipe(res);
  }
  else if (encoding === "gzip") stream.pipe(zlib.createGzip()).pipe(res);
  else stream.pipe(res);
}
