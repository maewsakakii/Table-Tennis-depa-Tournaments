-- depa TABLE TENNIS · Admin can replace a player's avatar
-- Rerunnable. Apply after 010_gender_divisions.sql.
--
-- Some players cannot change their own photo, so an admin needs to do it for them.
-- The new avatar is validated exactly like registration: it must be an object this
-- Supabase project just received under player-avatars/pending, and it must not
-- already belong to another player.

create or replace function public.admin_update_player_avatar(p_public_id text, p_avatar_url text)
returns table (public_id text, nickname text, department text, email text, avatar_url text, registered_at timestamptz, gender text, is_demo boolean, demo_slot smallint)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  updated_player public.players%rowtype;
  request_host text;
  expected_prefix text;
  avatar_filename text;
  avatar_object_name text;
begin
  if not public.is_tournament_admin() then raise exception 'admin access required'; end if;

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
    select 1 from storage.objects o where o.bucket_id = 'player-avatars' and o.name = avatar_object_name
  ) then raise exception 'avatar object does not exist'; end if;
  if exists (select 1 from public.players p where p.avatar_url = p_avatar_url) then
    raise exception 'avatar object is already registered';
  end if;

  update public.players p set avatar_url = p_avatar_url
  where p.public_id = p_public_id
  returning p.* into updated_player;
  if updated_player.id is null then raise exception 'player not found'; end if;

  return query select updated_player.public_id::text, updated_player.nickname::text, updated_player.department::text,
    updated_player.email::text, updated_player.avatar_url::text, updated_player.registered_at::timestamptz,
    updated_player.gender::text, updated_player.is_demo::boolean, updated_player.demo_slot::smallint;
end;
$$;

revoke all on function public.admin_update_player_avatar(text, text) from public, anon;
grant execute on function public.admin_update_player_avatar(text, text) to authenticated;
