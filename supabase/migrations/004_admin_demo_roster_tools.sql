-- depa TABLE TENNIS · Admin-only demo roster tools
-- Rerunnable. Apply after 003_hidden_draw_and_player_identity.sql.

alter table public.players
  add column if not exists is_demo boolean not null default false;
alter table public.players
  add column if not exists demo_slot smallint;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'players_demo_slot_check'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_demo_slot_check check (
        (is_demo and demo_slot between 1 and 10)
        or (not is_demo and demo_slot is null)
      );
  end if;
end $$;

create unique index if not exists players_demo_slot_unique
  on public.players (demo_slot) where is_demo;

create or replace function public.admin_fill_demo_players()
returns table (created_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  slot_number integer;
  inserted_count integer := 0;
  demo_names text[] := array['พี่แอม','นัท','ปิง','เจ','มุก','ต้น','แพรว','บอส','ฟ้า','นนท์'];
  demo_departments text[] := array['การตลาด','ไอที / ผลิตภัณฑ์','ฝ่ายขาย','ปฏิบัติการ','การตลาด','ไอที / ผลิตภัณฑ์','ฝ่ายขาย','ปฏิบัติการ','กลยุทธ์องค์กร','ทรัพยากรบุคคล'];
  current_state public.tournament_state%rowtype;
begin
  if not public.is_tournament_admin() then
    raise exception 'admin access required';
  end if;

  -- Serialize roster changes with registration and draw operations.
  select ts.* into current_state
  from public.tournament_state ts
  where ts.id = 1
  for update;

  for slot_number in 1..10 loop
    insert into public.players (
      nickname, department, avatar_url, status, is_demo, demo_slot
    )
    select
      demo_names[slot_number],
      demo_departments[slot_number],
      '/demo-avatars/demo-' || lpad(slot_number::text, 2, '0') || '.svg',
      'waiting',
      true,
      slot_number
    where not exists (
      select 1 from public.players p
      where p.is_demo and p.demo_slot = slot_number
    )
    on conflict do nothing;
    inserted_count := inserted_count + case when found then 1 else 0 end;
  end loop;

  if inserted_count > 0 then
    delete from public.private_matches;
    update public.tournament_state ts
    set version = ts.version + 1,
        status = case when ts.registration_open then 'registration' else 'locked' end,
        reveal_open = false,
        started_at = null,
        updated_at = pg_catalog.now()
    where ts.id = 1;
  end if;

  return query select inserted_count;
end;
$$;

create or replace function public.admin_delete_player(p_public_id text)
returns table (
  deleted_public_id text,
  deleted_avatar_url text,
  deleted_is_demo boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_player public.players%rowtype;
  current_state public.tournament_state%rowtype;
begin
  if not public.is_tournament_admin() then
    raise exception 'admin access required';
  end if;

  select ts.* into current_state
  from public.tournament_state ts
  where ts.id = 1
  for update;

  select p.* into target_player
  from public.players p
  where p.public_id = p_public_id
  for update;
  if target_player.id is null then
    raise exception 'player not found';
  end if;

  -- Clear every assignment, not only the cascading row, because the roster changed.
  delete from public.private_matches;
  delete from public.players where id = target_player.id;
  update public.tournament_state ts
  set version = ts.version + 1,
      status = case when ts.registration_open then 'registration' else 'locked' end,
      reveal_open = false,
      started_at = null,
      updated_at = pg_catalog.now()
  where ts.id = 1;

  return query select target_player.public_id, target_player.avatar_url, target_player.is_demo;
end;
$$;

-- Reopening registration always invalidates an older hidden draw.
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

  if p_registration_open and not current_state.registration_open then
    delete from public.private_matches;
    update public.tournament_state ts
    set version = ts.version + 1,
        status = 'registration',
        registration_open = true,
        reveal_open = false,
        started_at = null,
        updated_at = pg_catalog.now()
    where ts.id = 1
    returning ts.* into current_state;
  else
    update public.tournament_state ts
    set registration_open = p_registration_open,
        reveal_open = p_reveal_open,
        updated_at = pg_catalog.now()
    where ts.id = 1
    returning ts.* into current_state;
  end if;

  return query select
    current_state.version,
    current_state.status,
    current_state.registration_open,
    current_state.reveal_open,
    current_state.started_at;
end;
$$;

revoke all on function public.admin_fill_demo_players() from public;
revoke all on function public.admin_delete_player(text) from public;
revoke all on function public.admin_update_tournament_controls(boolean, boolean) from public;
grant execute on function public.admin_fill_demo_players() to authenticated;
grant execute on function public.admin_delete_player(text) to authenticated;
grant execute on function public.admin_update_tournament_controls(boolean, boolean) to authenticated;
