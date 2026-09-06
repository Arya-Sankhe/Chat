import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  guestDraftHasPreview,
  liveGuestImages,
  serializeGuestDraft
} from "../public/js/guestSend.js";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

function readPublic(path) {
  return readFileSync(resolve(publicDir, path), "utf8");
}

test("guest drafts stay in memory and keep live image previews", () => {
  const stored = serializeGuestDraft({
    text: "Hey",
    images: [{
      file: { name: "shot.png", type: "image/png", size: 12 },
      category: "image",
      previewUrl: "blob:http://localhost/preview"
    }]
  });
  assert.equal(stored.text, "Hey");
  assert.equal("attachments" in stored, false);
  assert.ok(guestDraftHasPreview({ ...stored, images: [{ file: { size: 12 } }] }));
});

test("guest pasted content stays plain text", () => {
  const stored = serializeGuestDraft({
    text: "Question\n\nlong pasted content",
    paste: { start: 10, length: 19 }
  });
  assert.equal(stored.text, "Question\n\nlong pasted content");
  assert.equal("paste" in stored, false);
});

test("empty drafts stay empty", () => {
  assert.equal(guestDraftHasPreview(serializeGuestDraft({})), false);
  assert.equal(guestDraftHasPreview({ text: "   ", images: [] }), false);
});

test("liveGuestImages keeps only usable in-memory files", () => {
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
  assert.match(app, /if \(!state\.messages\.length\) \{\s*const draft = pendingGuestSend/);
  assert.match(app, /await sendPrompt\(\{ skipClarification: true \}\);\s*if \(state\.activeConversationId/);
  assert.doesNotMatch(app, /sessionStorage|GUEST_SEND_KEY|restoreGuestSendPreview/);
  assert.match(app, /else if \(!guestDraftHasPreview\(pendingGuestSend\)\)/);
  assert.match(app, /Sign up to attach documents/);
  assert.match(app, /if \(isLongPaste && !state\.running && state\.session\) \{/);
  assert.doesNotMatch(app, /item\.status = "ready";\s*item\.progress = 100;/);
});
