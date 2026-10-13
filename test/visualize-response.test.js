import assert from "node:assert/strict";
import test from "node:test";

import { applyVisualizePatch, ensureVisualizeResponse, findVisualizeError, hoistHeadScripts } from "../server/chat/visualize.js";

const fence = (html) => `\`\`\`visualize\n${html}\n\`\`\``;

test("visualize validation rejects extra fences and oversized documents", () => {
  const valid = fence("<!doctype html><html><body>Ready</body></html>");
  assert.equal(findVisualizeError(valid), "");
  assert.match(findVisualizeError(`${valid}\n${valid}`), /exactly one/);
  assert.match(findVisualizeError(fence(`<html><body>${"x".repeat(121 * 1024)}</body></html>`)), /120 KiB/);
});

test("visualize repair propagates a user abort without resetting or retrying", async () => {
  const controller = new AbortController();
  let resets = 0;
  const modelClient = {
    async chatCompletion() {
      controller.abort();
      throw new DOMException("Stopped", "AbortError");
    },
    async streamChatCompletion() {
      assert.fail("full repair must not start after abort");
    }
  };
  await assert.rejects(ensureVisualizeResponse({
    required: true,
    result: { accumulated: { content: fence('<html><body><script src="https://cdn.example/widget.js"></script></body></html>') } },
    chatRequest: { messages: [] },
    modelClient,
    provider: { id: "openrouter", apiKey: "key", baseUrl: "https://openrouter.ai/api/v1" },
    signal: controller.signal,
    res: {},
    onReset: () => { resets += 1; }
  }), { name: "AbortError" });
  assert.equal(resets, 0);
});

test("visualize validation catches lookups of ids the markup never defines", () => {
  const broken = fence(`<html><body><div id="chart"></div><button id="play">Play</button><script>
document.getElementById("chart");
document.getElementById("play-btn").addEventListener("click", () => {});
document.querySelector("#play");
</script></body></html>`);
  assert.match(findVisualizeError(broken), /#play-btn/);
  const dynamic = fence(`<html><body><div id="bars"></div><script>
const bars = document.getElementById("bars");
bars.innerHTML = [0, 1].map((i) => \`<span id="bar-\${i}"></span>\`).join("");
document.getElementById("bar-0");
</script></body></html>`);
  assert.equal(findVisualizeError(dynamic), "");
});

test("head scripts that touch the DOM move to the end of the body", () => {
  const doc = `<html><head><script>document.getElementById("x").textContent = "hi";</script></head><body><p id="x"></p></body></html>`;
  const hoisted = hoistHeadScripts(doc);
  assert.ok(hoisted.indexOf("<script>") > hoisted.indexOf('<p id="x">'));
  // A body script may call a function defined in <head>, so mixed layouts keep their order.
  const mixed = `<html><head><script>function render(){ document.body.textContent = "ok"; }</script></head><body><script>render();</script></body></html>`;
  assert.equal(hoistHeadScripts(mixed), mixed);
});

test("ids written inside escaped innerHTML strings count as defined", () => {
  const doc = fence(`<html><body><div id="root"></div><script>
document.getElementById("root").innerHTML = "<button id=\\"play\\">Play</button>";
document.getElementById("play").onclick = () => {};
</script></body></html>`);
  assert.equal(findVisualizeError(doc), "");
});

test("visualize patches apply exact search/replace edits and reject misses", () => {
  const doc = "<p id=\"a\">one</p>\n<script>\nconst x = 1\n</script>";
  const patch = "<<<<<<< SEARCH\nconst x = 1\n=======\nconst x = 2;\n>>>>>>> REPLACE";
  assert.equal(applyVisualizePatch(doc, patch), doc.replace("const x = 1", "const x = 2;"));
  assert.equal(applyVisualizePatch(doc, "<<<<<<< SEARCH\nnot here\n=======\nx\n>>>>>>> REPLACE"), "");
  assert.equal(applyVisualizePatch(doc, "no blocks"), "");
  // CRLF documents match LF patches, and a copied gutter is stripped from both sides.
  assert.equal(applyVisualizePatch(doc.replace(/\n/g, "\r\n"), patch), doc.replace("const x = 1", "const x = 2;"));
  const gutter = "<<<<<<< SEARCH\n   3| const x = 1\n=======\n   3| const x = 2;\n>>>>>>> REPLACE";
  assert.equal(applyVisualizePatch(doc, gutter), doc.replace("const x = 1", "const x = 2;"));
});

test("a compile error is fixed with a fast-model patch, not a full regeneration", async () => {
  let resets = 0;
  const written = [];
  const modelClient = {
    async chatCompletion({ body }) {
      assert.match(body.messages[0].content, /<<<<<<< SEARCH/);
      return "<<<<<<< SEARCH\nconst x = ;\n=======\nconst x = 1;\n>>>>>>> REPLACE";
    },
    async streamChatCompletion() {
      assert.fail("a patchable error must not regenerate the whole visual");
    }
  };
  const result = await ensureVisualizeResponse({
    required: true,
    result: { accumulated: { content: `Here it is.\n${fence("<html><body><script>\nconst x = ;\n</script></body></html>")}` } },
    chatRequest: { messages: [] },
    modelClient,
    provider: { id: "openrouter", apiKey: "key", baseUrl: "https://openrouter.ai/api/v1" },
    res: { write: (chunk) => written.push(chunk) },
    onReset: () => { resets += 1; }
  });
  assert.equal(resets, 1);
  assert.match(result.accumulated.content, /const x = 1;/);
  assert.match(result.accumulated.content, /^Here it is\./);
  assert.equal(findVisualizeError(result.accumulated.content), "");
});
