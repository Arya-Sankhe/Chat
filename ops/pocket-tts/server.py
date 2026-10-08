# Pocket TTS (Kyutai, int8, English) for Klui speech. One model per process, and a model can
# only run one generation at a time, so a busy instance answers 503 straight away and the app
# decides what to do (wait for the other instance, or fall back to Kokoro). Never published.
#   POST /tts {"text", "voice", "speed"} -> one MP3 clip (24 kHz mono), like Kokoro's
import asyncio
import logging
import os
import threading
import time

import lameenc
import numpy as np
import torch
from audiotsm import wsola
from audiotsm.io.array import ArrayReader, ArrayWriter
from fastapi import FastAPI, HTTPException, Request, Response
from pocket_tts import TTSModel
from pydantic import BaseModel, Field

THREADS = int(os.environ.get("TTS_THREADS", "2"))
VOICES = [
    "jane", "alba", "bill_boerst", "caro_davy", "peter_yearsley", "stuart_bell", "cosette",
    "marius", "javert", "jean", "anna", "vera", "fantine", "charles", "paul", "eponine",
    "azelma", "george", "mary", "michael", "eve",
]
MAX_CHARS = 1000
# A generation that runs this long is stuck; stop it so the worker frees itself.
MAX_SECONDS = 60

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("pocket-tts")
torch.set_num_threads(THREADS)

started = time.perf_counter()
model = TTSModel.load_model(language="english", quantize=True)
states = {name: model.get_state_for_audio_prompt(name) for name in VOICES}
log.info("model + %d voices ready in %.1fs (%d threads, int8)", len(states), time.perf_counter() - started, THREADS)

lock = threading.Lock()
app = FastAPI()


class Speak(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    voice: str = "jane"
    speed: float = Field(1.0, ge=0.5, le=2.0, allow_inf_nan=False)


def stretch(audio: np.ndarray, speed: float) -> np.ndarray:
    # Pocket has no speed control: WSOLA changes the pace without changing the pitch.
    if abs(speed - 1) < 0.01:
        return audio
    writer = ArrayWriter(channels=1)
    wsola(channels=1, speed=speed).run(ArrayReader(audio[np.newaxis, :]), writer)
    return writer.data[0]


def to_mp3(audio: np.ndarray) -> bytes:
    encoder = lameenc.Encoder()
    encoder.set_in_sample_rate(model.sample_rate)
    encoder.set_channels(1)
    encoder.set_bit_rate(64)
    encoder.set_quality(2)
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()
    return bytes(encoder.encode(pcm) + encoder.flush())


def synthesize(body: Speak, stop: threading.Event) -> tuple[bytes, float] | None:
    t0 = time.perf_counter()
    chunks = []
    first = None
    for chunk in model.generate_audio_stream(states[body.voice], body.text, stop=stop):
        if first is None:
            first = time.perf_counter() - t0
        chunks.append(chunk.reshape(-1).float().numpy())
    if stop.is_set():
        return None
    took = time.perf_counter() - t0
    audio = stretch(np.concatenate(chunks) if chunks else np.zeros(0, np.float32), body.speed)
    seconds = len(audio) / model.sample_rate
    log.info("voice=%s chars=%d speed=%.2f first_audio=%.0fms audio=%.2fs took=%.2fs",
             body.voice, len(body.text), body.speed, (first or 0) * 1000, seconds, took)
    return to_mp3(audio), seconds


@app.get("/health")
def health() -> dict:
    return {"ok": True, "busy": lock.locked()}


@app.post("/tts")
async def tts(body: Speak, request: Request) -> Response:
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Text is empty.")
    if body.voice not in states:
        raise HTTPException(400, "Unknown voice.")
    if not lock.acquire(blocking=False):
        raise HTTPException(503, "Busy.")
    stop = threading.Event()
    deadline = threading.Timer(MAX_SECONDS, stop.set)
    deadline.start()
    job = asyncio.get_running_loop().run_in_executor(None, synthesize, body.model_copy(update={"text": text}), stop)

    def finish(_=None):
        deadline.cancel()
        lock.release()

    try:
        # A caller that hangs up (the user interrupted) frees the model within a frame or two.
        while not job.done():
            await asyncio.wait({job}, timeout=0.1)
            if not job.done() and await request.is_disconnected():
                stop.set()
        result = job.result()
    finally:
        if job.done():
            finish()
        else:
            # This request was cancelled while generating: the model stays locked until it stops.
            stop.set()
            job.add_done_callback(finish)
    if result is None:
        if await request.is_disconnected():
            return Response(status_code=499)
        raise HTTPException(504, "Generation took too long.")
    mp3, seconds = result
    return Response(mp3, media_type="audio/mpeg", headers={"X-Audio-Seconds": f"{seconds:.3f}", "Cache-Control": "no-store"})
