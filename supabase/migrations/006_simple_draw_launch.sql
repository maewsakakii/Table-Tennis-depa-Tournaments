-- depa TABLE TENNIS · Simple Round 1 launch repair
-- Rerunnable. Apply after 005_safe_update_and_player_profile.sql.
-- One admin action now creates Round 1, closes registration, and opens each
-- credentialed player's private reveal atomically in the same transaction.

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

revoke all on function public.admin_generate_hidden_draw() from public, anon;
grant execute on function public.admin_generate_hidden_draw() to authenticated;
