/* Re-ingest documents stored by an older worker, so every page has its text and its image,
   spreadsheets have row-level reading, decks keep their hidden slides and scans have OCR text.
   Dry run by default; pass --apply to queue, and --all to re-ingest every document regardless
   of the version that stored it.

   It resets each document's existing extraction job (or adds one) on this app's queue, at a
   low priority so new uploads go first. Documents edited in the Markdown editor are skipped:
   their saved text is newer than their file. */
import { pathToFileURL } from "node:url";
import { loadConfig } from "../server/config.js";
import { SupabaseRest } from "../server/db/supabaseRest.js";

// The worker's ingest.INGEST_VERSION. Paged documents stored before version 2 lack hidden
// slides and OCR text although they carry the same pipeline name.
const INGEST_VERSION = 2;
const CURRENT_VERSION = { "pages-v1": INGEST_VERSION, "sheets-v1": 1 };
const KINDS = ["pdf", "docx", "pptx", "xlsx", "csv", "tsv"];

export function needsIngest(file, { all = false } = {}) {
  const metadata = file.metadata || {};
  if (metadata.preview === true) return "skip";
  if (metadata.editable === true && Number(metadata.editor_revision || 1) > 1) return "skip";
  const current = CURRENT_VERSION[metadata.pipeline];
  if (!all && current && Number(metadata.ingest_version || 1) >= current) return "current";
  return "ingest";
}

export async function reingestDocuments({ db, queue = "local", apply = false, all = false, batchSize = 200, logger = console }) {
  let offset = 0;
  let scanned = 0;
  let alreadyCurrent = 0;
  let skipped = 0;
  let active = 0;
  let queued = 0;
  const candidates = [];

  while (true) {
    const files = await db.request("document_files", {
      query: {
        kind: `in.(${KINDS.join(",")})`,
        queue: `eq.${queue}`,
        or: "(text_ready_at.not.is.null,visual_ready_at.not.is.null)",
        select: "id,user_id,kind,conversation_id,message_id,metadata",
        order: "created_at.asc",
        limit: String(batchSize),
        offset: String(offset)
      }
    });
    scanned += files.length;
    for (const file of files) {
      const state = needsIngest(file, { all });
      if (state === "current") alreadyCurrent += 1;
      else if (state === "skip") skipped += 1;
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
        job_type: "like.document.extract.*",
        select: "id,document_file_id,job_type,status,queue"
      }
    });
    const byFile = new Map(jobs.map((job) => [`${job.document_file_id}:${job.job_type}`, job]));
    const resetIds = [];

    for (const file of files) {
      const jobType = `document.extract.${file.kind}`;
      const job = byFile.get(`${file.id}:${jobType}`);
      if (job && job.queue !== queue) continue;
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
            job_type: jobType,
            queue,
            priority: -5,
            input: { reingest: true }
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
          priority: -5,
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

  const result = { apply, all, scanned, alreadyCurrent, skipped, candidates: candidates.length, active, queued };
  logger.log(JSON.stringify(result));
  return result;
}

async function main() {
  const config = loadConfig(process.env);
  await reingestDocuments({
    db: new SupabaseRest(config),
    queue: config.documents.queue,
    apply: process.argv.includes("--apply"),
    all: process.argv.includes("--all")
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
