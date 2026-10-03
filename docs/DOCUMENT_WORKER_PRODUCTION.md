# Document worker production settings

Klui keeps a durable Supabase queue even when enough workers are pre-warmed. The production objective is near-zero queue wait, not removing the queue: the queue is what prevents uploads from being lost during deploys, crashes, and traffic spikes.

## Current VPS layout

Run the document worker as one always-on Docker Compose service using `worker/Dockerfile`. The current deployment target is the existing 8 GB VPS; managed-platform replicas and automatic scaling are deliberately deferred.

The Compose service now uses the agreed initial VPS profile:

- one document-worker container
- `DOCUMENT_WORKER_CONCURRENCY=2`
- `DOCUMENT_WORKER_MAX_IDLE_SECONDS=10`
- `DOCUMENT_PDF_RENDER_WORKERS=2`
- `DOCUMENT_PAGE_UPLOAD_WORKERS=4`
- `DOCUMENT_VISUAL_PAGE_DPI=110` (full-page render default; supported range 72–180 DPI)
- `DOCUMENT_JOB_TIMEOUT_MS=120000`
- `DOCUMENT_LEASE_HEARTBEAT_SECONDS=30`
- a 3 GB worker memory ceiling, leaving host headroom for the API, research worker, search service, Docker, and the operating system
- no document-worker CPU cap; the bounded in-process concurrency remains the CPU guardrail

Each upload is one ingest job: Word and PowerPoint are converted to a job-local PDF with LibreOffice (the temporary PDF disappears with the job temp directory and is never uploaded), then every page's text comes from `pdftotext`, its drawing statistics from `pypdfium2`, and its image from bounded `pdftoppm` ranges. PowerPoint decks are converted from a copy with hidden slides shown, so every slide has a page (labelled "hidden in the presentation"). Pages without a usable text layer (scans, broken encodings) are read once by `tesseract`, in parallel up to `DOCUMENT_PDF_RENDER_WORKERS`, so they can be searched; the chat marks that text as OCR. OCR does not reuse the small model image: each scanned page is rendered again in grey at `DOCUMENT_OCR_DPI` (default 144), or at its own scan resolution (from `pdfimages -list`) when that is lower, because small print is unreadable at 110 DPI and upscaling a low-resolution scan splits digits. A page whose OCR fails is stored as `ocr_failed` and the chat says it has no searchable text. A document becomes ready only after every page's text and image is stored. Spreadsheets are read row by row with `openpyxl` / the CSV reader and have no images. Two worker loops let separate uploads ingest concurrently. Each ingest may run two bounded `pdftoppm` processes, so do not raise worker concurrency and render concurrency together without measuring peak RSS, CPU, temporary disk, and failures.

Generated and edited documents are ingested the same way inside their create/edit job, which adds the conversion and rendering time to that job (a Word file from the document engine reuses the PDF the engine already printed).

Documents stored by an older worker can be re-ingested with `npm run documents:reingest` (dry run) and `npm run documents:reingest -- --apply`, which queues them at low priority on this machine's queue. The worker stamps `ingest_version` (see `INGEST_VERSION` in `worker/ingest.py`) and the script re-ingests paged documents below the current version, so decks stored before hidden slides and scans stored before OCR are found although they share the `pages-v1` name. `--all` re-ingests every document. Documents edited in the Markdown editor and previews are always skipped, and a re-ingest keeps metadata other features stored (editable and generated-file flags). A ready document stays readable while it is re-ingested, so a reader can briefly see a mix of old and new pages; run it at a quiet time.

Workers renew job leases every 30 seconds and stop before an unrenewed lease can expire. A job reclaimed after three worker crashes is marked failed instead of being retried forever.

Keep the durable queue even when the VPS usually starts uploads immediately. Tune one control at a time from measured peak concurrency and the p95 difference between `document_jobs.created_at` and `started_at`. A future hosting-platform scaling design is separate work and must not add complexity to the current worker.

## What more CPU improves

More vCPU speeds up LibreOffice conversion, `pdftotext`, and the bounded `pdftoppm` page ranges. It does not make R2 or Supabase network calls faster. The worker logs one line per ingest with the page count, visual pages, OCR pages, text tokens and total seconds.

## External service settings

- Enable Cloudflare R2 Local Uploads when users are far from the bucket location.
- Keep direct browser-to-R2 uploads working. The same-origin relay is a reliability fallback and sends the whole file through the API service.
- Apply `supabase/migrations/2026_07_11_harden_document_uploads.sql`, then `supabase/migrations/2026_07_11_rev3_document_pipeline.sql`, before deploying the Rev 3 worker.
- For Office visual enrichment, deploy the updated API and worker first, then apply `supabase/migrations/20260712215913_add_office_visual_enrichment.sql`. This prevents an older worker from claiming a newly queued Office visual job and trying to parse the Office file as a PDF.

Cloudflare R2 Local Uploads: https://developers.cloudflare.com/r2/buckets/local-uploads/

The daily orphan-file cleanup and exact systemd setup commands are documented in [STORAGE_CLEANUP.md](STORAGE_CLEANUP.md).
