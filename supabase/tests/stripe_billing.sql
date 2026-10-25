\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values('66666666-6666-4666-8666-000000000001'),('66666666-6666-4666-8666-000000000002'),('66666666-6666-4666-8666-000000000003');
insert into public.profiles(id) select id from auth.users where id::text like '66666666-%';
insert into public.stripe_customers(user_id,customer_id) values('66666666-6666-4666-8666-000000000001','cus_sql_1'),('66666666-6666-4666-8666-000000000002','cus_sql_2'),('66666666-6666-4666-8666-000000000003','cus_sql_3');
insert into public.affiliate_creators(id,display_name) values('66666666-6666-4666-8666-000000000010','Stripe creator');
insert into public.affiliate_coupons(id,creator_id,code,percent_off,enabled) values('66666666-6666-4666-8666-000000000011','66666666-6666-4666-8666-000000000010','STRIPESQL',100,true);
do $$
declare r jsonb; t timestamptz := now();
begin
 assert not has_table_privilege('anon','public.stripe_customers','select');
 assert not has_table_privilege('authenticated','public.stripe_checkouts','update');
 assert not has_table_privilege('anon','public.stripe_coupon_ledger','select');
 assert not has_function_privilege('authenticated','public.klui_reserve_stripe_checkout(jsonb)','execute');
 r:=public.klui_reserve_stripe_checkout(jsonb_build_object('id','66666666-6666-4666-8666-000000000020','user_id','66666666-6666-4666-8666-000000000001','customer_id','cus_sql_1','plan_id','pro','price_id','price_sql','coupon_code','STRIPESQL','affiliate_coupon_id','66666666-6666-4666-8666-000000000011','free_trial',true,'account_hashes',array[repeat('a',64),repeat('b',64)],'expires_at',now()+interval '1 hour'));
 begin
  perform public.klui_reserve_stripe_checkout(jsonb_build_object('id','66666666-6666-4666-8666-000000000021','user_id','66666666-6666-4666-8666-000000000002','customer_id','cus_sql_2','plan_id','pro','price_id','price_sql','coupon_code','FIRSTFREE','account_hashes',array[repeat('b',64),repeat('c',64)],'expires_at',now()+interval '1 hour'));
  raise exception 'duplicate identity accepted';
 exception when raise_exception then assert sqlerrm='This coupon is only for your first Klui subscription'; end;
 r:=public.klui_apply_stripe_subscription('66666666-6666-4666-8666-000000000020','sub_sql_1','trialing',false,null,now()+interval '1 month',null,null,repeat('d',64),null,t);
 assert r->>'status'='trialing';
 assert (select count(*)=1 from public.affiliate_referrals where trial_plan_id='pro' and paid_at is null);
 r:=public.klui_apply_stripe_subscription('66666666-6666-4666-8666-000000000020','sub_sql_1','active',false,now()+interval '2 months',null,'in_sql_paid',null,null,null,t+interval '1 second');
 assert (select count(*)=1 from public.affiliate_referrals where trial_plan_id='pro' and paid_plan_id='pro');
 r:=public.klui_apply_stripe_subscription('66666666-6666-4666-8666-000000000020','sub_sql_1','active',false,now()+interval '2 months',null,'in_sql_paid','in_sql_paid',null,'full_refund',t+interval '2 seconds');
 assert r->>'status'='canceled' and r->>'current_period_end' is null;
 r:=public.klui_apply_stripe_subscription('66666666-6666-4666-8666-000000000020','sub_sql_1','active',false,now()+interval '3 months',null,'in_sql_late',null,null,null,t+interval '3 seconds');
 assert r->>'status'='canceled','late success resurrected refund';
 assert (select count(*)=1 from public.affiliate_referrals where refunded_at is not null);
 delete from auth.users where id='66666666-6666-4666-8666-000000000001';
 assert (select count(*)=3 from public.stripe_coupon_ledger where redeemed and checkout_id='66666666-6666-4666-8666-000000000020'),'deletion erased coupon/card claims';
 r:=public.klui_reserve_stripe_checkout(jsonb_build_object('id','66666666-6666-4666-8666-000000000022','user_id','66666666-6666-4666-8666-000000000003','customer_id','cus_sql_3','plan_id','pro','price_id','price_sql','coupon_code','FIRSTFREE','free_trial',true,'account_hashes',array[repeat('e',64),repeat('f',64)],'expires_at',now()+interval '1 hour'));
 r:=public.klui_apply_stripe_subscription('66666666-6666-4666-8666-000000000022','sub_sql_3','trialing',false,null,now()+interval '1 month',null,null,repeat('d',64),null,t);
 assert r->'raw'->>'blocked_reason'='trial_card_conflict','same card claimed a second trial';
 r:=public.klui_reserve_stripe_checkout(jsonb_build_object('id','66666666-6666-4666-8666-000000000023','user_id','66666666-6666-4666-8666-000000000002','customer_id','cus_sql_2','plan_id','pro','price_id','price_sql','coupon_code','STRIPESQL','affiliate_coupon_id','66666666-6666-4666-8666-000000000011','free_trial',true,'account_hashes',array[repeat('1',64),repeat('2',64)],'expires_at',now()+interval '1 hour'));
 r:=public.klui_apply_stripe_subscription('66666666-6666-4666-8666-000000000023','sub_sql_2','active',false,now()+interval '1 month',now()-interval '1 day','in_refunded_before_success','in_refunded_before_success',null,'full_refund',t);
 assert r->>'status'='canceled';
 assert (select count(*)=1 from public.affiliate_referrals where user_id='66666666-6666-4666-8666-000000000002' and trial_started_at is not null and paid_at is not null and refunded_at is not null),'refund-before-success lost historical trial/paid attribution';
end $$;
rollback;
