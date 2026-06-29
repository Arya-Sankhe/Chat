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

create index if not exists research_runs_claim_idx
  on public.research_runs (created_at asc) where status = 'queued';
create index if not exists research_runs_lease_idx
  on public.research_runs (lease_until) where status = 'running';
create index if not exists research_runs_user_status_idx
  on public.research_runs (user_id, status);
create unique index if not exists research_runs_one_active_per_user_idx
  on public.research_runs (user_id) where status in ('queued', 'running');
create index if not exists research_runs_conversation_idx
  on public.research_runs (conversation_id, created_at desc);

alter table public.research_runs enable row level security;

grant select on public.research_runs to authenticated;
grant all on public.research_runs to service_role;

drop policy if exists "research runs read own" on public.research_runs;
create policy "research runs read own" on public.research_runs
  for select to authenticated
  using ((select auth.uid()) = user_id);

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
