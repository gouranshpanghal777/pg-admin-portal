-- Backfill reusable Finance categories from existing Cashbook/Expenses,
-- create a default account ledger for each category, import historical entries,
-- and keep future direct Cashbook entries linked automatically.
--
-- Special Farukhnagar correction:
--   TINKU / TINKO category aliases are merged into Staff Salary while
--   preserving TINKU and TINKO as separate staff ledger parties.
--
-- This migration never inserts, deletes or changes Cashbook amounts, dates,
-- descriptions or transaction types. Only category/category_id links are normalised.

create or replace function public.pg95_normalize_finance_category(p_name text)
returns text
language sql
immutable
as $$
  select case
    when nullif(trim(coalesce(p_name, '')), '') is null then 'Uncategorized'
    when lower(trim(p_name)) in ('tinku', 'tinko', 'staff salary', 'staff salaries', 'salary staff') then 'Staff Salary'
    when lower(trim(p_name)) like '%staff%salary%' then 'Staff Salary'
    else trim(p_name)
  end;
$$;

create or replace function public.pg95_category_party_type(p_category_name text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_category_name, '')) like '%staff%salary%' then 'Staff'
    when lower(coalesce(p_category_name, '')) like '%building%rent%'
      or lower(coalesce(p_category_name, '')) like '%landlord%'
      or lower(coalesce(p_category_name, '')) like '%owner rent%' then 'Building Rent'
    when lower(coalesce(p_category_name, '')) ~ '(milk|dairy|water|bread|ration|grocery|vegetable|gas|supplier|vendor|laundry|housekeeping|food)' then 'Vendor'
    else 'Other'
  end;
$$;

create or replace function public.pg95_default_category_party_name(p_category_name text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_category_name, ''))) = 'staff salary' then 'STAFF SALARY - GENERAL'
    else upper(trim(coalesce(p_category_name, 'UNCATEGORIZED')))
  end;
$$;

create or replace function public.pg95_ensure_finance_category(
  p_branch_id uuid,
  p_category_name text,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := public.pg95_normalize_finance_category(p_category_name);
  v_category_id uuid;
  v_party_name text;
  v_party_type text;
begin
  select id into v_category_id
  from public.categories
  where branch_id = p_branch_id
    and lower(trim(name)) = lower(trim(v_name))
  order by id
  limit 1;

  if v_category_id is null then
    begin
      insert into public.categories (id, branch_id, name, created_by)
      values (gen_random_uuid(), p_branch_id, v_name, p_created_by)
      returning id into v_category_id;
    exception when unique_violation then
      select id into v_category_id
      from public.categories
      where branch_id = p_branch_id
        and lower(trim(name)) = lower(trim(v_name))
      order by id
      limit 1;
    end;
  end if;

  v_party_name := public.pg95_default_category_party_name(v_name);
  v_party_type := public.pg95_category_party_type(v_name);

  if not exists (
    select 1
    from public.ledger_parties
    where branch_id = p_branch_id
      and category_id = v_category_id
      and upper(trim(name)) = upper(trim(v_party_name))
  ) then
    insert into public.ledger_parties (
      id, branch_id, category_id, name, party_type,
      joining_date, monthly_amount, due_day, status,
      notes, created_by, updated_by
    ) values (
      gen_random_uuid(), p_branch_id, v_category_id, v_party_name, v_party_type,
      current_date, 0, 1, 'Active',
      'Automatically linked to the existing Finance category.', p_created_by, p_created_by
    );
  end if;

  return v_category_id;
end;
$$;

revoke all on function public.pg95_ensure_finance_category(uuid, text, uuid) from public;
grant execute on function public.pg95_ensure_finance_category(uuid, text, uuid) to authenticated;

create temporary table pg95_farukhnagar_staff_candidates (
  cashbook_id uuid primary key,
  party_name text not null
) on commit drop;

create temporary table pg95_farukhnagar_staff_names (
  party_name text primary key
) on commit drop;

do $$
declare
  v_actor uuid;
  v_farukhnagar uuid;
  v_staff_category uuid;
  v_category record;
  v_cashbook record;
  v_expense record;
  v_category_id uuid;
  v_party_id uuid;
  v_party_name text;
  v_party_type text;
  v_cashbook_count_before bigint;
  v_cashbook_count_after bigint;
  v_cashbook_total_before numeric;
  v_cashbook_total_after numeric;
  v_expense_count_before bigint;
  v_expense_count_after bigint;
  v_expense_total_before numeric;
  v_expense_total_after numeric;
begin
  select id into v_actor
  from public.profiles
  where lower(role::text) = 'admin'
  order by active desc nulls last, id
  limit 1;

  select count(*), coalesce(sum(amount), 0)
    into v_cashbook_count_before, v_cashbook_total_before
  from public.cashbook_entries;

  select count(*), coalesce(sum(amount), 0)
    into v_expense_count_before, v_expense_total_before
  from public.expenses;

  -- Create real category rows from every historical Cashbook/Expense category.
  for v_category in
    select distinct source.branch_id, source.category_name
    from (
      select branch_id, nullif(trim(category), '') as category_name
      from public.cashbook_entries
      union
      select branch_id, nullif(trim(category::text), '') as category_name
      from public.expenses
    ) source
    where source.branch_id is not null
      and source.category_name is not null
  loop
    perform public.pg95_ensure_finance_category(
      v_category.branch_id,
      v_category.category_name,
      v_actor
    );
  end loop;

  -- Attach all historical rows to their canonical category IDs.
  update public.cashbook_entries cb
  set category = public.pg95_normalize_finance_category(cb.category),
      category_id = public.pg95_ensure_finance_category(
        cb.branch_id,
        cb.category,
        coalesce(cb.created_by, v_actor)
      )
  where cb.branch_id is not null
    and nullif(trim(coalesce(cb.category, '')), '') is not null;

  update public.expenses e
  set category_id = public.pg95_ensure_finance_category(
        e.branch_id,
        e.category::text,
        coalesce(e.created_by, v_actor)
      )
  where e.branch_id is not null
    and nullif(trim(coalesce(e.category::text, '')), '') is not null;

  select id into v_farukhnagar
  from public.branches
  where regexp_replace(lower(name), '[^a-z0-9]+', '', 'g') = 'pg95farukhnagar'
  order by id
  limit 1;

  if v_farukhnagar is not null then
    -- Capture TINKU/TINKO identity before category aliases are normalised.
    insert into pg95_farukhnagar_staff_names (party_name)
    select distinct case
      when lower(trim(name)) like '%tinko%' then 'TINKO'
      when lower(trim(name)) like '%tinku%' then 'TINKU'
    end
    from public.categories
    where branch_id = v_farukhnagar
      and (lower(trim(name)) like '%tinku%' or lower(trim(name)) like '%tinko%')
    on conflict do nothing;

    insert into pg95_farukhnagar_staff_candidates (cashbook_id, party_name)
    select cb.id,
      case
        when position('tinko' in lower(
          coalesce(cb.category, '') || ' ' || coalesce(c.name, '') || ' ' ||
          coalesce(cb.description, '') || ' ' || coalesce(cb.remarks, '') || ' ' ||
          coalesce(cb.reference, '')
        )) > 0 then 'TINKO'
        else 'TINKU'
      end
    from public.cashbook_entries cb
    left join public.categories c on c.id = cb.category_id
    where cb.branch_id = v_farukhnagar
      and lower(cb.type::text) = 'debit'
      and (
        position('tinku' in lower(
          coalesce(cb.category, '') || ' ' || coalesce(c.name, '') || ' ' ||
          coalesce(cb.description, '') || ' ' || coalesce(cb.remarks, '') || ' ' ||
          coalesce(cb.reference, '')
        )) > 0
        or position('tinko' in lower(
          coalesce(cb.category, '') || ' ' || coalesce(c.name, '') || ' ' ||
          coalesce(cb.description, '') || ' ' || coalesce(cb.remarks, '') || ' ' ||
          coalesce(cb.reference, '')
        )) > 0
      )
    on conflict (cashbook_id) do nothing;

    insert into pg95_farukhnagar_staff_names (party_name)
    select distinct party_name
    from pg95_farukhnagar_staff_candidates
    on conflict do nothing;

    v_staff_category := public.pg95_ensure_finance_category(
      v_farukhnagar,
      'Staff Salary',
      v_actor
    );

    -- Move every TINKU/TINKO/Staff Salary alias reference to one category.
    update public.cashbook_entries
    set category = 'Staff Salary',
        category_id = v_staff_category
    where branch_id = v_farukhnagar
      and (
        category_id in (
          select id from public.categories
          where branch_id = v_farukhnagar
            and (
              lower(trim(name)) in ('staff salary', 'staff salaries', 'salary staff', 'tinku', 'tinko')
              or lower(trim(name)) like '%staff%salary%'
              or lower(trim(name)) like '%tinku%'
              or lower(trim(name)) like '%tinko%'
            )
        )
        or lower(trim(coalesce(category, ''))) in ('staff salary', 'staff salaries', 'salary staff', 'tinku', 'tinko')
        or lower(trim(coalesce(category, ''))) like '%staff%salary%'
        or lower(trim(coalesce(category, ''))) like '%tinku%'
        or lower(trim(coalesce(category, ''))) like '%tinko%'
      );

    update public.expenses
    set category_id = v_staff_category
    where branch_id = v_farukhnagar
      and (
        category_id in (
          select id from public.categories
          where branch_id = v_farukhnagar
            and (
              lower(trim(name)) in ('staff salary', 'staff salaries', 'salary staff', 'tinku', 'tinko')
              or lower(trim(name)) like '%staff%salary%'
              or lower(trim(name)) like '%tinku%'
              or lower(trim(name)) like '%tinko%'
            )
        )
        or lower(trim(category::text)) in ('staff salary', 'staff salaries', 'salary staff', 'tinku', 'tinko')
        or lower(trim(category::text)) like '%staff%salary%'
        or lower(trim(category::text)) like '%tinku%'
        or lower(trim(category::text)) like '%tinko%'
      );

    update public.ledger_parties
    set category_id = v_staff_category,
        updated_by = coalesce(updated_by, v_actor),
        updated_at = now()
    where branch_id = v_farukhnagar
      and category_id in (
        select id from public.categories
        where branch_id = v_farukhnagar
          and id <> v_staff_category
          and (
            lower(trim(name)) in ('staff salary', 'staff salaries', 'salary staff', 'tinku', 'tinko')
            or lower(trim(name)) like '%staff%salary%'
            or lower(trim(name)) like '%tinku%'
            or lower(trim(name)) like '%tinko%'
          )
      );

    update public.ledger_entries
    set category_id = v_staff_category
    where branch_id = v_farukhnagar
      and category_id in (
        select id from public.categories
        where branch_id = v_farukhnagar
          and id <> v_staff_category
          and (
            lower(trim(name)) in ('staff salary', 'staff salaries', 'salary staff', 'tinku', 'tinko')
            or lower(trim(name)) like '%staff%salary%'
            or lower(trim(name)) like '%tinku%'
            or lower(trim(name)) like '%tinko%'
          )
      );

    delete from public.categories
    where branch_id = v_farukhnagar
      and id <> v_staff_category
      and (
        lower(trim(name)) in ('staff salary', 'staff salaries', 'salary staff', 'tinku', 'tinko')
        or lower(trim(name)) like '%staff%salary%'
        or lower(trim(name)) like '%tinku%'
        or lower(trim(name)) like '%tinko%'
      );

    -- Keep TINKU and TINKO as separate staff accounts below Staff Salary.
    for v_party_name in
      select party_name from pg95_farukhnagar_staff_names order by party_name
    loop
      if not exists (
        select 1 from public.ledger_parties
        where branch_id = v_farukhnagar
          and category_id = v_staff_category
          and upper(trim(name)) = v_party_name
      ) then
        insert into public.ledger_parties (
          id, branch_id, category_id, name, party_type,
          joining_date, monthly_amount, due_day, status,
          notes, created_by, updated_by
        ) values (
          gen_random_uuid(), v_farukhnagar, v_staff_category, v_party_name, 'Staff',
          current_date, 0, 1, 'Active',
          'Imported from the previous separate salary category.', v_actor, v_actor
        );
      end if;
    end loop;
  end if;

  -- Guarantee one usable default party for every category in every branch.
  for v_category in
    select id, branch_id, name from public.categories
  loop
    v_party_name := public.pg95_default_category_party_name(v_category.name);
    v_party_type := public.pg95_category_party_type(v_category.name);
    if not exists (
      select 1 from public.ledger_parties
      where branch_id = v_category.branch_id
        and category_id = v_category.id
        and upper(trim(name)) = upper(trim(v_party_name))
    ) then
      insert into public.ledger_parties (
        id, branch_id, category_id, name, party_type,
        joining_date, monthly_amount, due_day, status,
        notes, created_by, updated_by
      ) values (
        gen_random_uuid(), v_category.branch_id, v_category.id, v_party_name, v_party_type,
        current_date, 0, 1, 'Active',
        'Automatically linked to the existing Finance category.', v_actor, v_actor
      );
    end if;
  end loop;

  -- Import historical Cashbook entries once. Existing Cashbook rows remain unchanged.
  for v_cashbook in
    select cb.*, c.name as category_name
    from public.cashbook_entries cb
    join public.categories c on c.id = cb.category_id
    where cb.category_id is not null
      and not exists (
        select 1 from public.ledger_entries le
        where le.cashbook_entry_id = cb.id
      )
      and lower(coalesce(cb.source::text, 'manual')) <> 'payment'
      and lower(trim(c.name)) not in (
        'rent', 'security deposit', 'electricity', 'other income',
        'inter-branch settlement', 'partner account'
      )
    order by cb.entry_date, cb.created_at, cb.id
  loop
    v_party_id := null;

    if v_farukhnagar is not null
      and v_cashbook.branch_id = v_farukhnagar
      and lower(trim(v_cashbook.category_name)) = 'staff salary' then
      select lp.id into v_party_id
      from pg95_farukhnagar_staff_candidates candidate
      join public.ledger_parties lp
        on lp.branch_id = v_farukhnagar
       and lp.category_id = v_cashbook.category_id
       and upper(trim(lp.name)) = candidate.party_name
      where candidate.cashbook_id = v_cashbook.id
      limit 1;
    end if;

    if v_party_id is null then
      select id into v_party_id
      from public.ledger_parties
      where branch_id = v_cashbook.branch_id
        and category_id = v_cashbook.category_id
        and upper(trim(name)) = upper(trim(public.pg95_default_category_party_name(v_cashbook.category_name)))
      order by id
      limit 1;
    end if;

    if v_party_id is not null then
      insert into public.ledger_entries (
        id, branch_id, party_id, category_id, nature,
        amount, debit_amount, credit_amount,
        entry_date, period, description, payment_mode,
        reference, remarks, cashbook_entry_id, expense_id,
        created_at, created_by
      ) values (
        gen_random_uuid(), v_cashbook.branch_id, v_party_id, v_cashbook.category_id,
        case when lower(v_cashbook.type::text) = 'debit'
          then case when lower(trim(v_cashbook.category_name)) = 'staff salary' then 'Historical Salary Paid' else 'Historical Direct Payment' end
          else 'Historical Credit / Adjustment'
        end,
        v_cashbook.amount,
        case when lower(v_cashbook.type::text) = 'debit' then v_cashbook.amount else 0 end,
        v_cashbook.amount,
        v_cashbook.entry_date,
        to_char(v_cashbook.entry_date, 'YYYY-MM'),
        coalesce(v_cashbook.description, 'Imported Cashbook entry'),
        v_cashbook.payment_mode,
        v_cashbook.reference,
        coalesce(v_cashbook.remarks, 'Imported automatically from the existing Cashbook.'),
        v_cashbook.id,
        (select e.id from public.expenses e where e.cashbook_entry_id = v_cashbook.id order by e.id limit 1),
        coalesce(v_cashbook.created_at, now()),
        coalesce(v_cashbook.created_by, v_actor)
      );
    end if;
  end loop;

  -- Import unpaid historical expenses that do not have a Cashbook payment.
  for v_expense in
    select e.*, c.name as category_name
    from public.expenses e
    join public.categories c on c.id = e.category_id
    where e.category_id is not null
      and e.cashbook_entry_id is null
      and not exists (
        select 1 from public.ledger_entries le
        where le.expense_id = e.id
      )
    order by e.expense_date, e.id
  loop
    select id into v_party_id
    from public.ledger_parties
    where branch_id = v_expense.branch_id
      and category_id = v_expense.category_id
      and upper(trim(name)) = upper(trim(public.pg95_default_category_party_name(v_expense.category_name)))
    order by id
    limit 1;

    if v_party_id is not null then
      insert into public.ledger_entries (
        id, branch_id, party_id, category_id, nature,
        amount, debit_amount, credit_amount,
        entry_date, period, description,
        expense_id, created_by
      ) values (
        gen_random_uuid(), v_expense.branch_id, v_party_id, v_expense.category_id,
        'Historical Bill / Expense',
        v_expense.amount, v_expense.amount, 0,
        v_expense.expense_date, to_char(v_expense.expense_date, 'YYYY-MM'),
        coalesce(v_expense.description, 'Imported historical expense'),
        v_expense.id, coalesce(v_expense.created_by, v_actor)
      );
    end if;
  end loop;

  select count(*), coalesce(sum(amount), 0)
    into v_cashbook_count_after, v_cashbook_total_after
  from public.cashbook_entries;

  select count(*), coalesce(sum(amount), 0)
    into v_expense_count_after, v_expense_total_after
  from public.expenses;

  if v_cashbook_count_before <> v_cashbook_count_after
     or v_cashbook_total_before <> v_cashbook_total_after then
    raise exception 'Cashbook safety check failed: rows or total amount changed';
  end if;

  if v_expense_count_before <> v_expense_count_after
     or v_expense_total_before <> v_expense_total_after then
    raise exception 'Expense safety check failed: rows or total amount changed';
  end if;

  if exists (
    select 1 from public.cashbook_entries
    where branch_id is not null
      and nullif(trim(coalesce(category, '')), '') is not null
      and category_id is null
  ) then
    raise exception 'Category backfill check failed: Cashbook rows remain unlinked';
  end if;

  if v_farukhnagar is not null and exists (
    select 1 from public.categories
    where branch_id = v_farukhnagar
      and (lower(trim(name)) like '%tinku%' or lower(trim(name)) like '%tinko%')
  ) then
    raise exception 'Farukhnagar Staff Salary merge check failed';
  end if;

  raise notice 'Finance categories backfilled; historical category ledgers imported; TINKU/TINKO salary categories merged without changing Cashbook totals.';
end;
$$;

-- Future direct Cashbook entries automatically receive a real category and ledger.
create or replace function public.pg95_cashbook_ensure_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.branch_id is null then
    return new;
  end if;

  if nullif(trim(coalesce(new.category, '')), '') is null and new.category_id is not null then
    select name into new.category from public.categories where id = new.category_id;
  end if;

  new.category := public.pg95_normalize_finance_category(new.category);
  new.category_id := public.pg95_ensure_finance_category(
    new.branch_id,
    new.category,
    new.created_by
  );

  return new;
end;
$$;

drop trigger if exists pg95_cashbook_ensure_category_trigger on public.cashbook_entries;
create trigger pg95_cashbook_ensure_category_trigger
before insert or update of branch_id, category, category_id
on public.cashbook_entries
for each row execute function public.pg95_cashbook_ensure_category();

create or replace function public.pg95_cashbook_link_category_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_name text;
  v_party_id uuid;
  v_party_name text;
  v_expense_id uuid;
  v_combined text;
begin
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
$$;

drop trigger if exists pg95_cashbook_link_category_ledger_trigger on public.cashbook_entries;
create trigger pg95_cashbook_link_category_ledger_trigger
after insert or update of amount, type, entry_date, category, category_id, description, payment_mode, reference, remarks
on public.cashbook_entries
for each row execute function public.pg95_cashbook_link_category_ledger();
