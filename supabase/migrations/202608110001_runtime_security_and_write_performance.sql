-- Keep privileged application functions behind authentication. Older migrations
-- left explicit anon grants in place even after revoking the PUBLIC role.
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from public, anon;

-- These token-scoped functions intentionally power the public maintenance QR form.
grant execute on function public.get_branch_from_maintenance_token(text) to anon, authenticated;
grant execute on function public.get_rooms_for_maintenance_token(text) to anon, authenticated;
grant execute on function public.submit_public_maintenance_request(text, uuid, text, text, text) to anon, authenticated;

-- New functions should not become publicly executable by default.
alter default privileges in schema public revoke execute on functions from public;

-- Pin the remaining mutable function search paths.
alter function public.set_updated_at() set search_path = public;
alter function public.delete_branch_cascade(uuid) set search_path = public;
alter function public.delete_branch_cascade(uuid, uuid, text, text, text) set search_path = public;
alter function public.cleanup_old_activity_logs() set search_path = public;
alter function public.pg95_normalize_finance_category(text) set search_path = public;
alter function public.pg95_category_party_type(text) set search_path = public;
alter function public.pg95_default_category_party_name(text) set search_path = public;

-- Identical indexes slow every insert/update without improving query plans.
drop index if exists public.activity_logs_branch_id_created_at_idx;
drop index if exists public.idx_activity_logs_branch_created;
drop index if exists public.cashbook_entries_branch_id_entry_date_idx;
drop index if exists public.idx_tenants_branch_status;
