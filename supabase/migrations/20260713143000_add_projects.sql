create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  instructions text not null default '' check (char_length(instructions) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversations
  add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.attachments
  add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.document_files
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

create index if not exists projects_user_updated_idx
  on public.projects (user_id, updated_at desc);
create index if not exists conversations_project_idx
  on public.conversations (project_id) where project_id is not null;
create index if not exists attachments_project_idx
  on public.attachments (project_id) where project_id is not null;
create index if not exists document_files_project_idx
  on public.document_files (project_id) where project_id is not null;

drop index if exists public.attachments_orphan_cleanup_idx;
create index attachments_orphan_cleanup_idx on public.attachments (created_at)
  where conversation_id is null and message_id is null and project_id is null;
drop index if exists public.document_files_orphan_cleanup_idx;
create index document_files_orphan_cleanup_idx on public.document_files (created_at)
  where conversation_id is null and message_id is null and project_id is null;

grant select, insert, update, delete on public.projects to service_role;
alter table public.projects enable row level security;
drop policy if exists "projects read own" on public.projects;
create policy "projects read own"
  on public.projects for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.klui_complete_document_upload(
  p_user_id uuid,
  p_attachment_id uuid,
  p_size_bytes integer,
  p_etag text,
  p_kind text,
  p_limits jsonb default '{}'::jsonb,
  p_project_id uuid default null,
  p_project_max_bytes bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment public.attachments;
  v_document public.document_files;
  v_jobs jsonb;
  v_used_bytes bigint;
begin
  if p_kind not in ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv') then
    raise exception 'unsupported_document_kind';
  end if;

  select * into v_attachment
  from public.attachments
  where id = p_attachment_id and user_id = p_user_id
  for update;

  if not found then raise exception 'attachment_not_found'; end if;
  if v_attachment.category <> 'document' then raise exception 'attachment_is_not_document'; end if;
  if v_attachment.project_id is distinct from p_project_id then raise exception 'project_mismatch'; end if;

  if p_project_id is not null then
    perform 1 from public.projects
    where id = p_project_id and user_id = p_user_id
    for update;
    if not found then raise exception 'project_not_found'; end if;
    if p_project_max_bytes is null or p_project_max_bytes <= 0 then
      raise exception 'project_limit_missing';
    end if;
    select coalesce(sum(size_bytes), 0) into v_used_bytes
    from public.attachments
    where project_id = p_project_id
      and user_id = p_user_id
      and status = 'uploaded'
      and id <> v_attachment.id;
    if v_used_bytes + coalesce(p_size_bytes, v_attachment.size_bytes, 0) > p_project_max_bytes then
      raise exception 'project_storage_limit_exceeded';
    end if;
  end if;

  update public.attachments
  set status = 'uploaded',
      uploaded_at = coalesce(uploaded_at, now()),
      size_bytes = coalesce(p_size_bytes, size_bytes),
      etag = coalesce(p_etag, etag)
  where id = v_attachment.id
  returning * into v_attachment;

  insert into public.document_files (
    attachment_id, user_id, conversation_id, message_id, project_id, kind, source,
    source_etag, processing_status, metadata
  ) values (
    v_attachment.id, v_attachment.user_id, v_attachment.conversation_id,
    v_attachment.message_id, v_attachment.project_id, p_kind, 'upload',
    v_attachment.etag, 'pending',
    jsonb_build_object(
      'file_name', v_attachment.file_name,
      'content_type', v_attachment.content_type,
      'size_bytes', v_attachment.size_bytes
    )
  )
  on conflict (attachment_id) do update
    set source_etag = coalesce(excluded.source_etag, public.document_files.source_etag),
        project_id = excluded.project_id,
        updated_at = now()
  returning * into v_document;

  insert into public.document_jobs (
    user_id, document_file_id, conversation_id, message_id, job_type, priority, input
  )
  select
    v_attachment.user_id,
    v_document.id,
    v_attachment.conversation_id,
    v_attachment.message_id,
    queued.job_type,
    queued.priority,
    jsonb_build_object(
      'attachment_id', v_attachment.id,
      'object_key', v_attachment.object_key,
      'file_name', v_attachment.file_name,
      'content_type', v_attachment.content_type,
      'size_bytes', v_attachment.size_bytes,
      'etag', v_attachment.etag,
      'limits', coalesce(p_limits, '{}'::jsonb)
    )
  from (
    select 'document.extract.' || p_kind as job_type, 10 as priority
    union all
    select 'document.enrich.pdf', 0
    where p_kind in ('pdf', 'docx', 'xlsx', 'pptx')
  ) queued
  on conflict do nothing;

  select coalesce(jsonb_agg(to_jsonb(j) order by j.priority desc, j.created_at asc), '[]'::jsonb)
  into v_jobs
  from public.document_jobs j
  where j.document_file_id = v_document.id
    and (j.job_type = 'document.extract.' || p_kind
      or (p_kind in ('pdf', 'docx', 'xlsx', 'pptx') and j.job_type = 'document.enrich.pdf'));

  return jsonb_build_object(
    'attachment', to_jsonb(v_attachment),
    'document_file', to_jsonb(v_document),
    'job', coalesce(v_jobs -> 0, 'null'::jsonb),
    'jobs', v_jobs
  );
end;
$$;

revoke all on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb, uuid, bigint)
  to service_role;
