# English lecture audio: proposed next step

Research date: 24 September 2026. No audio ingestion code or dependencies were added.

The deployment notes describe an 8 GB VPS with a 3 GB ceiling for the document worker, alongside the API, research worker, search, and OS. CPU model, core allocation, available RAM under load, and GPU availability have not been verified on the live VPS.

## Recommendation

Benchmark **Moonshine Medium Streaming, English, using the current 8-bit `moonshine-voice` runtime** first. It has 245 million parameters and an MIT license. The publisher reports 6.65% average word error rate across eight English datasets for the floating-point reference. The shipped quantized model scores 2.17% on LibriSpeech test-clean; these are different evaluations and neither predicts noisy lecture accuracy. Use current model assets: the July 2026 quantization update improved accuracy. [Models](https://moonshine-voice.readthedocs.io/en/stable/models/available-models/), [quantized accuracy](https://moonshine-voice.readthedocs.io/en/stable/models/accuracy/).

| Candidate | Why consider it | Main tradeoff |
| --- | --- | --- |
| Moonshine Medium Streaming, quantized | First candidate for compact English transcription; 245M parameters | Validate technical vocabulary, accents, and long recordings |
| Moonshine Small Streaming, quantized | Lower compute option at 123M parameters | Higher published reference WER: 7.84% |
| faster-whisper `small.en`, CPU INT8 | Comparison baseline for offline lectures; built-in VAD and timestamps | Published small-model CPU benchmark uses about 1.48 GB RAM; VPS speed must be measured |

The Moonshine models and scores come from its [model catalog](https://moonshine-voice.readthedocs.io/en/stable/models/available-models/). The Whisper memory figure comes from the [faster-whisper benchmark](https://github.com/SYSTRAN/faster-whisper#small-model-on-cpu), on an i7-12700K using eight threads, not this VPS. Moonshine's live-speech latency comparisons are explicitly not bulk-file throughput comparisons. [Benchmark methodology](https://moonshine-voice.readthedocs.io/en/stable/using/benchmarks/).

## Proposed implementation

1. Upload the original recording to R2 with the existing account/course quotas and a duration limit.
2. Queue a durable transcription job. Start with one CPU worker, one concurrent recording, a provisional 2 GB memory ceiling, and bounded CPU threads. Confirm the host has headroom before enabling it; the ceiling is a proposed budget, not a measured requirement.
3. Decode progressively to mono audio, segment speech, and transcribe in bounded pieces. Keep timestamps and progress; persist completed segments so a restart does not lose an entire lecture. Do not load hours of uncompressed audio into memory.
4. Save the transcript as a source using the same document/chunk search path as pasted text. Link it to the original recording. Chat and study generation can reuse the transcript.

No per-minute transcription API fee; the cost is shared VPS CPU, temporary disk, and recording storage. Queueing prevents several long lectures from starving document processing. Speaker identification and live recording can wait.

Before choosing the final model, compare at least three representative recordings (clear speech, an accented lecture, and noisy speech with technical terms). Measure important-word errors, peak memory, processing time per audio minute, and chat latency during transcription. No model or VPS benchmark was run as part of this change.

## Website/text rollout

Apply `supabase/migrations/20260924120139_study_text_website_sources.sql` before deploying the app changes. It extends the existing document kind constraint and adds a service-role-only transaction for publishing a source and its searchable chunks. The migration was exercised against a disposable local PostgreSQL database; it has not been applied to the hosted database.

Website intake reads one public page through the existing TinyFetch-first reader with its existing fallback. It saves up to 200,000 characters without silently truncating larger sources. Returned Markdown image descriptions and URLs are retained as text; downloading images, visual indexing, recursive site crawling, audio, and YouTube are not implemented.
