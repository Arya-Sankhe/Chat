-- Full-text search over chat message bodies.
-- klui_message_text flattens messages.content jsonb (plain JSON string or
-- multimodal parts array) into only the user-visible text parts; the GIN
-- expression index makes klui_search_messages an index lookup instead of a
-- table scan. No stored tsvector column, so nothing new appears in
-- return=representation write responses or select * reads.

create or replace function public.klui_message_text(p_content jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case jsonb_typeof(p_content)
    when 'string' then p_content #>> '{}'
    when 'array' then coalesce((
      select string_agg(part->>'text', ' ' order by idx)
      from jsonb_array_elements(p_content) with ordinality as parts(part, idx)
      where part->>'type' = 'text'
    ), '')
    else ''
  end;
$$;

create index if not exists messages_content_fts_idx
  on public.messages
  using gin (to_tsvector('english', public.klui_message_text(content)));

create or replace function public.klui_search_messages(
  p_user_id uuid,
  p_query text,
  p_limit integer default 30
) returns table (
  conversation_id uuid,
  title text,
  snippet text,
  matched_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with tsq as (
    select websearch_to_tsquery('english', coalesce(p_query, '')) as q
  )
  select hit.conversation_id, hit.title, hit.snippet, hit.matched_at
  from (
    select distinct on (m.conversation_id)
      m.conversation_id,
      c.title,
      ts_headline(
        'english',
        public.klui_message_text(m.content),
        tsq.q,
        'StartSel="", StopSel="", MaxWords=18, MinWords=8'
      ) as snippet,
      m.created_at as matched_at
    from public.messages m
    join public.conversations c
      on c.id = m.conversation_id
     and c.user_id = p_user_id
     and c.deleted_at is null
    cross join tsq
    where m.user_id = p_user_id
      and m.role in ('user', 'assistant')
      and to_tsvector('english', public.klui_message_text(m.content)) @@ tsq.q
    order by m.conversation_id, m.created_at desc
  ) hit
  order by hit.matched_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 30);
$$;

revoke execute on function public.klui_message_text(jsonb) from public, anon, authenticated;
revoke execute on function public.klui_search_messages(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.klui_message_text(jsonb) to service_role;
grant execute on function public.klui_search_messages(uuid, text, integer) to service_role;
