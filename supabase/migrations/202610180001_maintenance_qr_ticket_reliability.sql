-- Additive, non-destructive maintenance QR reliability upgrade.
-- Existing tickets, QR tokens and the original submit RPC are unchanged.
alter table public.maintenance_tickets
  add column if not exists client_request_id uuid;

create unique index if not exists maintenance_tickets_client_request_id_unique
  on public.maintenance_tickets (client_request_id)
  where client_request_id is not null;

create or replace function public.submit_public_maintenance_request_v2(
  token text,
  room_id uuid,
  tenant_name text,
  mobile text,
  complaint text,
  request_id uuid
)
returns table (ticket_id uuid, ticket_number text, branch_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_branch_name text;
  v_ticket_id uuid;
  v_ticket_number text;
  v_new_ticket_id uuid;
begin
  if request_id is null then
    raise exception 'Missing request ID' using errcode = '22023';
  end if;
  if tenant_name is null or length(btrim(tenant_name)) not between 1 and 100 then
    raise exception 'Name must be between 1 and 100 characters' using errcode = '22023';
  end if;
  if mobile is null or mobile !~ '^[6-9][0-9]{9}$' then
    raise exception 'A valid 10 digit Indian mobile number is required' using errcode = '22023';
  end if;
  if complaint is null or length(btrim(complaint)) not between 5 and 2000 then
    raise exception 'Complaint must be between 5 and 2000 characters' using errcode = '22023';
  end if;

  select b.id, b.name into v_branch_id, v_branch_name
  from public.branches b
  where b.maintenance_token = token and b.active = true;

  if v_branch_id is null then
    raise exception 'Invalid maintenance QR code' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.rooms r
    where r.id = room_id and r.branch_id = v_branch_id
  ) then
    raise exception 'Selected room does not belong to this branch' using errcode = '22023';
  end if;

  -- A stable UUID is supplied by the visitor and kept on retry.
  -- One record is created even if the first response was lost in transit.
  v_new_ticket_id := gen_random_uuid();
  v_ticket_number := 'MT-' || upper(substr(replace(v_new_ticket_id::text, '-', ''), 1, 10));

  insert into public.maintenance_tickets (
    id, branch_id, title, status, room_id, tenant_id, category, priority,
    raised_date, assigned_to, description, ticket_number, client_request_id,
    created_by, updated_by, created_at, updated_at
  ) values (
    v_new_ticket_id, v_branch_id, btrim(complaint), 'Open', room_id, null,
    'Tenant Request', 'Medium', (now() at time zone 'Asia/Kolkata')::date,
    'Pending',
    'Tenant Name: ' || btrim(tenant_name) || E'\nMobile: ' || mobile || E'\nComplaint: ' || btrim(complaint),
    v_ticket_number, request_id, null, null, now(), now()
  ) on conflict (client_request_id) where client_request_id is not null do nothing
  returning id, maintenance_tickets.ticket_number into v_ticket_id, v_ticket_number;

  if v_ticket_id is null then
    select m.id, m.ticket_number into v_ticket_id, v_ticket_number
    from public.maintenance_tickets m
    where m.client_request_id = request_id
      and m.branch_id = v_branch_id
      and m.room_id = submit_public_maintenance_request_v2.room_id
      and m.description = (
        'Tenant Name: ' || btrim(tenant_name) || E'\nMobile: ' || mobile || E'\nComplaint: ' || btrim(complaint)
      );
    if v_ticket_id is null then
      raise exception 'Request ID already used with different complaint details' using errcode = '22023';
    end if;
  end if;

  return query select v_ticket_id, v_ticket_number, v_branch_name;
end;
$$;

revoke all on function public.submit_public_maintenance_request_v2(text,uuid,text,text,text,uuid) from public;
grant execute on function public.submit_public_maintenance_request_v2(text,uuid,text,text,text,uuid) to anon, authenticated;
