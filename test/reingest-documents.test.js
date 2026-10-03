import assert from "node:assert/strict";
import test from "node:test";

import { needsIngest, reingestDocuments } from "../scripts/reingest-documents.mjs";

test("re-ingest stays dry-run by default and skips current, edited or active files", async () => {
  const writes = [];
  const db = {
    async request(path, options) {
      if (path === "document_files") return [
        { id: "old", kind: "pdf", metadata: {} },
        { id: "current", kind: "pdf", metadata: { pipeline: "pages-v1", ingest_version: 2 } },
        { id: "sheet", kind: "xlsx", metadata: { pipeline: "sheets-v1" } },
        { id: "edited", kind: "docx", metadata: { editable: true, editor_revision: 3 } },
        { id: "active", kind: "pptx", metadata: {} }
      ];
      if (path === "document_jobs" && !options.method) return [
        { id: "job-old", document_file_id: "old", job_type: "document.extract.pdf", status: "succeeded", queue: "local" },
        { id: "job-active", document_file_id: "active", job_type: "document.extract.pptx", status: "running", queue: "local" }
      ];
      writes.push({ path, options });
      return [];
    }
  };

  const result = await reingestDocuments({ db, logger: { log() {} } });
  assert.deepEqual(result, {
    apply: false,
    all: false,
    scanned: 5,
    alreadyCurrent: 2,
    skipped: 1,
    candidates: 2,
    active: 1,
    queued: 1
  });
  assert.deepEqual(writes, []);
});

test("re-ingest resets the existing extraction job, or adds one, when applied", async () => {
  const writes = [];
  const db = {
    async request(path, options) {
      if (path === "document_files") return [
        { id: "old", kind: "pdf", metadata: {} },
        { id: "generated", kind: "docx", user_id: "u1", metadata: {} }
      ];
      if (path === "document_jobs" && !options.method) {
        return [{ id: "job-old", document_file_id: "old", job_type: "document.extract.pdf", status: "succeeded", queue: "local" }];
      }
      writes.push({ path, options });
      return [];
    }
  };

  const result = await reingestDocuments({ db, apply: true, logger: { log() {} } });
  assert.equal(result.queued, 2);
  const insert = writes.find((write) => write.options.method === "POST");
  assert.equal(insert.options.body.job_type, "document.extract.docx");
  assert.equal(insert.options.body.priority, -5);
  const reset = writes.find((write) => write.options.method === "PATCH");
  assert.equal(reset.options.body.status, "queued");
  assert.equal(reset.options.body.attempt_count, 0);
  assert.equal(reset.options.query.id, "in.(job-old)");
});

test("re-ingest leaves the other machine's jobs alone", async () => {
  const writes = [];
  const db = {
    async request(path, options) {
      if (path === "document_files") return [{ id: "prod-file", kind: "pdf", metadata: {} }];
      if (path === "document_jobs" && !options.method) {
        return [{ id: "prod-job", document_file_id: "prod-file", job_type: "document.extract.pdf", status: "succeeded", queue: "production" }];
      }
      writes.push({ path, options });
      return [];
    }
  };
  await reingestDocuments({ db, queue: "local", apply: true, logger: { log() {} } });
  assert.deepEqual(writes, []);
});

test("re-ingest picks up paged documents stored before hidden slides and OCR", () => {
  // An old deck: same pipeline name, no version, missing its hidden slide.
  assert.equal(needsIngest({ metadata: { pipeline: "pages-v1" } }), "ingest");
  assert.equal(needsIngest({ metadata: { pipeline: "pages-v1", ingest_version: 1 } }), "ingest");
  assert.equal(needsIngest({ metadata: { pipeline: "pages-v1", ingest_version: 2 } }), "current");
  assert.equal(needsIngest({ metadata: { pipeline: "sheets-v1" } }), "current");
  // --all re-ingests current documents too, but never edited ones or previews.
  assert.equal(needsIngest({ metadata: { pipeline: "pages-v1", ingest_version: 2 } }, { all: true }), "ingest");
  assert.equal(needsIngest({ metadata: { pipeline: "pages-v1", editable: true, editor_revision: 2 } }, { all: true }), "skip");
  assert.equal(needsIngest({ metadata: { preview: true } }, { all: true }), "skip");
});
