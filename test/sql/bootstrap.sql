-- Minimal Supabase platform objects for an isolated PostgreSQL test database.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema extensions;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
