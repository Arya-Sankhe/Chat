-- Where each generated card came from: [{"documentFileId": uuid, "page": int?}].
alter table public.study_cards
  add column if not exists sources jsonb not null default '[]'::jsonb;
