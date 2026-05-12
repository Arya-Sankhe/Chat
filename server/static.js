import fs from "node:fs";
import path from "node:path";

const publicDir = path.resolve(process.cwd(), "public");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

export async function serveStatic(_req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
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
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(publicDir, "index.html")).pipe(res);
    return;
  }

  if (!stat.isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const type = contentTypes.get(path.extname(filePath)) || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "cache-control": type.includes("text/html") ? "no-cache" : "public, max-age=300"
  });
  fs.createReadStream(filePath).pipe(res);
}
