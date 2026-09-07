-- Admission and the usage bar must use the same settled-cost balance.
-- Holds track in-flight work only; they must neither reject funded requests
-- nor become charges when provider usage is unavailable.
-- ponytail: in-flight requests can exceed the weekly cap; new calls stop once settled usage reaches it.

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
    where key in ('funded_inference_disabled', 'funded_inference_disabled:' || p_user_id::text)
      and value->>'disabled' = 'true'
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

  if v_limit <= 0 or v_week.api_credit_used >= v_limit then
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
    'reserved_credits', v_reserve,
    'api_credit_used', v_week.api_credit_used,
    'api_credit_reserved', v_week.api_credit_reserved,
    'api_credit_limit', v_week.api_credit_limit
  );
end;
$$;

revoke execute on function public.klui_reserve_api_usage(uuid, uuid, uuid, text, text, text, text, text, text, date, date, date, date, integer, numeric, numeric) from public, anon, authenticated;
grant execute on function public.klui_reserve_api_usage(uuid, uuid, uuid, text, text, text, text, text, text, date, date, date, date, integer, numeric, numeric) to service_role;

-- Reservation is an internal hold. Never write it to api_credit_used.
-- Stale submitted events settle at 0 after the JS reconciler has already
-- tried OpenRouter generation cost. Actual cost may exceed the hold.

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

  update public.usage_api_weekly set
    api_credit_reserved = greatest(api_credit_reserved - v_event.reserved_credits, 0),
    api_credit_used = api_credit_used + v_cost,
    updated_at = now()
  where user_id = v_event.user_id and period_start = v_event.period_start and week_index = v_event.week_index
  returning * into v_week;

  update public.usage_api_events set
    status = case when p_estimated then 'estimated' else 'settled' end,
    cost_credits = v_cost,
    cost_source = coalesce(nullif(p_cost_source, ''), case when p_estimated then 'missing_usage' else 'provider' end),
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
      v_event.user_id, v_event.request_id, 0,
      'missing_usage', v_event.usage, v_event.generation_id, true
    );
    v_estimated := v_estimated + 1;
  end loop;

  return jsonb_build_object('leader', true, 'released', v_released, 'estimated', v_estimated);
end;
$$;

revoke execute on function public.klui_settle_api_usage(uuid, uuid, numeric, text, jsonb, text, boolean) from public, anon, authenticated;
revoke execute on function public.klui_reconcile_api_usage() from public, anon, authenticated;
grant execute on function public.klui_settle_api_usage(uuid, uuid, numeric, text, jsonb, text, boolean) to service_role;
grant execute on function public.klui_reconcile_api_usage() to service_role;
