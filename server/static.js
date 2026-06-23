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

export async function serveStatic(req, res, url, { allowedOrigins = [] } = {}) {
  const requestedPath = decodeURIComponent(url.pathname);
  const pathname = requestedPath === "/"
    ? "/index.html"
    : ["/download/android", "/download/android/"].includes(requestedPath)
      ? "/download/android/index.html"
      : requestedPath;
  if (pathname === "/downloads/android/latest.json") {
    applyApiCors(req, res, allowedOrigins);
  }
  const filePath = path.resolve(publicDir, `.${pathname}`);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache"
    });
    fs.createReadStream(path.join(publicDir, "index.html")).pipe(res);
    return;
  }

  if (!stat.isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
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
