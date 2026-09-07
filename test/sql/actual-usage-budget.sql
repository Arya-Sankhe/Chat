-- Run with psql -v ON_ERROR_STOP=1 -f test/sql/actual-usage-budget.sql.
-- All fixture data and recovery changes are rolled back, including on failure.
begin;
do $$
declare
  u uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  requests uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  r jsonb;
  surface text;
  modality text;
begin
  insert into auth.users (id) values (u);
  insert into public.profiles (id) values (u) on conflict do nothing;
  perform public.klui_check_api_budget(u, 'pro', '2099-09-01', '2099-10-01', '2099-09-01', '2099-09-09', 1, 1.02);
  update public.usage_api_weekly set api_credit_used = 0.05212476 where user_id = u;

  -- Reproduce Council: four outstanding 0.25 holds at 5.11% actual usage.
  for i in 1..4 loop
    r := public.klui_reserve_api_usage(u, requests[i], null, 'pro', 'web', 'llm', null,
      'openrouter', 'test', '2099-09-01', '2099-10-01', '2099-09-01', '2099-09-09', 1, 1.02, 0.25);
    assert (r->>'allowed')::boolean, 'Council panelist rejected despite available usage';
  end loop;
  assert (r->>'api_credit_reserved')::numeric = 1, 'holds must still be tracked';
  r := public.klui_check_api_budget(u, 'pro', '2099-09-01', '2099-10-01', '2099-09-01', '2099-09-09', 1, 1.02);
  assert (r->>'allowed')::boolean, 'preflight counted outstanding holds';
  r := public.klui_reserve_api_usage(u, requests[1], null, 'pro', 'web', 'llm', null,
    'openrouter', 'test', '2099-09-01', '2099-10-01', '2099-09-01', '2099-09-09', 1, 1.02, 0.25);
  assert (r->>'duplicate')::boolean, 'duplicate request admitted';

  -- Old or regressed callers cannot write a positive reservation charge.
  begin
    perform public.klui_settle_api_usage(u, requests[1], 0.25, 'reservation_ceiling', '{}', null, true);
    raise exception 'unsupported reservation charge accepted';
  exception when check_violation then null;
  end;
  assert (select api_credit_used = 0.05212476 and api_credit_reserved = 1
    from public.usage_api_weekly where user_id = u), 'rejected charge changed weekly counters';

  -- Missing usage must never turn the hold into a bill.
  perform public.klui_mark_api_usage_submitted(u, requests[1], null);
  update public.usage_api_events set updated_at = now() - interval '13 minutes'
    where user_id = u and request_id = requests[1];
  r := public.klui_reconcile_api_usage();
  assert (r->>'leader')::boolean, 'reconciler busy: rerun check';
  assert exists (select 1 from public.usage_api_events where user_id = u and request_id = requests[1]
    and cost_credits = 0 and cost_source = 'missing_usage' and status = 'estimated'), 'stale hold was billed';
  assert (select api_credit_used = 0.05212476 and api_credit_reserved = 0.75
    from public.usage_api_weekly where user_id = u), 'stale settlement changed actual usage';

  -- Actual cost can exceed its estimate; settlement stays idempotent.
  perform public.klui_settle_api_usage(u, requests[2], 0.4, 'provider', '{"cost":0.4}');
  perform public.klui_settle_api_usage(u, requests[2], 0.4, 'provider', '{"cost":0.4}');
  assert (select api_credit_used = 0.45212476 from public.usage_api_weekly where user_id = u),
    'actual cost was rejected or billed twice';
  perform public.klui_release_api_usage(u, requests[3]);
  perform public.klui_release_api_usage(u, requests[4]);

  -- Even less than one hold remaining must admit the final request.
  update public.usage_api_weekly set api_credit_used = 1.01999999 where user_id = u;
  foreach surface in array array['web', 'desktop_macos', 'desktop_windows'] loop
    foreach modality in array array['llm', 'stt'] loop
      r := public.klui_reserve_api_usage(u, gen_random_uuid(), null, 'pro', surface, modality, null,
        'openrouter', 'test', '2099-09-01', '2099-10-01', '2099-09-01', '2099-09-09', 1, 1.02, 0.25);
      assert (r->>'allowed')::boolean, 'positive remaining balance was rejected';
    end loop;
  end loop;
  update public.usage_api_weekly set api_credit_used = 1.02 where user_id = u;
  r := public.klui_reserve_api_usage(u, gen_random_uuid(), null, 'pro', 'web', 'llm', null,
    'openrouter', 'test', '2099-09-01', '2099-10-01', '2099-09-01', '2099-09-09', 1, 1.02, 0.25);
  assert not (r->>'allowed')::boolean and r->>'reason' = 'usage_exhausted', 'exhausted account admitted';
  r := public.klui_check_api_budget(u, 'pro', '2099-09-01', '2099-10-01', '2099-09-01', '2099-09-09', 1, 1.02);
  assert not (r->>'allowed')::boolean, 'preflight disagrees with reservation';

  insert into auth.users (id) values (other_user);
  insert into public.profiles (id) values (other_user) on conflict do nothing;
  r := public.klui_reserve_api_usage(other_user, gen_random_uuid(), null, 'lite', 'web', 'llm', null,
    'openrouter', 'test', '2099-09-01', '2099-10-01', '2099-09-01', '2099-09-09', 1, 0.34, 0.25);
  assert (r->>'allowed')::boolean and (r->>'api_credit_used')::numeric = 0,
    'one exhausted account affected another account';

  insert into public.app_settings (key, value) values ('funded_inference_disabled:' || u::text, '{"disabled":true}');
  r := public.klui_reserve_api_usage(u, gen_random_uuid(), null, 'pro', 'web', 'llm', null,
    'openrouter', 'test', '2099-09-01', '2099-10-01', '2099-09-01', '2099-09-09', 1, 1.02, 0.25);
  assert r->>'reason' = 'usage_metering_disabled', 'administrative disable was bypassed';
end;
$$;
rollback;
