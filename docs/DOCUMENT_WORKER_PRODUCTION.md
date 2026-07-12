# Document worker production settings

Klui keeps a durable Supabase queue even when enough workers are pre-warmed. The production objective is near-zero queue wait, not removing the queue: the queue is what prevents uploads from being lost during deploys, crashes, and traffic spikes.

## Current VPS layout

Run the document worker as one always-on Docker Compose service using `worker/Dockerfile`. The current deployment target is the existing 8 GB VPS; managed-platform replicas and automatic scaling are deliberately deferred.

The Compose service now uses the agreed initial VPS profile:

- one document-worker container
- `DOCUMENT_WORKER_CONCURRENCY=2`
- `DOCUMENT_WORKER_POLL_SECONDS=0.5`
- `DOCUMENT_PDF_RENDER_WORKERS=2`
- `DOCUMENT_PAGE_UPLOAD_WORKERS=4`
- `DOCUMENT_JINA_BATCH_SIZE=8`
- `DOCUMENT_JINA_BATCH_CONCURRENCY=2`
- `DOCUMENT_JOB_TIMEOUT_MS=120000`
- `DOCUMENT_LEASE_HEARTBEAT_SECONDS=30`
- a 3 GB worker memory ceiling, leaving host headroom for the API, research worker, search service, Docker, and the operating system
- no document-worker CPU cap; the bounded in-process concurrency remains the CPU guardrail

Two worker loops let the local EdgeParse extraction job and CPU-bound page-rendering job for a PDF progress concurrently and also reduce queue wait for separate uploads. Each rendering job may run two bounded `pdftoppm` processes, so do not raise worker concurrency and render concurrency together without measuring peak RSS, CPU, temporary disk, and failures. A completed render range is uploaded and published immediately; it does not wait for every other range to finish.

Workers renew job leases every 30 seconds and stop before an unrenewed lease can expire. A job reclaimed after three worker crashes is marked failed instead of being retried forever.

Keep the durable queue even when the VPS usually starts uploads immediately. Tune one control at a time from measured peak concurrency and the p95 difference between `document_jobs.created_at` and `started_at`. A future hosting-platform scaling design is separate work and must not add complexity to the current worker.

## What more CPU improves

More vCPU speeds up local EdgeParse parsing and the bounded `pdftoppm` page ranges. It does not make Jina, R2, or Supabase network calls faster. Watch per-stage timings for text extraction, rendering, embeddings, and page uploads separately before changing resources.

## External service settings

- Use a paid Jina key before raising batch concurrency; account-wide request concurrency and token limits still apply.
- Enable Cloudflare R2 Local Uploads when users are far from the bucket location.
- Keep direct browser-to-R2 uploads working. The same-origin relay is a reliability fallback and sends the whole file through the API service.
- Apply `supabase/migrations/2026_07_11_harden_document_uploads.sql`, then `supabase/migrations/2026_07_11_rev3_document_pipeline.sql`, before deploying the Rev 3 worker.

Cloudflare R2 Local Uploads: https://developers.cloudflare.com/r2/buckets/local-uploads/
