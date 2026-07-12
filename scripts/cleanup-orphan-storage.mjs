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
  const batchSize = config.storageCleanup.batchSize;
  const before = new Date(now.getTime() - (graceDays * 24 * 60 * 60 * 1000)).toISOString();
  const attachments = await db.listOrphanAttachments({ before, limit: batchSize });
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

async function main() {
  const config = loadConfig(process.env);
  const result = await cleanupOrphanStorage({
    config,
    db: new SupabaseRest(config),
    r2: new R2Client(config)
  });
  if (result.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
