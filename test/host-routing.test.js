import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";

import {
  hostRedirectLocation,
  isLegacyWebNavigation,
  serveStatic
} from "../server/static.js";

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");

function request(host, accept = "text/html") {
  return { method: "GET", headers: { host, accept } };
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    serveStatic(req, res, url).catch((error) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error));
    });
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise(server));
  });
}

function get(server, { host, path, accept = "text/html", method = "GET", headers: extraHeaders = {} }) {
  const { port } = server.address();
  return new Promise((resolvePromise, reject) => {
    const headers = { host, ...extraHeaders };
    if (accept != null) headers.accept = accept;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks);
        resolvePromise({
          status: res.statusCode,
          headers: res.headers,
          rawBody,
          body: rawBody.toString("utf8")
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

test("www.klui.ai permanently redirects to klui.ai preserving a safe path and query", () => {
  const location = hostRedirectLocation(
    request("www.klui.ai"),
    new URL("https://www.klui.ai/download/android?ref=nav")
  );
  assert.equal(location, "https://klui.ai/download/android?ref=nav");
});

test("static text assets are compressed, version-cached, and revalidated", async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  const compressed = await get(server, {
    host: "klui.ai",
    path: "/js/app.js?v=test",
    accept: "text/javascript",
    headers: { "accept-encoding": "br" }
  });
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers["content-encoding"], "br");
  assert.equal(compressed.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.match(brotliDecompressSync(compressed.rawBody).toString("utf8"), /async function bootstrap/);

  const revalidated = await get(server, {
    host: "klui.ai",
    path: "/js/app.js",
    accept: "text/javascript",
    headers: { "if-none-match": compressed.headers.etag }
  });
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.rawBody.length, 0);
});

test("www.klui.ai redirect cannot become an open redirect", () => {
  const location = hostRedirectLocation(
    request("www.klui.ai"),
    new URL("https://www.klui.ai//evil.example/phish")
  );
  assert.equal(location, "https://klui.ai/evil.example/phish");
  assert.equal(location.startsWith("https://klui.ai/"), true);
});

test("klui.tech HTML navigation permanently redirects to klui.ai with moved=1", () => {
  assert.equal(
    isLegacyWebNavigation(request("klui.tech"), new URL("https://klui.tech/c/123")),
    true
  );
  assert.equal(
    hostRedirectLocation(request("klui.tech"), new URL("https://klui.tech/c/123")),
    "https://klui.ai/c/123?moved=1"
  );
  assert.equal(
    hostRedirectLocation(request("www.klui.tech:443"), new URL("https://www.klui.tech/")),
    "https://klui.ai/?moved=1"
  );
});

test("klui.tech OAuth and JSON routes are not redirected", () => {
  assert.equal(
    hostRedirectLocation(request("klui.tech"), new URL("https://klui.tech/oauth/consent")),
    null
  );
  assert.equal(
    hostRedirectLocation(
      request("klui.tech", "application/json"),
      new URL("https://klui.tech/downloads/android/latest.json")
    ),
    null
  );
  assert.equal(
    hostRedirectLocation(request("klui.ai"), new URL("https://klui.ai/")),
    null
  );
});

test("host routing serves chat, marketing, robots, sitemap, redirects, and true 404s", async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  const chatRoot = await get(server, { host: "klui.ai", path: "/" });
  assert.equal(chatRoot.status, 200);
  assert.match(chatRoot.headers["content-type"], /text\/html/);
  assert.match(chatRoot.body, /<title>Klui AI<\/title>/);
  assert.match(chatRoot.body, /rel="canonical" href="https:\/\/klui.ai\/"/);
  assert.match(chatRoot.body, /id="chatView"/);
  assert.doesNotMatch(chatRoot.body, /Locked in so you can/);

  const spa = await get(server, { host: "klui.ai", path: "/c/not-a-static-file" });
  assert.equal(spa.status, 200);
  assert.match(spa.body, /id="chatView"/);

  const marketing = await get(server, { host: "home.klui.ai", path: "/" });
  assert.equal(marketing.status, 200);
  assert.match(marketing.headers["content-type"], /text\/html/);
  assert.match(marketing.body, /<h1 id="hero-title">Locked in so you can relax<\/h1>/);
  assert.match(marketing.body, />Join Klui <span aria-hidden="true">→<\/span><\/a>/);
  assert.doesNotMatch(marketing.body, /class="cta nav-cta"/);
  assert.match(marketing.body, /rel="canonical" href="https:\/\/home.klui.ai\/"/);
  assert.doesNotMatch(marketing.body, /id="chatView"/);

  const preview = await get(server, { host: "localhost", path: "/home/" });
  assert.equal(preview.status, 200);
  assert.match(preview.body, /Locked in so you can/);

  const missingMarketing = await get(server, { host: "home.klui.ai", path: "/does-not-exist" });
  assert.equal(missingMarketing.status, 404);
  assert.match(missingMarketing.headers["content-type"], /text\/html/);
  assert.doesNotMatch(missingMarketing.body, /id="chatView"/);
  assert.match(missingMarketing.body, /not on home\.klui\.ai/);

  const missingHomeAsset = await get(server, { host: "localhost", path: "/home/missing-page" });
  assert.equal(missingHomeAsset.status, 404);

  const www = await get(server, { host: "www.klui.ai", path: "/download/android?ref=1" });
  assert.equal(www.status, 301);
  assert.equal(www.headers.location, "https://klui.ai/download/android?ref=1");

  const moved = await get(server, { host: "klui.tech", path: "/" });
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.location, "https://klui.ai/?moved=1");

  const wwwHome = await get(server, { host: "www.home.klui.ai", path: "/?x=1" });
  assert.equal(wwwHome.status, 301);
  assert.equal(wwwHome.headers.location, "https://home.klui.ai/?x=1");

  const robots = await get(server, { host: "klui.ai", path: "/robots.txt", accept: "*/*" });
  assert.equal(robots.status, 200);
  assert.match(robots.headers["content-type"], /^text\/plain/);
  assert.match(robots.body, /Sitemap: https:\/\/klui\.ai\/sitemap\.xml/);
  assert.doesNotMatch(robots.body, /id="chatView"/);

  const sitemap = await get(server, { host: "klui.ai", path: "/sitemap.xml", accept: "*/*" });
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers["content-type"], /application\/xml/);
  assert.match(sitemap.body, /<loc>https:\/\/klui\.ai\/<\/loc>/);

  const homeRobots = await get(server, { host: "home.klui.ai", path: "/robots.txt", accept: "*/*" });
  assert.equal(homeRobots.status, 200);
  assert.match(homeRobots.headers["content-type"], /^text\/plain/);
  assert.match(homeRobots.body, /Sitemap: https:\/\/home\.klui\.ai\/sitemap\.xml/);

  const homeSitemap = await get(server, { host: "home.klui.ai", path: "/sitemap.xml", accept: "*/*" });
  assert.equal(homeSitemap.status, 200);
  assert.match(homeSitemap.headers["content-type"], /application\/xml/);
  assert.match(homeSitemap.body, /<loc>https:\/\/home\.klui\.ai\/<\/loc>/);
  assert.match(homeSitemap.body, /<loc>https:\/\/home\.klui\.ai\/pricing\/<\/loc>/);
  assert.match(homeSitemap.body, /<loc>https:\/\/home\.klui\.ai\/legal\/<\/loc>/);
  assert.match(homeSitemap.body, /<loc>https:\/\/home\.klui\.ai\/privacy\/<\/loc>/);
  assert.doesNotMatch(homeSitemap.body, /<loc>https:\/\/klui\.ai\/<\/loc>/);

  const pricing = await get(server, { host: "home.klui.ai", path: "/pricing/" });
  assert.equal(pricing.status, 200);
  assert.match(pricing.body, /<title>Klui pricing<\/title>/);
  assert.match(pricing.body, /10<\/strong> AED/);
  assert.match(pricing.body, /30<\/strong> AED/);
  assert.match(pricing.body, /50<\/strong> AED/);
  assert.match(pricing.body, /Usage is weekly\. It resets 4 times each month\./);
  assert.match(pricing.body, /rel="canonical" href="https:\/\/home\.klui\.ai\/pricing\/"/);

  const pricingPreview = await get(server, { host: "localhost", path: "/home/pricing/" });
  assert.equal(pricingPreview.status, 200);
  assert.match(pricingPreview.body, /Three plans/);

  const hero = await get(server, { host: "home.klui.ai", path: "/assets/hero-refined-v4.webp", accept: "image/webp" });
  assert.equal(hero.status, 200);
  assert.match(hero.headers["content-type"], /image\/webp/);

  const android = await get(server, { host: "klui.ai", path: "/download/android" });
  assert.equal(android.status, 200);
  assert.match(android.body, /Klui for Android/);

  const oauth = await get(server, { host: "klui.tech", path: "/oauth/consent" });
  assert.equal(oauth.status, 200);
  assert.equal(oauth.headers.location, undefined);
  assert.match(oauth.body, /consent/i);
});

test("chat document and marketing page keep distinct canonicals and the moved notice", () => {
  const chat = readFileSync(resolve(publicDir, "index.html"), "utf8");
  assert.match(chat, /<title>Klui AI<\/title>/);
  assert.match(chat, /Usage is weekly\. It resets 4 times each month\./);
  assert.match(chat, /id="movedNotice"/);
  assert.match(chat, /searchParams\.get\("moved"\) !== "1"/);
  assert.match(chat, /history\.replaceState/);
  assert.match(chat, /"@type": "WebSite"[\s\S]*?"name": "Klui"[\s\S]*?"alternateName": \["Klui AI", "klui\.ai"\]/);
  assert.match(chat, /"@type": "SoftwareApplication"/);

  const home = readFileSync(resolve(publicDir, "home/index.html"), "utf8");
  assert.match(home, /<title>Klui for students<\/title>/);
  assert.match(home, /property="og:site_name" content="Klui for students"/);
  assert.match(home, /Locked in so you can/);
  assert.match(home, /rel="canonical" href="https:\/\/home.klui.ai\/"/);
  assert.match(home, /one AI workspace for student life/i);
  assert.doesNotMatch(home, /unleash|seamless|next-gen|Sign up|Start playing/i);
  assert.match(home, /"@type": "Organization"[\s\S]*?"url": "https:\/\/klui\.ai\/"/);
  assert.match(home, /"@type": "WebSite"[\s\S]*?"name": "Klui for students"[\s\S]*?"url": "https:\/\/home\.klui\.ai\/"/);
  assert.match(home, /"about":\s*\{\s*"@type": "SoftwareApplication"[\s\S]*?"url": "https:\/\/klui\.ai\/"/);
  assert.doesNotMatch(home, /"sameAs"/);
});

test("production /home redirects to the marketing host while localhost keeps the preview", async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  for (const path of ["/home", "/home/", "/home/index.html"]) {
    const production = await get(server, { host: "klui.ai", path });
    assert.equal(production.status, 301);
    assert.equal(production.headers.location, "https://home.klui.ai/");
  }

  const wwwHome = await get(server, { host: "www.klui.ai", path: "/home/" });
  assert.equal(wwwHome.status, 301);
  assert.equal(wwwHome.headers.location, "https://home.klui.ai/");

  const wwwHomeNoSlash = await get(server, { host: "www.klui.ai", path: "/home" });
  assert.equal(wwwHomeNoSlash.status, 301);
  assert.equal(wwwHomeNoSlash.headers.location, "https://home.klui.ai/");

  const preview = await get(server, { host: "localhost", path: "/home/" });
  assert.equal(preview.status, 200);
  assert.match(preview.body, /Locked in so you can/);
  assert.match(preview.body, /<title>Klui for students<\/title>/);
});

test("primary robots disallows /home without requiring a trailing slash", () => {
  const robots = readFileSync(resolve(publicDir, "robots.txt"), "utf8");
  assert.match(robots, /^Disallow: \/home$/m);
  assert.doesNotMatch(robots, /^Disallow: \/home\/$/m);
});

test("chat UI keeps a stable Klui AI heading and demotes the greeting", () => {
  const chat = readFileSync(resolve(publicDir, "index.html"), "utf8");
  const klui = readFileSync(resolve(publicDir, "js/klui.js"), "utf8");
  const css = [
    readFileSync(resolve(publicDir, "styles/klui.css"), "utf8"),
    readFileSync(resolve(publicDir, "styles/messages.css"), "utf8"),
    readFileSync(resolve(publicDir, "styles/mobile.css"), "utf8")
  ].join("\n");

  assert.match(chat, /id="chatView"[\s\S]*?<h1 class="sr-only">Klui AI<\/h1>/);
  assert.match(chat, /<p class="type-line"><span class="type-text">\$\{greeting\}<\/span>/);
  assert.doesNotMatch(chat, /<h1 class="type-line">/);
  assert.match(klui, /<p class="type-line"><span class="type-text">\$\{initialText\}<\/span>/);
  assert.doesNotMatch(klui, /<h1 class="type-line">/);
  assert.match(css, /\.empty-state \.type-line\s*\{/);
  assert.doesNotMatch(css, /\.empty-state h1(?:\.type-line)?\s*\{/);
});

test("klui.tech redirects */* and missing Accept while preserving path and query", async (t) => {
  const star = { method: "GET", headers: { host: "klui.tech", accept: "*/*" } };
  const missing = { method: "GET", headers: { host: "klui.tech" } };
  const head = { method: "HEAD", headers: { host: "klui.tech" } };
  const html = request("klui.tech");
  const target = new URL("https://klui.tech/c/123?ref=nav");

  assert.equal(isLegacyWebNavigation(star, target), true);
  assert.equal(isLegacyWebNavigation(missing, target), true);
  assert.equal(hostRedirectLocation(star, target), "https://klui.ai/c/123?ref=nav&moved=1");
  assert.equal(hostRedirectLocation(missing, target), "https://klui.ai/c/123?ref=nav&moved=1");
  assert.equal(hostRedirectLocation(head, target), "https://klui.ai/c/123?ref=nav&moved=1");
  assert.equal(
    hostRedirectLocation(html, new URL("https://klui.tech/download/android?from=legacy")),
    "https://klui.ai/download/android?from=legacy&moved=1"
  );
  assert.equal(
    hostRedirectLocation(html, new URL("https://klui.tech/robots.txt")),
    "https://klui.ai/robots.txt"
  );
  assert.equal(
    hostRedirectLocation(html, new URL("https://klui.tech/sitemap.xml")),
    "https://klui.ai/sitemap.xml"
  );
  assert.equal(
    hostRedirectLocation(
      request("klui.tech", "text/html"),
      new URL("https://klui.tech/downloads/android/latest.json")
    ),
    null
  );

  const server = await startServer();
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  const starRes = await get(server, { host: "klui.tech", path: "/c/123?ref=nav", accept: "*/*" });
  assert.equal(starRes.status, 301);
  assert.equal(starRes.headers.location, "https://klui.ai/c/123?ref=nav&moved=1");

  const missingRes = await get(server, { host: "klui.tech", path: "/research/abc", accept: null });
  assert.equal(missingRes.status, 301);
  assert.equal(missingRes.headers.location, "https://klui.ai/research/abc?moved=1");
});

test("legacy robots and sitemap map to the same canonical paths without moved=1", async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  const robots = await get(server, { host: "klui.tech", path: "/robots.txt", accept: "*/*" });
  assert.equal(robots.status, 301);
  assert.equal(robots.headers.location, "https://klui.ai/robots.txt");

  const sitemap = await get(server, { host: "klui.tech", path: "/sitemap.xml", accept: "text/html" });
  assert.equal(sitemap.status, 301);
  assert.equal(sitemap.headers.location, "https://klui.ai/sitemap.xml");
});

test("malformed percent-encoded paths do not 500 and trailing-dot hosts still route", async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  const malformed = await get(server, { host: "klui.ai", path: "/%ZZ" });
  assert.notEqual(malformed.status, 500);
  assert.ok(malformed.status < 500);

  const incomplete = await get(server, { host: "klui.ai", path: "/%E0%A4%A" });
  assert.notEqual(incomplete.status, 500);

  const dottedHome = await get(server, { host: "home.klui.ai.", path: "/" });
  assert.equal(dottedHome.status, 200);
  assert.match(dottedHome.body, /Locked in so you can/);

  const dottedWww = await get(server, { host: "www.klui.ai.", path: "/download/android" });
  assert.equal(dottedWww.status, 301);
  assert.equal(dottedWww.headers.location, "https://klui.ai/download/android");

  const dottedLegacy = await get(server, { host: "klui.tech.", path: "/", accept: "*/*" });
  assert.equal(dottedLegacy.status, 301);
  assert.equal(dottedLegacy.headers.location, "https://klui.ai/?moved=1");

  const dottedWwwHome = await get(server, { host: "www.klui.ai.", path: "/home" });
  assert.equal(dottedWwwHome.status, 301);
  assert.equal(dottedWwwHome.headers.location, "https://home.klui.ai/");
});

test("stale /moved pages redirect to the primary origin and marketing 404s link home", async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  for (const path of ["/moved", "/moved/"]) {
    const moved = await get(server, { host: "klui.ai", path });
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.location, "https://klui.ai/");
  }

  const missing = await get(server, { host: "home.klui.ai", path: "/does-not-exist" });
  assert.equal(missing.status, 404);
  assert.match(missing.body, /<a class="wordmark" href="\/">/);
  assert.match(missing.body, /<a class="text-link" href="\/">Back to home\.klui\.ai<\/a>/);
  assert.doesNotMatch(missing.body, /<a [^>]*href="\/home\/"/);
});

test("legal URLs live on home.klui.ai and never load the chat app", async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  const pages = [
    ["/legal/", "Terms &amp; policies"],
    ["/privacy/", "Privacy policy"],
    ["/terms/", "Terms of use"],
    ["/cookies/", "Cookie policy"],
    ["/subprocessors/", "Subprocessors"],
    ["/account-delete/", "Delete your account"],
    ["/status/", "Status"]
  ];

  for (const [path, heading] of pages) {
    const fromChat = await get(server, { host: "klui.ai", path });
    assert.equal(fromChat.status, 301);
    assert.equal(fromChat.headers.location, `https://home.klui.ai${path}`);
    assert.doesNotMatch(fromChat.body, /id="chatView"/);

    const fromWww = await get(server, { host: "www.klui.ai", path: path.replace(/\/$/, "") });
    assert.equal(fromWww.status, 301);
    assert.equal(fromWww.headers.location, `https://home.klui.ai${path}`);

    const page = await get(server, { host: "home.klui.ai", path });
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.body, /id="chatView"/);
    assert.match(page.body, new RegExp(`rel="canonical" href="https://home\\.klui\\.ai${path.replaceAll("/", "\\/")}"`));
    assert.match(page.body, new RegExp(`<h1>${heading}</h1>`));
    assert.match(page.body, /Not in force yet|Not published yet/);

    const preview = await get(server, { host: "localhost", path: `/home${path}` });
    assert.equal(preview.status, 200);
    assert.match(preview.body, new RegExp(`<h1>${heading}</h1>`));
    assert.doesNotMatch(preview.body, /id="chatView"/);
  }

  const chat = readFileSync(resolve(publicDir, "index.html"), "utf8");
  assert.match(chat, /class="settings-legal"/);
  assert.match(chat, /class="auth-legal"/);
  assert.match(chat, /By continuing, you agree to our .*Terms of use.* and .*Privacy policy.*, and confirm you are 18 or older/);
  assert.match(chat, /href="https:\/\/home\.klui\.ai\/terms\/"/);
  assert.match(chat, /href="https:\/\/home\.klui\.ai\/privacy\/"/);
  assert.match(chat, /href="https:\/\/home\.klui\.ai\/account-delete\/"/);
  assert.match(chat, /href="https:\/\/home\.klui\.ai\/legal\/"/);

  const home = readFileSync(resolve(publicDir, "home/index.html"), "utf8");
  assert.match(home, /href="terms\/">Terms</);
  assert.match(home, /href="privacy\/">Privacy</);
  assert.match(home, /href="legal\/">Legal</);
});

test("both origins publish /.well-known/gpc.json and do not fall through to the chat app", async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  for (const host of ["klui.ai", "home.klui.ai"]) {
    const res = await get(server, { host, path: "/.well-known/gpc.json", accept: "application/json" });
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.doesNotMatch(res.body, /id="chatView"/);
    assert.deepEqual(JSON.parse(res.body), { gpc: true, lastUpdate: "2026-08-24" });
  }
});
