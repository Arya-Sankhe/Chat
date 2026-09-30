import assert from "node:assert/strict";
import test from "node:test";

import { reindexXlsxDocuments } from "../scripts/reindex-xlsx.mjs";

test("XLSX reindex stays dry-run by default and skips current or active files", async () => {
  const writes = [];
  const db = {
    async request(path, options) {
      if (path === "document_files") return [
        { id: "old", metadata: {} },
        { id: "current", metadata: { extractor: "openpyxl_ranges_v2" } },
        { id: "active", metadata: {} }
      ];
      if (path === "document_jobs" && !options.method) return [
        { id: "job-old", document_file_id: "old", status: "succeeded", queue: "local" },
        { id: "job-active", document_file_id: "active", status: "running", queue: "local" }
      ];
      writes.push({ path, options });
      return [];
    }
  };

  const result = await reindexXlsxDocuments({ db, logger: { log() {} } });
  assert.deepEqual(result, {
    apply: false,
    scanned: 3,
    alreadyCurrent: 1,
    candidates: 2,
    active: 1,
    queued: 1
  });
  assert.deepEqual(writes, []);
});

test("XLSX reindex resets the existing extraction job when applied", async () => {
  const writes = [];
  const db = {
    async request(path, options) {
      if (path === "document_files") return [{ id: "old", metadata: {} }];
      if (path === "document_jobs" && !options.method) {
        return [{ id: "job-old", document_file_id: "old", status: "succeeded", queue: "local" }];
      }
      writes.push({ path, options });
      return [];
    }
  };

  const result = await reindexXlsxDocuments({ db, apply: true, logger: { log() {} } });
  assert.equal(result.queued, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.method, "PATCH");
  assert.equal(writes[0].options.body.status, "queued");
  assert.equal(writes[0].options.body.attempt_count, 0);
});

test("XLSX reindex leaves the other machine's jobs alone", async () => {
  const writes = [];
  const db = {
    async request(path, options) {
      if (path === "document_files") return [{ id: "prod-file", metadata: {} }];
      if (path === "document_jobs" && !options.method) {
        return [{ id: "prod-job", document_file_id: "prod-file", status: "succeeded", queue: "production" }];
      }
      writes.push({ path, options });
      return [];
    }
  };
  await reindexXlsxDocuments({ db, queue: "local", apply: true, logger: { log() {} } });
  assert.deepEqual(writes, []);
});
