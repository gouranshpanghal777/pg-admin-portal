-- Auto-set updated_at on UPDATE for branches and other key tables.
-- branches.updated_at has default now() for INSERT but no trigger for UPDATE.
-- Without this trigger, upserts via persistAppData would leave updated_at stale.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Branches
drop trigger if exists set_updated_at on public.branches;
create trigger set_updated_at
  before update on public.branches
  for each row
  execute function public.set_updated_at();

-- Rooms
drop trigger if exists set_updated_at on public.rooms;
create trigger set_updated_at
  before update on public.rooms
  for each row
  execute function public.set_updated_at();

-- Cashbook entries
drop trigger if exists set_updated_at on public.cashbook_entries;
create trigger set_updated_at
  before update on public.cashbook_entries
  for each row
  execute function public.set_updated_at();

-- Inventory items
drop trigger if exists set_updated_at on public.inventory_items;
create trigger set_updated_at
  before update on public.inventory_items
  for each row
  execute function public.set_updated_at();

-- Tenants
drop trigger if exists set_updated_at on public.tenants;
create trigger set_updated_at
  before update on public.tenants
  for each row
  execute function public.set_updated_at();
