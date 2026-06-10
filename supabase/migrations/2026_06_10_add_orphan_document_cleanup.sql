-- Keep document/chat cleanup cheap and predictable:
-- 1. Future chat/message deletes cascade instead of leaving FK-null rows.
-- 2. Historical/abandoned orphan rows are cleaned in small daily batches.

alter table public.attachments
  drop constraint if exists attachments_conversation_id_fkey;
alter table public.attachments
  add constraint attachments_conversation_id_fkey
  foreign key (conversation_id) references public.conversations(id) on delete cascade;

alter table public.attachments
  drop constraint if exists attachments_message_id_fkey;
alter table public.attachments
  add constraint attachments_message_id_fkey
  foreign key (message_id) references public.messages(id) on delete cascade;

alter table public.document_files
  drop constraint if exists document_files_conversation_id_fkey;
alter table public.document_files
  add constraint document_files_conversation_id_fkey
  foreign key (conversation_id) references public.conversations(id) on delete cascade;

alter table public.document_files
  drop constraint if exists document_files_message_id_fkey;
alter table public.document_files
  add constraint document_files_message_id_fkey
  foreign key (message_id) references public.messages(id) on delete cascade;

alter table public.document_jobs
  drop constraint if exists document_jobs_conversation_id_fkey;
alter table public.document_jobs
  add constraint document_jobs_conversation_id_fkey
  foreign key (conversation_id) references public.conversations(id) on delete cascade;

alter table public.document_jobs
  drop constraint if exists document_jobs_message_id_fkey;
alter table public.document_jobs
  add constraint document_jobs_message_id_fkey
  foreign key (message_id) references public.messages(id) on delete cascade;

create index if not exists attachments_conversation_idx
  on public.attachments (conversation_id)
  where conversation_id is not null;

create index if not exists attachments_message_idx
  on public.attachments (message_id)
  where message_id is not null;

create index if not exists attachments_orphan_cleanup_idx
  on public.attachments (created_at)
  where conversation_id is null and message_id is null;

create index if not exists document_files_orphan_cleanup_idx
  on public.document_files (created_at)
  where conversation_id is null and message_id is null;

create index if not exists document_jobs_conversation_idx
  on public.document_jobs (conversation_id)
  where conversation_id is not null;

create index if not exists document_jobs_message_idx
  on public.document_jobs (message_id)
  where message_id is not null;

create index if not exists document_jobs_orphan_cleanup_idx
  on public.document_jobs (created_at)
  where conversation_id is null
    and message_id is null
    and document_file_id is null
    and status in ('succeeded', 'failed', 'expired');

create or replace function public.klui_cleanup_orphan_documents(
  p_limit integer default 500,
  p_grace interval default interval '7 days'
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_grace interval := coalesce(p_grace, interval '7 days');
  v_jobs_deleted integer := 0;
  v_attachments_deleted integer := 0;
  v_document_files_deleted integer := 0;
begin
  if v_grace < interval '1 day' then
    v_grace := interval '1 day';
  end if;

  with doomed as (
    select id
    from public.document_jobs
    where conversation_id is null
      and message_id is null
      and document_file_id is null
      and status in ('succeeded', 'failed', 'expired')
      and created_at < now() - v_grace
    order by created_at asc
    limit v_limit
  ),
  deleted as (
    delete from public.document_jobs j
    using doomed d
    where j.id = d.id
    returning j.id
  )
  select count(*) into v_jobs_deleted from deleted;

  with doomed as (
    select id
    from public.attachments
    where conversation_id is null
      and message_id is null
      and created_at < now() - v_grace
    order by created_at asc
    limit v_limit
  ),
  deleted as (
    delete from public.attachments a
    using doomed d
    where a.id = d.id
    returning a.id
  )
  select count(*) into v_attachments_deleted from deleted;

  with doomed as (
    select df.id
    from public.document_files df
    where df.conversation_id is null
      and df.message_id is null
      and df.created_at < now() - v_grace
      and not exists (
        select 1
        from public.attachments a
        where a.id = df.attachment_id
      )
    order by df.created_at asc
    limit v_limit
  ),
  deleted as (
    delete from public.document_files df
    using doomed d
    where df.id = d.id
    returning df.id
  )
  select count(*) into v_document_files_deleted from deleted;

  return jsonb_build_object(
    'document_jobs_deleted', v_jobs_deleted,
    'attachments_deleted', v_attachments_deleted,
    'document_files_deleted', v_document_files_deleted
  );
end;
$$;

revoke all on function public.klui_cleanup_orphan_documents(integer, interval) from public, anon, authenticated;
grant execute on function public.klui_cleanup_orphan_documents(integer, interval) to service_role;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'klui_cleanup_orphan_documents') then
    perform cron.unschedule('klui_cleanup_orphan_documents');
  end if;
end;
$$;

select cron.schedule(
  'klui_cleanup_orphan_documents',
  '17 3 * * *',
  $$select public.klui_cleanup_orphan_documents();$$
);
