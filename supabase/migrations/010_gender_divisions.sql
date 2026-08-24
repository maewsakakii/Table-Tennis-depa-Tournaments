-- depa TABLE TENNIS · Gender divisions (two independent knockout tournaments)
-- Rerunnable. Apply after 009_public_id_follows_roster.sql.
--
-- Admins assign each player a gender in the roster; the draw then builds a separate
-- bracket per division so male and female players never meet. The player-facing side
-- is unchanged -- each player still sees only their own bracket, scoped by division in
-- get_player_tournament_snapshot's caller.

alter table public.players
  add column if not exists gender text check (gender in ('male', 'female'));

alter table public.bracket_matches
  add column if not exists division text not null default 'male' check (division in ('male', 'female'));

-- match_position repeats across the two divisions in one draw, so the uniqueness key
-- must include division.
alter table public.bracket_matches drop constraint if exists bracket_matches_draw_version_round_number_match_position_key;
create unique index if not exists bracket_matches_division_slot_unique
  on public.bracket_matches (draw_version, division, round_number, match_position);

create or replace function public.admin_set_player_gender(p_public_id text, p_gender text)
returns table (public_id text, nickname text, department text, email text, avatar_url text, registered_at timestamptz, gender text, is_demo boolean, demo_slot smallint)
language plpgsql security definer set search_path = pg_catalog
as $$
declare current_state public.tournament_state%rowtype;
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;
  if p_gender not in ('male', 'female') then raise exception 'gender must be male or female'; end if;
  select ts.* into current_state from public.tournament_state ts where ts.id = 1 for update;
  update public.players p set gender = p_gender where p.public_id = p_public_id;
  if not found then raise exception 'player not found'; end if;
  -- A gender change invalidates any locked draw, exactly like adding or removing a player.
  delete from public.private_matches pm where pm.draw_version <= current_state.version;
  delete from public.bracket_matches bm where bm.draw_version <= current_state.version;
  update public.tournament_state ts set version = ts.version + 1, bracket_revision = 0,
    status = case when ts.registration_open then 'registration' else 'locked' end,
    reveal_open = false, started_at = null, updated_at = pg_catalog.now() where ts.id = 1;
  -- Cast every column to the declared return type so a drifted column type on an
  -- older database cannot raise "structure of query does not match function result type".
  return query select p.public_id::text, p.nickname::text, p.department::text, p.email::text,
    p.avatar_url::text, p.registered_at::timestamptz, p.gender::text, p.is_demo::boolean, p.demo_slot::smallint
    from public.players p where p.public_id = p_public_id;
end;
$$;

create or replace function public.admin_generate_hidden_draw()
returns table (draw_version integer, match_count integer)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  next_version integer;
  ungendered integer;
  divisions text[] := array['male', 'female'];
  division text;
  player_ids uuid[];
  player_count integer;
  bracket_size integer;
  round_count integer;
  first_match_count integer;
  bye_count integer;
  round_number integer;
  match_position integer;
  player_index integer;
  is_bye boolean;
  sole_player uuid;
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;
  select ts.version + 1 into next_version from public.tournament_state ts where ts.id = 1 for update;

  select pg_catalog.count(*) into ungendered from public.players p where p.gender is null;
  if ungendered > 0 then raise exception 'every player must be assigned a gender before drawing (% left)', ungendered; end if;

  delete from public.private_matches pm where pm.draw_version <= next_version;
  delete from public.bracket_matches bm where bm.draw_version <= next_version;

  foreach division in array divisions loop
    select coalesce(pg_catalog.array_agg(p.id order by extensions.gen_random_uuid()), array[]::uuid[])
      into player_ids from public.players p where p.gender = division;
    player_count := coalesce(pg_catalog.array_length(player_ids, 1), 0);
    if player_count < 2 then raise exception 'division % needs at least 2 players (has %)', division, player_count; end if;
    if player_count > 64 then raise exception 'division % exceeds 64 players', division; end if;

    bracket_size := 2; round_count := 1;
    while bracket_size < player_count loop bracket_size := bracket_size * 2; round_count := round_count + 1; end loop;
    first_match_count := bracket_size / 2;
    bye_count := bracket_size - player_count;
    player_index := 1;

    for round_number in 1..round_count loop
      for match_position in 0..(bracket_size / (2 ^ round_number)::integer - 1) loop
        if round_number = 1 then
          is_bye := bye_count > 0 and exists (
            select 1 from pg_catalog.generate_series(0, bye_count - 1) bye_index
            where match_position = case when bye_count = 1 then 0
              else pg_catalog.round(bye_index * (first_match_count - 1)::numeric / (bye_count - 1))::integer end
          );
          if is_bye then
            sole_player := player_ids[player_index]; player_index := player_index + 1;
            insert into public.bracket_matches (draw_version, division, round_number, match_position, player1_id, status, winner_id)
            values (next_version, division, round_number, match_position, sole_player, 'bye', sole_player);
          else
            insert into public.bracket_matches (draw_version, division, round_number, match_position, player1_id, player2_id, status)
            values (next_version, division, round_number, match_position, player_ids[player_index], player_ids[player_index + 1], 'ready');
            player_index := player_index + 2;
          end if;
        else
          insert into public.bracket_matches (draw_version, division, round_number, match_position, status)
          values (next_version, division, round_number, match_position, 'waiting');
        end if;
      end loop;
    end loop;

    update public.bracket_matches current_match
    set next_match_id = next_match.id,
        next_slot = case when current_match.match_position % 2 = 0 then 1 else 2 end
    from public.bracket_matches next_match
    where current_match.draw_version = next_version and current_match.division = division
      and current_match.round_number < round_count
      and next_match.draw_version = next_version and next_match.division = division
      and next_match.round_number = current_match.round_number + 1
      and next_match.match_position = current_match.match_position / 2;

    update public.bracket_matches current_match
    set source1_match_id = source1.id, source2_match_id = source2.id
    from public.bracket_matches source1, public.bracket_matches source2
    where current_match.draw_version = next_version and current_match.division = division and current_match.round_number > 1
      and source1.draw_version = next_version and source1.division = division
      and source1.round_number = current_match.round_number - 1 and source1.match_position = current_match.match_position * 2
      and source2.draw_version = next_version and source2.division = division
      and source2.round_number = current_match.round_number - 1 and source2.match_position = current_match.match_position * 2 + 1;

    update public.bracket_matches next_match
    set player1_id = source.winner_id
    from public.bracket_matches source
    where source.draw_version = next_version and source.division = division and source.status = 'bye'
      and source.next_slot = 1 and next_match.id = source.next_match_id;
    update public.bracket_matches next_match
    set player2_id = source.winner_id
    from public.bracket_matches source
    where source.draw_version = next_version and source.division = division and source.status = 'bye'
      and source.next_slot = 2 and next_match.id = source.next_match_id;
  end loop;

  -- Adjacent BYEs can fill both slots of a later match immediately (either division).
  update public.bracket_matches bm
  set status = 'ready', updated_at = pg_catalog.now()
  where bm.draw_version = next_version and bm.status = 'waiting'
    and bm.player1_id is not null and bm.player2_id is not null;

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

-- Snapshot now carries division per match and gender per player.
create or replace function public.private_tournament_snapshot(p_version integer)
returns jsonb language sql stable security definer set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'version', ts.version, 'bracket_revision', ts.bracket_revision,
    'round_count', coalesce((select pg_catalog.max(bm.round_number) from public.bracket_matches bm where bm.draw_version = p_version), 0),
    'players', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'public_id', p.public_id, 'nickname', p.nickname, 'department', p.department, 'avatar_url', p.avatar_url, 'gender', p.gender
    ) order by p.registered_at) from public.players p), '[]'::jsonb),
    'matches', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'match_id', bm.id, 'draw_version', bm.draw_version, 'division', bm.division, 'round_number', bm.round_number,
      'match_position', bm.match_position, 'player1_public_id', p1.public_id,
      'player2_public_id', p2.public_id, 'source1_match_id', bm.source1_match_id,
      'source2_match_id', bm.source2_match_id, 'next_match_id', bm.next_match_id,
      'next_slot', bm.next_slot, 'score_player1', bm.score_player1, 'score_player2', bm.score_player2,
      'winner_public_id', winner.public_id, 'status', bm.status, 'revision', bm.revision
    ) order by bm.division, bm.round_number, bm.match_position)
      from public.bracket_matches bm
      left join public.players p1 on p1.id = bm.player1_id
      left join public.players p2 on p2.id = bm.player2_id
      left join public.players winner on winner.id = bm.winner_id
      where bm.draw_version = p_version), '[]'::jsonb)
  ) from public.tournament_state ts where ts.id = 1;
$$;

revoke all on function public.admin_set_player_gender(text, text) from public, anon;
grant execute on function public.admin_set_player_gender(text, text) to authenticated;
revoke all on function public.admin_generate_hidden_draw() from public, anon;
grant execute on function public.admin_generate_hidden_draw() to authenticated;
revoke all on function public.private_tournament_snapshot(integer) from public, anon, authenticated;
