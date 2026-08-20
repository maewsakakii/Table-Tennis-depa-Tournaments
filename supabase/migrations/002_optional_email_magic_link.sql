-- Upgrade an existing Phase 2 database without resetting player data.

alter table public.players alter column email drop not null;
drop index if exists public.players_email_unique;
create unique index players_email_unique
on public.players (lower(email)) where email is not null;

create table if not exists public.admin_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

alter table public.admin_emails enable row level security;

drop policy if exists "Admin can read own email role" on public.admin_emails;
create policy "Admin can read own email role"
on public.admin_emails for select to authenticated
using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

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

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id = 'player-avatars';

-- Replace this with the organizer's real email, then run once:
-- insert into public.admin_emails (email) values ('your-email@example.com')
-- on conflict (email) do nothing;
