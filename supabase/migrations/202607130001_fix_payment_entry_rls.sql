-- Fix payment entry RLS for staff users.
--
-- ERROR 1 root cause: repairFutureRoutedRentPayment() on the client does
-- supabase.from('payment_obligations').upsert() / payments.update() /
-- tenant_advances.delete() AFTER the RPC succeeds.  These go through RLS
-- as the authenticated user.  Staff (non-admin) users hit [42501] because
-- the only write policies require is_admin().
--
-- Fix: add scoped write policies for users who have branch access AND the
-- add_payment permission.  This preserves branch isolation and the existing
-- admin-wide policy.

-- 1. payment_obligations – allow staff INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS payment_obligations_staff_write ON public.payment_obligations;
CREATE POLICY payment_obligations_staff_write ON public.payment_obligations
  FOR ALL
  USING  (public.has_branch_access(branch_id) AND public.has_permission('add_payment'))
  WITH CHECK (public.has_branch_access(branch_id) AND public.has_permission('add_payment'));

-- 2. payments – allow staff UPDATE (needed to correct the payment month
--    after the route_rent_to_earliest_obligation trigger)
DROP POLICY IF EXISTS payments_staff_update ON public.payments;
CREATE POLICY payments_staff_update ON public.payments
  FOR UPDATE
  USING  (public.has_branch_access(branch_id) AND public.has_permission('add_payment'))
  WITH CHECK (public.has_branch_access(branch_id) AND public.has_permission('add_payment'));

-- 3. tenant_advances – allow staff DELETE (clean up incorrectly allocated
--    advances after the trigger routed rent to the wrong period)
DROP POLICY IF EXISTS advances_staff_delete ON public.tenant_advances;
CREATE POLICY advances_staff_delete ON public.tenant_advances
  FOR DELETE
  USING  (public.has_branch_access(branch_id) AND public.has_permission('add_payment'));
