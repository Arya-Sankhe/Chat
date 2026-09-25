-- Rolling conversation summaries. One row per conversation holds the summary
-- of every message up to `through_message_id`; `fingerprint` (ids and roles of
-- the covered messages) lets the server discard it after edits or branches.
create table if not exists public.conversation_context (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  version integer not null default 1,
  summary text not null,
  through_message_id uuid not null,
  fingerprint text not null,
  summarized_tokens integer not null default 0,
  summary_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversation_context_user_idx on public.conversation_context (user_id);

alter table public.conversation_context enable row level security;
grant all on public.conversation_context to service_role;
