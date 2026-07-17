--  Linked staff, vendor, supplier and building-rent ledgers.
-- Existing categories remain the source of classification; parties link by category_id.

create table if not exists public.ledger_parties (
  id uuid primary key,
  branch_id uuid not null references public.branches(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  party_type text not null check (party_type in ('Staff', 'Vendor', 'Building Rent', 'Other')),
  phone text,
  joining_date date not null default current_date,
  monthly_amount numeric(12,2) not null default 0 check (monthly_amount >= 0),
  due_day integer not null default 1 check (due_day between 1 and 31),
  status text not null default 'Active' check (status in ('Active', 'Left', 'Inactive')),
  left_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ledger_entries (
  id uuid primary key,
  branch_id uuid not null references public.branches(id) on delete cascade,
  party_id uuid not null references public.ledger_parties(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  nature text not null,
  amount numeric(12,2) not null check (amount > 0),
  debit_amount numeric(12,2) not null default 0 check (debit_amount >= 0),
  credit_amount numeric(12,2) not null default 0 check (credit_amount >= 0),
  entry_date date not null,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  description text,
  payment_mode text,
  reference text,
  remarks text,
  cashbook_entry_id uuid references public.cashbook_entries(id) on delete set null,
  expense_id uuid references public.expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (debit_amount > 0 or credit_amount > 0)
);

create index if not exists ledger_parties_branch_category_idx
  on public.ledger_parties(branch_id, category_id, status, name);
create index if not exists ledger_entries_party_date_idx
  on public.ledger_entries(party_id, entry_date desc, created_at desc);
create index if not exists ledger_entries_branch_period_idx
  on public.ledger_entries(branch_id, period, category_id);
create unique index if not exists ledger_entries_unique_cashbook_link_idx
  on public.ledger_entries(cashbook_entry_id)
  where cashbook_entry_id is not null;
create unique index if not exists ledger_entries_unique_monthly_due_idx
  on public.ledger_entries(party_id, period, nature)
  where nature in ('Salary Due', 'Rent Due');

create or replace function public.pg95_can_access_branch(p_branch_id uuid)
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
        or exists (
          select 1
          from public.branch_assignments assignment
          where assignment.user_id = auth.uid()
            and assignment.branch_id = p_branch_id
        )
      )
  );
$$;

revoke all on function public.pg95_can_access_branch(uuid) from public;
grant execute on function public.pg95_can_access_branch(uuid) to authenticated;

alter table public.ledger_parties enable row level security;
alter table public.ledger_entries enable row level security;

drop policy if exists ledger_parties_branch_access on public.ledger_parties;
create policy ledger_parties_branch_access
on public.ledger_parties
for all
to authenticated
using (public.pg95_can_access_branch(branch_id))
with check (public.pg95_can_access_branch(branch_id));

drop policy if exists ledger_entries_branch_access on public.ledger_entries;
create policy ledger_entries_branch_access
on public.ledger_entries
for all
to authenticated
using (public.pg95_can_access_branch(branch_id))
with check (public.pg95_can_access_branch(branch_id));

create or replace function public.delete_ledger_cashbook_entry(p_cashbook_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.ledger_entries%rowtype;
  v_expense_id uuid;
begin
  select * into v_entry
  from public.ledger_entries
  where cashbook_entry_id = p_cashbook_id
  for update;

  if not found then
    raise exception 'Linked ledger entry not found' using errcode = 'P0002';
  end if;
  if not public.pg95_can_access_branch(v_entry.branch_id) then
    raise exception 'You do not have permission to delete this ledger transaction' using errcode = '42501';
  end if;

  v_expense_id := v_entry.expense_id;
  delete from public.ledger_entries where id = v_entry.id;
  if v_expense_id is not null then
    delete from public.expenses where id = v_expense_id;
  end if;
  delete from public.cashbook_entries where id = p_cashbook_id;

  return jsonb_build_object(
    'cashbook_id', p_cashbook_id,
    'linked_entity_deleted', 'ledger_entry'
  );
end;
$$;

revoke all on function public.delete_ledger_cashbook_entry(uuid) from public;
grant execute on function public.delete_ledger_cashbook_entry(uuid) to authenticated;
grant select, insert, update, delete on public.ledger_parties to authenticated;
grant select, insert, update, delete on public.ledger_entries to authenticated;
