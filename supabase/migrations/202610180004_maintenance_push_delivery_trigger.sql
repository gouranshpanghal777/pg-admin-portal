-- Queue a protected, server-side push delivery after a new ticket is committed.
-- The request secret is stored in Supabase Vault, never in the Git repository.
create extension if not exists pg_net with schema extensions;
create or replace function public.queue_pg95_maintenance_push()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'pg95_maintenance_push_webhook_secret'
  limit 1;
  if webhook_secret is null then
    raise warning 'PG95 push webhook secret is not configured';
    return new;
  end if;
  perform net.http_post(
    url := 'https://jgurmuvshaqmwjypiqtl.supabase.co/functions/v1/pg95-maintenance-push',
    headers := jsonb_build_object('Content-Type','application/json','x-pg95-secret',webhook_secret),
    body := jsonb_build_object('ticket_id',new.id),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  -- Push delivery failures must never stop a tenant's maintenance ticket.
  raise warning 'PG95 notification queue failed: %', SQLERRM;
  return new;
end;
$$;
revoke all on function public.queue_pg95_maintenance_push() from public, anon, authenticated;
drop trigger if exists pg95_maintenance_ticket_push_insert on public.maintenance_tickets;
create trigger pg95_maintenance_ticket_push_insert
  after insert on public.maintenance_tickets
  for each row execute function public.queue_pg95_maintenance_push();
