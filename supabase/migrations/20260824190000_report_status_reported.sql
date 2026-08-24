-- CSAM / NCII reports are not "done". "reported" means the message was
-- removed and the admin filed NCMEC / UAE police.

alter table public.content_reports drop constraint if exists content_reports_status_check;
alter table public.content_reports add constraint content_reports_status_check
  check (status in ('open', 'done', 'reported'));
