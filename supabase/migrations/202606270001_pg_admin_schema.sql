create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'staff');
create type public.entry_type as enum ('Credit', 'Debit');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  phone text,
  role public.app_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  floors integer,
  notes text,
  contact text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_members (
  id uuid primary key references public.profiles(id) on delete cascade,
  email text,
  username text unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.branch_assignments (
  user_id uuid references public.profiles(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);

create table public.staff_permissions (
  user_id uuid references public.profiles(id) on delete cascade,
  permission text not null,
  allowed boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, permission)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  number text not null, floor integer not null default 1, type text not null, beds integer not null check (beds > 0),
  rent numeric(12,2) not null default 0, electricity text not null default 'Included', electricity_amount numeric(12,2) not null default 0,
  status text not null default 'Vacant', notes text, created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(branch_id, number)
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null, phone text not null, email text, room_id uuid not null references public.rooms(id), bed_no integer not null default 1,
  monthly_rent numeric(12,2) not null, security numeric(12,2) not null default 0, electricity text not null default 'Included',
  electricity_amount numeric(12,2) not null default 0, joining_date date not null, due_date date not null, status text not null default 'Active',
  id_proof text, paid_this_month numeric(12,2) not null default 0, notice jsonb, left_details jsonb,
  created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id), number text not null unique, period text not null, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id), amount numeric(12,2) not null check (amount > 0), payment_date date not null,
  month text not null, status text not null, payment_mode text not null default 'Cash', invoice_id uuid references public.invoices(id),
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table public.cashbook_entries (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  type public.entry_type not null, amount numeric(12,2) not null check (amount >= 0), description text not null, entry_date date not null,
  source text not null default 'Manual', linked_id uuid, created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  category text not null, description text not null, amount numeric(12,2) not null check (amount >= 0), expense_date date not null,
  vendor text, cashbook_entry_id uuid references public.cashbook_entries(id), created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null, category text not null, stock numeric(12,2) not null default 0, unit text not null, reorder_at numeric(12,2) not null default 0,
  last_purchase date, created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(branch_id, name)
);

create table public.inventory_purchases (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id), quantity numeric(12,2) not null check (quantity > 0), unit_cost numeric(12,2) not null default 0,
  purchase_date date not null, note text, expense_id uuid references public.expenses(id), cashbook_entry_id uuid references public.cashbook_entries(id),
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  title text not null, status text not null default 'Open', room_id uuid not null references public.rooms(id), tenant_id uuid references public.tenants(id),
  category text not null, priority text not null, raised_date date not null, assigned_to text, description text, resolution jsonb,
  created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(), branch_id uuid references public.branches(id) on delete set null, branch_name text not null,
  user_id uuid not null references public.profiles(id), user_name text not null, user_role public.app_role not null, module text not null,
  action_type text not null, description text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin' and active) $$;

create or replace function public.has_branch_access(target uuid) returns boolean language sql stable security definer set search_path = public
as $$ select public.is_admin() or exists(select 1 from public.branch_assignments where user_id = auth.uid() and branch_id = target) $$;

create or replace function public.has_permission(code text) returns boolean language sql stable security definer set search_path = public
as $$ select public.is_admin() or exists(select 1 from public.staff_permissions where user_id = auth.uid() and permission = code and allowed) $$;

create or replace function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = public
as $$ begin insert into public.profiles(id, name, role) values(new.id, coalesce(new.raw_user_meta_data->>'name',''), coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'staff')); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.branches enable row level security;
alter table public.staff_members enable row level security;
alter table public.branch_assignments enable row level security;
alter table public.staff_permissions enable row level security;

create policy profiles_self_or_admin on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_admin_write on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy branches_read on public.branches for select using (public.has_branch_access(id));
create policy branches_admin_write on public.branches for all using (public.is_admin()) with check (public.is_admin());
create policy staff_admin_all on public.staff_members for all using (public.is_admin()) with check (public.is_admin());
create policy assignments_self_or_admin on public.branch_assignments for select using (user_id = auth.uid() or public.is_admin());
create policy assignments_admin_write on public.branch_assignments for all using (public.is_admin()) with check (public.is_admin());
create policy permissions_self_or_admin on public.staff_permissions for select using (user_id = auth.uid() or public.is_admin());
create policy permissions_admin_write on public.staff_permissions for all using (public.is_admin()) with check (public.is_admin());

do $$ declare t text; begin
  foreach t in array array['rooms','tenants','payments','cashbook_entries','expenses','inventory_items','inventory_purchases','maintenance_tickets','invoices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.has_branch_access(branch_id))', t || '_read', t);
  end loop;
end $$;

create policy rooms_admin_write on public.rooms for all using (public.is_admin()) with check (public.is_admin());
create policy rooms_staff_insert on public.rooms for insert with check (false);
create policy tenants_admin_write on public.tenants for all using (public.is_admin()) with check (public.is_admin());
create policy tenants_staff_insert on public.tenants for insert with check (public.has_branch_access(branch_id) and public.has_permission('admit_tenant') and created_by = auth.uid());
create policy tenants_staff_update on public.tenants for update using (public.has_branch_access(branch_id) and (public.has_permission('move_tenant') or public.has_permission('vacate_tenant') or public.has_permission('add_payment'))) with check (public.has_branch_access(branch_id));
create policy payments_admin_write on public.payments for all using (public.is_admin()) with check (public.is_admin());
create policy payments_staff_insert on public.payments for insert with check (public.has_branch_access(branch_id) and public.has_permission('add_payment') and created_by = auth.uid());
create policy cashbook_admin_write on public.cashbook_entries for all using (public.is_admin()) with check (public.is_admin());
create policy cashbook_staff_insert on public.cashbook_entries for insert with check (public.has_branch_access(branch_id) and created_by = auth.uid() and (public.has_permission('add_cashbook') or (source = 'Payment' and public.has_permission('add_payment')) or (source = 'Expense' and public.has_permission('add_expense')) or (source = 'Inventory' and public.has_permission('add_inventory')) or (source = 'Maintenance' and public.has_permission('resolve_maintenance'))));
create policy expenses_admin_write on public.expenses for all using (public.is_admin()) with check (public.is_admin());
create policy expenses_staff_insert on public.expenses for insert with check (public.has_branch_access(branch_id) and created_by = auth.uid() and (public.has_permission('add_expense') or (category = 'Inventory' and public.has_permission('add_inventory')) or (category = 'Maintenance' and public.has_permission('resolve_maintenance'))));
create policy inventory_items_admin_write on public.inventory_items for all using (public.is_admin()) with check (public.is_admin());
create policy inventory_items_staff_update on public.inventory_items for update using (public.has_branch_access(branch_id) and public.has_permission('add_inventory')) with check (public.has_branch_access(branch_id));
create policy inventory_items_staff_insert on public.inventory_items for insert with check (public.has_branch_access(branch_id) and public.has_permission('add_inventory') and created_by = auth.uid());
create policy inventory_purchases_admin_write on public.inventory_purchases for all using (public.is_admin()) with check (public.is_admin());
create policy inventory_purchases_staff_insert on public.inventory_purchases for insert with check (public.has_branch_access(branch_id) and public.has_permission('add_inventory') and created_by = auth.uid());
create policy tickets_admin_write on public.maintenance_tickets for all using (public.is_admin()) with check (public.is_admin());
create policy tickets_staff_insert on public.maintenance_tickets for insert with check (public.has_branch_access(branch_id) and public.has_permission('create_maintenance') and created_by = auth.uid());
create policy tickets_staff_update on public.maintenance_tickets for update using (public.has_branch_access(branch_id) and public.has_permission('resolve_maintenance')) with check (public.has_branch_access(branch_id));
create policy invoices_admin_write on public.invoices for all using (public.is_admin()) with check (public.is_admin());
create policy invoices_staff_insert on public.invoices for insert with check (public.has_branch_access(branch_id) and created_by = auth.uid());
create policy activity_read on public.activity_logs for select using (public.is_admin() or user_id = auth.uid());
create policy activity_insert on public.activity_logs for insert with check (user_id = auth.uid() and (branch_id is null or public.has_branch_access(branch_id)));

create index on public.tenants(branch_id, status);
create index on public.payments(branch_id, payment_date);
create index on public.cashbook_entries(branch_id, entry_date);
create index on public.maintenance_tickets(branch_id, status);
create index on public.activity_logs(branch_id, created_at desc);
