-- No account/link foreign keys: deletion must not make a used offer available again.
create table public.mamo_coupon_ledger (
  kind text not null check (kind in ('account', 'card')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  payment_link_id text not null,
  created_at timestamptz not null default now(),
  primary key (kind, key_hash)
);
create index mamo_coupon_ledger_link_idx on public.mamo_coupon_ledger(payment_link_id);
alter table public.mamo_coupon_ledger enable row level security;
revoke all on public.mamo_coupon_ledger from public, anon, authenticated;
grant all on public.mamo_coupon_ledger to service_role;

alter table public.mamo_payment_links add column coupon_account_hashes text[] not null default '{}';

create function public.klui_has_used_mamo_coupon(p_account_hashes text[])
returns boolean language sql security invoker set search_path = public as $$
  select exists (select 1 from public.mamo_coupon_ledger
    where kind = 'account' and key_hash = any(p_account_hashes));
$$;
revoke all on function public.klui_has_used_mamo_coupon(text[]) from public, anon, authenticated;
grant execute on function public.klui_has_used_mamo_coupon(text[]) to service_role;

drop function public.klui_claim_mamo_coupon(text,text,text);
create function public.klui_claim_mamo_coupon(
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
revoke all on function public.klui_claim_mamo_coupon(text,text,text,text) from public, anon, authenticated;
grant execute on function public.klui_claim_mamo_coupon(text,text,text,text) to service_role;

create or replace function public.klui_advance_mamo_coupon(
  p_payment_link_id text, p_from text[], p_to text, p_initial_payment_id text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare claim public.mamo_coupon_redemptions;
begin
  perform pg_advisory_xact_lock(hashtextextended('mamo-coupon-ledger', 0));
  update public.mamo_coupon_redemptions
    set status = p_to, initial_payment_id = coalesce(p_initial_payment_id, initial_payment_id), updated_at = now()
    where payment_link_id = p_payment_link_id and status = any(p_from)
    returning * into claim;
  if not found then return null; end if;
  if p_to = 'failed' then
    delete from public.mamo_coupon_ledger where payment_link_id = p_payment_link_id;
  end if;
  return to_jsonb(claim);
end;
$$;

-- Ziina was beta access. Preserve purchase history without giving it priority over a newer Mamo row.
update public.subscriptions set status = 'expired', cancel_at_period_end = true,
  current_period_end = least(coalesce(current_period_end, now()), now()),
  raw = raw || jsonb_build_object('beta_retired', true, 'beta_retired_at', now())
where provider = 'ziina' and coalesce(raw->>'beta_retired', '') <> 'true';
update public.payment_requests set status = 'cancelled',
  admin_note = coalesce(admin_note, 'Ziina beta retired')
where provider = 'ziina' and status = 'pending';

notify pgrst, 'reload schema';
