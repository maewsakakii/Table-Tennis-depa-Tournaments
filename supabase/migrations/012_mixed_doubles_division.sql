-- depa TABLE TENNIS · Mixed doubles division
-- Rerunnable. Apply after 011_admin_update_player_avatar.sql.
--
-- A third bracket where each side is one man plus one woman. Teams are built from where the
-- draw placed each player in their own division: the first man in the men's draw partners
-- the first woman in the women's draw, and teams keep that seed order, so team 1 meets
-- team 2, team 3 meets team 4, and so on.
--
-- Rather than a separate teams table, each side carries a partner alongside the existing
-- player1_id / player2_id, so scoring, winner advancement and revisions work unchanged --
-- the partner simply travels with the captain.

alter table public.bracket_matches
  add column if not exists player1_partner_id uuid references public.players(id) on delete set null,
  add column if not exists player2_partner_id uuid references public.players(id) on delete set null;

alter table public.bracket_matches drop constraint if exists bracket_matches_division_check;
alter table public.bracket_matches
  add constraint bracket_matches_division_check check (division in ('male', 'female', 'mixed'));

-- Wires next/source links and promotes BYE winners for one division of a draw.
create or replace function public.link_division_bracket(p_version integer, p_division text, p_round_count integer)
returns void language plpgsql security definer set search_path = pg_catalog
as $$
begin
  update public.bracket_matches current_match
  set next_match_id = next_match.id,
      next_slot = case when current_match.match_position % 2 = 0 then 1 else 2 end
  from public.bracket_matches next_match
  where current_match.draw_version = p_version and current_match.division = p_division
    and current_match.round_number < p_round_count
    and next_match.draw_version = p_version and next_match.division = p_division
    and next_match.round_number = current_match.round_number + 1
    and next_match.match_position = current_match.match_position / 2;

  update public.bracket_matches current_match
  set source1_match_id = source1.id, source2_match_id = source2.id
  from public.bracket_matches source1, public.bracket_matches source2
  where current_match.draw_version = p_version and current_match.division = p_division and current_match.round_number > 1
    and source1.draw_version = p_version and source1.division = p_division
    and source1.round_number = current_match.round_number - 1 and source1.match_position = current_match.match_position * 2
    and source2.draw_version = p_version and source2.division = p_division
    and source2.round_number = current_match.round_number - 1 and source2.match_position = current_match.match_position * 2 + 1;

  -- A BYE promotes the whole side, partner included.
  update public.bracket_matches next_match
  set player1_id = source.winner_id, player1_partner_id = source.player1_partner_id
  from public.bracket_matches source
  where source.draw_version = p_version and source.division = p_division and source.status = 'bye'
    and source.next_slot = 1 and next_match.id = source.next_match_id;
  update public.bracket_matches next_match
  set player2_id = source.winner_id, player2_partner_id = source.player1_partner_id
  from public.bracket_matches source
  where source.draw_version = p_version and source.division = p_division and source.status = 'bye'
    and source.next_slot = 2 and next_match.id = source.next_match_id;
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
  target_division text;   -- named apart from bracket_matches.division to avoid an ambiguous reference
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
  male_order uuid[];
  female_order uuid[];
  team_captains uuid[];
  team_partners uuid[];
  team_count integer;
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;
  select ts.version + 1 into next_version from public.tournament_state ts where ts.id = 1 for update;

  select pg_catalog.count(*) into ungendered from public.players p where p.gender is null;
  if ungendered > 0 then raise exception 'every player must be assigned a gender before drawing (% left)', ungendered; end if;

  delete from public.private_matches pm where pm.draw_version <= next_version;
  delete from public.bracket_matches bm where bm.draw_version <= next_version;

  foreach target_division in array divisions loop
    select coalesce(pg_catalog.array_agg(p.id order by extensions.gen_random_uuid()), array[]::uuid[])
      into player_ids from public.players p where p.gender = target_division;
    player_count := coalesce(pg_catalog.array_length(player_ids, 1), 0);
    if player_count < 2 then raise exception 'division % needs at least 2 players (has %)', target_division, player_count; end if;
    if player_count > 64 then raise exception 'division % exceeds 64 players', target_division; end if;

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
            values (next_version, target_division, round_number, match_position, sole_player, 'bye', sole_player);
          else
            insert into public.bracket_matches (draw_version, division, round_number, match_position, player1_id, player2_id, status)
            values (next_version, target_division, round_number, match_position, player_ids[player_index], player_ids[player_index + 1], 'ready');
            player_index := player_index + 2;
          end if;
        else
          insert into public.bracket_matches (draw_version, division, round_number, match_position, status)
          values (next_version, target_division, round_number, match_position, 'waiting');
        end if;
      end loop;
    end loop;

    perform public.link_division_bracket(next_version, target_division, round_count);
  end loop;

  -- Mixed doubles: pair by the seed position the draw just produced in each division.
  select coalesce(pg_catalog.array_agg(seed.player_id order by seed.match_position, seed.slot), array[]::uuid[])
    into male_order from (
      select bm.match_position, 1 as slot, bm.player1_id as player_id from public.bracket_matches bm
        where bm.draw_version = next_version and bm.division = 'male' and bm.round_number = 1 and bm.player1_id is not null
      union all
      select bm.match_position, 2 as slot, bm.player2_id from public.bracket_matches bm
        where bm.draw_version = next_version and bm.division = 'male' and bm.round_number = 1 and bm.player2_id is not null
    ) seed;
  select coalesce(pg_catalog.array_agg(seed.player_id order by seed.match_position, seed.slot), array[]::uuid[])
    into female_order from (
      select bm.match_position, 1 as slot, bm.player1_id as player_id from public.bracket_matches bm
        where bm.draw_version = next_version and bm.division = 'female' and bm.round_number = 1 and bm.player1_id is not null
      union all
      select bm.match_position, 2 as slot, bm.player2_id from public.bracket_matches bm
        where bm.draw_version = next_version and bm.division = 'female' and bm.round_number = 1 and bm.player2_id is not null
    ) seed;

  team_count := least(
    coalesce(pg_catalog.array_length(male_order, 1), 0),
    coalesce(pg_catalog.array_length(female_order, 1), 0)
  );

  if team_count >= 2 then
    team_captains := male_order[1:team_count];
    team_partners := female_order[1:team_count];

    bracket_size := 2; round_count := 1;
    while bracket_size < team_count loop bracket_size := bracket_size * 2; round_count := round_count + 1; end loop;
    first_match_count := bracket_size / 2;
    bye_count := bracket_size - team_count;
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
            insert into public.bracket_matches (
              draw_version, division, round_number, match_position, player1_id, player1_partner_id, status, winner_id
            ) values (
              next_version, 'mixed', round_number, match_position,
              team_captains[player_index], team_partners[player_index], 'bye', team_captains[player_index]
            );
            player_index := player_index + 1;
          else
            insert into public.bracket_matches (
              draw_version, division, round_number, match_position,
              player1_id, player1_partner_id, player2_id, player2_partner_id, status
            ) values (
              next_version, 'mixed', round_number, match_position,
              team_captains[player_index], team_partners[player_index],
              team_captains[player_index + 1], team_partners[player_index + 1], 'ready'
            );
            player_index := player_index + 2;
          end if;
        else
          insert into public.bracket_matches (draw_version, division, round_number, match_position, status)
          values (next_version, 'mixed', round_number, match_position, 'waiting');
        end if;
      end loop;
    end loop;

    perform public.link_division_bracket(next_version, 'mixed', round_count);
  end if;

  -- Adjacent BYEs can fill both slots of a later match immediately (any division).
  update public.bracket_matches bm
  set status = 'ready', updated_at = pg_catalog.now()
  where bm.draw_version = next_version and bm.status = 'waiting'
    and bm.player1_id is not null and bm.player2_id is not null;

  -- The private reveal is a singles concept, so it stays on the gendered brackets.
  insert into public.private_matches (id, draw_version, player1_id, player2_id)
  select bm.id, bm.draw_version, coalesce(bm.player1_id, bm.player2_id),
    case when bm.player1_id is not null and bm.player2_id is not null then bm.player2_id else null end
  from public.bracket_matches bm
  where bm.draw_version = next_version and bm.round_number = 1 and bm.division <> 'mixed';

  update public.tournament_state ts set version = next_version, bracket_revision = 0,
    status = 'locked', registration_open = false, reveal_open = true,
    started_at = pg_catalog.now(), updated_at = pg_catalog.now() where ts.id = 1;
  return query select next_version, pg_catalog.count(*)::integer
    from public.bracket_matches bm where bm.draw_version = next_version;
end;
$$;

-- Recording a score must carry the winning side's partner into the next round.
create or replace function public.admin_record_match_score(
  p_match_id uuid, p_score_player1 integer, p_score_player2 integer, p_expected_revision integer
)
returns table (match_id uuid, match_revision integer, bracket_revision integer)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  target public.bracket_matches%rowtype;
  downstream public.bracket_matches%rowtype;
  chosen_winner uuid;
  chosen_partner uuid;
  new_bracket_revision integer;
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

  if p_score_player1 > p_score_player2 then
    chosen_winner := target.player1_id; chosen_partner := target.player1_partner_id;
  else
    chosen_winner := target.player2_id; chosen_partner := target.player2_partner_id;
  end if;

  update public.bracket_matches bm set score_player1 = p_score_player1, score_player2 = p_score_player2,
    winner_id = chosen_winner, status = 'completed', revision = bm.revision + 1, updated_at = pg_catalog.now()
    where bm.id = target.id returning bm.revision into target.revision;

  if target.next_match_id is not null then
    update public.bracket_matches bm set
      player1_id = case when target.next_slot = 1 then chosen_winner else bm.player1_id end,
      player1_partner_id = case when target.next_slot = 1 then chosen_partner else bm.player1_partner_id end,
      player2_id = case when target.next_slot = 2 then chosen_winner else bm.player2_id end,
      player2_partner_id = case when target.next_slot = 2 then chosen_partner else bm.player2_partner_id end,
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

-- Snapshot carries both partners so the client can render a mixed pair.
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
      'player2_public_id', p2.public_id,
      'player1_partner_public_id', partner1.public_id,
      'player2_partner_public_id', partner2.public_id,
      'source1_match_id', bm.source1_match_id,
      'source2_match_id', bm.source2_match_id, 'next_match_id', bm.next_match_id,
      'next_slot', bm.next_slot, 'score_player1', bm.score_player1, 'score_player2', bm.score_player2,
      'winner_public_id', winner.public_id, 'status', bm.status, 'revision', bm.revision
    ) order by bm.division, bm.round_number, bm.match_position)
      from public.bracket_matches bm
      left join public.players p1 on p1.id = bm.player1_id
      left join public.players p2 on p2.id = bm.player2_id
      left join public.players partner1 on partner1.id = bm.player1_partner_id
      left join public.players partner2 on partner2.id = bm.player2_partner_id
      left join public.players winner on winner.id = bm.winner_id
      where bm.draw_version = p_version), '[]'::jsonb)
  ) from public.tournament_state ts where ts.id = 1;
$$;

revoke all on function public.link_division_bracket(integer, text, integer) from public, anon, authenticated;
revoke all on function public.admin_generate_hidden_draw() from public, anon;
grant execute on function public.admin_generate_hidden_draw() to authenticated;
revoke all on function public.admin_record_match_score(uuid, integer, integer, integer) from public, anon;
grant execute on function public.admin_record_match_score(uuid, integer, integer, integer) to authenticated;
revoke all on function public.private_tournament_snapshot(integer) from public, anon, authenticated;
