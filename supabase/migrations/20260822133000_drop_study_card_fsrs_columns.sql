alter table public.study_cards
  drop column if exists state,
  drop column if exists difficulty,
  drop column if exists stability,
  drop column if exists reps,
  drop column if exists lapses,
  drop column if exists last_reviewed_at;
