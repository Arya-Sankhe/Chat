// Serves the current site (public/) unchanged, with /api proxied to a backend
// (the mock by default), so the old and new clients can be compared side by side.
// Usage: node reference-server.mjs [port=5181] [api=http://localhost:5199]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] || 5181);
const api = new URL(process.argv[3] || "http://localhost:5199");
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public");

const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp3": "audio/mpeg",
  ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml"
};

function proxy(req, res) {
  const upstream = http.request(
    { hostname: api.hostname, port: api.port, path: req.url, method: req.method, headers: { ...req.headers, host: api.host } },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    }
  );
  upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return proxy(req, res);
  let file = path.resolve(publicDir, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(publicDir)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  // The app is a single page: unknown paths get the shell, like the real server.
  if (!fs.existsSync(file)) file = path.join(publicDir, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Reference site (public/) on http://localhost:${port}, API ${api.origin}`));
