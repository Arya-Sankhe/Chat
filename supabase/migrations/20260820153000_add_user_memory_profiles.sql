create table if not exists public.user_memory_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  content text not null default '',
  enabled_at timestamptz,
  last_dreamed_at timestamptz,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_memory_profiles_content_length check (char_length(content) <= 6000)
);

alter table public.user_memory_profiles enable row level security;
revoke all on public.user_memory_profiles from anon, authenticated;
grant select, insert, update, delete on public.user_memory_profiles to service_role;

