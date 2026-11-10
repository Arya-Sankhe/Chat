-- Lecture metadata and course membership change together; audio/chunk IDs stay stable.
create or replace function public.klui_manage_lecture(
  p_user_id uuid, p_document_id uuid, p_course_id uuid,
  p_title text default null, p_target_course_id uuid default null,
  p_project_max_bytes bigint default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_doc public.document_files;
  v_target uuid := coalesce(p_target_course_id, p_course_id);
  v_bytes bigint;
  v_used bigint;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  -- Use a stable order when two lectures move in opposite directions.
  perform 1 from public.projects where id in (p_course_id, v_target) and user_id = p_user_id and kind = 'course' order by id for update;
  if not exists(select 1 from public.projects where id = p_course_id and user_id = p_user_id and kind = 'course')
    or not exists(select 1 from public.projects where id = v_target and user_id = p_user_id and kind = 'course') then
    raise exception 'course_not_found';
  end if;
  select * into v_doc from public.document_files where id = p_document_id and user_id = p_user_id and project_id = p_course_id and kind = 'audio' for update;
  if not found then raise exception 'lecture_not_found'; end if;
  if coalesce((select meta->'hiddenDocumentIds' from public.projects where id = p_course_id), '[]'::jsonb) ? p_document_id::text then
    raise exception 'lecture_not_found';
  end if;
  if p_title is not null and (length(btrim(p_title)) = 0 or length(p_title) > 120) then raise exception 'invalid_title'; end if;
  if v_target <> p_course_id then
    if v_doc.processing_status <> 'ready' or exists(select 1 from public.transcription_jobs where document_file_id = p_document_id and status in ('queued','running')) then
      raise exception 'lecture_busy';
    end if;
    select size_bytes into v_bytes from public.attachments where id = v_doc.attachment_id and user_id = p_user_id for update;
    select coalesce(sum(size_bytes),0) into v_used from public.attachments where project_id = v_target and user_id = p_user_id and status = 'uploaded';
    if p_project_max_bytes is not null and v_used + coalesce(v_bytes,0) > p_project_max_bytes then raise exception 'project_storage_limit_exceeded'; end if;
    update public.attachments set project_id = v_target where id = v_doc.attachment_id and user_id = p_user_id;
    update public.transcription_jobs set project_id = v_target where document_file_id = p_document_id and user_id = p_user_id;
  end if;
  update public.document_files set project_id = v_target,
    metadata = case when p_title is null then metadata else coalesce(metadata,'{}'::jsonb) || jsonb_build_object('title',btrim(p_title),'lecture_title_override',btrim(p_title)) end,
    updated_at = now() where id = p_document_id;
  update public.study_notes set project_id = v_target, title = coalesce(btrim(p_title),title)
    where document_file_id = p_document_id and user_id = p_user_id and content like '<!--klui:lecture-->%';
end;
$$;
revoke all on function public.klui_manage_lecture(uuid,uuid,uuid,text,uuid,bigint) from public, anon, authenticated;
grant execute on function public.klui_manage_lecture(uuid,uuid,uuid,text,uuid,bigint) to service_role;

-- A note finishing in another tab follows a lecture moved while the model was writing.
create or replace function public.klui_locate_new_lecture_note()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_doc public.document_files;
begin
  if new.document_file_id is not null and new.content like '<!--klui:lecture-->%' then
    select * into v_doc from public.document_files where id = new.document_file_id and user_id = new.user_id and kind = 'audio' for update;
    if found then
      new.project_id := v_doc.project_id;
      new.title := coalesce(v_doc.metadata->>'lecture_title_override',new.title);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.klui_locate_new_lecture_note() from public, anon, authenticated;
drop trigger if exists locate_new_lecture_note on public.study_notes;
create trigger locate_new_lecture_note before insert on public.study_notes for each row execute function public.klui_locate_new_lecture_note();
