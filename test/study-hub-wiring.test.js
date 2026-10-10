import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The study hub gets its API functions from app.js; one left out only fails when it's used.
test("app.js passes the study hub everything it asks for", async () => {
  const hub = await readFile(new URL("../public/js/studyHub.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/js/app.js", import.meta.url), "utf8");
  const wanted = hub.match(/export function createStudyHubController\(\{([\s\S]*?)\}\)/)[1]
    .split(",").map((name) => name.trim().split(/[\s=:]/)[0]).filter(Boolean);
  const call = app.slice(app.indexOf("createStudyHubController({"));
  const given = call.slice(0, call.indexOf("});"));
  const missing = wanted.filter((name) => !new RegExp(`\\b${name}\\b`).test(given));
  assert.ok(wanted.includes("openTutorBoard"));
  assert.deepEqual(missing, []);
});
