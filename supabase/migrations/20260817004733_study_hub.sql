-- Study Hub: courses are projects (kind/meta), plus notes, FSRS cards, quizzes.

alter table public.projects
  add column if not exists kind text not null default 'project';
alter table public.projects
  add column if not exists meta jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_kind_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_kind_check check (kind in ('project', 'course'));
  end if;
end;
$$;

create table if not exists public.study_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_file_id uuid references public.document_files(id) on delete cascade,
  kind text not null check (kind in ('summary', 'image_transcript')),
  title text not null default '',
  content text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.study_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_file_id uuid references public.document_files(id) on delete cascade,
  note_id uuid references public.study_notes(id) on delete cascade,
  front text not null,
  back text not null,
  state text not null default 'new' check (state in ('new', 'learning', 'review', 'relearning')),
  difficulty real,
  stability real,
  reps integer not null default 0,
  lapses integer not null default 0,
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.study_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.study_cards(id) on delete cascade,
  rating smallint not null check (rating between 1 and 4),
  reviewed_at timestamptz not null default now()
);

create table if not exists public.study_quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_file_id uuid references public.document_files(id) on delete cascade,
  note_id uuid references public.study_notes(id) on delete cascade,
  title text not null default '',
  questions jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.study_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  quiz_id uuid not null references public.study_quizzes(id) on delete cascade,
  answers jsonb not null,
  score integer not null,
  total integer not null,
  created_at timestamptz not null default now()
);

create index if not exists study_notes_user_project_idx
  on public.study_notes (user_id, project_id);
create index if not exists study_cards_user_project_due_idx
  on public.study_cards (user_id, project_id, due_at);
create index if not exists study_reviews_user_reviewed_idx
  on public.study_reviews (user_id, reviewed_at desc);
create index if not exists study_quizzes_user_project_idx
  on public.study_quizzes (user_id, project_id);

grant select on public.study_notes, public.study_cards, public.study_reviews, public.study_quizzes, public.study_quiz_attempts to authenticated;
grant all on public.study_notes, public.study_cards, public.study_reviews, public.study_quizzes, public.study_quiz_attempts to service_role;

alter table public.study_notes enable row level security;
alter table public.study_cards enable row level security;
alter table public.study_reviews enable row level security;
alter table public.study_quizzes enable row level security;
alter table public.study_quiz_attempts enable row level security;

drop policy if exists "study notes read own" on public.study_notes;
drop policy if exists "study cards read own" on public.study_cards;
drop policy if exists "study reviews read own" on public.study_reviews;
drop policy if exists "study quizzes read own" on public.study_quizzes;
drop policy if exists "study quiz attempts read own" on public.study_quiz_attempts;

create policy "study notes read own" on public.study_notes for select using (auth.uid() = user_id);
create policy "study cards read own" on public.study_cards for select using (auth.uid() = user_id);
create policy "study reviews read own" on public.study_reviews for select using (auth.uid() = user_id);
create policy "study quizzes read own" on public.study_quizzes for select using (auth.uid() = user_id);
create policy "study quiz attempts read own" on public.study_quiz_attempts for select using (auth.uid() = user_id);
