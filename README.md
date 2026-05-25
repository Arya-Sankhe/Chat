# Smartyfy Chat

Smartyfy Chat is a Dockerized managed B2C SaaS chat app for the Crof-compatible model API. Users sign in with Supabase Auth, store chat history in Supabase Postgres, upload images to private Cloudflare R2, and chat through a server-only model API key.

## What Is Included

- Testing access mode: signed-in users can chat without a payment gateway while the product is in MVP testing.
- Supabase Auth with email magic links. Google OAuth is supported behind `SUPABASE_GOOGLE_ENABLED=true` after the provider is configured in Supabase.
- Supabase Postgres persistence for profiles, plans, gateway-neutral subscriptions, conversations, messages, usage, and attachments.
- Cloudflare R2 signed uploads for user images and supported documents.
- Server-only Crof model API key and cached `/models` access.
- Streaming chat responses with usage metering and plan limits.
- Document tools for PDF, DOCX, XLSX, CSV, and TSV: read/search attached files, extract tables, create new DOCX/XLSX/PDF files, edit DOCX/XLSX copies, and export DOCX/XLSX to PDF through a Docker worker.
- Docker and Docker Compose hosting.

- Optional web search backed by Jina Search Foundation (`s.jina.ai`) with Brave LLM Context as fallback. The model decides when to call it via OpenAI-style tool calls; a per-chat Auto/Off toggle lives next to the image button.

No BYOK, local chat migration, multi-provider routing, prompt marketplace, OCR, or LibreChat extras are included.

## Dependency Security

This repo intentionally keeps zero runtime npm dependencies right now. The SaaS integrations use Node built-ins (`fetch`, `crypto`) and direct HTTP APIs.

For future packages:

- npm is the only package manager for this repo.
- `.npmrc` requires `min-release-age=7`, `save-exact=true`, `ignore-scripts=true`, and a lockfile.
- Docker uses `npm ci --omit=dev`.
- Do not add packages published less than 7 days ago.
- Do not add git, remote tarball, or file dependencies without explicit approval.

## Setup

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL editor.
3. Enable Supabase email magic links. Configure Google OAuth separately before setting `SUPABASE_GOOGLE_ENABLED=true`.
4. Create a private Cloudflare R2 bucket and allow browser `PUT` uploads from your app origin.
5. Copy `.env.example` to `.env` and fill in all required values.
6. Keep `ACCESS_MODE=testing` for MVP testing. Switch it to `subscription` only after the new payment gateway is implemented.

## Environment

Required:

- `APP_URL`
- `CROFAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_GOOGLE_ENABLED`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `ACCESS_MODE`
- `TEST_PLAN_ID`

Optional plan limit overrides are available in `.env.example`.

Optional for document tools:

- `DOCUMENTS_ENABLED=true`
- `DOCUMENT_MAX_FILE_BYTES` defaults to 30MB per uploaded document.
- `DOCUMENT_MAX_PDF_PAGES` defaults to 100 pages.
- `DOCUMENT_UPLOAD_EXPIRES_SECONDS` defaults to 900 seconds for slower 30MB uploads.
- `DOCUMENT_VISUAL_INLINE_IMAGES=true` sends bounded PDF page image bytes to vision models directly; `DOCUMENT_VISUAL_MAX_IMAGE_INPUTS_PER_TURN`, `DOCUMENT_VISUAL_INLINE_MAX_BYTES`, and `DOCUMENT_VISUAL_INLINE_MAX_TOTAL_BYTES` cap request size.
- `PLAN_*_MAX_DOCUMENTS_PER_MESSAGE`, `PLAN_*_MAX_DOCUMENT_BYTES_PER_MESSAGE`, `PLAN_*_DAILY_DOCUMENT_TOOL_CALLS`, and `PLAN_*_DAILY_GENERATED_DOCUMENTS` control per-plan quotas.

The document worker uses open-source local libraries only: `pdfplumber`, `pypdf`, `python-docx`, `openpyxl`, LibreOffice, Poppler, and CSV streaming. OCR is intentionally disabled and no Tesseract packages are installed.

Optional for web search:

- `JINA_API_KEY` (required for `s.jina.ai` search; new keys include a 10M-token free trial).
- `BRAVE_SEARCH_API_KEY` (fallback; $5/month free credit).
- `WEBSEARCH_*` knobs (default mode, per-plan daily quotas, cache TTL, max tool calls per turn). See `.env.example`.

You need at least one of the two keys above. The reader endpoint `r.jina.ai` used by the `read_url` tool still works anonymously when no Jina key is set. If neither key is set the toggle is hidden from the UI and the tool is never offered to the model.

## Run Locally

```sh
node server/index.js
```

Open `http://localhost:3000`.

## Docker

```sh
cp .env.example .env
docker compose up --build
```

Compose starts two services: `smartyfy-chat` for the Node app and `document-worker` for extraction/conversion jobs. The worker has no exposed public port, runs with `init: true`, and is capped at `1500m` memory / `1.5` CPUs by default.

The health endpoint is `/api/health`.

## R2 CORS

Your R2 bucket needs CORS that allows your app origin to upload images and documents directly. Use your production origin instead of localhost when deployed.

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT", "HEAD", "GET"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 300
  }
]
```
