-- The app uses the five-argument overload. Keep its audit log and the same checked deletion context.
create or replace function public.delete_branch_cascade(p_branch_id uuid,p_user_id uuid default null,p_user_name text default null,p_user_role text default null,p_branch_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; branch_name text;
begin
  select * into actor from public.profiles where id=auth.uid() and active is true and role::text='admin';
  if not found or not public.has_branch_access(p_branch_id) then raise exception 'Only an active admin can permanently delete this branch' using errcode='42501'; end if;
  select name into branch_name from public.branches where id=p_branch_id;
  insert into public.activity_logs(branch_id,branch_name,user_id,user_name,user_role,module,action_type,description,metadata)
  values(p_branch_id,branch_name,actor.id,actor.name,actor.role,'Branch','Delete Branch',format('%s deleted branch %s and all associated data.',actor.name,branch_name),jsonb_build_object('branch_id',p_branch_id,'branch_name',branch_name));
  insert into pg95_private.ledger_context values(txid_current(),'restore','Permanent branch deletion');
  delete from public.payment_requests where branch_id=p_branch_id;
  delete from public.admission_requests where branch_id=p_branch_id;
  delete from public.branches where id=p_branch_id;
  delete from pg95_private.ledger_context where transaction_id=txid_current();
end $$;
