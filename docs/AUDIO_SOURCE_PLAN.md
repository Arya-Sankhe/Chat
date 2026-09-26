# Dojo audio sources

Students add a lecture to a course by uploading an audio file or recording it in the browser. The server transcribes it on the VPS (no per-minute API cost) and the transcript becomes a normal course source: it is searchable in chat and usable for flashcards, tests, notes, podcasts, and the tutor. The Sources panel shows a player with a timestamped transcript; tapping a line jumps to that moment.

## Model

**Parakeet TDT 0.6B v2, int8, run with sherpa-onnx** (English only), with Silero VAD to split long audio.

Benchmarked on the production VPS (AMD EPYC 9645, 4 threads, 26 September 2026) against `moondream/parakeet-redux`, using two real lectures (57 and 76 minutes):

| | Parakeet v2 int8 (sherpa-onnx) | parakeet-redux |
| --- | --- | --- |
| 57-min lecture | 2 min 32 s | 1 min 56 s |
| 76-min lecture | 3 min 57 s | 2 min 20 s |
| Peak memory | 1.45 GB | 1.8 GB |

Redux was faster, but v2 got proper nouns and technical terms right more often (for example "Zwiebach", "haikus", "paths" where redux wrote "Zweebock", "high cus", "pads"). The v2 image is also small and runs fully offline. Redux needed torch (a 7 GB image) and fetched weights from the network at start-up.

## How it works

```
browser ──PUT (presigned)──▶ R2 original
   │
   └─POST /audio/complete ─▶ klui_enqueue_transcription ─▶ transcription_jobs (queued)
                                                               │
transcriber container (one job at a time) ◀── claim (lease) ───┘
   ├─ child process: ffprobe → ffmpeg (16 kHz PCM + 48 kbps AAC) → VAD → Parakeet
   ├─ heartbeat every ≤15 s: renews lease, reports stage + progress, notices cancel
   ├─ uploads compact AAC to R2
   └─ klui_complete_transcription_job: chunks + timed lines + swap to AAC, atomically
```

- **Queue**: `transcription_jobs` is separate from `document_jobs`, because the document worker claims any queued document job. Jobs run oldest first, one at a time. A worker that dies loses its lease after 120 s and the job is retried, up to 3 attempts. Each user can have at most 5 queued or running jobs, and retries count toward that limit.
- **One queue per machine**: every job records the `TRANSCRIBE_QUEUE` of the app that created it, and a transcriber only claims jobs from its own queue. Production uses `production`; anything else defaults to `local`. So a laptop pointed at the production database never transcribes production lectures, and production never picks up a laptop's test uploads.
- **Safe to call twice**: enqueue and publish return the same result when called again, so a lost response followed by a retry can't delete a queued upload or published audio. The browser's Retry repeats "add to queue" for the upload it already stored instead of uploading again, and uploads afresh only once the server says it released the first one. A worker whose claim response is lost gets the same job back when it claims again. When enqueue fails, the database decides whether to release the upload under the attachment's row lock, so an enqueue still in flight is never undone.
- **No lost files**: every audio object that might be left behind is written to `audio_object_cleanup` before that can happen. That covers a compact copy whose publish outcome is unknown (listed before upload, due after a day), a replaced original (listed by the publish itself), and an upload released after a failed enqueue. The transcriber deletes due entries every 5 minutes when idle, only from its own queue, and never deletes a key an attachment still references.
- **Nothing is lost**:
  - Recordings are written to IndexedDB in one-second slices while recording. The local copy is deleted only after the server has queued the recording, and a closed tab offers the recording again under Add sources → Audio.
  - Uploaded originals stay in R2 until the transcript is published.
  - Failed uploads and failed transcriptions keep a Retry button.
- **Memory**: each job runs in a fresh child process, so model memory goes back to the OS when it exits. On the VPS a 57-minute lecture peaked at about 1.5 GB of process memory. The container is capped at 3 GB with no swap, and the service stops a job cleanly if the child passes 2.6 GB.
- **CPU**: the container gets 4 CPUs, 4 threads, and `cpu_shares: 256`, so klui containers win whenever they compete for CPU.
- **Storage**: the 16 kHz audio the model reads exists only on the worker's disk while it runs. The kept copy is 48 kbps mono AAC, about 22 MB per hour, and the original upload is deleted once the transcript is published. Quotas count the estimated compact size from the moment a lecture is queued (6.2 KB per second of audio), so a queued 80 MB MP3 doesn't block the rest of a course. The browser's duration is only a first guess: the worker corrects the estimate from the decoded length, the exact size is recorded once the job is done, and a failed job counts its full original again until it is retried or deleted (a cancelled job never does, since its source is being removed). Publishing checks both the course and the account limit, because the compact copy can be larger than a very compressed original.
- **Length limit**: ffmpeg stops decoding just past `STUDY_AUDIO_MAX_SECONDS`, and the decoded length is checked, so a file whose header is missing or wrong (recorded WebM has none) can't get around the limit.
- **Search**: transcript chunks are about 4,000 characters, labelled by time range (`12:30–18:05`), with a `[m:ss]` marker on every line. The document worker's embedding healer indexes them like any other source.

Limits are set in `.env` (`STUDY_AUDIO_*`, `TRANSCRIBE_*`); see `.env.example`.

## Deploying

1. Apply `supabase/migrations/20260926120000_study_audio_sources.sql`, `20260926160000_study_audio_hardening.sql`, `20260926180000_study_audio_cleanup.sql` and `20260926200000_study_audio_claim_recovery.sql` before deploying the app. (All four were applied to the hosted project on 26 September 2026.)
2. On the VPS, set the production queue once. Both klui-chat and the transcriber read it from `.env`:

   ```bash
   cd /root/apps/klui-chat && echo 'TRANSCRIBE_QUEUE=production' >> .env
   ```

   `deploy/docker-compose.prod.yml` sets the same value, for setups that use it as the override.
3. On the VPS (`/root/apps/klui-chat`, where `docker-compose.override.yml` is picked up automatically):

   ```bash
   git pull && docker compose up -d --build klui-chat transcriber
   ```

   The transcriber image downloads the model (about 650 MB) at build time.
4. Check it:

   ```bash
   docker compose logs -f transcriber
   ```

   The first line should read `ready … queue=production`. Each finished job logs `job done … audio_min=… seconds=… peak_child_mb=…`.
