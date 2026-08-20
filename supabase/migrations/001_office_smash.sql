-- depa TABLE TENNIS · Base schema
-- Rerunnable. Apply migrations in numeric order; 003 adds secure identity and hidden draws.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname <> 'extensions'
  ) then
    execute 'alter extension pgcrypto set schema extensions';
  end if;
end $$;
create sequence if not exists public.player_public_id_seq;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create or replace function public.is_tournament_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    exists (select 1 from public.admin_users where user_id = auth.uid())
    or exists (
      select 1 from public.admin_emails
      where email = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

grant execute on function public.is_tournament_admin() to anon, authenticated;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default (
    'DT-' || lpad(nextval('public.player_public_id_seq')::text, 2, '0')
  ),
  nickname text not null check (char_length(nickname) between 2 and 40),
  department text not null check (char_length(department) between 1 and 80),
  email text,
  avatar_url text not null,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'eliminated')),
  registered_at timestamptz not null default now()
);

-- Repair databases that were initialized with the older required-email schema.
alter table public.players alter column email drop not null;
drop index if exists public.players_email_unique;
create unique index players_email_unique
on public.players (lower(email)) where email is not null;
create unique index if not exists players_avatar_url_unique
on public.players (avatar_url);

create table if not exists public.tournament_state (
  id smallint primary key default 1 check (id = 1),
  version integer not null default 0,
  status text not null default 'registration' check (status in ('registration', 'locked')),
  registration_open boolean not null default true,
  reveal_open boolean not null default false,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint tournament_state_control_state_check check (
    not (registration_open and reveal_open)
    and (not reveal_open or (status = 'locked' and version > 0))
  )
);

-- Keep reruns compatible with installations created before registration/reveal controls.
alter table public.tournament_state
  add column if not exists registration_open boolean not null default true;
alter table public.tournament_state
  add column if not exists reveal_open boolean not null default false;

insert into public.tournament_state (id) values (1) on conflict (id) do nothing;

alter table public.admin_users enable row level security;
alter table public.admin_emails enable row level security;
alter table public.players enable row level security;
alter table public.tournament_state enable row level security;

drop policy if exists "Admin can read own role" on public.admin_users;
create policy "Admin can read own role"
on public.admin_users for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Admin can read own email role" on public.admin_emails;
create policy "Admin can read own email role"
on public.admin_emails for select to authenticated
using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "Registration is open for inserts" on public.players;
-- Player creation is granted only through register_player() in migration 003 so
-- every public record receives a hashed recovery credential atomically.

drop policy if exists "Admins can read players" on public.players;
create policy "Admins can read players"
on public.players for select to authenticated
using (public.is_tournament_admin());

drop policy if exists "Admins can update players" on public.players;
create policy "Admins can update players"
on public.players for update to authenticated
using (public.is_tournament_admin())
with check (public.is_tournament_admin());

drop policy if exists "Tournament state is public" on public.tournament_state;
create policy "Tournament state is public"
on public.tournament_state for select to anon, authenticated
using (true);

drop policy if exists "Admins control tournament state" on public.tournament_state;
-- Tournament controls are updated through the locked admin RPC in migration 003.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'player-avatars',
  'player-avatars',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can upload a player avatar" on storage.objects;
drop policy if exists "Registration-open avatar uploads" on storage.objects;
create policy "Registration-open avatar uploads"
on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'player-avatars'
  and name ~ '^pending/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif)$'
  and exists (
    select 1 from public.tournament_state
    where id = 1 and registration_open = true
  )
);

drop policy if exists "Admins can manage player avatars" on storage.objects;
create policy "Admins can manage player avatars"
on storage.objects for all to authenticated
using (bucket_id = 'player-avatars' and public.is_tournament_admin())
with check (bucket_id = 'player-avatars' and public.is_tournament_admin());

do $$
begin
  alter publication supabase_realtime add table public.tournament_state;
exception
  when duplicate_object then null;
end $$;

-- Add the email allowed to receive an admin Magic Link:
-- insert into public.admin_emails (email) values ('your-email@example.com');
