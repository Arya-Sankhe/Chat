# Klui Chat

Klui Chat is a Dockerized managed B2C SaaS chat app for the Crof-compatible model API. Users sign in with Supabase Auth, store chat history in Supabase Postgres, upload images to private Cloudflare R2, and chat through a server-only model API key.

## What Is Included

- Testing access mode for local/MVP testing, plus subscription access mode for paid users.
- Supabase Auth with Google sign-in. The client uses Google Identity Services plus Supabase `signInWithIdToken`; enable it with `SUPABASE_GOOGLE_ENABLED=true` and `GOOGLE_CLIENT_ID` after configuring the Google provider in Supabase.
- Supabase Postgres persistence for profiles, Lite/Essential/Pro plans, manual Ziina payment requests, subscriptions, conversations, messages, usage, and attachments.
- Cloudflare R2 signed uploads for user images and supported documents.
- Server-only Crof model API key and cached `/models` access.
- Streaming chat responses with usage metering and plan limits.
- Document tools for PDF, DOCX, XLSX, PPTX, CSV, and TSV: read/search attached files, extract tables, create new DOCX/XLSX/PPTX/PDF files, edit DOCX/XLSX copies, and export DOCX/XLSX/PPTX to PDF through a Docker worker.
- Docker and Docker Compose hosting.

- Optional web search backed by a self-hosted SearXNG instance (primary, bundled in `docker-compose.yml`) with Jina Search Foundation (`s.jina.ai`) and Brave LLM Context as fallbacks. The model decides when to call it via OpenAI-style tool calls; a per-chat Auto/Off toggle lives next to the image button.

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
3. Configure Google Auth before setting `SUPABASE_GOOGLE_ENABLED=true` and `GOOGLE_CLIENT_ID`.
4. Create a private Cloudflare R2 bucket and allow browser `PUT` uploads from your app origin.
5. Copy `.env.example` to `.env` and fill in all required values.
6. Keep `ACCESS_MODE=testing` for local/MVP testing. Use `ACCESS_MODE=subscription` in production so only approved paid subscriptions can chat.

## Environment

Required:

- `APP_URL`
- `CROFAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_GOOGLE_ENABLED`
- `GOOGLE_CLIENT_ID` when Google sign-in is enabled
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `ACCESS_MODE`
- `TEST_PLAN_ID`

Optional plan limit overrides are available in `.env.example`.

Model provider and usage billing:

- `OPENROUTER_API_KEY` (and optional `OPENROUTER_BASE_URL`) is the default model backend. Klui records each OpenRouter call using provider-reported `usage.cost` when available, with a generation-detail lookup/fallback token estimate for edge cases.
- `PLAN_*_MONTHLY_API_CREDITS` sets the hidden monthly API-credit allowance per plan. Klui splits each subscription billing month into four dynamic weekly buckets and shows users only a whole-number weekly percentage.

Payments:

- Plans are Lite (`10 AED`), Essential (`30 AED`), and Pro (`50 AED`).
- `PLAN_LITE_ZIINA_PAYMENT_URL`, `PLAN_ESSENTIAL_ZIINA_PAYMENT_URL`, and `PLAN_PRO_ZIINA_PAYMENT_URL` point users to your Ziina payment links. Optional `PLAN_*_ZIINA_QR_IMAGE_URL` values show QR codes on the plan cards.
- Ziina personal QR/link payments are activated by admin verification: the user creates a pending payment request with a Klui reference code, pays through Ziina, then an admin approves the request in the lightweight admin dashboard. Approval creates the active subscription.

Optional for document tools:

- `DOCUMENTS_ENABLED=true`
- `DOCUMENT_MAX_FILE_BYTES` defaults to 30MB per uploaded document.
- `DOCUMENT_MAX_PDF_PAGES` defaults to 100 pages.
- `DOCUMENT_UPLOAD_EXPIRES_SECONDS` defaults to 900 seconds for slower 30MB uploads.
- `DOCUMENT_VISUAL_INLINE_IMAGES=true` sends bounded PDF page image bytes to vision models directly as base64 data URLs (fetched concurrently with a per-image and per-turn byte budget, deduplicated across iterations). `DOCUMENT_VISUAL_MAX_IMAGE_INPUTS_PER_TURN` (default 24), `DOCUMENT_VISUAL_INLINE_MAX_BYTES` (per-image), and `DOCUMENT_VISUAL_INLINE_MAX_TOTAL_BYTES` (per-turn) cap request size.
- Agent mode gates web/document tool calls in chat. With Agent off, PDFs with published visual pages are attached as hidden, bounded page context for vision-capable models instead of using `read_document`.
- For large PDFs, the model reads in focused batches (≤12 pages per `read_document` call) across multiple tool calls in the same user turn; `DOCUMENT_MAX_TOOL_CALLS_PER_TURN` (default 75) controls how many such batches fit in one turn.
- `PLAN_*_MAX_DOCUMENTS_PER_MESSAGE` and `PLAN_*_MAX_DOCUMENT_BYTES_PER_MESSAGE` control hard document upload safety limits. Document tool usage is billed through the unified API-credit bar, not separate counters.

The document worker uses open-source local libraries. Uploaded PDFs are handled by two independent jobs: EdgeParse extracts existing digital text and structure, while Poppler renders page images that are uploaded incrementally and optionally embedded by Jina. There is no OCR engine or OCR fallback. Generated Office artifacts are JS-first through `docx`, `PptxGenJS`, and `ExcelJS`, with the existing Python generators kept as fallbacks; other formats use `pypdf`, `python-docx`, `python-pptx`, `openpyxl`, LibreOffice, ReportLab, and CSV streaming.

Optional for web search:

- `SEARXNG_BASE_URL` (default `http://searxng:8080`, the SearXNG container in `docker-compose.yml`). SearXNG is the primary, keyless provider; `SEARXNG_ENGINES` picks its upstream engines (default `duckduckgo,bing`).
- `JINA_API_KEY` (first fallback; `s.jina.ai` search requires a key — new keys include a 10M-token free trial).
- `BRAVE_SEARCH_API_KEY` (second fallback; $5/month free credit).
- `WEBSEARCH_PRIMARY_PROVIDER` reorders the chain (`searxng` | `jina` | `brave`; default `searxng`).
- `WEBSEARCH_*` knobs (default mode, per-plan daily search quotas, cache TTL, max tool calls per turn). See `.env.example`.

The provider chain degrades in order (default SearXNG → Jina → Brave) with per-provider circuit breakers. The reader endpoint `r.jina.ai` used by the `read_url` tool works anonymously when no Jina key is set. If no provider is configured at all the toggle is hidden from the UI and the tool is never offered to the model.

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

Compose starts two services: `klui-chat` for the Node app and `document-worker` for extraction/conversion jobs. The worker has no exposed public port, runs with `init: true`, and is capped at `1500m` memory / `1.5` CPUs by default.

The health endpoint is `/api/health`.

## Mobile MVP

Klui includes an Android Capacitor APK build and an installable iPhone PWA.
See [`MOBILE.md`](./MOBILE.md) for Android Studio requirements, native Google
OAuth, release signing, APK publishing, updates and production configuration.

## R2 CORS

Your R2 bucket needs CORS that allows your app origin to upload images and documents directly. Add the rule to the active `R2_BUCKET` bucket, and keep both local origins if you open the app through either `localhost` or `127.0.0.1`.

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "http://127.0.0.1:3000"],
    "AllowedMethods": ["PUT", "HEAD", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Use your production origin instead of, or in addition to, these local origins when deployed.
