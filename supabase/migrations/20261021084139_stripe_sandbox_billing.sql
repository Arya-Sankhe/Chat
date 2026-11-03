-- Stripe ownership is bound locally before Checkout; metadata never grants access.
create table public.stripe_customers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  customer_id text not null unique,
  created_at timestamptz not null default now()
);
create table public.stripe_checkouts (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  customer_id text not null references public.stripe_customers(customer_id) on delete cascade,
  session_id text unique,
  subscription_id text unique,
  plan_id text not null references public.plans(id),
  price_id text not null,
  coupon_code text,
  affiliate_coupon_id uuid references public.affiliate_coupons(id),
  account_hashes text[] not null default '{}',
  free_trial boolean not null default false,
  expires_at timestamptz not null,
  completed boolean not null default false,
  paid_through timestamptz,
  blocked_reason text,
  synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index stripe_checkouts_user_idx on public.stripe_checkouts(user_id);
-- Survives account deletion; only irreversible HMACs, no card/customer PII.
create table public.stripe_coupon_ledger (
  kind text not null check (kind in ('account','card')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  checkout_id uuid not null,
  redeemed boolean not null default false,
  expires_at timestamptz not null,
  primary key(kind,key_hash)
);
create index stripe_coupon_ledger_checkout_idx on public.stripe_coupon_ledger(checkout_id);
alter table public.stripe_customers enable row level security;
alter table public.stripe_checkouts enable row level security;
alter table public.stripe_coupon_ledger enable row level security;
revoke all on public.stripe_customers, public.stripe_checkouts, public.stripe_coupon_ledger from public, anon, authenticated;
grant all on public.stripe_customers, public.stripe_checkouts, public.stripe_coupon_ledger to service_role;

create function public.klui_reserve_stripe_checkout(p_checkout jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare c public.stripe_checkouts;
begin
  c := jsonb_populate_record(null::public.stripe_checkouts,p_checkout);
  perform pg_advisory_xact_lock(hashtextextended('mamo-coupon-ledger',0));
  perform pg_advisory_xact_lock(hashtextextended('stripe:'||c.user_id::text,0));
  if not exists(select 1 from public.stripe_customers where user_id=c.user_id and customer_id=c.customer_id)
    or c.expires_at <= now() or c.expires_at > now()+interval '1 hour 5 minutes' then
    raise exception 'Invalid checkout binding';
  end if;
  if exists(select 1 from public.subscriptions where user_id=c.user_id
    and status in ('active','trialing','past_due','incomplete')
    and (current_period_end>now() or not cancel_at_period_end))
    or exists(select 1 from public.stripe_checkouts where user_id=c.user_id and not completed and expires_at>now()) then
    raise exception 'A subscription or checkout is already in progress';
  end if;
  if c.affiliate_coupon_id is not null and not exists(
    select 1 from public.affiliate_coupons ac join public.affiliate_creators a on a.id=ac.creator_id
    where ac.id=c.affiliate_coupon_id and ac.code=c.coupon_code and ac.enabled
      and a.user_id is distinct from c.user_id) then
    raise exception 'Invalid creator coupon binding';
  end if;
  if c.coupon_code is not null then
    if cardinality(c.account_hashes)<2 or exists(select 1 from unnest(c.account_hashes) h where h !~ '^[a-f0-9]{64}$') then
      raise exception 'Verified coupon identity is required';
    end if;
    if exists(select 1 from public.subscriptions where user_id=c.user_id
      and not (provider='ziina' and raw->>'beta_retired'='true'))
      or exists(select 1 from public.mamo_coupon_ledger where kind='account' and key_hash=any(c.account_hashes))
      or exists(select 1 from public.stripe_coupon_ledger where kind='account' and key_hash=any(c.account_hashes)
        and (redeemed or expires_at>now())) then
      raise exception 'This coupon is only for your first Klui subscription';
    end if;
    delete from public.stripe_coupon_ledger where not redeemed and expires_at<=now();
    insert into public.stripe_coupon_ledger(kind,key_hash,checkout_id,expires_at)
      select 'account',h,c.id,c.expires_at from unnest(c.account_hashes) h;
  end if;
  insert into public.stripe_checkouts(id,user_id,customer_id,plan_id,price_id,coupon_code,affiliate_coupon_id,account_hashes,free_trial,expires_at)
    values(c.id,c.user_id,c.customer_id,c.plan_id,c.price_id,c.coupon_code,c.affiliate_coupon_id,c.account_hashes,coalesce(c.free_trial,false),c.expires_at)
    returning * into c;
  return to_jsonb(c);
end; $$;

-- All access, coupon claims and creator totals commit together. A risk block is permanent
-- for this subscription, so duplicate/late success events cannot resurrect it.
create function public.klui_apply_stripe_subscription(
  p_checkout_id uuid,p_subscription_id text,p_status text,p_cancel boolean,p_paid_through timestamptz,
  p_trial_end timestamptz,p_invoice_id text,p_refund_invoice_id text,p_card_hash text,p_blocked_reason text,p_observed_at timestamptz
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.stripe_checkouts; access_end timestamptz; s public.subscriptions; trial boolean; trial_ever boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('mamo-coupon-ledger',0));
  select * into c from public.stripe_checkouts where id=p_checkout_id for update;
  if not found then return null; end if;
  if c.subscription_id is not null and c.subscription_id<>p_subscription_id then raise exception 'Subscription binding mismatch'; end if;
  if c.synced_at>p_observed_at and p_blocked_reason is null then
    select * into s from public.subscriptions where provider_subscription_id=c.subscription_id;
    return to_jsonb(s);
  end if;
  trial := c.free_trial and p_status='trialing' and p_trial_end>now();
  -- Recover trial attribution even if the first observed event is its paid conversion.
  trial_ever := c.free_trial and p_trial_end is not null;
  if c.coupon_code is not null and not c.completed and (trial or p_paid_through is not null) then
    if exists(select 1 from unnest(c.account_hashes) h where not exists(
        select 1 from public.stripe_coupon_ledger l where l.kind='account' and l.key_hash=h and l.checkout_id=c.id))
      or exists(select 1 from public.mamo_coupon_ledger where kind='account' and key_hash=any(c.account_hashes)) then
      c.blocked_reason := 'coupon_identity_conflict';
    elsif trial and (coalesce(p_card_hash,'') !~ '^[a-f0-9]{64}$' or exists(
      select 1 from public.stripe_coupon_ledger where kind='card' and key_hash=p_card_hash and checkout_id<>c.id)) then
      c.blocked_reason := 'trial_card_conflict';
    elsif trial then
      insert into public.stripe_coupon_ledger(kind,key_hash,checkout_id,expires_at,redeemed)
        values('card',p_card_hash,c.id,c.expires_at,true) on conflict do nothing;
    end if;
    if c.blocked_reason is null then
      update public.stripe_coupon_ledger set redeemed=true where checkout_id=c.id;
    end if;
  end if;
  c.blocked_reason := coalesce(c.blocked_reason,p_blocked_reason);
  c.paid_through := greatest(c.paid_through,p_paid_through);
  access_end := case when c.blocked_reason is not null or p_status not in ('active','trialing','past_due') then null
    when trial then p_trial_end else c.paid_through end;
  update public.stripe_checkouts set subscription_id=p_subscription_id,
    completed=completed or trial or p_paid_through is not null,
    paid_through=c.paid_through,blocked_reason=c.blocked_reason,synced_at=greatest(synced_at,p_observed_at)
    where id=c.id;
  insert into public.subscriptions(user_id,provider,provider_subscription_id,provider_customer_id,provider_price_id,
    plan_id,status,cancel_at_period_end,current_period_end,raw,updated_at)
  values(c.user_id,'stripe',p_subscription_id,c.customer_id,c.price_id,c.plan_id,
    case when c.blocked_reason is not null then 'canceled' else p_status end,p_cancel,access_end,
    jsonb_build_object('checkout_id',c.id,'blocked_reason',c.blocked_reason),now())
  on conflict(provider_subscription_id) do update set status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,
    current_period_end=excluded.current_period_end,raw=excluded.raw,
    updated_at=case when exists(select 1 from public.stripe_checkouts newer where newer.user_id=c.user_id and newer.created_at>c.created_at and newer.subscription_id is not null)
      then public.subscriptions.updated_at else excluded.updated_at end
  returning * into s;
  if c.affiliate_coupon_id is not null and (c.blocked_reason is null or c.blocked_reason='full_refund') and (trial_ever or p_invoice_id is not null) then
    insert into public.affiliate_referrals as r(user_id,coupon_id,trial_started_at,trial_plan_id,paid_at,paid_plan_id,first_payment_id)
      values(c.user_id,c.affiliate_coupon_id,case when trial_ever then now() end,case when trial_ever then c.plan_id end,
        case when p_invoice_id is not null then now() end,case when p_invoice_id is not null then c.plan_id end,p_invoice_id)
    on conflict(user_id) do update set trial_started_at=coalesce(r.trial_started_at,excluded.trial_started_at),
      trial_plan_id=coalesce(r.trial_plan_id,excluded.trial_plan_id),paid_at=coalesce(r.paid_at,excluded.paid_at),
      paid_plan_id=coalesce(r.paid_plan_id,excluded.paid_plan_id),first_payment_id=coalesce(r.first_payment_id,excluded.first_payment_id);
  end if;
  if p_blocked_reason='full_refund' then
    update public.affiliate_referrals set refunded_at=coalesce(refunded_at,now()) where user_id=c.user_id and first_payment_id=p_refund_invoice_id;
  end if;
  return to_jsonb(s);
end; $$;
revoke all on function public.klui_reserve_stripe_checkout(jsonb) from public,anon,authenticated;
grant execute on function public.klui_reserve_stripe_checkout(jsonb) to service_role;
revoke all on function public.klui_apply_stripe_subscription(uuid,text,text,boolean,timestamptz,timestamptz,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.klui_apply_stripe_subscription(uuid,text,text,boolean,timestamptz,timestamptz,text,text,text,text,timestamptz) to service_role;
notify pgrst,'reload schema';

create function public.klui_expire_stripe_checkout(p_checkout_id uuid) returns void
language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('mamo-coupon-ledger',0));
  update public.stripe_checkouts set expires_at=now() where id=p_checkout_id and not completed;
  delete from public.stripe_coupon_ledger where checkout_id=p_checkout_id and not redeemed;
end; $$;
revoke all on function public.klui_expire_stripe_checkout(uuid) from public,anon,authenticated;
grant execute on function public.klui_expire_stripe_checkout(uuid) to service_role;
notify pgrst,'reload schema';
