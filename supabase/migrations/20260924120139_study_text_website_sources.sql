alter table public.document_files drop constraint if exists document_files_kind_check;
alter table public.document_files add constraint document_files_kind_check
  check (kind in ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv', 'text', 'website'));

-- Publish the source and its searchable chunks together; a partial import is never ready.
create or replace function public.klui_complete_study_source(
  p_user_id uuid, p_attachment_id uuid, p_project_id uuid,
  p_kind text, p_title text, p_content text, p_source_url text,
  p_project_max_bytes bigint
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
    attachment_id, user_id, project_id, kind, source, processing_status, text_ready_at, word_count, metadata
  ) values (
    v_attachment.id, p_user_id, p_project_id, p_kind, 'upload', 'ready', now(),
    cardinality(regexp_split_to_array(trim(p_content), '\s+')),
    jsonb_build_object('title', p_title, 'source_url', p_source_url, 'file_name', v_attachment.file_name)
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
revoke all on function public.klui_complete_study_source(uuid, uuid, uuid, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.klui_complete_study_source(uuid, uuid, uuid, text, text, text, text, bigint) to service_role;
