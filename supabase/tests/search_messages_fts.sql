\set ON_ERROR_STOP on

-- Run only against a disposable empty Postgres database:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/search_messages_fts.sql
-- Everything is wrapped in a transaction and rolled back.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end;
$$;

create table public.conversations (
  id uuid primary key,
  user_id uuid not null,
  title text not null,
  deleted_at timestamptz
);

create table public.messages (
  id uuid primary key,
  user_id uuid not null,
  conversation_id uuid not null references public.conversations(id),
  role text not null,
  content jsonb not null,
  created_at timestamptz not null
);

grant select on public.conversations, public.messages to service_role;

\ir ../migrations/20260816234517_search_messages_fts.sql

do $$
declare
  v_plain text;
  v_multimodal text;
begin
  select public.klui_message_text('"Deploying applications"'::jsonb) into v_plain;
  if v_plain <> 'Deploying applications' then
    raise exception 'plain text extraction failed: %', v_plain;
  end if;

  select public.klui_message_text(
    '[{"type":"text","text":"Actual searchable words"},{"type":"image_url","image_url":{"file_name":"noise.png","url":"r2://secret-noise"}}]'::jsonb
  ) into v_multimodal;
  if v_multimodal <> 'Actual searchable words' then
    raise exception 'multimodal extraction included attachment noise: %', v_multimodal;
  end if;

  if has_function_privilege('anon', 'public.klui_search_messages(uuid,text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.klui_search_messages(uuid,text,integer)', 'execute') then
    raise exception 'public chat-search execution was not revoked';
  end if;
  if not has_function_privilege('service_role', 'public.klui_search_messages(uuid,text,integer)', 'execute') then
    raise exception 'service_role cannot execute chat search';
  end if;
end;
$$;

insert into public.conversations (id, user_id, title, deleted_at) values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Owned chat', null),
  ('10000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Deleted chat', now()),
  ('10000000-0000-0000-0000-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Other user chat', null);

insert into public.messages (id, user_id, conversation_id, role, content, created_at) values
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'user', '"Older searchable needle"', '2026-08-16T10:00:00Z'),
  ('20000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'assistant', '[{"type":"text","text":"Newest searchable needle"},{"type":"file","file":{"file_name":"private-noise.txt"}}]', '2026-08-16T11:00:00Z'),
  ('20000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'tool', '"Tool searchable needle"', '2026-08-16T12:00:00Z'),
  ('20000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', 'user', '"Deleted searchable needle"', '2026-08-16T13:00:00Z'),
  ('20000000-0000-0000-0000-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '10000000-0000-0000-0000-000000000003', 'user', '"Other searchable needle secret"', '2026-08-16T14:00:00Z');

do $$
declare
  v_count integer;
  v_title text;
  v_snippet text;
begin
  select count(*), min(title), min(snippet)
    into v_count, v_title, v_snippet
  from public.klui_search_messages(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'searchable needle',
    30
  );

  if v_count <> 1 or v_title <> 'Owned chat' then
    raise exception 'tenant isolation, deletion filter, or conversation deduplication failed';
  end if;
  if position('Newest searchable needle' in v_snippet) = 0 then
    raise exception 'latest matching snippet was not returned: %', v_snippet;
  end if;
  if position('secret' in v_snippet) > 0 or position('private-noise' in v_snippet) > 0 then
    raise exception 'private or attachment text leaked into snippet: %', v_snippet;
  end if;
end;
$$;

set enable_seqscan = off;

create function pg_temp.assert_search_index_used()
returns void
language plpgsql
as $$
declare
  v_plan json;
begin
  execute $query$
    explain (format json)
    select id
    from public.messages
    where to_tsvector('english', public.klui_message_text(content))
      @@ websearch_to_tsquery('english', 'searchable needle')
  $query$ into v_plan;

  if position('messages_content_fts_idx' in v_plan::text) = 0 then
    raise exception 'messages_content_fts_idx was not used: %', v_plan;
  end if;
end;
$$;

select pg_temp.assert_search_index_used();

rollback;
