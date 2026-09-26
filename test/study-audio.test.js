import assert from "node:assert/strict";
import test from "node:test";
import { audioContentType, isAudioUpload, publicAudioSource } from "../server/study/audio.js";

test("audio uploads are recognised by type or extension and stored as audio/*", () => {
  assert.equal(audioContentType({ fileName: "lecture.mp3", contentType: "audio/mpeg" }), "audio/mpeg");
  assert.equal(audioContentType({ fileName: "lecture.m4a", contentType: "" }), "audio/mp4");
  assert.equal(audioContentType({ fileName: "rec.webm", contentType: "video/webm;codecs=opus" }), "audio/webm");
  assert.equal(audioContentType({ fileName: "voice.opus", contentType: "application/octet-stream" }), "audio/ogg");
  assert.equal(audioContentType({ fileName: "notes.pdf", contentType: "application/pdf" }), "");
  assert.equal(isAudioUpload({ fileName: "slides.pptx", contentType: "" }), false);
});

test("the player payload exposes timed lines and a signed link only once ready", () => {
  const r2 = { readUrl: (key, options) => `signed:${key}:${options.disposition || "attachment"}` };
  const documentFile = {
    id: "doc-1",
    processing_status: "ready",
    word_count: 12,
    created_at: "2026-09-26T08:00:00Z",
    metadata: { title: "Lecture 1", audio_source: "recording", duration_seconds: 61.5, segments: [[0, 4.2, "Hello there."], ["bad"], [4.2, 9, "Welcome."]] },
    attachments: { object_key: "users/u/audio/doc-1.m4a", content_type: "audio/mp4", file_name: "Lecture 1.webm" }
  };
  const audio = publicAudioSource(documentFile, r2);
  assert.equal(audio.title, "Lecture 1");
  assert.equal(audio.source, "recording");
  assert.equal(audio.durationSeconds, 61.5);
  assert.deepEqual(audio.transcript, [{ start: 0, end: 4.2, text: "Hello there." }, { start: 4.2, end: 9, text: "Welcome." }]);
  assert.equal(audio.audioUrl, "signed:users/u/audio/doc-1.m4a:inline");

  const pending = publicAudioSource({ ...documentFile, processing_status: "processing" }, r2);
  assert.equal(pending.audioUrl, "");
  assert.equal(pending.downloadUrl, "");
});

// `release` stands in for klui_release_pending_audio: the key it returns, or null when
// the upload was queued after all.
function enqueueContext({ enqueue, release }) {
  const deleted = [];
  const calls = [];
  const attachment = { id: "att-1", project_id: "course-1", status: "pending", object_key: "users/u/orig.mp3", size_bytes: 1000, file_name: "l.mp3" };
  const context = {
    user: { id: "u" },
    plan: { maxProjectBytes: 50_000_000, maxStorageBytes: 90_000_000 },
    r2: {
      headObject: async () => ({ sizeBytes: 1000, etag: "e" }),
      deleteObjects: async (keys) => { deleted.push(...keys); }
    },
    db: {
      getAttachment: async () => attachment,
      deleteAttachment: async () => { throw new Error("the release must go through the RPC"); },
      rpc: async (name, body) => {
        calls.push({ name, body });
        return name === "klui_release_pending_audio" ? release(body) : enqueue(body);
      }
    }
  };
  return { context, deleted, calls };
}

const audioConfig = { studyAudio: { enabled: true, maxSeconds: 14_400, maxActivePerUser: 5, queue: "local" } };

test("an enqueue error whose transaction committed keeps the upload", async () => {
  const { enqueueCourseAudio } = await import("../server/study/audio.js");
  const { context, deleted, calls } = enqueueContext({
    enqueue: async () => { throw new Error("fetch failed"); },
    release: async () => null
  });
  await assert.rejects(
    enqueueCourseAudio({ context, config: audioConfig, course: { id: "course-1" }, body: { uploadId: "att-1" } }),
    (error) => !error.details?.uploadReleased
  );
  assert.equal(calls.at(-1).name, "klui_release_pending_audio");
  assert.deepEqual(deleted, []);
});

test("an enqueue error that left the upload pending releases it, and the limits and queue are sent", async () => {
  const { enqueueCourseAudio } = await import("../server/study/audio.js");
  const { context, deleted, calls } = enqueueContext({
    enqueue: async () => { throw new Error("transcription_queue_full"); },
    release: async () => "users/u/orig.mp3"
  });
  await assert.rejects(
    enqueueCourseAudio({ context, config: audioConfig, course: { id: "course-1" }, body: { uploadId: "att-1" } }),
    (error) => error.status === 429 && error.details?.uploadReleased === true
  );
  const sent = calls[0].body;
  assert.equal(sent.p_queue, "local");
  assert.equal(sent.p_account_max_bytes, 90_000_000);
  assert.deepEqual(calls[1].body, { p_user_id: "u", p_attachment_id: "att-1", p_queue: "local" });
  assert.deepEqual(deleted, ["users/u/orig.mp3"]);
});
