-- Enforce this at the ledger boundary, including older application versions.
-- NOT VALID preserves historical audit rows while checking every new write.
alter table public.usage_api_events
  add constraint usage_api_events_no_unsupported_charge check (
    cost_source not in ('reserved', 'reservation_ceiling', 'missing_usage',
      'settlement_failure', 'submission_state_failure', 'openrouter_provider_failure')
    or cost_credits = 0
  ) not valid;
