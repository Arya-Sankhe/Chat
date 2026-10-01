import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanupOrphanStorage, sweepUnreferencedObjects } from "../scripts/cleanup-orphan-storage.mjs";

const CONFIG = {
  storageCleanup: { graceDays: 7, pendingGraceMinutes: 30, batchSize: 100 },
  documents: { maxPdfPages: 100 }
};

test("database cron retains R2-backed attachment metadata for VPS cleanup", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260712222116_move_orphan_storage_cleanup_to_vps.sql", import.meta.url),
    "utf8"
  );
  const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const schemaCleanup = schema.match(
    /create or replace function public\.klui_cleanup_storage_and_cache[\s\S]*?revoke all on function public\.klui_cleanup_storage_and_cache/
  )?.[0] || "";

  for (const sql of [migration, schemaCleanup]) {
    assert.doesNotMatch(sql, /delete from public\.attachments/i);
    assert.doesNotMatch(sql, /delete from public\.document_files/i);
    assert.match(sql, /delete from public\.model_cache/i);
  }
  assert.doesNotMatch(schemaCleanup, /search_cache/i);
  assert.doesNotMatch(schema, /public\.search_cache/i);
});

test("orphan cleanup removes every Office-derived R2 object before its database row", async () => {
  const events = [];
  const attachment = {
    id: "att_1",
    user_id: "user_1",
    category: "document",
    object_key: "users/user_1/source.pptx"
  };
  const db = {
    async listOrphanAttachments(options) {
      assert.deepEqual(options, {
        before: "2026-07-06T00:00:00.000Z",
        limit: 100
      });
      return [attachment];
    },
    async listStalePendingAttachments(options) {
      assert.deepEqual(options, {
        before: "2026-07-12T23:30:00.000Z",
        limit: 100
      });
      return [];
    },
    async getDocumentFileByAttachment(userId, attachmentId) {
      assert.equal(userId, "user_1");
      assert.equal(attachmentId, "att_1");
      return {
        id: "doc_1",
        kind: "pptx",
        page_count: 2,
        extraction_key: "users/user_1/extraction.json",
        preview_key: "users/user_1/preview.json"
      };
    },
    async listDocumentPages() {
      return [{ image_key: "users/user_1/documents/doc_1/pages/page-0001.jpg" }];
    },
    async deleteAttachment(userId, attachmentId) {
      events.push(["db", userId, attachmentId]);
    }
  };
  const r2 = {
    async deleteObjects(keys) {
      events.push(["r2", keys]);
      return new Set(keys).size;
    }
  };

  const result = await cleanupOrphanStorage({
    config: CONFIG,
    db,
    r2,
    now: new Date("2026-07-13T00:00:00.000Z"),
    logger: { log() {} }
  });

  assert.equal(result.attachmentsDeleted, 1);
  assert.equal(result.failed, 0);
  assert.equal(events[0][0], "r2");
  assert.deepEqual(new Set(events[0][1]), new Set([
    "users/user_1/source.pptx",
    "users/user_1/extraction.json",
    "users/user_1/preview.json",
    "users/user_1/documents/doc_1/pages/page-0001.jpg",
    "users/user_1/documents/doc_1/pages/page-0002.jpg"
  ]));
  assert.deepEqual(events[1], ["db", "user_1", "att_1"]);
  assert.equal(events[2][0], "r2");
});

test("orphan cleanup preserves the database row when R2 deletion fails", async () => {
  let databaseDeletes = 0;
  const db = {
    async listOrphanAttachments() {
      return [{
        id: "att_2",
        user_id: "user_2",
        category: "image",
        object_key: "users/user_2/photo.png"
      }];
    },
    async listStalePendingAttachments() {
      return [];
    },
    async deleteAttachment() {
      databaseDeletes += 1;
    }
  };
  const r2 = {
    async deleteObjects() {
      throw new Error("R2 unavailable");
    }
  };

  const result = await cleanupOrphanStorage({
    config: CONFIG,
    db,
    r2,
    now: new Date("2026-07-13T00:00:00.000Z"),
    logger: { log() {} }
  });

  assert.equal(result.failed, 1);
  assert.equal(result.attachmentsDeleted, 0);
  assert.equal(databaseDeletes, 0);
});

test("orphan cleanup does not touch R2 when document key discovery fails", async () => {
  let r2Deletes = 0;
  const db = {
    async listOrphanAttachments() {
      return [{
        id: "att_3",
        user_id: "user_3",
        category: "document",
        object_key: "users/user_3/report.docx"
      }];
    },
    async listStalePendingAttachments() {
      return [];
    },
    async getDocumentFileByAttachment() {
      throw new Error("Supabase unavailable");
    },
    async deleteAttachment() {
      assert.fail("database row must be retained");
    }
  };
  const r2 = {
    async deleteObjects() {
      r2Deletes += 1;
    }
  };

  const result = await cleanupOrphanStorage({
    config: CONFIG,
    db,
    r2,
    now: new Date("2026-07-13T00:00:00.000Z"),
    logger: { log() {} }
  });

  assert.equal(result.failed, 1);
  assert.equal(r2Deletes, 0);
});

function sweepFixture(objects, references) {
  const deleted = [];
  return {
    deleted,
    db: { async listStorageReferences() { return references; } },
    r2: {
      async listObjects(prefix, { continuationToken } = {}) {
        assert.equal(prefix, "users/");
        // Two pages, to exercise the continuation token.
        const half = Math.ceil(objects.length / 2);
        return continuationToken
          ? { objects: objects.slice(half), isTruncated: false, nextToken: null }
          : { objects: objects.slice(0, half), isTruncated: true, nextToken: "next" };
      },
      async deleteObjects(keys) {
        deleted.push(...keys);
        return keys.length;
      }
    }
  };
}

test("storage sweep deletes only old objects that no row points at", async () => {
  const old = "2026-07-01T00:00:00.000Z";
  const objects = [
    { key: "users/u1/a1/file.pdf", lastModified: old },
    { key: "users/u1/x9/file.extraction.json", lastModified: old },
    { key: "users/u1/documents/doc_live/pages/page-0003.jpg", lastModified: old },
    { key: "users/u1/documents/doc_gone/pages/page-0001.jpg", lastModified: old },
    { key: "users/u1/x8/stale.extraction.json", lastModified: old },
    { key: "users/u1/x7/fresh.extraction.json", lastModified: "2026-07-12T00:00:00.000Z" },
    ...Array.from({ length: 40 }, (_, index) => ({ key: `users/u2/k${index}/f.png`, lastModified: old }))
  ];
  const keys = new Set(["users/u1/a1/file.pdf", "users/u1/x9/file.extraction.json", ...objects.slice(6).map((object) => object.key)]);
  const { db, r2, deleted } = sweepFixture(objects, { keys, documentIds: new Set(["doc_live"]) });

  const result = await sweepUnreferencedObjects({
    config: CONFIG, db, r2, now: new Date("2026-07-13T00:00:00.000Z"), logger: { log() {} }
  });

  assert.deepEqual(deleted, [
    "users/u1/documents/doc_gone/pages/page-0001.jpg",
    "users/u1/x8/stale.extraction.json"
  ]);
  assert.equal(result.objects, 46);
  assert.equal(result.objectsDeleted, 2);
  assert.equal(result.failed, 0);
});

test("storage sweep refuses when most of the bucket looks unreferenced", async () => {
  const objects = Array.from({ length: 100 }, (_, index) => ({ key: `users/u/k${index}/f.png`, lastModified: "2026-07-01T00:00:00.000Z" }));
  const { db, r2, deleted } = sweepFixture(objects, { keys: new Set(), documentIds: new Set() });

  const result = await sweepUnreferencedObjects({
    config: CONFIG, db, r2, now: new Date("2026-07-13T00:00:00.000Z"), logger: { log() {} }
  });

  assert.equal(deleted.length, 0);
  assert.equal(result.failed, 1);
  assert.match(result.error, /refusing to delete 100 of 100/);
});
