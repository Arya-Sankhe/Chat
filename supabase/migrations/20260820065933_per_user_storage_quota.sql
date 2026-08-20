create index if not exists attachments_pending_created_idx
  on public.attachments (created_at)
  where status = 'pending';

create or replace function public.klui_account_storage_used(
  p_user_id uuid,
  p_exclude_id uuid default null
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(a.size_bytes::bigint), 0)
  from public.attachments a
  where a.user_id = p_user_id
    and a.status in ('pending', 'uploaded')
    and (p_exclude_id is null or a.id <> p_exclude_id);
$$;

revoke all on function public.klui_account_storage_used(uuid, uuid) from public, anon, authenticated;
grant execute on function public.klui_account_storage_used(uuid, uuid) to service_role;

create or replace function public.klui_conversation_storage_totals(
  p_user_id uuid
) returns table (conversation_id uuid, count bigint, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.conversation_id, count(*), coalesce(sum(a.size_bytes::bigint), 0)
  from public.attachments a
  where a.user_id = p_user_id
    and a.status in ('pending', 'uploaded')
    and a.conversation_id is not null
  group by a.conversation_id;
$$;

revoke all on function public.klui_conversation_storage_totals(uuid) from public, anon, authenticated;
grant execute on function public.klui_conversation_storage_totals(uuid) to service_role;

create or replace function public.klui_reserve_attachment(
  p_user_id uuid,
  p_max_bytes bigint,
  p_category text,
  p_object_key text,
  p_file_name text,
  p_content_type text,
  p_size_bytes integer,
  p_conversation_id uuid default null,
  p_message_id uuid default null,
  p_project_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment public.attachments;
  v_pending integer;
  v_used bigint;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  if p_max_bytes is null or p_max_bytes <= 0 then raise exception 'account_limit_missing'; end if;
  if p_category not in ('image', 'document') then raise exception 'unsupported_attachment_category'; end if;
  if p_size_bytes is null or p_size_bytes <= 0 then raise exception 'invalid_attachment_size'; end if;
  if coalesce(p_object_key, '') = '' or coalesce(p_file_name, '') = '' or coalesce(p_content_type, '') = '' then
    raise exception 'invalid_attachment';
  end if;
  if p_object_key not like ('users/' || p_user_id::text || '/%') then
    raise exception 'attachment_owner_mismatch';
  end if;
  if p_conversation_id is not null and not exists (
    select 1 from public.conversations
    where id = p_conversation_id and user_id = p_user_id and deleted_at is null
  ) then
    raise exception 'conversation_not_found';
  end if;
  if p_message_id is not null and not exists (
    select 1 from public.messages
    where id = p_message_id and user_id = p_user_id
      and (p_conversation_id is null or conversation_id = p_conversation_id)
  ) then
    raise exception 'message_not_found';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects where id = p_project_id and user_id = p_user_id
  ) then
    raise exception 'project_not_found';
  end if;

  select count(*) into v_pending
  from public.attachments
  where user_id = p_user_id and status = 'pending';
  if v_pending >= 20 then
    raise exception 'pending_storage_limit_exceeded';
  end if;

  v_used := public.klui_account_storage_used(p_user_id, null);
  if v_used + p_size_bytes::bigint > p_max_bytes then
    raise exception 'account_storage_limit_exceeded';
  end if;

  insert into public.attachments (
    user_id, conversation_id, message_id, project_id, category,
    object_key, file_name, content_type, size_bytes, status
  ) values (
    p_user_id, p_conversation_id, p_message_id, p_project_id, p_category,
    p_object_key, p_file_name, p_content_type, p_size_bytes, 'pending'
  )
  returning * into v_attachment;

  return to_jsonb(v_attachment);
end;
$$;

revoke all on function public.klui_reserve_attachment(uuid, bigint, text, text, text, text, integer, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.klui_reserve_attachment(uuid, bigint, text, text, text, text, integer, uuid, uuid, uuid)
  to service_role;

create or replace function public.klui_complete_attachment(
  p_user_id uuid,
  p_attachment_id uuid,
  p_size_bytes integer,
  p_etag text,
  p_max_bytes bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment public.attachments;
  v_used bigint;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  if p_max_bytes is null or p_max_bytes <= 0 then raise exception 'account_limit_missing'; end if;
  if p_size_bytes is null or p_size_bytes <= 0 then raise exception 'invalid_attachment_size'; end if;

  select * into v_attachment
  from public.attachments
  where id = p_attachment_id and user_id = p_user_id
  for update;
  if not found then raise exception 'attachment_not_found'; end if;
  if v_attachment.status <> 'pending' then raise exception 'attachment_not_pending'; end if;

  v_used := public.klui_account_storage_used(p_user_id, p_attachment_id);
  if v_used + p_size_bytes::bigint > p_max_bytes then
    raise exception 'account_storage_limit_exceeded';
  end if;

  update public.attachments
  set status = 'uploaded',
      uploaded_at = coalesce(uploaded_at, now()),
      size_bytes = p_size_bytes,
      etag = coalesce(p_etag, etag)
  where id = v_attachment.id
  returning * into v_attachment;

  return to_jsonb(v_attachment);
end;
$$;

revoke all on function public.klui_complete_attachment(uuid, uuid, integer, text, bigint)
  from public, anon, authenticated;
grant execute on function public.klui_complete_attachment(uuid, uuid, integer, text, bigint)
  to service_role;

drop function if exists public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb, uuid, bigint);

create or replace function public.klui_complete_document_upload(
  p_user_id uuid,
  p_attachment_id uuid,
  p_size_bytes integer,
  p_etag text,
  p_kind text,
  p_limits jsonb default '{}'::jsonb,
  p_project_id uuid default null,
  p_project_max_bytes bigint default null,
  p_account_max_bytes bigint default null
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
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  if p_account_max_bytes is null or p_account_max_bytes <= 0 then
    raise exception 'account_limit_missing';
  end if;
  if p_kind not in ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv') then
    raise exception 'unsupported_document_kind';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then raise exception 'invalid_attachment_size'; end if;

  if p_project_id is not null then
    perform 1 from public.projects
    where id = p_project_id and user_id = p_user_id
    for update;
    if not found then raise exception 'project_not_found'; end if;
    if p_project_max_bytes is null or p_project_max_bytes <= 0 then
      raise exception 'project_limit_missing';
    end if;
  end if;

  select * into v_attachment
  from public.attachments
  where id = p_attachment_id and user_id = p_user_id
  for update;

  if not found then raise exception 'attachment_not_found'; end if;
  if v_attachment.category <> 'document' then raise exception 'attachment_is_not_document'; end if;
  if v_attachment.project_id is distinct from p_project_id then raise exception 'project_mismatch'; end if;

  if p_project_id is not null then
    select coalesce(sum(size_bytes), 0) into v_used_bytes
    from public.attachments
    where project_id = p_project_id
      and user_id = p_user_id
      and status = 'uploaded'
      and id <> v_attachment.id;
    if v_used_bytes + p_size_bytes::bigint > p_project_max_bytes then
      raise exception 'project_storage_limit_exceeded';
    end if;
  end if;

  v_used_bytes := public.klui_account_storage_used(p_user_id, v_attachment.id);
  if v_used_bytes + p_size_bytes::bigint > p_account_max_bytes then
    raise exception 'account_storage_limit_exceeded';
  end if;

  update public.attachments
  set status = 'uploaded',
      uploaded_at = coalesce(uploaded_at, now()),
      size_bytes = p_size_bytes,
      etag = coalesce(p_etag, etag)
  where id = v_attachment.id
  returning * into v_attachment;

  insert into public.document_files (
    attachment_id, user_id, conversation_id, message_id, project_id, kind, source,
    source_etag, processing_status, metadata
  ) values (
    v_attachment.id, v_attachment.user_id, v_attachment.conversation_id,
    v_attachment.message_id, v_attachment.project_id, p_kind, 'upload', v_attachment.etag, 'pending',
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

revoke all on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb, uuid, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb, uuid, bigint, bigint)
  to service_role;
