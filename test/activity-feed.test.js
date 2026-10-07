import assert from "node:assert/strict";
import test from "node:test";

import { createThoughtTicker, latestThought } from "../server/chat/thoughtTicker.js";
import { createWriterProgress } from "../server/documents/writerProgress.js";
import { applyActivityEvent } from "../public/js/activityFeed.js";

const reasoning = (text) => ({ choices: [{ delta: { reasoning: text } }] });
const content = (text) => ({ choices: [{ delta: { content: text } }] });

test("latestThought returns the newest finished sentence, cleaned and clipped", () => {
  assert.equal(latestThought("The user wants Dubai restaurants. **Michelin picks** matter most here. Let me"), "Michelin picks matter most here.");
  assert.equal(latestThought("Still writing this one"), "");
  assert.equal(latestThought("Check the system prompt rules again. Short."), "");
  assert.ok(latestThought(`${"word ".repeat(60)}end.\n`).length <= 110);
  assert.equal(latestThought("The user is asking for the best roti in Dubai. I don't have a web search tool available in my toolset. I should be honest. Next"), "The user is asking for the best roti in Dubai.");
  assert.equal(latestThought("Let me check my available tools: get_weather. Neither helps here. Paratha hut? Next"), "");
});

test("thought ticker sends at most one glimpse per gap and never repeats", () => {
  let clock = 10_000;
  const sent = [];
  const tick = createThoughtTicker((event) => sent.push(event), { now: () => clock });
  tick(reasoning("Comparing the Michelin list with recent reviews. "));
  tick(reasoning("Then"));
  assert.deepEqual(sent, [{ type: "status:thought", text: "Comparing the Michelin list with recent reviews." }]);
  tick(reasoning(", I should weigh price against the tasting menus. And"));
  assert.equal(sent.length, 1, "inside the gap nothing new is sent");
  clock += 3000;
  tick(reasoning(" more"));
  assert.equal(sent.at(-1).text, "Then, I should weigh price against the tasting menus.");
  tick(content("Answer text"));
  assert.equal(sent.length, 2);
});

test("writer progress reports section headings and slide titles as they stream", () => {
  let clock = 0;
  const lines = [];
  const doc = createWriterProgress((line) => lines.push(line), { now: () => clock });
  doc.onEvent(content("# Market report\nIntro text\n## Market ig"));
  doc.onEvent(content("nition || 1995–1998\nBody"));
  assert.deepEqual(lines, ["Writing “Market report”"]);
  clock += 2000;
  doc.onEvent(content(" more body"));
  assert.deepEqual(lines, ["Writing “Market report”", "Writing “Market ignition”"]);

  const deck = createWriterProgress((line) => lines.push(line), { verb: "Reworking", now: () => 5000 });
  deck.onEvent(content('{"slides":[{"type":"cover","title":"Why **AI** chips win"'));
  assert.equal(lines.at(-1), "Reworking “Why AI chips win”");
  deck.onToolEvent({ type: "tool:start", name: "read_url", arguments: '{"url":"https://www.example.com/a"}' });
  assert.equal(lines.at(-1), "Reading example.com");
});

test("activity feed turns tool and status events into short lines", () => {
  const message = {};
  applyActivityEvent(message, { type: "tool:start", toolCallId: "c1", name: "web_search" }, { query: "best restaurant dubai" });
  applyActivityEvent(message, {
    type: "tool:result", toolCallId: "c1", name: "web_search",
    citations: [{ url: "https://www.timeout.com/x" }, { url: "https://guide.michelin.com/y" }, { url: "https://timeout.com/z" }]
  });
  applyActivityEvent(message, { type: "status:thought", text: "Weighing the Michelin picks." });
  applyActivityEvent(message, { type: "status:thought", text: "Checking prices next." });
  applyActivityEvent(message, { type: "status:step", text: "Planning the slides" });
  assert.deepEqual(message.activity.map((entry) => [entry.kind, entry.text, entry.live]), [
    ["search", "Searching “best restaurant dubai”", false],
    ["sources", "Found 3 sources · timeout.com, guide.michelin.com", false],
    ["thought", "Checking prices next.", false],
    ["step", "Planning the slides", true]
  ]);
});
