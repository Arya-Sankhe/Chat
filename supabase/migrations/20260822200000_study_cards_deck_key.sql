alter table public.study_cards
  add column if not exists deck_key text;

alter table public.study_quizzes
  add column if not exists deck_key text;
