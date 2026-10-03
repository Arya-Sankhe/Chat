import assert from "node:assert/strict";
import test from "node:test";
import {
  listDocumentChunks, listDocumentChunksForFiles, listDocumentPages,
  listDocumentPagesByNumbers, searchDocumentChunks
} from "../server/db/rest/documents.js";

const reads = [
  (db) => listDocumentChunks(db, "user", "doc"),
  (db) => listDocumentChunksForFiles(db, "user", ["doc"]),
  (db) => listDocumentPages(db, "user", "doc"),
  (db) => listDocumentPagesByNumbers(db, "user", "doc", [1]),
  (db) => searchDocumentChunks(db, { userId: "user", documentFileIds: ["doc"], query: "word" })
];

test("all shared document reads block partial ingests and discard reads that cross versions", async () => {
  for (const read of reads) {
    for (const change of ["none", "already-processing", "starts-processing", "finished-new-version"]) {
      let version = { id: "doc", text_ready_at: "old", visual_ready_at: "old" };
      if (change === "already-processing") version = { id: "doc" };
      let contentReads = 0;
      const content = () => {
        contentReads += 1;
        if (change === "starts-processing") version = { id: "doc" };
        if (change === "finished-new-version") version = { id: "doc", text_ready_at: "new", visual_ready_at: "new" };
        return [{ text: "must only be returned if its version stayed ready" }];
      };
      const db = {
        async request(path, { query }) {
          assert.equal(query.user_id, "eq.user");
          return path === "document_files" ? [{ ...version }] : content();
        },
        async rpc(_name, payload) {
          assert.equal(payload.p_user_id, "user");
          return content();
        }
      };
      if (change === "none") assert.equal((await read(db)).length, 1);
      else await assert.rejects(read(db), /content changed or is being processed/);
      assert.equal(contentReads, change === "already-processing" ? 0 : 1);
    }
  }
});

test("storage cleanup can list page keys from an unready upload", async () => {
  const db = { async request(path) {
    assert.equal(path, "document_pages");
    return [{ image_key: "partial-page.jpg" }];
  } };
  assert.equal((await listDocumentPages(db, "user", "doc", { allowUnready: true }))[0].image_key, "partial-page.jpg");
});
