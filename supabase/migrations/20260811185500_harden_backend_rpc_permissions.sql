-- Backend RPCs accept an explicit account id and therefore must never be
-- callable through PostgREST by anon/authenticated users. The API and workers
-- use the service role for every call to these functions.

revoke execute on function public.klui_search_document_chunks(uuid, uuid[], text, integer) from public, anon, authenticated;
revoke execute on function public.klui_search_document_pages(uuid, uuid[], text, integer) from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.smartyfy_claim_document_job(text, integer) from public, anon, authenticated;
revoke execute on function public.smartyfy_consume_documents(uuid, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.smartyfy_consume_search(uuid, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.smartyfy_consume_usage(uuid, text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.smartyfy_search_document_chunks(uuid, uuid[], text, integer) from public, anon, authenticated;
revoke execute on function public.smartyfy_search_document_pages(uuid, uuid[], text, integer) from public, anon, authenticated;

grant execute on function public.klui_search_document_chunks(uuid, uuid[], text, integer) to service_role;
grant execute on function public.klui_search_document_pages(uuid, uuid[], text, integer) to service_role;
grant execute on function public.rls_auto_enable() to service_role;
grant execute on function public.smartyfy_claim_document_job(text, integer) to service_role;
grant execute on function public.smartyfy_consume_documents(uuid, text, integer, integer, integer, integer) to service_role;
grant execute on function public.smartyfy_consume_search(uuid, text, integer, integer) to service_role;
grant execute on function public.smartyfy_consume_usage(uuid, text, integer, integer, integer) to service_role;
grant execute on function public.smartyfy_search_document_chunks(uuid, uuid[], text, integer) to service_role;
grant execute on function public.smartyfy_search_document_pages(uuid, uuid[], text, integer) to service_role;
