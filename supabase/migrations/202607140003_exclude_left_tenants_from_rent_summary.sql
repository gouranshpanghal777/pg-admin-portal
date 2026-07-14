-- Exclude vacated/left tenants from dashboard rent calculations.
-- Left-tenant balances belong to settlement/recovery reporting, not the
-- active monthly rent forecast shown by Expected Rent and Pending Till Today.

create or replace function public.get_branch_rent_collection_summary(
  p_branch_id uuid,
  p_as_of_date date default current_date
)
returns jsonb
