create or replace function public.klui_update_pending_turn_output(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_token uuid,
  p_message_id uuid,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_message public.messages;
begin
  update public.messages m
  set content = case when p_patch ? 'content' then p_patch->'content' else m.content end,
      reasoning = case when p_patch ? 'reasoning' then coalesce(p_patch->>'reasoning', '') else m.reasoning end,
      tool_calls = case when p_patch ? 'tool_calls' then coalesce(p_patch->'tool_calls', '[]'::jsonb) else m.tool_calls end,
      finish_reason = case when p_patch ? 'finish_reason' then p_patch->>'finish_reason' else m.finish_reason end,
      error = case when p_patch ? 'error' then p_patch->>'error' else m.error end,
      metadata = case when p_patch ? 'metadata' then coalesce(p_patch->'metadata', '{}'::jsonb) else m.metadata end
  where m.id = p_message_id
    and m.user_id = p_user_id
    and m.turn_run_id = p_turn_id
    and exists (
      select 1
      from public.pending_document_turns t
      where t.id = p_turn_id
        and t.user_id = p_user_id
        and t.status = 'running'
        and t.claim_token = p_claim_token
        and t.lease_until >= now()
    )
  returning m.* into v_message;

  return to_jsonb(v_message);
end;
$$;

revoke all on function public.klui_update_pending_turn_output(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.klui_update_pending_turn_output(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
