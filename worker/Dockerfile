FROM node:24-bookworm-slim AS node-deps

WORKDIR /app

COPY .npmrc ./
COPY worker/package.json worker/package-lock.json ./
# PptxGenJS 4.0.1 declares image-size but does not call it. All published
# image-size versions currently have parser DoS advisories, so exclude the
# unreachable package from the production image until upstream ships a fix.
RUN npm ci --omit=dev \
  && rm -rf node_modules/pptxgenjs/node_modules/image-size \
  && node --input-type=module -e "import pptxgen from 'pptxgenjs'; const deck = new pptxgen(); deck.addSlide().addText('ok'); await deck.writeFile({ fileName: '/tmp/pptxgen-smoke.pptx' })" \
  && rm -f /tmp/pptxgen-smoke.pptx


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice \
    python3-uno \
    poppler-utils \
    qpdf \
    fonts-dejavu \
    fonts-liberation \
    libstdc++6 \
    libgcc-s1 \
  && rm -rf /var/lib/apt/lists/*

COPY worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=node-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=node-deps /app/node_modules ./node_modules

COPY worker ./worker

CMD ["python", "-m", "worker.worker"]
