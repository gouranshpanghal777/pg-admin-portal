alter table public.expenses add column if not exists maintenance_ticket_id uuid references public.maintenance_tickets(id) on delete set null;

create or replace function public.link_payment_cashbook_entry()
returns trigger language plpgsql set search_path = public as $$
declare v_type text;
begin
  if new.source <> 'Payment' or new.linked_id is not null then return new; end if;
  v_type := case
    when new.description ilike 'Rent collected%' then 'rent'
    when new.description ilike 'Security deposit received%' then 'security'
    when new.description ilike 'Electricity received%' then 'electricity'
    else 'other' end;
  select p.id into new.linked_id
  from public.payments p
  where p.branch_id = new.branch_id and p.payment_date = new.entry_date
    and p.amount = new.amount and lower(p.payment_type) = v_type
    and p.created_by = new.created_by
    and not exists(select 1 from public.cashbook_entries c where c.linked_id = p.id)
  order by p.created_at desc limit 1;
  return new;
end $$;

drop trigger if exists link_payment_cashbook_entry on public.cashbook_entries;
create trigger link_payment_cashbook_entry before insert on public.cashbook_entries
for each row execute function public.link_payment_cashbook_entry();

create or replace function public.delete_cashbook_entry_cascade(p_cashbook_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.cashbook_entries%rowtype;
  v_payment public.payments%rowtype;
  v_expense public.expenses%rowtype;
  v_purchase public.inventory_purchases%rowtype;
  v_user public.profiles%rowtype;
  v_branch_name text;
  v_entity text := 'cashbook';
begin
  if not public.is_admin() then raise exception 'Only an admin can delete cashbook entries' using errcode = '42501'; end if;
  select * into v_entry from public.cashbook_entries where id = p_cashbook_id for update;
  if not found then raise exception 'Cashbook entry not found' using errcode = 'P0002'; end if;

  if v_entry.source = 'Payment' then
    select * into v_payment from public.payments where id = v_entry.linked_id;
    if not found then
      select p.* into v_payment from public.payments p
      where p.branch_id = v_entry.branch_id and p.payment_date = v_entry.entry_date and p.amount = v_entry.amount
        and lower(p.payment_type) = case when v_entry.description ilike 'Rent collected%' then 'rent'
          when v_entry.description ilike 'Security deposit received%' then 'security'
          when v_entry.description ilike 'Electricity received%' then 'electricity' else 'other' end
      order by p.created_at desc limit 1;
    end if;
    if found then
      update public.tenants set
        paid_this_month = greatest(0, paid_this_month - case when lower(v_payment.payment_type) = 'rent' and v_payment.month = to_char(current_date, 'YYYY-MM') then v_payment.amount else 0 end),
        security_received = greatest(0, security_received - case when lower(v_payment.payment_type) in ('security','security deposit') then v_payment.amount else 0 end),
        updated_by = auth.uid(), updated_at = now()
      where id = v_payment.tenant_id;
      delete from public.payments where id = v_payment.id;
      if v_payment.invoice_id is not null then delete from public.invoices where id = v_payment.invoice_id; end if;
      v_entity := 'payment';
    end if;
  elsif v_entry.source = 'Inventory' then
    select * into v_purchase from public.inventory_purchases
    where id = v_entry.linked_id or cashbook_entry_id = v_entry.id order by created_at desc limit 1;
    if found then
      update public.inventory_items set stock = greatest(0, stock - v_purchase.quantity), updated_by = auth.uid()
      where id = v_purchase.item_id;
      delete from public.inventory_purchases where id = v_purchase.id;
      if v_purchase.expense_id is not null then delete from public.expenses where id = v_purchase.expense_id; end if;
      v_entity := 'inventory purchase';
    end if;
  elsif v_entry.source in ('Expense', 'Maintenance') then
    select * into v_expense from public.expenses where id = v_entry.linked_id or cashbook_entry_id = v_entry.id
    order by created_at desc limit 1;
    if not found then
      select * into v_expense from public.expenses
      where branch_id = v_entry.branch_id and expense_date = v_entry.entry_date and amount = v_entry.amount
        and (description = v_entry.description or v_entry.description ilike '%' || description || '%')
      order by created_at desc limit 1;
    end if;
    if found then
      if v_expense.maintenance_ticket_id is not null then
        update public.maintenance_tickets
        set resolution = jsonb_set(coalesce(resolution, '{}'::jsonb), '{cost}', '0'::jsonb), updated_by = auth.uid(), updated_at = now()
        where id = v_expense.maintenance_ticket_id;
      end if;
      delete from public.expenses where id = v_expense.id;
      v_entity := lower(v_entry.source);
    end if;
  end if;

  delete from public.cashbook_entries where id = v_entry.id;
  select * into v_user from public.profiles where id = auth.uid();
  select name into v_branch_name from public.branches where id = v_entry.branch_id;
  insert into public.activity_logs(branch_id, branch_name, user_id, user_name, user_role, module, action_type, description, metadata)
  values(v_entry.branch_id, v_branch_name, auth.uid(), v_user.name, v_user.role, 'Cashbook', 'Cascade Delete',
    'Admin ' || v_user.name || ' deleted cashbook ' || lower(v_entry.type::text) || ' of ₹' || trim(to_char(v_entry.amount, 'FM999999990.00')) ||
      ' and its linked ' || v_entity || ' record.', jsonb_build_object('cashbook_id', v_entry.id, 'source', v_entry.source));
  return jsonb_build_object('cashbook_id', v_entry.id, 'linked_entity_deleted', v_entity);
end;
$$;

grant execute on function public.delete_cashbook_entry_cascade(uuid) to authenticated;
