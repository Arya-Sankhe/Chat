import http from "node:http";
import { loadConfig } from "./config.js";
import { handleApiRequest } from "./routes.js";
import { serveStatic } from "./static.js";

const config = loadConfig();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApiRequest(req, res, url, config);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ error: "Unexpected server error" }));
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Smartyfy Chat listening on http://${config.host}:${config.port}`);
});
