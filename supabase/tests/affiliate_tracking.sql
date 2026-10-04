\set ON_ERROR_STOP on
begin;
insert into auth.users (id) values
('22222222-2222-4222-8222-000000000001'),('22222222-2222-4222-8222-000000000002'),
('22222222-2222-4222-8222-000000000003'),('22222222-2222-4222-8222-000000000004');
insert into public.profiles (id) select id from auth.users where id::text like '22222222-%';
insert into public.affiliate_creators (id,user_id,display_name) values
('33333333-3333-4333-8333-000000000001','22222222-2222-4222-8222-000000000001','Creator A'),
('33333333-3333-4333-8333-000000000002','22222222-2222-4222-8222-000000000002','Creator B');
insert into public.affiliate_coupons (id,creator_id,code,percent_off,enabled) values
('44444444-4444-4444-8444-000000000001','33333333-3333-4333-8333-000000000001','CREATORFREE',100,true),
('44444444-4444-4444-8444-000000000002','33333333-3333-4333-8333-000000000002','CREATOR30',30,true);
insert into public.mamo_payment_links (id,user_id,plan_id,amount_aed,coupon_code,initial_amount_aed,first_renewal_at,affiliate_coupon_id) values
('AFF-FREE','22222222-2222-4222-8222-000000000003','pro',32.19,'CREATORFREE',0,'2099-11-04T20:00:00Z','44444444-4444-4444-8444-000000000001'),
('AFF-PAID','22222222-2222-4222-8222-000000000004','lite',11.46,'CREATOR30',8.35,'2099-11-04T20:00:00Z','44444444-4444-4444-8444-000000000002');
do $$
declare
  trial jsonb := '{"user_id":"22222222-2222-4222-8222-000000000003","provider":"mamo",
    "provider_subscription_id":"mamo:22222222-2222-4222-8222-000000000003","plan_id":"pro","status":"trialing",
    "cancel_at_period_end":false,"current_period_end":"2099-11-04T20:00:00Z","updated_at":"2099-10-04T00:00:00Z",
    "raw":{"id":"AFF-VERIFY","status":"card_verified","amount":32.19,"created_date":"2099-10-04-00-00-00","payment_link_id":"AFF-FREE"}}';
  paid jsonb;
  report jsonb;
  renewal jsonb;
begin
  for report in select jsonb_build_object('table', t) from unnest(array['affiliate_creators','affiliate_coupons','affiliate_referrals']) t loop
    assert not has_table_privilege('anon', 'public.' || (report->>'table'), 'select,insert,update,delete'), 'anon can access affiliate data';
    assert not has_table_privilege('authenticated', 'public.' || (report->>'table'), 'select,insert,update,delete'), 'client can access affiliate data';
    assert (select relrowsecurity from pg_class where oid = ('public.' || (report->>'table'))::regclass), 'RLS not enabled';
  end loop;
  assert not has_function_privilege('authenticated','public.klui_affiliate_report(uuid,integer,integer)','execute'), 'report RPC public';
  assert not has_function_privilege('anon','public.klui_record_affiliate_referral(jsonb)','execute'), 'attribution RPC public';
  perform public.klui_apply_mamo_subscription(trial);
  perform public.klui_apply_mamo_subscription(trial);
  report := public.klui_affiliate_report('33333333-3333-4333-8333-000000000001')->0;
  assert report->>'trialUsers' = '1' and report->>'paidUsers' = '0' and report->>'unpaidTrialUsers' = '1', 'trial counted as paid or duplicate';
  assert public.klui_affiliate_report('33333333-3333-4333-8333-000000000002')->0->>'totalUsers' = '0', 'creator isolation';
  paid := jsonb_set(jsonb_set(jsonb_set(trial,'{status}','"active"'),'{raw,status}','"captured"'),'{raw,id}','"AFF-PAY-1"');
  paid := jsonb_set(paid,'{raw,created_date}','"2099-11-04-00-00-00"');
  -- Disabling/changing a code cannot change an already-created checkout's attribution.
  update public.affiliate_coupons set percent_off=50, enabled=false where code='CREATORFREE';
  perform public.klui_apply_mamo_subscription(paid);
  perform public.klui_apply_mamo_subscription(paid);
  renewal := jsonb_set(jsonb_set(paid,'{raw,id}','"AFF-PAY-2"'),'{raw,created_date}','"2099-12-04-00-00-00"');
  perform public.klui_apply_mamo_subscription(renewal);
  report := public.klui_affiliate_report('33333333-3333-4333-8333-000000000001')->0;
  assert report->>'trialUsers' = '1' and report->>'paidUsers' = '1' and report->>'convertedTrialUsers' = '1', 'trial conversion/renewal count';
  assert report->>'totalUsers' = '1' and report->>'unpaidTrialUsers' = '0', 'trial conversion double-counted customer';
  assert (select x->>'paidUsers' = '1' and x->>'trialUsers' = '1' from jsonb_array_elements(report->'byPlan') x where x->>'planId'='pro'), 'plan counts';
  assert report::text !~ '22222222|payment_link_id|first_payment_id|user_id|email', 'customer identity leaked in report';
  -- An old first-charge refund still updates the referral after newer renewal access.
  paid := jsonb_set(jsonb_set(paid,'{status}','"canceled"'),'{raw,refund_amount}','32.19');
  perform public.klui_apply_mamo_subscription(paid);
  perform public.klui_apply_mamo_subscription(paid);
  assert (select status='active' from public.subscriptions where user_id=(trial->>'user_id')::uuid), 'old refund removed renewed access';
  report := public.klui_affiliate_report('33333333-3333-4333-8333-000000000001')->0;
  assert report->>'paidUsers' = '0' and report->>'refundedUsers' = '1', 'refund not reflected';
  perform public.klui_apply_mamo_subscription(renewal);
  assert public.klui_affiliate_report('33333333-3333-4333-8333-000000000001')->0->>'refundedUsers' = '1', 'renewal revived refunded acquisition';

  paid := jsonb_set(jsonb_set(jsonb_set(trial,'{user_id}','"22222222-2222-4222-8222-000000000004"'),
    '{provider_subscription_id}','"mamo:22222222-2222-4222-8222-000000000004"'),'{plan_id}','"lite"');
  paid := jsonb_set(jsonb_set(paid,'{status}','"past_due"'),'{raw,payment_link_id}','"AFF-PAID"');
  paid := jsonb_set(paid,'{raw,id}','"AFF-FAILED"');
  perform public.klui_apply_mamo_subscription(paid);
  assert public.klui_affiliate_report('33333333-3333-4333-8333-000000000002')->0->>'totalUsers' = '0', 'failed payment counted';
  paid := jsonb_set(jsonb_set(jsonb_set(paid,'{status}','"active"'),'{raw,status}','"captured"'),'{raw,id}','"AFF-DISCOUNTED"');
  paid := jsonb_set(paid,'{raw,amount}','8.35');
  perform public.klui_apply_mamo_subscription(paid);
  assert public.klui_affiliate_report('33333333-3333-4333-8333-000000000002')->0->>'paidUsers' = '1', 'discounted payment not counted';
  -- First paid plan remains lite even if a later checkout uses pro.
  insert into public.mamo_payment_links (id,user_id,plan_id,amount_aed,coupon_code,initial_amount_aed,first_renewal_at,affiliate_coupon_id)
  select 'AFF-UPGRADE',user_id,'pro',32.19,coupon_code,20,first_renewal_at,affiliate_coupon_id from public.mamo_payment_links where id='AFF-PAID';
  paid := jsonb_set(jsonb_set(jsonb_set(paid,'{plan_id}','"pro"'),'{raw,payment_link_id}','"AFF-UPGRADE"'),'{raw,id}','"AFF-UPGRADED"');
  paid := jsonb_set(paid,'{raw,created_date}','"2099-12-04-00-00-00"');
  perform public.klui_apply_mamo_subscription(paid);
  assert (select paid_plan_id='lite' from public.affiliate_referrals where user_id='22222222-2222-4222-8222-000000000004'), 'upgrade changed first purchased plan';
  begin
    update public.affiliate_coupons set creator_id='33333333-3333-4333-8333-000000000002' where code='CREATORFREE';
    raise exception using errcode='P0042',message='code reassignment accepted';
  exception when raise_exception then null;
  end;
  begin
    insert into public.affiliate_coupons (creator_id,code,enabled) values ('33333333-3333-4333-8333-000000000001','UNDECIDED',true);
    raise exception using errcode='P0042',message='enabled undecided coupon accepted';
  exception when check_violation then null;
  end;
  delete from auth.users where id='22222222-2222-4222-8222-000000000004';
  report := public.klui_affiliate_report('33333333-3333-4333-8333-000000000002')->0;
  assert report->>'paidUsers' = '1', 'account deletion erased historical total';
  assert (select user_id is null from public.affiliate_referrals where first_payment_id='AFF-DISCOUNTED'), 'account identity retained';
end;
$$;
rollback;
