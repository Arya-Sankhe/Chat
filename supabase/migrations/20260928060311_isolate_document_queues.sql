-- Legacy document jobs and old application/worker calls stay on production during rollout.
-- New callers pass their own queue; no worker can claim across queues.
alter table public.document_jobs
  add column if not exists queue text not null default 'production';
alter table public.document_jobs
  drop constraint if exists document_jobs_queue_check;
alter table public.document_jobs
  add constraint document_jobs_queue_check check (queue ~ '^[a-z][a-z0-9_-]{0,31}$');
create index if not exists document_jobs_queue_claim_idx
  on public.document_jobs (queue, priority desc, created_at asc)
  where cancel_requested = false and status in ('queued', 'running');

drop function if exists public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb, uuid, bigint, bigint);
create or replace function public.klui_complete_document_upload(
  p_user_id uuid,
  p_attachment_id uuid,
  p_size_bytes integer,
  p_etag text,
  p_kind text,
  p_limits jsonb default '{}'::jsonb,
  p_project_id uuid default null,
  p_project_max_bytes bigint default null,
  p_account_max_bytes bigint default null,
  p_queue text default 'production'
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
  if coalesce(p_queue, '') !~ '^[a-z][a-z0-9_-]{0,31}$' then raise exception 'invalid_document_queue'; end if;
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
    user_id, document_file_id, conversation_id, message_id, job_type, priority, input, queue
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
    ),
    p_queue
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
revoke all on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb, uuid, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb, uuid, bigint, bigint, text) to service_role;

drop function if exists public.klui_claim_document_job(text, integer);
create or replace function public.klui_claim_document_job(
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_queue text default 'production'
) returns setof public.document_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_failed record;
  v_has_active_core boolean;
begin
  for v_failed in
    update public.document_jobs
    set status = 'failed',
        error = case
          when cancel_requested then jsonb_build_object('code', 'job_cancelled', 'message', 'Document processing was cancelled.')
          else jsonb_build_object('code', 'worker_retries_exhausted', 'message', 'Document processing stopped after repeated worker failures.')
        end,
        finished_at = now(),
        lease_until = null,
        updated_at = now()
    where queue = p_queue and status = 'running'
      and lease_until < now()
      and (cancel_requested = true or attempt_count >= 3)
    returning document_file_id, job_type, error
  loop
    if v_failed.document_file_id is null or v_failed.job_type = 'document.render_page' then
      continue;
    end if;

    update public.document_files
    set stage_errors = stage_errors || jsonb_build_object(
          case when v_failed.job_type = 'document.enrich.pdf' then 'visual' else 'text' end,
          v_failed.error
        ),
        updated_at = now()
    where id = v_failed.document_file_id;

    select exists (
      select 1
      from public.document_jobs j
      where j.document_file_id = v_failed.document_file_id
        and (j.job_type like 'document.extract.%' or j.job_type = 'document.enrich.pdf')
        and j.status in ('queued', 'running')
        and j.cancel_requested = false
    ) into v_has_active_core;

    update public.document_files
    set processing_status = case
          when v_has_active_core then 'processing'
          when text_ready_at is not null or visual_ready_at is not null then 'ready'
          else 'failed'
        end,
        error = case
          when not v_has_active_core and text_ready_at is null and visual_ready_at is null
            then v_failed.error
          else error
        end,
        updated_at = now()
    where id = v_failed.document_file_id;
  end loop;

  return query
  with next_job as (
    select id
    from public.document_jobs
    where queue = p_queue and cancel_requested = false
      and (
        status = 'queued'
        or (status = 'running' and lease_until < now() and attempt_count < 3)
      )
    order by priority desc, created_at asc
    for update skip locked
    limit 1
  )
  update public.document_jobs j
  set status = 'running',
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
revoke all on function public.klui_claim_document_job(text, integer, text) from public, anon, authenticated;
grant execute on function public.klui_claim_document_job(text, integer, text) to service_role;

drop function if exists public.klui_queue_document_page_render(uuid, uuid, integer);
create or replace function public.klui_queue_document_page_render(
  p_user_id uuid,
  p_document_file_id uuid,
  p_page_number integer,
  p_queue text default 'production'
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
  if coalesce(p_queue, '') !~ '^[a-z][a-z0-9_-]{0,31}$' then raise exception 'invalid_document_queue'; end if;
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
      job_type, priority, input, queue
    ) values (
      v_document.user_id, v_document.id, v_document.conversation_id, v_document.message_id,
      'document.render_page', 100,
      jsonb_build_object('page_number', p_page_number, 'attachment_id', v_document.attachment_id), p_queue
    ) returning * into v_job;
  elsif v_job.status in ('failed', 'expired', 'succeeded') then
    update public.document_jobs
    set status = 'queued',
        queue = p_queue,
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
revoke all on function public.klui_queue_document_page_render(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.klui_queue_document_page_render(uuid, uuid, integer, text) to service_role;

notify pgrst, 'reload schema';
