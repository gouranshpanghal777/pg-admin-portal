-- Convert all existing tenant names to uppercase
-- This is safe: only modifies the name field, preserves all other data.
update public.tenants set name = upper(trim(name));
