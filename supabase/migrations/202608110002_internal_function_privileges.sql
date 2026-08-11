-- Trigger and helper functions run through trusted database-owned code paths.
-- They do not need to be callable directly through the authenticated REST API.
revoke execute on function public.admit_tenant(uuid, uuid, text, text, text, uuid, integer, date, date, numeric, numeric, text, numeric, text) from authenticated;
revoke execute on function public.apply_available_advance() from authenticated;
revoke execute on function public.create_tenant_obligations() from authenticated;
revoke execute on function public.handle_new_auth_user() from authenticated;
revoke execute on function public.humanize_erp_activity() from authenticated;
revoke execute on function public.pg95_cashbook_ensure_category() from authenticated;
revoke execute on function public.pg95_cashbook_link_category_ledger() from authenticated;
revoke execute on function public.pg95_ensure_finance_category(uuid, text, uuid) from authenticated;
revoke execute on function public.route_rent_to_earliest_obligation() from authenticated;
revoke execute on function public.sync_payment_ledgers() from authenticated;
revoke execute on function public.sync_rent_obligation_from_entries(uuid, text, date, uuid) from authenticated;
