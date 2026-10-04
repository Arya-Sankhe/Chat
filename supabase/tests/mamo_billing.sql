\set ON_ERROR_STOP on
-- Run against the isolated local Supabase database after applying schema.sql.
-- Every fixture is rolled back; this never calls Mamo or charges a card.
begin;
insert into auth.users (id) values ('11111111-1111-4111-8111-000000009999');
insert into public.profiles (id) values ('11111111-1111-4111-8111-000000009999');

do $$
declare
  event jsonb := '{"user_id":"11111111-1111-4111-8111-000000009999","provider":"mamo",
    "provider_subscription_id":"mamo:11111111-1111-4111-8111-000000009999","plan_id":"lite",
    "status":"active","cancel_at_period_end":false,"current_period_end":"2099-11-04T00:00:00Z",
    "updated_at":"2099-10-04T00:00:00Z","raw":{"id":"PAY-1","created_date":"2099-10-04-00-00-00",
    "payment_link_id":"LINK-1"}}';
  result jsonb;
  renewal jsonb;
begin
  if has_function_privilege('authenticated','public.klui_apply_mamo_subscription(jsonb)','execute')
    or has_function_privilege('anon','public.klui_cancel_mamo_subscription(uuid,text)','execute')
    or has_table_privilege('authenticated','public.mamo_payment_links','insert') then
    raise exception 'Billing privileges exposed to a client';
  end if;
  result := public.klui_apply_mamo_subscription(event);
  assert result->>'status' = 'active', 'initial payment';
  result := public.klui_cancel_mamo_subscription((event->>'user_id')::uuid, 'LINK-1');
  assert (result->>'cancel_at_period_end')::boolean, 'cancel';
  result := public.klui_apply_mamo_subscription(event);
  assert (result->>'cancel_at_period_end')::boolean, 'duplicate undid cancellation';

  renewal := jsonb_set(jsonb_set(event,'{raw,id}','"PAY-2"'),'{raw,created_date}','"2099-11-04-00-00-00"');
  renewal := jsonb_set(renewal,'{current_period_end}','"2099-12-04T00:00:00Z"');
  result := public.klui_apply_mamo_subscription(renewal);
  assert result->>'current_period_end' = '2099-12-04T00:00:00+00:00', 'renewal did not extend';
  assert (result->>'cancel_at_period_end')::boolean, 'renewal undid cancellation';
  result := public.klui_apply_mamo_subscription(jsonb_set(event,'{status}','"canceled"'));
  assert result->>'status' = 'active', 'old refund revoked new payment';
  result := public.klui_apply_mamo_subscription(jsonb_set(renewal,'{status}','"canceled"'));
  assert result->>'status' = 'canceled', 'full refund';
  result := public.klui_apply_mamo_subscription(renewal);
  assert result->>'status' = 'canceled', 'replay revived refund';

  renewal := jsonb_set(jsonb_set(renewal,'{raw,id}','"PAY-3"'),'{raw,created_date}','"2099-12-04-00-00-00"');
  result := public.klui_apply_mamo_subscription(jsonb_set(renewal,'{status}','"past_due"'));
  assert result->>'status' = 'canceled', 'failure revived refund';
  renewal := jsonb_set(renewal,'{raw,payment_link_id}','"LINK-2"');
  result := public.klui_apply_mamo_subscription(renewal);
  assert result->>'status' = 'active' and not (result->>'cancel_at_period_end')::boolean, 'new checkout';
  renewal := jsonb_set(jsonb_set(renewal,'{raw,id}','"PAY-4"'),'{raw,created_date}','"2100-01-04-00-00-00"');
  renewal := jsonb_set(renewal,'{current_period_end}','"2100-02-04T00:00:00Z"');
  result := public.klui_apply_mamo_subscription(jsonb_set(renewal,'{status}','"past_due"'));
  assert result->>'status' = 'past_due', 'failed renewal state';
  assert result->>'current_period_end' = '2099-12-04T00:00:00+00:00', 'failed renewal extended access';
  assert (select count(*) = 1 from public.subscriptions where user_id = (event->>'user_id')::uuid), 'duplicate rows';
end;
$$;
-- First-month coupons: one redemption per user, one discounted charge, trial periods.
-- Coupons are for a first subscription: start from a user who has never subscribed.
delete from public.subscriptions where user_id = '11111111-1111-4111-8111-000000009999';
insert into public.mamo_payment_links (id, user_id, plan_id, amount_aed, subscription_id, coupon_code, initial_amount_aed, first_renewal_at)
values ('LINK-C1','11111111-1111-4111-8111-000000009999','lite',10,'SUB-C1','FIRST50',5,'2099-11-04T20:00:00Z'),
       ('LINK-C2','11111111-1111-4111-8111-000000009999','lite',10,'SUB-C2','FIRSTFREE',0,'2099-11-04T20:00:00Z');
do $$
declare result jsonb;
begin
  if has_function_privilege('authenticated','public.klui_claim_mamo_coupon(text,text,text)','execute')
    or has_function_privilege('anon','public.klui_advance_mamo_coupon(text,text[],text,text)','execute')
    or has_function_privilege('authenticated','public.klui_rearm_mamo_coupon(text,interval)','execute')
    or has_table_privilege('authenticated','public.mamo_coupon_redemptions','select') then
    raise exception 'Coupon privileges exposed to a client';
  end if;
  result := public.klui_claim_mamo_coupon('LINK-C1','CARD-1','PAY-V1');
  assert result->>'status' = 'claimed' and not (result->>'conflict')::boolean, 'first claim';
  result := public.klui_claim_mamo_coupon('LINK-C1','CARD-1','PAY-V1');
  assert result->>'status' = 'claimed' and not (result->>'conflict')::boolean, 'replayed claim';
  assert (public.klui_claim_mamo_coupon('LINK-C2','CARD-2','PAY-V2')->>'conflict')::boolean, 'second coupon redeemed';
  assert public.klui_advance_mamo_coupon('LINK-C1',array['claimed'],'charging') is not null, 'start charge';
  assert public.klui_advance_mamo_coupon('LINK-C1',array['claimed'],'charging') is null, 'charged twice';
  assert public.klui_rearm_mamo_coupon('LINK-C1','5 minutes') is null, 'fresh charge re-armed';
  update public.mamo_coupon_redemptions set updated_at = now() - interval '10 minutes' where payment_link_id = 'LINK-C1';
  assert public.klui_rearm_mamo_coupon('LINK-C1','5 minutes') is not null, 'stale charge not re-armed';
  assert public.klui_rearm_mamo_coupon('LINK-C1','5 minutes') is null, 'stale charge re-armed twice';
  result := public.klui_advance_mamo_coupon('LINK-C1',array['claimed','charging'],'failed','PAY-M1');
  assert result->>'status' = 'failed', 'failed charge';
  result := public.klui_claim_mamo_coupon('LINK-C2','CARD-2','PAY-V2');
  assert not (result->>'conflict')::boolean and result->>'payment_link_id' = 'LINK-C2', 'failed coupon not released';
  -- A coupon checkout opened before the user subscribed elsewhere cannot redeem afterwards.
  begin
    perform public.klui_advance_mamo_coupon('LINK-C2',array['claimed'],'failed');
    insert into public.subscriptions (user_id, provider, provider_subscription_id, plan_id, status, raw)
    values ('11111111-1111-4111-8111-000000009999','mamo','mamo:stale-checkout','lite','active',
      '{"payment_link_id":"LINK-OTHER"}');
    result := public.klui_claim_mamo_coupon('LINK-C1','CARD-1','PAY-V3');
    assert (result->>'conflict')::boolean and result->>'status' = 'ineligible', 'subscribed user redeemed a stale coupon checkout';
    raise exception using errcode = 'P0042';
  exception when sqlstate 'P0042' then null;
  end;
  begin
    insert into public.mamo_payment_links (id, user_id, plan_id, amount_aed, coupon_code, initial_amount_aed, first_renewal_at)
    values ('LINK-BAD','11111111-1111-4111-8111-000000009999','lite',10,'FIRST50',10,now());
    raise exception 'discount not below renewal price accepted';
  exception when check_violation then null;
  end;
end;
$$;

do $$
declare
  trial jsonb := '{"user_id":"11111111-1111-4111-8111-000000009999","provider":"mamo",
    "provider_subscription_id":"mamo:11111111-1111-4111-8111-000000009999","plan_id":"lite",
    "status":"trialing","cancel_at_period_end":false,"current_period_end":"2099-11-04T20:00:00Z",
    "updated_at":"2099-10-04T00:00:00Z","raw":{"id":"PAY-V2","created_date":"2100-02-04-00-00-00",
    "payment_link_id":"LINK-C2"}}';
  result jsonb;
begin
  delete from public.subscriptions where user_id = '11111111-1111-4111-8111-000000009999';
  result := public.klui_apply_mamo_subscription(trial);
  assert result->>'status' = 'trialing', 'trial start';
  result := public.klui_cancel_mamo_subscription('11111111-1111-4111-8111-000000009999','LINK-C2');
  assert (result->>'cancel_at_period_end')::boolean, 'trial cancel';
  result := public.klui_apply_mamo_subscription(trial);
  assert (result->>'cancel_at_period_end')::boolean, 'replay undid trial cancel';
  trial := jsonb_set(jsonb_set(jsonb_set(trial,'{status}','"active"'),'{raw,id}','"PAY-R1"'),'{raw,created_date}','"2100-03-04-00-00-00"');
  result := public.klui_apply_mamo_subscription(trial);
  assert result->>'status' = 'active', 'first full-price renewal';
end;
$$;
rollback;
