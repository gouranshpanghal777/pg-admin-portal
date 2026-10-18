-- Activate INSERT/UPDATE/DELETE broadcasts for authorized admin/staff readers.
-- Existing maintenance_tickets SELECT RLS uses has_branch_access(branch_id);
-- Supabase Realtime respects this policy for Postgres Changes subscriptions.
-- No existing tickets, branch tokens, or policies are modified.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'maintenance_tickets'
     ) then
    alter publication supabase_realtime add table public.maintenance_tickets;
  end if;
end $$;
