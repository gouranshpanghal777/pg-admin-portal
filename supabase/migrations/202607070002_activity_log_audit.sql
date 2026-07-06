-- Activity Log audit improvements
-- 1. Update delete_branch_cascade to log before deletion (transactional)
-- 2. Add 30-day cleanup function

-- Recreate delete_branch_cascade with audit logging
-- The audit log is inserted before the branch is deleted so branch_name is available
create or replace function public.delete_branch_cascade(
  p_branch_id uuid,
  p_user_id uuid default null,
  p_user_name text default null,
  p_user_role text default null,
  p_branch_name text default null
)
returns void
language plpgsql
security definer
as $$
begin
  if p_user_id is not null then
    insert into public.activity_logs (branch_id, branch_name, user_id, user_name, user_role, module, action_type, description, metadata)
    values (p_branch_id, p_branch_name, p_user_id, p_user_name, (p_user_role::public.app_role), 'Branch', 'Delete Branch',
      format('%s deleted branch %s and all associated data.', p_user_name, p_branch_name),
      jsonb_build_object('branch_id', p_branch_id::text, 'branch_name', p_branch_name));
  end if;

  delete from public.payment_requests where branch_id = p_branch_id;
  delete from public.admission_requests where branch_id = p_branch_id;
  delete from public.branches where id = p_branch_id;
end;
$$;

-- 30-day retention cleanup function
-- Can be called manually or scheduled via pg_cron
create or replace function public.cleanup_old_activity_logs()
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer;
begin
  delete from public.activity_logs
  where created_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Schedule daily cleanup via pg_cron if extension is available
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('activity-log-cleanup', '0 3 * * *', 'select public.cleanup_old_activity_logs();');
  end if;
end;
$$;
