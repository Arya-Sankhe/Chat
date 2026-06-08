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
  max_images_per_message integer not null,
  price_label text not null default 'Manual payment',
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plans (id, name, max_images_per_message, sort_order)
values
  ('lite', 'Lite', 4, 10),
  ('essential', 'Essential', 4, 20),
  ('pro', 'Pro', 4, 30)
on conflict (id) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    active = true,
    updated_at = now();

update public.plans
set active = false, updated_at = now()
where id not in ('lite', 'essential', 'pro');

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

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_file_id uuid not null references public.document_files(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  page_number integer not null,
  source_label text not null,
  image_key text not null,
  image_content_type text not null default 'image/jpeg',
  width_px integer,
  height_px integer,
  text text not null default '',
  char_count integer not null default 0,
  token_estimate integer not null default 0,
  embedding extensions.vector(768),
  embedding_model text,
  embedding_dimensions integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_file_id, page_number)
);

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

create table if not exists public.usage_api_weekly (
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  week_index integer not null check (week_index between 1 and 4),
  week_start date not null,
  week_end date not null,
  plan_id text not null,
  api_credit_limit numeric(18,8) not null default 0,
  api_credit_used numeric(18,8) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start, week_index)
);

create table if not exists public.usage_api_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  plan_id text,
  provider text,
  model text,
  generation_id text,
  period_start date not null,
  period_end date not null,
  week_index integer not null check (week_index between 1 and 4),
  week_start date not null,
  week_end date not null,
  cost_credits numeric(18,8) not null default 0,
  cost_source text not null default 'unknown',
  usage jsonb not null default '{}'::jsonb,
  status text not null default 'completed',
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
alter table public.plans alter column price_label set default 'Manual payment';
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
set price_label = 'Manual payment', updated_at = now()
where price_label = 'Configured in Stripe';

create index if not exists subscriptions_user_updated_idx on public.subscriptions (user_id, updated_at desc);
create index if not exists conversations_user_updated_idx on public.conversations (user_id, updated_at desc) where deleted_at is null;
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index if not exists attachments_user_status_idx on public.attachments (user_id, status);
create index if not exists attachments_user_category_idx on public.attachments (user_id, category);
create index if not exists document_chunks_tsv_idx on public.document_chunks using gin (tsv);
create index if not exists document_chunks_doc_idx on public.document_chunks (document_file_id, chunk_index);
create index if not exists document_chunks_user_doc_idx on public.document_chunks (user_id, document_file_id);
create index if not exists document_pages_doc_idx on public.document_pages (document_file_id, page_number);
create index if not exists document_pages_user_doc_idx on public.document_pages (user_id, document_file_id);
create index if not exists document_pages_embedding_hnsw_idx on public.document_pages using hnsw (embedding extensions.vector_cosine_ops) where embedding is not null;
create index if not exists document_files_attachment_idx on public.document_files (attachment_id);
create index if not exists document_files_user_status_idx on public.document_files (user_id, processing_status);
create index if not exists document_files_conversation_status_idx on public.document_files (conversation_id, processing_status);
create index if not exists document_jobs_claim_idx on public.document_jobs (priority desc, created_at asc) where status = 'queued';
create index if not exists document_jobs_lease_idx on public.document_jobs (lease_until) where status = 'running';
create index if not exists document_jobs_user_status_idx on public.document_jobs (user_id, status);
create index if not exists payment_requests_user_created_idx on public.payment_requests (user_id, created_at desc);
create index if not exists payment_requests_status_created_idx on public.payment_requests (status, created_at desc);

grant usage on schema public to anon, authenticated, service_role;
grant select on public.plans to anon, authenticated;
grant select on public.profiles, public.subscriptions, public.payment_requests, public.conversations, public.messages, public.attachments, public.document_files, public.document_chunks, public.document_pages, public.document_jobs to authenticated;
grant select on public.usage_api_weekly to authenticated;
grant all on public.profiles, public.plans, public.subscriptions, public.payment_requests, public.conversations, public.messages, public.attachments, public.document_files, public.document_chunks, public.document_pages, public.document_jobs, public.usage_api_weekly, public.usage_api_events, public.model_cache, public.search_cache to service_role;

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payment_requests enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.document_files enable row level security;
alter table public.document_chunks enable row level security;
alter table public.document_pages enable row level security;
alter table public.document_jobs enable row level security;
alter table public.usage_api_weekly enable row level security;
alter table public.usage_api_events enable row level security;
alter table public.model_cache enable row level security;

drop policy if exists "profiles read own" on public.profiles;
drop policy if exists "plans read active" on public.plans;
drop policy if exists "subscriptions read own" on public.subscriptions;
drop policy if exists "payment requests read own" on public.payment_requests;
drop policy if exists "conversations read own" on public.conversations;
drop policy if exists "messages read own" on public.messages;
drop policy if exists "attachments read own" on public.attachments;
drop policy if exists "document files read own" on public.document_files;
drop policy if exists "document chunks read own" on public.document_chunks;
drop policy if exists "document pages read own" on public.document_pages;
drop policy if exists "document jobs read own" on public.document_jobs;
drop policy if exists "usage api weekly read own" on public.usage_api_weekly;

create policy "profiles read own" on public.profiles for select using (auth.uid() = id);
create policy "plans read active" on public.plans for select using (active = true);
create policy "subscriptions read own" on public.subscriptions for select using (auth.uid() = user_id);
create policy "payment requests read own" on public.payment_requests for select using (auth.uid() = user_id);
create policy "conversations read own" on public.conversations for select using (auth.uid() = user_id);
create policy "messages read own" on public.messages for select using (auth.uid() = user_id);
create policy "attachments read own" on public.attachments for select using (auth.uid() = user_id);
create policy "document files read own" on public.document_files for select using (auth.uid() = user_id);
create policy "document chunks read own" on public.document_chunks for select using (auth.uid() = user_id);
create policy "document pages read own" on public.document_pages for select using (auth.uid() = user_id);
create policy "document jobs read own" on public.document_jobs for select using (auth.uid() = user_id);
create policy "usage api weekly read own" on public.usage_api_weekly for select using (auth.uid() = user_id);

create or replace function public.klui_check_api_budget(
  p_user_id uuid,
  p_plan_id text,
  p_period_start date,
  p_period_end date,
  p_week_start date,
  p_week_end date,
  p_week_index integer,
  p_weekly_credit_limit numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.usage_api_weekly%rowtype;
begin
  insert into public.usage_api_weekly (
    user_id, period_start, period_end, week_index, week_start, week_end, plan_id, api_credit_limit
  )
  values (
    p_user_id, p_period_start, p_period_end, p_week_index, p_week_start, p_week_end, p_plan_id, greatest(coalesce(p_weekly_credit_limit, 0), 0)
  )
  on conflict (user_id, period_start, week_index) do update
  set
    period_end = excluded.period_end,
    week_start = excluded.week_start,
    week_end = excluded.week_end,
    plan_id = excluded.plan_id,
    api_credit_limit = excluded.api_credit_limit,
    updated_at = now();

  select * into v_row
  from public.usage_api_weekly
  where user_id = p_user_id
    and period_start = p_period_start
    and week_index = p_week_index
  for update;

  if v_row.api_credit_limit <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'API usage is not enabled for your plan.');
  end if;

  if v_row.api_credit_used >= v_row.api_credit_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Weekly API limit reached.',
      'api_credit_used', v_row.api_credit_used,
      'api_credit_limit', v_row.api_credit_limit,
      'week_index', v_row.week_index,
      'week_start', v_row.week_start,
      'week_end', v_row.week_end
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'api_credit_used', v_row.api_credit_used,
    'api_credit_limit', v_row.api_credit_limit,
    'week_index', v_row.week_index,
    'week_start', v_row.week_start,
    'week_end', v_row.week_end
  );
end;
$$;

create or replace function public.klui_record_api_usage(
  p_user_id uuid,
  p_subscription_id uuid,
  p_plan_id text,
  p_model text,
  p_provider text,
  p_generation_id text,
  p_period_start date,
  p_period_end date,
  p_week_start date,
  p_week_end date,
  p_week_index integer,
  p_weekly_credit_limit numeric,
  p_cost_credits numeric,
  p_cost_source text,
  p_usage jsonb,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit numeric := greatest(coalesce(p_weekly_credit_limit, 0), 0);
  v_cost numeric := greatest(coalesce(p_cost_credits, 0), 0);
  v_row public.usage_api_weekly%rowtype;
begin
  insert into public.usage_api_weekly (
    user_id, period_start, period_end, week_index, week_start, week_end, plan_id, api_credit_limit, api_credit_used
  )
  values (
    p_user_id, p_period_start, p_period_end, p_week_index, p_week_start, p_week_end, p_plan_id, v_limit, 0
  )
  on conflict (user_id, period_start, week_index) do update
  set
    period_end = excluded.period_end,
    week_start = excluded.week_start,
    week_end = excluded.week_end,
    plan_id = excluded.plan_id,
    api_credit_limit = excluded.api_credit_limit,
    updated_at = now();

  update public.usage_api_weekly
  set
    plan_id = p_plan_id,
    api_credit_used = api_credit_used + v_cost,
    updated_at = now()
  where user_id = p_user_id
    and period_start = p_period_start
    and week_index = p_week_index
  returning * into v_row;

  insert into public.usage_api_events (
    user_id, subscription_id, plan_id, provider, model, generation_id,
    period_start, period_end, week_index, week_start, week_end,
    cost_credits, cost_source, usage, status
  )
  values (
    p_user_id, p_subscription_id, p_plan_id, p_provider, p_model, p_generation_id,
    v_row.period_start, v_row.period_end, v_row.week_index, v_row.week_start, v_row.week_end,
    v_cost, coalesce(p_cost_source, 'unknown'), coalesce(p_usage, '{}'::jsonb), coalesce(p_status, 'completed')
  );

  return jsonb_build_object(
    'allowed', true,
    'api_credit_used', v_row.api_credit_used,
    'api_credit_limit', v_row.api_credit_limit,
    'cost_credits', v_cost,
    'cost_source', coalesce(p_cost_source, 'unknown'),
    'week_index', v_row.week_index
  );
end;
$$;

grant execute on function public.klui_check_api_budget(uuid, text, date, date, date, date, integer, numeric) to service_role;
grant execute on function public.klui_record_api_usage(uuid, uuid, text, text, text, text, date, date, date, date, integer, numeric, numeric, text, jsonb, text) to service_role;

create or replace function public.klui_claim_document_job(
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

grant execute on function public.klui_claim_document_job(text, integer) to service_role;

create or replace function public.klui_search_document_chunks(
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

grant execute on function public.klui_search_document_chunks(uuid, uuid[], text, integer) to service_role;

create or replace function public.klui_search_document_pages(
  p_user_id uuid,
  p_document_ids uuid[],
  p_query_embedding text,
  p_limit integer default 8
) returns table (
  id uuid,
  document_file_id uuid,
  page_number integer,
  source_label text,
  image_key text,
  image_content_type text,
  width_px integer,
  height_px integer,
  text text,
  metadata jsonb,
  distance real
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 8), 40), 1);
  v_embedding extensions.vector(768);
begin
  if trim(coalesce(p_query_embedding, '')) = '' then
    return query
    select
      p.id,
      p.document_file_id,
      p.page_number,
      p.source_label,
      p.image_key,
      p.image_content_type,
      p.width_px,
      p.height_px,
      p.text,
      p.metadata,
      0::real as distance
    from public.document_pages p
    where p.user_id = p_user_id
      and (p_document_ids is null or cardinality(p_document_ids) = 0 or p.document_file_id = any(p_document_ids))
    order by p.document_file_id, p.page_number
    limit v_limit;
    return;
  end if;

  v_embedding := p_query_embedding::extensions.vector;

  return query
  select
    p.id,
    p.document_file_id,
    p.page_number,
    p.source_label,
    p.image_key,
    p.image_content_type,
    p.width_px,
    p.height_px,
    p.text,
    p.metadata,
    (p.embedding <=> v_embedding)::real as distance
  from public.document_pages p
  where p.user_id = p_user_id
    and p.embedding is not null
    and (p_document_ids is null or cardinality(p_document_ids) = 0 or p.document_file_id = any(p_document_ids))
  order by p.embedding <=> v_embedding, p.document_file_id, p.page_number
  limit v_limit;
end;
$$;

grant execute on function public.klui_search_document_pages(uuid, uuid[], text, integer) to service_role;
