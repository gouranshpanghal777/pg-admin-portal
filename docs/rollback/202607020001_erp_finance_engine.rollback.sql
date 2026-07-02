-- Manual rollback for 202607020001_erp_finance_engine.sql.
-- Run only after switching application code back to tag pre-erp-payment-ledger-20260703.
begin;
drop trigger if exists humanize_erp_activity on public.activity_logs;
drop function if exists public.humanize_erp_activity();
drop function if exists public.vacate_tenant_erp(uuid,date,text,numeric,numeric,numeric,numeric);
drop trigger if exists apply_available_advance on public.payment_obligations;
drop function if exists public.apply_available_advance();
drop trigger if exists create_tenant_obligations on public.tenants;
drop function if exists public.create_tenant_obligations();
drop trigger if exists sync_payment_ledgers on public.payments;
drop function if exists public.sync_payment_ledgers();
drop table if exists public.tenant_advances;
drop table if exists public.security_ledger;
drop table if exists public.payment_obligations;
alter table public.cashbook_entries drop column if exists remarks;
alter table public.cashbook_entries drop column if exists reference;
alter table public.cashbook_entries drop column if exists payment_mode;
alter table public.cashbook_entries drop column if exists category;
commit;

-- The migration also improves existing delete/link functions. Those functions may
-- remain in place safely because their signatures are backward compatible.
