-- One ingest job per upload.
--
-- The worker now stores a document completely in one `document.extract.<kind>` job: every
-- page's text (document_chunks, one row per page or slide, or per block of spreadsheet rows)
-- and every page's image (document_pages). It sets text_ready_at and visual_ready_at together
-- only when everything is stored, so there is no separate visual-enrichment job any more.
--
-- Deploy order: the new worker finishes any `document.enrich.pdf` / `document.render_page`
-- job it finds without doing anything, so this migration can be applied before or after the
-- worker and app deploy. Nothing here touches existing rows.

drop function if exists public.klui_complete_document_upload(uuid, uuid, integer, text, text, jsonb, uuid, bigint, bigint, text);
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

  -- The single ingest job: text and page images, stored together.
  insert into public.document_jobs (
    user_id, document_file_id, conversation_id, message_id, job_type, priority, input, queue
  ) values (
    v_attachment.user_id,
    v_document.id,
    v_attachment.conversation_id,
    v_attachment.message_id,
    'document.extract.' || p_kind,
    10,
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
  )
  on conflict do nothing;

  select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at asc), '[]'::jsonb)
  into v_jobs
  from public.document_jobs j
  where j.document_file_id = v_document.id
    and j.job_type = 'document.extract.' || p_kind;

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

notify pgrst, 'reload schema';
