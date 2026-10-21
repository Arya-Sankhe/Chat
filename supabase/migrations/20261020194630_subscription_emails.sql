-- Service-only delivery outbox. A checkout produces exactly one subscription confirmation.
create table public.billing_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  payment_link_id text not null unique references public.mamo_payment_links(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','review')),
  available_at timestamptz not null default now(),
  first_attempt_at timestamptz,
  attempt_count integer not null default 0,
  lease_token uuid,
  message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.billing_email_deliveries enable row level security;
revoke all on public.billing_email_deliveries from public, anon, authenticated;
grant all on public.billing_email_deliveries to service_role;
create index billing_email_pending_idx on public.billing_email_deliveries(available_at) where status in ('pending','sending');
create index billing_email_user_idx on public.billing_email_deliveries(user_id);

create function public.klui_claim_billing_emails()
returns setof public.billing_email_deliveries
language plpgsql security invoker set search_path = public as $$
begin
  -- Brevo deduplicates for 30 minutes. Never retry an uncertain send after that window.
  update public.billing_email_deliveries set status = 'review',
    last_error = 'Uncertain delivery exceeded 25 minutes; check Brevo logs before retrying'
    where status = 'sending' and first_attempt_at < now() - interval '25 minutes';
  return query
    update public.billing_email_deliveries d set status = 'sending',
      first_attempt_at = coalesce(d.first_attempt_at, now()), attempt_count = d.attempt_count + 1,
      available_at = now() + interval '2 minutes', lease_token = gen_random_uuid()
    where d.id in (
      select q.id from public.billing_email_deliveries q
      where q.status in ('pending','sending') and q.available_at <= now()
      order by q.available_at for update skip locked limit 5
    ) returning d.*;
end;
$$;
revoke all on function public.klui_claim_billing_emails() from public, anon, authenticated;
grant execute on function public.klui_claim_billing_emails() to service_role;
notify pgrst, 'reload schema';
