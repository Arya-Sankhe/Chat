-- AI podcasts made in a course's Create panel. The audio lives in R2 behind an
-- attachment row (so it counts toward storage and is removed with the course).
create table if not exists public.study_podcasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  attachment_id uuid not null references public.attachments(id) on delete cascade,
  title text not null default '',
  style text not null default 'casual',
  length text not null default 'standard',
  -- [{"id": "af_heart", "name": "Maya"}, {"id": "am_michael", "name": "Michael"}]
  voices jsonb not null default '[]'::jsonb,
  -- [{"speaker": 0, "text": "...", "start": 0.0, "end": 4.2}] or {"pause": true, ...}
  transcript jsonb not null default '[]'::jsonb,
  duration_seconds numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists study_podcasts_user_project_idx on public.study_podcasts (user_id, project_id);
create index if not exists study_podcasts_attachment_idx on public.study_podcasts (attachment_id);

grant select on public.study_podcasts to authenticated;
grant all on public.study_podcasts to service_role;

alter table public.study_podcasts enable row level security;
drop policy if exists "study podcasts read own" on public.study_podcasts;
create policy "study podcasts read own" on public.study_podcasts for select using (auth.uid() = user_id);
