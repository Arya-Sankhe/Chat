drop function if exists public.klui_complete_document_upload(
  uuid, uuid, integer, text, text, jsonb
);

drop index if exists public.attachments_orphan_cleanup_idx;
create index attachments_orphan_cleanup_idx on public.attachments (created_at)
  where conversation_id is null
    and message_id is null
    and (project_id is null or status = 'pending');
