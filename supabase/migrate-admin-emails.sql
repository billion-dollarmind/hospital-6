-- Run in Supabase SQL Editor if admin accounts were already created as "pending"
update public.profiles
set status = 'approved',
    role = 'admin',
    approved_at = coalesce(approved_at, now())
where lower(email) in ('caleborenge08@gmail.com', 'super3email@gmail.com');
