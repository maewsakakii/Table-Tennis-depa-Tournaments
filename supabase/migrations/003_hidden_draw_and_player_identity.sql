-- depa TABLE TENNIS · Hidden draw and recoverable player identity
-- Safe to run repeatedly after 001/002. Existing players are preserved.

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

alter table public.players add column if not exists public_id text;
alter table public.players alter column public_id set default (
  'DT-' || lpad(nextval('public.player_public_id_seq')::text, 2, '0')
);

do $$
declare
  player_row record;
  next_number bigint;
  highest_number bigint;
begin
  for player_row in
    select id from public.players where public_id is null order by registered_at, id
  loop
    next_number := nextval('public.player_public_id_seq');
    while exists (select 1 from public.players where public_id = 'DT-' || lpad(next_number::text, 2, '0')) loop
      next_number := nextval('public.player_public_id_seq');
    end loop;
    update public.players
    set public_id = 'DT-' || lpad(next_number::text, 2, '0')
    where id = player_row.id;
  end loop;

  select coalesce(max(substring(public_id from '^DT-([0-9]+)$')::bigint), 0)
  into highest_number
  from public.players;
  if highest_number = 0 then
    perform setval('public.player_public_id_seq', 1, false);
  else
    perform setval('public.player_public_id_seq', highest_number, true);
  end if;
end $$;

alter table public.players alter column public_id set not null;
create unique index if not exists players_public_id_unique on public.players (public_id);
create unique index if not exists players_avatar_url_unique on public.players (avatar_url);

alter table public.tournament_state add column if not exists registration_open boolean not null default true;
alter table public.tournament_state add column if not exists reveal_open boolean not null default false;
alter table public.tournament_state drop constraint if exists tournament_state_status_check;
update public.tournament_state
set
  registration_open = case when status in ('drawing', 'ready') then false else registration_open end,
  reveal_open = case when status = 'ready' then true else reveal_open end,
  status = case when status in ('drawing', 'ready') then 'locked' else status end
where id = 1;
alter table public.tournament_state alter column status set default 'registration';
alter table public.tournament_state
  add constraint tournament_state_status_check check (status in ('registration', 'locked'));
update public.tournament_state
set reveal_open = false
where reveal_open = true
  and (registration_open = true or status <> 'locked' or version < 1);
alter table public.tournament_state
  drop constraint if exists tournament_state_control_state_check;
alter table public.tournament_state
  add constraint tournament_state_control_state_check check (
    not (registration_open and reveal_open)
    and (not reveal_open or (status = 'locked' and version > 0))
  );
alter table public.tournament_state drop column if exists roster;
alter table public.tournament_state drop column if exists pairs;

create table if not exists public.player_credentials (
  player_id uuid primary key references public.players(id) on delete cascade,
  identity_hash bytea not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.private_matches (
  id uuid primary key default gen_random_uuid(),
  draw_version integer not null,
  player1_id uuid not null references public.players(id) on delete cascade,
  player2_id uuid references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (player2_id is null or player2_id <> player1_id)
);
create unique index if not exists private_matches_player1_draw_unique
  on public.private_matches (draw_version, player1_id);
create unique index if not exists private_matches_player2_draw_unique
  on public.private_matches (draw_version, player2_id) where player2_id is not null;

alter table public.player_credentials enable row level security;
alter table public.private_matches enable row level security;
revoke all on table public.player_credentials from anon, authenticated;
revoke all on table public.private_matches from anon, authenticated;
drop policy if exists "Admins control tournament state" on public.tournament_state;

drop policy if exists "Registration is open for inserts" on public.players;
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

create or replace function public.register_player(
  p_nickname text,
  p_department text,
  p_avatar_url text,
  p_identity_token text
)
returns table (
  public_id text,
  nickname text,
  department text,
  email text,
  avatar_url text,
  registered_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  created_player public.players%rowtype;
  registration_is_open boolean;
  request_host text;
  expected_prefix text;
  avatar_filename text;
  avatar_object_name text;
begin
  select ts.registration_open into registration_is_open
  from public.tournament_state ts
  where ts.id = 1
  for update;
  if not coalesce(registration_is_open, false) then
    raise exception 'registration is closed';
  end if;

  if p_identity_token !~ '^DT-[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){5}$' then
    raise exception 'invalid recovery token';
  end if;
  request_host := coalesce(
    current_setting('request.headers', true)::jsonb ->> 'host',
    current_setting('request.headers', true)::jsonb ->> 'x-forwarded-host'
  );
  expected_prefix := 'https://' || request_host || '/storage/v1/object/public/player-avatars/pending/';
  if request_host is null or left(p_avatar_url, char_length(expected_prefix)) <> expected_prefix then
    raise exception 'avatar URL must belong to this Supabase project';
  end if;
  avatar_filename := substring(p_avatar_url from char_length(expected_prefix) + 1);
  if avatar_filename !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif)$' then
    raise exception 'invalid avatar object path';
  end if;
  avatar_object_name := 'pending/' || avatar_filename;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'player-avatars' and o.name = avatar_object_name
  ) then
    raise exception 'avatar object does not exist';
  end if;
  if exists (select 1 from public.players p where p.avatar_url = p_avatar_url) then
    raise exception 'avatar object is already registered';
  end if;

  insert into public.players (nickname, department, avatar_url, status)
  values (btrim(p_nickname), btrim(p_department), p_avatar_url, 'waiting')
  returning * into created_player;

  insert into public.player_credentials (player_id, identity_hash)
  values (created_player.id, extensions.digest(p_identity_token, 'sha256'));

  return query select
    created_player.public_id,
    created_player.nickname,
    created_player.department,
    created_player.email,
    created_player.avatar_url,
    created_player.registered_at;
end;
$$;

create or replace function public.restore_player(p_identity_token text)
returns table (
  public_id text,
  nickname text,
  department text,
  email text,
  avatar_url text,
  registered_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p.public_id, p.nickname, p.department, p.email, p.avatar_url, p.registered_at
  from public.player_credentials c
  join public.players p on p.id = c.player_id
  where c.identity_hash = extensions.digest(p_identity_token, 'sha256')
  limit 1;
$$;

create or replace function public.admin_generate_hidden_draw()
returns table (draw_version integer, match_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  player_ids uuid[];
  next_version integer;
  index_number integer;
begin
  if not public.is_tournament_admin() then
    raise exception 'admin access required';
  end if;

  select ts.version + 1 into next_version
  from public.tournament_state ts where ts.id = 1 for update;

  select coalesce(array_agg(p.id order by extensions.gen_random_uuid()), array[]::uuid[])
  into player_ids
  from public.players p;
  if coalesce(array_length(player_ids, 1), 0) < 2 then
    raise exception 'at least two players are required';
  end if;

  delete from public.private_matches m
  where m.draw_version <= next_version;
  index_number := 1;
  while index_number <= array_length(player_ids, 1) loop
    insert into public.private_matches (draw_version, player1_id, player2_id)
    values (
      next_version,
      player_ids[index_number],
      case when index_number + 1 <= array_length(player_ids, 1)
        then player_ids[index_number + 1] else null end
    );
    index_number := index_number + 2;
  end loop;

  update public.tournament_state
  set version = next_version,
      status = 'locked',
      registration_open = false,
      reveal_open = false,
      started_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = 1;

  return query select next_version, count(*)::integer
  from public.private_matches pm where pm.draw_version = next_version;
end;
$$;

create or replace function public.admin_get_hidden_draw()
returns table (
  draw_version integer,
  match_id uuid,
  player1_public_id text,
  player2_public_id text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if not public.is_tournament_admin() then
    raise exception 'admin access required';
  end if;
  return query
  select m.draw_version, m.id, p1.public_id, p2.public_id
  from public.private_matches m
  join public.players p1 on p1.id = m.player1_id
  left join public.players p2 on p2.id = m.player2_id
  order by m.created_at, m.id;
end;
$$;

create or replace function public.reveal_my_opponent(
  p_public_id text,
  p_identity_token text
)
returns table (
  match_id uuid,
  opponent_public_id text,
  opponent_nickname text,
  opponent_department text,
  opponent_avatar_url text,
  is_bye boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  authenticated_player_id uuid;
  current_match_id uuid;
  opponent_id uuid;
begin
  if not exists (
    select 1 from public.tournament_state
    where id = 1 and reveal_open = true
  ) then
    raise exception 'opponent reveal is closed';
  end if;

  select p.id into authenticated_player_id
  from public.players p
  join public.player_credentials c on c.player_id = p.id
  where p.public_id = p_public_id
    and c.identity_hash = extensions.digest(p_identity_token, 'sha256')
  limit 1;
  if authenticated_player_id is null then
    raise exception 'invalid player identity';
  end if;

  select m.id,
    case when m.player1_id = authenticated_player_id then m.player2_id else m.player1_id end
  into current_match_id, opponent_id
  from public.private_matches m
  join public.tournament_state s on s.version = m.draw_version and s.id = 1
  where m.player1_id = authenticated_player_id or m.player2_id = authenticated_player_id
  limit 1;
  if current_match_id is null then
    return;
  end if;

  return query
  select current_match_id, p.public_id, p.nickname, p.department, p.avatar_url, opponent_id is null
  from (select 1) seed
  left join public.players p on p.id = opponent_id;
end;
$$;

create or replace function public.admin_issue_player_recovery(p_public_id text)
returns table (
  player_public_id text,
  recovery_code text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_player_id uuid;
  token_hex text;
  issued_code text;
begin
  if not public.is_tournament_admin() then
    raise exception 'admin access required';
  end if;

  select p.id into target_player_id
  from public.players p
  where p.public_id = p_public_id
  for update;
  if target_player_id is null then
    raise exception 'player not found';
  end if;

  token_hex := upper(pg_catalog.encode(extensions.gen_random_bytes(15), 'hex'));
  issued_code := 'DT-RCV-'
    || substring(token_hex from 1 for 5) || '-'
    || substring(token_hex from 6 for 5) || '-'
    || substring(token_hex from 11 for 5) || '-'
    || substring(token_hex from 16 for 5) || '-'
    || substring(token_hex from 21 for 5) || '-'
    || substring(token_hex from 26 for 5);

  insert into public.player_credentials (player_id, identity_hash)
  values (target_player_id, extensions.digest(issued_code, 'sha256'))
  on conflict (player_id) do update
    set identity_hash = excluded.identity_hash,
        created_at = pg_catalog.now();

  return query select p_public_id, issued_code;
end;
$$;

create or replace function public.admin_update_tournament_controls(
  p_registration_open boolean,
  p_reveal_open boolean
)
returns table (
  version integer,
  status text,
  registration_open boolean,
  reveal_open boolean,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_state public.tournament_state%rowtype;
begin
  if not public.is_tournament_admin() then
    raise exception 'admin access required';
  end if;

  select ts.* into current_state
  from public.tournament_state ts
  where ts.id = 1
  for update;
  if p_registration_open and p_reveal_open then
    raise exception 'registration and reveal cannot both be open';
  end if;
  if p_reveal_open and (
    current_state.status <> 'locked'
    or current_state.version < 1
    or not exists (
      select 1 from public.private_matches m
      where m.draw_version = current_state.version
    )
  ) then
    raise exception 'a current hidden draw is required before reveal';
  end if;

  update public.tournament_state ts
  set registration_open = p_registration_open,
      reveal_open = p_reveal_open,
      updated_at = pg_catalog.now()
  where ts.id = 1
  returning ts.* into current_state;

  return query select
    current_state.version,
    current_state.status,
    current_state.registration_open,
    current_state.reveal_open,
    current_state.started_at;
end;
$$;

revoke all on function public.register_player(text, text, text, text) from public;
revoke all on function public.restore_player(text) from public;
revoke all on function public.admin_generate_hidden_draw() from public;
revoke all on function public.admin_get_hidden_draw() from public;
revoke all on function public.reveal_my_opponent(text, text) from public;
revoke all on function public.admin_issue_player_recovery(text) from public;
revoke all on function public.admin_update_tournament_controls(boolean, boolean) from public;
grant execute on function public.register_player(text, text, text, text) to anon, authenticated;
grant execute on function public.restore_player(text) to anon, authenticated;
grant execute on function public.reveal_my_opponent(text, text) to anon, authenticated;
grant execute on function public.admin_generate_hidden_draw() to authenticated;
grant execute on function public.admin_get_hidden_draw() to authenticated;
grant execute on function public.admin_issue_player_recovery(text) to authenticated;
grant execute on function public.admin_update_tournament_controls(boolean, boolean) to authenticated;
