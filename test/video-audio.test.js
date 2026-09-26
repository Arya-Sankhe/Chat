import test from "node:test";
import assert from "node:assert/strict";

import { isVideoFile } from "../public/js/videoAudio.js";

test("isVideoFile spots videos by type or extension but leaves audio alone", () => {
  assert.equal(isVideoFile({ name: "lecture.mp4", type: "video/mp4" }), true);
  assert.equal(isVideoFile({ name: "lecture.MOV", type: "" }), true);
  assert.equal(isVideoFile({ name: "clip.mkv", type: "application/octet-stream" }), true);
  assert.equal(isVideoFile({ name: "lecture.m4a", type: "audio/mp4" }), false);
  assert.equal(isVideoFile({ name: "voice.webm", type: "audio/webm" }), false);
  assert.equal(isVideoFile({ name: "notes.pdf", type: "application/pdf" }), false);
});
