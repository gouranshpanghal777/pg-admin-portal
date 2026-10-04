-- Tenant-scoped, transactional history. No existing balances or receipts are rewritten on install.
create schema if not exists pg95_private;
revoke all on schema pg95_private from public;
grant usage on schema pg95_private to authenticated;

alter table public.payments add column if not exists allocation_managed boolean not null default false;
create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  obligation_id uuid not null references public.payment_obligations(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  unique(payment_id, obligation_id)
);
create index payment_allocations_tenant_idx on public.payment_allocations(tenant_id);
alter table public.payment_allocations enable row level security;
grant select on public.payment_allocations to authenticated;
revoke insert, update, delete on public.payment_allocations from anon, authenticated;
create policy payment_allocations_read on public.payment_allocations for select to authenticated
  using (public.has_branch_access(branch_id) and exists(select 1 from public.profiles where id=(select auth.uid()) and active is true));

-- This context cannot be set by a client GUC. Only checked backend operations can create it.
create table pg95_private.ledger_context (
  transaction_id bigint primary key, mode text not null check(mode in ('write','restore')), label text
);
create table pg95_private.tenant_changes (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  transaction_id bigint not null,
  label text not null,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  before_state jsonb not null,
  after_state jsonb,
  state text not null default 'applied' check(state in ('applied','undone','superseded')),
  unique(transaction_id,tenant_id)
);
create index tenant_changes_tenant_idx on pg95_private.tenant_changes(tenant_id,id desc);
create table pg95_private.ledger_requests (
  request_id uuid primary key, actor_id uuid not null, tenant_id uuid not null references public.tenants(id) on delete cascade,
  payload jsonb not null, result jsonb, created_at timestamptz not null default now()
);
alter table pg95_private.ledger_context enable row level security;
alter table pg95_private.tenant_changes enable row level security;
alter table pg95_private.ledger_requests enable row level security;
revoke all on all tables in schema pg95_private from public, anon, authenticated;

create function pg95_private.context_mode() returns text language sql stable security definer set search_path = '' as $$
  select mode from pg95_private.ledger_context where transaction_id=txid_current();
$$;
create function pg95_private.check_access(p_tenant uuid,p_admin boolean default false) returns public.tenants
language plpgsql security definer set search_path = '' as $$
declare t public.tenants; actor public.profiles;
begin
  select * into actor from public.profiles where id=auth.uid() and active is true;
  if not found then raise exception 'Sign in with an active account' using errcode='42501'; end if;
  select * into t from public.tenants where id=p_tenant for update;
  if not found then raise exception 'Tenant not found' using errcode='P0002'; end if;
  if not public.has_branch_access(t.branch_id) or (p_admin and actor.role::text<>'admin') then
    raise exception 'Only an active admin can correct this tenant ledger' using errcode='42501';
  end if;
  return t;
end $$;

create function pg95_private.tenant_snapshot(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cash as (
    select c.* from public.cashbook_entries c where
      c.linked_id in (select id from public.payments where tenant_id=p_tenant)
      or c.id in (select cashbook_entry_id from public.security_ledger where tenant_id=p_tenant)
  )
  select jsonb_build_object(
    'tenants',coalesce((select jsonb_agg(to_jsonb(t)-'security_balance'-'updated_at' order by t.id) from public.tenants t where id=p_tenant),'[]'),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where tenant_id=p_tenant),'[]'),
    'payment_obligations',coalesce((select jsonb_agg(to_jsonb(o)-'updated_at' order by o.id) from public.payment_obligations o where tenant_id=p_tenant),'[]'),
    'security_ledger',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.security_ledger s where tenant_id=p_tenant),'[]'),
    'tenant_advances',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.tenant_advances a where tenant_id=p_tenant),'[]'),
    'payment_allocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.payment_allocations a where tenant_id=p_tenant),'[]'),
    'cashbook_entries',coalesce((select jsonb_agg(to_jsonb(c)-'updated_at' order by c.id) from cash c),'[]'),
    'ledger_entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.ledger_entries e where cashbook_entry_id in (select id from cash)),'[]'),
    'invoices',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.invoices i where tenant_id=p_tenant),'[]')
  );
$$;

create function pg95_private.capture_change(p_tenant uuid,p_label text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tenants;
begin
  if auth.uid() is null or pg95_private.context_mode()='restore' then return; end if;
  select * into t from public.tenants where id=p_tenant for update;
  if not found or exists(select 1 from pg95_private.tenant_changes where transaction_id=txid_current() and tenant_id=p_tenant) then return; end if;
  insert into pg95_private.tenant_changes(tenant_id,branch_id,transaction_id,label,actor_id,before_state)
    values(p_tenant,t.branch_id,txid_current(),coalesce((select label from pg95_private.ledger_context where transaction_id=txid_current()),p_label),auth.uid(),pg95_private.tenant_snapshot(p_tenant));
end $$;
create function pg95_private.capture_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; tenant uuid;
begin
  row_data:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if TG_TABLE_NAME='tenants' then tenant:=(row_data->>'id')::uuid;
  elsif TG_TABLE_NAME='cashbook_entries' then
    select tenant_id into tenant from public.payments where id=(row_data->>'linked_id')::uuid;
    if tenant is null then select tenant_id into tenant from public.security_ledger where cashbook_entry_id=(row_data->>'id')::uuid limit 1; end if;
  else tenant:=(row_data->>'tenant_id')::uuid; end if;
  if tenant is not null then perform pg95_private.capture_change(tenant,
    case TG_TABLE_NAME when 'tenants' then 'Tenant details / room / status' when 'payments' then 'Payment entry' else 'Ledger change' end); end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;
create function pg95_private.finish_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb;
begin
  -- Deferred until transaction commit: every row in a split receipt is one change.
  if not exists(select 1 from public.tenants where id=new.tenant_id) then return null; end if;
  snapshot:=pg95_private.tenant_snapshot(new.tenant_id);
  if snapshot=new.before_state then delete from pg95_private.tenant_changes where id=new.id; return null; end if;
  update pg95_private.tenant_changes set state='superseded' where tenant_id=new.tenant_id and state='undone' and id<new.id;
  update pg95_private.tenant_changes set after_state=snapshot where id=new.id;
  return null;
end $$;
create constraint trigger finish_tenant_change after insert on pg95_private.tenant_changes
  deferrable initially deferred for each row execute function pg95_private.finish_change();
create trigger pg95_capture_change before update on public.tenants for each row execute function pg95_private.capture_row_change();
create trigger pg95_capture_change before insert or update or delete on public.payments for each row execute function pg95_private.capture_row_change();
create trigger pg95_capture_change before insert or update or delete on public.payment_obligations for each row execute function pg95_private.capture_row_change();
create trigger pg95_capture_change before insert or update or delete on public.security_ledger for each row execute function pg95_private.capture_row_change();
create trigger pg95_capture_change before insert or update or delete on public.tenant_advances for each row execute function pg95_private.capture_row_change();
-- Runs after the existing BEFORE INSERT cashbook linker.
create trigger zz_pg95_capture_change before insert or update or delete on public.cashbook_entries for each row execute function pg95_private.capture_row_change();

-- Restore only changed rows, preserving unrelated tenants, receipts and categories.
create function pg95_private.restore_rows(p_table text,p_target jsonb,p_current jsonb,p_delete boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; columns text; assignments text;
begin
  if p_table not in ('tenants','payments','payment_obligations','security_ledger','tenant_advances','payment_allocations','cashbook_entries','ledger_entries') then raise exception 'Invalid restore table'; end if;
  if p_delete then
    for row_data in select value from jsonb_array_elements(p_current) loop
      if not exists(select 1 from jsonb_array_elements(p_target) x where x->>'id'=row_data->>'id') then
        execute format('delete from public.%I where id=$1',p_table) using (row_data->>'id')::uuid;
      end if;
    end loop;
  else
    for row_data in select value from jsonb_array_elements(p_target) loop
      if exists(select 1 from jsonb_array_elements(p_current) x where x=row_data) then continue; end if;
      select string_agg(format('%I',a.attname),',' order by a.attnum),
             string_agg(format('%I=excluded.%I',a.attname,a.attname),',' order by a.attnum) filter(where a.attname<>'id')
        into columns,assignments from pg_attribute a
        where a.attrelid=format('public.%I',p_table)::regclass and a.attnum>0 and not a.attisdropped and a.attgenerated='' and row_data ? a.attname;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) on conflict(id) do update set %s',p_table,columns,columns,p_table,assignments) using row_data;
    end loop;
  end if;
end $$;
create function pg95_private.restore_snapshot(p_tenant uuid,p_target jsonb,p_current jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare tab text; target_t public.tenants; r public.rooms;
begin
  select * into target_t from jsonb_populate_record(null::public.tenants,p_target->'tenants'->0);
  if target_t.id<>p_tenant or target_t.branch_id<>(p_current->'tenants'->0->>'branch_id')::uuid then raise exception 'Invalid tenant snapshot'; end if;
  select * into r from public.rooms where id=target_t.room_id for update;
  if target_t.status<>'Left' and (
      r.status='Maintenance' or not found or r.branch_id<>target_t.branch_id or target_t.bed_no<1 or target_t.bed_no>r.beds
      or exists(select 1 from public.tenants where id<>p_tenant and room_id=r.id and bed_no=target_t.bed_no and status<>'Left')
    ) then raise exception 'Original bed is unavailable. Move the tenant to an available bed first.'; end if;
  if exists(select 1 from public.expenses where cashbook_entry_id in (select (x->>'id')::uuid from jsonb_array_elements(p_current->'cashbook_entries') x)) then
    raise exception 'A linked expense changed this receipt. Review the related transaction first.';
  end if;
  insert into pg95_private.ledger_context values(txid_current(),'restore',null) on conflict(transaction_id) do update set mode='restore';
  foreach tab in array array['payment_allocations','security_ledger','tenant_advances','ledger_entries','payment_obligations','payments','cashbook_entries'] loop
    perform pg95_private.restore_rows(tab,p_target->tab,p_current->tab,true);
  end loop;
  foreach tab in array array['tenants','payments','cashbook_entries','payment_obligations','payment_allocations','security_ledger','tenant_advances','ledger_entries'] loop
    perform pg95_private.restore_rows(tab,p_target->tab,p_current->tab,false);
  end loop;
  update public.rooms room set status=case when room.status='Maintenance' then room.status
      when (select count(*) from public.tenants t where t.room_id=room.id and t.status<>'Left')>=room.beds then 'Occupied' else 'Vacant' end
    where room.id in (target_t.room_id,(p_current->'tenants'->0->>'room_id')::uuid);
  delete from pg95_private.ledger_context where transaction_id=txid_current();
  if pg95_private.tenant_snapshot(p_tenant)<>p_target then raise exception 'Restore validation failed. No changes were saved.'; end if;
end $$;

create function pg95_private.history(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tenants; current_state jsonb; undo_id bigint; redo_id bigint;
begin
  t:=pg95_private.check_access(p_tenant,false);
  current_state:=pg95_private.tenant_snapshot(p_tenant);
  select max(id) into undo_id from pg95_private.tenant_changes where tenant_id=p_tenant and state='applied' and after_state is not null;
  select min(id) into redo_id from pg95_private.tenant_changes where tenant_id=p_tenant and state='undone';
  return jsonb_build_object('token',md5(current_state::text),'undo_id',undo_id,'redo_id',redo_id,
    'changes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'label',c.label,'at',c.created_at,'state',c.state,'actor',p.name,
      'can_undo',c.id=undo_id and c.after_state=current_state and (select count(*) from pg95_private.tenant_changes shared where shared.transaction_id=c.transaction_id)=1,'can_redo',c.id=redo_id and c.before_state=current_state and (select count(*) from pg95_private.tenant_changes shared where shared.transaction_id=c.transaction_id)=1,
      'payment_total_before',(select coalesce(sum((x->>'amount')::numeric),0) from jsonb_array_elements(c.before_state->'payments') x),
      'payment_total_after',(select coalesce(sum((x->>'amount')::numeric),0) from jsonb_array_elements(c.after_state->'payments') x)) order by c.id desc)
      from (select * from pg95_private.tenant_changes where tenant_id=p_tenant and after_state is not null order by id desc limit 100) c left join public.profiles p on p.id=c.actor_id),'[]'));
end $$;

create function pg95_private.replay_change(p_request uuid,p_tenant uuid,p_change bigint,p_direction text,p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tenants; change pg95_private.tenant_changes; payload jsonb; req pg95_private.ledger_requests; current_state jsonb; target jsonb; v_result jsonb; chosen bigint;
begin
  t:=pg95_private.check_access(p_tenant,true);
  if p_direction is null or p_direction not in ('undo','redo') then raise exception 'Invalid history action'; end if;
  payload:=jsonb_build_object('tenant',p_tenant,'change',p_change,'direction',p_direction,'token',p_token);
  select * into req from pg95_private.ledger_requests where request_id=p_request;
  if found then
    if req.actor_id<>auth.uid() or req.payload<>payload then raise exception 'Request already used with different values'; end if;
    return req.result;
  end if;
  current_state:=pg95_private.tenant_snapshot(p_tenant);
  if md5(current_state::text) is distinct from p_token then raise exception 'The ledger changed. Refresh it before undo or redo.' using errcode='40001'; end if;
  select * into change from pg95_private.tenant_changes where id=p_change and tenant_id=p_tenant for update;
  if not found then raise exception 'History entry not found'; end if;
  if (select count(*) from pg95_private.tenant_changes where transaction_id=change.transaction_id)>1 then raise exception 'This change involved multiple tenants. Use Move Room to revise it safely.'; end if;
  if p_direction='undo' then
    select max(id) into chosen from pg95_private.tenant_changes where tenant_id=p_tenant and state='applied';
    if chosen is distinct from p_change or change.after_state<>current_state then raise exception 'Undo the latest change for this tenant first.'; end if;
    target:=change.before_state;
  else
    select min(id) into chosen from pg95_private.tenant_changes where tenant_id=p_tenant and state='undone';
    if chosen is distinct from p_change or change.before_state<>current_state then raise exception 'This redo is no longer available after another change.'; end if;
    target:=change.after_state;
  end if;
  insert into pg95_private.ledger_requests values(p_request,auth.uid(),p_tenant,payload,null,now());
  perform pg95_private.restore_snapshot(p_tenant,target,current_state);
  update pg95_private.tenant_changes set state=case when p_direction='undo' then 'undone' else 'applied' end where id=p_change;
  insert into public.activity_logs(branch_id,branch_name,user_id,user_name,user_role,module,action_type,description,metadata)
    select t.branch_id,b.name,p.id,p.name,p.role,'Tenants',initcap(p_direction)||' Ledger Change',
      format('%s %s for %s. Balances and allocations restored together.',initcap(p_direction),change.label,t.name),
      jsonb_build_object('tenant_id',p_tenant,'change_id',p_change,'request_id',p_request)
    from public.profiles p join public.branches b on b.id=t.branch_id where p.id=auth.uid();
  v_result:=jsonb_build_object('change_id',p_change,'direction',p_direction);
  update pg95_private.ledger_requests set result=v_result where request_id=p_request;
  return v_result;
end $$;

-- Trace a legacy rent receipt only against recorded balances; retain unexplained opening balances.
-- Refuse receipts whose advance was already consumed rather than guessing a historic allocation.
create function pg95_private.trace_legacy_payment(p_payment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payments; o public.payment_obligations; remaining numeric; take numeric; reserved numeric;
begin
  select * into p from public.payments where id=p_payment for update;
  if p.allocation_managed then return; end if;
  if exists(select 1 from public.tenant_advances where payment_id=p_payment) then
    raise exception 'This older receipt has an advance ledger. Review the advance allocation before revising it.';
  end if;
  remaining:=p.amount;
  for o in select * from public.payment_obligations where tenant_id=p.tenant_id and payment_type=case when lower(p.payment_type)='security deposit' then 'security' else lower(p.payment_type) end
      and (period>=p.month or period='one-time') order by period for update loop
    select coalesce(sum(amount),0) into reserved from public.payment_allocations where obligation_id=o.id;
    reserved:=reserved+coalesce((select sum(amount) from public.payments where tenant_id=p.tenant_id and id<>p.id
      and not allocation_managed and lower(payment_type)=lower(p.payment_type) and month=o.period),0);
    take:=least(remaining,greatest(o.received_amount-reserved,0));
    if take>0 then insert into public.payment_allocations(branch_id,tenant_id,payment_id,obligation_id,amount) values(p.branch_id,p.tenant_id,p.id,o.id,take); end if;
    remaining:=remaining-take;
    exit when remaining=0;
  end loop;
  if remaining>0 then raise exception 'The older allocation cannot be traced safely. Review this tenant ledger before revising this receipt.'; end if;
  update public.payments set allocation_managed=true where id=p.id;
end $$;

create function pg95_private.add_payment(p_tenant uuid,p_head text,p_amount numeric,p_date date,p_period text,p_mode text,p_description text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.tenants; payment uuid; o public.payment_obligations; v_period text; remaining numeric; take numeric; agreed numeric; idx integer:=0;
begin
  if p_amount<=0 then return null; end if;
  select * into t from public.tenants where id=p_tenant;
  v_period:=case when p_head='security' then 'one-time' else p_period end;
  insert into public.payments(branch_id,tenant_id,amount,payment_date,month,status,payment_mode,payment_type,description,created_by,allocation_managed)
    values(t.branch_id,t.id,p_amount,p_date,case when p_head='security' then to_char(p_date,'YYYY-MM') else v_period end,'Received',p_mode,p_head,p_description,auth.uid(),true) returning id into payment;
  remaining:=p_amount;
  loop
    select * into o from public.payment_obligations where tenant_id=t.id and payment_type=p_head and payment_obligations.period=v_period for update;
    if not found then
      agreed:=case p_head when 'rent' then t.monthly_rent when 'security' then t.security when 'electricity' then greatest(t.electricity_amount,p_amount) else p_amount end;
      if p_head='rent' and agreed<=0 then raise exception 'Set a positive rent amount before collecting rent'; end if;
      insert into public.payment_obligations(branch_id,tenant_id,period,payment_type,agreed_amount,received_amount,advance_applied,due_date,created_by,source)
        values(t.branch_id,t.id,v_period,p_head,agreed,0,0,case when p_head='security' then p_date else public.rent_due_date_for_period(t.due_date,v_period) end,auth.uid(),'ledger-receipt') returning * into o;
    end if;
    take:=case when p_head='rent' then least(remaining,greatest(o.agreed_amount-o.received_amount-o.advance_applied,0)) else remaining end;
    if take>0 then
      insert into public.payment_allocations(branch_id,tenant_id,payment_id,obligation_id,amount) values(t.branch_id,t.id,payment,o.id,take);
      update public.payment_obligations set received_amount=received_amount+take,
        status=case when received_amount+take+advance_applied>=agreed_amount then 'Paid' else 'Partial' end where id=o.id;
    end if;
    remaining:=remaining-take;
    exit when remaining=0;
    idx:=idx+1;
    if idx>=120 then raise exception 'Receipt exceeds 120 rent periods. Split the receipt into smaller entries.'; end if;
    v_period:=to_char(to_date(v_period||'-01','YYYY-MM-DD')+interval '1 month','YYYY-MM');
  end loop;
  insert into public.cashbook_entries(branch_id,type,amount,description,entry_date,source,linked_id,category,payment_mode,reference,created_by,updated_by)
    values(t.branch_id,'Credit',p_amount,initcap(p_head)||' received — '||t.name,p_date,'Payment',payment,initcap(p_head),p_mode,payment::text,auth.uid(),auth.uid());
  if p_head='security' then
    insert into public.security_ledger(branch_id,tenant_id,movement_type,amount,movement_date,payment_id,reason,created_by)
      values(t.branch_id,t.id,'received',p_amount,p_date,payment,p_description,auth.uid());
    update public.tenants set security_received=security_received+p_amount where id=t.id;
  end if;
  return payment;
end $$;

create function pg95_private.mutate_payment(p_request uuid,p_tenant uuid,p_branch uuid,p_payment uuid,p_action text,p_values jsonb,p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tenants; old_payment public.payments; actor public.profiles; req pg95_private.ledger_requests; payload jsonb; v_result jsonb; amounts numeric[]; heads text[]:=array['rent','security','electricity','other']; v_amount numeric; idx integer; d date; period text; mode text; reason text; alloc record; cash_ids uuid[]; sec_remaining numeric; ids jsonb:='[]'; v_payment_id uuid;
begin
  t:=pg95_private.check_access(p_tenant,p_action<>'receive');
  if p_branch is distinct from t.branch_id then raise exception 'Tenant does not belong to the selected branch' using errcode='42501'; end if;
  if p_action is null or p_action not in ('receive','revise','remove') then raise exception 'Invalid payment action'; end if;
  if p_action='receive' and not public.pg95_has_branch_permission(t.branch_id,'add_payment') then raise exception 'Payment permission required' using errcode='42501'; end if;
  payload:=jsonb_build_object('tenant',p_tenant,'branch',p_branch,'payment',p_payment,'action',p_action,'values',p_values,'token',p_token);
  select * into req from pg95_private.ledger_requests where request_id=p_request;
  if found then
    if req.actor_id<>auth.uid() or req.payload<>payload then raise exception 'Request already used with different values'; end if;
    return req.result;
  end if;
  if p_request is null then raise exception 'A request ID is required'; end if;
  if exists(select 1 from public.payment_requests where request_id=p_request) then raise exception 'This receipt was already saved by the previous version. Refresh and use Revise payment.'; end if;
  if p_action<>'receive' and md5(pg95_private.tenant_snapshot(p_tenant)::text) is distinct from p_token then raise exception 'The ledger changed. Refresh before correcting this payment.' using errcode='40001'; end if;
  if t.status='Left' then raise exception 'Reopen the tenant stay before correcting receipts; the exit settlement must be reviewed first.'; end if;
  reason:=nullif(btrim(p_values->>'description'),'');
  if p_action<>'receive' and reason is null then raise exception 'Enter a correction reason'; end if;
  d:=(p_values->>'date')::date; period:=p_values->>'period'; mode:=p_values->>'mode';
  amounts:=array[coalesce((p_values->>'rent')::numeric,0),coalesce((p_values->>'security')::numeric,0),coalesce((p_values->>'electricity')::numeric,0),coalesce((p_values->>'other')::numeric,0)];
  foreach v_amount in array amounts loop
    if v_amount<0 or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount<>round(v_amount,2) or v_amount>=10000000000 then raise exception 'Amounts must be valid non-negative rupees with at most two decimals' using errcode='22003'; end if;
  end loop;
  if p_action<>'remove' and (d is null or d>(now() at time zone 'Asia/Kolkata')::date or period is null or period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or mode is null or mode not in ('Cash','Online','UPI','Bank Transfer','Card')) then raise exception 'Enter a valid payment date, billing month and mode'; end if;
  if p_action<>'remove' and (select sum(x) from unnest(amounts) x)<=0 then raise exception 'Enter at least one payment amount'; end if;
  if p_action<>'remove' and period<to_char(t.joining_date,'YYYY-MM') then raise exception 'Billing month cannot be before this stay starts'; end if;
  insert into pg95_private.ledger_requests values(p_request,auth.uid(),p_tenant,payload,null,now());
  insert into pg95_private.ledger_context values(txid_current(),'write',case p_action when 'receive' then 'Receive payment' when 'revise' then 'Revise payment' else 'Undo payment entry' end);
  perform pg95_private.capture_change(p_tenant, 'Payment correction');
  if p_action<>'receive' then
    select * into old_payment from public.payments where id=p_payment and tenant_id=p_tenant for update;
    if not found then raise exception 'Payment no longer exists'; end if;
    select array_agg(c.id) into cash_ids from public.cashbook_entries c where c.linked_id=p_payment;
    if cash_ids is null then raise exception 'This imported entry has no linked receipt. Review its opening balance before correcting it.'; end if;
    if (select count(*) from public.cashbook_entries where linked_id=p_payment)<>1 or exists(select 1 from public.cashbook_entries where linked_id=p_payment and (amount<>old_payment.amount or type::text<>'Credit' or source<>'Payment')) then raise exception 'Linked cashbook receipt differs. Review the cashbook first.'; end if;
    if exists(select 1 from public.expenses where cashbook_entry_id=any(cash_ids)) then raise exception 'Receipt has a linked expense; review it first.'; end if;
    perform pg95_private.trace_legacy_payment(p_payment);
    if lower(old_payment.payment_type)='security' and exists(select 1 from public.security_ledger where tenant_id=p_tenant and movement_type in ('refunded','deducted')) then raise exception 'Security was refunded or deducted. Review the exit settlement before correcting it.'; end if;
    for alloc in select * from public.payment_allocations where payment_id=p_payment loop
      update public.payment_obligations set received_amount=received_amount-alloc.amount,
        status=case when received_amount-alloc.amount+advance_applied>=agreed_amount then 'Paid' when received_amount-alloc.amount+advance_applied>0 then 'Partial' else 'Pending' end where id=alloc.obligation_id and received_amount>=alloc.amount;
      if not found then raise exception 'Allocation balance changed. No correction was saved.'; end if;
    end loop;
    if lower(old_payment.payment_type) in ('security','security deposit') then
      if t.security_received<old_payment.amount then raise exception 'Security balance cannot be reversed safely'; end if;
      update public.tenants set security_received=security_received-old_payment.amount where id=t.id;
    end if;
    delete from public.ledger_entries where cashbook_entry_id=any(cash_ids);
    delete from public.security_ledger where payment_id=p_payment;
    delete from public.tenant_advances where payment_id=p_payment;
    delete from public.payment_allocations where payment_id=p_payment;
    delete from public.cashbook_entries where id=any(cash_ids);
    delete from public.payments where id=p_payment;
  end if;
  if p_action<>'remove' then
    select security-security_received into sec_remaining from public.tenants where id=t.id;
    if amounts[2]>0 then
      if t.security=0 then update public.tenants set security=amounts[2] where id=t.id;
      elsif amounts[2]>sec_remaining then raise exception 'Security payment exceeds remaining balance of %',greatest(sec_remaining,0); end if;
    end if;
    for idx in 1..4 loop
      v_payment_id:=pg95_private.add_payment(t.id,heads[idx],amounts[idx],d,period,mode,coalesce(reason,'Payment received'));
      if v_payment_id is not null then ids:=ids||jsonb_build_array(v_payment_id); end if;
    end loop;
  end if;
  update public.tenants set paid_this_month=coalesce((select sum(o.received_amount) from public.payment_obligations o where o.tenant_id=t.id and o.payment_type='rent' and o.period=to_char(now() at time zone 'Asia/Kolkata','YYYY-MM')),0),updated_by=auth.uid() where id=t.id;
  insert into public.activity_logs(branch_id,branch_name,user_id,user_name,user_role,module,action_type,description,metadata)
    select t.branch_id,b.name,p.id,p.name,p.role,'Payments',case p_action when 'receive' then 'Receive Payment' when 'revise' then 'Revise Payment' else 'Undo Payment' end,
      format('%s payment for %s. %s',initcap(p_action),t.name,coalesce(reason,'')),jsonb_build_object('tenant_id',t.id,'original_payment_id',p_payment,'payment_ids',ids,'request_id',p_request,'values',p_values,'rent',amounts[1],'security',amounts[2],'electricity',amounts[3],'other',amounts[4])
    from public.profiles p join public.branches b on b.id=t.branch_id where p.id=auth.uid();
  v_result:=jsonb_build_object('payment_ids',ids,'action',p_action);
  update pg95_private.ledger_requests set result=v_result where request_id=p_request;
  delete from pg95_private.ledger_context where transaction_id=txid_current();
  return v_result;
end $$;

create function public.get_tenant_ledger_history(p_tenant_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select pg95_private.history(p_tenant_id); $$;
create function public.replay_tenant_ledger_change(p_request_id uuid,p_tenant_id uuid,p_change_id bigint,p_direction text,p_token text) returns jsonb language sql security invoker set search_path = '' as $$ select pg95_private.replay_change(p_request_id,p_tenant_id,p_change_id,p_direction,p_token); $$;
create function public.correct_tenant_payment(p_request_id uuid,p_tenant_id uuid,p_branch_id uuid,p_payment_id uuid,p_action text,p_values jsonb,p_token text) returns jsonb language sql security invoker set search_path = '' as $$ select pg95_private.mutate_payment(p_request_id,p_tenant_id,p_branch_id,p_payment_id,p_action,p_values,p_token); $$;
create function public.record_split_payment_v3(p_request_id uuid,p_tenant_id uuid,p_branch_id uuid,p_rent_amount numeric,p_security_amount numeric,p_electricity_amount numeric,p_other_amount numeric,p_payment_date date,p_rent_period text,p_payment_mode text,p_description text) returns jsonb language sql security invoker set search_path = '' as $$
 select pg95_private.mutate_payment(p_request_id,p_tenant_id,p_branch_id,null,'receive',jsonb_build_object('rent',p_rent_amount,'security',p_security_amount,'electricity',p_electricity_amount,'other',p_other_amount,'date',p_payment_date,'period',p_rent_period,'mode',p_payment_mode,'description',p_description),null);
$$;
revoke all on all functions in schema pg95_private from public,anon,authenticated;
grant execute on function pg95_private.history(uuid), pg95_private.replay_change(uuid,uuid,bigint,text,text), pg95_private.mutate_payment(uuid,uuid,uuid,uuid,text,jsonb,text) to authenticated;
revoke all on function public.get_tenant_ledger_history(uuid),public.replay_tenant_ledger_change(uuid,uuid,bigint,text,text),public.correct_tenant_payment(uuid,uuid,uuid,uuid,text,jsonb,text),public.record_split_payment_v3(uuid,uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,text) from public,anon;
grant execute on function public.get_tenant_ledger_history(uuid),public.replay_tenant_ledger_change(uuid,uuid,bigint,text,text),public.correct_tenant_payment(uuid,uuid,uuid,uuid,text,jsonb,text),public.record_split_payment_v3(uuid,uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,text) to authenticated;

-- Preserve legacy behavior for old clients; managed writes and restores bypass only redundant derived triggers.
CREATE OR REPLACE FUNCTION public.route_rent_to_earliest_obligation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_period text;
begin
  if pg95_private.context_mode() is not null then return new; end if;
  if lower(new.payment_type) <> 'rent' then return new; end if;

  select period into v_period
  from public.payment_obligations
  where tenant_id = new.tenant_id
    and payment_type = 'rent'
    and period <= new.month
    and received_amount + advance_applied < agreed_amount
  order by period
  limit 1;

  if v_period is not null then new.month := v_period; end if;
  return new;
end $function$

;
CREATE OR REPLACE FUNCTION public.sync_payment_ledgers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant public.tenants%rowtype; v_agreed numeric := 0; v_pending numeric := 0; v_advance numeric := 0;
begin
  if pg95_private.context_mode() is not null then return new; end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.apply_available_advance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_available numeric; v_use numeric;
begin
  if pg95_private.context_mode() is not null then return new; end if;
  if new.payment_type <> 'rent' then return new; end if;
  select coalesce(sum(case when movement_type='credit' then amount else -amount end),0) into v_available from public.tenant_advances where tenant_id=new.tenant_id;
  v_use := least(v_available, greatest(new.agreed_amount-new.received_amount,0));
  if v_use > 0 then
    update public.payment_obligations set advance_applied=v_use, status=case when received_amount+v_use>=agreed_amount then 'Paid' else 'Partial' end where id=new.id;
    insert into public.tenant_advances(branch_id,tenant_id,movement_type,amount,movement_date,period,description,created_by)
    values(new.branch_id,new.tenant_id,'used',v_use,current_date,new.period,'Automatically adjusted against rent',new.created_by);
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.link_payment_cashbook_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_type text; v_payment public.payments%rowtype;
begin
  if pg95_private.context_mode() ='restore' then return new; end if;
  if new.source <> 'Payment' then return new; end if;
  if new.linked_id is not null then select * into v_payment from public.payments where id=new.linked_id;
  else
    v_type := case when new.description ilike 'Rent collected%' then 'rent' when new.description ilike 'Security deposit received%' then 'security' when new.description ilike 'Electricity received%' then 'electricity' else 'other' end;
    select p.* into v_payment from public.payments p where p.branch_id=new.branch_id and p.payment_date=new.entry_date and p.amount=new.amount and lower(p.payment_type)=v_type and p.created_by=new.created_by and not exists(select 1 from public.cashbook_entries c where c.linked_id=p.id) order by p.created_at desc limit 1;
    if found then new.linked_id := v_payment.id; end if;
  end if;
  if v_payment.id is not null then new.payment_mode:=v_payment.payment_mode; new.reference:=v_payment.id::text; new.category:=initcap(v_payment.payment_type); end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pg95_cashbook_link_category_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_category_name text;
  v_party_id uuid;
  v_party_name text;
  v_expense_id uuid;
  v_combined text;
begin
  if pg95_private.context_mode() ='restore' then return new; end if;
  if new.category_id is null
     or new.branch_id is null
     or new.amount is null
     or new.amount <= 0
     or lower(coalesce(new.source::text, 'manual')) = 'payment'
     or coalesce(new.reference, '') like 'LEDGER|%'
     or exists (
       select 1 from public.ledger_entries
       where cashbook_entry_id = new.id
     ) then
    return new;
  end if;

  select name into v_category_name
  from public.categories
  where id = new.category_id;

  if lower(trim(coalesce(v_category_name, ''))) in (
    'rent', 'security deposit', 'electricity', 'other income',
    'inter-branch settlement', 'partner account'
  ) then
    return new;
  end if;

  v_combined := lower(
    coalesce(new.description, '') || ' ' ||
    coalesce(new.remarks, '') || ' ' ||
    coalesce(new.reference, '')
  );

  if lower(trim(v_category_name)) = 'staff salary' and position('tinko' in v_combined) > 0 then
    v_party_name := 'TINKO';
  elsif lower(trim(v_category_name)) = 'staff salary' and position('tinku' in v_combined) > 0 then
    v_party_name := 'TINKU';
  else
    v_party_name := public.pg95_default_category_party_name(v_category_name);
  end if;

  select id into v_party_id
  from public.ledger_parties
  where branch_id = new.branch_id
    and category_id = new.category_id
    and upper(trim(name)) = upper(trim(v_party_name))
  order by id
  limit 1;

  if v_party_id is null then
    insert into public.ledger_parties (
      id, branch_id, category_id, name, party_type,
      joining_date, monthly_amount, due_day, status,
      notes, created_by, updated_by
    ) values (
      gen_random_uuid(), new.branch_id, new.category_id, v_party_name,
      case when v_party_name in ('TINKU', 'TINKO') then 'Staff' else public.pg95_category_party_type(v_category_name) end,
      new.entry_date, 0, 1, 'Active',
      'Automatically created from a direct Cashbook category entry.',
      new.created_by, new.created_by
    ) returning id into v_party_id;
  end if;

  select id into v_expense_id
  from public.expenses
  where cashbook_entry_id = new.id
  order by id
  limit 1;

  insert into public.ledger_entries (
    id, branch_id, party_id, category_id, nature,
    amount, debit_amount, credit_amount,
    entry_date, period, description, payment_mode,
    reference, remarks, cashbook_entry_id, expense_id,
    created_at, created_by
  ) values (
    gen_random_uuid(), new.branch_id, v_party_id, new.category_id,
    case when lower(new.type::text) = 'debit'
      then case when lower(trim(v_category_name)) = 'staff salary' then 'Salary Paid - Direct Entry' else 'Direct Cashbook Payment' end
      else 'Cashbook Credit / Adjustment'
    end,
    new.amount,
    case when lower(new.type::text) = 'debit' then new.amount else 0 end,
    new.amount,
    new.entry_date,
    to_char(new.entry_date, 'YYYY-MM'),
    coalesce(new.description, 'Direct Cashbook entry'),
    new.payment_mode,
    new.reference,
    new.remarks,
    new.id,
    v_expense_id,
    coalesce(new.created_at, now()),
    new.created_by
  )
  on conflict do nothing;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_branch_rent_breakdown(p_branch_id uuid, p_as_of_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_month text;
  v_current_month_start date;
  v_result jsonb;
begin
  if not public.has_branch_access(p_branch_id) then
    raise exception 'You do not have permission to view this branch data' using errcode = '42501';
  end if;

  v_current_month := to_char(p_as_of_date at time zone 'Asia/Kolkata', 'YYYY-MM');
  v_current_month_start := (date_trunc('month', (p_as_of_date at time zone 'Asia/Kolkata')))::date;

  with
  branch_tenants as (
    select t.id as tenant_id, t.name, t.status, t.monthly_rent, t.joining_date, t.due_date
    from public.tenants t
    where t.branch_id = p_branch_id
      and t.status in ('Active', 'Notice', 'Needs Verification')
  ),
  tenant_periods as (
    select
      bt.tenant_id, bt.name, bt.status, bt.monthly_rent, bt.due_date,
      to_char(gs.dt, 'YYYY-MM') as period,
      public.rent_due_date_for_period(bt.due_date, to_char(gs.dt, 'YYYY-MM')) as computed_due_date
    from branch_tenants bt
    cross join lateral generate_series(
      date_trunc('month', bt.joining_date::timestamp),
      v_current_month_start,
      interval '1 month'
    ) as gs(dt)
  ),
  existing_obs as (
    select po.tenant_id, po.period, po.agreed_amount, po.received_amount, po.advance_applied, po.due_date
    from public.payment_obligations po
    where po.branch_id = p_branch_id and po.payment_type = 'rent'
  ),
  payment_sums as (
    select tenant_id, period, sum(paid) paid from (
      select p.tenant_id, p.month period, p.amount paid from public.payments p
      where p.branch_id=p_branch_id and lower(p.payment_type)='rent' and not p.allocation_managed
      union all
      select a.tenant_id,o.period,a.amount from public.payment_allocations a
      join public.payment_obligations o on o.id=a.obligation_id
      where a.branch_id=p_branch_id and o.payment_type='rent'
    ) sums group by tenant_id,period
  ),
  ledger as (
    select
      tp.tenant_id, tp.name as tenant_name, tp.status as tenant_status,
      tp.monthly_rent, tp.period, coalesce(eo.due_date, tp.computed_due_date) as computed_due_date,
      coalesce(eo.agreed_amount, tp.monthly_rent) as agreed,
      case
        when eo.tenant_id is not null then greatest(coalesce(eo.received_amount, 0), coalesce(ps.paid, 0))
        when tp.status in ('Active', 'Notice', 'Needs Verification') then coalesce(ps.paid, 0)
        else 0
      end as received,
      coalesce(eo.advance_applied, 0) as advance,
      greatest(
        coalesce(eo.agreed_amount, tp.monthly_rent)
        - case
            when eo.tenant_id is not null then greatest(coalesce(eo.received_amount, 0), coalesce(ps.paid, 0))
            when tp.status in ('Active', 'Notice', 'Needs Verification') then coalesce(ps.paid, 0)
            else 0
          end
        - coalesce(eo.advance_applied, 0),
        0
      ) as outstanding,
      eo.tenant_id is not null as has_obligation_row
    from tenant_periods tp
    left join existing_obs eo on eo.tenant_id = tp.tenant_id and eo.period = tp.period
    left join payment_sums ps on ps.tenant_id = tp.tenant_id and ps.period = tp.period
  )
  select jsonb_agg(
    jsonb_build_object(
      'tenant_id', l.tenant_id,
      'tenant_name', l.tenant_name,
      'tenant_status', l.tenant_status,
      'monthly_rent', l.monthly_rent,
      'period', l.period,
      'due_date', l.computed_due_date,
      'agreed', l.agreed,
      'received', l.received,
      'advance_applied', l.advance,
      'outstanding', l.outstanding,
      'included_in_expected', l.outstanding > 0,
      'included_in_pending', l.outstanding > 0 and l.computed_due_date <= p_as_of_date,
      'has_obligation_row', l.has_obligation_row,
      'source', case when l.has_obligation_row then 'payment_obligations' else 'synthesized' end
    ) order by l.tenant_name, l.period
  )
  from ledger l
  where l.outstanding > 0
  into v_result;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$
;
grant execute on function pg95_private.context_mode() to authenticated;

-- Dashboard totals consume the same allocation-aware breakdown as the tenant ledger.
create or replace function public.get_branch_rent_collection_summary(p_branch_id uuid,p_as_of_date date default current_date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare lines jsonb; current_month text:=to_char(p_as_of_date,'YYYY-MM'); expected numeric; pending numeric; previous numeric; month_total numeric; month_due numeric; tenant_count integer;
begin
  lines:=public.get_branch_rent_breakdown(p_branch_id,p_as_of_date);
  select coalesce(sum((x->>'outstanding')::numeric),0),
    coalesce(sum((x->>'outstanding')::numeric) filter(where (x->>'due_date')::date<=p_as_of_date),0),
    coalesce(sum((x->>'outstanding')::numeric) filter(where x->>'period'<current_month),0),
    coalesce(sum((x->>'outstanding')::numeric) filter(where x->>'period'=current_month),0),
    coalesce(sum((x->>'outstanding')::numeric) filter(where x->>'period'=current_month and (x->>'due_date')::date<=p_as_of_date),0),
    count(distinct x->>'tenant_id') into expected,pending,previous,month_total,month_due,tenant_count from jsonb_array_elements(lines) x;
  return jsonb_build_object('expected_till_month_end',expected,'pending_till_today',pending,'previous_months_pending',previous,
    'current_month_total_outstanding',month_total,'current_month_due_till_today',month_due,'current_month_not_yet_due',greatest(month_total-month_due,0),'tenant_count_with_pending',tenant_count,'calculated_at',now());
end $$;

-- Managed receipts must be changed through the atomic ledger operation, including cashbook edits.
create function pg95_private.protect_managed_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare managed boolean:=false; row_data jsonb;
begin
  if pg95_private.context_mode() is not null then
    if TG_OP='DELETE' then return old; else return new; end if;
  end if;
  row_data:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if TG_TABLE_NAME='payments' then
    managed:=coalesce((row_data->>'allocation_managed')::boolean,false);
    if TG_OP='UPDATE' then managed:=managed or old.allocation_managed; end if;
  else
    select p.allocation_managed into managed from public.payments p where p.id=(row_data->>'linked_id')::uuid;
    if TG_OP='UPDATE' and not coalesce(managed,false) then select p.allocation_managed into managed from public.payments p where p.id=old.linked_id; end if;
  end if;
  if coalesce(managed,false) then raise exception 'Use the tenant ledger Undo or Revise option to change this receipt and its rent allocations together.'; end if;
  if TG_OP='DELETE' then return old; else return new; end if;
end $$;
revoke all on function pg95_private.protect_managed_receipt() from public,anon,authenticated;
create trigger pg95_protect_managed_receipt before insert or update or delete on public.payments for each row execute function pg95_private.protect_managed_receipt();
create trigger zz_pg95_protect_managed_receipt before update or delete on public.cashbook_entries for each row execute function pg95_private.protect_managed_receipt();

-- Keep the existing, explicitly confirmed admin permanent-deletion workflow working.
CREATE OR REPLACE FUNCTION public.delete_tenant_with_payments(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant public.tenants%rowtype; v_user public.profiles%rowtype; v_branch_name text; v_room text; v_count integer;
begin
  if not public.is_admin() then raise exception 'Only an admin can permanently delete a tenant' using errcode = '42501'; end if;
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'Tenant not found' using errcode = 'P0002'; end if;
  perform pg95_private.check_access(p_tenant_id,true);
  insert into pg95_private.ledger_context values(txid_current(),'restore','Permanent tenant deletion');
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
  delete from pg95_private.ledger_context where transaction_id=txid_current();
  return jsonb_build_object('tenant_id', p_tenant_id, 'payment_records_deleted', v_count);
end $function$;

-- Cascade deletion has an explicit admin/active/branch check before bypassing derived receipt triggers.
create or replace function public.delete_branch_cascade(p_branch_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active is true and role::text='admin')
    or not public.has_branch_access(p_branch_id) then raise exception 'Only an active admin can permanently delete this branch' using errcode='42501'; end if;
  insert into pg95_private.ledger_context values(txid_current(),'restore','Permanent branch deletion');
  delete from public.payment_requests where branch_id=p_branch_id;
  delete from public.admission_requests where branch_id=p_branch_id;
  delete from public.branches where id=p_branch_id;
  delete from pg95_private.ledger_context where transaction_id=txid_current();
end $$;
