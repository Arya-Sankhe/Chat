drop policy if exists "study reviews read own" on public.study_reviews;
drop policy if exists "study quiz attempts read own" on public.study_quiz_attempts;

drop table if exists public.study_quiz_attempts;
drop table if exists public.study_reviews;

drop index if exists public.study_cards_user_project_due_idx;
alter table public.study_cards drop column if exists due_at;

create index if not exists study_cards_user_project_idx
  on public.study_cards (user_id, project_id);
