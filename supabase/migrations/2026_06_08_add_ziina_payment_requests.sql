create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null references public.plans(id),
  amount_aed numeric(10,2) not null,
  currency text not null default 'AED',
  provider text not null default 'ziina',
  payment_url text,
  qr_image_url text,
  reference_code text not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_requests_user_created_idx
  on public.payment_requests (user_id, created_at desc);

create index if not exists payment_requests_status_created_idx
  on public.payment_requests (status, created_at desc);

alter table public.payment_requests enable row level security;

drop policy if exists "payment requests read own" on public.payment_requests;
create policy "payment requests read own" on public.payment_requests
  for select using (auth.uid() = user_id);

grant select on public.payment_requests to authenticated;
grant all on public.payment_requests to service_role;

update public.plans
set active = false, updated_at = now()
where id not in ('lite', 'essential', 'pro');

insert into public.plans (id, name, max_images_per_message, price_label, active, sort_order)
values
  ('lite', 'Lite', 4, '10 AED / month', true, 10),
  ('essential', 'Essential', 4, '30 AED / month', true, 20),
  ('pro', 'Pro', 4, '50 AED / month', true, 30)
on conflict (id) do update
set
  name = excluded.name,
  price_label = excluded.price_label,
  active = true,
  sort_order = excluded.sort_order,
  updated_at = now();
