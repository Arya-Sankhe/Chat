alter table public.document_files
  drop constraint if exists document_files_kind_check;

alter table public.document_files
  add constraint document_files_kind_check
  check (kind in ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv'));
