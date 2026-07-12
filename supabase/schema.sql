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
    'attachments_deleted', 0,
    'document_files_deleted', 0,
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

revoke all on function public.klui_claim_document_job(text, integer)
  from public, anon, authenticated;
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

-- Rev 3 document capability pipeline and durable pending turns.
alter table public.document_files
  add column if not exists text_ready_at timestamptz,
  add column if not exists visual_ready_at timestamptz,
  add column if not exists enriched_at timestamptz,
  add column if not exists stage_errors jsonb not null default '{}'::jsonb;

update public.document_files d
set text_ready_at = coalesce(d.text_ready_at, d.updated_at)
where d.processing_status = 'ready'
  and (
    d.kind <> 'pdf'
    or exists (
      select 1
      from public.document_chunks c
      where c.document_file_id = d.id
        and length(trim(c.text)) > 0
    )
  );

update public.document_files d
set visual_ready_at = coalesce(d.visual_ready_at, d.updated_at)
where d.processing_status = 'ready'
  and d.kind = 'pdf'
  and exists (
    select 1
    from public.document_pages p
    where p.document_file_id = d.id
      and p.image_key <> ''
  );

update public.document_files d
set enriched_at = coalesce(d.enriched_at, d.updated_at)
where d.processing_status = 'ready'
  and d.kind = 'pdf'
  and exists (
    select 1
    from public.document_pages p
    where p.document_file_id = d.id
  )
  and not exists (
    select 1
    from public.document_pages p
    where p.document_file_id = d.id
      and p.embedding is null
  );

create table if not exists public.pending_document_turns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  client_turn_key uuid not null,
  user_message_id uuid references public.messages(id) on delete set null,
  mode text not null check (mode in ('single', 'compare', 'council')),
  request_payload jsonb not null default '{}'::jsonb,
  status text not null default 'waiting_documents'
    check (status in ('waiting_documents', 'running', 'done', 'failed', 'cancelled')),
  claim_token uuid,
  claimed_by text,
  lease_until timestamptz,
  provider_started_at timestamptz,
  cancel_requested boolean not null default false,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, client_turn_key)
);

alter table public.messages
  add column if not exists turn_run_id uuid references public.pending_document_turns(id) on delete set null,
  add column if not exists output_slot text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_turn_output_unique'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_turn_output_unique unique (turn_run_id, output_slot);
  end if;
end;
$$;

create index if not exists document_files_text_ready_idx
  on public.document_files (user_id, conversation_id, text_ready_at)
  where text_ready_at is not null;
create index if not exists document_files_visual_ready_idx
  on public.document_files (user_id, conversation_id, visual_ready_at)
  where visual_ready_at is not null;
create index if not exists pending_document_turns_conversation_active_idx
  on public.pending_document_turns (user_id, conversation_id, created_at)
  where status in ('waiting_documents', 'running');
create index if not exists pending_document_turns_lease_idx
  on public.pending_document_turns (lease_until)
  where status = 'running';
create index if not exists pending_document_turns_terminal_cleanup_idx
  on public.pending_document_turns (finished_at)
  where status in ('done', 'failed', 'cancelled');
drop index if exists public.document_jobs_extract_once_idx;
create unique index if not exists document_jobs_core_once_idx
  on public.document_jobs (document_file_id, job_type)
  where document_file_id is not null
    and (job_type like 'document.extract.%' or job_type = 'document.enrich.pdf');
create unique index if not exists document_jobs_render_page_once_idx
  on public.document_jobs (document_file_id, ((input ->> 'page_number')::integer))
  where document_file_id is not null
    and job_type = 'document.render_page';

grant select on public.pending_document_turns to authenticated;
grant all on public.pending_document_turns to service_role;
alter table public.pending_document_turns enable row level security;
drop policy if exists "pending document turns read own" on public.pending_document_turns;
create policy "pending document turns read own"
  on public.pending_document_turns
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

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
  v_jobs jsonb;
begin
  if p_kind not in ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv') then
    raise exception 'unsupported_document_kind';
  end if;

  select * into v_attachment
  from public.attachments
  where id = p_attachment_id and user_id = p_user_id
  for update;

  if not found then raise exception 'attachment_not_found'; end if;
  if v_attachment.category <> 'document' then raise exception 'attachment_is_not_document'; end if;

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
    user_id, document_file_id, conversation_id, message_id, job_type, priority, input
  )
  select
    v_attachment.user_id,
    v_document.id,
    v_attachment.conversation_id,
    v_attachment.message_id,
    queued.job_type,
    queued.priority,
    jsonb_build_object(
      'attachment_id', v_attachment.id,
      'object_key', v_attachment.object_key,
      'file_name', v_attachment.file_name,
      'content_type', v_attachment.content_type,
      'size_bytes', v_attachment.size_bytes,
      'etag', v_attachment.etag,
      'limits', coalesce(p_limits, '{}'::jsonb)
    )
  from (
    select 'document.extract.' || p_kind as job_type, 10 as priority
    union all
    select 'document.enrich.pdf', 0
    where p_kind in ('pdf', 'docx', 'xlsx', 'pptx')
  ) queued
  on conflict do nothing;

  select coalesce(jsonb_agg(to_jsonb(j) order by j.priority desc, j.created_at asc), '[]'::jsonb)
  into v_jobs
  from public.document_jobs j
  where j.document_file_id = v_document.id
    and (j.job_type = 'document.extract.' || p_kind
      or (p_kind in ('pdf', 'docx', 'xlsx', 'pptx') and j.job_type = 'document.enrich.pdf'));

  return jsonb_build_object(
    'attachment', to_jsonb(v_attachment),
    'document_file', to_jsonb(v_document),
    'job', coalesce(v_jobs -> 0, 'null'::jsonb),
    'jobs', v_jobs
  );
end;
$$;

revoke all on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb)
  to service_role;

create or replace function public.klui_complete_document_job(
  p_job_id uuid,
  p_worker_id text,
  p_output jsonb default '{}'::jsonb,
  p_document_patch jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_jobs;
  v_document public.document_files;
  v_has_active_core boolean;
begin
  update public.document_jobs
  set status = 'succeeded',
      output = coalesce(p_output, '{}'::jsonb),
      error = null,
      finished_at = now(),
      lease_until = null,
      updated_at = now()
  where id = p_job_id
    and status = 'running'
    and worker_id = p_worker_id
    and lease_until >= now()
  returning * into v_job;

  if v_job.id is null then return null; end if;
  if v_job.document_file_id is null then return to_jsonb(v_job); end if;

  update public.document_files
  set text_ready_at = case
        when p_document_patch ? 'text_ready_at'
          then coalesce(text_ready_at, (p_document_patch ->> 'text_ready_at')::timestamptz)
        else text_ready_at
      end,
      visual_ready_at = case
        when p_document_patch ? 'visual_ready_at'
          then coalesce(visual_ready_at, (p_document_patch ->> 'visual_ready_at')::timestamptz)
        else visual_ready_at
      end,
      enriched_at = case
        when p_document_patch ? 'enriched_at'
          then coalesce(enriched_at, (p_document_patch ->> 'enriched_at')::timestamptz)
        else enriched_at
      end,
      page_count = case when p_document_patch ? 'page_count'
        then (p_document_patch ->> 'page_count')::integer else page_count end,
      word_count = case when p_document_patch ? 'word_count'
        then (p_document_patch ->> 'word_count')::integer else word_count end,
      extraction_key = case when p_document_patch ? 'extraction_key'
        then p_document_patch ->> 'extraction_key' else extraction_key end,
      metadata = case when jsonb_typeof(p_document_patch -> 'metadata') = 'object'
        then metadata || (p_document_patch -> 'metadata') else metadata end,
      stage_errors = case when jsonb_typeof(p_document_patch -> 'stage_errors') = 'object'
        then stage_errors || (p_document_patch -> 'stage_errors') else stage_errors end,
      error = case when p_document_patch ? 'error'
        then nullif(p_document_patch -> 'error', 'null'::jsonb) else error end,
      updated_at = now()
  where id = v_job.document_file_id
  returning * into v_document;

  select exists (
    select 1
    from public.document_jobs j
    where j.document_file_id = v_job.document_file_id
      and (j.job_type like 'document.extract.%' or j.job_type = 'document.enrich.pdf')
      and j.status in ('queued', 'running')
      and j.cancel_requested = false
  ) into v_has_active_core;

  update public.document_files
  set processing_status = case
        when v_has_active_core then 'processing'
        when text_ready_at is not null or visual_ready_at is not null then 'ready'
        else 'failed'
      end,
      error = case
        when not v_has_active_core and text_ready_at is null and visual_ready_at is null
          then coalesce(error, jsonb_build_object('code', 'document_unusable', 'message', 'No usable document content could be prepared.'))
        else error
      end,
      updated_at = now()
  where id = v_job.document_file_id
  returning * into v_document;

  return jsonb_build_object('job', to_jsonb(v_job), 'document_file', to_jsonb(v_document));
end;
$$;

revoke all on function public.klui_complete_document_job(uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_complete_document_job(uuid, text, jsonb, jsonb)
  to service_role;

create or replace function public.klui_publish_document_visual_ready(
  p_job_id uuid,
  p_worker_id text,
  p_document_file_id uuid,
  p_page_count integer,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_jobs;
  v_document public.document_files;
  v_published integer;
begin
  select * into v_job
  from public.document_jobs
  where id = p_job_id
    and document_file_id = p_document_file_id
    and job_type = 'document.enrich.pdf'
    and status = 'running'
    and worker_id = p_worker_id
    and lease_until >= now()
  for update;
  if not found then return null; end if;

  select count(*) into v_published
  from public.document_pages
  where document_file_id = p_document_file_id
    and image_key is not null
    and image_key <> '';

  if p_page_count is null or p_page_count < 1 or v_published <> p_page_count then
    raise exception 'visual_manifest_incomplete';
  end if;

  update public.document_files
  set visual_ready_at = coalesce(visual_ready_at, now()),
      page_count = p_page_count,
      metadata = case when jsonb_typeof(p_metadata) = 'object'
        then metadata || p_metadata else metadata end,
      updated_at = now()
  where id = p_document_file_id
  returning * into v_document;

  return to_jsonb(v_document);
end;
$$;

revoke all on function public.klui_publish_document_visual_ready(uuid, text, uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_publish_document_visual_ready(uuid, text, uuid, integer, jsonb)
  to service_role;

create or replace function public.klui_fail_document_job(
  p_job_id uuid,
  p_worker_id text,
  p_error jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_jobs;
  v_document public.document_files;
  v_stage_key text;
  v_has_active_core boolean;
begin
  update public.document_jobs
  set status = 'failed',
      error = coalesce(p_error, jsonb_build_object('code', 'worker_error', 'message', 'Document processing failed.')),
      finished_at = now(),
      lease_until = null,
      updated_at = now()
  where id = p_job_id
    and status = 'running'
    and worker_id = p_worker_id
    and lease_until >= now()
  returning * into v_job;

  if v_job.id is null then return null; end if;
  if v_job.document_file_id is null or v_job.job_type = 'document.render_page' then
    return jsonb_build_object('job', to_jsonb(v_job));
  end if;

  v_stage_key := case
    when v_job.job_type = 'document.enrich.pdf' then 'visual'
    when v_job.job_type like 'document.extract.%' then 'text'
    else 'processing'
  end;

  update public.document_files
  set stage_errors = stage_errors || jsonb_build_object(v_stage_key, v_job.error),
      updated_at = now()
  where id = v_job.document_file_id;

  select exists (
    select 1
    from public.document_jobs j
    where j.document_file_id = v_job.document_file_id
      and (j.job_type like 'document.extract.%' or j.job_type = 'document.enrich.pdf')
      and j.status in ('queued', 'running')
      and j.cancel_requested = false
  ) into v_has_active_core;

  update public.document_files
  set processing_status = case
        when v_has_active_core then 'processing'
        when text_ready_at is not null or visual_ready_at is not null then 'ready'
        else 'failed'
      end,
      error = case
        when not v_has_active_core and text_ready_at is null and visual_ready_at is null
          then v_job.error
        else error
      end,
      updated_at = now()
  where id = v_job.document_file_id
  returning * into v_document;

  return jsonb_build_object('job', to_jsonb(v_job), 'document_file', to_jsonb(v_document));
end;
$$;

revoke all on function public.klui_fail_document_job(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_fail_document_job(uuid, text, jsonb)
  to service_role;

create or replace function public.klui_claim_document_job(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns setof public.document_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_failed record;
  v_has_active_core boolean;
begin
  for v_failed in
    update public.document_jobs
    set status = 'failed',
        error = case
          when cancel_requested then jsonb_build_object('code', 'job_cancelled', 'message', 'Document processing was cancelled.')
          else jsonb_build_object('code', 'worker_retries_exhausted', 'message', 'Document processing stopped after repeated worker failures.')
        end,
        finished_at = now(),
        lease_until = null,
        updated_at = now()
    where status = 'running'
      and lease_until < now()
      and (cancel_requested = true or attempt_count >= 3)
    returning document_file_id, job_type, error
  loop
    if v_failed.document_file_id is null or v_failed.job_type = 'document.render_page' then
      continue;
    end if;

    update public.document_files
    set stage_errors = stage_errors || jsonb_build_object(
          case when v_failed.job_type = 'document.enrich.pdf' then 'visual' else 'text' end,
          v_failed.error
        ),
        updated_at = now()
    where id = v_failed.document_file_id;

    select exists (
      select 1
      from public.document_jobs j
      where j.document_file_id = v_failed.document_file_id
        and (j.job_type like 'document.extract.%' or j.job_type = 'document.enrich.pdf')
        and j.status in ('queued', 'running')
        and j.cancel_requested = false
    ) into v_has_active_core;

    update public.document_files
    set processing_status = case
          when v_has_active_core then 'processing'
          when text_ready_at is not null or visual_ready_at is not null then 'ready'
          else 'failed'
        end,
        error = case
          when not v_has_active_core and text_ready_at is null and visual_ready_at is null
            then v_failed.error
          else error
        end,
        updated_at = now()
    where id = v_failed.document_file_id;
  end loop;

  return query
  with next_job as (
    select id
    from public.document_jobs
    where cancel_requested = false
      and (
        status = 'queued'
        or (status = 'running' and lease_until < now() and attempt_count < 3)
      )
    order by priority desc, created_at asc
    for update skip locked
    limit 1
  )
  update public.document_jobs j
  set status = 'running',
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

revoke all on function public.klui_claim_document_job(text, integer)
  from public, anon, authenticated;
grant execute on function public.klui_claim_document_job(text, integer) to service_role;

create or replace function public.klui_queue_document_page_render(
  p_user_id uuid,
  p_document_file_id uuid,
  p_page_number integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.document_files;
  v_page public.document_pages;
  v_job public.document_jobs;
begin
  if p_page_number is null or p_page_number < 1 then raise exception 'invalid_page_number'; end if;

  select * into v_document
  from public.document_files
  where id = p_document_file_id
    and user_id = p_user_id
    and kind in ('pdf', 'docx', 'xlsx', 'pptx')
  for update;
  if not found then raise exception 'document_not_found'; end if;
  if v_document.page_count is not null and p_page_number > v_document.page_count then
    raise exception 'page_out_of_range';
  end if;

  select * into v_page
  from public.document_pages
  where document_file_id = v_document.id and page_number = p_page_number;
  if v_page.id is not null and length(trim(v_page.image_key)) > 0 then
    return jsonb_build_object('page', to_jsonb(v_page), 'job', null);
  elsif v_page.id is not null then
    delete from public.document_pages where id = v_page.id;
    v_page := null;
  end if;

  select * into v_job
  from public.document_jobs
  where document_file_id = v_document.id
    and job_type = 'document.render_page'
    and (input ->> 'page_number')::integer = p_page_number
  for update;

  if v_job.id is null then
    insert into public.document_jobs (
      user_id, document_file_id, conversation_id, message_id,
      job_type, priority, input
    ) values (
      v_document.user_id, v_document.id, v_document.conversation_id, v_document.message_id,
      'document.render_page', 100,
      jsonb_build_object('page_number', p_page_number, 'attachment_id', v_document.attachment_id)
    ) returning * into v_job;
  elsif v_job.status in ('failed', 'expired', 'succeeded') then
    update public.document_jobs
    set status = 'queued',
        priority = 100,
        attempt_count = 0,
        worker_id = null,
        lease_until = null,
        output = '{}'::jsonb,
        error = null,
        cancel_requested = false,
        started_at = null,
        finished_at = null,
        updated_at = now()
    where id = v_job.id
    returning * into v_job;
  end if;

  return jsonb_build_object('page', null, 'job', to_jsonb(v_job));
end;
$$;

revoke all on function public.klui_queue_document_page_render(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.klui_queue_document_page_render(uuid, uuid, integer)
  to service_role;

create or replace function public.klui_submit_document_turn(
  p_user_id uuid,
  p_conversation_id uuid,
  p_client_turn_key uuid,
  p_mode text,
  p_user_content jsonb,
  p_message_metadata jsonb,
  p_request_payload jsonb,
  p_attachment_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment_ids uuid[];
  v_attachment_count integer;
  v_message public.messages;
  v_run public.pending_document_turns;
begin
  if p_mode not in ('single', 'compare', 'council') then raise exception 'invalid_turn_mode'; end if;
  if p_client_turn_key is null then raise exception 'client_turn_key_required'; end if;

  select * into v_run
  from public.pending_document_turns
  where user_id = p_user_id and client_turn_key = p_client_turn_key;
  if v_run.id is not null then
    if v_run.conversation_id <> p_conversation_id then
      raise exception 'client_turn_key_conflict';
    end if;
    select * into v_message from public.messages where id = v_run.user_message_id;
    return jsonb_build_object('run', to_jsonb(v_run), 'user_message', to_jsonb(v_message), 'created', false);
  end if;

  perform 1
  from public.conversations
  where id = p_conversation_id and user_id = p_user_id and deleted_at is null
  for update;
  if not found then raise exception 'conversation_not_found'; end if;

  select coalesce(array_agg(distinct attachment_id), '{}'::uuid[])
  into v_attachment_ids
  from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as input_ids(attachment_id);

  select count(*) into v_attachment_count
  from public.attachments a
  where a.id = any(v_attachment_ids)
    and a.user_id = p_user_id
    and a.status = 'uploaded'
    and a.message_id is null;
  if v_attachment_count <> cardinality(v_attachment_ids) then
    raise exception 'attachment_not_available';
  end if;

  insert into public.messages (
    user_id, conversation_id, role, content, metadata
  ) values (
    p_user_id, p_conversation_id, 'user', p_user_content,
    coalesce(p_message_metadata, '{}'::jsonb)
  ) returning * into v_message;

  insert into public.pending_document_turns (
    user_id, conversation_id, client_turn_key, user_message_id,
    mode, request_payload, status
  ) values (
    p_user_id, p_conversation_id, p_client_turn_key, v_message.id,
    p_mode,
    coalesce(p_request_payload, '{}'::jsonb) || jsonb_build_object('attachments', to_jsonb(v_attachment_ids)),
    'waiting_documents'
  )
  on conflict (user_id, client_turn_key) do nothing
  returning * into v_run;

  if v_run.id is null then
    delete from public.messages where id = v_message.id;
    select * into v_run
    from public.pending_document_turns
    where user_id = p_user_id and client_turn_key = p_client_turn_key;
    select * into v_message from public.messages where id = v_run.user_message_id;
    return jsonb_build_object('run', to_jsonb(v_run), 'user_message', to_jsonb(v_message), 'created', false);
  end if;

  update public.attachments
  set conversation_id = p_conversation_id,
      message_id = v_message.id
  where id = any(v_attachment_ids) and user_id = p_user_id;

  update public.document_files
  set conversation_id = p_conversation_id,
      message_id = v_message.id,
      updated_at = now()
  where attachment_id = any(v_attachment_ids) and user_id = p_user_id;

  return jsonb_build_object('run', to_jsonb(v_run), 'user_message', to_jsonb(v_message), 'created', true);
end;
$$;

revoke all on function public.klui_submit_document_turn(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.klui_submit_document_turn(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, uuid[])
  to service_role;

create or replace function public.klui_claim_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid,
  p_claimed_by text,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.pending_document_turns;
begin
  select * into v_run
  from public.pending_document_turns
  where id = p_turn_id and user_id = p_user_id
  for update;
  if not found then return null; end if;

  if v_run.cancel_requested and v_run.provider_started_at is null then
    update public.pending_document_turns
    set status = 'cancelled', lease_until = null, finished_at = now(), updated_at = now()
    where id = v_run.id
    returning * into v_run;
    return to_jsonb(v_run);
  end if;

  if v_run.status = 'running' and v_run.lease_until >= now() then
    return to_jsonb(v_run);
  end if;

  if v_run.status = 'running' and v_run.provider_started_at is not null then
    update public.pending_document_turns
    set status = 'failed',
        error = jsonb_build_object(
          'code', 'turn_interrupted',
          'message', 'Generation was interrupted after the model request started. Retry explicitly to avoid duplicate usage.'
        ),
        lease_until = null,
        finished_at = now(),
        updated_at = now()
    where id = v_run.id
    returning * into v_run;
    return to_jsonb(v_run);
  end if;

  if v_run.status = 'waiting_documents'
     or (v_run.status = 'running' and v_run.provider_started_at is null and v_run.lease_until < now()) then
    update public.pending_document_turns
    set status = 'running',
        claim_token = gen_random_uuid(),
        claimed_by = p_claimed_by,
        lease_until = now() + (greatest(coalesce(p_lease_seconds, 120), 30) || ' seconds')::interval,
        updated_at = now()
    where id = v_run.id
    returning * into v_run;
  end if;

  return to_jsonb(v_run);
end;
$$;

revoke all on function public.klui_claim_pending_document_turn(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.klui_claim_pending_document_turn(uuid, uuid, text, integer)
  to service_role;

create or replace function public.klui_heartbeat_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.pending_document_turns;
begin
  update public.pending_document_turns
  set lease_until = now() + (greatest(coalesce(p_lease_seconds, 120), 30) || ' seconds')::interval,
      updated_at = now()
  where id = p_turn_id
    and user_id = p_user_id
    and status = 'running'
    and claim_token = p_claim_token
    and lease_until >= now()
    and cancel_requested = false
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.klui_heartbeat_pending_document_turn(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.klui_heartbeat_pending_document_turn(uuid, uuid, uuid, integer)
  to service_role;

create or replace function public.klui_release_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.pending_document_turns;
begin
  update public.pending_document_turns
  set status = 'waiting_documents',
      claim_token = null,
      claimed_by = null,
      lease_until = null,
      updated_at = now()
  where id = p_turn_id
    and user_id = p_user_id
    and status = 'running'
    and claim_token = p_claim_token
    and provider_started_at is null
    and cancel_requested = false
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.klui_release_pending_document_turn(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.klui_release_pending_document_turn(uuid, uuid, uuid)
  to service_role;

create or replace function public.klui_mark_pending_turn_provider_started(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.pending_document_turns;
begin
  update public.pending_document_turns
  set provider_started_at = coalesce(provider_started_at, now()),
      updated_at = now()
  where id = p_turn_id
    and user_id = p_user_id
    and status = 'running'
    and claim_token = p_claim_token
    and lease_until >= now()
    and cancel_requested = false
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.klui_mark_pending_turn_provider_started(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.klui_mark_pending_turn_provider_started(uuid, uuid, uuid)
  to service_role;

create or replace function public.klui_finish_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.pending_document_turns;
begin
  if p_status not in ('done', 'failed', 'cancelled') then raise exception 'invalid_terminal_status'; end if;
  update public.pending_document_turns
  set status = p_status,
      error = p_error,
      lease_until = null,
      finished_at = now(),
      updated_at = now()
  where id = p_turn_id
    and user_id = p_user_id
    and status = 'running'
    and claim_token = p_claim_token
    and lease_until >= now()
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.klui_finish_pending_document_turn(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_finish_pending_document_turn(uuid, uuid, uuid, text, jsonb)
  to service_role;

create or replace function public.klui_update_pending_turn_output(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_token uuid,
  p_message_id uuid,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_message public.messages;
begin
  update public.messages m
  set content = case when p_patch ? 'content' then p_patch->'content' else m.content end,
      reasoning = case when p_patch ? 'reasoning' then coalesce(p_patch->>'reasoning', '') else m.reasoning end,
      tool_calls = case when p_patch ? 'tool_calls' then coalesce(p_patch->'tool_calls', '[]'::jsonb) else m.tool_calls end,
      finish_reason = case when p_patch ? 'finish_reason' then p_patch->>'finish_reason' else m.finish_reason end,
      error = case when p_patch ? 'error' then p_patch->>'error' else m.error end,
      metadata = case when p_patch ? 'metadata' then coalesce(p_patch->'metadata', '{}'::jsonb) else m.metadata end
  where m.id = p_message_id
    and m.user_id = p_user_id
    and m.turn_run_id = p_turn_id
    and exists (
      select 1
      from public.pending_document_turns t
      where t.id = p_turn_id
        and t.user_id = p_user_id
        and t.status = 'running'
        and t.claim_token = p_claim_token
        and t.lease_until >= now()
    )
  returning m.* into v_message;

  return to_jsonb(v_message);
end;
$$;

revoke all on function public.klui_update_pending_turn_output(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_update_pending_turn_output(uuid, uuid, uuid, uuid, jsonb)
  to service_role;

create or replace function public.klui_cancel_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.pending_document_turns;
  v_message public.messages;
  v_attachments jsonb;
begin
  select * into v_run
  from public.pending_document_turns
  where id = p_turn_id and user_id = p_user_id
  for update;
  if not found then return null; end if;

  select * into v_message from public.messages where id = v_run.user_message_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb)
  into v_attachments
  from public.attachments a
  where a.user_id = p_user_id and a.message_id = v_run.user_message_id;

  if v_run.status = 'waiting_documents'
     or (v_run.status = 'running' and v_run.provider_started_at is null) then
    delete from public.messages where turn_run_id = v_run.id;

    update public.attachments
    set conversation_id = null, message_id = null
    where user_id = p_user_id and message_id = v_run.user_message_id;

    update public.document_files
    set conversation_id = null, message_id = null, updated_at = now()
    where user_id = p_user_id and message_id = v_run.user_message_id;

    update public.pending_document_turns
    set status = 'cancelled',
        cancel_requested = true,
        lease_until = null,
        finished_at = now(),
        updated_at = now()
    where id = v_run.id
    returning * into v_run;

    delete from public.messages where id = v_message.id;
  elsif v_run.status = 'running' then
    update public.pending_document_turns
    set cancel_requested = true, updated_at = now()
    where id = v_run.id
    returning * into v_run;
  end if;

  return jsonb_build_object(
    'run', to_jsonb(v_run),
    'user_message', to_jsonb(v_message),
    'attachments', v_attachments
  );
end;
$$;

revoke all on function public.klui_cancel_pending_document_turn(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.klui_cancel_pending_document_turn(uuid, uuid)
  to service_role;

create or replace function public.klui_cleanup_pending_document_turns(
  p_limit integer default 500,
  p_grace interval default interval '7 days'
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  with doomed as (
    select id
    from public.pending_document_turns
    where status in ('done', 'failed', 'cancelled')
      and finished_at < now() - p_grace
    order by finished_at asc
    limit greatest(coalesce(p_limit, 500), 1)
    for update skip locked
  ), deleted as (
    delete from public.pending_document_turns t
    using doomed
    where t.id = doomed.id
    returning t.id
  )
  select count(*) into v_deleted from deleted;
  return v_deleted;
end;
$$;

revoke all on function public.klui_cleanup_pending_document_turns(integer, interval)
  from public, anon, authenticated;
grant execute on function public.klui_cleanup_pending_document_turns(integer, interval)
  to service_role;
