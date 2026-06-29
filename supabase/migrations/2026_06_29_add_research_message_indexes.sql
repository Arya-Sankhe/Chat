create index if not exists research_runs_user_message_idx
  on public.research_runs (user_message_id) where user_message_id is not null;
create index if not exists research_runs_assistant_message_idx
  on public.research_runs (assistant_message_id) where assistant_message_id is not null;
