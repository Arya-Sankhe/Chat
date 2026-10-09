-- Dojo whiteboards: a course's Excalidraw boards, the images placed on them, and Klui's answers
-- about parts of a board. The drawing and the AI conversation are stored apart so a drawing save
-- can never overwrite an answer.
create table if not exists public.study_whiteboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default '',
  -- {"schemaVersion": 1, "elements": [...Excalidraw 0.18 elements], "appState": {"viewBackgroundColor": "#ffffff"}}
  scene jsonb not null default '{"schemaVersion": 1, "elements": [], "appState": {}}'::jsonb,
  -- Bumped by every save; a save names the revision it started from (optimistic concurrency).
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_whiteboards_user_project_idx on public.study_whiteboards (user_id, project_id, created_at desc);

-- Images on a board. The bytes are an attachment in R2 (filed under the course, so they count
-- toward storage and go when the course does); Excalidraw refers to them by file_id.
create table if not exists public.study_whiteboard_files (
  board_id uuid not null references public.study_whiteboards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_id text not null check (char_length(file_id) between 1 and 100),
  attachment_id uuid not null references public.attachments(id) on delete cascade,
  mime_type text not null,
  created_at timestamptz not null default now(),
  primary key (board_id, file_id)
);

create index if not exists study_whiteboard_files_attachment_idx on public.study_whiteboard_files (attachment_id);
create index if not exists study_whiteboard_files_user_idx on public.study_whiteboard_files (user_id);

-- One question to Klui about part of a board, and its answer. thread_id groups follow-ups; the
-- context is frozen at the moment the question was asked.
create table if not exists public.study_whiteboard_turns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.study_whiteboards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  thread_id uuid not null,
  parent_turn_id uuid references public.study_whiteboard_turns(id) on delete set null,
  client_request_id uuid not null,
  mode text not null default 'answer' check (mode in ('answer', 'diagram')),
  voice boolean not null default false,
  question text not null default '',
  -- {"captureMode": "selection" | "area" | "view", "rect": {...}, "elementIds": [...], "text": "...", "sceneRevision": 3}
  context jsonb not null default '{}'::jsonb,
  answer text not null default '',
  proposal jsonb,
  citations jsonb not null default '[]'::jsonb,
  status text not null default 'running' check (status in ('running', 'complete', 'interrupted', 'failed')),
  error_code text,
  model text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (board_id, client_request_id)
);

create index if not exists study_whiteboard_turns_board_idx on public.study_whiteboard_turns (board_id, created_at desc);
create index if not exists study_whiteboard_turns_thread_idx on public.study_whiteboard_turns (thread_id, created_at);
create index if not exists study_whiteboard_turns_user_idx on public.study_whiteboard_turns (user_id);

grant select on public.study_whiteboards, public.study_whiteboard_files, public.study_whiteboard_turns to authenticated;
grant all on public.study_whiteboards, public.study_whiteboard_files, public.study_whiteboard_turns to service_role;

alter table public.study_whiteboards enable row level security;
alter table public.study_whiteboard_files enable row level security;
alter table public.study_whiteboard_turns enable row level security;

drop policy if exists "study whiteboards read own" on public.study_whiteboards;
create policy "study whiteboards read own" on public.study_whiteboards for select to authenticated using (auth.uid() = user_id);
drop policy if exists "study whiteboard files read own" on public.study_whiteboard_files;
create policy "study whiteboard files read own" on public.study_whiteboard_files for select to authenticated using (auth.uid() = user_id);
drop policy if exists "study whiteboard turns read own" on public.study_whiteboard_turns;
create policy "study whiteboard turns read own" on public.study_whiteboard_turns for select to authenticated using (auth.uid() = user_id);
