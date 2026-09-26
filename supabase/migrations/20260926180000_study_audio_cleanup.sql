-- Second follow-up to study_audio_sources:
--  * Audio objects that may be left behind in R2 (a compact copy whose publish outcome is
--    unknown, an original whose delete failed, an upload released after a failed enqueue)
--    are recorded in audio_object_cleanup before they can be lost track of. The transcriber
--    deletes them once nothing references them.
--  * Releasing a failed enqueue is atomic: it waits for any in-flight enqueue to commit and
--    only removes the upload if it is still pending.
--  * Publishing also checks the account storage limit, since the compact copy can be larger
--    than a highly compressed original.
--  * A cancelled job that runs out of attempts stays cancelled, so a deleted source doesn't
--    start counting toward storage again.

create table if not exists public.audio_object_cleanup (
  object_key text primary key,
  queue text not null,
  due_at timestamptz not null default now(),
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists audio_object_cleanup_due_idx on public.audio_object_cleanup (queue, due_at);
alter table public.audio_object_cleanup enable row level security;
revoke all on table public.audio_object_cleanup from public, anon, authenticated;
grant select, insert, update, delete on table public.audio_object_cleanup to service_role;

-- The worker records the compact copy's key before uploading it. If the publish outcome
-- is never learned, the row outlives the job and the sweep removes the object, unless
-- the attachment ended up pointing at it.
create or replace function public.klui_note_audio_object(p_job_id uuid, p_worker_id text, p_key text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.transcription_jobs;
begin
  select * into v_job from public.transcription_jobs where id = p_job_id;
  if not found or v_job.worker_id is distinct from p_worker_id or v_job.status <> 'running' then
    raise exception 'transcription_lease_lost';
  end if;
  if coalesce(p_key, '') = '' or p_key not like ('users/' || v_job.user_id::text || '/%') then
    raise exception 'invalid_audio_output';
  end if;
  insert into public.audio_object_cleanup (object_key, queue, due_at)
    values (p_key, v_job.queue, now() + interval '1 day')
    on conflict (object_key) do nothing;
end;
$$;

-- Returns up to p_limit keys that are due and unreferenced, pushing each one's next try
-- back an hour so a failed delete is retried later. Rows whose key is in use are dropped.
create or replace function public.klui_claim_audio_object_cleanup(p_queue text, p_limit integer default 50)
returns setof text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_queue text := public.klui_transcription_queue(p_queue);
begin
  delete from public.audio_object_cleanup c
    where c.queue = v_queue and c.due_at < now()
      and exists (select 1 from public.attachments a where a.object_key = c.object_key);
  return query
  with due as (
    select c.object_key from public.audio_object_cleanup c
    where c.queue = v_queue and c.due_at < now()
    order by c.due_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 500)
  )
  update public.audio_object_cleanup c
    set due_at = now() + interval '1 hour', attempts = c.attempts + 1
    from due where c.object_key = due.object_key
    returning c.object_key;
end;
$$;

create or replace function public.klui_finish_audio_object_cleanup(p_keys text[])
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.audio_object_cleanup c
    where c.object_key = any(coalesce(p_keys, '{}'))
      and not exists (select 1 from public.attachments a where a.object_key = c.object_key);
$$;

-- Called when enqueue failed. The row lock waits for an enqueue that is still running, so
-- an upload that did get queued is never removed. A still-pending upload's row is deleted
-- and its object is recorded for cleanup in the same transaction; the key is returned so
-- the app can delete it right away.
create or replace function public.klui_release_pending_audio(p_user_id uuid, p_attachment_id uuid, p_queue text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attachment public.attachments;
begin
  select * into v_attachment from public.attachments
    where id = p_attachment_id and user_id = p_user_id for update;
  if not found or v_attachment.status <> 'pending' then return null; end if;
  delete from public.attachments where id = v_attachment.id;
  insert into public.audio_object_cleanup (object_key, queue)
    values (v_attachment.object_key, public.klui_transcription_queue(p_queue))
    on conflict (object_key) do update set due_at = now();
  return v_attachment.object_key;
end;
$$;

-- Enqueue now also remembers the account limit, so publishing can check it.
drop function if exists public.klui_enqueue_transcription(uuid, uuid, uuid, text, text, real, integer, text, bigint, integer, text);
create or replace function public.klui_enqueue_transcription(
  p_user_id uuid, p_attachment_id uuid, p_project_id uuid,
  p_title text, p_audio_source text, p_duration_hint real,
  p_size_bytes integer, p_etag text,
  p_project_max_bytes bigint, p_max_active integer, p_queue text,
  p_account_max_bytes bigint default null
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
    attachment_id, user_id, project_id, kind, source, source_etag, processing_status, metadata
  ) values (
    v_attachment.id, p_user_id, p_project_id, 'audio', 'upload', p_etag, 'pending',
    jsonb_build_object(
      'title', p_title, 'file_name', v_attachment.file_name, 'audio_source', p_audio_source,
      'duration_seconds', case when p_duration_hint > 0 then p_duration_hint else null end
    )
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
-- its original size back.
create or replace function public.klui_restore_audio_original_size(p_job public.transcription_jobs)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.attachments
    set size_bytes = greatest(size_bytes, coalesce((p_job.input->>'original_bytes')::integer, size_bytes))
    where id = p_job.attachment_id and p_job.input ? 'original_bytes'
      and not (p_job.input ? 'replaced_object_key') and not p_job.cancel_requested;
$$;

-- Cancelled jobs are settled before the exhausted-attempts sweep, which now skips them.
create or replace function public.klui_claim_transcription_job(
  p_worker_id text, p_lease_seconds integer default 120, p_queue text default 'local'
) returns setof public.transcription_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_queue text := public.klui_transcription_queue(p_queue);
  v_job public.transcription_jobs;
begin
  update public.transcription_jobs
    set status = 'cancelled', finished_at = now(), lease_until = null, updated_at = now()
    where queue = v_queue and status = 'running' and cancel_requested and lease_until < now();

  for v_job in
    update public.transcription_jobs
    set status = 'failed',
        error = jsonb_build_object('code', 'worker_retries_exhausted', 'message', 'Transcription stopped after repeated worker failures. Try again.'),
        finished_at = now(), lease_until = null, updated_at = now()
    where queue = v_queue and status = 'running' and lease_until < now() and attempt_count >= 3
      and not cancel_requested
    returning *
  loop
    update public.document_files set processing_status = 'failed', error = v_job.error, updated_at = now()
      where id = v_job.document_file_id;
    perform public.klui_restore_audio_original_size(v_job);
  end loop;

  return query
  with next_job as (
    select id from public.transcription_jobs
    where queue = v_queue and (
      (status = 'queued' and not cancel_requested)
      or (status = 'running' and lease_until < now() and attempt_count < 3 and not cancel_requested)
    )
    order by created_at asc
    for update skip locked
    limit 1
  ), claimed as (
    update public.transcription_jobs j
    set status = 'running', worker_id = p_worker_id, attempt_count = j.attempt_count + 1,
        stage = 'preparing', progress = 0, error = null,
        lease_until = now() + (greatest(coalesce(p_lease_seconds, 120), 30) || ' seconds')::interval,
        started_at = coalesce(j.started_at, now()), updated_at = now()
    from next_job where j.id = next_job.id
    returning j.*
  ), marked as (
    update public.document_files d set processing_status = 'processing', error = null, updated_at = now()
    from claimed where d.id = claimed.document_file_id
    returning d.id
  )
  select * from claimed;
end;
$$;

-- Publishing checks the account limit as well as the course limit, takes the new copy
-- off the cleanup list, and puts the replaced original on it (the worker deletes it right
-- away; the row makes sure a failed delete is retried).
create or replace function public.klui_complete_transcription_job(
  p_job_id uuid, p_worker_id text,
  p_chunks jsonb, p_segments jsonb, p_word_count integer, p_duration_seconds real,
  p_audio_key text, p_audio_content_type text, p_audio_bytes integer, p_model text
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
        metadata = metadata || jsonb_build_object(
          'duration_seconds', p_duration_seconds, 'segments', coalesce(p_segments, '[]'::jsonb),
          'transcribed_at', now(), 'transcription_model', p_model
        )
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

revoke all on function public.klui_note_audio_object(uuid, text, text) from public, anon, authenticated;
revoke all on function public.klui_claim_audio_object_cleanup(text, integer) from public, anon, authenticated;
revoke all on function public.klui_finish_audio_object_cleanup(text[]) from public, anon, authenticated;
revoke all on function public.klui_release_pending_audio(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.klui_enqueue_transcription(uuid, uuid, uuid, text, text, real, integer, text, bigint, integer, text, bigint) from public, anon, authenticated;
revoke all on function public.klui_restore_audio_original_size(public.transcription_jobs) from public, anon, authenticated;
revoke all on function public.klui_claim_transcription_job(text, integer, text) from public, anon, authenticated;
revoke all on function public.klui_complete_transcription_job(uuid, text, jsonb, jsonb, integer, real, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.klui_note_audio_object(uuid, text, text) to service_role;
grant execute on function public.klui_claim_audio_object_cleanup(text, integer) to service_role;
grant execute on function public.klui_finish_audio_object_cleanup(text[]) to service_role;
grant execute on function public.klui_release_pending_audio(uuid, uuid, text) to service_role;
grant execute on function public.klui_enqueue_transcription(uuid, uuid, uuid, text, text, real, integer, text, bigint, integer, text, bigint) to service_role;
grant execute on function public.klui_restore_audio_original_size(public.transcription_jobs) to service_role;
grant execute on function public.klui_claim_transcription_job(text, integer, text) to service_role;
grant execute on function public.klui_complete_transcription_job(uuid, text, jsonb, jsonb, integer, real, text, text, integer, text) to service_role;

notify pgrst, 'reload schema';
