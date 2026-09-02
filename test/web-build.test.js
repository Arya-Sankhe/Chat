import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../public/js/api.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

test("web build monitor is wired to a no-store endpoint and direct reload action", () => {
  assert.match(api, /fetch\(apiUrl\("\/api\/config"\), \{ cache: "no-store" \}\)/);
  assert.match(api, /fetch\(apiUrl\("\/api\/build"\), \{ cache: "no-store" \}\)/);
  assert.match(api, /x-klui-build-id/);
  assert.match(api, /!isNative\(\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange", checkWhenVisible\)/);
  assert.match(app, /window\.addEventListener\("focus", checkWhenVisible\)/);
  assert.match(app, /function reloadAppIfSafe\(\) \{\s*window\.location\.reload\(\);\s*\}/);
  assert.doesNotMatch(app, /Finish the current response or send\/save your draft before reloading\./);
  assert.match(index, /id="appUpdateToast"/);
  assert.match(index, /Klui has updated\./);
  assert.match(index, /id="appUpdateReload"/);
  assert.match(index, /aria-label="Reload"/);
  assert.match(index, /src="\/js\/app\.js"/);
  assert.match(index, /href="\/styles\.css"/);
  assert.doesNotMatch(styles, /\?v=/);
});

test("Docker image creates an app build ID from shipped content", () => {
  assert.match(dockerfile, /find server public .*sha256sum/);
  assert.doesNotMatch(dockerfile, /ARG BUILD_ID/);
});
