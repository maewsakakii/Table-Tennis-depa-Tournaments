-- depa TABLE TENNIS · Match dates and public bracket viewer
-- Rerunnable. Apply after 012_mixed_doubles_division.sql.

alter table public.bracket_matches add column if not exists scheduled_date date;

-- Pair 1 starts on 25/08/2026, then advances one working day per match.
create or replace function public.default_tournament_match_date(p_offset integer)
returns date language plpgsql immutable set search_path = pg_catalog
as $$
declare
  result date := date '2026-08-25';
  remaining integer := greatest(coalesce(p_offset, 0), 0);
begin
  while remaining > 0 loop
    result := result + 1;
    if extract(isodow from result) < 6 then remaining := remaining - 1; end if;
  end loop;
  return result;
end;
$$;

create or replace function public.set_default_match_date()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare
  existing_count integer;
begin
  if new.scheduled_date is null then
    select pg_catalog.count(*) into existing_count
    from public.bracket_matches bm
    where bm.draw_version = new.draw_version and bm.division = new.division;
    new.scheduled_date := public.default_tournament_match_date(existing_count);
  end if;
  return new;
end;
$$;

drop trigger if exists bracket_matches_default_date on public.bracket_matches;
create trigger bracket_matches_default_date
before insert on public.bracket_matches
for each row execute function public.set_default_match_date();

with numbered as (
  select bm.id, pg_catalog.row_number() over (
    partition by bm.draw_version, bm.division order by bm.round_number, bm.match_position
  ) - 1 as match_offset
  from public.bracket_matches bm
  where bm.scheduled_date is null
)
update public.bracket_matches bm
set scheduled_date = public.default_tournament_match_date(numbered.match_offset::integer)
from numbered where numbered.id = bm.id;

create or replace function public.admin_update_match_date(p_match_id uuid, p_scheduled_date date)
returns void language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;
  update public.bracket_matches bm
  set scheduled_date = p_scheduled_date, updated_at = pg_catalog.now()
  where bm.id = p_match_id;
  if not found then raise exception 'match not found'; end if;
  update public.tournament_state ts
  set bracket_revision = ts.bracket_revision + 1, updated_at = pg_catalog.now()
  where ts.id = 1;
end;
$$;

-- Every existing admin/player snapshot automatically gains the date through this shared function.
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
      'match_position', bm.match_position, 'scheduled_date', bm.scheduled_date,
      'player1_public_id', p1.public_id, 'player2_public_id', p2.public_id,
      'player1_partner_public_id', partner1.public_id, 'player2_partner_public_id', partner2.public_id,
      'source1_match_id', bm.source1_match_id, 'source2_match_id', bm.source2_match_id,
      'next_match_id', bm.next_match_id, 'next_slot', bm.next_slot,
      'score_player1', bm.score_player1, 'score_player2', bm.score_player2,
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

create or replace function public.get_public_tournament_snapshot()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  current_state public.tournament_state%rowtype;
begin
  select ts.* into current_state from public.tournament_state ts where ts.id = 1;
  if current_state.id is null or not current_state.reveal_open then
    return pg_catalog.jsonb_build_object(
      'version', coalesce(current_state.version, 0), 'bracket_revision', 0,
      'round_count', 0, 'players', '[]'::jsonb, 'matches', '[]'::jsonb
    );
  end if;
  return public.private_tournament_snapshot(current_state.version);
end;
$$;

revoke all on function public.default_tournament_match_date(integer) from public, anon, authenticated;
revoke all on function public.set_default_match_date() from public, anon, authenticated;
revoke all on function public.admin_update_match_date(uuid, date) from public, anon;
grant execute on function public.admin_update_match_date(uuid, date) to authenticated;
revoke all on function public.private_tournament_snapshot(integer) from public, anon, authenticated;
revoke all on function public.get_public_tournament_snapshot() from public;
grant execute on function public.get_public_tournament_snapshot() to anon, authenticated;
