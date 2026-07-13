drop index if exists public.research_runs_one_active_per_user_idx;

create unique index if not exists research_runs_one_active_per_conversation_idx
  on public.research_runs (user_id, conversation_id)
  where status in ('queued', 'running');
