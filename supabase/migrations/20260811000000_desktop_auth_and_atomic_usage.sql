-- Desktop identity, privacy consent, and atomic shared usage metering.
-- Additive by design: existing profile/subscription/conversation identifiers remain unchanged.

create table if not exists public.account_identities (
  account_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (provider, provider_subject)
);

create index if not exists account_identities_account_id_idx
  on public.account_identities(account_id);

insert into public.account_identities (account_id, provider, provider_subject)
select id, 'supabase', id::text from public.profiles
on conflict (provider, provider_subject) do nothing;

create table if not exists public.desktop_privacy_consents (
  account_id uuid not null references public.profiles(id) on delete cascade,
  oauth_client_id text not null,
  policy_version text not null,
  accepted_at timestamptz not null default now(),
  primary key (account_id, oauth_client_id, policy_version)
);

alter table public.account_identities enable row level security;
alter table public.desktop_privacy_consents enable row level security;

revoke all on public.account_identities, public.desktop_privacy_consents from public, anon, authenticated;
grant all on public.account_identities, public.desktop_privacy_consents to service_role;

alter table public.usage_api_weekly
  add column if not exists api_credit_reserved numeric(18,8) not null default 0;

insert into public.app_settings (key, value)
values ('funded_inference_disabled', '{"disabled":false}'::jsonb)
on conflict (key) do nothing;

alter table public.usage_api_events
  add column if not exists request_id uuid,
  add column if not exists surface text,
  add column if not exists modality text,
  add column if not exists oauth_client_id text,
  add column if not exists reserved_credits numeric(18,8) not null default 0,
  add column if not exists submitted_at timestamptz,
  add column if not exists settled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists usage_api_events_account_request_idx
  on public.usage_api_events(user_id, request_id)
  where request_id is not null;

create index if not exists usage_api_events_reconcile_idx
  on public.usage_api_events(status, updated_at)
  where status in ('reserved', 'submitted');

create or replace function public.klui_check_api_budget(
  p_user_id uuid,
  p_plan_id text,
  p_period_start date,
  p_period_end date,
  p_week_start date,
  p_week_end date,
  p_week_index integer,
  p_weekly_credit_limit numeric
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.usage_api_weekly%rowtype;
begin
  if exists (
    select 1 from public.app_settings
    where key = 'funded_inference_disabled' and value->>'disabled' = 'true'
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'usage_metering_disabled');
  end if;
  insert into public.usage_api_weekly (
    user_id, period_start, period_end, week_index, week_start, week_end,
    plan_id, api_credit_limit, api_credit_reserved
  ) values (
    p_user_id, p_period_start, p_period_end, p_week_index, p_week_start, p_week_end,
    p_plan_id, greatest(coalesce(p_weekly_credit_limit, 0), 0), 0
  )
  on conflict (user_id, period_start, week_index) do update set
    period_end = excluded.period_end,
    week_start = excluded.week_start,
    week_end = excluded.week_end,
    plan_id = excluded.plan_id,
    api_credit_limit = excluded.api_credit_limit,
    updated_at = now();

  select * into v_row from public.usage_api_weekly
  where user_id = p_user_id and period_start = p_period_start and week_index = p_week_index
  for update;

  if v_row.api_credit_limit <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'usage_not_enabled');
  end if;
  if v_row.api_credit_used + v_row.api_credit_reserved >= v_row.api_credit_limit then
    return jsonb_build_object(
      'allowed', false, 'reason', 'usage_exhausted',
      'api_credit_used', v_row.api_credit_used,
      'api_credit_reserved', v_row.api_credit_reserved,
      'api_credit_limit', v_row.api_credit_limit
    );
  end if;
  return jsonb_build_object(
    'allowed', true,
    'api_credit_used', v_row.api_credit_used,
    'api_credit_reserved', v_row.api_credit_reserved,
    'api_credit_limit', v_row.api_credit_limit,
    'week_index', v_row.week_index,
    'week_start', v_row.week_start,
    'week_end', v_row.week_end
  );
end;
$$;

create or replace function public.klui_reserve_api_usage(
  p_user_id uuid,
  p_request_id uuid,
  p_subscription_id uuid,
  p_plan_id text,
  p_surface text,
  p_modality text,
  p_oauth_client_id text,
  p_provider text,
  p_model text,
  p_period_start date,
  p_period_end date,
  p_week_start date,
  p_week_end date,
  p_week_index integer,
  p_weekly_credit_limit numeric,
  p_reserved_credits numeric
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit numeric := greatest(coalesce(p_weekly_credit_limit, 0), 0);
  v_reserve numeric := greatest(coalesce(p_reserved_credits, 0), 0);
  v_week public.usage_api_weekly%rowtype;
  v_existing public.usage_api_events%rowtype;
begin
  if p_request_id is null or v_reserve <= 0 then
    raise exception 'request id and a positive reservation are required';
  end if;
  if p_surface not in ('web', 'desktop_windows', 'desktop_macos') then
    raise exception 'invalid usage surface';
  end if;
  if p_modality not in ('llm', 'stt') then
    raise exception 'invalid usage modality';
  end if;
  if exists (
    select 1 from public.app_settings
    where key = 'funded_inference_disabled' and value->>'disabled' = 'true'
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'usage_metering_disabled');
  end if;

  insert into public.usage_api_weekly (
    user_id, period_start, period_end, week_index, week_start, week_end,
    plan_id, api_credit_limit, api_credit_used, api_credit_reserved
  ) values (
    p_user_id, p_period_start, p_period_end, p_week_index, p_week_start, p_week_end,
    p_plan_id, v_limit, 0, 0
  )
  on conflict (user_id, period_start, week_index) do update set
    period_end = excluded.period_end,
    week_start = excluded.week_start,
    week_end = excluded.week_end,
    plan_id = excluded.plan_id,
    api_credit_limit = excluded.api_credit_limit,
    updated_at = now();

  select * into v_week from public.usage_api_weekly
  where user_id = p_user_id and period_start = p_period_start and week_index = p_week_index
  for update;

  select * into v_existing from public.usage_api_events
  where user_id = p_user_id and request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'allowed', false, 'duplicate', true, 'status', v_existing.status,
      'api_credit_used', v_week.api_credit_used,
      'api_credit_reserved', v_week.api_credit_reserved,
      'api_credit_limit', v_week.api_credit_limit
    );
  end if;

  if v_limit <= 0 or v_week.api_credit_used + v_week.api_credit_reserved + v_reserve > v_limit then
    return jsonb_build_object(
      'allowed', false, 'reason', 'usage_exhausted',
      'api_credit_used', v_week.api_credit_used,
      'api_credit_reserved', v_week.api_credit_reserved,
      'api_credit_limit', v_week.api_credit_limit
    );
  end if;

  update public.usage_api_weekly set
    api_credit_reserved = api_credit_reserved + v_reserve,
    updated_at = now()
  where user_id = p_user_id and period_start = p_period_start and week_index = p_week_index
  returning * into v_week;

  insert into public.usage_api_events (
    user_id, request_id, subscription_id, plan_id, surface, modality, oauth_client_id,
    provider, model, period_start, period_end, week_index, week_start, week_end,
    reserved_credits, cost_credits, cost_source, usage, status, updated_at
  ) values (
    p_user_id, p_request_id, p_subscription_id, p_plan_id, p_surface, p_modality,
    p_oauth_client_id, p_provider, p_model, p_period_start, p_period_end, p_week_index,
    p_week_start, p_week_end, v_reserve, 0, 'reserved', '{}'::jsonb, 'reserved', now()
  );

  return jsonb_build_object(
    'allowed', true,
    'api_credit_used', v_week.api_credit_used,
    'api_credit_reserved', v_week.api_credit_reserved,
    'api_credit_limit', v_week.api_credit_limit
  );
end;
$$;

create or replace function public.klui_mark_api_usage_submitted(
  p_user_id uuid,
  p_request_id uuid,
  p_generation_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_event public.usage_api_events%rowtype;
begin
  update public.usage_api_events set
    status = 'submitted',
    generation_id = coalesce(nullif(p_generation_id, ''), generation_id),
    submitted_at = coalesce(submitted_at, now()),
    updated_at = now()
  where user_id = p_user_id and request_id = p_request_id and status = 'reserved'
  returning * into v_event;
  if not found then
    select * into v_event from public.usage_api_events
    where user_id = p_user_id and request_id = p_request_id;
  end if;
  if v_event.id is null then raise exception 'usage reservation not found'; end if;
  return jsonb_build_object('status', v_event.status, 'reserved_credits', v_event.reserved_credits);
end;
$$;

create or replace function public.klui_settle_api_usage(
  p_user_id uuid,
  p_request_id uuid,
  p_cost_credits numeric,
  p_cost_source text,
  p_usage jsonb default '{}'::jsonb,
  p_generation_id text default null,
  p_estimated boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.usage_api_events%rowtype;
  v_cost numeric := greatest(coalesce(p_cost_credits, 0), 0);
  v_week public.usage_api_weekly%rowtype;
begin
  select * into v_event from public.usage_api_events
  where user_id = p_user_id and request_id = p_request_id for update;
  if not found then raise exception 'usage reservation not found'; end if;
  if v_event.status in ('settled', 'estimated') then
    return jsonb_build_object('status', v_event.status, 'cost_credits', v_event.cost_credits);
  end if;
  if v_event.status = 'released' then raise exception 'released reservation cannot be settled'; end if;
  if v_cost > v_event.reserved_credits then
    raise exception 'actual provider cost exceeds reservation ceiling';
  end if;

  update public.usage_api_weekly set
    api_credit_reserved = greatest(api_credit_reserved - v_event.reserved_credits, 0),
    api_credit_used = api_credit_used + v_cost,
    updated_at = now()
  where user_id = v_event.user_id and period_start = v_event.period_start and week_index = v_event.week_index
  returning * into v_week;

  update public.usage_api_events set
    status = case when p_estimated then 'estimated' else 'settled' end,
    cost_credits = v_cost,
    cost_source = coalesce(nullif(p_cost_source, ''), case when p_estimated then 'reservation_ceiling' else 'provider' end),
    usage = coalesce(p_usage, '{}'::jsonb),
    generation_id = coalesce(nullif(p_generation_id, ''), generation_id),
    submitted_at = coalesce(submitted_at, now()),
    settled_at = now(),
    updated_at = now()
  where id = v_event.id;

  return jsonb_build_object(
    'status', case when p_estimated then 'estimated' else 'settled' end,
    'cost_credits', v_cost,
    'api_credit_used', v_week.api_credit_used,
    'api_credit_reserved', v_week.api_credit_reserved,
    'api_credit_limit', v_week.api_credit_limit
  );
end;
$$;

create or replace function public.klui_release_api_usage(
  p_user_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_event public.usage_api_events%rowtype;
begin
  select * into v_event from public.usage_api_events
  where user_id = p_user_id and request_id = p_request_id for update;
  if not found then raise exception 'usage reservation not found'; end if;
  if v_event.status = 'released' then return jsonb_build_object('status', 'released'); end if;
  if v_event.status <> 'reserved' then raise exception 'only unsubmitted reservations can be released'; end if;

  update public.usage_api_weekly set
    api_credit_reserved = greatest(api_credit_reserved - v_event.reserved_credits, 0),
    updated_at = now()
  where user_id = v_event.user_id and period_start = v_event.period_start and week_index = v_event.week_index;
  update public.usage_api_events set status = 'released', updated_at = now() where id = v_event.id;
  return jsonb_build_object('status', 'released');
end;
$$;

create or replace function public.klui_reconcile_api_usage() returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.usage_api_events%rowtype;
  v_released integer := 0;
  v_estimated integer := 0;
begin
  if not pg_try_advisory_xact_lock(1249608785) then
    return jsonb_build_object('leader', false, 'released', 0, 'estimated', 0);
  end if;

  for v_event in
    select * from public.usage_api_events
    where status = 'reserved' and updated_at < now() - interval '5 minutes'
    for update skip locked
  loop
    perform public.klui_release_api_usage(v_event.user_id, v_event.request_id);
    v_released := v_released + 1;
  end loop;

  for v_event in
    select * from public.usage_api_events
    where status = 'submitted' and updated_at < now() - interval '12 minutes'
    for update skip locked
  loop
    perform public.klui_settle_api_usage(
      v_event.user_id, v_event.request_id, v_event.reserved_credits,
      'reservation_ceiling', v_event.usage, v_event.generation_id, true
    );
    v_estimated := v_estimated + 1;
  end loop;

  return jsonb_build_object('leader', true, 'released', v_released, 'estimated', v_estimated);
end;
$$;

revoke execute on function public.klui_check_api_budget(uuid, text, date, date, date, date, integer, numeric) from public, anon, authenticated;
revoke execute on function public.klui_record_api_usage(uuid, uuid, text, text, text, text, date, date, date, date, integer, numeric, numeric, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.klui_reserve_api_usage(uuid, uuid, uuid, text, text, text, text, text, text, date, date, date, date, integer, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.klui_mark_api_usage_submitted(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.klui_settle_api_usage(uuid, uuid, numeric, text, jsonb, text, boolean) from public, anon, authenticated;
revoke execute on function public.klui_release_api_usage(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.klui_reconcile_api_usage() from public, anon, authenticated;

grant execute on function public.klui_reserve_api_usage(uuid, uuid, uuid, text, text, text, text, text, text, date, date, date, date, integer, numeric, numeric) to service_role;
grant execute on function public.klui_mark_api_usage_submitted(uuid, uuid, text) to service_role;
grant execute on function public.klui_settle_api_usage(uuid, uuid, numeric, text, jsonb, text, boolean) to service_role;
grant execute on function public.klui_release_api_usage(uuid, uuid) to service_role;
grant execute on function public.klui_reconcile_api_usage() to service_role;
-- Existing website routes still use these two RPCs until the observe/enforce
-- cutover is complete. Revoking PUBLIC must not also revoke the server itself.
grant execute on function public.klui_check_api_budget(uuid, text, date, date, date, date, integer, numeric) to service_role;
grant execute on function public.klui_record_api_usage(uuid, uuid, text, text, text, text, date, date, date, date, integer, numeric, numeric, text, jsonb, text) to service_role;
