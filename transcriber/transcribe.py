"""One transcription, run as a short-lived child process.

The service starts this once per job and waits for it to exit, so every byte the model
and decoder allocated goes back to the OS before the next lecture starts.

Usage: python -m transcriber.transcribe <input-file> <work-dir>
Progress is reported as JSON lines on stdout; the result is written to <work-dir>/result.json.
Exit code 3 means the input itself is unusable (no point retrying).
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

SAMPLE_RATE = 16000
BLOCK_SAMPLES = SAMPLE_RATE // 2
EXIT_BAD_INPUT = 3


def emit(event, **fields):
    print(json.dumps({"event": event, **fields}), flush=True)


def fail_input(code, message):
    emit("error", code=code, message=message)
    sys.exit(EXIT_BAD_INPUT)


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def probe_duration(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type:format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        fail_input("unreadable_audio", "This file could not be read as audio.")
    info = json.loads(result.stdout or "{}")
    if not info.get("streams"):
        fail_input("no_audio", "This file has no audio track.")
    try:
        return float(info.get("format", {}).get("duration") or 0)
    except ValueError:
        return 0.0


def prepare_audio(source, pcm_path, compact_path, duration, threads, limit_seconds):
    """Decode once, write two outputs: 16 kHz mono PCM for the model and a small AAC
    copy for playback. Progress comes from ffmpeg's -progress stream. Both outputs stop
    just past the length limit, so a file whose header under-reports its length (or has
    none, like recorded WebM) can't make us decode hours of audio."""
    cap = ["-t", str(limit_seconds + 1)]
    command = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-progress", "pipe:1", "-nostats",
        "-threads", str(threads),
        "-i", str(source), "-map", "0:a:0", "-vn", *cap,
        "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-c:a", "pcm_s16le", str(pcm_path),
        "-map", "0:a:0", "-vn", *cap, "-ac", "1", "-ar", "22050", "-c:a", "aac", "-b:a", "48k",
        "-movflags", "+faststart", str(compact_path),
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    last = 0.0
    for line in process.stdout:
        if line.startswith("out_time_us=") and duration > 0:
            try:
                done = int(line.split("=", 1)[1]) / 1e6
            except ValueError:
                continue
            now = time.monotonic()
            if now - last > 1.5:
                last = now
                emit("progress", stage="preparing", progress=min(1.0, done / duration))
    stderr = process.stderr.read()
    if process.wait() != 0:
        fail_input("unreadable_audio", f"This audio could not be decoded. {stderr.strip()[-300:]}".strip())


def transcribe(pcm_path, model_dir, threads):
    import numpy as np
    import sherpa_onnx

    model = model_dir / "parakeet"
    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(model / "encoder.int8.onnx"),
        decoder=str(model / "decoder.int8.onnx"),
        joiner=str(model / "joiner.int8.onnx"),
        tokens=str(model / "tokens.txt"),
        num_threads=threads,
        model_type="nemo_transducer",
    )
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(model_dir / "silero_vad.onnx")
    config.silero_vad.min_silence_duration = 0.4
    config.silero_vad.max_speech_duration = 20
    config.sample_rate = SAMPLE_RATE
    config.num_threads = 1
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=60)

    total = max(1, os.path.getsize(pcm_path) // 2)
    segments = []
    last = 0.0

    def drain():
        while not vad.empty():
            front = vad.front
            stream = recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, front.samples)
            recognizer.decode_stream(stream)
            start = front.start / SAMPLE_RATE
            segments.append({
                "start": start,
                "end": start + len(front.samples) / SAMPLE_RATE,
                "text": stream.result.text,
            })
            vad.pop()

    # Stream the PCM file in half-second blocks; hours of audio never sit in memory.
    read = 0
    with open(pcm_path, "rb") as handle:
        while True:
            raw = handle.read(BLOCK_SAMPLES * 2)
            if not raw:
                break
            block = np.frombuffer(raw[: len(raw) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
            vad.accept_waveform(block)
            drain()
            read += len(block)
            now = time.monotonic()
            if now - last > 2:
                last = now
                emit("progress", stage="transcribing", progress=min(1.0, read / total))
    vad.flush()
    drain()
    return segments


def main():
    source, work = Path(sys.argv[1]), Path(sys.argv[2])
    threads = max(1, min(env_int("TRANSCRIBE_THREADS", 4), 8))
    model_dir = Path(os.environ.get("TRANSCRIBE_MODEL_DIR", "/models"))
    max_seconds = env_int("TRANSCRIBE_MAX_SECONDS", 4 * 3600)

    too_long = f"Recordings can be up to {max_seconds // 3600} hours long."
    duration = probe_duration(source)
    if duration > max_seconds:
        fail_input("too_long", too_long)
    if duration:
        emit("duration", seconds=duration)

    pcm_path, compact_path = work / "audio.pcm", work / "audio.m4a"
    prepare_audio(source, pcm_path, compact_path, duration, min(threads, 2), max_seconds)
    # The original is no longer needed; free the disk before the long step.
    source.unlink(missing_ok=True)
    # The decoded length is the real one; headers can be missing or wrong.
    pcm_seconds = os.path.getsize(pcm_path) / 2 / SAMPLE_RATE
    if pcm_seconds > max_seconds:
        fail_input("too_long", too_long)
    if pcm_seconds < 0.5:
        fail_input("no_speech", "This recording is empty.")
    emit("duration", seconds=pcm_seconds)

    emit("progress", stage="transcribing", progress=0)
    segments = transcribe(pcm_path, model_dir, threads)
    pcm_path.unlink(missing_ok=True)
    if not any(segment["text"].strip() for segment in segments):
        fail_input("no_speech", "No speech was found in this recording.")

    (work / "result.json").write_text(json.dumps({
        "duration": pcm_seconds,
        "segments": segments,
        "model": "parakeet-tdt-0.6b-v2-int8",
    }))
    emit("done")


if __name__ == "__main__":
    main()
