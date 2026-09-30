-- Pasted text, websites and audio also create document_files, and the embedding backfill
-- only scans its own queue's files. Record the creating app's document queue on them too.
-- Old callers keep working: the new argument defaults to production.

drop function if exists public.klui_complete_study_source(uuid, uuid, uuid, text, text, text, text, bigint);
create or replace function public.klui_complete_study_source(
  p_user_id uuid, p_attachment_id uuid, p_project_id uuid,
  p_kind text, p_title text, p_content text, p_source_url text,
  p_project_max_bytes bigint, p_document_queue text default 'production'
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attachment public.attachments;
  v_document public.document_files;
  v_used bigint;
  v_chunk text;
  v_start integer := 1;
  v_index integer := 0;
begin
  if coalesce(p_document_queue, '') !~ '^[a-z][a-z0-9_-]{0,31}$' then raise exception 'invalid_document_queue'; end if;
  -- Match the lock order used by the upload pipeline.
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  perform 1 from public.projects where id = p_project_id and user_id = p_user_id and kind = 'course' for update;
  if not found then raise exception 'course_not_found'; end if;
  select * into v_attachment from public.attachments
    where id = p_attachment_id and user_id = p_user_id for update;
  if not found or v_attachment.category <> 'document' or v_attachment.status <> 'pending'
    or v_attachment.project_id is distinct from p_project_id then
    raise exception 'invalid_source_attachment';
  end if;
  if p_kind is null or p_kind not in ('text', 'website') or coalesce(length(trim(p_content)), 0) = 0
    or length(p_content) > 200000 or coalesce(length(trim(p_title)), 0) = 0 or length(p_title) > 120
    or octet_length(p_content) <> v_attachment.size_bytes then
    raise exception 'invalid_source_content';
  end if;
  if p_project_max_bytes is null or p_project_max_bytes <= 0 then raise exception 'project_limit_missing'; end if;
  select coalesce(sum(size_bytes), 0) into v_used from public.attachments
    where project_id = p_project_id and user_id = p_user_id and status = 'uploaded';
  if v_used + v_attachment.size_bytes > p_project_max_bytes then raise exception 'project_storage_limit_exceeded'; end if;

  insert into public.document_files (
    attachment_id, user_id, project_id, kind, source, processing_status, text_ready_at, word_count, metadata, queue
  ) values (
    v_attachment.id, p_user_id, p_project_id, p_kind, 'upload', 'ready', now(),
    cardinality(regexp_split_to_array(trim(p_content), '\s+')),
    jsonb_build_object('title', p_title, 'source_url', p_source_url, 'file_name', v_attachment.file_name),
    p_document_queue
  ) returning * into v_document;
  while v_start <= length(p_content) loop
    -- Break near a word boundary without losing any characters between chunks.
    v_chunk := substring(p_content from v_start for 6000);
    if v_start + 6000 <= length(p_content) and v_chunk ~ '\s' then
      v_chunk := regexp_replace(v_chunk, '\S+$', '');
    end if;
    insert into public.document_chunks (document_file_id, user_id, chunk_index, source_type, source_label, text, char_count, token_estimate)
      values (v_document.id, p_user_id, v_index, p_kind, 'Excerpt ' || (v_index + 1), v_chunk, length(v_chunk), ceil(length(v_chunk) / 4.0)::integer);
    v_start := v_start + length(v_chunk);
    v_index := v_index + 1;
  end loop;
  update public.attachments set status = 'uploaded', uploaded_at = now() where id = v_attachment.id;
  return to_jsonb(v_document);
end;
$$;
revoke all on function public.klui_complete_study_source(uuid, uuid, uuid, text, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.klui_complete_study_source(uuid, uuid, uuid, text, text, text, text, bigint, text) to service_role;

drop function if exists public.klui_enqueue_transcription(uuid, uuid, uuid, text, text, real, integer, text, bigint, integer, text, bigint);
create or replace function public.klui_enqueue_transcription(
  p_user_id uuid, p_attachment_id uuid, p_project_id uuid,
  p_title text, p_audio_source text, p_duration_hint real,
  p_size_bytes integer, p_etag text,
  p_project_max_bytes bigint, p_max_active integer, p_queue text,
  p_account_max_bytes bigint default null,
  p_document_queue text default 'production'
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attachment public.attachments;
  v_document public.document_files;
  v_job public.transcription_jobs;
  v_used bigint;
  v_active integer;
  v_estimate integer;
begin
  if coalesce(p_document_queue, '') !~ '^[a-z][a-z0-9_-]{0,31}$' then raise exception 'invalid_document_queue'; end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  perform 1 from public.projects where id = p_project_id and user_id = p_user_id and kind = 'course' for update;
  if not found then raise exception 'course_not_found'; end if;
  select * into v_attachment from public.attachments
    where id = p_attachment_id and user_id = p_user_id for update;
  if not found or v_attachment.category <> 'document'
    or v_attachment.project_id is distinct from p_project_id
    or v_attachment.content_type not like 'audio/%' then
    raise exception 'invalid_audio_attachment';
  end if;

  -- Already queued (the first call committed but its response was lost): same answer again.
  if v_attachment.status = 'uploaded' then
    select * into v_job from public.transcription_jobs where attachment_id = v_attachment.id and user_id = p_user_id;
    if not found then raise exception 'invalid_audio_attachment'; end if;
    select * into v_document from public.document_files where id = v_job.document_file_id;
    return jsonb_build_object('document', to_jsonb(v_document), 'job', to_jsonb(v_job));
  end if;
  if v_attachment.status <> 'pending' then raise exception 'invalid_audio_attachment'; end if;

  if p_size_bytes is null or p_size_bytes <> v_attachment.size_bytes then raise exception 'invalid_attachment_size'; end if;
  if coalesce(length(trim(p_title)), 0) = 0 or length(p_title) > 120 then raise exception 'invalid_source_content'; end if;
  if p_audio_source not in ('upload', 'recording') then raise exception 'invalid_source_content'; end if;
  if p_project_max_bytes is null or p_project_max_bytes <= 0 then raise exception 'project_limit_missing'; end if;

  select count(*) into v_active from public.transcription_jobs
    where user_id = p_user_id and status in ('queued', 'running');
  if v_active >= greatest(coalesce(p_max_active, 5), 1) then raise exception 'transcription_queue_full'; end if;

  -- Only a compact speech copy is kept once the job is done, so quotas count that size
  -- from the start (counting the original would let one queued lecture block the rest of
  -- the course). The duration comes from the browser, so it is only a first guess: the
  -- worker corrects it from the decoded audio, and a failed job counts the original again.
  v_estimate := public.klui_audio_estimate_bytes(p_duration_hint, p_size_bytes);
  select coalesce(sum(size_bytes), 0) into v_used from public.attachments
    where project_id = p_project_id and user_id = p_user_id and status = 'uploaded';
  if v_used + v_estimate > p_project_max_bytes then
    raise exception 'project_storage_limit_exceeded';
  end if;

  insert into public.document_files (
    attachment_id, user_id, project_id, kind, source, source_etag, processing_status, metadata, queue
  ) values (
    v_attachment.id, p_user_id, p_project_id, 'audio', 'upload', p_etag, 'pending',
    jsonb_build_object(
      'title', p_title, 'file_name', v_attachment.file_name, 'audio_source', p_audio_source,
      'duration_seconds', case when p_duration_hint > 0 then p_duration_hint else null end
    ),
    p_document_queue
  ) returning * into v_document;

  update public.attachments
    set status = 'uploaded', uploaded_at = now(), etag = coalesce(p_etag, etag), size_bytes = v_estimate
    where id = v_attachment.id;

  insert into public.transcription_jobs (
    user_id, project_id, document_file_id, attachment_id, input, duration_seconds, queue
  ) values (
    p_user_id, p_project_id, v_document.id, v_attachment.id,
    jsonb_strip_nulls(jsonb_build_object(
      'project_max_bytes', p_project_max_bytes, 'original_bytes', p_size_bytes,
      'account_max_bytes', case when p_account_max_bytes > 0 then p_account_max_bytes end
    )),
    case when p_duration_hint > 0 then p_duration_hint else null end,
    public.klui_transcription_queue(p_queue)
  ) returning * into v_job;

  return jsonb_build_object('document', to_jsonb(v_document), 'job', to_jsonb(v_job));
end;
$$;

-- A cancelled job's source is being deleted (its size is already zero), so it never gets
revoke all on function public.klui_enqueue_transcription(uuid, uuid, uuid, text, text, real, integer, text, bigint, integer, text, bigint, text) from public, anon, authenticated;
grant execute on function public.klui_enqueue_transcription(uuid, uuid, uuid, text, text, real, integer, text, bigint, integer, text, bigint, text) to service_role;

notify pgrst, 'reload schema';
