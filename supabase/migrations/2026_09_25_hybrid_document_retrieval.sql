-- Hybrid document retrieval: stemmed any-word keyword search, text-chunk
-- embeddings, and exact (filtered-first) vector search over pages and chunks.
alter table public.document_chunks
  add column if not exists embedding extensions.vector(768),
  add column if not exists embedding_model text,
  add column if not exists tsv_en tsvector
    generated always as (to_tsvector('english', coalesce(text, ''))) stored;

create index if not exists document_chunks_tsv_en_idx
  on public.document_chunks using gin (tsv_en);
create index if not exists document_chunks_embedding_pending_idx
  on public.document_chunks (created_at) where embedding is null;
create index if not exists document_pages_embedding_pending_idx
  on public.document_pages (created_at) where embedding is null and image_key is not null;

-- Keyword search matches ANY stemmed query word (stopwords dropped) and ranks
-- chunks that contain every word above partial matches.
create or replace function public.klui_search_document_chunks(
  p_user_id uuid,
  p_document_ids uuid[],
  p_query text,
  p_limit integer default 5
) returns table (
  id uuid,
  document_file_id uuid,
  chunk_index integer,
  source_type text,
  source_label text,
  text text,
  metadata jsonb,
  rank real
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_limit integer := greatest(least(coalesce(p_limit, 5), 40), 1);
  v_all tsquery;
  v_any tsquery;
begin
  if v_query = '' then
    return query
    select c.id, c.document_file_id, c.chunk_index, c.source_type, c.source_label, c.text, c.metadata, 0::real
    from public.document_chunks c
    where c.user_id = p_user_id
      and (p_document_ids is null or cardinality(p_document_ids) = 0 or c.document_file_id = any(p_document_ids))
    order by c.document_file_id, c.chunk_index
    limit v_limit;
    return;
  end if;

  v_all := plainto_tsquery('english', v_query);
  if numnode(v_all) = 0 then
    v_all := plainto_tsquery('simple', v_query);
  end if;
  if numnode(v_all) = 0 then
    return;
  end if;
  v_any := replace(v_all::text, ' & ', ' | ')::tsquery;

  return query
  select
    c.id,
    c.document_file_id,
    c.chunk_index,
    c.source_type,
    c.source_label,
    c.text,
    c.metadata,
    (ts_rank_cd(c.tsv_en, v_any, 32) + case when c.tsv_en @@ v_all then 1 else 0 end)::real as rank
  from public.document_chunks c
  where c.user_id = p_user_id
    and (p_document_ids is null or cardinality(p_document_ids) = 0 or c.document_file_id = any(p_document_ids))
    and c.tsv_en @@ v_any
  order by rank desc, c.document_file_id, c.chunk_index
  limit v_limit;
end;
$$;

grant execute on function public.klui_search_document_chunks(uuid, uuid[], text, integer) to service_role;

create or replace function public.klui_search_document_chunks_semantic(
  p_user_id uuid,
  p_document_ids uuid[],
  p_query_embedding text,
  p_limit integer default 8
) returns table (
  id uuid,
  document_file_id uuid,
  chunk_index integer,
  source_type text,
  source_label text,
  text text,
  metadata jsonb,
  distance real
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 8), 40), 1);
  v_embedding extensions.vector(768);
begin
  if trim(coalesce(p_query_embedding, '')) = '' then
    return;
  end if;
  v_embedding := p_query_embedding::extensions.vector;

  -- Filter to the caller's documents first so the ordering is exact.
  return query
  with candidates as materialized (
    select c.id, c.document_file_id, c.chunk_index, c.source_type, c.source_label, c.text, c.metadata, c.embedding
    from public.document_chunks c
    where c.user_id = p_user_id
      and c.embedding is not null
      and (p_document_ids is null or cardinality(p_document_ids) = 0 or c.document_file_id = any(p_document_ids))
  )
  select
    k.id, k.document_file_id, k.chunk_index, k.source_type, k.source_label, k.text, k.metadata,
    (k.embedding <=> v_embedding)::real as distance
  from candidates k
  order by k.embedding <=> v_embedding, k.document_file_id, k.chunk_index
  limit v_limit;
end;
$$;

revoke all on function public.klui_search_document_chunks_semantic(uuid, uuid[], text, integer) from public, anon, authenticated;
grant execute on function public.klui_search_document_chunks_semantic(uuid, uuid[], text, integer) to service_role;

create or replace function public.klui_search_document_pages(
  p_user_id uuid,
  p_document_ids uuid[],
  p_query_embedding text,
  p_limit integer default 8
) returns table (
  id uuid,
  document_file_id uuid,
  page_number integer,
  source_label text,
  image_key text,
  image_content_type text,
  width_px integer,
  height_px integer,
  text text,
  metadata jsonb,
  distance real
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 8), 40), 1);
  v_embedding extensions.vector(768);
begin
  if trim(coalesce(p_query_embedding, '')) = '' then
    return query
    select
      p.id,
      p.document_file_id,
      p.page_number,
      p.source_label,
      p.image_key,
      p.image_content_type,
      p.width_px,
      p.height_px,
      p.text,
      p.metadata,
      0::real as distance
    from public.document_pages p
    where p.user_id = p_user_id
      and (p_document_ids is null or cardinality(p_document_ids) = 0 or p.document_file_id = any(p_document_ids))
    order by p.document_file_id, p.page_number
    limit v_limit;
    return;
  end if;

  v_embedding := p_query_embedding::extensions.vector;

  -- The HNSW index would rank globally and filter afterwards, dropping this
  -- user's pages; filter first so the ordering is exact.
  return query
  with candidates as materialized (
    select p.id, p.document_file_id, p.page_number, p.source_label, p.image_key, p.image_content_type,
      p.width_px, p.height_px, p.text, p.metadata, p.embedding
    from public.document_pages p
    where p.user_id = p_user_id
      and p.embedding is not null
      and (p_document_ids is null or cardinality(p_document_ids) = 0 or p.document_file_id = any(p_document_ids))
  )
  select
    k.id, k.document_file_id, k.page_number, k.source_label, k.image_key, k.image_content_type,
    k.width_px, k.height_px, k.text, k.metadata,
    (k.embedding <=> v_embedding)::real as distance
  from candidates k
  order by k.embedding <=> v_embedding, k.document_file_id, k.page_number
  limit v_limit;
end;
$$;

grant execute on function public.klui_search_document_pages(uuid, uuid[], text, integer) to service_role;
