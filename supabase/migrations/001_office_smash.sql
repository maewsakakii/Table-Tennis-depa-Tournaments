-- OFFICE SMASH · Phase 1–2
-- Run this file once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

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
set search_path = public
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

create table if not exists public.tournament_state (
  id smallint primary key default 1 check (id = 1),
  version integer not null default 0,
  status text not null default 'registration' check (status in ('registration', 'drawing', 'ready')),
  roster jsonb not null default '[]'::jsonb,
  pairs jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);

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
create policy "Registration is open for inserts"
on public.players for insert to anon, authenticated
with check (
  status = 'waiting'
  and exists (select 1 from public.tournament_state where id = 1 and status = 'registration')
);

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
create policy "Admins control tournament state"
on public.tournament_state for update to authenticated
using (public.is_tournament_admin())
with check (public.is_tournament_admin());

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
create policy "Anyone can upload a player avatar"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'player-avatars');

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
