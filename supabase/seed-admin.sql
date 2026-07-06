-- Run after creating the owner in Supabase Authentication > Users.
-- Replace the email before running.
update public.profiles p
set role = 'admin', active = true
from auth.users u
where p.id = u.id and u.email = 'gouranshpanghal777@gmail.com';
