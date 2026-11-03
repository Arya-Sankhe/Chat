-- Retain plan IDs and all allowance fields for existing subscriptions and usage.
set lock_timeout = '5s';
set statement_timeout = '30s';

update public.plans
set name = 'Plus', price_label = '15 AED / month', active = true, updated_at = now()
where id = 'lite';

update public.plans
set active = false, updated_at = now()
where id not in ('lite', 'pro');
