import { pathToFileURL } from "node:url";
import { loadConfig } from "../server/config.js";
import { SupabaseRest } from "../server/db/supabaseRest.js";

const EXTRACTOR = "openpyxl_ranges_v2";

export async function reindexXlsxDocuments({ db, apply = false, batchSize = 200, logger = console }) {
  let offset = 0;
  let scanned = 0;
  let alreadyCurrent = 0;
  let active = 0;
  let queued = 0;
  const candidates = [];

  while (true) {
    const files = await db.request("document_files", {
      query: {
        kind: "eq.xlsx",
        text_ready_at: "not.is.null",
        select: "id,user_id,conversation_id,message_id,metadata",
        order: "created_at.asc",
        limit: String(batchSize),
        offset: String(offset)
      }
    });
    scanned += files.length;
    for (const file of files) {
      if (file.metadata?.extractor === EXTRACTOR) alreadyCurrent += 1;
      else candidates.push(file);
    }
    if (files.length < batchSize) break;
    offset += files.length;
  }

  for (let start = 0; start < candidates.length; start += batchSize) {
    const files = candidates.slice(start, start + batchSize);
    const ids = files.map((file) => file.id);
    const jobs = await db.request("document_jobs", {
      query: {
        document_file_id: `in.(${ids.join(",")})`,
        job_type: "eq.document.extract.xlsx",
        select: "id,document_file_id,status"
      }
    });
    const byFile = new Map(jobs.map((job) => [job.document_file_id, job]));
    const resetIds = [];

    for (const file of files) {
      const job = byFile.get(file.id);
      if (job && ["queued", "running"].includes(job.status)) {
        active += 1;
        continue;
      }
      if (!apply) {
        queued += 1;
        continue;
      }
      if (job) {
        resetIds.push(job.id);
      } else {
        await db.request("document_jobs", {
          method: "POST",
          body: {
            user_id: file.user_id,
            document_file_id: file.id,
            conversation_id: file.conversation_id || null,
            message_id: file.message_id || null,
            job_type: "document.extract.xlsx",
            priority: -5,
            input: { reindex: true }
          }
        });
      }
      queued += 1;
    }

    if (apply && resetIds.length) {
      await db.request("document_jobs", {
        method: "PATCH",
        query: { id: `in.(${resetIds.join(",")})` },
        body: {
          status: "queued",
          attempt_count: 0,
          worker_id: null,
          lease_until: null,
          output: {},
          error: null,
          cancel_requested: false,
          started_at: null,
          finished_at: null,
          updated_at: new Date().toISOString()
        }
      });
    }
  }

  const result = { apply, scanned, alreadyCurrent, candidates: candidates.length, active, queued };
  logger.log(JSON.stringify(result));
  return result;
}

async function main() {
  const config = loadConfig(process.env);
  await reindexXlsxDocuments({
    db: new SupabaseRest(config),
    apply: process.argv.includes("--apply")
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
