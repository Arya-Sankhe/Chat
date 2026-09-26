# Speech-to-text worker for Dojo audio sources. Runs apart from the web app and the
# document worker so a long lecture can never slow either of them down.
FROM python:3.12-slim AS models

RUN apt-get update && apt-get install -y --no-install-recommends curl bzip2 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /models
# Parakeet TDT 0.6B v2 (English, int8) and Silero VAD, from the sherpa-onnx release assets.
RUN curl -fsSL https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2 | tar xj \
  && mv sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8 parakeet \
  && rm -rf parakeet/test_wavs \
  && curl -fsSLo silero_vad.onnx https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TRANSCRIBE_MODEL_DIR=/models \
    TRANSCRIBE_WORK_DIR=/work \
    MALLOC_ARENA_MAX=2

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY transcriber/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=models /models /models
COPY transcriber ./transcriber
RUN mkdir -p /work

CMD ["python", "-m", "transcriber.service"]
