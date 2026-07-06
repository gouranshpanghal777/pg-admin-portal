create or replace function public.delete_branch_cascade(p_branch_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  delete from public.payment_requests where branch_id = p_branch_id;
  delete from public.admission_requests where branch_id = p_branch_id;
  delete from public.branches where id = p_branch_id;
end;
$$;
