alter table public.document_jobs
  add column if not exists cancel_requested boolean not null default false;

create unique index if not exists document_jobs_extract_once_idx
  on public.document_jobs (document_file_id, job_type)
  where document_file_id is not null and job_type like 'document.extract.%';

create or replace function public.klui_claim_document_job(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns setof public.document_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with next_job as (
    select id
    from public.document_jobs
    where (status = 'queued' and cancel_requested = false)
       or (status = 'running' and lease_until < now())
    order by priority desc, created_at asc
    for update skip locked
    limit 1
  )
  update public.document_jobs j
  set
    status = 'running',
    worker_id = p_worker_id,
    attempt_count = j.attempt_count + 1,
    lease_until = now() + (greatest(coalesce(p_lease_seconds, 120), 30) || ' seconds')::interval,
    started_at = coalesce(j.started_at, now()),
    updated_at = now()
  from next_job
  where j.id = next_job.id
  returning j.*;
end;
$$;

revoke all on function public.klui_claim_document_job(text, integer) from public, anon, authenticated;
grant execute on function public.klui_claim_document_job(text, integer) to service_role;

create or replace function public.klui_complete_document_upload(
  p_user_id uuid,
  p_attachment_id uuid,
  p_size_bytes integer,
  p_etag text,
  p_kind text,
  p_limits jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment public.attachments;
  v_document public.document_files;
  v_job public.document_jobs;
begin
  if p_kind not in ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv') then
    raise exception 'unsupported_document_kind';
  end if;

  select * into v_attachment
  from public.attachments
  where id = p_attachment_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'attachment_not_found';
  end if;
  if v_attachment.category <> 'document' then
    raise exception 'attachment_is_not_document';
  end if;

  update public.attachments
  set status = 'uploaded',
      uploaded_at = coalesce(uploaded_at, now()),
      size_bytes = coalesce(p_size_bytes, size_bytes),
      etag = coalesce(p_etag, etag)
  where id = v_attachment.id
  returning * into v_attachment;

  insert into public.document_files (
    attachment_id, user_id, conversation_id, message_id, kind, source,
    source_etag, processing_status, metadata
  ) values (
    v_attachment.id, v_attachment.user_id, v_attachment.conversation_id,
    v_attachment.message_id, p_kind, 'upload', v_attachment.etag, 'pending',
    jsonb_build_object(
      'file_name', v_attachment.file_name,
      'content_type', v_attachment.content_type,
      'size_bytes', v_attachment.size_bytes
    )
  )
  on conflict (attachment_id) do update
    set source_etag = coalesce(excluded.source_etag, public.document_files.source_etag),
        updated_at = now()
  returning * into v_document;

  insert into public.document_jobs (
    user_id, document_file_id, conversation_id, message_id, job_type, input
  ) values (
    v_attachment.user_id, v_document.id, v_attachment.conversation_id,
    v_attachment.message_id, 'document.extract.' || p_kind,
    jsonb_build_object(
      'attachment_id', v_attachment.id,
      'object_key', v_attachment.object_key,
      'file_name', v_attachment.file_name,
      'content_type', v_attachment.content_type,
      'size_bytes', v_attachment.size_bytes,
      'etag', v_attachment.etag,
      'limits', coalesce(p_limits, '{}'::jsonb)
    )
  )
  on conflict do nothing
  returning * into v_job;

  if v_job.id is null then
    select * into v_job
    from public.document_jobs
    where document_file_id = v_document.id
      and job_type = 'document.extract.' || p_kind
    order by created_at asc
    limit 1;
  end if;

  return jsonb_build_object(
    'attachment', to_jsonb(v_attachment),
    'document_file', to_jsonb(v_document),
    'job', to_jsonb(v_job)
  );
end;
$$;

revoke all on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
