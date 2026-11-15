-- Security hardening (2026-11-15).
--
-- 1. Only the server (service_role) talks to the database. The browser and the apps call
--    our API; none of them query PostgREST tables or RPCs directly. So the client roles
--    (anon, authenticated) and PUBLIC lose every table and function privilege in public,
--    and future objects no longer get them by default. RLS stays on as a second wall.
-- 2. Reasoning traces are retired: stored traces are cleared.
-- 3. Beta invite rows (provider 'invite') never count as a prior paid subscription, so
--    invited testers can still use a first-subscription coupon once billing opens.

-- 1a. Functions we own (extension members such as pgvector's are left alone, since
--     service_role reaches them through PUBLIC).
do $$
declare fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;

-- 1b. Tables, views and sequences.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 1c. Objects created later by this role (migrations run as postgres on Supabase) no
--     longer reach the client roles by default. PUBLIC's EXECUTE on new functions is a
--     global default that a per-schema rule cannot remove, so every new function still
--     needs its own `revoke all ... from public, anon, authenticated`;
--     test/sql/client-roles-locked.sql fails CI when one is missing.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- 2. Retired reasoning traces.
update public.messages set reasoning = '' where reasoning <> '';

-- 3. First-subscription coupons ignore beta invite rows.
create or replace function public.klui_claim_mamo_coupon(
  p_payment_link_id text, p_card_id text, p_verification_payment_id text, p_card_hash text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  link public.mamo_payment_links;
  claim public.mamo_coupon_redemptions;
begin
  select * into link from public.mamo_payment_links where id = p_payment_link_id;
  if not found or link.coupon_code is null then raise exception 'Not a coupon checkout'; end if;
  -- Serialize identity reservations across accounts; this lock is held only for the short DB transaction.
  perform pg_advisory_xact_lock(hashtextextended('mamo-coupon-ledger', 0));
  perform pg_advisory_xact_lock(hashtextextended('mamo:' || link.user_id::text, 0));
  select * into claim from public.mamo_coupon_redemptions where user_id = link.user_id for update;
  if found and claim.payment_link_id <> link.id and claim.status <> 'failed' then
    return to_jsonb(claim) || '{"conflict":true}';
  end if;
  if found and claim.payment_link_id = link.id then
    return to_jsonb(claim) || '{"conflict":false}';
  end if;
  if coalesce(p_card_id, '') = '' or coalesce(p_card_hash, '') !~ '^[a-f0-9]{64}$'
    or cardinality(link.coupon_account_hashes) = 0
    or exists (select 1 from unnest(link.coupon_account_hashes) h where h is null or h !~ '^[a-f0-9]{64}$') then
    return jsonb_build_object('status', 'unverified', 'conflict', true);
  end if;
  if exists (select 1 from public.subscriptions s where s.user_id = link.user_id
    and s.provider <> 'invite'
    and not (s.provider = 'ziina' and coalesce(s.raw->>'beta_retired', '') = 'true')
    and coalesce(s.raw->>'payment_link_id', '') <> link.id)
    or exists (select 1 from public.mamo_coupon_ledger l where l.payment_link_id <> link.id
      and ((l.kind = 'account' and l.key_hash = any(link.coupon_account_hashes))
        or (link.initial_amount_aed = 0 and l.kind = 'card' and l.key_hash = p_card_hash))) then
    return jsonb_build_object('status', 'ineligible', 'conflict', true);
  end if;
  insert into public.mamo_coupon_ledger(kind, key_hash, payment_link_id)
    select 'account', h, link.id from unnest(link.coupon_account_hashes) h on conflict do nothing;
  if link.initial_amount_aed = 0 then
    insert into public.mamo_coupon_ledger(kind, key_hash, payment_link_id)
      values ('card', p_card_hash, link.id) on conflict do nothing;
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
