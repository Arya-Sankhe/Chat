-- A coupon checkout opened before the user subscribed must not redeem afterwards.
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
  -- Re-check checkout eligibility: the user may have subscribed since opening this checkout.
  if exists (select 1 from public.subscriptions s where s.user_id = link.user_id
    and coalesce(s.raw->>'payment_link_id', '') <> link.id) then
    return jsonb_build_object('payment_link_id', link.id, 'status', 'ineligible', 'conflict', true);
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

notify pgrst, 'reload schema';
