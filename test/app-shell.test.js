import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

import { serveStatic } from "../server/static.js";

const publicUrl = new URL("../public/", import.meta.url);
const stylesRoot = readFileSync(new URL("styles.css", publicUrl), "utf8");

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    serveStatic(req, res, url).catch((error) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function get(server, path, headers = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.request({ hostname: "127.0.0.1", port, path, headers: { host: "klui.ai", ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const body = res.headers["content-encoding"] === "br" ? brotliDecompressSync(raw) : raw;
        resolve({ status: res.statusCode, headers: res.headers, raw, body: body.toString("utf8") });
      });
    }).on("error", reject).end();
  });
}

function shellParts(html) {
  const importMap = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
  const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((match) => match[1]);
  const stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
  return { importMap, preloads, stylesheets };
}

test("the app page addresses every script and stylesheet by content hash", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const page = await get(server, "/", { "accept-encoding": "br" });
  assert.equal(page.status, 200);
  assert.equal(page.headers["cache-control"], "no-cache");
  assert.equal(page.headers["content-encoding"], "br");
  const { importMap, preloads, stylesheets } = shellParts(page.body);

  assert.match(page.body, /<script type="module" src="\/js\/app\.js\?v=[a-f0-9]{12}"><\/script>/);
  assert.equal(preloads[0], importMap["/js/app.js"], "app.js preloads first");
  for (const url of preloads) assert.ok(Object.values(importMap).includes(url), `${url} is mapped`);
  for (const [plain, hashed] of Object.entries(importMap)) assert.equal(hashed, `${plain}?v=${hashed.split("?v=")[1]}`);
  assert.ok(importMap["/js/studyHub.js"], "lazy modules are versioned too");
  assert.ok(!preloads.includes(importMap["/js/studyHub.js"]), "lazy modules are not preloaded");
  assert.ok(page.body.indexOf('type="importmap"') < page.body.indexOf('rel="modulepreload"'));

  // The @import-only root becomes one link per file, in the same order.
  const imported = [...stylesRoot.matchAll(/url\("\.\/([^"]+)"\)/g)].map((match) => `/${match[1]}`);
  assert.deepEqual(stylesheets.slice(0, imported.length).map((url) => url.split("?v=")[0]), imported);
  assert.ok(!page.body.includes('href="/styles.css"'));

  for (const url of [...preloads.slice(0, 3), stylesheets[0]]) {
    const asset = await get(server, url);
    assert.equal(asset.status, 200, url);
    assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable", url);
  }

  const again = await get(server, "/", { "if-none-match": page.headers.etag });
  assert.equal(again.status, 304);
  const route = await get(server, "/c/some-chat");
  assert.equal(route.status, 200);
  assert.deepEqual(shellParts(route.body).importMap, importMap, "client routes get the same page");
});

test("a missing asset is a 404, not the app page", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  for (const path of ["/fonts/Korataki.woff2", "/js/missing.js", "/images/missing.webp"]) {
    const response = await get(server, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.body, /<html/i, path);
  }
});

test("text assets are served from a maximum-quality compressed copy once it is ready", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const source = readFileSync(new URL("js/render.js", publicUrl), "utf8");
  const first = await get(server, "/js/render.js", { "accept-encoding": "br" });
  assert.equal(first.body, source);
  let later = first;
  for (let attempt = 0; attempt < 50 && later.raw.length >= first.raw.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    later = await get(server, "/js/render.js", { "accept-encoding": "br" });
  }
  assert.equal(later.body, source);
  assert.ok(later.raw.length < first.raw.length, "the cached copy is smaller than the streamed one");
});
