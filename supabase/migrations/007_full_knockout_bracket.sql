-- depa TABLE TENNIS · Full knockout bracket, scoring and player-safe snapshots
-- Rerunnable. Apply after 006_simple_draw_launch.sql.

alter table public.tournament_state
  add column if not exists bracket_revision integer not null default 0;

create table if not exists public.bracket_matches (
  id uuid primary key default extensions.gen_random_uuid(),
  draw_version integer not null,
  round_number integer not null check (round_number between 1 and 6),
  match_position integer not null check (match_position >= 0),
  player1_id uuid references public.players(id) on delete set null,
  player2_id uuid references public.players(id) on delete set null,
  source1_match_id uuid references public.bracket_matches(id) on delete set null,
  source2_match_id uuid references public.bracket_matches(id) on delete set null,
  next_match_id uuid references public.bracket_matches(id) on delete set null,
  next_slot smallint check (next_slot in (1, 2)),
  score_player1 integer check (score_player1 between 0 and 99),
  score_player2 integer check (score_player2 between 0 and 99),
  winner_id uuid references public.players(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting','ready','bye','completed')),
  revision integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (draw_version, round_number, match_position),
  check (player1_id is null or player2_id is null or player1_id <> player2_id),
  check ((next_match_id is null and next_slot is null) or (next_match_id is not null and next_slot is not null)),
  check ((score_player1 is null) = (score_player2 is null)),
  check (score_player1 is null or score_player1 <> score_player2)
);

alter table public.bracket_matches enable row level security;
revoke all on table public.bracket_matches from public, anon, authenticated;

create or replace function public.admin_generate_hidden_draw()
returns table (draw_version integer, match_count integer)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  player_ids uuid[];
  player_count integer;
  bracket_size integer := 2;
  round_count integer := 1;
  first_match_count integer;
  bye_count integer;
  next_version integer;
  round_number integer;
  match_position integer;
  player_index integer := 1;
  is_bye boolean;
  created_match_id uuid;
  sole_player uuid;
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;
  select ts.version + 1 into next_version from public.tournament_state ts where ts.id = 1 for update;
  select coalesce(pg_catalog.array_agg(p.id order by extensions.gen_random_uuid()), array[]::uuid[])
    into player_ids from public.players p;
  player_count := coalesce(pg_catalog.array_length(player_ids, 1), 0);
  if player_count < 2 or player_count > 64 then raise exception 'player count must be between 2 and 64'; end if;
  while bracket_size < player_count loop bracket_size := bracket_size * 2; round_count := round_count + 1; end loop;
  first_match_count := bracket_size / 2;
  bye_count := bracket_size - player_count;

  delete from public.private_matches pm where pm.draw_version <= next_version;
  delete from public.bracket_matches bm where bm.draw_version <= next_version;

  for round_number in 1..round_count loop
    for match_position in 0..(bracket_size / (2 ^ round_number)::integer - 1) loop
      if round_number = 1 then
        is_bye := exists (
          select 1 from pg_catalog.generate_series(0, bye_count - 1) bye_index
          where match_position = case when bye_count = 1 then 0
            else pg_catalog.round(bye_index * (first_match_count - 1)::numeric / (bye_count - 1))::integer end
        );
        if is_bye then
          sole_player := player_ids[player_index]; player_index := player_index + 1;
          insert into public.bracket_matches (
            draw_version, round_number, match_position, player1_id, status, winner_id
          ) values (next_version, round_number, match_position, sole_player, 'bye', sole_player)
          returning id into created_match_id;
        else
          insert into public.bracket_matches (
            draw_version, round_number, match_position, player1_id, player2_id, status
          ) values (
            next_version, round_number, match_position,
            player_ids[player_index], player_ids[player_index + 1], 'ready'
          ) returning id into created_match_id;
          player_index := player_index + 2;
        end if;
      else
        insert into public.bracket_matches (draw_version, round_number, match_position, status)
        values (next_version, round_number, match_position, 'waiting');
      end if;
    end loop;
  end loop;

  update public.bracket_matches current_match
  set next_match_id = next_match.id,
      next_slot = case when current_match.match_position % 2 = 0 then 1 else 2 end
  from public.bracket_matches next_match
  where current_match.draw_version = next_version
    and current_match.round_number < round_count
    and next_match.draw_version = next_version
    and next_match.round_number = current_match.round_number + 1
    and next_match.match_position = current_match.match_position / 2;

  update public.bracket_matches current_match
  set source1_match_id = source1.id, source2_match_id = source2.id
  from public.bracket_matches source1, public.bracket_matches source2
  where current_match.draw_version = next_version and current_match.round_number > 1
    and source1.draw_version = next_version and source1.round_number = current_match.round_number - 1
    and source1.match_position = current_match.match_position * 2
    and source2.draw_version = next_version and source2.round_number = current_match.round_number - 1
    and source2.match_position = current_match.match_position * 2 + 1;

  update public.bracket_matches next_match
  set player1_id = source.winner_id
  from public.bracket_matches source
  where source.draw_version = next_version and source.status = 'bye'
    and source.next_slot = 1 and next_match.id = source.next_match_id;
  update public.bracket_matches next_match
  set player2_id = source.winner_id
  from public.bracket_matches source
  where source.draw_version = next_version and source.status = 'bye'
    and source.next_slot = 2 and next_match.id = source.next_match_id;

  -- Adjacent BYEs can fill both slots in a later round immediately.
  update public.bracket_matches bm
  set status = 'ready', updated_at = pg_catalog.now()
  where bm.draw_version = next_version
    and bm.status = 'waiting'
    and bm.player1_id is not null
    and bm.player2_id is not null;

  insert into public.private_matches (id, draw_version, player1_id, player2_id)
  select bm.id, bm.draw_version, coalesce(bm.player1_id, bm.player2_id),
    case when bm.player1_id is not null and bm.player2_id is not null then bm.player2_id else null end
  from public.bracket_matches bm where bm.draw_version = next_version and bm.round_number = 1;

  update public.tournament_state ts set version = next_version, bracket_revision = 0,
    status = 'locked', registration_open = false, reveal_open = true,
    started_at = pg_catalog.now(), updated_at = pg_catalog.now() where ts.id = 1;
  return query select next_version, pg_catalog.count(*)::integer
    from public.bracket_matches bm where bm.draw_version = next_version;
end;
$$;

create or replace function public.private_tournament_snapshot(p_version integer)
returns jsonb language sql stable security definer set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'version', ts.version, 'bracket_revision', ts.bracket_revision,
    'round_count', coalesce((select pg_catalog.max(bm.round_number) from public.bracket_matches bm where bm.draw_version = p_version), 0),
    'players', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'public_id', p.public_id, 'nickname', p.nickname, 'department', p.department, 'avatar_url', p.avatar_url
    ) order by p.registered_at) from public.players p), '[]'::jsonb),
    'matches', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'match_id', bm.id, 'draw_version', bm.draw_version, 'round_number', bm.round_number,
      'match_position', bm.match_position, 'player1_public_id', p1.public_id,
      'player2_public_id', p2.public_id, 'source1_match_id', bm.source1_match_id,
      'source2_match_id', bm.source2_match_id, 'next_match_id', bm.next_match_id,
      'next_slot', bm.next_slot, 'score_player1', bm.score_player1, 'score_player2', bm.score_player2,
      'winner_public_id', winner.public_id, 'status', bm.status, 'revision', bm.revision
    ) order by bm.round_number, bm.match_position)
      from public.bracket_matches bm
      left join public.players p1 on p1.id = bm.player1_id
      left join public.players p2 on p2.id = bm.player2_id
      left join public.players winner on winner.id = bm.winner_id
      where bm.draw_version = p_version), '[]'::jsonb)
  ) from public.tournament_state ts where ts.id = 1;
$$;

revoke all on function public.private_tournament_snapshot(integer) from public, anon, authenticated;

create or replace function public.admin_get_tournament_snapshot()
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare current_version integer;
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;
  select ts.version into current_version from public.tournament_state ts where ts.id = 1;
  return public.private_tournament_snapshot(current_version);
end;
$$;

create or replace function public.get_player_tournament_snapshot(p_public_id text, p_identity_token text)
returns jsonb language plpgsql security definer set search_path = pg_catalog
as $$
declare current_version integer;
begin
  if not exists (
    select 1 from public.players p join public.player_credentials c on c.player_id = p.id
    where p.public_id = p_public_id
      and c.identity_hash = extensions.digest(p_identity_token, 'sha256')
  ) then raise exception 'invalid player identity'; end if;
  select ts.version into current_version from public.tournament_state ts where ts.id = 1 and ts.reveal_open;
  if current_version is null then raise exception 'tournament bracket is not available'; end if;
  return public.private_tournament_snapshot(current_version);
end;
$$;

create or replace function public.admin_record_match_score(
  p_match_id uuid, p_score_player1 integer, p_score_player2 integer, p_expected_revision integer
)
returns table (match_id uuid, match_revision integer, bracket_revision integer)
language plpgsql security definer set search_path = pg_catalog
as $$
declare target public.bracket_matches%rowtype; downstream public.bracket_matches%rowtype; chosen_winner uuid; new_bracket_revision integer;
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;
  perform 1 from public.tournament_state ts where ts.id = 1 for update;
  select bm.* into target from public.bracket_matches bm where bm.id = p_match_id for update;
  if target.id is null then raise exception 'match not found'; end if;
  if p_expected_revision is null then raise exception 'expected revision is required'; end if;
  if target.revision <> p_expected_revision then raise exception 'stale match revision'; end if;
  if p_score_player1 is null or p_score_player2 is null
    or p_score_player1 not between 0 and 99 or p_score_player2 not between 0 and 99
  then raise exception 'scores must be between 0 and 99'; end if;
  if p_score_player1 = p_score_player2 then raise exception 'scores cannot be tied'; end if;
  if target.player1_id is null or target.player2_id is null or target.status not in ('ready','completed') then raise exception 'match is not ready'; end if;
  if target.next_match_id is not null then
    select bm.* into downstream from public.bracket_matches bm where bm.id = target.next_match_id for update;
    if target.status = 'completed' and downstream.status = 'completed' then raise exception 'downstream match is already completed'; end if;
  end if;
  chosen_winner := case when p_score_player1 > p_score_player2 then target.player1_id else target.player2_id end;
  update public.bracket_matches bm set score_player1 = p_score_player1, score_player2 = p_score_player2,
    winner_id = chosen_winner, status = 'completed', revision = bm.revision + 1, updated_at = pg_catalog.now()
    where bm.id = target.id returning bm.revision into target.revision;
  if target.next_match_id is not null then
    update public.bracket_matches bm set
      player1_id = case when target.next_slot = 1 then chosen_winner else bm.player1_id end,
      player2_id = case when target.next_slot = 2 then chosen_winner else bm.player2_id end,
      status = case when
        (case when target.next_slot = 1 then chosen_winner else bm.player1_id end) is not null and
        (case when target.next_slot = 2 then chosen_winner else bm.player2_id end) is not null
        then 'ready' else 'waiting' end,
      revision = bm.revision + 1,
      updated_at = pg_catalog.now() where bm.id = target.next_match_id;
  end if;
  update public.tournament_state ts set bracket_revision = ts.bracket_revision + 1, updated_at = pg_catalog.now()
    where ts.id = 1 returning ts.bracket_revision into new_bracket_revision;
  return query select target.id, target.revision, new_bracket_revision;
end;
$$;

-- Reopening registration must invalidate both legacy and full-bracket data atomically.
create or replace function public.admin_update_tournament_controls(p_registration_open boolean, p_reveal_open boolean)
returns table (version integer, status text, registration_open boolean, reveal_open boolean, started_at timestamptz)
language plpgsql security definer set search_path = pg_catalog
as $$
declare current_state public.tournament_state%rowtype;
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;
  select ts.* into current_state from public.tournament_state ts where ts.id = 1 for update;
  if p_registration_open and p_reveal_open then raise exception 'registration and reveal cannot both be open'; end if;
  if p_reveal_open and not exists (select 1 from public.bracket_matches bm where bm.draw_version = current_state.version) then
    raise exception 'a current bracket is required before reveal';
  end if;
  if p_registration_open and not current_state.registration_open then
    delete from public.private_matches pm where pm.draw_version <= current_state.version;
    delete from public.bracket_matches bm where bm.draw_version <= current_state.version;
    update public.tournament_state ts set version = ts.version + 1, bracket_revision = 0,
      status = 'registration', registration_open = true, reveal_open = false,
      started_at = null, updated_at = pg_catalog.now() where ts.id = 1 returning ts.* into current_state;
  else
    update public.tournament_state ts set registration_open = p_registration_open,
      reveal_open = p_reveal_open, updated_at = pg_catalog.now() where ts.id = 1 returning ts.* into current_state;
  end if;
  return query select current_state.version, current_state.status, current_state.registration_open,
    current_state.reveal_open, current_state.started_at;
end;
$$;

create or replace function public.reveal_my_opponent(p_public_id text, p_identity_token text)
returns table (match_id uuid, opponent_public_id text, opponent_nickname text, opponent_department text, opponent_avatar_url text, is_bye boolean)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare authenticated_player_id uuid; selected_match public.bracket_matches%rowtype; opponent_id uuid; current_version integer;
begin
  select ts.version into current_version from public.tournament_state ts where ts.id = 1 and ts.reveal_open;
  if current_version is null then raise exception 'opponent reveal is closed'; end if;
  select p.id into authenticated_player_id from public.players p
    join public.player_credentials c on c.player_id = p.id
    where p.public_id = p_public_id and c.identity_hash = extensions.digest(p_identity_token, 'sha256');
  if authenticated_player_id is null then raise exception 'invalid player identity'; end if;
  select bm.* into selected_match from public.bracket_matches bm
    where bm.draw_version = current_version
      and (bm.player1_id = authenticated_player_id or bm.player2_id = authenticated_player_id)
    order by bm.round_number desc limit 1;
  if selected_match.id is null then return; end if;
  if selected_match.status = 'waiting' then
    select bm.* into selected_match from public.bracket_matches bm
      where bm.draw_version = current_version and bm.status = 'bye'
        and (bm.player1_id = authenticated_player_id or bm.player2_id = authenticated_player_id)
      order by bm.round_number desc limit 1;
  end if;
  if selected_match.id is null or selected_match.status not in ('ready','bye') then return; end if;
  opponent_id := case when selected_match.player1_id = authenticated_player_id then selected_match.player2_id else selected_match.player1_id end;
  return query select selected_match.id, p.public_id, p.nickname, p.department, p.avatar_url, opponent_id is null
    from (select 1) seed left join public.players p on p.id = opponent_id;
end;
$$;

create or replace function public.admin_fill_demo_players()
returns table (created_count integer)
language plpgsql security definer set search_path = pg_catalog
as $$
declare slot_number integer; inserted_count integer := 0;
  demo_names text[] := array['พี่แอม','นัท','ปิง','เจ','มุก','ต้น','แพรว','บอส','ฟ้า','นนท์'];
  demo_departments text[] := array['การตลาด','ไอที / ผลิตภัณฑ์','ฝ่ายขาย','ปฏิบัติการ','การตลาด','ไอที / ผลิตภัณฑ์','ฝ่ายขาย','ปฏิบัติการ','กลยุทธ์องค์กร','ทรัพยากรบุคคล'];
  current_state public.tournament_state%rowtype;
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;
  select ts.* into current_state from public.tournament_state ts where ts.id = 1 for update;
  for slot_number in 1..10 loop
    insert into public.players (nickname, department, avatar_url, status, is_demo, demo_slot)
    select demo_names[slot_number], demo_departments[slot_number],
      '/demo-avatars/demo-' || pg_catalog.lpad(slot_number::text, 2, '0') || '.svg', 'waiting', true, slot_number
    where not exists (select 1 from public.players p where p.is_demo and p.demo_slot = slot_number)
    on conflict do nothing;
    inserted_count := inserted_count + case when found then 1 else 0 end;
  end loop;
  if inserted_count > 0 then
    delete from public.private_matches pm where pm.draw_version <= current_state.version;
    delete from public.bracket_matches bm where bm.draw_version <= current_state.version;
    update public.tournament_state ts set version = ts.version + 1, bracket_revision = 0,
      status = case when ts.registration_open then 'registration' else 'locked' end,
      reveal_open = false, started_at = null, updated_at = pg_catalog.now() where ts.id = 1;
  end if;
  return query select inserted_count;
end;
$$;

create or replace function public.admin_delete_player(p_public_id text)
returns table (deleted_public_id text, deleted_avatar_url text, deleted_is_demo boolean)
language plpgsql security definer set search_path = pg_catalog
as $$
declare target_player public.players%rowtype; current_state public.tournament_state%rowtype;
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;
  select ts.* into current_state from public.tournament_state ts where ts.id = 1 for update;
  select p.* into target_player from public.players p where p.public_id = p_public_id for update;
  if target_player.id is null then raise exception 'player not found'; end if;
  delete from public.private_matches pm where pm.draw_version <= current_state.version;
  delete from public.bracket_matches bm where bm.draw_version <= current_state.version;
  delete from public.players p where p.id = target_player.id;
  update public.tournament_state ts set version = ts.version + 1, bracket_revision = 0,
    status = case when ts.registration_open then 'registration' else 'locked' end,
    reveal_open = false, started_at = null, updated_at = pg_catalog.now() where ts.id = 1;
  return query select target_player.public_id, target_player.avatar_url, target_player.is_demo;
end;
$$;

revoke all on function public.admin_generate_hidden_draw() from public, anon;
grant execute on function public.admin_generate_hidden_draw() to authenticated;
revoke all on function public.admin_get_tournament_snapshot() from public, anon;
grant execute on function public.admin_get_tournament_snapshot() to authenticated;
revoke all on function public.get_player_tournament_snapshot(text, text) from public, anon, authenticated;
grant execute on function public.get_player_tournament_snapshot(text, text) to anon, authenticated;
revoke all on function public.admin_record_match_score(uuid, integer, integer, integer) from public, anon;
grant execute on function public.admin_record_match_score(uuid, integer, integer, integer) to authenticated;
revoke all on function public.admin_update_tournament_controls(boolean, boolean) from public, anon;
grant execute on function public.admin_update_tournament_controls(boolean, boolean) to authenticated;
revoke all on function public.reveal_my_opponent(text, text) from public, anon, authenticated;
grant execute on function public.reveal_my_opponent(text, text) to anon, authenticated;
revoke all on function public.admin_fill_demo_players() from public, anon;
grant execute on function public.admin_fill_demo_players() to authenticated;
revoke all on function public.admin_delete_player(text) from public, anon;
grant execute on function public.admin_delete_player(text) to authenticated;
