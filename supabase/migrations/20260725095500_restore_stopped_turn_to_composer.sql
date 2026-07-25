create or replace function public.klui_cancel_pending_document_turn(
  p_user_id uuid,
  p_turn_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.pending_document_turns;
  v_message public.messages;
  v_attachments jsonb;
begin
  select * into v_run
  from public.pending_document_turns
  where id = p_turn_id and user_id = p_user_id
  for update;
  if not found then return null; end if;

  select * into v_message from public.messages where id = v_run.user_message_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb)
  into v_attachments
  from public.attachments a
  where a.user_id = p_user_id and a.message_id = v_run.user_message_id;

  if v_run.status in ('waiting_documents', 'running') then
    update public.pending_document_turns
    set status = 'cancelled',
        cancel_requested = true,
        lease_until = null,
        finished_at = now(),
        updated_at = now()
    where id = v_run.id
    returning * into v_run;

    delete from public.messages where turn_run_id = v_run.id;

    update public.attachments
    set conversation_id = null, message_id = null
    where user_id = p_user_id and message_id = v_run.user_message_id;

    update public.document_files
    set conversation_id = null, message_id = null, updated_at = now()
    where user_id = p_user_id and message_id = v_run.user_message_id;

    delete from public.messages where id = v_message.id;
  end if;

  return jsonb_build_object(
    'run', to_jsonb(v_run),
    'user_message', to_jsonb(v_message),
    'attachments', v_attachments
  );
end;
$$;

revoke all on function public.klui_cancel_pending_document_turn(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.klui_cancel_pending_document_turn(uuid, uuid)
  to service_role;
