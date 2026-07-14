-- Indexes for the app's hottest entry and refresh paths.
-- Idempotent; no business data or calculation rules are changed.

create index if not exists idx_payments_repair_lookup
  on public.payments (tenant_id, branch_id, payment_type, payment_date, amount, created_at desc);
create index if not exists idx_payments_branch_month
  on public.payments (branch_id, month, payment_type);
create index if not exists idx_payment_obligations_tenant_period
  on public.payment_obligations (tenant_id, payment_type, period);
create index if not exists idx_payment_obligations_branch_period
  on public.payment_obligations (branch_id, payment_type, period);
create index if not exists idx_tenant_advances_payment
  on public.tenant_advances (payment_id);
create index if not exists idx_tenants_branch_status
  on public.tenants (branch_id, status);
create index if not exists idx_cashbook_branch_date
  on public.cashbook_entries (branch_id, entry_date desc);
create index if not exists idx_activity_logs_branch_created
  on public.activity_logs (branch_id, created_at desc);
