import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { readStylesheet } from "./helpers/styles.js";

test("temporary chat uses one reversible, code-native sketch", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8"),
    readStylesheet(),
  ]);

  assert.match(html, /<svg class="temporary-chat-art" viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none"/);
  const path = html.match(/<path class="temporary-chat-line temporary-chat-line-fragments"[^>]* d="([^"]+)"/);
  assert.ok(path, "temporary-chat line should exist");
  const coordinates = path[1].match(/-?\d+/g).map(Number);
  assert.ok(coordinates[0] < 0 && coordinates[1] < 10, "line should begin beyond the top-left edge");
  assert.ok(coordinates.at(-2) > 100 && coordinates.at(-1) > 90, "line should end beyond the bottom-right edge");
  assert.match(css, /\.temporary-chat-art \{[\s\S]*?position: fixed;[\s\S]*?width: 100vw;[\s\S]*?height: 100dvh;/);
  assert.match(css, /body\.chat-empty\.temporary-chat \.empty-state \.hero-line \{[\s\S]*?box-shadow: 0 0 0 18px #fff;/);
  assert.match(css, /@media \(max-width: 600px\) \{[\s\S]*?\.temporary-chat-line \{\s*stroke-width: 5;/);
  assert.match(html, /temporary-chat-line-fragments[\s\S]*temporary-chat-line-connector/);
  assert.match(css, /\.temporary-chat-line-fragments \{[\s\S]*?stroke-dasharray: 70 92;[\s\S]*?stroke-dashoffset: 1000;/);
  assert.match(css, /body\.chat-empty\.temporary-chat \.temporary-chat-line-fragments \{[\s\S]*?transition-duration: 1400ms;/);
  assert.match(css, /body\.chat-empty\.temporary-chat \.temporary-chat-line-connector \{[\s\S]*?stroke-dashoffset: 0;[\s\S]*?transition-duration: 900ms;[\s\S]*?transition-delay: 1150ms;/);
  assert.match(css, /body\[data-mode="dark"\] \.temporary-chat-art \{[\s\S]*?background: #050505;/);
  assert.doesNotMatch(app, /prepareWallpaperAperture|wallpaperTempLayer/);
});
