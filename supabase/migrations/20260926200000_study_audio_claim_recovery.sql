-- A claim whose response is lost is retried by the worker. Without this, the retry claims
-- a second job, and the first sits "running" under the same worker until its lease runs
-- out, using up an attempt without any work done. A worker handles one job at a time and
-- only claims when it has none, so a running job already under its id is one whose claim
-- response it never saw: hand that job back (lease renewed, attempt unchanged).
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
  v_lease interval := (greatest(coalesce(p_lease_seconds, 120), 30) || ' seconds')::interval;
begin
  return query
  update public.transcription_jobs
    set lease_until = now() + v_lease, updated_at = now()
    where id = (
      select id from public.transcription_jobs
      where queue = v_queue and status = 'running' and worker_id = p_worker_id and not cancel_requested
      order by created_at asc
      limit 1
      for update
    )
    returning *;
  if found then
    return;
  end if;

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
        lease_until = now() + v_lease,
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

revoke all on function public.klui_claim_transcription_job(text, integer, text) from public, anon, authenticated;
grant execute on function public.klui_claim_transcription_job(text, integer, text) to service_role;

notify pgrst, 'reload schema';
