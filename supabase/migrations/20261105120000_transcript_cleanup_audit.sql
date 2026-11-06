-- Publishing a transcript can now also store the audit of its AI correction pass: which fixes
-- were applied, how many were rejected, and each changed line's machine-written text, so the
-- original can always be restored. The new argument is optional, so a worker still running the
-- previous build keeps publishing while this rolls out. Apply before deploying the transcriber.
drop function if exists public.klui_complete_transcription_job(uuid, text, jsonb, jsonb, integer, real, text, text, integer, text);

create or replace function public.klui_complete_transcription_job(
  p_job_id uuid, p_worker_id text,
  p_chunks jsonb, p_segments jsonb, p_word_count integer, p_duration_seconds real,
  p_audio_key text, p_audio_content_type text, p_audio_bytes integer, p_model text,
  p_cleanup jsonb default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.transcription_jobs;
  v_attachment public.attachments;
  v_document public.document_files;
  v_used bigint;
  v_old_key text;
  v_chunk jsonb;
  v_index integer := 0;
begin
  select * into v_job from public.transcription_jobs where id = p_job_id for update;
  if found and v_job.status = 'succeeded' and v_job.worker_id is not distinct from p_worker_id then
    select * into v_attachment from public.attachments where id = v_job.attachment_id;
    if found and v_attachment.object_key = p_audio_key then
      return jsonb_build_object('old_object_key', v_job.input->>'replaced_object_key', 'document_file_id', v_job.document_file_id);
    end if;
  end if;
  if not found or v_job.worker_id is distinct from p_worker_id or v_job.status <> 'running' then
    raise exception 'transcription_lease_lost';
  end if;
  if v_job.cancel_requested then raise exception 'transcription_cancelled'; end if;
  perform 1 from public.profiles where id = v_job.user_id for update;
  select * into v_attachment from public.attachments where id = v_job.attachment_id for update;
  if not found then raise exception 'transcription_cancelled'; end if;
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then raise exception 'empty_transcript'; end if;
  if coalesce(p_audio_key, '') = '' or p_audio_key not like ('users/' || v_job.user_id::text || '/%')
    or p_audio_bytes is null or p_audio_bytes <= 0 then
    raise exception 'invalid_audio_output';
  end if;

  select coalesce(sum(size_bytes), 0) into v_used from public.attachments
    where project_id = v_job.project_id and user_id = v_job.user_id and status = 'uploaded' and id <> v_attachment.id;
  if v_used + p_audio_bytes > coalesce((v_job.input->>'project_max_bytes')::bigint, 0) then
    raise exception 'project_storage_limit_exceeded';
  end if;
  if v_job.input ? 'account_max_bytes'
    and public.klui_account_storage_used(v_job.user_id, v_attachment.id) + p_audio_bytes
      > (v_job.input->>'account_max_bytes')::bigint then
    raise exception 'account_storage_limit_exceeded';
  end if;

  v_old_key := v_attachment.object_key;
  update public.attachments
    set object_key = p_audio_key, content_type = p_audio_content_type, size_bytes = p_audio_bytes, etag = null
    where id = v_attachment.id;

  delete from public.audio_object_cleanup where object_key = p_audio_key;
  if v_old_key is not null and v_old_key <> p_audio_key then
    insert into public.audio_object_cleanup (object_key, queue)
      values (v_old_key, v_job.queue)
      on conflict (object_key) do update set due_at = now();
  end if;

  delete from public.document_chunks where document_file_id = v_job.document_file_id;
  for v_chunk in select value from jsonb_array_elements(p_chunks) loop
    insert into public.document_chunks (
      document_file_id, user_id, chunk_index, source_type, source_label, text, char_count, token_estimate, metadata
    ) values (
      v_job.document_file_id, v_job.user_id, v_index, 'audio',
      coalesce(nullif(v_chunk->>'label', ''), 'Part ' || (v_index + 1)),
      v_chunk->>'text', length(v_chunk->>'text'), ceil(length(v_chunk->>'text') / 4.0)::integer,
      jsonb_build_object('start', (v_chunk->>'start')::real, 'end', (v_chunk->>'end')::real)
    );
    v_index := v_index + 1;
  end loop;

  update public.document_files
    set processing_status = 'ready', text_ready_at = now(), error = null,
        word_count = p_word_count, updated_at = now(),
        -- A retry that couldn't clean up must not keep the audit of an earlier attempt.
        metadata = (metadata - 'transcript_cleanup') || jsonb_build_object(
          'duration_seconds', p_duration_seconds, 'segments', coalesce(p_segments, '[]'::jsonb),
          'transcribed_at', now(), 'transcription_model', p_model
        ) || case when p_cleanup is null then '{}'::jsonb else jsonb_build_object('transcript_cleanup', p_cleanup) end
    where id = v_job.document_file_id
    returning * into v_document;

  update public.transcription_jobs
    set status = 'succeeded', stage = 'done', progress = 1, duration_seconds = p_duration_seconds,
        input = input || jsonb_build_object('replaced_object_key', v_old_key),
        finished_at = now(), lease_until = null, updated_at = now()
    where id = p_job_id;

  return jsonb_build_object('old_object_key', v_old_key, 'document_file_id', v_document.id);
end;
$$;

revoke all on function public.klui_complete_transcription_job(uuid, text, jsonb, jsonb, integer, real, text, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.klui_complete_transcription_job(uuid, text, jsonb, jsonb, integer, real, text, text, integer, text, jsonb) to service_role;

notify pgrst, 'reload schema';
