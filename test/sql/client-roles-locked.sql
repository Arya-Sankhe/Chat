-- Fails when the browser-facing roles can reach any table or function in public.
-- Only the server (service_role) uses the database; see the 20261115 hardening migration.
do $$
declare leaks text;
begin
  select string_agg(item, E'\n' order by item) into leaks from (
    select format('%s can %s table %s', r.role, priv.p, c.oid::regclass) as item
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) as r(role)
    cross join (values ('select'), ('insert'), ('update'), ('delete')) as priv(p)
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
      and has_table_privilege(r.role, c.oid, priv.p)
    union all
    select format('%s can execute %s', r.role, p.oid::regprocedure)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) as r(role)
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege(r.role, p.oid, 'execute')
  ) found;
  if leaks is not null then
    raise exception E'Client roles can reach the database directly:\n%', leaks;
  end if;
end
$$;
