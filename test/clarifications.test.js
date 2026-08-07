import assert from "node:assert/strict";
import test from "node:test";
import { generateClarifications, normalizeClarifications } from "../server/saas/clarifications.js";

test("clarifications stay small, valid, and use the metered cheap model path", async () => {
  let request;
  const questions = await generateClarifications({
    query: "research batteries",
    config: { providers: { openrouter: { apiKey: "key", baseUrl: "https://openrouter.test" } } },
    crofai: {
      async chatCompletion(value) {
        request = value;
        return '```json\n{"questions":[{"question":"Which market?","options":["Global","India"]},{"question":"","options":["x","y"]}]}\n```';
      }
    }
  });

  assert.equal(request.body.model, "inclusionai/ling-3.0-flash");
  assert.deepEqual(request.body.reasoning, { enabled: false });
  assert.equal(request.body.max_tokens, 420);
  assert.deepEqual(questions, [{ question: "Which market?", options: ["Global", "India"] }]);
  assert.deepEqual(normalizeClarifications('{"questions":[{"question":"One?","options":["A"]}]}'), []);
});
