import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  guestDraftHasPreview,
  guestPreviewContent,
  liveGuestImages,
  serializeGuestDraft
} from "../public/js/guestSend.js";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

function readPublic(path) {
  return readFileSync(resolve(publicDir, path), "utf8");
}

test("serializeGuestDraft keeps previewable text and attachment names, not File objects", () => {
  const stored = serializeGuestDraft({
    text: "Hey",
    images: [{
      file: { name: "shot.png", type: "image/png", size: 12 },
      category: "image",
      previewUrl: "blob:http://localhost/preview"
    }]
  });
  assert.equal(stored.text, "Hey");
  assert.equal(stored.attachments[0].name, "shot.png");
  assert.equal(stored.attachments[0].previewUrl, "");
  assert.equal(JSON.stringify(stored).includes("blob:"), false);
  assert.ok(guestDraftHasPreview(stored));
});

test("guest pasted content stays plain text", () => {
  const stored = serializeGuestDraft({
    text: "Question\n\nlong pasted content",
    paste: { start: 10, length: 19 }
  });
  assert.equal(stored.text, "Question\n\nlong pasted content");
  assert.equal("paste" in stored, false);
});

test("restore does not reopen an empty continue card, but can rebuild a text preview without files", () => {
  assert.equal(guestDraftHasPreview(serializeGuestDraft({})), false);
  assert.equal(guestDraftHasPreview({ text: "   ", attachments: [] }), false);
  const stored = serializeGuestDraft({
    text: "Look at this",
    images: [{ file: { name: "notes.csv", type: "text/csv", size: 4 }, category: "document" }]
  });
  const restored = serializeGuestDraft({ ...stored, images: [] });
  assert.equal(guestDraftHasPreview(restored), true);
  assert.deepEqual(guestPreviewContent(restored), [
    { type: "text", text: "Look at this" },
    { type: "file", file: { file_name: "notes.csv", content_type: "text/csv" } }
  ]);
  assert.deepEqual(liveGuestImages(restored.images), []);
});

test("liveGuestImages drops staged files that did not survive reload", () => {
  const live = { file: { name: "a.png", type: "image/png", size: 8 }, category: "image" };
  const dead = { category: "image", previewUrl: "", file: undefined };
  assert.deepEqual(liveGuestImages([live, dead, { file: "nope" }]), [live]);
});

test("unsigned users stage a send, then resume through sendPrompt after login", () => {
  const html = readPublic("index.html");
  const app = readPublic("js/app.js");
  assert.match(html, /id="guestContinue"[^>]*role="region"/);
  assert.match(html, /id="guestContinueSignup">Sign up for free/);
  assert.match(html, /Use compare, council and deep research/);
  assert.doesNotMatch(html, /guestContinueClose|Maybe later|Use, compare, and cancel/);
  assert.match(app, /els\.messages\.appendChild\(els\.guestContinue\)/);
  assert.match(app, /if \(!state\.session\) \{\s*stageGuestSend\(/);
  assert.match(app, /if \(!state\.messages\.length\) \{\s*const draft = pendingGuestSend \|\| readGuestSend\(\)/);
  assert.match(app, /await sendPrompt\(\{ skipClarification: true \}\);\s*if \(state\.activeConversationId/);
  assert.match(app, /if \(stored\.attachments\.length && !liveImages\.length\) \{[\s\S]*?showToast\("Add your image again to send this message\."\);\s*return;/);
  assert.match(app, /else if \(!guestDraftHasPreview\(pendingGuestSend \|\| readGuestSend\(\)\)\)/);
  assert.match(app, /Sign up to attach documents/);
  assert.match(app, /if \(isLongPaste && !state\.running && state\.session\) \{/);
  assert.doesNotMatch(app, /item\.status = "ready";\s*item\.progress = 100;/);
});
