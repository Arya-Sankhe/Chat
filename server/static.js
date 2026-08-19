import fs from "node:fs";
import path from "node:path";
import { applyApiCors } from "./http/cors.js";

const publicDir = path.resolve(process.cwd(), "public");
const legacyWebHosts = new Set(["klui.tech", "www.klui.tech"]);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webmanifest", "application/manifest+json"],
  [".apk", "application/vnd.android.package-archive"],
  [".exe", "application/vnd.microsoft.portable-executable"]
]);

const directoryIndexes = new Map([
  ["/download/android", "/download/android/index.html"],
  ["/download/android/", "/download/android/index.html"],
  ["/download/windows", "/download/windows/index.html"],
  ["/download/windows/", "/download/windows/index.html"]
]);

async function resolvePublicFile(pathname) {
  const mapped = directoryIndexes.get(pathname);
  const candidates = mapped
    ? [mapped]
    : pathname.endsWith("/")
      ? [`${pathname}index.html`]
      : [pathname, `${pathname}/index.html`];

  for (const candidate of candidates) {
    const filePath = path.resolve(publicDir, `.${candidate}`);
    if (!filePath.startsWith(publicDir)) continue;
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isFile()) return filePath;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

export function isLegacyWebNavigation(req, url) {
  const hostname = String(req.headers.host || "").toLowerCase().replace(/:\d+$/, "");
  const acceptsHtml = String(req.headers.accept || "").includes("text/html");
  return req.method === "GET"
    && legacyWebHosts.has(hostname)
    && !url.pathname.startsWith("/oauth/")
    && (acceptsHtml || req.headers["sec-fetch-dest"] === "document");
}

export async function serveStatic(req, res, url, { allowedOrigins = [], supabaseUrl = "" } = {}) {
  const requestedPath = decodeURIComponent(url.pathname);
  const pathname = isLegacyWebNavigation(req, url)
    ? "/moved/index.html"
    : requestedPath === "/"
    ? "/index.html"
    : requestedPath;
  if (pathname === "/downloads/android/latest.json") {
    applyApiCors(req, res, allowedOrigins);
  }

  const filePath = await resolvePublicFile(pathname);

  if (!filePath) {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache"
    });
    fs.createReadStream(path.join(publicDir, "index.html")).pipe(res);
    return;
  }

  const type = contentTypes.get(path.extname(filePath)) || "application/octet-stream";
  const cacheControl = type.includes("text/html") || type.includes("text/javascript") || type.includes("text/css")
    ? "no-cache"
    : "public, max-age=300";
  const consentHeaders = pathname.startsWith("/oauth/consent") ? {
    "content-security-policy": `default-src 'self'; script-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; connect-src 'self' ${supabaseUrl}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY"
  } : {};
  res.writeHead(200, {
    "content-type": type,
    "cache-control": cacheControl,
    ...consentHeaders
  });
  fs.createReadStream(filePath).pipe(res);
}
