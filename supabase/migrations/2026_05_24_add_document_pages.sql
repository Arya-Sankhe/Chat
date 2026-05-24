create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_file_id uuid not null references public.document_files(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  page_number integer not null,
  source_label text not null,
  image_key text not null,
  image_content_type text not null default 'image/jpeg',
  width_px integer,
  height_px integer,
  text text not null default '',
  char_count integer not null default 0,
  token_estimate integer not null default 0,
  embedding extensions.vector(768),
  embedding_model text,
  embedding_dimensions integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_file_id, page_number)
);

create index if not exists document_pages_doc_idx on public.document_pages (document_file_id, page_number);
create index if not exists document_pages_user_doc_idx on public.document_pages (user_id, document_file_id);
create index if not exists document_pages_embedding_hnsw_idx on public.document_pages using hnsw (embedding extensions.vector_cosine_ops) where embedding is not null;

grant select on public.document_pages to authenticated;
grant all on public.document_pages to service_role;

alter table public.document_pages enable row level security;

drop policy if exists "document pages read own" on public.document_pages;
create policy "document pages read own" on public.document_pages for select using (auth.uid() = user_id);

create or replace function public.smartyfy_search_document_pages(
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
    (p.embedding <=> v_embedding)::real as distance
  from public.document_pages p
  where p.user_id = p_user_id
    and p.embedding is not null
    and (p_document_ids is null or cardinality(p_document_ids) = 0 or p.document_file_id = any(p_document_ids))
  order by p.embedding <=> v_embedding, p.document_file_id, p.page_number
  limit v_limit;
end;
$$;

grant execute on function public.smartyfy_search_document_pages(uuid, uuid[], text, integer) to service_role;
