-- depa TABLE TENNIS · Player public IDs continue from the current roster
-- Rerunnable. Apply after 008_collision_free_player_ids.sql. Self-contained: safe to
-- run whether or not 008 was applied.
--
-- 008 drew IDs from player_public_id_seq, which only ever moves forward. Registering
-- DT-987, DT-988, DT-989 and then deleting all three left the sequence at 989, so the
-- next sign-up became DT-990 instead of continuing from the highest player still on
-- the roster. The allocator now derives the next number from the roster itself, so
-- numbers freed at the top are handed out again.
--
-- register_player and admin_fill_demo_players both take `for update` on
-- tournament_state before inserting, so two sign-ups cannot read the same maximum;
-- the loop below covers a manual insert that skips that lock.
--
-- NOTE: re-running 003 resets this column default back to nextval(). Re-run this file
-- afterwards.

create or replace function public.allocate_player_public_id()
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  next_number bigint;
  candidate text;
begin
  select coalesce(pg_catalog.max(pg_catalog.substring(p.public_id, '^DT-([0-9]+)$')::bigint), 0) + 1
    into next_number from public.players p;
  loop
    candidate := 'DT-' || pg_catalog.lpad(next_number::text, 2, '0');
    exit when not exists (select 1 from public.players p where p.public_id = candidate);
    next_number := next_number + 1;
    if next_number > 100000 then
      raise exception 'could not allocate a free player public id';
    end if;
  end loop;
  -- Kept in step so anything still reading the sequence sees the roster high-water mark.
  perform pg_catalog.setval('public.player_public_id_seq', next_number, true);
  return candidate;
end;
$$;

revoke all on function public.allocate_player_public_id() from public, anon;
grant execute on function public.allocate_player_public_id() to authenticated;

alter table public.players
  alter column public_id set default public.allocate_player_public_id();
