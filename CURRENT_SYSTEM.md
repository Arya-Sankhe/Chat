# Smartyfy Chat Current System

This document describes the app after removing Stripe and switching the MVP to payment-free testing access.

## Current Access Model

- Users must sign in with Supabase Auth.
- The backend verifies the Supabase access token on protected API routes.
- `ACCESS_MODE=testing` gives every signed-in user chat access automatically.
- `TEST_PLAN_ID` selects the plan limits used during testing. The default is `pro`.
- No payment gateway is required to use the chat service right now.
- No browser user can provide or see the Crof API key. `CROFAI_API_KEY` stays server-only.

## Current App Flow

1. The browser loads `/api/config` to get public runtime config.
2. The user signs in with a Supabase email magic link. Google OAuth can be shown later by enabling the provider in Supabase and setting `SUPABASE_GOOGLE_ENABLED=true`.
3. The browser sends the Supabase access token to the Node backend.
4. The backend upserts the user profile in Supabase Postgres.
5. In testing mode, the backend grants the configured test plan.
6. The user can load models, create conversations, upload images, and stream chat responses.
7. Usage is recorded against the selected plan limits in Supabase Postgres.

## Current Storage

- Supabase Postgres stores profiles, plans, subscriptions, conversations, messages, attachments, usage, and model cache.
- The subscriptions table is now gateway-neutral and is not required in `ACCESS_MODE=testing`.
- Cloudflare R2 stores user-uploaded images privately.
- The browser uploads images directly to R2 with short-lived signed upload URLs.
- The backend creates short-lived signed read URLs when Crof needs to inspect uploaded images.

## Current Backend Modules

- `server/auth`: Supabase Auth token verification.
- `server/db`: Supabase Postgres REST access.
- `server/storage`: Cloudflare R2 signed upload/read helpers.
- `server/crofai`: Crof-compatible model API calls and normalization.
- `server/saas`: plans, entitlements, message formatting, streaming, and usage.
- `server/routes.js`: API routing for config, auth state, plans, models, uploads, conversations, messages, and admin summary.

## Current Required Environment

```env
APP_URL=http://localhost:3000
CROFAI_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_GOOGLE_ENABLED=false
ACCESS_MODE=testing
TEST_PLAN_ID=pro
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

Optional plan limit overrides are still supported with `PLAN_*_DAILY_MESSAGES`, `PLAN_*_MONTHLY_IMAGES`, and `PLAN_*_MAX_IMAGES_PER_MESSAGE`.

## What You Need To Do Now

1. Run the latest `supabase/schema.sql` in the Supabase SQL editor.
2. Confirm `.env` has `ACCESS_MODE=testing` and `TEST_PLAN_ID=pro` or another valid plan id.
3. Keep the existing Supabase Auth setup enabled.
4. Keep the existing private R2 bucket and CORS setup.
5. Fill in the remaining backend-only secrets in `.env`: Supabase service role key, Crof API key, and R2 keys.

No Stripe dashboard setup, webhook endpoint, products, prices, or environment variables are needed anymore.

## Still Needed For Production

- Pick the new payment gateway.
- Add a dedicated payment module for checkout, customer portal or account management, webhook signature verification, and subscription sync.
- Store gateway subscription data in the existing gateway-neutral `subscriptions` table.
- Change `ACCESS_MODE=subscription` after payment sync is live.
- Add production payment webhook idempotency/event storage for the new gateway.
- Add admin tools for granting, revoking, and inspecting subscriptions.
- Add production email templates and public URLs in Supabase Auth.
- Add production domain CORS entries in Cloudflare R2.
- Add rate limiting and abuse controls at the API edge.
- Add backup/restore policy for Supabase Postgres.
- Add monitoring for Crof errors, R2 upload failures, and subscription sync failures.
