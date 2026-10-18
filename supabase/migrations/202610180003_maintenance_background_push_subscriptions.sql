-- Additive background push subscriptions. No existing PG data is modified.
create table if not exists public.maintenance_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint push_endpoint_https check (endpoint ~ '^https://'),
  constraint push_endpoint_length check (length(endpoint) <= 2048),
  constraint push_key_lengths check (length(p256dh) between 60 and 120 and length(auth_secret) between 12 and 80)
);
create index if not exists maintenance_push_subscriptions_branch_idx on public.maintenance_push_subscriptions(branch_id);
create index if not exists maintenance_push_subscriptions_user_idx on public.maintenance_push_subscriptions(user_id);
alter table public.maintenance_push_subscriptions enable row level security;
create policy maintenance_push_select_own on public.maintenance_push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy maintenance_push_insert_own on public.maintenance_push_subscriptions
  for insert to authenticated with check (user_id = auth.uid() and public.has_branch_access(branch_id));
create policy maintenance_push_update_own on public.maintenance_push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.has_branch_access(branch_id));
create policy maintenance_push_delete_own on public.maintenance_push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
revoke all on public.maintenance_push_subscriptions from anon;
grant select,insert,update,delete on public.maintenance_push_subscriptions to authenticated;
-- Trigger is configured separately with a private Vault secret after edge deployment.
