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
