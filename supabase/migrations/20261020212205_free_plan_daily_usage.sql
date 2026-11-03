-- Free plan allowances: chat messages and image uploads per account per Dubai day.
-- Service-only; the server checks and counts each use in one statement.
create table if not exists public.free_daily_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_day date not null,
  messages integer not null default 0 check (messages >= 0),
  images integer not null default 0 check (images >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_day)
);
alter table public.free_daily_usage enable row level security;
revoke all on public.free_daily_usage from public, anon, authenticated;
grant all on public.free_daily_usage to service_role;

create or replace function public.klui_consume_free_usage(
  p_user_id uuid,
  p_day date,
  p_kind text,
  p_amount integer,
  p_limit integer
)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_used integer;
begin
  if p_kind not in ('messages', 'images') then
    raise exception 'unknown free usage kind %', p_kind;
  end if;
  if p_amount < 1 or p_limit < 0 then
    raise exception 'invalid free usage amount';
  end if;
  -- Only the current day is ever read, so older rows go as the account uses the plan.
  delete from public.free_daily_usage where user_id = p_user_id and usage_day < p_day - 7;
  insert into public.free_daily_usage (user_id, usage_day) values (p_user_id, p_day)
    on conflict (user_id, usage_day) do nothing;
  if p_kind = 'messages' then
    update public.free_daily_usage set messages = messages + p_amount, updated_at = now()
      where user_id = p_user_id and usage_day = p_day and messages + p_amount <= p_limit
      returning messages into v_used;
  else
    update public.free_daily_usage set images = images + p_amount, updated_at = now()
      where user_id = p_user_id and usage_day = p_day and images + p_amount <= p_limit
      returning images into v_used;
  end if;
  if v_used is not null then
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_limit);
  end if;
  select case when p_kind = 'messages' then messages else images end into v_used
    from public.free_daily_usage where user_id = p_user_id and usage_day = p_day;
  return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', p_limit);
end;
$$;
revoke all on function public.klui_consume_free_usage(uuid, date, text, integer, integer) from public, anon, authenticated;
grant execute on function public.klui_consume_free_usage(uuid, date, text, integer, integer) to service_role;
notify pgrst, 'reload schema';
