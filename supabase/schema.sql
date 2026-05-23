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
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  category text not null default 'image' check (category in ('image', 'document')),
  object_key text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null,
  etag text,
  status text not null default 'pending' check (status in ('pending', 'uploaded')),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz
);

alter table public.attachments
  add column if not exists category text not null default 'image';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attachments_category_check'
      and conrelid = 'public.attachments'::regclass
  ) then
    alter table public.attachments
      add constraint attachments_category_check check (category in ('image', 'document'));
  end if;
end;
$$;

create table if not exists public.document_files (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references public.attachments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  kind text not null check (kind in ('pdf', 'docx', 'xlsx', 'csv', 'tsv')),
  source text not null default 'upload' check (source in ('upload', 'generated', 'edited', 'exported')),
  parent_document_id uuid references public.document_files(id) on delete set null,
  version_no integer not null default 1,
  source_etag text,
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processing', 'ready', 'failed')),
  page_count integer,
  word_count integer,
  sheet_count integer,
  used_cell_count integer,
  extraction_key text,
  preview_key text,
  metadata jsonb not null default '{}'::jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attachment_id)
);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_file_id uuid not null references public.document_files(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  chunk_index integer not null,
  source_type text not null,
  source_label text not null,
  text text not null,
  char_count integer not null default 0,
  token_estimate integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_file_id, chunk_index)
);

alter table public.document_chunks
  add column if not exists tsv tsvector
    generated always as (to_tsvector('simple', coalesce(text, ''))) stored;

create table if not exists public.document_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_file_id uuid references public.document_files(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  job_type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'expired')),
  priority integer not null default 0,
  attempt_count integer not null default 0,
  worker_id text,
  lease_until timestamptz,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  plan_id text not null,
  message_count integer not null default 0,
  image_count integer not null default 0,
  search_count integer not null default 0,
  document_tool_count integer not null default 0,
  generated_document_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.usage_daily
  add column if not exists search_count integer not null default 0;

alter table public.usage_daily
  add column if not exists document_tool_count integer not null default 0;

alter table public.usage_daily
  add column if not exists generated_document_count integer not null default 0;

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

create table if not exists public.search_cache (
  query_hash text primary key,
  query text not null default '',
  provider text not null,
  results jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists search_cache_expires_at_idx
  on public.search_cache (expires_at);

alter table public.search_cache enable row level security;

alter table public.profiles drop column if exists stripe_customer_id;
alter table public.plans drop column if exists stripe_price_id;
alter table public.plans alter column price_label set default 'Testing access';
alter table public.subscriptions drop column if exists stripe_customer_id;
alter table public.subscriptions drop column if exists stripe_subscription_id;
alter table public.subscriptions drop column if exists stripe_price_id;
alter table public.subscriptions add column if not exists provider text not null default 'manual';
alter table public.subscriptions add column if not exists provider_customer_id text;
alter table public.subscriptions add column if not exists provider_subscription_id text;
alter table public.subscriptions add column if not exists provider_price_id text;
drop table if exists public.webhook_events;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_provider_subscription_id_key'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_provider_subscription_id_key unique (provider_subscription_id);
  end if;
end;
$$;

update public.plans
set price_label = 'Testing access', updated_at = now()
where price_label = 'Configured in Stripe';

create index if not exists subscriptions_user_updated_idx on public.subscriptions (user_id, updated_at desc);
create index if not exists conversations_user_updated_idx on public.conversations (user_id, updated_at desc) where deleted_at is null;
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index if not exists attachments_user_status_idx on public.attachments (user_id, status);
create index if not exists attachments_user_category_idx on public.attachments (user_id, category);
create index if not exists document_chunks_tsv_idx on public.document_chunks using gin (tsv);
create index if not exists document_chunks_doc_idx on public.document_chunks (document_file_id, chunk_index);
create index if not exists document_chunks_user_doc_idx on public.document_chunks (user_id, document_file_id);
create index if not exists document_files_attachment_idx on public.document_files (attachment_id);
create index if not exists document_files_user_status_idx on public.document_files (user_id, processing_status);
create index if not exists document_files_conversation_status_idx on public.document_files (conversation_id, processing_status);
create index if not exists document_jobs_claim_idx on public.document_jobs (priority desc, created_at asc) where status = 'queued';
create index if not exists document_jobs_lease_idx on public.document_jobs (lease_until) where status = 'running';
create index if not exists document_jobs_user_status_idx on public.document_jobs (user_id, status);

grant usage on schema public to anon, authenticated, service_role;
grant select on public.plans to anon, authenticated;
grant select on public.profiles, public.subscriptions, public.conversations, public.messages, public.attachments, public.document_files, public.document_chunks, public.document_jobs, public.usage_daily, public.usage_monthly to authenticated;
grant all on public.profiles, public.plans, public.subscriptions, public.conversations, public.messages, public.attachments, public.document_files, public.document_chunks, public.document_jobs, public.usage_daily, public.usage_monthly, public.usage_events, public.model_cache, public.search_cache to service_role;

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.document_files enable row level security;
alter table public.document_chunks enable row level security;
alter table public.document_jobs enable row level security;
alter table public.usage_daily enable row level security;
alter table public.usage_monthly enable row level security;
alter table public.usage_events enable row level security;
alter table public.model_cache enable row level security;

drop policy if exists "profiles read own" on public.profiles;
drop policy if exists "plans read active" on public.plans;
drop policy if exists "subscriptions read own" on public.subscriptions;
drop policy if exists "conversations read own" on public.conversations;
drop policy if exists "messages read own" on public.messages;
drop policy if exists "attachments read own" on public.attachments;
drop policy if exists "document files read own" on public.document_files;
drop policy if exists "document chunks read own" on public.document_chunks;
drop policy if exists "document jobs read own" on public.document_jobs;
drop policy if exists "usage daily read own" on public.usage_daily;
drop policy if exists "usage monthly read own" on public.usage_monthly;

create policy "profiles read own" on public.profiles for select using (auth.uid() = id);
create policy "plans read active" on public.plans for select using (active = true);
create policy "subscriptions read own" on public.subscriptions for select using (auth.uid() = user_id);
create policy "conversations read own" on public.conversations for select using (auth.uid() = user_id);
create policy "messages read own" on public.messages for select using (auth.uid() = user_id);
create policy "attachments read own" on public.attachments for select using (auth.uid() = user_id);
create policy "document files read own" on public.document_files for select using (auth.uid() = user_id);
create policy "document chunks read own" on public.document_chunks for select using (auth.uid() = user_id);
create policy "document jobs read own" on public.document_jobs for select using (auth.uid() = user_id);
create policy "usage daily read own" on public.usage_daily for select using (auth.uid() = user_id);
create policy "usage monthly read own" on public.usage_monthly for select using (auth.uid() = user_id);

create or replace function public.smartyfy_consume_usage(
  p_user_id uuid,
  p_plan_id text,
  p_daily_message_limit integer,
  p_monthly_image_limit integer,
  p_image_count integer,
  p_message_count integer default 1
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
  v_message_count integer := greatest(coalesce(p_message_count, 1), 1);
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

  if v_daily.message_count + v_message_count > p_daily_message_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Daily message limit reached.',
      'message_count', v_daily.message_count,
      'requested_message_count', v_message_count,
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
    message_count = message_count + v_message_count,
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
    'consumed_message_count', v_message_count,
    'image_count', v_daily.image_count,
    'daily_message_limit', p_daily_message_limit,
    'monthly_image_count', v_monthly.image_count,
    'monthly_image_limit', p_monthly_image_limit
  );
end;
$$;

create or replace function public.smartyfy_consume_search(
  p_user_id uuid,
  p_plan_id text,
  p_daily_search_limit integer,
  p_search_count integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := current_date;
  v_daily public.usage_daily%rowtype;
  v_count integer := greatest(coalesce(p_search_count, 1), 1);
begin
  insert into public.usage_daily (user_id, day, plan_id)
  values (p_user_id, v_day, p_plan_id)
  on conflict (user_id, day) do nothing;

  select * into v_daily
  from public.usage_daily
  where user_id = p_user_id and day = v_day
  for update;

  if v_daily.search_count + v_count > p_daily_search_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Daily web-search limit reached for your plan.',
      'search_count', v_daily.search_count,
      'requested_search_count', v_count,
      'daily_search_limit', p_daily_search_limit
    );
  end if;

  update public.usage_daily
  set
    plan_id = p_plan_id,
    search_count = search_count + v_count,
    updated_at = now()
  where user_id = p_user_id and day = v_day
  returning * into v_daily;

  return jsonb_build_object(
    'allowed', true,
    'search_count', v_daily.search_count,
    'consumed_search_count', v_count,
    'daily_search_limit', p_daily_search_limit
  );
end;
$$;

grant execute on function public.smartyfy_consume_search(uuid, text, integer, integer) to service_role;

create or replace function public.smartyfy_consume_documents(
  p_user_id uuid,
  p_plan_id text,
  p_daily_document_tool_limit integer,
  p_daily_generated_document_limit integer,
  p_tool_count integer default 1,
  p_generated_count integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := current_date;
  v_daily public.usage_daily%rowtype;
  v_tool_count integer := greatest(coalesce(p_tool_count, 1), 0);
  v_generated_count integer := greatest(coalesce(p_generated_count, 0), 0);
begin
  insert into public.usage_daily (user_id, day, plan_id)
  values (p_user_id, v_day, p_plan_id)
  on conflict (user_id, day) do nothing;

  select * into v_daily
  from public.usage_daily
  where user_id = p_user_id and day = v_day
  for update;

  if v_daily.document_tool_count + v_tool_count > p_daily_document_tool_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Daily document tool limit reached for your plan.',
      'document_tool_count', v_daily.document_tool_count,
      'requested_document_tool_count', v_tool_count,
      'daily_document_tool_limit', p_daily_document_tool_limit
    );
  end if;

  if v_daily.generated_document_count + v_generated_count > p_daily_generated_document_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Daily generated document limit reached for your plan.',
      'generated_document_count', v_daily.generated_document_count,
      'requested_generated_document_count', v_generated_count,
      'daily_generated_document_limit', p_daily_generated_document_limit
    );
  end if;

  update public.usage_daily
  set
    plan_id = p_plan_id,
    document_tool_count = document_tool_count + v_tool_count,
    generated_document_count = generated_document_count + v_generated_count,
    updated_at = now()
  where user_id = p_user_id and day = v_day
  returning * into v_daily;

  return jsonb_build_object(
    'allowed', true,
    'document_tool_count', v_daily.document_tool_count,
    'generated_document_count', v_daily.generated_document_count,
    'consumed_document_tool_count', v_tool_count,
    'consumed_generated_document_count', v_generated_count,
    'daily_document_tool_limit', p_daily_document_tool_limit,
    'daily_generated_document_limit', p_daily_generated_document_limit
  );
end;
$$;

grant execute on function public.smartyfy_consume_documents(uuid, text, integer, integer, integer, integer) to service_role;

create or replace function public.smartyfy_claim_document_job(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns setof public.document_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with next_job as (
    select id
    from public.document_jobs
    where status = 'queued'
       or (status = 'running' and lease_until < now())
    order by priority desc, created_at asc
    for update skip locked
    limit 1
  )
  update public.document_jobs j
  set
    status = 'running',
    worker_id = p_worker_id,
    attempt_count = j.attempt_count + 1,
    lease_until = now() + (greatest(coalesce(p_lease_seconds, 120), 30) || ' seconds')::interval,
    started_at = coalesce(j.started_at, now()),
    updated_at = now()
  from next_job
  where j.id = next_job.id
  returning j.*;
end;
$$;

grant execute on function public.smartyfy_claim_document_job(text, integer) to service_role;

create or replace function public.smartyfy_search_document_chunks(
  p_user_id uuid,
  p_document_ids uuid[],
  p_query text,
  p_limit integer default 5
) returns table (
  id uuid,
  document_file_id uuid,
  chunk_index integer,
  source_type text,
  source_label text,
  text text,
  metadata jsonb,
  rank real
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_limit integer := greatest(least(coalesce(p_limit, 5), 20), 1);
  v_tsquery tsquery;
begin
  if v_query = '' then
    return query
    select c.id, c.document_file_id, c.chunk_index, c.source_type, c.source_label, c.text, c.metadata, 0::real
    from public.document_chunks c
    where c.user_id = p_user_id
      and (p_document_ids is null or cardinality(p_document_ids) = 0 or c.document_file_id = any(p_document_ids))
    order by c.document_file_id, c.chunk_index
    limit v_limit;
    return;
  end if;

  v_tsquery := plainto_tsquery('simple', v_query);

  return query
  select
    c.id,
    c.document_file_id,
    c.chunk_index,
    c.source_type,
    c.source_label,
    c.text,
    c.metadata,
    ts_rank(c.tsv, v_tsquery)::real as rank
  from public.document_chunks c
  where c.user_id = p_user_id
    and (p_document_ids is null or cardinality(p_document_ids) = 0 or c.document_file_id = any(p_document_ids))
    and c.tsv @@ v_tsquery
  order by rank desc, c.document_file_id, c.chunk_index
  limit v_limit;
end;
$$;

grant execute on function public.smartyfy_search_document_chunks(uuid, uuid[], text, integer) to service_role;
