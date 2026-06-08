create table if not exists public.usage_api_weekly (
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  week_index integer not null check (week_index between 1 and 4),
  week_start date not null,
  week_end date not null,
  plan_id text not null,
  api_credit_limit numeric(18,8) not null default 0,
  api_credit_used numeric(18,8) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start, week_index)
);

create table if not exists public.usage_api_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  plan_id text,
  provider text,
  model text,
  generation_id text,
  period_start date not null,
  period_end date not null,
  week_index integer not null check (week_index between 1 and 4),
  week_start date not null,
  week_end date not null,
  cost_credits numeric(18,8) not null default 0,
  cost_source text not null default 'unknown',
  usage jsonb not null default '{}'::jsonb,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

alter table public.usage_api_weekly enable row level security;
alter table public.usage_api_events enable row level security;

drop policy if exists "usage api weekly read own" on public.usage_api_weekly;
create policy "usage api weekly read own" on public.usage_api_weekly
  for select using (auth.uid() = user_id);

grant select on public.usage_api_weekly to authenticated;
grant all on public.usage_api_weekly, public.usage_api_events to service_role;

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
set search_path = public
as $$
declare
  v_row public.usage_api_weekly%rowtype;
begin
  insert into public.usage_api_weekly (
    user_id, period_start, period_end, week_index, week_start, week_end, plan_id, api_credit_limit
  )
  values (
    p_user_id, p_period_start, p_period_end, p_week_index, p_week_start, p_week_end, p_plan_id, greatest(coalesce(p_weekly_credit_limit, 0), 0)
  )
  on conflict (user_id, period_start, week_index) do update
  set
    period_end = excluded.period_end,
    week_start = excluded.week_start,
    week_end = excluded.week_end,
    plan_id = excluded.plan_id,
    api_credit_limit = excluded.api_credit_limit,
    updated_at = now();

  select * into v_row
  from public.usage_api_weekly
  where user_id = p_user_id
    and period_start = p_period_start
    and week_index = p_week_index
  for update;

  if v_row.api_credit_limit <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'API usage is not enabled for your plan.');
  end if;

  if v_row.api_credit_used >= v_row.api_credit_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Weekly API limit reached.',
      'api_credit_used', v_row.api_credit_used,
      'api_credit_limit', v_row.api_credit_limit,
      'week_index', v_row.week_index,
      'week_start', v_row.week_start,
      'week_end', v_row.week_end
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'api_credit_used', v_row.api_credit_used,
    'api_credit_limit', v_row.api_credit_limit,
    'week_index', v_row.week_index,
    'week_start', v_row.week_start,
    'week_end', v_row.week_end
  );
end;
$$;

create or replace function public.klui_record_api_usage(
  p_user_id uuid,
  p_subscription_id uuid,
  p_plan_id text,
  p_model text,
  p_provider text,
  p_generation_id text,
  p_period_start date,
  p_period_end date,
  p_week_start date,
  p_week_end date,
  p_week_index integer,
  p_weekly_credit_limit numeric,
  p_cost_credits numeric,
  p_cost_source text,
  p_usage jsonb,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit numeric := greatest(coalesce(p_weekly_credit_limit, 0), 0);
  v_cost numeric := greatest(coalesce(p_cost_credits, 0), 0);
  v_row public.usage_api_weekly%rowtype;
begin
  insert into public.usage_api_weekly (
    user_id, period_start, period_end, week_index, week_start, week_end, plan_id, api_credit_limit, api_credit_used
  )
  values (
    p_user_id, p_period_start, p_period_end, p_week_index, p_week_start, p_week_end, p_plan_id, v_limit, 0
  )
  on conflict (user_id, period_start, week_index) do update
  set
    period_end = excluded.period_end,
    week_start = excluded.week_start,
    week_end = excluded.week_end,
    plan_id = excluded.plan_id,
    api_credit_limit = excluded.api_credit_limit,
    updated_at = now();

  update public.usage_api_weekly
  set
    plan_id = p_plan_id,
    api_credit_used = api_credit_used + v_cost,
    updated_at = now()
  where user_id = p_user_id
    and period_start = p_period_start
    and week_index = p_week_index
  returning * into v_row;

  insert into public.usage_api_events (
    user_id, subscription_id, plan_id, provider, model, generation_id,
    period_start, period_end, week_index, week_start, week_end,
    cost_credits, cost_source, usage, status
  )
  values (
    p_user_id, p_subscription_id, p_plan_id, p_provider, p_model, p_generation_id,
    v_row.period_start, v_row.period_end, v_row.week_index, v_row.week_start, v_row.week_end,
    v_cost, coalesce(p_cost_source, 'unknown'), coalesce(p_usage, '{}'::jsonb), coalesce(p_status, 'completed')
  );

  return jsonb_build_object(
    'allowed', true,
    'api_credit_used', v_row.api_credit_used,
    'api_credit_limit', v_row.api_credit_limit,
    'cost_credits', v_cost,
    'cost_source', coalesce(p_cost_source, 'unknown'),
    'week_index', v_row.week_index
  );
end;
$$;

grant execute on function public.klui_check_api_budget(uuid, text, date, date, date, date, integer, numeric) to service_role;
grant execute on function public.klui_record_api_usage(uuid, uuid, text, text, text, text, date, date, date, date, integer, numeric, numeric, text, jsonb, text) to service_role;
