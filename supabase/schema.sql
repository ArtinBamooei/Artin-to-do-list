-- Supabase SQL setup for Artin To-do List authentication.
-- Run in Supabase SQL Editor. Review before applying to an existing project.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-zA-Z0-9_-]{3,32}$'),
  role text not null default 'user'
    check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon;
revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_username text;
begin
  new_username := coalesce(
    new.raw_user_meta_data ->> 'username',
    split_part(new.email, '@', 1)
  );

  if new_username !~ '^[a-zA-Z0-9_-]{3,32}$' then
    raise exception 'Invalid username';
  end if;

  insert into public.profiles (id, username, role)
  values (new.id, new_username, 'user');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- After creating your own initial account in Supabase Auth, promote ONLY that
-- exact account to admin from the SQL Editor. Replace the username below.
-- update public.profiles set role = 'admin' where username = 'YOUR_ADMIN_USERNAME';
