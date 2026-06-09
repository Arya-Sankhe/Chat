FROM node:24-bookworm-slim AS node-deps

WORKDIR /app

COPY .npmrc ./
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice \
    poppler-utils \
    qpdf \
    fonts-dejavu \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

COPY worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=node-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=node-deps /app/node_modules ./node_modules

COPY worker ./worker

CMD ["python", "-m", "worker.worker"]
