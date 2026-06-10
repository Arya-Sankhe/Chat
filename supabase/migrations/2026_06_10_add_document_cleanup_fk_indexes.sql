create index if not exists document_files_message_idx
  on public.document_files (message_id)
  where message_id is not null;

create index if not exists document_files_parent_document_idx
  on public.document_files (parent_document_id)
  where parent_document_id is not null;

create index if not exists document_jobs_document_file_idx
  on public.document_jobs (document_file_id)
  where document_file_id is not null;
