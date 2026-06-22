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

-- Change this email to your admin address (must match config.js ADMIN_EMAIL)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    admin_email constant text := 'caleborenge08@gmail.com';
begin
    insert into public.profiles (id, email, status, role)
    values (
        new.id,
        new.email,
        case when lower(new.email) = lower(admin_email) then 'approved' else 'pending' end,
        case when lower(new.email) = lower(admin_email) then 'admin' else 'user' end
    );
    return new;
end;
$$;

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
