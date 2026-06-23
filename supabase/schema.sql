-- Run this in Supabase Dashboard → SQL Editor (once per project)
-- Kairon: email/password auth with admin approval for new users

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    email text not null,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    role text not null default 'user' check (role in ('admin', 'user')),
    created_at timestamptz not null default now(),
    approved_at timestamptz,
    approved_by uuid references auth.users (id)
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
    on public.profiles for select
    using (auth.uid() = id);

create policy "Admins can read all profiles"
    on public.profiles for select
    using (
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin' and p.status = 'approved'
        )
    );

-- Admin emails: auto-approved as admin on sign-up (no approval needed)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    admin_emails text[] := array[
        'caleborenge08@gmail.com',
        'super3email@gmail.com'
    ];
    normalized_email text := lower(trim(new.email));
    is_admin boolean := normalized_email = any(admin_emails);
begin
    insert into public.profiles (id, email, status, role, approved_at)
    values (
        new.id,
        new.email,
        case when is_admin then 'approved' else 'pending' end,
        case when is_admin then 'admin' else 'user' end,
        case when is_admin then now() else null end
    );
    return new;
end;
$$;

-- Fixes existing admin accounts that were stuck as pending
create or replace function public.sync_listed_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    admin_emails text[] := array[
        'caleborenge08@gmail.com',
        'super3email@gmail.com'
    ];
    user_email text := lower(trim(auth.jwt() ->> 'email'));
begin
    if user_email = any(admin_emails) then
        update public.profiles
        set status = 'approved',
            role = 'admin',
            approved_at = coalesce(approved_at, now())
        where id = auth.uid();
    end if;
end;
$$;

grant execute on function public.sync_listed_admin() to authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

create or replace function public.approve_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin' and status = 'approved'
    ) then
        raise exception 'Not authorized';
    end if;
    update public.profiles
    set status = 'approved', approved_at = now(), approved_by = auth.uid()
    where id = target_user_id and status = 'pending';
end;
$$;

create or replace function public.reject_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin' and status = 'approved'
    ) then
        raise exception 'Not authorized';
    end if;
    update public.profiles
    set status = 'rejected', approved_at = now(), approved_by = auth.uid()
    where id = target_user_id and status = 'pending';
end;
$$;

grant execute on function public.approve_user(uuid) to authenticated;
grant execute on function public.reject_user(uuid) to authenticated;
