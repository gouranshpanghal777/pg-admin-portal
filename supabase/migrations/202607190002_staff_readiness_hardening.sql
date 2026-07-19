-- Staff readiness hardening: no optimistic Finance writes, exact permissions,
-- idempotency, controlled overpayment, and a cleanup-safe live probe.

alter table public.cashbook_entries
  add column if not exists request_id uuid;

create unique index if not exists cashbook_entries_request_id_unique_idx
  on public.cashbook_entries(request_id)
  where request_id is not null;

revoke execute on function public.pg95_ensure_finance_category(uuid, text, uuid) from authenticated;

create or replace function public.pg95_has_branch_permission(
  p_branch_id uuid,
  p_permission text
)
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
            select 1
            from public.branch_assignments assignment
            where assignment.user_id = auth.uid()
              and assignment.branch_id = p_branch_id
          )
          and exists (
            select 1
            from public.staff_permissions permission_row
            where permission_row.user_id = auth.uid()
              and permission_row.permission = p_permission
              and permission_row.allowed is true
          )
        )
      )
  );
$$;

revoke all on function public.pg95_has_branch_permission(uuid, text) from public;
grant execute on function public.pg95_has_branch_permission(uuid, text) to authenticated;

create or replace function public.record_manual_cashbook_entry_v2(
  p_request_id uuid,
  p_branch_id uuid,
  p_type text,
  p_amount numeric,
  p_description text,
  p_entry_date date,
  p_category text,
  p_payment_mode text,
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
  v_entry_type public.cashbook_entries.type%type;
  v_mirror_type public.cashbook_entries.type%type;
  v_source public.cashbook_entries.source%type;
  v_entry_id uuid;
  v_existing_id uuid;
  v_mirror_id uuid;
  v_category_id uuid;
  v_category_name text;
  v_branch_name text;
  v_is_admin boolean := false;
  v_special_kind text;
  v_counterparty_id uuid;
  v_counterparty_name text;
  v_due_amount numeric;
  v_counterparty_category uuid;
begin
  if v_user_id is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'Request id is required.'; end if;

  select id into v_existing_id from public.cashbook_entries where request_id = p_request_id;
  if v_existing_id is not null then
    return jsonb_build_object('success', true, 'cashbook_entry_id', v_existing_id, 'duplicate', true);
  end if;

  select * into v_profile from public.profiles where id = v_user_id and coalesce(active, true);
  if not found then raise exception 'Your staff account is not active.' using errcode = '42501'; end if;
  v_is_admin := lower(v_profile.role::text) = 'admin';

  if not public.pg95_has_branch_permission(p_branch_id, 'add_cashbook') then
    raise exception 'Your account does not have Cashbook permission for this branch.' using errcode = '42501';
  end if;

  select name into v_branch_name from public.branches where id = p_branch_id and coalesce(active, true);
  if not found then raise exception 'Active branch not found.' using errcode = 'P0002'; end if;

  if lower(trim(coalesce(p_type, ''))) = 'credit' then v_entry_type := 'Credit';
  elsif lower(trim(coalesce(p_type, ''))) = 'debit' then v_entry_type := 'Debit';
  else raise exception 'Select Credit or Debit.';
  end if;
  v_mirror_type := 'Debit';
  v_source := 'Manual';

  if coalesce(p_amount, 0) <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  if nullif(trim(coalesce(p_description, '')), '') is null then raise exception 'Description is required.'; end if;
  if p_entry_date is null then raise exception 'Entry date is required.'; end if;

  v_special_kind := split_part(coalesce(p_reference, ''), '|', 1);
  if not v_is_admin and v_special_kind in ('IBR', 'IBS', 'PTL') then
    raise exception 'Inter-branch and partner entries are owner-only.' using errcode = '42501';
  end if;

  select id, name into v_category_id, v_category_name
  from public.categories
  where branch_id = p_branch_id
    and lower(trim(name)) = lower(trim(public.pg95_normalize_finance_category(p_category)))
  order by id
  limit 1;

  if v_category_id is null then
    if not v_is_admin then
      raise exception 'This category does not exist. Ask the owner to create it first.' using errcode = '42501';
    end if;
    v_category_id := public.pg95_ensure_finance_category(p_branch_id, p_category, v_user_id);
    select name into v_category_name from public.categories where id = v_category_id;
  end if;

  if v_special_kind in ('IBR', 'IBS') then
    begin
      v_counterparty_id := split_part(p_reference, '|', 2)::uuid;
      v_due_amount := split_part(p_reference, '|', 3)::numeric;
    exception when others then
      raise exception 'Invalid inter-branch reference.';
    end;
    if v_counterparty_id = p_branch_id then raise exception 'Select another branch.'; end if;
    if v_due_amount <= 0 or v_due_amount > p_amount then raise exception 'Inter-branch amount must be positive and cannot exceed the entry amount.'; end if;
    select name into v_counterparty_name from public.branches where id = v_counterparty_id and coalesce(active, true);
    if not found then raise exception 'Counterparty branch not found.' using errcode = 'P0002'; end if;
  end if;

  v_entry_id := gen_random_uuid();
  insert into public.cashbook_entries (
    id, branch_id, type, amount, description, entry_date,
    source, linked_id, category, category_id, payment_mode,
    reference, remarks, request_id, created_by, updated_by
  ) values (
    v_entry_id, p_branch_id, v_entry_type, p_amount, trim(p_description), p_entry_date,
    v_source, null, v_category_name, v_category_id,
    coalesce(nullif(trim(coalesce(p_payment_mode, '')), ''), 'Cash'),
    nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_remarks, '')), ''),
    p_request_id, v_user_id, v_user_id
  );

  -- Preserve the existing settlement behavior: an IBS Credit creates one Debit
  -- mirror in the counterparty branch. IBR remains a receivable marker only.
  if v_special_kind = 'IBS' and v_entry_type::text = 'Credit' then
    v_counterparty_category := public.pg95_ensure_finance_category(v_counterparty_id, 'Inter-branch Settlement', v_user_id);
    v_mirror_id := gen_random_uuid();
    insert into public.cashbook_entries (
      id, branch_id, type, amount, description, entry_date,
      source, linked_id, category, category_id, payment_mode,
      reference, remarks, request_id, created_by, updated_by
    ) values (
      v_mirror_id, v_counterparty_id, v_mirror_type, v_due_amount,
      format('Inter-branch settlement paid to %s', v_branch_name), p_entry_date,
      v_source, v_entry_id, 'Inter-branch Settlement', v_counterparty_category,
      coalesce(nullif(trim(coalesce(p_payment_mode, '')), ''), 'Cash'),
      format('IBS|%s|%s', p_branch_id, v_due_amount),
      nullif(trim(coalesce(p_remarks, '')), ''), gen_random_uuid(), v_user_id, v_user_id
    );
  end if;

  insert into public.activity_logs (
    branch_id, branch_name, user_id, user_name, user_role,
    module, action_type, description, metadata
  ) values (
    p_branch_id, v_branch_name, v_user_id, coalesce(v_profile.name, 'User'), v_profile.role,
    'Cashbook', case when v_entry_type::text = 'Credit' then 'Credit Created' else 'Debit Created' end,
    format('%s %s added Cashbook %s of %s. Description: %s.',
      initcap(lower(v_profile.role::text)), coalesce(v_profile.name, ''), lower(v_entry_type::text), p_amount, trim(p_description)),
    jsonb_build_object('cashbook_entry_id', v_entry_id, 'request_id', p_request_id, 'amount', p_amount, 'type', v_entry_type::text)
  );

  return jsonb_build_object('success', true, 'cashbook_entry_id', v_entry_id, 'mirror_entry_id', v_mirror_id);
exception when unique_violation then
  select id into v_existing_id from public.cashbook_entries where request_id = p_request_id;
  if v_existing_id is not null then
    return jsonb_build_object('success', true, 'cashbook_entry_id', v_existing_id, 'duplicate', true);
  end if;
  raise;
end;
$$;

revoke all on function public.record_manual_cashbook_entry_v2(uuid, uuid, text, numeric, text, date, text, text, text, text) from public;
grant execute on function public.record_manual_cashbook_entry_v2(uuid, uuid, text, numeric, text, date, text, text, text, text) to authenticated;

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
  v_balance numeric := 0;
  v_creates_expense boolean := false;
  v_creates_cashbook boolean := false;
  v_description text;
  v_reference text;
  v_is_admin boolean := false;
begin
  if v_user_id is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'Request id is required.'; end if;

  select id into v_existing from public.ledger_entries where request_id = p_request_id;
  if v_existing is not null then return jsonb_build_object('success', true, 'ledger_entry_id', v_existing, 'duplicate', true); end if;

  select * into v_profile from public.profiles where id = v_user_id and coalesce(active, true);
  if not found then raise exception 'Your staff account is not active.' using errcode = '42501'; end if;
  v_is_admin := lower(v_profile.role::text) = 'admin';

  select * into v_party from public.ledger_parties where id = p_party_id for update;
  if not found then raise exception 'Staff/vendor account not found.' using errcode = 'P0002'; end if;
  if v_party.status <> 'Active' then raise exception 'This account is inactive/left. Owner must reactivate it first.'; end if;

  select * into v_category from public.categories where id = v_party.category_id;
  if not found then raise exception 'Linked Finance category not found.' using errcode = 'P0002'; end if;

  if p_action in ('Salary Due', 'Rent Due', 'Bonus', 'Deduction') and not v_is_admin then
    raise exception 'Only the owner/admin can generate salary/rent dues, bonus or deductions.' using errcode = '42501';
  elsif p_action = 'Add Bill' and not public.pg95_has_branch_permission(v_party.branch_id, 'add_expense') then
    raise exception 'Your account does not have Expense permission for vendor bills.' using errcode = '42501';
  elsif p_action in ('Salary Payment', 'Advance Given', 'Payment Made', 'Rent Payment')
        and not public.pg95_has_branch_permission(v_party.branch_id, 'add_cashbook') then
    raise exception 'Your account does not have Cashbook permission for payments.' using errcode = '42501';
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
    select 1 from public.ledger_entries where party_id = p_party_id and period = p_period and nature = p_action
  ) then
    raise exception '% is already generated for %.', p_action, p_period;
  end if;

  select coalesce(sum(debit_amount - credit_amount), 0)
  into v_balance from public.ledger_entries where party_id = p_party_id;
  if p_action in ('Salary Payment', 'Payment Made', 'Rent Payment') and p_amount > greatest(v_balance, 0) then
    raise exception 'Payment % exceeds pending balance %.', p_amount, greatest(v_balance, 0);
  end if;

  if p_action in ('Salary Due', 'Bonus', 'Add Bill', 'Rent Due') then
    v_debit := p_amount;
    v_creates_expense := true;
  else
    v_credit := p_amount;
  end if;
  if p_action in ('Salary Payment', 'Advance Given', 'Payment Made', 'Rent Payment') then v_creates_cashbook := true; end if;

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
      reference, remarks, request_id, created_at, created_by
    ) values (
      v_cashbook_id, v_party.branch_id, 'Debit', p_amount, v_description, p_entry_date,
      'Manual', v_ledger_id, v_category.name, v_category.id,
      coalesce(nullif(trim(coalesce(p_payment_mode, '')), ''), 'Cash'),
      v_reference, nullif(trim(coalesce(p_remarks, '')), ''), p_request_id, now(), v_user_id
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
      initcap(lower(v_profile.role::text)), coalesce(v_profile.name, ''), p_action, p_amount, v_party.name, v_category.name),
    jsonb_build_object('category_id', v_category.id, 'party_id', v_party.id, 'request_id', p_request_id, 'amount', p_amount, 'period', p_period)
  );

  return jsonb_build_object('success', true, 'ledger_entry_id', v_ledger_id, 'cashbook_entry_id', v_cashbook_id, 'expense_id', v_expense_id);
exception when unique_violation then
  select id into v_existing from public.ledger_entries where request_id = p_request_id;
  if v_existing is not null then return jsonb_build_object('success', true, 'ledger_entry_id', v_existing, 'duplicate', true); end if;
  raise;
end;
$$;

revoke all on function public.record_category_account_transaction(uuid, uuid, text, numeric, date, text, text, text, text, text) from public;
grant execute on function public.record_category_account_transaction(uuid, uuid, text, numeric, date, text, text, text, text, text) to authenticated;

create or replace function public.pg95_staff_readiness_probe(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_has_cashbook boolean;
  v_has_expense boolean;
  v_category_id uuid;
  v_party_id uuid;
  v_manual_request uuid := gen_random_uuid();
  v_bill_request uuid := gen_random_uuid();
  v_payment_request uuid := gen_random_uuid();
  v_manual_result jsonb;
  v_manual_retry jsonb;
  v_bill_result jsonb;
  v_payment_result jsonb;
  v_balance numeric := 0;
  v_probe_name text := 'AUTO QA STAFF READINESS ' || replace(gen_random_uuid()::text, '-', '');
  v_period text := to_char(current_date, 'YYYY-MM');
  v_error text;
begin
  select * into v_profile from public.profiles where id = v_user_id and coalesce(active, true);
  if not found then raise exception 'Active profile not found.' using errcode = '42501'; end if;
  if lower(v_profile.role::text) <> 'admin' and not exists (
    select 1 from public.branch_assignments where user_id = v_user_id and branch_id = p_branch_id
  ) then raise exception 'Staff is not assigned to this branch.' using errcode = '42501'; end if;

  v_has_cashbook := public.pg95_has_branch_permission(p_branch_id, 'add_cashbook');
  v_has_expense := public.pg95_has_branch_permission(p_branch_id, 'add_expense');

  if not v_has_cashbook and not v_has_expense then
    return jsonb_build_object(
      'success', false,
      'cashbook_permission', false,
      'expense_permission', false,
      'message', 'No Cashbook or Expense permission is enabled for this staff account.'
    );
  end if;

  begin
    insert into public.categories (id, branch_id, name, created_by)
    values (gen_random_uuid(), p_branch_id, v_probe_name, v_user_id)
    returning id into v_category_id;

    insert into public.ledger_parties (
      id, branch_id, category_id, name, party_type, joining_date,
      monthly_amount, due_day, status, notes, created_by, updated_by
    ) values (
      gen_random_uuid(), p_branch_id, v_category_id, v_probe_name || ' VENDOR', 'Vendor',
      current_date, 0, 1, 'Active', 'Temporary readiness probe; removed in the same call.', v_user_id, v_user_id
    ) returning id into v_party_id;

    if v_has_cashbook then
      v_manual_result := public.record_manual_cashbook_entry_v2(
        v_manual_request, p_branch_id, 'Debit', 1, v_probe_name || ' CASHBOOK TEST', current_date,
        v_probe_name, 'Cash', null, 'Temporary readiness probe'
      );
      v_manual_retry := public.record_manual_cashbook_entry_v2(
        v_manual_request, p_branch_id, 'Debit', 1, v_probe_name || ' CASHBOOK TEST', current_date,
        v_probe_name, 'Cash', null, 'Temporary readiness probe retry'
      );
      if v_manual_result->>'cashbook_entry_id' is distinct from v_manual_retry->>'cashbook_entry_id' then
        raise exception 'Manual Cashbook retry created a different row.';
      end if;
    end if;

    if v_has_expense then
      v_bill_result := public.record_category_account_transaction(
        v_bill_request, v_party_id, 'Add Bill', 2, current_date, v_period,
        null, v_probe_name || ' BILL TEST', 'QA', 'Temporary readiness probe'
      );
    else
      insert into public.ledger_entries (
        id, branch_id, party_id, category_id, nature, amount,
        debit_amount, credit_amount, entry_date, period, description, created_by
      ) values (
        gen_random_uuid(), p_branch_id, v_party_id, v_category_id, 'QA Setup Bill', 2,
        2, 0, current_date, v_period, 'Temporary readiness setup', v_user_id
      );
    end if;

    if v_has_cashbook then
      v_payment_result := public.record_category_account_transaction(
        v_payment_request, v_party_id, 'Payment Made', 1, current_date, v_period,
        'Cash', v_probe_name || ' PAYMENT TEST', 'QA', 'Temporary readiness probe'
      );
    end if;

    select coalesce(sum(debit_amount - credit_amount), 0)
    into v_balance from public.ledger_entries where party_id = v_party_id;
    if v_has_cashbook and v_balance <> 1 then raise exception 'Vendor balance check failed: expected 1, got %.', v_balance; end if;
    if not v_has_cashbook and v_has_expense and v_balance <> 2 then raise exception 'Vendor bill balance check failed: expected 2, got %.', v_balance; end if;

    delete from public.activity_logs
    where metadata->>'request_id' in (v_manual_request::text, v_bill_request::text, v_payment_request::text)
       or metadata->>'category_id' = v_category_id::text;
    delete from public.ledger_entries where category_id = v_category_id;
    delete from public.expenses where category_id = v_category_id;
    delete from public.cashbook_entries where category_id = v_category_id;
    delete from public.ledger_parties where category_id = v_category_id;
    delete from public.categories where id = v_category_id;
  exception when others then
    v_error := sqlerrm;
    delete from public.activity_logs
    where metadata->>'request_id' in (v_manual_request::text, v_bill_request::text, v_payment_request::text)
       or metadata->>'category_id' = v_category_id::text;
    delete from public.ledger_entries where category_id = v_category_id;
    delete from public.expenses where category_id = v_category_id;
    delete from public.cashbook_entries where category_id = v_category_id;
    delete from public.ledger_parties where category_id = v_category_id;
    delete from public.categories where id = v_category_id;
    raise exception 'Staff readiness probe failed: %', v_error;
  end;

  return jsonb_build_object(
    'success', true,
    'cashbook_permission', v_has_cashbook,
    'expense_permission', v_has_expense,
    'manual_cashbook_test', case when v_has_cashbook then 'passed' else 'skipped' end,
    'manual_retry_test', case when v_has_cashbook then 'passed' else 'skipped' end,
    'vendor_bill_test', case when v_has_expense then 'passed' else 'setup-only' end,
    'vendor_payment_test', case when v_has_cashbook then 'passed' else 'skipped' end,
    'cleanup_test', 'passed',
    'message', 'Temporary QA rows were removed before this result was returned.'
  );
end;
$$;

revoke all on function public.pg95_staff_readiness_probe(uuid) from public;
grant execute on function public.pg95_staff_readiness_probe(uuid) to authenticated;
