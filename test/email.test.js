import assert from "node:assert/strict";
import test from "node:test";
import { emailAddresses, replaceEmailFence } from "../public/js/email.js";
import { emailCardFields } from "../public/js/render.js";

test("email recipients accept addresses, not names or bracketed hints", () => {
  for (const to of ["", "Professor Smith", "Mr. and Mrs. Smith", "Dr. [Name]", "[name@example.com]", "[Email: name@example.com]"]) {
    assert.deepEqual(emailAddresses(to), [], to);
    assert.equal(emailCardFields(`To: ${to}\nSubject: Hello\n\nDear [Name],`).to, "", to);
  }
  assert.deepEqual(emailAddresses("Dr. Chen <chen@school.edu>; other@school.edu, chen@school.edu"), ["chen@school.edu", "other@school.edu"]);
  assert.equal(emailCardFields("To: Dr. Chen <chen@school.edu>\nSubject: Hello\n\nDear [Name],").to, "chen@school.edu");
});

test("email replacement targets one fence and preserves surrounding content", () => {
  const first = "```email\nTo:\nSubject: First\n\nOne\n```";
  const second = "```email\nTo:\nSubject: Second\n\nTwo\n```";
  const revised = "To:\nSubject: Revised\n\nDear [Name],\n\nShorter.\n\nThanks,\n[Your Name]";
  const replacement = `\`\`\`email\n${revised}\n\`\`\``;
  assert.equal(replaceEmailFence(`Intro\n${first}\nBetween\n${second}\nEnd`, revised, 1), `Intro\n${first}\nBetween\n${replacement}\nEnd`);
  const content = [{ type: "text", text: first }, { type: "image_url", image_url: { url: "image" } }, { type: "text", text: second }];
  assert.deepEqual(replaceEmailFence(content, revised, 1), [content[0], content[1], { type: "text", text: replacement }]);
  assert.equal(replaceEmailFence(first, revised, 3), first);
  assert.equal(replaceEmailFence("No email", revised), "No email");
});
