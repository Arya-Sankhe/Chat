create or replace function public.klui_ensure_profile(
  p_user_id uuid,
  p_email text
) returns setof public.profiles
language sql
volatile
security invoker
set search_path = ''
as $$
  with changed as (
    insert into public.profiles (id, email, updated_at)
    values (p_user_id, p_email, now())
    on conflict (id) do update
      set email = excluded.email,
          updated_at = now()
      where public.profiles.email is distinct from excluded.email
    returning public.profiles.*
  )
  select * from changed
  union all
  select profile.*
  from public.profiles profile
  where profile.id = p_user_id
    and not exists (select 1 from changed)
  limit 1;
$$;

revoke execute on function public.klui_ensure_profile(uuid, text) from public, anon, authenticated;
grant execute on function public.klui_ensure_profile(uuid, text) to service_role;
