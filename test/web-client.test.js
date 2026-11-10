import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../server/config.js";
import { serveStatic } from "../server/static.js";

// A stand-in for clients/web/dist: the app page, a hashed asset, and a sub-folder page.
const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klui-web-"));
fs.mkdirSync(path.join(webRoot, "assets"));
fs.mkdirSync(path.join(webRoot, "home"));
fs.writeFileSync(path.join(webRoot, "index.html"), "<!doctype html><title>rebuilt app</title>");
fs.writeFileSync(path.join(webRoot, "assets", "main-abc123.js"), "console.log(1)");
fs.writeFileSync(path.join(webRoot, "home", "index.html"), "<title>copied home</title>");

function serve(options) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    serveStatic(req, res, url, options).catch((error) => { res.writeHead(500); res.end(String(error)); });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function get(server, urlPath) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${urlPath}`);
  return { status: response.status, cache: response.headers.get("cache-control"), body: await response.text() };
}

test("WEB_CLIENT=new serves the rebuilt app, with public/ behind it; anything else keeps the old site", async () => {
  assert.equal(loadConfig({ WEB_CLIENT: "new" }).webClient, "new");
  assert.equal(loadConfig({}).webClient, "legacy");

  const server = await serve({ webClient: "new", webRoot });
  try {
    for (const page of ["/", "/index.html", "/study", "/chat/123"]) {
      const response = await get(server, page);
      assert.equal(response.status, 200, page);
      assert.match(response.body, /rebuilt app/, page);
      assert.equal(response.cache, "no-cache", page);
    }
    const asset = await get(server, "/assets/main-abc123.js");
    assert.equal(asset.cache, "public, max-age=31536000, immutable");
    assert.doesNotMatch((await get(server, "/home/")).body, /copied home/);
    assert.equal((await get(server, "/service-worker.js")).status, 200);
    assert.equal((await get(server, "/assets/missing.js")).status, 404);
  } finally {
    server.close();
  }

  const legacy = await serve({ webClient: "legacy", webRoot });
  try {
    assert.doesNotMatch((await get(legacy, "/study")).body, /rebuilt app/);
  } finally {
    legacy.close();
  }
});
