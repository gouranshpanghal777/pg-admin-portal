-- Create categories table with stable UUID IDs for rename-safe category references
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique(branch_id, name)
);

alter table public.categories enable row level security;
drop policy if exists categories_select on public.categories cascade;
create policy categories_select on public.categories for select using (public.has_branch_access(branch_id));
create policy categories_insert on public.categories for insert with check (public.is_admin());
create policy categories_update on public.categories for update using (public.is_admin()) with check (public.is_admin());
create policy categories_delete on public.categories for delete using (public.is_admin());

-- Add category_id to cashbook_entries and expenses for stable cross-referencing
alter table public.cashbook_entries add column if not exists category_id uuid references public.categories(id) on delete set null;
alter table public.expenses add column if not exists category_id uuid references public.categories(id) on delete set null;

-- Backfill categories from existing unique text values across both tables
insert into public.categories (id, branch_id, name)
select gen_random_uuid(), branch_id, category
from (
  select distinct branch_id, category from public.cashbook_entries
  where category is not null and category != '' and category != 'Uncategorized'
  union
  select distinct branch_id, category from public.expenses
  where category is not null and category != ''
) as cats
on conflict (branch_id, name) do nothing;

-- Link existing cashbook entries to their category IDs
update public.cashbook_entries ce
set category_id = cat.id
from public.categories cat
where ce.branch_id = cat.branch_id
  and ce.category = cat.name
  and ce.category_id is null
  and ce.category is not null
  and ce.category != ''
  and ce.category != 'Uncategorized';

-- Link existing expenses to their category IDs
update public.expenses e
set category_id = cat.id
from public.categories cat
where e.branch_id = cat.branch_id
  and e.category = cat.name
  and e.category_id is null
  and e.category is not null
  and e.category != '';
