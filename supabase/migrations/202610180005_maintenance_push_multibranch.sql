-- A single push endpoint can subscribe to all branches its user is allowed to access.
alter table public.maintenance_push_subscriptions
  drop constraint if exists maintenance_push_subscriptions_endpoint_key;
create unique index if not exists maintenance_push_subscriptions_endpoint_branch_unique
  on public.maintenance_push_subscriptions(endpoint,branch_id);
