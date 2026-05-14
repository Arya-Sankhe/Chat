create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id text primary key,
  name text not null,
  daily_message_limit integer not null,
  monthly_image_limit integer not null,
  max_images_per_message integer not null,
  price_label text not null default 'Testing access',
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plans (id, name, daily_message_limit, monthly_image_limit, max_images_per_message, sort_order)
values
  ('hobby', 'Hobby', 150, 200, 4, 10),
  ('pro', 'Pro', 600, 1000, 4, 20),
  ('intermediate', 'Intermediate', 1500, 2500, 4, 30),
  ('scale', 'Scale', 5000, 7500, 6, 40),
  ('max', 'Max', 15000, 20000, 8, 50)
on conflict (id) do nothing;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'manual',
  provider_customer_id text,
  provider_subscription_id text unique,
  provider_price_id text,
  plan_id text references public.plans(id),
  status text not null,
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'New chat',
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content jsonb not null default '""'::jsonb,
  model text,
  reasoning text not null default '',
  tool_calls jsonb not null default '[]'::jsonb,
  finish_reason text,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  object_key text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null,
  etag text,
  status text not null default 'pending' check (status in ('pending', 'uploaded')),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz
);

create table if not exists public.usage_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  plan_id text not null,
  message_count integer not null default 0,
  image_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists public.usage_monthly (
  user_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  plan_id text not null,
  image_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  plan_id text,
  event_type text not null,
  model text,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  image_count integer not null default 0,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.model_cache (
  id text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.profiles drop column if exists stripe_customer_id;
alter table public.plans drop column if exists stripe_price_id;
alter table public.plans alter column price_label set default 'Testing access';
alter table public.subscriptions drop column if exists stripe_customer_id;
alter table public.subscriptions drop column if exists stripe_subscription_id;
alter table public.subscriptions drop column if exists stripe_price_id;
alter table public.subscriptions add column if not exists provider text not null default 'manual';
alter table public.subscriptions add column if not exists provider_customer_id text;
alter table public.subscriptions add column if not exists provider_subscription_id text unique;
alter table public.subscriptions add column if not exists provider_price_id text;
drop table if exists public.webhook_events;

update public.plans
set price_label = 'Testing access', updated_at = now()
where price_label = 'Configured in Stripe';

create index if not exists subscriptions_user_updated_idx on public.subscriptions (user_id, updated_at desc);
create index if not exists conversations_user_updated_idx on public.conversations (user_id, updated_at desc) where deleted_at is null;
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index if not exists attachments_user_status_idx on public.attachments (user_id, status);

grant usage on schema public to anon, authenticated, service_role;
grant select on public.plans to anon, authenticated;
grant select on public.profiles, public.subscriptions, public.conversations, public.messages, public.attachments, public.usage_daily, public.usage_monthly to authenticated;
grant all on public.profiles, public.plans, public.subscriptions, public.conversations, public.messages, public.attachments, public.usage_daily, public.usage_monthly, public.usage_events, public.model_cache to service_role;

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.usage_daily enable row level security;
alter table public.usage_monthly enable row level security;
alter table public.usage_events enable row level security;
alter table public.model_cache enable row level security;

create policy "profiles read own" on public.profiles for select using (auth.uid() = id);
create policy "plans read active" on public.plans for select using (active = true);
create policy "subscriptions read own" on public.subscriptions for select using (auth.uid() = user_id);
create policy "conversations read own" on public.conversations for select using (auth.uid() = user_id);
create policy "messages read own" on public.messages for select using (auth.uid() = user_id);
create policy "attachments read own" on public.attachments for select using (auth.uid() = user_id);
create policy "usage daily read own" on public.usage_daily for select using (auth.uid() = user_id);
create policy "usage monthly read own" on public.usage_monthly for select using (auth.uid() = user_id);

create or replace function public.smartyfy_consume_usage(
  p_user_id uuid,
  p_plan_id text,
  p_daily_message_limit integer,
  p_monthly_image_limit integer,
  p_image_count integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := current_date;
  v_month date := date_trunc('month', now())::date;
  v_daily public.usage_daily%rowtype;
  v_monthly public.usage_monthly%rowtype;
begin
  insert into public.usage_daily (user_id, day, plan_id)
  values (p_user_id, v_day, p_plan_id)
  on conflict (user_id, day) do nothing;

  insert into public.usage_monthly (user_id, month, plan_id)
  values (p_user_id, v_month, p_plan_id)
  on conflict (user_id, month) do nothing;

  select * into v_daily
  from public.usage_daily
  where user_id = p_user_id and day = v_day
  for update;

  select * into v_monthly
  from public.usage_monthly
  where user_id = p_user_id and month = v_month
  for update;

  if v_daily.message_count + 1 > p_daily_message_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Daily message limit reached.',
      'message_count', v_daily.message_count,
      'daily_message_limit', p_daily_message_limit
    );
  end if;

  if v_monthly.image_count + greatest(p_image_count, 0) > p_monthly_image_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Monthly image limit reached.',
      'image_count', v_monthly.image_count,
      'monthly_image_limit', p_monthly_image_limit
    );
  end if;

  update public.usage_daily
  set
    plan_id = p_plan_id,
    message_count = message_count + 1,
    image_count = image_count + greatest(p_image_count, 0),
    updated_at = now()
  where user_id = p_user_id and day = v_day
  returning * into v_daily;

  update public.usage_monthly
  set
    plan_id = p_plan_id,
    image_count = image_count + greatest(p_image_count, 0),
    updated_at = now()
  where user_id = p_user_id and month = v_month
  returning * into v_monthly;

  return jsonb_build_object(
    'allowed', true,
    'message_count', v_daily.message_count,
    'image_count', v_daily.image_count,
    'daily_message_limit', p_daily_message_limit,
    'monthly_image_count', v_monthly.image_count,
    'monthly_image_limit', p_monthly_image_limit
  );
end;
$$;
