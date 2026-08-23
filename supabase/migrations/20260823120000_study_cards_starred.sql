alter table public.study_cards
  add column if not exists starred boolean not null default false;
