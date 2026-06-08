-- Remove legacy request/image/search/document counters after moving billing to
-- unified OpenRouter API-credit metering.

drop function if exists public.klui_consume_documents(uuid, text, integer, integer, integer, integer);
drop function if exists public.klui_consume_search(uuid, text, integer, integer);
drop function if exists public.klui_consume_usage(uuid, text, integer, integer, integer, integer);
drop function if exists public.klui_consume_usage(uuid, text, integer, integer, integer);

drop table if exists public.usage_events;
drop table if exists public.usage_monthly;
drop table if exists public.usage_daily;

alter table public.plans
  drop column if exists daily_message_limit,
  drop column if exists monthly_image_limit;
