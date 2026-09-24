import assert from "node:assert/strict";
import test from "node:test";
import { createCourseSource, SOURCE_MAX_CHARS } from "../server/study/sources.js";
import { loadGenerationSourceText } from "../server/study/generate.js";

function setup() {
  const calls = [];
  const context = {
    user: { id: "user-1" }, plan: { maxStorageBytes: 1000000, maxProjectBytes: 500000 },
    db: {
      reserveAttachment: async input => { calls.push(["reserve", input]); return { id: "attachment-1", object_key: "users/user-1/source" }; },
      rpc: async (name, input) => { calls.push([name, input]); return { id: "doc-1", kind: input.p_kind }; },
      deleteAttachment: async (...args) => calls.push(["delete", ...args])
    },
    r2: {
      objectKey: () => "users/user-1/source",
      putObject: async (...args) => calls.push(["put", ...args]),
      deleteObjects: async (...args) => calls.push(["cleanup", ...args])
    }
  };
  return { calls, context, config: {}, course: { id: "course-1" } };
}

test("pasted text reserves its actual UTF-8 size and publishes searchable source content", async () => {
  const args = setup();
  const text = "# Photosynthesis 🌱\n\nPlants convert light into chemical energy.";
  const result = await createCourseSource({ ...args, body: { kind: "text", text: `  ${text}  ` } });
  assert.equal(result.kind, "text");
  assert.deepEqual(args.calls.map(call => call[0]), ["reserve", "put", "klui_complete_study_source"]);
  const reservation = args.calls[0][1];
  assert.equal(reservation.sizeBytes, Buffer.byteLength(text));
  assert.equal(reservation.projectId, "course-1");
  assert.equal(reservation.maxBytes, args.context.plan.maxStorageBytes);
  const published = args.calls[2][1];
  assert.equal(published.p_content, text);
  assert.equal(published.p_title, "Photosynthesis 🌱");
  assert.equal(published.p_project_max_bytes, args.context.plan.maxProjectBytes);
  args.context.db.listDocumentChunksForFiles = async () => [{ text: published.p_content }];
  assert.equal(await loadGenerationSourceText({ context: args.context, source: { documentFile: result } }), text);
});

test("website import uses the shared TinyFetch reader and retains image descriptions and provenance", async () => {
  const args = setup();
  const content = "# Cells\n\n![Mitochondrion structure](https://example.com/diagram.png)\n\nATP production.";
  await createCourseSource({ ...args, body: { kind: "website", url: "example.com/article#section" }, readPage: async input => {
    assert.equal(input.url, "https://example.com/article");
    assert.equal(input.maxChars, SOURCE_MAX_CHARS + 1);
    return { title: "Cell structure", content };
  } });
  assert.equal(args.calls[2][1].p_content, content);
  assert.equal(args.calls[2][1].p_source_url, "https://example.com/article");
  assert.equal(args.calls[0][1].contentType, "text/markdown");
});

test("source validation rejects unsupported, empty, oversized, credentialed, and YouTube input before saving", async () => {
  for (const body of [
    null, [],
    { kind: "audio" }, { kind: "text", text: "  " }, { kind: "text", text: "bad\0text" },
    { kind: "text", text: "x".repeat(SOURCE_MAX_CHARS + 1) },
    { kind: "text", text: "valid", title: "x".repeat(121) },
    ...["", "https://user:password@example.com", "https://youtube.com/watch?v=123", "https://youtu.be/123", "file:///etc/passwd", "ftp://example.com", "javascript:alert(1)"].map(url => ({ kind: "website", url }))
  ]) {
    const args = setup();
    await assert.rejects(createCourseSource({ ...args, body }), error => [400, 413].includes(error.status));
    assert.equal(args.calls.length, 0);
  }
});

test("public reader rejects private destinations and unreadable pages create no source", async () => {
  for (const url of ["http://localhost", "http://127.0.0.1", "http://[::1]", "http://169.254.169.254"]) {
    const args = setup();
    await assert.rejects(createCourseSource({ ...args, body: { kind: "website", url } }), /private|internal|non-public/);
    assert.equal(args.calls.length, 0);
  }
  for (const content of ["", "x".repeat(SOURCE_MAX_CHARS + 1)]) {
    const args = setup();
    await assert.rejects(createCourseSource({ ...args, body: { kind: "website", url: "example.com" }, readPage: async () => ({ content }) }), error => [400, 413].includes(error.status));
    assert.equal(args.calls.length, 0);
  }
});

test("failed storage or indexing cleans the reservation even when the request is aborted", async () => {
  for (const stage of ["putObject", "rpc"]) {
    const args = setup();
    const error = new Error("Import interrupted");
    (stage === "rpc" ? args.context.db : args.context.r2)[stage] = async () => { throw error; };
    await assert.rejects(createCourseSource({ ...args, body: { kind: "text", text: "Lecture notes" }, signal: AbortSignal.abort() }), error);
    assert.equal(args.calls.at(-2)[0], "cleanup");
    assert.equal(args.calls.at(-2)[2]?.signal, undefined);
    assert.equal(args.calls.at(-1)[0], "delete");
  }
});

test("quota errors are actionable and never leave an uploaded object", async () => {
  const args = setup();
  args.context.db.rpc = async () => { throw new Error("project_storage_limit_exceeded"); };
  await assert.rejects(createCourseSource({ ...args, body: { kind: "text", text: "Lecture" } }), { status: 413 });
  assert.equal(args.calls.at(-1)[0], "delete");
});
