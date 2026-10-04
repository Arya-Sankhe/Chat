-- First-month coupons: the checkout saves the card for a full-price subscription that starts
-- next month; the first month is free or charged once to the saved card at the discount.
alter table public.mamo_payment_links
  add column if not exists coupon_code text,
  add column if not exists initial_amount_aed numeric(10,2) check (initial_amount_aed >= 0),
  add column if not exists first_renewal_at timestamptz;
alter table public.mamo_payment_links drop constraint if exists mamo_payment_links_coupon_check;
alter table public.mamo_payment_links add constraint mamo_payment_links_coupon_check check (
  (coupon_code is null and initial_amount_aed is null and first_renewal_at is null)
  or (coupon_code is not null and initial_amount_aed < amount_aed and first_renewal_at is not null)
);

-- One redemption per user. A failed initial charge releases it so the user can retry.
create table if not exists public.mamo_coupon_redemptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  coupon_code text not null,
  payment_link_id text not null unique references public.mamo_payment_links(id) on delete cascade,
  card_id text,
  verification_payment_id text,
  initial_payment_id text,
  status text not null check (status in ('claimed', 'charging', 'active', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mamo_coupon_redemptions enable row level security;
revoke all on public.mamo_coupon_redemptions from public, anon, authenticated;
grant all on public.mamo_coupon_redemptions to service_role;

-- Returns the user's redemption; `conflict` is true when another checkout already holds it.
create or replace function public.klui_claim_mamo_coupon(
  p_payment_link_id text, p_card_id text, p_verification_payment_id text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  link public.mamo_payment_links;
  claim public.mamo_coupon_redemptions;
begin
  select * into link from public.mamo_payment_links where id = p_payment_link_id;
  if not found or link.coupon_code is null then raise exception 'Not a coupon checkout'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mamo:' || link.user_id::text, 0));
  select * into claim from public.mamo_coupon_redemptions where user_id = link.user_id for update;
  if found and claim.payment_link_id <> link.id and claim.status <> 'failed' then
    return to_jsonb(claim) || '{"conflict":true}';
  end if;
  if found and claim.payment_link_id = link.id then
    return to_jsonb(claim) || '{"conflict":false}';
  end if;
  insert into public.mamo_coupon_redemptions as r (
    user_id, coupon_code, payment_link_id, card_id, verification_payment_id, status
  ) values (link.user_id, link.coupon_code, link.id, p_card_id, p_verification_payment_id, 'claimed')
  on conflict (user_id) do update set coupon_code = excluded.coupon_code,
    payment_link_id = excluded.payment_link_id, card_id = excluded.card_id,
    verification_payment_id = excluded.verification_payment_id, initial_payment_id = null,
    status = 'claimed', created_at = now(), updated_at = now()
  returning * into claim;
  return to_jsonb(claim) || '{"conflict":false}';
end;
$$;
revoke all on function public.klui_claim_mamo_coupon(text,text,text) from public, anon, authenticated;
grant execute on function public.klui_claim_mamo_coupon(text,text,text) to service_role;

-- Compare-and-set so only one callback ever starts the discounted saved-card charge.
create or replace function public.klui_advance_mamo_coupon(
  p_payment_link_id text, p_from text[], p_to text, p_initial_payment_id text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare claim public.mamo_coupon_redemptions;
begin
  update public.mamo_coupon_redemptions
    set status = p_to, initial_payment_id = coalesce(p_initial_payment_id, initial_payment_id), updated_at = now()
    where payment_link_id = p_payment_link_id and status = any(p_from)
    returning * into claim;
  if not found then return null; end if;
  return to_jsonb(claim);
end;
$$;
revoke all on function public.klui_advance_mamo_coupon(text,text[],text,text) from public, anon, authenticated;
grant execute on function public.klui_advance_mamo_coupon(text,text[],text,text) to service_role;

-- A free first month is a 'trialing' period that ends at the first full-price renewal.
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
  return to_jsonb(incoming);
end;
$$;
revoke all on function public.klui_apply_mamo_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.klui_apply_mamo_subscription(jsonb) to service_role;

notify pgrst, 'reload schema';
