\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values
('55555555-5555-4555-8555-000000000001'),('55555555-5555-4555-8555-000000000002'),
('55555555-5555-4555-8555-000000000003'),('55555555-5555-4555-8555-000000000004'),
('55555555-5555-4555-8555-000000000005'),('55555555-5555-4555-8555-000000000006');
insert into public.profiles(id) select id from auth.users where id::text like '55555555-%';
insert into public.mamo_payment_links(id,user_id,plan_id,amount_aed,coupon_code,initial_amount_aed,first_renewal_at,coupon_account_hashes) values
('LIMIT-1','55555555-5555-4555-8555-000000000001','pro',32.19,'FIRSTFREE',0,'2099-11-04',array[repeat('a',64),repeat('b',64)]),
('LIMIT-2','55555555-5555-4555-8555-000000000002','pro',32.19,'CREATORFREE',0,'2099-11-04',array[repeat('c',64)]),
('LIMIT-3','55555555-5555-4555-8555-000000000003','pro',32.19,'FIRST50',16.65,'2099-11-04',array[repeat('d',64)]),
('LIMIT-4','55555555-5555-4555-8555-000000000004','pro',32.19,'FIRST50',16.65,'2099-11-04',array[repeat('d',64)]),
('LIMIT-5','55555555-5555-4555-8555-000000000005','pro',32.19,'FIRSTFREE',0,'2099-11-04',array[repeat('e',64)]),
('LIMIT-6','55555555-5555-4555-8555-000000000006','pro',32.19,'FIRST50',16.65,'2099-11-04',array[repeat('f',64)]);
insert into public.subscriptions(user_id,provider,provider_subscription_id,plan_id,status,raw)
values ('55555555-5555-4555-8555-000000000006','ziina','beta-retired','pro','expired','{"beta_retired":true}');
do $$
declare r jsonb;
begin
  assert not has_table_privilege('anon','public.mamo_coupon_ledger','select'), 'ledger exposed';
  assert not has_table_privilege('authenticated','public.mamo_coupon_ledger','insert'), 'ledger writable';
  assert not has_function_privilege('authenticated','public.klui_has_used_mamo_coupon(text[])','execute'), 'identity lookup exposed';
  assert not has_function_privilege('anon','public.klui_claim_mamo_coupon(text,text,text,text)','execute'), 'claim exposed';
  assert not public.klui_has_used_mamo_coupon(array[repeat('a',64)]), 'unused identity blocked';
  r := public.klui_claim_mamo_coupon('LIMIT-1','CARD-1','VERIFY-1',repeat('1',64));
  assert r->>'status' = 'claimed' and not (r->>'conflict')::boolean, 'first trial rejected';
  r := public.klui_claim_mamo_coupon('LIMIT-1','CARD-1','VERIFY-1',repeat('1',64));
  assert not (r->>'conflict')::boolean, 'same checkout replay blocked';
  assert (select count(*) = 3 from public.mamo_coupon_ledger where payment_link_id='LIMIT-1'), 'replay changed reservations';
  perform public.klui_advance_mamo_coupon('LIMIT-1',array['claimed'],'active');
  assert public.klui_has_used_mamo_coupon(array[repeat('b',64)]), 'second identity key not retained';
  r := public.klui_claim_mamo_coupon('LIMIT-2','CARD-1','VERIFY-2',repeat('1',64));
  assert (r->>'conflict')::boolean, 'same saved card obtained a second free trial';
  assert not public.klui_has_used_mamo_coupon(array[repeat('c',64)]), 'rejected trial consumed identity';

  delete from auth.users where id='55555555-5555-4555-8555-000000000001';
  assert public.klui_has_used_mamo_coupon(array[repeat('a',64)]), 'account deletion erased coupon history';
  r := public.klui_claim_mamo_coupon('LIMIT-2','CARD-1','VERIFY-2',repeat('1',64));
  assert (r->>'conflict')::boolean, 'deletion erased card history';
  update public.mamo_payment_links set coupon_account_hashes=array[repeat('b',64)] where id='LIMIT-2';
  r := public.klui_claim_mamo_coupon('LIMIT-2','CARD-NEW','VERIFY-NEW',repeat('2',64));
  assert (r->>'conflict')::boolean, 'recreated identity redeemed with another card';

  r := public.klui_claim_mamo_coupon('LIMIT-3','CARD-1','VERIFY-3',repeat('1',64));
  assert not (r->>'conflict')::boolean, 'paid discount incorrectly treated as a free trial';
  r := public.klui_claim_mamo_coupon('LIMIT-4','CARD-4','VERIFY-4',repeat('4',64));
  assert (r->>'conflict')::boolean, 'same identity reserved twice';
  perform public.klui_advance_mamo_coupon('LIMIT-3',array['claimed'],'failed');
  assert not public.klui_has_used_mamo_coupon(array[repeat('d',64)]), 'failed charge did not release identity';
  r := public.klui_claim_mamo_coupon('LIMIT-4','CARD-4','VERIFY-4',repeat('4',64));
  assert not (r->>'conflict')::boolean, 'failed charge prevented retry';
  perform public.klui_advance_mamo_coupon('LIMIT-4',array['claimed'],'active');
  assert public.klui_has_used_mamo_coupon(array[repeat('d',64)]), 'successful discount not consumed';

  r := public.klui_claim_mamo_coupon('LIMIT-5',null,'VERIFY-5',null);
  assert (r->>'conflict')::boolean, 'cardless trial accepted';
  update public.mamo_payment_links set coupon_account_hashes='{}' where id='LIMIT-5';
  r := public.klui_claim_mamo_coupon('LIMIT-5','CARD-5','VERIFY-5',repeat('5',64));
  assert (r->>'conflict')::boolean, 'identity-less trial accepted';
  r := public.klui_claim_mamo_coupon('LIMIT-6','CARD-6','VERIFY-6',repeat('6',64));
  assert not (r->>'conflict')::boolean, 'beta retirement blocked first paid coupon';
end;
$$;
rollback;
