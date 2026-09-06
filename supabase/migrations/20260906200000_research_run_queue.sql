alter table public.research_runs
  add column if not exists queue text not null default 'production';

alter table public.research_runs
  drop constraint if exists research_runs_queue_check;

alter table public.research_runs
  add constraint research_runs_queue_check
  check (queue ~ '^[a-z][a-z0-9_-]{0,31}$');

drop index if exists public.research_runs_claim_idx;
create index research_runs_claim_idx
  on public.research_runs (queue, created_at asc)
  where status = 'queued';

drop function if exists public.klui_claim_research_run(text, integer);

create or replace function public.klui_claim_research_run(
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_queue text default 'local'
) returns setof public.research_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue text := lower(trim(coalesce(p_queue, '')));
begin
  if v_queue !~ '^[a-z][a-z0-9_-]{0,31}$' then
    v_queue := 'local';
  end if;

  return query
  with next_run as (
    select id
    from public.research_runs
    where status = 'queued' and cancel_requested = false
      and queue = v_queue
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

revoke all on function public.klui_claim_research_run(text, integer, text) from public, anon, authenticated;
grant execute on function public.klui_claim_research_run(text, integer, text) to service_role;

notify pgrst, 'reload schema';
