-- Immutable checkout ownership; only the server can write or read mappings.
create table if not exists public.mamo_payment_links (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null references public.plans(id),
  amount_aed numeric(10,2) not null check (amount_aed > 0),
  subscription_id text,
  created_at timestamptz not null default now()
);
alter table public.mamo_payment_links enable row level security;
revoke all on public.mamo_payment_links from public, anon, authenticated;
grant all on public.mamo_payment_links to service_role;
create index if not exists mamo_payment_links_user_idx on public.mamo_payment_links(user_id);

-- Serialize callbacks and cancellation for each user, including the first payment.
create or replace function public.klui_apply_mamo_subscription(p_subscription jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  incoming public.subscriptions;
  prior public.subscriptions;
  same_payment boolean;
begin
  incoming := jsonb_populate_record(null::public.subscriptions, p_subscription);
  if incoming.provider <> 'mamo' or incoming.provider_subscription_id <> 'mamo:' || incoming.user_id::text
    or coalesce(incoming.raw->>'id', '') = ''
    or coalesce(incoming.raw->>'created_date', '') !~ '^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$'
    or incoming.status not in ('active','past_due','canceled') then
    raise exception 'Invalid Mamo subscription event';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mamo:' || incoming.user_id::text, 0));
  select * into prior from public.subscriptions
    where provider_subscription_id = incoming.provider_subscription_id for update;
  if found then
    same_payment := prior.raw->>'id' = incoming.raw->>'id';
    -- Refunds for old payments cannot revoke a newer paid period.
    if coalesce(incoming.raw->>'created_date','') < coalesce(prior.raw->>'created_date','')
      or (incoming.status = 'canceled' and not same_payment)
      or (same_payment and prior.status = 'canceled')
      or (same_payment and incoming.status <> 'canceled') then
      return to_jsonb(prior);
    end if;
    if incoming.status = 'past_due' then
      if prior.status not in ('active','past_due','trialing') or prior.current_period_end is null then
        return to_jsonb(prior);
      end if;
      incoming.current_period_end := prior.current_period_end;
    end if;
    -- Renewals from the same checkout never undo the user's cancellation.
    if incoming.raw->>'payment_link_id' = prior.raw->>'payment_link_id' then
      incoming.cancel_at_period_end := prior.cancel_at_period_end;
    end if;
  elsif incoming.status <> 'active' then
    return null;
  end if;
  insert into public.subscriptions (
    user_id, provider, provider_subscription_id, provider_customer_id,
    provider_price_id, plan_id, status, cancel_at_period_end, current_period_end, raw, updated_at
  ) values (
    incoming.user_id, 'mamo', incoming.provider_subscription_id, incoming.provider_customer_id,
    incoming.provider_price_id, incoming.plan_id, incoming.status, incoming.cancel_at_period_end,
    incoming.current_period_end, incoming.raw, incoming.updated_at
  ) on conflict (provider_subscription_id) do update set
    provider_customer_id = excluded.provider_customer_id,
    provider_price_id = excluded.provider_price_id, plan_id = excluded.plan_id,
    status = excluded.status, cancel_at_period_end = excluded.cancel_at_period_end,
    current_period_end = excluded.current_period_end, raw = excluded.raw, updated_at = excluded.updated_at
  returning * into incoming;
  return to_jsonb(incoming);
end;
$$;
revoke all on function public.klui_apply_mamo_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.klui_apply_mamo_subscription(jsonb) to service_role;

create or replace function public.klui_cancel_mamo_subscription(p_user_id uuid, p_payment_link_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare result public.subscriptions;
begin
  perform pg_advisory_xact_lock(hashtextextended('mamo:' || p_user_id::text, 0));
  update public.subscriptions set cancel_at_period_end = true, updated_at = now()
    where provider_subscription_id = 'mamo:' || p_user_id::text
      and raw->>'payment_link_id' = p_payment_link_id
    returning * into result;
  if not found then raise exception 'Subscription changed; refresh and retry cancellation'; end if;
  return to_jsonb(result);
end;
$$;
revoke all on function public.klui_cancel_mamo_subscription(uuid,text) from public, anon, authenticated;
grant execute on function public.klui_cancel_mamo_subscription(uuid,text) to service_role;

notify pgrst, 'reload schema';
