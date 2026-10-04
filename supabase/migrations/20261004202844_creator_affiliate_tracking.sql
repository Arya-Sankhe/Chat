-- Creator membership uses existing Klui login accounts. Only the backend can access
-- these tables; creator-facing reports never return referred customer identities.
create table public.affiliate_creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete set null,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.affiliate_coupons (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.affiliate_creators(id),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  percent_off integer check (percent_off between 1 and 100),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  check (not enabled or percent_off is not null)
);
create index affiliate_coupons_creator_idx on public.affiliate_coupons(creator_id);
alter table public.mamo_payment_links add column affiliate_coupon_id uuid references public.affiliate_coupons(id);
create index mamo_payment_links_affiliate_coupon_idx on public.mamo_payment_links(affiliate_coupon_id);
alter table public.mamo_payment_links add constraint mamo_affiliate_coupon_check
  check (affiliate_coupon_id is null or coupon_code is not null);

-- One referral per customer. Trial and first paid plan remain separate; renewals
-- cannot inflate either count. Account deletion retains anonymous historical totals.
create table public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete set null,
  coupon_id uuid not null references public.affiliate_coupons(id),
  trial_started_at timestamptz,
  trial_plan_id text references public.plans(id),
  paid_at timestamptz,
  paid_plan_id text references public.plans(id),
  first_payment_id text unique,
  refunded_at timestamptz,
  check ((trial_started_at is null) = (trial_plan_id is null)),
  check ((paid_at is null) = (paid_plan_id is null)),
  check ((paid_at is null) = (first_payment_id is null)),
  check (trial_started_at is not null or paid_at is not null),
  check (refunded_at is null or paid_at is not null)
);
create index affiliate_referrals_coupon_idx on public.affiliate_referrals(coupon_id);
create index affiliate_referrals_trial_plan_idx on public.affiliate_referrals(trial_plan_id);
create index affiliate_referrals_paid_plan_idx on public.affiliate_referrals(paid_plan_id);
alter table public.affiliate_creators enable row level security;
alter table public.affiliate_coupons enable row level security;
alter table public.affiliate_referrals enable row level security;
revoke all on public.affiliate_creators, public.affiliate_coupons, public.affiliate_referrals from public, anon, authenticated;
grant all on public.affiliate_creators, public.affiliate_coupons, public.affiliate_referrals to service_role;

-- Discounts may change; the owner and spelling of an existing code may not.
create function public.klui_keep_affiliate_coupon_identity() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.creator_id is distinct from old.creator_id or new.code is distinct from old.code then
    raise exception 'Create a new coupon instead of reassigning an existing code';
  end if;
  return new;
end;
$$;
create trigger affiliate_coupon_identity before update on public.affiliate_coupons
for each row execute function public.klui_keep_affiliate_coupon_identity();
revoke all on function public.klui_keep_affiliate_coupon_identity() from public, anon, authenticated;
grant execute on function public.klui_keep_affiliate_coupon_identity() to service_role;

-- Called inside the billing transaction, only with Mamo-verified payment state.
create function public.klui_record_affiliate_referral(p_subscription jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  link public.mamo_payment_links;
  is_trial boolean;
  is_paid boolean;
  is_refund boolean;
begin
  select l.* into link from public.mamo_payment_links l
    join public.affiliate_coupons c on c.id = l.affiliate_coupon_id
    join public.affiliate_creators a on a.id = c.creator_id
    where l.id = p_subscription->'raw'->>'payment_link_id'
      and l.user_id = (p_subscription->>'user_id')::uuid
      and l.plan_id = p_subscription->>'plan_id' and l.coupon_code = c.code
      and a.user_id is distinct from l.user_id;
  if not found then return; end if;
  is_trial := p_subscription->>'status' = 'trialing'
    and p_subscription->'raw'->>'status' = 'card_verified' and link.initial_amount_aed = 0;
  is_paid := p_subscription->>'status' = 'active'
    and p_subscription->'raw'->>'status' in ('captured','succeeded')
    and (p_subscription->'raw'->>'amount')::numeric > 0;
  is_refund := p_subscription->>'status' = 'canceled'
    and (p_subscription->'raw'->>'amount')::numeric > 0
    and (p_subscription->'raw'->>'refund_amount')::numeric >= (p_subscription->'raw'->>'amount')::numeric;
  if not coalesce(is_trial or is_paid or is_refund, false) then return; end if;
  insert into public.affiliate_referrals as r (
    user_id, coupon_id, trial_started_at, trial_plan_id, paid_at, paid_plan_id, first_payment_id, refunded_at
  ) values (
    link.user_id, link.affiliate_coupon_id,
    case when is_trial then now() end, case when is_trial then link.plan_id end,
    case when is_paid or is_refund then now() end, case when is_paid or is_refund then link.plan_id end,
    case when is_paid or is_refund then p_subscription->'raw'->>'id' end,
    case when is_refund then now() end
  ) on conflict (user_id) do update set
    trial_started_at = coalesce(r.trial_started_at, excluded.trial_started_at),
    trial_plan_id = coalesce(r.trial_plan_id, excluded.trial_plan_id),
    paid_at = coalesce(r.paid_at, excluded.paid_at),
    paid_plan_id = coalesce(r.paid_plan_id, excluded.paid_plan_id),
    first_payment_id = coalesce(r.first_payment_id, excluded.first_payment_id),
    refunded_at = case when is_refund and (r.first_payment_id is null or r.first_payment_id = excluded.first_payment_id)
      then coalesce(r.refunded_at, now()) else r.refunded_at end;
end;
$$;
revoke all on function public.klui_record_affiliate_referral(jsonb) from public, anon, authenticated;
grant execute on function public.klui_record_affiliate_referral(jsonb) to service_role;

-- Service-only aggregate reports, scoped to the verified creator ID by the API.
create function public.klui_affiliate_report(p_creator_id uuid default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(report order by created_at, id), '[]'::jsonb) from (
    select a.created_at, a.id, jsonb_build_object(
      'creatorId', a.id, 'displayName', a.display_name,
      'coupons', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'code', c.code, 'percentOff', c.percent_off, 'enabled', c.enabled
      ) order by c.created_at, c.id) from public.affiliate_coupons c where c.creator_id = a.id), '[]'::jsonb),
      'totalUsers', stats.total_users, 'trialUsers', stats.trial_users,
      'unpaidTrialUsers', stats.unpaid_trial_users, 'convertedTrialUsers', stats.converted_trial_users,
      'paidUsers', stats.paid_users, 'refundedUsers', stats.refunded_users,
      'byPlan', coalesce((select jsonb_agg(jsonb_build_object(
        'planId', p.id, 'trialUsers', (select count(*) from public.affiliate_referrals r
          join public.affiliate_coupons c on c.id = r.coupon_id where c.creator_id = a.id and r.trial_plan_id = p.id),
        'paidUsers', (select count(*) from public.affiliate_referrals r
          join public.affiliate_coupons c on c.id = r.coupon_id where c.creator_id = a.id and r.paid_plan_id = p.id and r.refunded_at is null),
        'refundedUsers', (select count(*) from public.affiliate_referrals r
          join public.affiliate_coupons c on c.id = r.coupon_id where c.creator_id = a.id and r.paid_plan_id = p.id and r.refunded_at is not null)
      ) order by p.id) from public.plans p), '[]'::jsonb)
    ) as report
    from (select * from public.affiliate_creators where p_creator_id is null or id = p_creator_id
      order by created_at, id limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) a
    cross join lateral (select count(*) as total_users,
      count(*) filter (where r.trial_started_at is not null) as trial_users,
      count(*) filter (where r.trial_started_at is not null and r.paid_at is null) as unpaid_trial_users,
      count(*) filter (where r.trial_started_at is not null and r.paid_at is not null and r.refunded_at is null) as converted_trial_users,
      count(*) filter (where r.paid_at is not null and r.refunded_at is null) as paid_users,
      count(*) filter (where r.refunded_at is not null) as refunded_users
      from public.affiliate_referrals r join public.affiliate_coupons c on c.id = r.coupon_id
      where c.creator_id = a.id) stats
  ) reports;
$$;
revoke all on function public.klui_affiliate_report(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.klui_affiliate_report(uuid,integer,integer) to service_role;

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
    or incoming.status not in ('active','trialing','past_due','canceled') then
    raise exception 'Invalid Mamo subscription event';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mamo:' || incoming.user_id::text, 0));
  -- Refunds of the first paid charge still adjust referral totals after a later renewal.
  if incoming.status = 'canceled' then perform public.klui_record_affiliate_referral(p_subscription); end if;
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
  elsif incoming.status not in ('active','trialing') then
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
  perform public.klui_record_affiliate_referral(to_jsonb(incoming));
  return to_jsonb(incoming);
end;
$$;
revoke all on function public.klui_apply_mamo_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.klui_apply_mamo_subscription(jsonb) to service_role;

notify pgrst, 'reload schema';
