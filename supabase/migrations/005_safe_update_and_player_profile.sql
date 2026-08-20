-- depa TABLE TENNIS · Safe-update repair and admin profile editing
-- Rerunnable. Apply after 004_admin_demo_roster_tools.sql.

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
  from public.tournament_state ts
  where ts.id = 1
  for update;

  select coalesce(
    pg_catalog.array_agg(p.id order by extensions.gen_random_uuid()),
    array[]::uuid[]
  )
  into player_ids
  from public.players p;
  if coalesce(pg_catalog.array_length(player_ids, 1), 0) < 2 then
    raise exception 'at least two players are required';
  end if;

  delete from public.private_matches m
  where m.draw_version <= next_version;

  index_number := 1;
  while index_number <= pg_catalog.array_length(player_ids, 1) loop
    insert into public.private_matches (draw_version, player1_id, player2_id)
    values (
      next_version,
      player_ids[index_number],
      case when index_number + 1 <= pg_catalog.array_length(player_ids, 1)
        then player_ids[index_number + 1] else null end
    );
    index_number := index_number + 2;
  end loop;

  update public.tournament_state ts
  set version = next_version,
      status = 'locked',
      registration_open = false,
      reveal_open = true,
      started_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where ts.id = 1;

  return query
  select next_version, pg_catalog.count(*)::integer
  from public.private_matches pm
  where pm.draw_version = next_version;
end;
$$;

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
      '/demo-avatars/demo-' || pg_catalog.lpad(slot_number::text, 2, '0') || '.svg',
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
    delete from public.private_matches m
    where m.draw_version <= current_state.version;
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

  delete from public.private_matches m
  where m.draw_version <= current_state.version;
  delete from public.players p
  where p.id = target_player.id;
  update public.tournament_state ts
  set version = ts.version + 1,
      status = case when ts.registration_open then 'registration' else 'locked' end,
      reveal_open = false,
      started_at = null,
      updated_at = pg_catalog.now()
  where ts.id = 1;

  return query
  select target_player.public_id, target_player.avatar_url, target_player.is_demo;
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

  if p_registration_open and not current_state.registration_open then
    delete from public.private_matches m
    where m.draw_version <= current_state.version;
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

create or replace function public.admin_update_player_profile(
  p_public_id text,
  p_nickname text,
  p_department text
)
returns table (
  public_id text,
  nickname text,
  department text,
  email text,
  avatar_url text,
  registered_at timestamptz,
  is_demo boolean,
  demo_slot smallint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  updated_player public.players%rowtype;
  clean_nickname text := pg_catalog.btrim(p_nickname);
  clean_department text := pg_catalog.btrim(p_department);
begin
  if not public.is_tournament_admin() then
    raise exception 'admin access required';
  end if;
  if pg_catalog.char_length(clean_nickname) not between 2 and 40 then
    raise exception 'nickname must contain 2 to 40 characters';
  end if;
  if pg_catalog.char_length(clean_department) not between 1 and 80 then
    raise exception 'department must contain 1 to 80 characters';
  end if;

  update public.players p
  set nickname = clean_nickname,
      department = clean_department
  where p.public_id = p_public_id
  returning p.* into updated_player;
  if updated_player.id is null then
    raise exception 'player not found';
  end if;

  return query select
    updated_player.public_id,
    updated_player.nickname,
    updated_player.department,
    updated_player.email,
    updated_player.avatar_url,
    updated_player.registered_at,
    updated_player.is_demo,
    updated_player.demo_slot;
end;
$$;

revoke all on function public.admin_generate_hidden_draw() from public, anon;
revoke all on function public.admin_fill_demo_players() from public, anon;
revoke all on function public.admin_delete_player(text) from public, anon;
revoke all on function public.admin_update_tournament_controls(boolean, boolean) from public, anon;
revoke all on function public.admin_update_player_profile(text, text, text) from public, anon;
grant execute on function public.admin_generate_hidden_draw() to authenticated;
grant execute on function public.admin_fill_demo_players() to authenticated;
grant execute on function public.admin_delete_player(text) to authenticated;
grant execute on function public.admin_update_tournament_controls(boolean, boolean) to authenticated;
grant execute on function public.admin_update_player_profile(text, text, text) to authenticated;
