create or replace function public.klui_cleanup_storage_and_cache(
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
  v_search_cache_deleted integer := 0;
  v_model_cache_deleted integer := 0;
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

  with doomed as (
    select query_hash
    from public.search_cache
    where expires_at < now()
    order by expires_at asc
    limit v_limit
  ),
  deleted as (
    delete from public.search_cache sc
    using doomed d
    where sc.query_hash = d.query_hash
    returning sc.query_hash
  )
  select count(*) into v_search_cache_deleted from deleted;

  with doomed as (
    select id
    from public.model_cache
    where fetched_at < now() - v_grace
    order by fetched_at asc
    limit v_limit
  ),
  deleted as (
    delete from public.model_cache mc
    using doomed d
    where mc.id = d.id
    returning mc.id
  )
  select count(*) into v_model_cache_deleted from deleted;

  return jsonb_build_object(
    'document_jobs_deleted', v_jobs_deleted,
    'attachments_deleted', v_attachments_deleted,
    'document_files_deleted', v_document_files_deleted,
    'search_cache_deleted', v_search_cache_deleted,
    'model_cache_deleted', v_model_cache_deleted
  );
end;
$$;

revoke all on function public.klui_cleanup_storage_and_cache(integer, interval) from public, anon, authenticated;
grant execute on function public.klui_cleanup_storage_and_cache(integer, interval) to service_role;

create or replace function public.klui_cleanup_orphan_documents(
  p_limit integer default 500,
  p_grace interval default interval '7 days'
) returns jsonb
language sql
set search_path = public
as $$
  select public.klui_cleanup_storage_and_cache(p_limit, p_grace);
$$;

revoke all on function public.klui_cleanup_orphan_documents(integer, interval) from public, anon, authenticated;
grant execute on function public.klui_cleanup_orphan_documents(integer, interval) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'klui_cleanup_orphan_documents') then
    perform cron.unschedule('klui_cleanup_orphan_documents');
  end if;
  if exists (select 1 from cron.job where jobname = 'klui_cleanup_storage_and_cache') then
    perform cron.unschedule('klui_cleanup_storage_and_cache');
  end if;
end;
$$;

select cron.schedule(
  'klui_cleanup_storage_and_cache',
  '17 3 * * *',
  $$select public.klui_cleanup_storage_and_cache();$$
);
