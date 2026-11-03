# Basic free tier

Verified in production on 21 October 2026: subscription mode offers signed-in
accounts without a paid subscription Think chat and image uploads. The defaults
are 15 messages and 5 image uploads per day, resetting at midnight in Dubai.
Documents, voice, other models, tools, research and project creation require a
paid plan. This is separate from a coupon's one-time free subscription period.

The server enforces allowances through `server/saas/freePlan.js` and the atomic
`klui_consume_free_usage` database function. Set `FREE_PLAN_ENABLED=false` to send
unsubscribed accounts to the paywall instead. `FREE_DAILY_MESSAGES` and
`FREE_DAILY_IMAGES` override the defaults.

The applied migration is
`supabase/migrations/20261020212205_free_plan_daily_usage.sql`. Its filename now
matches production's migration history; no database change was made during the
Git reconciliation.
