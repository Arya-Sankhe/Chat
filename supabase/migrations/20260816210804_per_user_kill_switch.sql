-- A reservation-ceiling violation now blocks only the offending user instead
-- of all funded inference. The server writes app_settings key
-- 'funded_inference_disabled:<user_id>'; the bare 'funded_inference_disabled'
-- key remains a manual global ops kill switch. Both keys deny with
-- 'usage_metering_disabled'.

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
    where key in ('funded_inference_disabled', 'funded_inference_disabled:' || p_user_id::text)
      and value->>'disabled' = 'true'
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
  if v_row.api_credit_used >= v_row.api_credit_limit then
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

revoke execute on function public.klui_check_api_budget(uuid, text, date, date, date, date, integer, numeric) from public, anon, authenticated;
revoke execute on function public.klui_reserve_api_usage(uuid, uuid, uuid, text, text, text, text, text, text, date, date, date, date, integer, numeric, numeric) from public, anon, authenticated;
grant execute on function public.klui_check_api_budget(uuid, text, date, date, date, date, integer, numeric) to service_role;
grant execute on function public.klui_reserve_api_usage(uuid, uuid, uuid, text, text, text, text, text, text, date, date, date, date, integer, numeric, numeric) to service_role;
