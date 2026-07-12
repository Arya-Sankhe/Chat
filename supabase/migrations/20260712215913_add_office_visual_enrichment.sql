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
  v_jobs jsonb;
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

revoke all on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb)
  to service_role;

create or replace function public.klui_queue_document_page_render(
  p_user_id uuid,
  p_document_file_id uuid,
  p_page_number integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.document_files;
  v_page public.document_pages;
  v_job public.document_jobs;
begin
  if p_page_number is null or p_page_number < 1 then raise exception 'invalid_page_number'; end if;

  select * into v_document
  from public.document_files
  where id = p_document_file_id
    and user_id = p_user_id
    and kind in ('pdf', 'docx', 'xlsx', 'pptx')
  for update;
  if not found then raise exception 'document_not_found'; end if;
  if v_document.page_count is not null and p_page_number > v_document.page_count then
    raise exception 'page_out_of_range';
  end if;

  select * into v_page
  from public.document_pages
  where document_file_id = v_document.id and page_number = p_page_number;
  if v_page.id is not null and length(trim(v_page.image_key)) > 0 then
    return jsonb_build_object('page', to_jsonb(v_page), 'job', null);
  elsif v_page.id is not null then
    delete from public.document_pages where id = v_page.id;
    v_page := null;
  end if;

  select * into v_job
  from public.document_jobs
  where document_file_id = v_document.id
    and job_type = 'document.render_page'
    and (input ->> 'page_number')::integer = p_page_number
  for update;

  if v_job.id is null then
    insert into public.document_jobs (
      user_id, document_file_id, conversation_id, message_id,
      job_type, priority, input
    ) values (
      v_document.user_id, v_document.id, v_document.conversation_id, v_document.message_id,
      'document.render_page', 100,
      jsonb_build_object('page_number', p_page_number, 'attachment_id', v_document.attachment_id)
    ) returning * into v_job;
  elsif v_job.status in ('failed', 'expired', 'succeeded') then
    update public.document_jobs
    set status = 'queued',
        priority = 100,
        attempt_count = 0,
        worker_id = null,
        lease_until = null,
        output = '{}'::jsonb,
        error = null,
        cancel_requested = false,
        started_at = null,
        finished_at = null,
        updated_at = now()
    where id = v_job.id
    returning * into v_job;
  end if;

  return jsonb_build_object('page', null, 'job', to_jsonb(v_job));
end;
$$;

revoke all on function public.klui_queue_document_page_render(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.klui_queue_document_page_render(uuid, uuid, integer)
  to service_role;
