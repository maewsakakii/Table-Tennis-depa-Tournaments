-- OFFICE SMASH · Phase 1–2
-- Run this file once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_tournament_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

grant execute on function public.is_tournament_admin() to anon, authenticated;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 2 and 40),
  department text not null check (char_length(department) between 1 and 80),
  email text not null,
  avatar_url text not null,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'eliminated')),
  registered_at timestamptz not null default now()
);

create unique index if not exists players_email_unique on public.players (lower(email));

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
alter table public.players enable row level security;
alter table public.tournament_state enable row level security;

create policy "Admin can read own role"
on public.admin_users for select to authenticated
using (user_id = auth.uid());

create policy "Registration is open for inserts"
on public.players for insert to anon, authenticated
with check (
  status = 'waiting'
  and exists (select 1 from public.tournament_state where id = 1 and status = 'registration')
);

create policy "Admins can read players"
on public.players for select to authenticated
using (public.is_tournament_admin());

create policy "Admins can update players"
on public.players for update to authenticated
using (public.is_tournament_admin())
with check (public.is_tournament_admin());

create policy "Tournament state is public"
on public.tournament_state for select to anon, authenticated
using (true);

create policy "Admins control tournament state"
on public.tournament_state for update to authenticated
using (public.is_tournament_admin())
with check (public.is_tournament_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'player-avatars',
  'player-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Anyone can upload a player avatar"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'player-avatars');

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

-- After creating an admin in Authentication > Users, promote them with:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'admin@your-company.com';
