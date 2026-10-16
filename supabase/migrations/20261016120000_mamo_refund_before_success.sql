-- A refund that arrives before its payment's success was recorded used to leave nothing
-- behind, so the late success could still grant access. Record the refund as a canceled row:
-- the same payment can never revive it, and only a newer payment replaces it. The same holds
-- when an older payment owns the row: a refund of a newer payment is recorded, not dropped.
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
      or (incoming.status = 'canceled' and not same_payment
        and incoming.raw->>'created_date' <= coalesce(prior.raw->>'created_date',''))
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
  elsif incoming.status not in ('active','trialing','canceled') then
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
