-- Run against the local seeded Dojo database; every change is rolled back.
begin;
do $$
declare
  d public.document_files;
  target uuid;
  n uuid;
  attachment_key text;
  count_before integer;
begin
  select * into strict d from public.document_files where kind='audio' and processing_status='ready' limit 1;
  insert into public.projects(user_id,name,kind) values(d.user_id,'Lecture move test','course') returning id into target;
  select object_key into attachment_key from public.attachments where id=d.attachment_id;
  select count(*) into count_before from public.document_chunks where document_file_id=d.id;
  perform public.klui_manage_lecture(d.user_id,d.id,d.project_id,'Renamed lecture',null,1000000000);
  assert (select metadata->>'title' from public.document_files where id=d.id) = 'Renamed lecture';
  assert not exists(select 1 from public.study_notes where document_file_id=d.id and content like '<!--klui:lecture-->%' and title <> 'Renamed lecture');
  begin
    perform public.klui_manage_lecture(d.user_id,d.id,d.project_id,null,target,-1);
    raise exception 'quota was bypassed';
  exception when others then
    if sqlerrm <> 'project_storage_limit_exceeded' then raise; end if;
  end;
  assert (select project_id from public.document_files where id=d.id)=d.project_id;
  begin
    perform public.klui_manage_lecture(gen_random_uuid(),d.id,d.project_id,null,target,1000000000);
    raise exception 'ownership was bypassed';
  exception when others then
    if sqlerrm <> 'course_not_found' then raise; end if;
  end;
  update public.document_files set processing_status='processing' where id=d.id;
  begin
    perform public.klui_manage_lecture(d.user_id,d.id,d.project_id,null,target,1000000000);
    raise exception 'busy lecture was moved';
  exception when others then
    if sqlerrm <> 'lecture_busy' then raise; end if;
  end;
  update public.document_files set processing_status='ready' where id=d.id;
  perform public.klui_manage_lecture(d.user_id,d.id,d.project_id,null,target,1000000000);
  assert (select project_id from public.document_files where id=d.id)=target;
  assert (select project_id from public.attachments where id=d.attachment_id)=target;
  assert not exists(select 1 from public.study_notes where document_file_id=d.id and content like '<!--klui:lecture-->%' and project_id<>target);
  assert not exists(select 1 from public.transcription_jobs where document_file_id=d.id and project_id<>target);
  assert (select object_key from public.attachments where id=d.attachment_id)=attachment_key;
  assert (select count(*) from public.document_chunks where document_file_id=d.id)=count_before;
  insert into public.study_notes(user_id,project_id,document_file_id,title,content,kind)
    values(d.user_id,d.project_id,d.id,'Stale generated title','<!--klui:lecture-->' || chr(10) || 'Late note','summary') returning id into n;
  assert (select project_id from public.study_notes where id=n)=target;
  assert (select title from public.study_notes where id=n)='Renamed lecture';
  assert not has_function_privilege('anon','public.klui_manage_lecture(uuid,uuid,uuid,text,uuid,bigint)','EXECUTE');
  assert not has_function_privilege('authenticated','public.klui_manage_lecture(uuid,uuid,uuid,text,uuid,bigint)','EXECUTE');
  raise notice 'PASS: rename, atomic move, quota, ownership, audio/chunk preservation, late note and RPC permissions';
end $$;
rollback;
