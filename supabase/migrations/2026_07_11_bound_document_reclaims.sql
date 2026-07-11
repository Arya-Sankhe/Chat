create or replace function public.klui_claim_document_job(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns setof public.document_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  with exhausted as (
    update public.document_jobs
    set status = 'failed',
        error = jsonb_build_object('code', 'worker_retries_exhausted', 'message', 'Document processing stopped after repeated worker failures.'),
        finished_at = now(),
        lease_until = null,
        updated_at = now()
    where status = 'running'
      and lease_until < now()
      and attempt_count >= 3
    returning document_file_id, error
  )
  update public.document_files d
  set processing_status = 'failed',
      error = exhausted.error,
      updated_at = now()
  from exhausted
  where d.id = exhausted.document_file_id;

  return query
  with next_job as (
    select id
    from public.document_jobs
    where (status = 'queued' and cancel_requested = false)
       or (status = 'running' and lease_until < now() and attempt_count < 3)
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

notify pgrst, 'reload schema';
