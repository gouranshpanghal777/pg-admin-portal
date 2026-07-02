-- Additive ERP finance engine. Existing payment and cashbook rows remain unchanged.
alter table public.cashbook_entries add column if not exists category text not null default 'Uncategorized';
alter table public.cashbook_entries add column if not exists payment_mode text not null default 'Cash';
alter table public.cashbook_entries add column if not exists reference text;
alter table public.cashbook_entries add column if not exists remarks text;

create table if not exists public.payment_obligations (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period text not null,
  payment_type text not null check (payment_type in ('rent', 'security', 'electricity', 'other')),
  agreed_amount numeric(12,2) not null default 0 check (agreed_amount >= 0),
  received_amount numeric(12,2) not null default 0 check (received_amount >= 0),
  advance_applied numeric(12,2) not null default 0 check (advance_applied >= 0),
  due_date date,
  status text not null default 'Pending',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, period, payment_type)
);

create table if not exists public.security_ledger (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  movement_type text not null check (movement_type in ('agreed', 'received', 'refunded', 'deducted')),
  amount numeric(12,2) not null check (amount >= 0),
  movement_date date not null default current_date,
  reason text, payment_id uuid references public.payments(id) on delete set null,
  cashbook_entry_id uuid references public.cashbook_entries(id) on delete set null,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table if not exists public.tenant_advances (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  movement_type text not null check (movement_type in ('credit', 'used', 'refund')),
  amount numeric(12,2) not null check (amount > 0),
  movement_date date not null default current_date,
  period text, payment_id uuid references public.payments(id) on delete set null,
  description text, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create index if not exists payment_obligations_branch_period_idx on public.payment_obligations(branch_id, period);
create index if not exists payment_obligations_tenant_type_idx on public.payment_obligations(tenant_id, payment_type);
create index if not exists security_ledger_branch_tenant_idx on public.security_ledger(branch_id, tenant_id);
create index if not exists tenant_advances_branch_tenant_idx on public.tenant_advances(branch_id, tenant_id);
create index if not exists payments_branch_date_type_idx on public.payments(branch_id, payment_date, payment_type);
create index if not exists cashbook_branch_date_idx on public.cashbook_entries(branch_id, entry_date);
create index if not exists activity_logs_branch_created_idx on public.activity_logs(branch_id, created_at desc);

create or replace function public.link_payment_cashbook_entry()
returns trigger language plpgsql set search_path = public as $$
declare v_type text; v_payment public.payments%rowtype;
begin
  if new.source <> 'Payment' then return new; end if;
  if new.linked_id is not null then select * into v_payment from public.payments where id=new.linked_id;
  else
    v_type := case when new.description ilike 'Rent collected%' then 'rent' when new.description ilike 'Security deposit received%' then 'security' when new.description ilike 'Electricity received%' then 'electricity' else 'other' end;
    select p.* into v_payment from public.payments p where p.branch_id=new.branch_id and p.payment_date=new.entry_date and p.amount=new.amount and lower(p.payment_type)=v_type and p.created_by=new.created_by and not exists(select 1 from public.cashbook_entries c where c.linked_id=p.id) order by p.created_at desc limit 1;
    if found then new.linked_id := v_payment.id; end if;
  end if;
  if v_payment.id is not null then new.payment_mode:=v_payment.payment_mode; new.reference:=v_payment.id::text; new.category:=initcap(v_payment.payment_type); end if;
  return new;
end $$;

alter table public.payment_obligations enable row level security;
alter table public.security_ledger enable row level security;
alter table public.tenant_advances enable row level security;
drop policy if exists payment_obligations_read on public.payment_obligations;
create policy payment_obligations_read on public.payment_obligations for select using (public.has_branch_access(branch_id));
drop policy if exists payment_obligations_admin_write on public.payment_obligations;
create policy payment_obligations_admin_write on public.payment_obligations for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists security_ledger_read on public.security_ledger;
create policy security_ledger_read on public.security_ledger for select using (public.has_branch_access(branch_id));
drop policy if exists security_ledger_admin_write on public.security_ledger;
create policy security_ledger_admin_write on public.security_ledger for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists advances_read on public.tenant_advances;
create policy advances_read on public.tenant_advances for select using (public.has_branch_access(branch_id));
drop policy if exists advances_admin_write on public.tenant_advances;
create policy advances_admin_write on public.tenant_advances for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.sync_payment_ledgers()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tenant public.tenants%rowtype; v_agreed numeric := 0; v_pending numeric := 0; v_advance numeric := 0;
begin
  select * into v_tenant from public.tenants where id = new.tenant_id;
  v_agreed := case lower(new.payment_type)
    when 'rent' then v_tenant.monthly_rent when 'security' then v_tenant.security
    when 'security deposit' then v_tenant.security when 'electricity' then v_tenant.electricity_amount else 0 end;
  insert into public.payment_obligations(branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
  values(new.branch_id, new.tenant_id, case when lower(new.payment_type) in ('security','security deposit') then 'one-time' else new.month end,
    case when lower(new.payment_type) = 'security deposit' then 'security' else lower(new.payment_type) end,
    case when v_agreed > 0 then v_agreed else new.amount end, new.amount, v_tenant.due_date,
    case when new.amount >= case when v_agreed > 0 then v_agreed else new.amount end then 'Paid' else 'Partial' end, new.created_by)
  on conflict(tenant_id, period, payment_type) do update set
    received_amount = public.payment_obligations.received_amount + excluded.received_amount,
    agreed_amount = greatest(public.payment_obligations.agreed_amount, excluded.agreed_amount),
    status = case when public.payment_obligations.received_amount + excluded.received_amount >= greatest(public.payment_obligations.agreed_amount, excluded.agreed_amount) then 'Paid' else 'Partial' end,
    updated_at = now();
  if lower(new.payment_type) in ('security','security deposit') then
    insert into public.security_ledger(branch_id, tenant_id, movement_type, amount, movement_date, payment_id, created_by)
    values(new.branch_id, new.tenant_id, 'received', new.amount, new.payment_date, new.id, new.created_by);
  elsif lower(new.payment_type) = 'rent' then
    select greatest(agreed_amount - received_amount + new.amount - advance_applied, 0) into v_pending
    from public.payment_obligations where tenant_id = new.tenant_id and period = new.month and payment_type = 'rent';
    v_advance := greatest(new.amount - v_pending, 0);
    if v_advance > 0 then insert into public.tenant_advances(branch_id, tenant_id, movement_type, amount, movement_date, period, payment_id, description, created_by)
      values(new.branch_id, new.tenant_id, 'credit', v_advance, new.payment_date, new.month, new.id, 'Rent received above pending amount', new.created_by); end if;
  end if;
  return new;
end $$;
drop trigger if exists sync_payment_ledgers on public.payments;
create trigger sync_payment_ledgers after insert on public.payments for each row execute function public.sync_payment_ledgers();

-- Backfill independent obligations without altering historical payment rows.
with normalized_payments as (
  select p.*, case when lower(p.payment_type) in ('security','security deposit') then 'one-time' else p.month end as obligation_period,
    case when lower(p.payment_type) in ('security','security deposit') then 'security' else lower(p.payment_type) end as obligation_type
  from public.payments p
)
insert into public.payment_obligations(branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, created_by)
select p.branch_id, p.tenant_id, p.obligation_period, p.obligation_type,
  case when p.obligation_type = 'rent' then max(t.monthly_rent)
       when p.obligation_type = 'security' then max(t.security)
       when p.obligation_type = 'electricity' then max(t.electricity_amount) else sum(p.amount) end,
  sum(p.amount), max(t.due_date), (array_agg(p.created_by))[1]
from normalized_payments p join public.tenants t on t.id = p.tenant_id
group by p.branch_id, p.tenant_id, p.obligation_period, p.obligation_type
on conflict(tenant_id, period, payment_type) do update set received_amount = excluded.received_amount, agreed_amount = greatest(public.payment_obligations.agreed_amount, excluded.agreed_amount);

update public.payment_obligations set status = case
  when received_amount + advance_applied >= agreed_amount then 'Paid'
  when received_amount + advance_applied > 0 then 'Partial'
  when due_date < current_date then 'Overdue' else 'Pending' end;

create or replace function public.create_tenant_obligations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.payment_obligations(branch_id, tenant_id, period, payment_type, agreed_amount, due_date, status, created_by)
  values(new.branch_id, new.id, to_char(new.joining_date, 'YYYY-MM'), 'rent', new.monthly_rent, new.due_date, 'Pending', new.created_by)
  on conflict do nothing;
  if new.security > 0 then
    insert into public.payment_obligations(branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
    values(new.branch_id, new.id, 'one-time', 'security', new.security, new.security_received, new.joining_date,
      case when new.security_received >= new.security then 'Paid' when new.security_received > 0 then 'Partial' else 'Pending' end, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists create_tenant_obligations on public.tenants;
create trigger create_tenant_obligations after insert on public.tenants for each row execute function public.create_tenant_obligations();

create or replace function public.apply_available_advance()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_available numeric; v_use numeric;
begin
  if new.payment_type <> 'rent' then return new; end if;
  select coalesce(sum(case when movement_type='credit' then amount else -amount end),0) into v_available from public.tenant_advances where tenant_id=new.tenant_id;
  v_use := least(v_available, greatest(new.agreed_amount-new.received_amount,0));
  if v_use > 0 then
    update public.payment_obligations set advance_applied=v_use, status=case when received_amount+v_use>=agreed_amount then 'Paid' else 'Partial' end where id=new.id;
    insert into public.tenant_advances(branch_id,tenant_id,movement_type,amount,movement_date,period,description,created_by)
    values(new.branch_id,new.tenant_id,'used',v_use,current_date,new.period,'Automatically adjusted against rent',new.created_by);
  end if;
  return new;
end $$;
drop trigger if exists apply_available_advance on public.payment_obligations;
create trigger apply_available_advance after insert on public.payment_obligations for each row execute function public.apply_available_advance();

insert into public.payment_obligations(branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select t.branch_id, t.id, to_char(current_date, 'YYYY-MM'), 'rent', t.monthly_rent,
  coalesce((select sum(p.amount) from public.payments p where p.tenant_id=t.id and p.month=to_char(current_date,'YYYY-MM') and lower(p.payment_type)='rent'),0),
  t.due_date, 'Pending', t.created_by from public.tenants t where t.status <> 'Left'
on conflict(tenant_id, period, payment_type) do nothing;

update public.payment_obligations set status = case
  when received_amount + advance_applied >= agreed_amount then 'Paid'
  when received_amount + advance_applied > 0 then 'Partial'
  when due_date < current_date then 'Overdue' else 'Pending' end;

insert into public.security_ledger(branch_id, tenant_id, movement_type, amount, movement_date, created_by)
select branch_id, id, 'agreed', security, joining_date, created_by from public.tenants where security > 0
and not exists(select 1 from public.security_ledger s where s.tenant_id = tenants.id and s.movement_type = 'agreed');

insert into public.security_ledger(branch_id, tenant_id, movement_type, amount, movement_date, created_by)
select branch_id, id, 'received', security_received, joining_date, created_by from public.tenants where security_received > 0
and not exists(select 1 from public.security_ledger s where s.tenant_id = tenants.id and s.movement_type = 'received');

create or replace function public.delete_tenant_with_payments(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tenant public.tenants%rowtype; v_user public.profiles%rowtype; v_branch_name text; v_room text; v_count integer;
begin
  if not public.is_admin() then raise exception 'Only an admin can permanently delete a tenant' using errcode = '42501'; end if;
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'Tenant not found' using errcode = 'P0002'; end if;
  select number into v_room from public.rooms where id = v_tenant.room_id;
  select name into v_branch_name from public.branches where id = v_tenant.branch_id;
  select * into v_user from public.profiles where id = auth.uid();
  select count(*) into v_count from public.payments where tenant_id = p_tenant_id;
  delete from public.cashbook_entries where source = 'Payment' and linked_id in (select id from public.payments where tenant_id = p_tenant_id);
  delete from public.activity_logs where metadata->>'tenant_id' = p_tenant_id::text;
  delete from public.payments where tenant_id = p_tenant_id;
  delete from public.invoices where tenant_id = p_tenant_id;
  update public.maintenance_tickets set tenant_id = null, updated_by = auth.uid(), updated_at = now() where tenant_id = p_tenant_id;
  update public.admission_requests set tenant_id = null where tenant_id = p_tenant_id;
  delete from public.tenants where id = p_tenant_id;
  insert into public.activity_logs(branch_id, branch_name, user_id, user_name, user_role, module, action_type, description, metadata)
  values(v_tenant.branch_id, v_branch_name, auth.uid(), v_user.name, v_user.role, 'Tenants', 'Delete Tenant',
    'Admin ' || v_user.name || ' permanently deleted tenant ' || v_tenant.name || ' from Room ' || coalesce(v_room, 'unknown') ||
    ' with all linked payments, ledgers and logs.', jsonb_build_object('deleted_tenant_name', v_tenant.name, 'payments_deleted', v_count));
  return jsonb_build_object('tenant_id', p_tenant_id, 'payment_records_deleted', v_count);
end $$;
grant execute on function public.delete_tenant_with_payments(uuid) to authenticated;

create or replace function public.vacate_tenant_erp(
  p_tenant_id uuid, p_left_date date, p_reason text, p_final_rent_balance numeric,
  p_electricity_balance numeric, p_maintenance_deduction numeric, p_security_refund numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tenant public.tenants%rowtype; v_user public.profiles%rowtype; v_branch text; v_room text; v_cashbook_id uuid;
begin
  select * into v_tenant from public.tenants where id=p_tenant_id for update;
  if not found or not public.has_branch_access(v_tenant.branch_id) or not public.has_permission('vacate_tenant') then raise exception 'Tenant not found or permission denied' using errcode='42501'; end if;
  if p_security_refund + p_maintenance_deduction > v_tenant.security_received then raise exception 'Refund and deductions exceed security held' using errcode='22003'; end if;
  select * into v_user from public.profiles where id=auth.uid(); select name into v_branch from public.branches where id=v_tenant.branch_id; select number into v_room from public.rooms where id=v_tenant.room_id;
  if p_security_refund > 0 then
    insert into public.cashbook_entries(branch_id,type,amount,description,entry_date,source,category,payment_mode,created_by,updated_by)
    values(v_tenant.branch_id,'Debit',p_security_refund,'Security refunded — '||v_tenant.name||' (Room '||v_room||')',p_left_date,'Payment','Security Refund','Cash',auth.uid(),auth.uid()) returning id into v_cashbook_id;
    insert into public.security_ledger(branch_id,tenant_id,movement_type,amount,movement_date,reason,cashbook_entry_id,created_by)
    values(v_tenant.branch_id,p_tenant_id,'refunded',p_security_refund,p_left_date,p_reason,v_cashbook_id,auth.uid());
  end if;
  if p_maintenance_deduction > 0 then insert into public.security_ledger(branch_id,tenant_id,movement_type,amount,movement_date,reason,created_by)
    values(v_tenant.branch_id,p_tenant_id,'deducted',p_maintenance_deduction,p_left_date,'Maintenance deduction on exit',auth.uid()); end if;
  update public.tenants set status='Left', left_details=jsonb_build_object('leftDate',p_left_date,'reason',p_reason,'finalRentBalance',p_final_rent_balance,'electricityBalance',p_electricity_balance,'maintenanceDeduction',p_maintenance_deduction,'securityRefund',p_security_refund,'finalSettlement',p_security_refund-p_final_rent_balance-p_electricity_balance-p_maintenance_deduction), updated_by=auth.uid(), updated_at=now() where id=p_tenant_id;
  insert into public.activity_logs(branch_id,branch_name,user_id,user_name,user_role,module,action_type,description,metadata)
  values(v_tenant.branch_id,v_branch,auth.uid(),v_user.name,v_user.role,'Tenants','Vacate Tenant',initcap(v_user.role::text)||' '||v_user.name||' vacated '||v_tenant.name||' from Room '||v_room||'. Security refunded ₹'||trim(to_char(p_security_refund,'FM999999990.00'))||'. Reason: '||p_reason||'.',jsonb_build_object('tenant_id',p_tenant_id,'security_refund',p_security_refund));
  return jsonb_build_object('tenant_id',p_tenant_id,'status','Left');
end $$;
grant execute on function public.vacate_tenant_erp(uuid,date,text,numeric,numeric,numeric,numeric) to authenticated;

create or replace function public.humanize_erp_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tenant public.tenants%rowtype; v_room text; v_pending numeric;
begin
  if new.metadata ? 'tenant_id' then
    select * into v_tenant from public.tenants where id=(new.metadata->>'tenant_id')::uuid;
    if found then select number into v_room from public.rooms where id=v_tenant.room_id; end if;
  end if;
  if new.action_type='Admit Tenant' and v_tenant.id is not null then
    new.description := initcap(new.user_role::text)||' '||new.user_name||' admitted '||v_tenant.name||' to Room '||coalesce(v_room,'-')||' Bed '||v_tenant.bed_no||'. Rent ₹'||trim(to_char(v_tenant.monthly_rent,'FM999999990.00'))||'. Security ₹'||trim(to_char(v_tenant.security,'FM999999990.00'))||'.';
  elsif new.action_type='Receive Payment' and v_tenant.id is not null then
    select greatest(agreed_amount-received_amount-advance_applied,0) into v_pending from public.payment_obligations where tenant_id=v_tenant.id and period=to_char(current_date,'YYYY-MM') and payment_type='rent';
    new.description := initcap(new.user_role::text)||' '||new.user_name||' received '||concat_ws(', ',
      case when coalesce((new.metadata->>'rent')::numeric,0)>0 then '₹'||new.metadata->>'rent'||' rent' end,
      case when coalesce((new.metadata->>'security')::numeric,0)>0 then '₹'||new.metadata->>'security'||' security' end,
      case when coalesce((new.metadata->>'electricity')::numeric,0)>0 then '₹'||new.metadata->>'electricity'||' electricity' end,
      case when coalesce((new.metadata->>'other')::numeric,0)>0 then '₹'||new.metadata->>'other'||' other charges' end)||' from '||v_tenant.name||', Room '||coalesce(v_room,'-')||'. Rent pending ₹'||trim(to_char(coalesce(v_pending,0),'FM999999990.00'))||'.';
  end if;
  return new;
end $$;
drop trigger if exists humanize_erp_activity on public.activity_logs;
create trigger humanize_erp_activity before insert on public.activity_logs for each row execute function public.humanize_erp_activity();
