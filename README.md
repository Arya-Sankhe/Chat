# Smartyfy Chat

Smartyfy Chat is a Dockerized managed B2C SaaS chat app for the Crof-compatible model API. Users sign in with Supabase Auth, subscribe through Stripe, store chat history in Supabase Postgres, upload images to private Cloudflare R2, and chat through a server-only model API key.

## What Is Included

- Paid-first access: active Stripe subscription required before chat.
- Supabase Auth with Google OAuth and email magic links.
- Supabase Postgres persistence for profiles, plans, subscriptions, conversations, messages, usage, attachments, and webhooks.
- Stripe Checkout, Customer Portal, and signed webhook handling.
- Cloudflare R2 signed uploads for user images.
- Server-only Crof model API key and cached `/models` access.
- Streaming chat responses with usage metering and plan limits.
- Docker and Docker Compose hosting.

No BYOK, local chat migration, multi-provider routing, prompt marketplace, file RAG, web search, or LibreChat extras are included.

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
3. Enable Supabase Google OAuth and email magic links.
4. Create Stripe products/prices for `hobby`, `pro`, `intermediate`, `scale`, and `max`.
5. Add a Stripe webhook endpoint for `/api/stripe/webhook`.
6. Create a private Cloudflare R2 bucket and allow browser `PUT` uploads from your app origin.
7. Copy `.env.example` to `.env` and fill in all required values.

## Environment

Required:

- `APP_URL`
- `CROFAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `PLAN_*_STRIPE_PRICE_ID`

Optional plan limit overrides are available in `.env.example`.

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

The health endpoint is `/api/health`.

## R2 CORS

Your R2 bucket needs CORS that allows your app origin to upload images directly. Use your production origin instead of localhost when deployed.

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
