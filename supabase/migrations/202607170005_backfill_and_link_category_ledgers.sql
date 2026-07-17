-- Link existing Finance/Cashbook categories to Accounts & Ledgers.
-- Historical Cashbook/Expense rows are preserved; only category links are normalised.
-- Farukhnagar aliases TINKU and TINKO become individual staff parties under one
-- canonical Staff Salary category.

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

create or replace function public.pg95_category_party_type(p_name text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_name, '')) like '%staff%salary%' then 'Staff'
    when lower(coalesce(p_name, '')) like '%building%rent%'
      or lower(coalesce(p_name, '')) like '%landlord%'
      or lower(coalesce(p_name, '')) like '%owner rent%' then 'Building Rent'
    when lower(coalesce(p_name, '')) ~ '(milk|dairy|water|bread|ration|grocery|vegetable|gas|supplier|vendor|laundry|housekeeping|food)' then 'Vendor'
    else 'Other'
  end;
$$;

create or replace function public.pg95_default_category_party_name(p_name text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_name, ''))) = 'staff salary' then 'STAFF SALARY - GENERAL'
    else upper(trim(coalesce(p_name, 'Uncategorized')))
  end;
$$;

create or replace function public.pg95_create_default_category_party(
  p_category_id uuid,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category public.categories%rowtype;
  v_party_id uuid;
  v_party_name text;
begin
  select * into v_category from public.categories where id = p_category_id;
  if not found then
    raise exception 'Finance category not found' using errcode = 'P0002';
  end if;

  v_party_name := public.pg95_default_category_party_name(v_category.name);
  select id into v_party_id
  from public.ledger_parties
  where branch_id = v_category.branch_id
    and category_id = v_category.id
    and upper(trim(name)) = upper(trim(v_party_name))
  order by id
  limit 1;

  if v_party_id is null then
    insert into public.ledger_parties (
      id, branch_id, category_id, name, party_type,
      joining_date, monthly_amount, due_day, status,
      notes, created_by, updated_by
    ) values (
      gen_random_uuid(), v_category.branch_id, v_category.id, v_party_name,
      public.pg95_category_party_type(v_category.name),
      current_date, 0, 1, 'Active',
      'Automatically linked to the Finance category.', p_created_by, p_created_by
    ) returning id into v_party_id;
  end if;

  return v_party_id;
end;
$$;

create or replace function public.pg95_ensure_finance_category(
  p_branch_id uuid,
  p_name text,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := public.pg95_normalize_finance_category(p_name);
  v_category_id uuid;
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

  perform public.pg95_create_default_category_party(v_category_id, p_created_by);
  return v_category_id;
end;
$$;

revoke all on function public.pg95_create_default_category_party(uuid, uuid) from public;
revoke all on function public.pg95_ensure_finance_category(uuid, text, uuid) from public;
grant execute on function public.pg95_ensure_finance_category(uuid, text, uuid) to authenticated;

create temporary table pg95_staff_category_names (
  party_name text primary key
) on commit drop;

create temporary table pg95_staff_cashbook_candidates (
  cashbook_id uuid primary key,
  party_name text not null
) on commit drop;

do $$
declare
  v_actor uuid;
  v_farukhnagar uuid;
  v_staff_category uuid;
  v_row record;
  v_party_id uuid;
  v_party_name text;
  v_cb_count_before bigint;
  v_cb_count_after bigint;
  v_cb_total_before numeric;
  v_cb_total_after numeric;
  v_expense_count_before bigint;
  v_expense_count_after bigint;
  v_expense_total_before numeric;
  v_expense_total_after numeric;
begin
  select id into v_actor
  from public.profiles
  order by (lower(role::text) = 'admin') desc, id
  limit 1;

  select id into v_farukhnagar
  from public.branches
  where regexp_replace(lower(name), '[^a-z0-9]+', '', 'g') = 'pg95farukhnagar'
  order by id
  limit 1;

  select count(*), coalesce(sum(amount), 0)
  into v_cb_count_before, v_cb_total_before
  from public.cashbook_entries;

  select count(*), coalesce(sum(amount), 0)
  into v_expense_count_before, v_expense_total_before
  from public.expenses;

  -- Capture old TINKU/TINKO identity before any category name is normalised.
  if v_farukhnagar is not null then
    insert into pg95_staff_category_names (party_name)
    select distinct case
      when lower(name) like '%tinko%' then 'TINKO'
      when lower(name) like '%tinku%' then 'TINKU'
    end
    from public.categories
    where branch_id = v_farukhnagar
      and (lower(name) like '%tinku%' or lower(name) like '%tinko%')
    on conflict do nothing;

    insert into pg95_staff_cashbook_candidates (cashbook_id, party_name)
    select cb.id,
      case
        when position('tinko' in lower(
          coalesce(cb.category, '') || ' ' || coalesce(cat.name, '') || ' ' ||
          coalesce(cb.description, '') || ' ' || coalesce(cb.remarks, '') || ' ' ||
          coalesce(cb.reference, '')
        )) > 0 then 'TINKO'
        else 'TINKU'
      end
    from public.cashbook_entries cb
    left join public.categories cat on cat.id = cb.category_id
    where cb.branch_id = v_farukhnagar
      and lower(cb.type::text) = 'debit'
      and (
        position('tinku' in lower(
          coalesce(cb.category, '') || ' ' || coalesce(cat.name, '') || ' ' ||
          coalesce(cb.description, '') || ' ' || coalesce(cb.remarks, '') || ' ' ||
          coalesce(cb.reference, '')
        )) > 0
        or position('tinko' in lower(
          coalesce(cb.category, '') || ' ' || coalesce(cat.name, '') || ' ' ||
          coalesce(cb.description, '') || ' ' || coalesce(cb.remarks, '') || ' ' ||
          coalesce(cb.reference, '')
        )) > 0
      )
    on conflict (cashbook_id) do nothing;

    insert into pg95_staff_category_names (party_name)
    select distinct party_name from pg95_staff_cashbook_candidates
    on conflict do nothing;
  end if;

  -- Convert every historical Cashbook/Expense category into a real reusable category.
  for v_row in
    select distinct branch_id, category_name
    from (
      select branch_id, nullif(trim(category), '') as category_name
      from public.cashbook_entries
      union
      select branch_id, nullif(trim(category::text), '') as category_name
      from public.expenses
    ) source
    where branch_id is not null and category_name is not null
  loop
    perform public.pg95_ensure_finance_category(v_row.branch_id, v_row.category_name, v_actor);
  end loop;

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

  if v_farukhnagar is not null then
    v_staff_category := public.pg95_ensure_finance_category(v_farukhnagar, 'Staff Salary', v_actor);

    -- Move every old salary alias reference to the canonical Staff Salary category.
    update public.cashbook_entries
    set category = 'Staff Salary', category_id = v_staff_category
    where branch_id = v_farukhnagar
      and (
        category_id in (
          select id from public.categories
          where branch_id = v_farukhnagar
            and id <> v_staff_category
            and (
              lower(trim(name)) like '%tinku%'
              or lower(trim(name)) like '%tinko%'
              or lower(trim(name)) like '%staff%salary%'
            )
        )
        or lower(trim(coalesce(category, ''))) like '%tinku%'
        or lower(trim(coalesce(category, ''))) like '%tinko%'
        or lower(trim(coalesce(category, ''))) like '%staff%salary%'
      );

    update public.expenses
    set category_id = v_staff_category
    where branch_id = v_farukhnagar
      and category_id in (
        select id from public.categories
        where branch_id = v_farukhnagar
          and id <> v_staff_category
          and (
            lower(trim(name)) like '%tinku%'
            or lower(trim(name)) like '%tinko%'
            or lower(trim(name)) like '%staff%salary%'
          )
      );

    update public.ledger_parties
    set category_id = v_staff_category, updated_at = now(), updated_by = coalesce(updated_by, v_actor)
    where branch_id = v_farukhnagar
      and category_id in (
        select id from public.categories
        where branch_id = v_farukhnagar
          and id <> v_staff_category
          and (
            lower(trim(name)) like '%tinku%'
            or lower(trim(name)) like '%tinko%'
            or lower(trim(name)) like '%staff%salary%'
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
            lower(trim(name)) like '%tinku%'
            or lower(trim(name)) like '%tinko%'
            or lower(trim(name)) like '%staff%salary%'
          )
      );

    delete from public.categories
    where branch_id = v_farukhnagar
      and id <> v_staff_category
      and (
        lower(trim(name)) like '%tinku%'
        or lower(trim(name)) like '%tinko%'
        or lower(trim(name)) like '%staff%salary%'
      );

    -- Create separate TINKU/TINKO staff parties under Staff Salary.
    for v_party_name in
      select party_name from pg95_staff_category_names order by party_name
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

  -- Make sure all categories, including old categories without transactions, have a ledger party.
  for v_row in select id from public.categories loop
    perform public.pg95_create_default_category_party(v_row.id, v_actor);
  end loop;

  -- Import every historical non-tenant Cashbook entry once into its category ledger.
  for v_row in
    select cb.*, cat.name as category_name
    from public.cashbook_entries cb
    join public.categories cat on cat.id = cb.category_id
    where cb.category_id is not null
      and not exists (
        select 1 from public.ledger_entries le where le.cashbook_entry_id = cb.id
      )
      and lower(coalesce(cb.source::text, 'manual')) <> 'payment'
      and lower(trim(cat.name)) not in (
        'rent', 'security deposit', 'electricity', 'other income',
        'inter-branch settlement', 'partner account'
      )
    order by cb.entry_date, cb.created_at, cb.id
  loop
    v_party_id := null;

    if v_farukhnagar is not null
       and v_row.branch_id = v_farukhnagar
       and lower(trim(v_row.category_name)) = 'staff salary' then
      select lp.id into v_party_id
      from pg95_staff_cashbook_candidates candidate
      join public.ledger_parties lp
        on lp.branch_id = v_farukhnagar
       and lp.category_id = v_row.category_id
       and upper(trim(lp.name)) = candidate.party_name
      where candidate.cashbook_id = v_row.id
      limit 1;
    end if;

    if v_party_id is null then
      select id into v_party_id
      from public.ledger_parties
      where branch_id = v_row.branch_id
        and category_id = v_row.category_id
        and upper(trim(name)) = upper(trim(public.pg95_default_category_party_name(v_row.category_name)))
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
        gen_random_uuid(), v_row.branch_id, v_party_id, v_row.category_id,
        case
          when lower(v_row.type::text) = 'debit' and lower(trim(v_row.category_name)) = 'staff salary' then 'Historical Salary Paid'
          when lower(v_row.type::text) = 'debit' then 'Historical Direct Payment'
          else 'Historical Credit / Adjustment'
        end,
        v_row.amount,
        case when lower(v_row.type::text) = 'debit' then v_row.amount else 0 end,
        v_row.amount,
        v_row.entry_date,
        to_char(v_row.entry_date, 'YYYY-MM'),
        coalesce(v_row.description, 'Imported Cashbook entry'),
        v_row.payment_mode,
        v_row.reference,
        coalesce(v_row.remarks, 'Imported automatically from existing Cashbook history.'),
        v_row.id,
        (select e.id from public.expenses e where e.cashbook_entry_id = v_row.id order by e.id limit 1),
        coalesce(v_row.created_at, now()),
        coalesce(v_row.created_by, v_actor)
      );
    end if;
  end loop;

  -- Expenses recorded as bills without any payment remain payable in the ledger.
  for v_row in
    select e.*, cat.name as category_name
    from public.expenses e
    join public.categories cat on cat.id = e.category_id
    where e.cashbook_entry_id is null
      and not exists (
        select 1 from public.ledger_entries le where le.expense_id = e.id
      )
    order by e.expense_date, e.id
  loop
    select id into v_party_id
    from public.ledger_parties
    where branch_id = v_row.branch_id
      and category_id = v_row.category_id
      and upper(trim(name)) = upper(trim(public.pg95_default_category_party_name(v_row.category_name)))
    order by id
    limit 1;

    if v_party_id is not null then
      insert into public.ledger_entries (
        id, branch_id, party_id, category_id, nature,
        amount, debit_amount, credit_amount,
        entry_date, period, description, expense_id, created_by
      ) values (
        gen_random_uuid(), v_row.branch_id, v_party_id, v_row.category_id,
        'Historical Bill / Expense',
        v_row.amount, v_row.amount, 0,
        v_row.expense_date, to_char(v_row.expense_date, 'YYYY-MM'),
        coalesce(v_row.description, 'Imported historical expense'),
        v_row.id, coalesce(v_row.created_by, v_actor)
      );
    end if;
  end loop;

  select count(*), coalesce(sum(amount), 0)
  into v_cb_count_after, v_cb_total_after
  from public.cashbook_entries;

  select count(*), coalesce(sum(amount), 0)
  into v_expense_count_after, v_expense_total_after
  from public.expenses;

  if v_cb_count_before <> v_cb_count_after or v_cb_total_before <> v_cb_total_after then
    raise exception 'Cashbook safety check failed: row count or total changed';
  end if;

  if v_expense_count_before <> v_expense_count_after or v_expense_total_before <> v_expense_total_after then
    raise exception 'Expense safety check failed: row count or total changed';
  end if;

  if exists (
    select 1 from public.cashbook_entries
    where branch_id is not null
      and nullif(trim(coalesce(category, '')), '') is not null
      and category_id is null
  ) then
    raise exception 'Category backfill failed: Cashbook rows remain unlinked';
  end if;

  if v_farukhnagar is not null and exists (
    select 1 from public.categories
    where branch_id = v_farukhnagar
      and (lower(name) like '%tinku%' or lower(name) like '%tinko%')
  ) then
    raise exception 'Farukhnagar salary-category merge failed';
  end if;

  raise notice 'Category ledgers linked successfully; TINKU/TINKO merged under Staff Salary; Cashbook and Expense totals unchanged.';
end;
$$;

-- Any category created later automatically receives a default ledger party.
create or replace function public.pg95_category_default_party_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.pg95_create_default_category_party(new.id, new.created_by);
  return new;
end;
$$;

drop trigger if exists pg95_category_default_party_after_insert on public.categories;
create trigger pg95_category_default_party_after_insert
after insert on public.categories
for each row execute function public.pg95_category_default_party_trigger();

-- Cashbook text categories automatically become reusable categories.
create or replace function public.pg95_cashbook_ensure_category_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.branch_id is null then return new; end if;

  if nullif(trim(coalesce(new.category, '')), '') is null and new.category_id is not null then
    select name into new.category from public.categories where id = new.category_id;
  end if;

  new.category := public.pg95_normalize_finance_category(new.category);
  new.category_id := public.pg95_ensure_finance_category(new.branch_id, new.category, new.created_by);
  return new;
end;
$$;

drop trigger if exists pg95_cashbook_ensure_category_before_write on public.cashbook_entries;
create trigger pg95_cashbook_ensure_category_before_write
before insert or update of branch_id, category, category_id
on public.cashbook_entries
for each row execute function public.pg95_cashbook_ensure_category_trigger();

-- Direct Cashbook entries stay synchronised with their category ledger.
create or replace function public.pg95_cashbook_category_ledger_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_name text;
  v_party_name text;
  v_party_id uuid;
  v_expense_id uuid;
  v_existing_id uuid;
  v_text text;
begin
  if new.category_id is null
     or new.branch_id is null
     or new.amount is null
     or new.amount <= 0
     or lower(coalesce(new.source::text, 'manual')) = 'payment'
     or coalesce(new.reference, '') like 'LEDGER|%' then
    return new;
  end if;

  select name into v_category_name from public.categories where id = new.category_id;
  if lower(trim(coalesce(v_category_name, ''))) in (
    'rent', 'security deposit', 'electricity', 'other income',
    'inter-branch settlement', 'partner account'
  ) then
    return new;
  end if;

  v_text := lower(coalesce(new.description, '') || ' ' || coalesce(new.remarks, '') || ' ' || coalesce(new.reference, ''));
  if lower(trim(v_category_name)) = 'staff salary' and position('tinko' in v_text) > 0 then
    v_party_name := 'TINKO';
  elsif lower(trim(v_category_name)) = 'staff salary' and position('tinku' in v_text) > 0 then
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
      'Automatically created from a direct Cashbook entry.', new.created_by, new.created_by
    ) returning id into v_party_id;
  end if;

  select id into v_expense_id
  from public.expenses
  where cashbook_entry_id = new.id
  order by id
  limit 1;

  select id into v_existing_id
  from public.ledger_entries
  where cashbook_entry_id = new.id
  limit 1;

  if v_existing_id is null then
    insert into public.ledger_entries (
      id, branch_id, party_id, category_id, nature,
      amount, debit_amount, credit_amount,
      entry_date, period, description, payment_mode,
      reference, remarks, cashbook_entry_id, expense_id,
      created_at, created_by
    ) values (
      gen_random_uuid(), new.branch_id, v_party_id, new.category_id,
      case
        when lower(new.type::text) = 'debit' and lower(trim(v_category_name)) = 'staff salary' then 'Salary Paid - Direct Entry'
        when lower(new.type::text) = 'debit' then 'Direct Cashbook Payment'
        else 'Cashbook Credit / Adjustment'
      end,
      new.amount,
      case when lower(new.type::text) = 'debit' then new.amount else 0 end,
      new.amount,
      new.entry_date, to_char(new.entry_date, 'YYYY-MM'),
      coalesce(new.description, 'Direct Cashbook entry'), new.payment_mode,
      new.reference, new.remarks, new.id, v_expense_id,
      coalesce(new.created_at, now()), new.created_by
    );
  else
    update public.ledger_entries
    set branch_id = new.branch_id,
        party_id = v_party_id,
        category_id = new.category_id,
        nature = case
          when lower(new.type::text) = 'debit' and lower(trim(v_category_name)) = 'staff salary' then 'Salary Paid - Direct Entry'
          when lower(new.type::text) = 'debit' then 'Direct Cashbook Payment'
          else 'Cashbook Credit / Adjustment'
        end,
        amount = new.amount,
        debit_amount = case when lower(new.type::text) = 'debit' then new.amount else 0 end,
        credit_amount = new.amount,
        entry_date = new.entry_date,
        period = to_char(new.entry_date, 'YYYY-MM'),
        description = coalesce(new.description, 'Direct Cashbook entry'),
        payment_mode = new.payment_mode,
        reference = new.reference,
        remarks = new.remarks,
        expense_id = v_expense_id
    where id = v_existing_id;
  end if;

  return new;
end;
$$;

drop trigger if exists pg95_cashbook_category_ledger_after_write on public.cashbook_entries;
create trigger pg95_cashbook_category_ledger_after_write
after insert or update of amount, type, entry_date, category, category_id, description, payment_mode, reference, remarks
on public.cashbook_entries
for each row execute function public.pg95_cashbook_category_ledger_trigger();

create or replace function public.pg95_cashbook_category_ledger_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ledger_entries where cashbook_entry_id = old.id;
  return old;
end;
$$;

drop trigger if exists pg95_cashbook_category_ledger_before_delete_trigger on public.cashbook_entries;
create trigger pg95_cashbook_category_ledger_before_delete_trigger
before delete on public.cashbook_entries
for each row execute function public.pg95_cashbook_category_ledger_before_delete();
