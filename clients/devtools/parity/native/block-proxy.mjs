// HTTP(S) proxy for the emulator that refuses the production hosts (klui.ai,
// klui.tech) so nothing in a test reaches them, and tunnels everything else.
import http from "node:http";
import net from "node:net";
const BLOCK = /(^|\.)klui\.(ai|tech)$/i;
const server = http.createServer((req, res) => {
  // Not a proxy request (a stray local connection): refuse it, don't crash.
  if (!URL.canParse(req.url)) { res.writeHead(400); return res.end(); }
  const url = new URL(req.url);
  // A test can put its own server in front of a local port: PROXY_REMAP=55421:55431,55600:55432
  for (const pair of (process.env.PROXY_REMAP || "").split(",")) {
    const [from, to] = pair.split(":");
    if (from && url.port === from) { url.port = to; break; }
  }
  if (BLOCK.test(url.hostname)) { console.log("blocked", req.method, req.url); res.writeHead(403); return res.end("blocked by parity proxy"); }
  const upstream = http.request(url, { method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  upstream.on("error", (error) => { console.log("upstream failed", req.url, error.message); res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
server.on("connect", (req, socket, head) => {
  const [host, port = "443"] = req.url.split(":");
  if (BLOCK.test(host)) { console.log("blocked CONNECT", req.url); socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  const upstream = net.connect(Number(port), host, () => { socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); upstream.write(head); upstream.pipe(socket); socket.pipe(upstream); });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
server.listen(Number(process.env.PORT || 55990), "0.0.0.0", () => console.log("proxy ready"));
