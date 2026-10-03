import { pathToFileURL } from "node:url";
import { loadConfig } from "../server/config.js";
import { SupabaseRest } from "../server/db/supabaseRest.js";
import { attachmentStorageKeys } from "../server/routes/uploads.js";
import { R2Client } from "../server/storage/r2.js";

export async function cleanupOrphanStorage({
  config,
  db,
  r2,
  now = new Date(),
  logger = console
}) {
  const graceDays = config.storageCleanup.graceDays;
  const pendingGraceMinutes = config.storageCleanup.pendingGraceMinutes || 30;
  const batchSize = config.storageCleanup.batchSize;
  const before = new Date(now.getTime() - (graceDays * 24 * 60 * 60 * 1000)).toISOString();
  const pendingBefore = new Date(now.getTime() - (pendingGraceMinutes * 60 * 1000)).toISOString();
  const [orphans, stalePending] = await Promise.all([
    db.listOrphanAttachments({ before, limit: batchSize }),
    db.listStalePendingAttachments({ before: pendingBefore, limit: batchSize })
  ]);
  const seen = new Set();
  const attachments = [];
  for (const attachment of [...stalePending, ...orphans]) {
    if (!attachment?.id || seen.has(attachment.id)) continue;
    seen.add(attachment.id);
    attachments.push(attachment);
  }
  const failures = [];
  let objectsDeleted = 0;
  let attachmentsDeleted = 0;

  for (const attachment of attachments) {
    try {
      const context = { db, r2, user: { id: attachment.user_id } };
      const keys = await attachmentStorageKeys(context, attachment, config);
      objectsDeleted += await r2.deleteObjects(keys);
      await db.deleteAttachment(attachment.user_id, attachment.id);
      await r2.deleteObjects(keys);
      attachmentsDeleted += 1;
    } catch (error) {
      failures.push({
        attachmentId: attachment.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const result = {
    cutoff: before,
    scanned: attachments.length,
    attachmentsDeleted,
    objectsDeleted,
    failed: failures.length,
    failures
  };
  logger.log(JSON.stringify(result));
  return result;
}

// Deletes R2 objects no row points at: leftovers of a document deleted mid-processing, an
// extraction replaced by a re-extract, an upload whose row is gone. Only objects older than
// the grace period are touched, so files a worker wrote before saving its row are safe.
export async function sweepUnreferencedObjects({
  config,
  db,
  r2,
  now = new Date(),
  logger = console
}) {
  const graceDays = config.storageCleanup.graceDays;
  const maxShare = config.storageCleanup.sweepMaxShare ?? 0.1;
  const cutoff = now.getTime() - (graceDays * 24 * 60 * 60 * 1000);
  // References are read before listing, so an object created in between is either
  // referenced already or too new to be swept.
  const { keys, documentIds } = await db.listStorageReferences();
  const objects = [];
  let token = null;
  do {
    const page = await r2.listObjects("users/", { continuationToken: token });
    objects.push(...page.objects);
    token = page.isTruncated ? page.nextToken : null;
  } while (token);

  const unreferenced = objects.filter(({ key, lastModified }) => {
    const modified = Date.parse(lastModified || "");
    if (!Number.isFinite(modified) || modified >= cutoff) return false;
    if (keys.has(key)) return false;
    const parts = key.split("/");
    // Versioned page images are immutable. Replaced generations can be swept after
    // the normal grace period; legacy document objects still keep their protection.
    if (parts[2] === "documents" && parts[4] === "pages" && /^ingest-[a-f0-9]{32}$/.test(parts[5] || "")) return true;
    return !(parts[2] === "documents" && documentIds.has(parts[3]));
  });
  const result = {
    sweep: true,
    cutoff: new Date(cutoff).toISOString(),
    objects: objects.length,
    unreferenced: unreferenced.length,
    objectsDeleted: 0,
    failed: 0
  };
  // A reference read that came back short would make most of the bucket look unreferenced.
  if (unreferenced.length > Math.max(25, objects.length * maxShare)) {
    result.failed = 1;
    result.error = `refusing to delete ${unreferenced.length} of ${objects.length} objects`;
  } else if (unreferenced.length) {
    try {
      result.objectsDeleted = await r2.deleteObjects(unreferenced.map((object) => object.key));
    } catch (error) {
      result.failed = 1;
      result.error = error instanceof Error ? error.message : String(error);
    }
  }
  logger.log(JSON.stringify(result));
  return result;
}

async function main() {
  const config = loadConfig(process.env);
  const deps = { config, db: new SupabaseRest(config), r2: new R2Client(config) };
  const result = await cleanupOrphanStorage(deps);
  const sweep = await sweepUnreferencedObjects(deps);
  if (result.failed > 0 || sweep.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
