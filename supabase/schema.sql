create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values (
  'system_prompt',
  jsonb_build_object('text', $klui_prompt$You are a thoughtful, honest, and kind AI assistant, your name is Klui (thats it).
Your goals are to:

deeply understand the user's intent,
solve problems step by step, and
communicate clearly and calmly.

Always follow these rules:
First, restate the user's goal in your own words in 1-2 short sentences. If the request is ambiguous, ask up to 2 clarifying questions before answering.

Think step by step. Break complex tasks into smaller parts, reason through them, then give a concise final answer or recommendation.

Be transparent and honest. If you are unsure, say you are unsure and offer your best approximation rather than making things up as facts.

Communicate like a patient expert teacher: simple language, no hype, no overconfidence, and no unnecessary jargon. Prefer short paragraphs and bullet points.

Adapt to the user's style and level: if they seem advanced, go deeper; if they seem new, slow down and give concrete examples.

Use the lightest structure that best fits the task-short paragraphs, bullets, steps, or a compact table, not verbose answers.

Reply in the user's language. For English prompts, answer in English. also dont use emojis and "em dash" if not needed.$klui_prompt$)
)
on conflict (key) do update
set value = excluded.value,
    updated_at = now()
where coalesce(public.app_settings.value->>'text', '') = '';

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
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
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
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  kind text not null check (kind in ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv')),
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
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'expired')),
  priority integer not null default 0,
  attempt_count integer not null default 0,
  worker_id text,
  lease_until timestamptz,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error jsonb,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.document_jobs
  add column if not exists cancel_requested boolean not null default false;

create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_message_id uuid references public.messages(id) on delete set null,
  assistant_message_id uuid references public.messages(id) on delete set null,
  query text not null,
  model text not null,
  provider text not null default 'openrouter',
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  phase text not null default 'queued',
  progress jsonb not null default '{}'::jsonb,
  title text,
  summary text,
  report_markdown text,
  sources jsonb not null default '[]'::jsonb,
  error jsonb,
  cancel_requested boolean not null default false,
  worker_id text,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  elapsed_ms integer,
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
create index if not exists attachments_conversation_idx on public.attachments (conversation_id) where conversation_id is not null;
create index if not exists attachments_message_idx on public.attachments (message_id) where message_id is not null;
create index if not exists attachments_orphan_cleanup_idx on public.attachments (created_at) where conversation_id is null and message_id is null;
create index if not exists document_chunks_tsv_idx on public.document_chunks using gin (tsv);
create index if not exists document_chunks_doc_idx on public.document_chunks (document_file_id, chunk_index);
create index if not exists document_chunks_user_doc_idx on public.document_chunks (user_id, document_file_id);
create index if not exists document_pages_doc_idx on public.document_pages (document_file_id, page_number);
create index if not exists document_pages_user_doc_idx on public.document_pages (user_id, document_file_id);
create index if not exists document_pages_embedding_hnsw_idx on public.document_pages using hnsw (embedding extensions.vector_cosine_ops) where embedding is not null;
create index if not exists document_files_attachment_idx on public.document_files (attachment_id);
create index if not exists document_files_user_status_idx on public.document_files (user_id, processing_status);
create index if not exists document_files_conversation_status_idx on public.document_files (conversation_id, processing_status);
create index if not exists document_files_message_idx on public.document_files (message_id) where message_id is not null;
create index if not exists document_files_parent_document_idx on public.document_files (parent_document_id) where parent_document_id is not null;
create index if not exists document_files_orphan_cleanup_idx on public.document_files (created_at) where conversation_id is null and message_id is null;
create index if not exists document_jobs_claim_idx on public.document_jobs (priority desc, created_at asc) where status = 'queued';
create index if not exists document_jobs_lease_idx on public.document_jobs (lease_until) where status = 'running';
create index if not exists document_jobs_user_status_idx on public.document_jobs (user_id, status);
create index if not exists document_jobs_document_file_idx on public.document_jobs (document_file_id) where document_file_id is not null;
create index if not exists document_jobs_conversation_idx on public.document_jobs (conversation_id) where conversation_id is not null;
create index if not exists document_jobs_message_idx on public.document_jobs (message_id) where message_id is not null;
create index if not exists document_jobs_orphan_cleanup_idx on public.document_jobs (created_at) where conversation_id is null and message_id is null and document_file_id is null and status in ('succeeded', 'failed', 'expired');
create unique index if not exists document_jobs_extract_once_idx on public.document_jobs (document_file_id, job_type) where document_file_id is not null and job_type like 'document.extract.%';
create index if not exists research_runs_claim_idx on public.research_runs (created_at asc) where status = 'queued';
create index if not exists research_runs_lease_idx on public.research_runs (lease_until) where status = 'running';
create index if not exists research_runs_user_status_idx on public.research_runs (user_id, status);
create unique index if not exists research_runs_one_active_per_user_idx on public.research_runs (user_id) where status in ('queued', 'running');
create index if not exists research_runs_conversation_idx on public.research_runs (conversation_id, created_at desc);
create index if not exists research_runs_user_message_idx on public.research_runs (user_message_id) where user_message_id is not null;
create index if not exists research_runs_assistant_message_idx on public.research_runs (assistant_message_id) where assistant_message_id is not null;
create index if not exists payment_requests_user_created_idx on public.payment_requests (user_id, created_at desc);
create index if not exists payment_requests_status_created_idx on public.payment_requests (status, created_at desc);

grant usage on schema public to anon, authenticated, service_role;
grant select on public.plans to anon, authenticated;
grant select on public.profiles, public.subscriptions, public.payment_requests, public.conversations, public.messages, public.attachments, public.document_files, public.document_chunks, public.document_pages, public.document_jobs to authenticated;
grant select on public.research_runs to authenticated;
grant select on public.usage_api_weekly to authenticated;
grant all on public.profiles, public.app_settings, public.plans, public.subscriptions, public.payment_requests, public.conversations, public.messages, public.attachments, public.document_files, public.document_chunks, public.document_pages, public.document_jobs, public.usage_api_weekly, public.usage_api_events, public.model_cache, public.search_cache to service_role;
grant all on public.research_runs to service_role;

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
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
alter table public.research_runs enable row level security;
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
drop policy if exists "research runs read own" on public.research_runs;
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
create policy "research runs read own" on public.research_runs for select to authenticated using ((select auth.uid()) = user_id);
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

create or replace function public.klui_cleanup_storage_and_cache(
  p_limit integer default 500,
  p_grace interval default interval '7 days'
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_grace interval := coalesce(p_grace, interval '7 days');
  v_jobs_deleted integer := 0;
  v_attachments_deleted integer := 0;
  v_document_files_deleted integer := 0;
  v_search_cache_deleted integer := 0;
  v_model_cache_deleted integer := 0;
begin
  if v_grace < interval '1 day' then
    v_grace := interval '1 day';
  end if;

  with doomed as (
    select id
    from public.document_jobs
    where conversation_id is null
      and message_id is null
      and document_file_id is null
      and status in ('succeeded', 'failed', 'expired')
      and created_at < now() - v_grace
    order by created_at asc
    limit v_limit
  ),
  deleted as (
    delete from public.document_jobs j
    using doomed d
    where j.id = d.id
    returning j.id
  )
  select count(*) into v_jobs_deleted from deleted;

  with doomed as (
    select id
    from public.attachments
    where conversation_id is null
      and message_id is null
      and created_at < now() - v_grace
    order by created_at asc
    limit v_limit
  ),
  deleted as (
    delete from public.attachments a
    using doomed d
    where a.id = d.id
    returning a.id
  )
  select count(*) into v_attachments_deleted from deleted;

  with doomed as (
    select df.id
    from public.document_files df
    where df.conversation_id is null
      and df.message_id is null
      and df.created_at < now() - v_grace
      and not exists (
        select 1
        from public.attachments a
        where a.id = df.attachment_id
      )
    order by df.created_at asc
    limit v_limit
  ),
  deleted as (
    delete from public.document_files df
    using doomed d
    where df.id = d.id
    returning df.id
  )
  select count(*) into v_document_files_deleted from deleted;

  with doomed as (
    select query_hash
    from public.search_cache
    where expires_at < now()
    order by expires_at asc
    limit v_limit
  ),
  deleted as (
    delete from public.search_cache sc
    using doomed d
    where sc.query_hash = d.query_hash
    returning sc.query_hash
  )
  select count(*) into v_search_cache_deleted from deleted;

  with doomed as (
    select id
    from public.model_cache
    where fetched_at < now() - v_grace
    order by fetched_at asc
    limit v_limit
  ),
  deleted as (
    delete from public.model_cache mc
    using doomed d
    where mc.id = d.id
    returning mc.id
  )
  select count(*) into v_model_cache_deleted from deleted;

  return jsonb_build_object(
    'document_jobs_deleted', v_jobs_deleted,
    'attachments_deleted', v_attachments_deleted,
    'document_files_deleted', v_document_files_deleted,
    'search_cache_deleted', v_search_cache_deleted,
    'model_cache_deleted', v_model_cache_deleted
  );
end;
$$;

revoke all on function public.klui_cleanup_orphan_documents(integer, interval) from public, anon, authenticated;
revoke all on function public.klui_cleanup_storage_and_cache(integer, interval) from public, anon, authenticated;
grant execute on function public.klui_cleanup_storage_and_cache(integer, interval) to service_role;

create or replace function public.klui_cleanup_orphan_documents(
  p_limit integer default 500,
  p_grace interval default interval '7 days'
) returns jsonb
language sql
set search_path = public
as $$
  select public.klui_cleanup_storage_and_cache(p_limit, p_grace);
$$;

revoke all on function public.klui_cleanup_orphan_documents(integer, interval) from public, anon, authenticated;
grant execute on function public.klui_cleanup_orphan_documents(integer, interval) to service_role;

create or replace function public.klui_claim_document_job(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns setof public.document_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  with exhausted as (
    update public.document_jobs
    set status = 'failed',
        error = jsonb_build_object('code', 'worker_retries_exhausted', 'message', 'Document processing stopped after repeated worker failures.'),
        finished_at = now(),
        lease_until = null,
        updated_at = now()
    where status = 'running'
      and lease_until < now()
      and attempt_count >= 3
    returning document_file_id, error
  )
  update public.document_files d
  set processing_status = 'failed',
      error = exhausted.error,
      updated_at = now()
  from exhausted
  where d.id = exhausted.document_file_id;

  return query
  with next_job as (
    select id
    from public.document_jobs
    where (status = 'queued' and cancel_requested = false)
       or (status = 'running' and lease_until < now() and attempt_count < 3)
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

create or replace function public.klui_complete_document_upload(
  p_user_id uuid,
  p_attachment_id uuid,
  p_size_bytes integer,
  p_etag text,
  p_kind text,
  p_limits jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment public.attachments;
  v_document public.document_files;
  v_job public.document_jobs;
begin
  if p_kind not in ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv') then
    raise exception 'unsupported_document_kind';
  end if;

  select * into v_attachment
  from public.attachments
  where id = p_attachment_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'attachment_not_found';
  end if;
  if v_attachment.category <> 'document' then
    raise exception 'attachment_is_not_document';
  end if;

  update public.attachments
  set status = 'uploaded',
      uploaded_at = coalesce(uploaded_at, now()),
      size_bytes = coalesce(p_size_bytes, size_bytes),
      etag = coalesce(p_etag, etag)
  where id = v_attachment.id
  returning * into v_attachment;

  insert into public.document_files (
    attachment_id, user_id, conversation_id, message_id, kind, source,
    source_etag, processing_status, metadata
  ) values (
    v_attachment.id, v_attachment.user_id, v_attachment.conversation_id,
    v_attachment.message_id, p_kind, 'upload', v_attachment.etag, 'pending',
    jsonb_build_object(
      'file_name', v_attachment.file_name,
      'content_type', v_attachment.content_type,
      'size_bytes', v_attachment.size_bytes
    )
  )
  on conflict (attachment_id) do update
    set source_etag = coalesce(excluded.source_etag, public.document_files.source_etag),
        updated_at = now()
  returning * into v_document;

  insert into public.document_jobs (
    user_id, document_file_id, conversation_id, message_id, job_type, input
  ) values (
    v_attachment.user_id, v_document.id, v_attachment.conversation_id,
    v_attachment.message_id, 'document.extract.' || p_kind,
    jsonb_build_object(
      'attachment_id', v_attachment.id,
      'object_key', v_attachment.object_key,
      'file_name', v_attachment.file_name,
      'content_type', v_attachment.content_type,
      'size_bytes', v_attachment.size_bytes,
      'etag', v_attachment.etag,
      'limits', coalesce(p_limits, '{}'::jsonb)
    )
  )
  on conflict do nothing
  returning * into v_job;

  if v_job.id is null then
    select * into v_job
    from public.document_jobs
    where document_file_id = v_document.id
      and job_type = 'document.extract.' || p_kind
    order by created_at asc
    limit 1;
  end if;

  return jsonb_build_object(
    'attachment', to_jsonb(v_attachment),
    'document_file', to_jsonb(v_document),
    'job', to_jsonb(v_job)
  );
end;
$$;

revoke all on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb) to service_role;

create or replace function public.klui_claim_research_run(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns setof public.research_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with next_run as (
    select id
    from public.research_runs
    where status = 'queued' and cancel_requested = false
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.research_runs r
  set
    status = 'running',
    phase = 'planning',
    worker_id = p_worker_id,
    attempt_count = r.attempt_count + 1,
    lease_until = now() + (greatest(coalesce(p_lease_seconds, 120), 30) || ' seconds')::interval,
    started_at = coalesce(r.started_at, now()),
    updated_at = now()
  from next_run
  where r.id = next_run.id
  returning r.*;
end;
$$;

revoke all on function public.klui_claim_research_run(text, integer) from public, anon, authenticated;
grant execute on function public.klui_claim_research_run(text, integer) to service_role;

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
