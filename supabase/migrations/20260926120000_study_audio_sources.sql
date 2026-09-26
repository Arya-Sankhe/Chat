-- Audio sources for Dojo: an uploaded or recorded lecture becomes a transcript source.
-- Transcription runs in its own service (transcriber) with its own queue so it can
-- never starve document processing, and so the document worker never claims audio jobs.

alter table public.document_files drop constraint if exists document_files_kind_check;
alter table public.document_files add constraint document_files_kind_check
  check (kind in ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv', 'text', 'website', 'audio'));

create table if not exists public.transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_file_id uuid not null references public.document_files(id) on delete cascade,
  attachment_id uuid not null references public.attachments(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stage text,
  progress real not null default 0 check (progress >= 0 and progress <= 1),
  attempt_count integer not null default 0,
  cancel_requested boolean not null default false,
  worker_id text,
  lease_until timestamptz,
  input jsonb not null default '{}'::jsonb,
  duration_seconds real,
  error jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (document_file_id)
);

create index if not exists transcription_jobs_active_idx
  on public.transcription_jobs (created_at)
  where status in ('queued', 'running');
create index if not exists transcription_jobs_project_idx
  on public.transcription_jobs (project_id, created_at desc);
create index if not exists transcription_jobs_user_idx
  on public.transcription_jobs (user_id);
create index if not exists transcription_jobs_attachment_idx
  on public.transcription_jobs (attachment_id);

-- Service role only; the API and worker both use it.
alter table public.transcription_jobs enable row level security;
revoke all on table public.transcription_jobs from anon, authenticated;
grant select, insert, update, delete on table public.transcription_jobs to service_role;

-- Turn a finished upload into a queued audio source. The attachment leaves 'pending'
-- here so the pending-upload sweeper can never delete a lecture that is waiting its turn.
create or replace function public.klui_enqueue_transcription(
  p_user_id uuid, p_attachment_id uuid, p_project_id uuid,
  p_title text, p_audio_source text, p_duration_hint real,
  p_size_bytes integer, p_etag text,
  p_project_max_bytes bigint, p_max_active integer
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
  if not found or v_attachment.category <> 'document' or v_attachment.status <> 'pending'
    or v_attachment.project_id is distinct from p_project_id
    or v_attachment.content_type not like 'audio/%' then
    raise exception 'invalid_audio_attachment';
  end if;
  if p_size_bytes is null or p_size_bytes <> v_attachment.size_bytes then raise exception 'invalid_attachment_size'; end if;
  if coalesce(length(trim(p_title)), 0) = 0 or length(p_title) > 120 then raise exception 'invalid_source_content'; end if;
  if p_audio_source not in ('upload', 'recording') then raise exception 'invalid_source_content'; end if;
  if p_project_max_bytes is null or p_project_max_bytes <= 0 then raise exception 'project_limit_missing'; end if;

  select count(*) into v_active from public.transcription_jobs
    where user_id = p_user_id and status in ('queued', 'running');
  if v_active >= greatest(coalesce(p_max_active, 5), 1) then raise exception 'transcription_queue_full'; end if;

  -- Only a compact speech copy (48 kbps AAC, ~6.2 KB per second) is kept once the job is
  -- done, so quotas count that size from the start; the worker records the exact size.
  -- Counting the original would let one queued lecture block the rest of the course.
  v_estimate := case when p_duration_hint > 0
    then least(p_size_bytes, ceil(p_duration_hint * 6200)::integer) else p_size_bytes end;
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
    user_id, project_id, document_file_id, attachment_id, input, duration_seconds
  ) values (
    p_user_id, p_project_id, v_document.id, v_attachment.id,
    jsonb_build_object('project_max_bytes', p_project_max_bytes, 'original_bytes', p_size_bytes),
    case when p_duration_hint > 0 then p_duration_hint else null end
  ) returning * into v_job;

  return jsonb_build_object('document', to_jsonb(v_document), 'job', to_jsonb(v_job));
end;
$$;

-- One job at a time per worker, oldest first. A job whose worker vanished is reclaimed
-- after its lease runs out; three attempts and it fails instead of looping forever.
create or replace function public.klui_claim_transcription_job(
  p_worker_id text, p_lease_seconds integer default 120
) returns setof public.transcription_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  with exhausted as (
    update public.transcription_jobs
    set status = 'failed',
        error = jsonb_build_object('code', 'worker_retries_exhausted', 'message', 'Transcription stopped after repeated worker failures. Try again.'),
        finished_at = now(), lease_until = null, updated_at = now()
    where status = 'running' and lease_until < now() and attempt_count >= 3
    returning document_file_id, error
  )
  update public.document_files d
    set processing_status = 'failed', error = exhausted.error, updated_at = now()
    from exhausted where d.id = exhausted.document_file_id;

  update public.transcription_jobs
    set status = 'cancelled', finished_at = now(), lease_until = null, updated_at = now()
    where status = 'running' and cancel_requested and lease_until < now();

  return query
  with next_job as (
    select id from public.transcription_jobs
    where (status = 'queued' and not cancel_requested)
       or (status = 'running' and lease_until < now() and attempt_count < 3 and not cancel_requested)
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

-- Renews the lease and records progress. Returns false when the worker should stop
-- (lease lost to another worker, or the user deleted the source).
create or replace function public.klui_heartbeat_transcription_job(
  p_job_id uuid, p_worker_id text, p_lease_seconds integer,
  p_stage text, p_progress real, p_duration_seconds real
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  update public.transcription_jobs
    set lease_until = now() + (greatest(coalesce(p_lease_seconds, 120), 30) || ' seconds')::interval,
        stage = coalesce(p_stage, stage),
        progress = least(greatest(coalesce(p_progress, progress), 0), 1),
        duration_seconds = coalesce(p_duration_seconds, duration_seconds),
        updated_at = now()
    where id = p_job_id and worker_id = p_worker_id and status = 'running' and not cancel_requested
    returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- Publishes the transcript atomically: chunks, segments, and the swap to the compact
-- audio copy all land together, or nothing does.
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

  v_old_key := v_attachment.object_key;
  update public.attachments
    set object_key = p_audio_key, content_type = p_audio_content_type, size_bytes = p_audio_bytes, etag = null
    where id = v_attachment.id;

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
        finished_at = now(), lease_until = null, updated_at = now()
    where id = p_job_id;

  return jsonb_build_object('old_object_key', v_old_key, 'document_file_id', v_document.id);
end;
$$;

-- A retryable failure goes back in the queue (bounded by attempt_count); anything else
-- marks the source failed so the user sees why and can retry or delete it.
create or replace function public.klui_fail_transcription_job(
  p_job_id uuid, p_worker_id text, p_error jsonb, p_retryable boolean
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.transcription_jobs;
begin
  select * into v_job from public.transcription_jobs where id = p_job_id for update;
  if not found or v_job.worker_id is distinct from p_worker_id or v_job.status <> 'running' then
    return 'ignored';
  end if;
  if v_job.cancel_requested then
    update public.transcription_jobs set status = 'cancelled', finished_at = now(), lease_until = null, updated_at = now()
      where id = p_job_id;
    return 'cancelled';
  end if;
  if p_retryable and v_job.attempt_count < 3 then
    update public.transcription_jobs
      set status = 'queued', worker_id = null, lease_until = null, stage = null, progress = 0, error = p_error, updated_at = now()
      where id = p_job_id;
    update public.document_files set processing_status = 'pending', updated_at = now() where id = v_job.document_file_id;
    return 'requeued';
  end if;
  update public.transcription_jobs
    set status = 'failed', error = p_error, finished_at = now(), lease_until = null, updated_at = now()
    where id = p_job_id;
  update public.document_files set processing_status = 'failed', error = p_error, updated_at = now()
    where id = v_job.document_file_id;
  return 'failed';
end;
$$;

-- User actions: retry a failed transcription, or cancel one because its source was deleted.
create or replace function public.klui_retry_transcription_job(p_user_id uuid, p_document_file_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.transcription_jobs;
begin
  update public.transcription_jobs
    set status = 'queued', attempt_count = 0, error = null, stage = null, progress = 0,
        worker_id = null, lease_until = null, finished_at = null, cancel_requested = false, updated_at = now()
    where document_file_id = p_document_file_id and user_id = p_user_id and status = 'failed'
    returning * into v_job;
  if not found then raise exception 'transcription_not_retryable'; end if;
  update public.document_files set processing_status = 'pending', error = null, updated_at = now()
    where id = p_document_file_id;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.klui_cancel_transcription_job(p_user_id uuid, p_document_file_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.transcription_jobs
    set cancel_requested = true,
        status = case when status = 'queued' then 'cancelled' else status end,
        finished_at = case when status = 'queued' then now() else finished_at end,
        updated_at = now()
    where document_file_id = p_document_file_id and user_id = p_user_id and status in ('queued', 'running');
end;
$$;

-- What the Sources panel shows: each audio source's job, with its place in the shared line.
create or replace function public.klui_transcription_status(p_user_id uuid, p_project_id uuid)
returns table (
  document_file_id uuid, status text, stage text, progress real, duration_seconds real,
  queue_position integer, error jsonb, created_at timestamptz, started_at timestamptz, finished_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select j.document_file_id, j.status, j.stage, j.progress, j.duration_seconds,
    case when j.status = 'queued' then (
      select count(*)::integer from public.transcription_jobs q
      where q.status in ('queued', 'running') and not q.cancel_requested
        and (q.status = 'running' or q.created_at < j.created_at)
    ) end,
    j.error, j.created_at, j.started_at, j.finished_at
  from public.transcription_jobs j
  where j.user_id = p_user_id and j.project_id = p_project_id and j.status <> 'cancelled';
$$;

revoke all on function public.klui_enqueue_transcription(uuid, uuid, uuid, text, text, real, integer, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.klui_claim_transcription_job(text, integer) from public, anon, authenticated;
revoke all on function public.klui_heartbeat_transcription_job(uuid, text, integer, text, real, real) from public, anon, authenticated;
revoke all on function public.klui_complete_transcription_job(uuid, text, jsonb, jsonb, integer, real, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.klui_fail_transcription_job(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.klui_retry_transcription_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.klui_cancel_transcription_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.klui_transcription_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.klui_enqueue_transcription(uuid, uuid, uuid, text, text, real, integer, text, bigint, integer) to service_role;
grant execute on function public.klui_claim_transcription_job(text, integer) to service_role;
grant execute on function public.klui_heartbeat_transcription_job(uuid, text, integer, text, real, real) to service_role;
grant execute on function public.klui_complete_transcription_job(uuid, text, jsonb, jsonb, integer, real, text, text, integer, text) to service_role;
grant execute on function public.klui_fail_transcription_job(uuid, text, jsonb, boolean) to service_role;
grant execute on function public.klui_retry_transcription_job(uuid, uuid) to service_role;
grant execute on function public.klui_cancel_transcription_job(uuid, uuid) to service_role;
grant execute on function public.klui_transcription_status(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
