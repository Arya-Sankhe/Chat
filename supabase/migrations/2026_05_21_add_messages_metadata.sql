-- Adds the `metadata` JSONB column required by the Model Council feature
-- (see server/routes.js + server/saas/council.js). PostgREST will reject
-- inserts referencing `metadata` until this migration is applied AND the
-- schema cache is reloaded.
--
-- How to apply:
--   1. Open the Supabase dashboard → SQL Editor for project
--      htsjccozkgkpanmqogwk.
--   2. Paste the contents of this file and Run.
--   3. The final NOTIFY refreshes the PostgREST schema cache immediately
--      so the API picks up the new column without restarting.

alter table public.messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Reload PostgREST schema cache so the REST API sees the new column.
notify pgrst, 'reload schema';
