import fs from "node:fs";
import path from "node:path";
import { applyApiCors } from "./http/cors.js";

const publicDir = path.resolve(process.cwd(), "public");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webmanifest", "application/manifest+json"],
  [".apk", "application/vnd.android.package-archive"]
]);

const directoryIndexes = new Map([
  ["/download/android", "/download/android/index.html"],
  ["/download/android/", "/download/android/index.html"],
  ["/one-month", "/one-month/index.html"],
  ["/one-month/", "/one-month/index.html"]
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

export async function serveStatic(req, res, url, { allowedOrigins = [] } = {}) {
  const requestedPath = decodeURIComponent(url.pathname);
  const pathname = requestedPath === "/"
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
  res.writeHead(200, {
    "content-type": type,
    "cache-control": cacheControl
  });
  fs.createReadStream(filePath).pipe(res);
}
