-- Simple category-based staff/vendor accounting.
-- Normal Cashbook Add Entry remains unchanged; specialist bills/salary/payments use secure RPCs.

alter table public.ledger_entries
  add column if not exists request_id uuid;

create unique index if not exists ledger_entries_request_id_unique_idx
  on public.ledger_entries(request_id)
  where request_id is not null;

create table if not exists public.ledger_party_change_history (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  party_id uuid not null references public.ledger_parties(id) on delete cascade,
  effective_date date not null default current_date,
  old_value jsonb,
  new_value jsonb not null,
  changed_by uuid,
  changed_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists ledger_party_change_history_category_idx
  on public.ledger_party_change_history(category_id, created_at desc);

alter table public.ledger_party_change_history enable row level security;
drop policy if exists ledger_party_change_history_branch_select on public.ledger_party_change_history;
create policy ledger_party_change_history_branch_select
on public.ledger_party_change_history
for select
to authenticated
using (public.pg95_can_access_branch(branch_id));

grant select on public.ledger_party_change_history to authenticated;

create or replace function public.pg95_can_record_category_account(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.active, true)
      and (
        lower(profile.role::text) = 'admin'
        or (
          exists (
            select 1 from public.branch_assignments assignment
            where assignment.user_id = auth.uid()
              and assignment.branch_id = p_branch_id
          )
          and exists (
            select 1 from public.staff_permissions permission_row
            where permission_row.user_id = auth.uid()
              and permission_row.permission in ('add_cashbook', 'add_expense')
              and permission_row.allowed is true
          )
        )
      )
  );
$$;

revoke all on function public.pg95_can_record_category_account(uuid) from public;
grant execute on function public.pg95_can_record_category_account(uuid) to authenticated;

create or replace function public.save_category_account_party(
  p_party_id uuid,
  p_category_id uuid,
  p_name text,
  p_party_type text,
  p_phone text,
  p_joining_date date,
  p_monthly_amount numeric,
  p_due_day integer,
  p_status text,
  p_effective_date date,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_category public.categories%rowtype;
  v_party public.ledger_parties%rowtype;
  v_party_id uuid;
  v_branch_name text;
  v_old jsonb;
  v_new jsonb;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_user_id and coalesce(active, true);
  if not found or lower(v_profile.role::text) <> 'admin' then
    raise exception 'Only the owner/admin can edit category account settings.' using errcode = '42501';
  end if;

  select * into v_category from public.categories where id = p_category_id for update;
  if not found then raise exception 'Finance category not found.' using errcode = 'P0002'; end if;

  if p_party_type not in ('Staff', 'Vendor', 'Building Rent', 'Other') then
    raise exception 'Select a valid account type.';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Account name is required.'; end if;
  if coalesce(p_monthly_amount, 0) < 0 then raise exception 'Monthly amount cannot be negative.'; end if;
  if coalesce(p_due_day, 0) < 1 or p_due_day > 31 then raise exception 'Due day must be between 1 and 31.'; end if;
  if p_status not in ('Active', 'Left', 'Inactive') then raise exception 'Select a valid status.'; end if;

  select name into v_branch_name from public.branches where id = v_category.branch_id;

  if p_party_id is not null then
    select * into v_party
    from public.ledger_parties
    where id = p_party_id and category_id = p_category_id and branch_id = v_category.branch_id
    for update;
    if not found then raise exception 'Category account not found.' using errcode = 'P0002'; end if;

    v_old := jsonb_build_object(
      'name', v_party.name,
      'type', v_party.party_type,
      'phone', coalesce(v_party.phone, ''),
      'joiningDate', v_party.joining_date,
      'monthlyAmount', v_party.monthly_amount,
      'dueDay', v_party.due_day,
      'status', v_party.status,
      'notes', coalesce(v_party.notes, '')
    );

    update public.ledger_parties
    set name = upper(trim(p_name)),
        party_type = p_party_type,
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        joining_date = coalesce(p_joining_date, joining_date),
        monthly_amount = coalesce(p_monthly_amount, 0),
        due_day = p_due_day,
        status = p_status,
        left_date = case when p_status = 'Active' then null else coalesce(left_date, p_effective_date, current_date) end,
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        updated_at = now(),
        updated_by = v_user_id
    where id = p_party_id
    returning id into v_party_id;
  else
    insert into public.ledger_parties (
      id, branch_id, category_id, name, party_type, phone,
      joining_date, monthly_amount, due_day, status, left_date,
      notes, created_by, updated_by
    ) values (
      gen_random_uuid(), v_category.branch_id, p_category_id, upper(trim(p_name)), p_party_type,
      nullif(trim(coalesce(p_phone, '')), ''), coalesce(p_joining_date, current_date),
      coalesce(p_monthly_amount, 0), p_due_day, p_status,
      case when p_status = 'Active' then null else coalesce(p_effective_date, current_date) end,
      nullif(trim(coalesce(p_notes, '')), ''), v_user_id, v_user_id
    ) returning id into v_party_id;
    v_old := null;
  end if;

  select jsonb_build_object(
    'name', name,
    'type', party_type,
    'phone', coalesce(phone, ''),
    'joiningDate', joining_date,
    'monthlyAmount', monthly_amount,
    'dueDay', due_day,
    'status', status,
    'notes', coalesce(notes, '')
  ) into v_new
  from public.ledger_parties where id = v_party_id;

  if v_old is distinct from v_new then
    insert into public.ledger_party_change_history (
      branch_id, category_id, party_id, effective_date,
      old_value, new_value, changed_by, changed_by_name
    ) values (
      v_category.branch_id, p_category_id, v_party_id,
      coalesce(p_effective_date, current_date), v_old, v_new,
      v_user_id, coalesce(v_profile.name, 'Admin')
    );
  end if;

  insert into public.activity_logs (
    branch_id, branch_name, user_id, user_name, user_role,
    module, action_type, description, metadata
  ) values (
    v_category.branch_id, coalesce(v_branch_name, ''), v_user_id,
    coalesce(v_profile.name, 'Admin'), v_profile.role,
    'Finance', 'Edit Category Account',
    format('Admin %s updated %s account %s under category %s. Monthly amount: %s. Effective from: %s.',
      coalesce(v_profile.name, ''), p_party_type, upper(trim(p_name)), v_category.name,
      coalesce(p_monthly_amount, 0), coalesce(p_effective_date, current_date)),
    jsonb_build_object('category_id', p_category_id, 'party_id', v_party_id, 'old', v_old, 'new', v_new)
  );

  return jsonb_build_object('success', true, 'party_id', v_party_id);
end;
$$;

revoke all on function public.save_category_account_party(uuid, uuid, text, text, text, date, numeric, integer, text, date, text) from public;
grant execute on function public.save_category_account_party(uuid, uuid, text, text, text, date, numeric, integer, text, date, text) to authenticated;

create or replace function public.record_category_account_transaction(
  p_request_id uuid,
  p_party_id uuid,
  p_action text,
  p_amount numeric,
  p_entry_date date,
  p_period text,
  p_payment_mode text,
  p_description text,
  p_reference text,
  p_remarks text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_party public.ledger_parties%rowtype;
  v_category public.categories%rowtype;
  v_branch_name text;
  v_ledger_id uuid := gen_random_uuid();
  v_cashbook_id uuid;
  v_expense_id uuid;
  v_existing uuid;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_creates_expense boolean := false;
  v_creates_cashbook boolean := false;
  v_description text;
  v_reference text;
begin
  if v_user_id is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'Request id is required.'; end if;

  select id into v_existing from public.ledger_entries where request_id = p_request_id;
  if v_existing is not null then return jsonb_build_object('success', true, 'ledger_entry_id', v_existing, 'duplicate', true); end if;

  select * into v_profile from public.profiles where id = v_user_id and coalesce(active, true);
  if not found then raise exception 'Your staff account is not active.' using errcode = '42501'; end if;

  select * into v_party from public.ledger_parties where id = p_party_id for update;
  if not found then raise exception 'Staff/vendor account not found.' using errcode = 'P0002'; end if;
  if v_party.status <> 'Active' then raise exception 'This account is inactive/left. Owner must reactivate it first.'; end if;

  select * into v_category from public.categories where id = v_party.category_id;
  if not found then raise exception 'Linked Finance category not found.' using errcode = 'P0002'; end if;
  if not public.pg95_can_record_category_account(v_party.branch_id) then
    raise exception 'Your account does not have permission to add staff/vendor payments in this branch.' using errcode = '42501';
  end if;

  if coalesce(p_amount, 0) <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  if p_period !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'Select a valid month / period.'; end if;

  if v_party.party_type = 'Staff' and p_action not in ('Salary Due', 'Salary Payment', 'Advance Given', 'Bonus', 'Deduction') then
    raise exception 'Invalid staff entry type.';
  elsif v_party.party_type = 'Vendor' and p_action not in ('Add Bill', 'Payment Made') then
    raise exception 'Invalid vendor entry type.';
  elsif v_party.party_type = 'Building Rent' and p_action not in ('Rent Due', 'Rent Payment') then
    raise exception 'Invalid building-rent entry type.';
  elsif v_party.party_type = 'Other' then
    raise exception 'Owner must classify this category as Staff, Vendor or Building Rent first.';
  end if;

  if p_action in ('Salary Due', 'Rent Due') and exists (
    select 1 from public.ledger_entries
    where party_id = p_party_id and period = p_period and nature = p_action
  ) then
    raise exception '% is already generated for %.', p_action, p_period;
  end if;

  if p_action in ('Salary Due', 'Bonus', 'Add Bill', 'Rent Due') then
    v_debit := p_amount;
    v_creates_expense := true;
  else
    v_credit := p_amount;
  end if;

  if p_action in ('Salary Payment', 'Advance Given', 'Payment Made', 'Rent Payment') then
    v_creates_cashbook := true;
  end if;

  v_description := coalesce(nullif(trim(coalesce(p_description, '')), ''), p_action || ' - ' || v_party.name);
  v_reference := 'LEDGER|CATEGORY_ACCOUNT|' || p_party_id::text || '|' || p_request_id::text ||
    case when nullif(trim(coalesce(p_reference, '')), '') is null then '' else '|' || trim(p_reference) end;

  if v_creates_expense then
    v_expense_id := gen_random_uuid();
    insert into public.expenses (
      id, branch_id, category, category_id, description,
      amount, expense_date, vendor, cashbook_entry_id, created_by
    ) values (
      v_expense_id, v_party.branch_id, v_category.name, v_category.id,
      v_description, p_amount, p_entry_date, v_party.name, null, v_user_id
    );
  end if;

  if v_creates_cashbook then
    v_cashbook_id := gen_random_uuid();
    insert into public.cashbook_entries (
      id, branch_id, type, amount, description, entry_date,
      source, linked_id, category, category_id, payment_mode,
      reference, remarks, created_at, created_by
    ) values (
      v_cashbook_id, v_party.branch_id, 'Debit', p_amount, v_description, p_entry_date,
      'Manual', v_ledger_id, v_category.name, v_category.id,
      coalesce(nullif(trim(coalesce(p_payment_mode, '')), ''), 'Cash'),
      v_reference, nullif(trim(coalesce(p_remarks, '')), ''), now(), v_user_id
    );
  end if;

  insert into public.ledger_entries (
    id, branch_id, party_id, category_id, nature,
    amount, debit_amount, credit_amount, entry_date, period,
    description, payment_mode, reference, remarks,
    cashbook_entry_id, expense_id, request_id, created_at, created_by
  ) values (
    v_ledger_id, v_party.branch_id, v_party.id, v_category.id, p_action,
    p_amount, v_debit, v_credit, p_entry_date, p_period,
    v_description, case when v_creates_cashbook then p_payment_mode else null end,
    nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_remarks, '')), ''),
    v_cashbook_id, v_expense_id, p_request_id, now(), v_user_id
  );

  select name into v_branch_name from public.branches where id = v_party.branch_id;
  insert into public.activity_logs (
    branch_id, branch_name, user_id, user_name, user_role,
    module, action_type, description, metadata
  ) values (
    v_party.branch_id, coalesce(v_branch_name, ''), v_user_id,
    coalesce(v_profile.name, 'User'), v_profile.role,
    'Finance', p_action,
    format('%s %s recorded %s of %s for %s under %s.',
      initcap(lower(v_profile.role::text)), coalesce(v_profile.name, ''),
      p_action, p_amount, v_party.name, v_category.name),
    jsonb_build_object('category_id', v_category.id, 'party_id', v_party.id, 'amount', p_amount, 'period', p_period)
  );

  return jsonb_build_object(
    'success', true,
    'ledger_entry_id', v_ledger_id,
    'cashbook_entry_id', v_cashbook_id,
    'expense_id', v_expense_id
  );
end;
$$;

revoke all on function public.record_category_account_transaction(uuid, uuid, text, numeric, date, text, text, text, text, text) from public;
grant execute on function public.record_category_account_transaction(uuid, uuid, text, numeric, date, text, text, text, text, text) to authenticated;
