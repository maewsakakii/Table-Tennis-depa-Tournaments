-- depa TABLE TENNIS · Collision-free player public IDs
-- Rerunnable. Apply after 007_full_knockout_bracket.sql.
--
-- public_id defaulted to 'DT-' || lpad(nextval(...)) with no check that the value
-- was actually free. Whenever the sequence fell behind the roster -- a re-run of the
-- 003 backfill against a smaller roster, a restore, or a manual insert -- the next
-- registration failed with
--   duplicate key value violates unique constraint "players_public_id_unique"
-- and the player could not sign up at all. The allocator below skips numbers that
-- are already taken, so a lagging sequence self-heals instead of blocking sign-ups.

create or replace function public.allocate_player_public_id()
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  candidate text;
  attempts integer := 0;
begin
  loop
    candidate := 'DT-' || pg_catalog.lpad(nextval('public.player_public_id_seq')::text, 2, '0');
    exit when not exists (select 1 from public.players p where p.public_id = candidate);
    attempts := attempts + 1;
    if attempts > 1000 then
      raise exception 'could not allocate a free player public id';
    end if;
  end loop;
  return candidate;
end;
$$;

revoke all on function public.allocate_player_public_id() from public, anon;
grant execute on function public.allocate_player_public_id() to authenticated;

-- Every insert path -- register_player, admin_fill_demo_players, a manual insert --
-- goes through the column default, so fixing it here fixes all of them at once.
alter table public.players
  alter column public_id set default public.allocate_player_public_id();

-- Pull the sequence up to the roster so the allocator does not have to walk a long
-- run of taken numbers on the next sign-up.
do $$
declare highest bigint;
begin
  select coalesce(pg_catalog.max(pg_catalog.substring(p.public_id, '^DT-([0-9]+)$')::bigint), 0)
    into highest from public.players p;
  if highest > coalesce(pg_catalog.pg_sequence_last_value('public.player_public_id_seq'::regclass), 0) then
    perform pg_catalog.setval('public.player_public_id_seq', highest, true);
  end if;
end $$;
