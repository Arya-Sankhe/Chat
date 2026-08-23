-- In-app content reports. Tickets outlive the chat and the reporter
-- (message/conversation/reporter FKs are ON DELETE SET NULL; snippet stays).

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  reporter_email text not null default '',
  message_id uuid references public.messages(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  snippet text not null default '',
  status text not null default 'open' check (status in ('open', 'done')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists content_reports_status_created_idx
  on public.content_reports (status, created_at desc);

create index if not exists content_reports_open_message_idx
  on public.content_reports (reporter_id, message_id)
  where status = 'open';

alter table public.content_reports enable row level security;

grant all on public.content_reports to service_role;
