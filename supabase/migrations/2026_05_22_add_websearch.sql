-- Web search additions:
--   1. Daily per-user search counter on usage_daily
--   2. search_cache table for cross-restart / cross-instance dedup
--   3. smartyfy_consume_search RPC for atomic limit-enforcement

alter table public.usage_daily
  add column if not exists search_count integer not null default 0;

create table if not exists public.search_cache (
  query_hash text primary key,
  query text not null default '',
  provider text not null,
  results jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists search_cache_expires_at_idx
  on public.search_cache (expires_at);

alter table public.search_cache enable row level security;

grant select, insert, update, delete on public.search_cache to service_role;

drop policy if exists "search cache service role" on public.search_cache;

create or replace function public.smartyfy_consume_search(
  p_user_id uuid,
  p_plan_id text,
  p_daily_search_limit integer,
  p_search_count integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := current_date;
  v_daily public.usage_daily%rowtype;
  v_count integer := greatest(coalesce(p_search_count, 1), 1);
begin
  insert into public.usage_daily (user_id, day, plan_id)
  values (p_user_id, v_day, p_plan_id)
  on conflict (user_id, day) do nothing;

  select * into v_daily
  from public.usage_daily
  where user_id = p_user_id and day = v_day
  for update;

  if v_daily.search_count + v_count > p_daily_search_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Daily web-search limit reached for your plan.',
      'search_count', v_daily.search_count,
      'requested_search_count', v_count,
      'daily_search_limit', p_daily_search_limit
    );
  end if;

  update public.usage_daily
  set
    plan_id = p_plan_id,
    search_count = search_count + v_count,
    updated_at = now()
  where user_id = p_user_id and day = v_day
  returning * into v_daily;

  return jsonb_build_object(
    'allowed', true,
    'search_count', v_daily.search_count,
    'consumed_search_count', v_count,
    'daily_search_limit', p_daily_search_limit
  );
end;
$$;

grant execute on function public.smartyfy_consume_search(uuid, text, integer, integer) to service_role;
