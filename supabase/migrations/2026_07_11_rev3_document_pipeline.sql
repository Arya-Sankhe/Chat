alter table public.document_files
  add column if not exists text_ready_at timestamptz,
  add column if not exists visual_ready_at timestamptz,
  add column if not exists enriched_at timestamptz,
  add column if not exists stage_errors jsonb not null default '{}'::jsonb;

update public.document_files d
set text_ready_at = coalesce(d.text_ready_at, d.updated_at)
where d.processing_status = 'ready'
  and (
    d.kind <> 'pdf'
    or exists (
      select 1
      from public.document_chunks c
      where c.document_file_id = d.id
        and length(trim(c.text)) > 0
    )
  );

update public.document_files d
set visual_ready_at = coalesce(d.visual_ready_at, d.updated_at)
where d.processing_status = 'ready'
  and d.kind = 'pdf'
  and exists (
    select 1
    from public.document_pages p
    where p.document_file_id = d.id
      and p.image_key <> ''
  );

update public.document_files d
set enriched_at = coalesce(d.enriched_at, d.updated_at)
where d.processing_status = 'ready'
  and d.kind = 'pdf'
  and exists (
    select 1
    from public.document_pages p
    where p.document_file_id = d.id
  )
  and not exists (
    select 1
    from public.document_pages p
    where p.document_file_id = d.id
      and p.embedding is null
  );

create table if not exists public.pending_document_turns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  client_turn_key uuid not null,
  user_message_id uuid references public.messages(id) on delete set null,
  mode text not null check (mode in ('single', 'compare', 'council')),
  request_payload jsonb not null default '{}'::jsonb,
  status text not null default 'waiting_documents'
    check (status in ('waiting_documents', 'running', 'done', 'failed', 'cancelled')),
  claim_token uuid,
  claimed_by text,
  lease_until timestamptz,
  provider_started_at timestamptz,
  cancel_requested boolean not null default false,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, client_turn_key)
);

alter table public.messages
  add column if not exists turn_run_id uuid references public.pending_document_turns(id) on delete set null,
  add column if not exists output_slot text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_turn_output_unique'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_turn_output_unique unique (turn_run_id, output_slot);
  end if;
end;
$$;

create index if not exists document_files_text_ready_idx
  on public.document_files (user_id, conversation_id, text_ready_at)
  where text_ready_at is not null;
create index if not exists document_files_visual_ready_idx
  on public.document_files (user_id, conversation_id, visual_ready_at)
  where visual_ready_at is not null;
create index if not exists pending_document_turns_conversation_active_idx
  on public.pending_document_turns (user_id, conversation_id, created_at)
  where status in ('waiting_documents', 'running');
create index if not exists pending_document_turns_lease_idx
  on public.pending_document_turns (lease_until)
  where status = 'running';
create index if not exists pending_document_turns_terminal_cleanup_idx
  on public.pending_document_turns (finished_at)
  where status in ('done', 'failed', 'cancelled');
drop index if exists public.document_jobs_extract_once_idx;
create unique index if not exists document_jobs_core_once_idx
  on public.document_jobs (document_file_id, job_type)
  where document_file_id is not null
    and (job_type like 'document.extract.%' or job_type = 'document.enrich.pdf');
create unique index if not exists document_jobs_render_page_once_idx
  on public.document_jobs (document_file_id, ((input ->> 'page_number')::integer))
  where document_file_id is not null
    and job_type = 'document.render_page';

grant select on public.pending_document_turns to authenticated;
grant all on public.pending_document_turns to service_role;
alter table public.pending_document_turns enable row level security;
drop policy if exists "pending document turns read own" on public.pending_document_turns;
create policy "pending document turns read own"
  on public.pending_document_turns
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

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
    where p_kind = 'pdf'
  ) queued
  on conflict do nothing;

  select coalesce(jsonb_agg(to_jsonb(j) order by j.priority desc, j.created_at asc), '[]'::jsonb)
  into v_jobs
  from public.document_jobs j
  where j.document_file_id = v_document.id
    and (j.job_type = 'document.extract.' || p_kind
      or (p_kind = 'pdf' and j.job_type = 'document.enrich.pdf'));

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

create or replace function public.klui_complete_document_job(
  p_job_id uuid,
  p_worker_id text,
  p_output jsonb default '{}'::jsonb,
  p_document_patch jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_jobs;
  v_document public.document_files;
  v_has_active_core boolean;
begin
  update public.document_jobs
  set status = 'succeeded',
      output = coalesce(p_output, '{}'::jsonb),
      error = null,
      finished_at = now(),
      lease_until = null,
      updated_at = now()
  where id = p_job_id
    and status = 'running'
    and worker_id = p_worker_id
    and lease_until >= now()
  returning * into v_job;

  if v_job.id is null then return null; end if;
  if v_job.document_file_id is null then return to_jsonb(v_job); end if;

  update public.document_files
  set text_ready_at = case
        when p_document_patch ? 'text_ready_at'
          then coalesce(text_ready_at, (p_document_patch ->> 'text_ready_at')::timestamptz)
        else text_ready_at
      end,
      visual_ready_at = case
        when p_document_patch ? 'visual_ready_at'
          then coalesce(visual_ready_at, (p_document_patch ->> 'visual_ready_at')::timestamptz)
        else visual_ready_at
      end,
      enriched_at = case
        when p_document_patch ? 'enriched_at'
          then coalesce(enriched_at, (p_document_patch ->> 'enriched_at')::timestamptz)
        else enriched_at
      end,
      page_count = case when p_document_patch ? 'page_count'
        then (p_document_patch ->> 'page_count')::integer else page_count end,
      word_count = case when p_document_patch ? 'word_count'
        then (p_document_patch ->> 'word_count')::integer else word_count end,
      extraction_key = case when p_document_patch ? 'extraction_key'
        then p_document_patch ->> 'extraction_key' else extraction_key end,
      metadata = case when jsonb_typeof(p_document_patch -> 'metadata') = 'object'
        then metadata || (p_document_patch -> 'metadata') else metadata end,
      stage_errors = case when jsonb_typeof(p_document_patch -> 'stage_errors') = 'object'
        then stage_errors || (p_document_patch -> 'stage_errors') else stage_errors end,
      error = case when p_document_patch ? 'error'
        then nullif(p_document_patch -> 'error', 'null'::jsonb) else error end,
      updated_at = now()
  where id = v_job.document_file_id
  returning * into v_document;

  select exists (
    select 1
    from public.document_jobs j
    where j.document_file_id = v_job.document_file_id
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
          then coalesce(error, jsonb_build_object('code', 'document_unusable', 'message', 'No usable document content could be prepared.'))
        else error
      end,
      updated_at = now()
  where id = v_job.document_file_id
  returning * into v_document;

  return jsonb_build_object('job', to_jsonb(v_job), 'document_file', to_jsonb(v_document));
end;
$$;

revoke all on function public.klui_complete_document_job(uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_complete_document_job(uuid, text, jsonb, jsonb)
  to service_role;

create or replace function public.klui_publish_document_visual_ready(
  p_job_id uuid,
  p_worker_id text,
  p_document_file_id uuid,
  p_page_count integer,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_jobs;
  v_document public.document_files;
  v_published integer;
begin
  select * into v_job
  from public.document_jobs
  where id = p_job_id
    and document_file_id = p_document_file_id
    and job_type = 'document.enrich.pdf'
    and status = 'running'
    and worker_id = p_worker_id
    and lease_until >= now()
  for update;
  if not found then return null; end if;

  select count(*) into v_published
  from public.document_pages
  where document_file_id = p_document_file_id
    and image_key is not null
    and image_key <> '';

  if p_page_count is null or p_page_count < 1 or v_published <> p_page_count then
    raise exception 'visual_manifest_incomplete';
  end if;

  update public.document_files
  set visual_ready_at = coalesce(visual_ready_at, now()),
      page_count = p_page_count,
      metadata = case when jsonb_typeof(p_metadata) = 'object'
        then metadata || p_metadata else metadata end,
      updated_at = now()
  where id = p_document_file_id
  returning * into v_document;

  return to_jsonb(v_document);
end;
$$;

revoke all on function public.klui_publish_document_visual_ready(uuid, text, uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_publish_document_visual_ready(uuid, text, uuid, integer, jsonb)
  to service_role;

create or replace function public.klui_fail_document_job(
  p_job_id uuid,
  p_worker_id text,
  p_error jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_jobs;
  v_document public.document_files;
  v_stage_key text;
  v_has_active_core boolean;
begin
  update public.document_jobs
  set status = 'failed',
      error = coalesce(p_error, jsonb_build_object('code', 'worker_error', 'message', 'Document processing failed.')),
      finished_at = now(),
      lease_until = null,
      updated_at = now()
  where id = p_job_id
    and status = 'running'
    and worker_id = p_worker_id
    and lease_until >= now()
  returning * into v_job;

  if v_job.id is null then return null; end if;
  if v_job.document_file_id is null or v_job.job_type = 'document.render_page' then
    return jsonb_build_object('job', to_jsonb(v_job));
  end if;

  v_stage_key := case
    when v_job.job_type = 'document.enrich.pdf' then 'visual'
    when v_job.job_type like 'document.extract.%' then 'text'
    else 'processing'
  end;

  update public.document_files
  set stage_errors = stage_errors || jsonb_build_object(v_stage_key, v_job.error),
      updated_at = now()
  where id = v_job.document_file_id;

  select exists (
    select 1
    from public.document_jobs j
    where j.document_file_id = v_job.document_file_id
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
          then v_job.error
        else error
      end,
      updated_at = now()
  where id = v_job.document_file_id
  returning * into v_document;

  return jsonb_build_object('job', to_jsonb(v_job), 'document_file', to_jsonb(v_document));
end;
$$;

revoke all on function public.klui_fail_document_job(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_fail_document_job(uuid, text, jsonb)
  to service_role;

create or replace function public.klui_claim_document_job(
  p_worker_id text,
  p_lease_seconds integer default 120
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
    where status = 'running'
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
    where cancel_requested = false
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

revoke all on function public.klui_claim_document_job(text, integer)
  from public, anon, authenticated;
grant execute on function public.klui_claim_document_job(text, integer) to service_role;

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
  where id = p_document_file_id and user_id = p_user_id and kind = 'pdf'
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

create or replace function public.klui_submit_document_turn(
  p_user_id uuid,
  p_conversation_id uuid,
  p_client_turn_key uuid,
  p_mode text,
  p_user_content jsonb,
  p_message_metadata jsonb,
  p_request_payload jsonb,
  p_attachment_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment_ids uuid[];
  v_attachment_count integer;
  v_message public.messages;
  v_run public.pending_document_turns;
begin
  if p_mode not in ('single', 'compare', 'council') then raise exception 'invalid_turn_mode'; end if;
  if p_client_turn_key is null then raise exception 'client_turn_key_required'; end if;

  select * into v_run
  from public.pending_document_turns
  where user_id = p_user_id and client_turn_key = p_client_turn_key;
  if v_run.id is not null then
    if v_run.conversation_id <> p_conversation_id then
      raise exception 'client_turn_key_conflict';
    end if;
    select * into v_message from public.messages where id = v_run.user_message_id;
    return jsonb_build_object('run', to_jsonb(v_run), 'user_message', to_jsonb(v_message), 'created', false);
  end if;

  perform 1
  from public.conversations
  where id = p_conversation_id and user_id = p_user_id and deleted_at is null
  for update;
  if not found then raise exception 'conversation_not_found'; end if;

  select coalesce(array_agg(distinct attachment_id), '{}'::uuid[])
  into v_attachment_ids
  from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as input_ids(attachment_id);

  select count(*) into v_attachment_count
  from public.attachments a
  where a.id = any(v_attachment_ids)
    and a.user_id = p_user_id
    and a.status = 'uploaded'
    and a.message_id is null;
  if v_attachment_count <> cardinality(v_attachment_ids) then
    raise exception 'attachment_not_available';
  end if;

  insert into public.messages (
    user_id, conversation_id, role, content, metadata
  ) values (
    p_user_id, p_conversation_id, 'user', p_user_content,
    coalesce(p_message_metadata, '{}'::jsonb)
  ) returning * into v_message;

  insert into public.pending_document_turns (
    user_id, conversation_id, client_turn_key, user_message_id,
    mode, request_payload, status
  ) values (
    p_user_id, p_conversation_id, p_client_turn_key, v_message.id,
    p_mode,
    coalesce(p_request_payload, '{}'::jsonb) || jsonb_build_object('attachments', to_jsonb(v_attachment_ids)),
    'waiting_documents'
  )
  on conflict (user_id, client_turn_key) do nothing
  returning * into v_run;

  if v_run.id is null then
    delete from public.messages where id = v_message.id;
    select * into v_run
    from public.pending_document_turns
    where user_id = p_user_id and client_turn_key = p_client_turn_key;
    select * into v_message from public.messages where id = v_run.user_message_id;
    return jsonb_build_object('run', to_jsonb(v_run), 'user_message', to_jsonb(v_message), 'created', false);
  end if;

  update public.attachments
  set conversation_id = p_conversation_id,
      message_id = v_message.id
  where id = any(v_attachment_ids) and user_id = p_user_id;

  update public.document_files
  set conversation_id = p_conversation_id,
      message_id = v_message.id,
      updated_at = now()
  where attachment_id = any(v_attachment_ids) and user_id = p_user_id;

  return jsonb_build_object('run', to_jsonb(v_run), 'user_message', to_jsonb(v_message), 'created', true);
end;
$$;

revoke all on function public.klui_submit_document_turn(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.klui_submit_document_turn(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, uuid[])
  to service_role;

create or replace function public.klui_claim_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid,
  p_claimed_by text,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.pending_document_turns;
begin
  select * into v_run
  from public.pending_document_turns
  where id = p_turn_id and user_id = p_user_id
  for update;
  if not found then return null; end if;

  if v_run.cancel_requested and v_run.provider_started_at is null then
    update public.pending_document_turns
    set status = 'cancelled', lease_until = null, finished_at = now(), updated_at = now()
    where id = v_run.id
    returning * into v_run;
    return to_jsonb(v_run);
  end if;

  if v_run.status = 'running' and v_run.lease_until >= now() then
    return to_jsonb(v_run);
  end if;

  if v_run.status = 'running' and v_run.provider_started_at is not null then
    update public.pending_document_turns
    set status = 'failed',
        error = jsonb_build_object(
          'code', 'turn_interrupted',
          'message', 'Generation was interrupted after the model request started. Retry explicitly to avoid duplicate usage.'
        ),
        lease_until = null,
        finished_at = now(),
        updated_at = now()
    where id = v_run.id
    returning * into v_run;
    return to_jsonb(v_run);
  end if;

  if v_run.status = 'waiting_documents'
     or (v_run.status = 'running' and v_run.provider_started_at is null and v_run.lease_until < now()) then
    update public.pending_document_turns
    set status = 'running',
        claim_token = gen_random_uuid(),
        claimed_by = p_claimed_by,
        lease_until = now() + (greatest(coalesce(p_lease_seconds, 120), 30) || ' seconds')::interval,
        updated_at = now()
    where id = v_run.id
    returning * into v_run;
  end if;

  return to_jsonb(v_run);
end;
$$;

revoke all on function public.klui_claim_pending_document_turn(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.klui_claim_pending_document_turn(uuid, uuid, text, integer)
  to service_role;

create or replace function public.klui_heartbeat_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.pending_document_turns;
begin
  update public.pending_document_turns
  set lease_until = now() + (greatest(coalesce(p_lease_seconds, 120), 30) || ' seconds')::interval,
      updated_at = now()
  where id = p_turn_id
    and user_id = p_user_id
    and status = 'running'
    and claim_token = p_claim_token
    and lease_until >= now()
    and cancel_requested = false
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.klui_heartbeat_pending_document_turn(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.klui_heartbeat_pending_document_turn(uuid, uuid, uuid, integer)
  to service_role;

create or replace function public.klui_release_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.pending_document_turns;
begin
  update public.pending_document_turns
  set status = 'waiting_documents',
      claim_token = null,
      claimed_by = null,
      lease_until = null,
      updated_at = now()
  where id = p_turn_id
    and user_id = p_user_id
    and status = 'running'
    and claim_token = p_claim_token
    and provider_started_at is null
    and cancel_requested = false
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.klui_release_pending_document_turn(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.klui_release_pending_document_turn(uuid, uuid, uuid)
  to service_role;

create or replace function public.klui_mark_pending_turn_provider_started(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.pending_document_turns;
begin
  update public.pending_document_turns
  set provider_started_at = coalesce(provider_started_at, now()),
      updated_at = now()
  where id = p_turn_id
    and user_id = p_user_id
    and status = 'running'
    and claim_token = p_claim_token
    and lease_until >= now()
    and cancel_requested = false
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.klui_mark_pending_turn_provider_started(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.klui_mark_pending_turn_provider_started(uuid, uuid, uuid)
  to service_role;

create or replace function public.klui_finish_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.pending_document_turns;
begin
  if p_status not in ('done', 'failed', 'cancelled') then raise exception 'invalid_terminal_status'; end if;
  update public.pending_document_turns
  set status = p_status,
      error = p_error,
      lease_until = null,
      finished_at = now(),
      updated_at = now()
  where id = p_turn_id
    and user_id = p_user_id
    and status = 'running'
    and claim_token = p_claim_token
    and lease_until >= now()
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.klui_finish_pending_document_turn(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_finish_pending_document_turn(uuid, uuid, uuid, text, jsonb)
  to service_role;

create or replace function public.klui_cancel_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.pending_document_turns;
  v_message public.messages;
  v_attachments jsonb;
begin
  select * into v_run
  from public.pending_document_turns
  where id = p_turn_id and user_id = p_user_id
  for update;
  if not found then return null; end if;

  select * into v_message from public.messages where id = v_run.user_message_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb)
  into v_attachments
  from public.attachments a
  where a.user_id = p_user_id and a.message_id = v_run.user_message_id;

  if v_run.status = 'waiting_documents'
     or (v_run.status = 'running' and v_run.provider_started_at is null) then
    delete from public.messages where turn_run_id = v_run.id;

    update public.attachments
    set conversation_id = null, message_id = null
    where user_id = p_user_id and message_id = v_run.user_message_id;

    update public.document_files
    set conversation_id = null, message_id = null, updated_at = now()
    where user_id = p_user_id and message_id = v_run.user_message_id;

    update public.pending_document_turns
    set status = 'cancelled',
        cancel_requested = true,
        lease_until = null,
        finished_at = now(),
        updated_at = now()
    where id = v_run.id
    returning * into v_run;

    delete from public.messages where id = v_message.id;
  elsif v_run.status = 'running' then
    update public.pending_document_turns
    set cancel_requested = true, updated_at = now()
    where id = v_run.id
    returning * into v_run;
  end if;

  return jsonb_build_object(
    'run', to_jsonb(v_run),
    'user_message', to_jsonb(v_message),
    'attachments', v_attachments
  );
end;
$$;

revoke all on function public.klui_cancel_pending_document_turn(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.klui_cancel_pending_document_turn(uuid, uuid)
  to service_role;

create or replace function public.klui_cleanup_pending_document_turns(
  p_limit integer default 500,
  p_grace interval default interval '7 days'
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  with doomed as (
    select id
    from public.pending_document_turns
    where status in ('done', 'failed', 'cancelled')
      and finished_at < now() - p_grace
    order by finished_at asc
    limit greatest(coalesce(p_limit, 500), 1)
    for update skip locked
  ), deleted as (
    delete from public.pending_document_turns t
    using doomed
    where t.id = doomed.id
    returning t.id
  )
  select count(*) into v_deleted from deleted;
  return v_deleted;
end;
$$;

revoke all on function public.klui_cleanup_pending_document_turns(integer, interval)
  from public, anon, authenticated;
grant execute on function public.klui_cleanup_pending_document_turns(integer, interval)
  to service_role;
