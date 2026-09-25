-- AI tutor calls made in a course's Create panel. A session holds the lesson plan made before
-- the call, the capped source text the tutor teaches from, the live transcript, and the summary
-- written when the call ends.
create table if not exists public.study_tutor_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default '',
  style text not null default 'teacher',
  voice text not null default 'af_heart',
  instructions text not null default '',
  -- {"goal": "...", "steps": [{"title": "...", "points": ["..."], "check": "..."}], "notes": "..."}
  plan jsonb not null default '{}'::jsonb,
  source_text text not null default '',
  -- [{"role": "tutor" | "student", "text": "...", "at": 12.5, "step": 1}]
  transcript jsonb not null default '[]'::jsonb,
  -- {"overview": "...", "concepts": [...], "strengths": [...], "review": [...]}
  summary jsonb,
  status text not null default 'ready' check (status in ('ready', 'live', 'ended')),
  -- The model host that served the first turn; later turns stay on it so the prompt cache stays warm.
  provider_pin text,
  active_seconds numeric not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_tutor_sessions_user_project_idx on public.study_tutor_sessions (user_id, project_id, created_at desc);

grant select on public.study_tutor_sessions to authenticated;
grant all on public.study_tutor_sessions to service_role;

alter table public.study_tutor_sessions enable row level security;
drop policy if exists "study tutor sessions read own" on public.study_tutor_sessions;
create policy "study tutor sessions read own" on public.study_tutor_sessions for select using (auth.uid() = user_id);
