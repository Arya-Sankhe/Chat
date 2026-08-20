set lock_timeout = '5s';
set statement_timeout = '30s';

insert into public.plans (
  id, name, max_images_per_message, price_label, active, sort_order
)
values
  ('lite', 'Lite', 4, '10 AED / month', true, 10),
  ('pro', 'Pro', 4, '30 AED / month', true, 20),
  ('max', 'Max', 4, '50 AED / month', true, 30)
on conflict (id) do nothing;

update public.subscriptions set plan_id = 'max' where plan_id = 'pro';
update public.payment_requests set plan_id = 'max' where plan_id = 'pro';

update public.subscriptions set plan_id = 'pro' where plan_id = 'essential';
update public.payment_requests set plan_id = 'pro' where plan_id = 'essential';

update public.plans
set name = 'Lite', max_images_per_message = 4,
    price_label = '10 AED / month', active = true, sort_order = 10,
    updated_at = now()
where id = 'lite';

update public.plans
set name = 'Pro', max_images_per_message = 4,
    price_label = '30 AED / month', active = true, sort_order = 20,
    updated_at = now()
where id = 'pro';

update public.plans
set name = 'Max', max_images_per_message = 4,
    price_label = '50 AED / month', active = true, sort_order = 30,
    updated_at = now()
where id = 'max';

delete from public.plans where id not in ('lite', 'pro', 'max');
