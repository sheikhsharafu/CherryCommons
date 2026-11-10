-- Apply after the original supabase-setup.sql. Existing organizers and tables are reused.
begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists cc_pages;
revoke all on schema cc_pages from public, anon, authenticated;

do $$
begin
  if to_regclass('public.cc_organizers') is null
     or to_regclass('public.cc_directory') is null then
    raise exception 'Run supabase-setup.sql before the Pages rooms migration.';
  end if;
  if to_regprocedure('extensions.crypt(text,text)') is null then
    raise exception 'Cherry Commons expects pgcrypto in the extensions schema.';
  end if;
  if not exists (select 1 from public.cc_directory where id = 1) then
    raise exception 'The default Cherry Commons directory is missing. Run supabase-setup.sql first.';
  end if;
end;
$$;

create table if not exists cc_pages.rooms (
  id text primary key,
  name text not null,
  visibility text not null check (visibility in ('public', 'private')),
  config jsonb,
  config_revision integer not null default 0,
  revision integer not null default 0,
  password_hash text,
  invite_hash bytea,
  invite_expires timestamptz,
  created_at timestamptz not null default now(),
  check ((id = 'commons') = (config is null))
);

create table if not exists cc_pages.room_grants (
  room_id text not null references cc_pages.rooms(id) on delete cascade,
  session_hash bytea not null,
  kind text not null check (kind in ('password', 'invite')),
  credential_hash bytea not null,
  expires_at timestamptz not null,
  primary key (room_id, session_hash, kind)
);
create index if not exists room_grants_expiry on cc_pages.room_grants (expires_at);

create table if not exists cc_pages.password_attempts (
  room_id text primary key references cc_pages.rooms(id) on delete cascade,
  window_started timestamptz not null,
  attempts integer not null
);

alter table cc_pages.rooms enable row level security;
alter table cc_pages.room_grants enable row level security;
alter table cc_pages.password_attempts enable row level security;
revoke all on all tables in schema cc_pages from public, anon, authenticated;

create table if not exists cc_pages.room_bootstrap (
  id boolean primary key default true check (id)
);
alter table cc_pages.room_bootstrap enable row level security;
revoke all on cc_pages.room_bootstrap from public, anon, authenticated;

with first_setup as (
  insert into cc_pages.room_bootstrap (id) values (true)
  on conflict (id) do nothing returning id
)
insert into cc_pages.rooms (id, name, visibility)
select 'commons', 'Cherry Commons', 'public' from first_setup
on conflict (id) do nothing;

create or replace function cc_pages.is_organizer()
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from public.cc_organizers where user_id = (select auth.uid()));
$$;

-- Keep the original directory API working for the public default floor.
-- Restrictive RLS also protects it if the organizer later makes that floor private.
create or replace function cc_pages.legacy_directory_visible()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from cc_pages.rooms where id = 'commons' and visibility = 'public')
      or cc_pages.is_organizer();
$$;

drop policy if exists "Cherry Commons floor visibility" on public.cc_directory;
create policy "Cherry Commons floor visibility" on public.cc_directory
as restrictive for select to anon, authenticated
using ((select cc_pages.legacy_directory_visible()));

create or replace function cc_pages.can_enter(
  room cc_pages.rooms, guest bytea, organizer boolean
)
returns boolean
language sql stable
set search_path = ''
as $$
  select room.visibility = 'public' or organizer or exists (
    select 1 from cc_pages.room_grants as access
    where access.room_id = room.id and access.session_hash = guest and access.expires_at > now()
      and (
        (access.kind = 'password' and access.credential_hash = extensions.digest(room.password_hash, 'sha256'))
        or (access.kind = 'invite' and access.credential_hash = room.invite_hash and room.invite_expires > now())
      )
  );
$$;

create or replace function cc_pages.room_summary(
  room cc_pages.rooms, guest bytea, organizer boolean
)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', room.id, 'name', room.name, 'visibility', room.visibility,
    'canEnter', cc_pages.can_enter(room, guest, organizer),
    'hasPassword', room.password_hash is not null, 'revision', room.revision
  ) || case when organizer then
    jsonb_build_object('inviteExpires', room.invite_expires)
  else '{}'::jsonb end;
$$;

create or replace function cc_pages.room_snapshot(
  room cc_pages.rooms, guest bytea, organizer boolean
)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'room', cc_pages.room_summary(room, guest, organizer),
    'config', case when room.id = 'commons'
      then (select config from public.cc_directory where id = 1) else room.config end,
    'revision', case when room.id = 'commons'
      then (select revision from public.cc_directory where id = 1) else room.config_revision end,
    'admin', organizer
  );
$$;

create or replace function cc_pages.error(status integer, message text)
returns jsonb
language sql immutable
set search_path = ''
as $$ select jsonb_build_object('status', status, 'error', message); $$;

create or replace function public.cc_room_request(
  p_action text, p_room text, p_session text, p_payload jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  room cc_pages.rooms;
  organizer boolean := cc_pages.is_organizer();
  guest bytea;
  room_name text;
  next_visibility text;
  password text;
  next_password_hash text;
  token text;
  credential bytea;
  grant_kind text;
  expiry timestamptz;
  attempts integer;
  expected_revision integer;
  next_config jsonb;
  changed boolean;
begin
  if p_session is null or p_session !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_payload) is distinct from 'object' then
    return cc_pages.error(400, 'Invalid room request.');
  end if;
  guest := extensions.digest(p_session, 'sha256');

  if p_action = 'lobby' then
    return jsonb_build_object('admin', organizer, 'rooms', coalesce((
      select jsonb_agg(cc_pages.room_summary(item, guest, organizer) order by item.created_at, item.id)
      from cc_pages.rooms as item
    ), '[]'::jsonb));
  end if;

  if coalesce(p_action, '') not in ('read', 'enter', 'create', 'settings', 'invite', 'tables', 'delete') then
    return cc_pages.error(404, 'Unknown room request.');
  end if;
  if p_action not in ('read', 'enter') and not organizer then
    return cc_pages.error(403, 'Sign in as an organizer to make changes.');
  end if;

  if p_action in ('read', 'enter') then
    -- Keep the visibility and credentials stable while reading the floor configuration.
    select * into room from cc_pages.rooms where id = p_room for share;
  elsif p_action <> 'create' then
    select * into room from cc_pages.rooms where id = p_room for update;
  end if;
  if p_action <> 'create' and room.id is null then
    return cc_pages.error(404, 'This room was not found.');
  end if;

  if p_action in ('read', 'enter') then
    if cc_pages.can_enter(room, guest, organizer) then
      return cc_pages.room_snapshot(room, guest, organizer);
    end if;
    if p_action = 'read' then
      return cc_pages.error(403, 'This private room needs a password or a valid invitation.');
    end if;

    token := p_payload->>'invite';
    password := p_payload->>'password';
    if token ~ '^[A-Za-z0-9_-]{43}$' and room.invite_expires > now()
       and extensions.digest(token, 'sha256') = room.invite_hash then
      grant_kind := 'invite';
      credential := room.invite_hash;
      expiry := least(now() + interval '8 hours', room.invite_expires);
    elsif room.password_hash is not null and password is not null and octet_length(password) <= 72 then
      -- A room-wide window applies even when a visitor changes browser tokens.
      insert into cc_pages.password_attempts as limits (room_id, window_started, attempts)
      values (room.id, clock_timestamp(), 1)
      on conflict (room_id) do update
      set window_started = case when limits.window_started <= clock_timestamp() - interval '1 minute'
                                then clock_timestamp() else limits.window_started end,
          attempts = case when limits.window_started <= clock_timestamp() - interval '1 minute'
                          then 1 else limits.attempts + 1 end
      where limits.window_started <= clock_timestamp() - interval '1 minute' or limits.attempts < 20
      returning limits.attempts into attempts;
      if attempts is null then
        return cc_pages.error(429, 'Too many room password attempts. Wait one minute or use an invite link.');
      end if;
      if extensions.crypt(password, room.password_hash) = room.password_hash then
        grant_kind := 'password';
        credential := extensions.digest(room.password_hash, 'sha256');
        expiry := now() + interval '8 hours';
      end if;
    end if;

    if credential is null then
      return cc_pages.error(403, 'The room password or invite link is invalid or expired.');
    end if;
    delete from cc_pages.room_grants where expires_at <= now();
    insert into cc_pages.room_grants (room_id, session_hash, kind, credential_hash, expires_at)
    values (room.id, guest, grant_kind, credential, expiry)
    on conflict (room_id, session_hash, kind) do update
    set credential_hash = excluded.credential_hash, expires_at = excluded.expires_at;
    return cc_pages.room_snapshot(room, guest, organizer);
  end if;

  if p_action in ('settings', 'tables', 'delete') then
    if jsonb_typeof(p_payload->'revision') is distinct from 'number'
       or (p_payload->>'revision') !~ '^[0-9]{1,9}$' then
      return cc_pages.error(400, 'A valid revision is required.');
    end if;
    expected_revision := (p_payload->>'revision')::integer;
  end if;

  if p_action = 'delete' then
    if expected_revision <> room.revision then
      return cc_pages.error(409, 'Room settings changed. Reload and try again.');
    end if;
    if room.id = 'commons' then
      update public.cc_directory
      set config = jsonb_set(config, '{tables}', '[]'::jsonb), revision = revision + 1
      where id = 1;
    end if;
    delete from cc_pages.rooms where id = room.id;
    return jsonb_build_object('deleted', room.id);
  end if;

  if p_action in ('create', 'settings') then
    room_name := btrim(p_payload->>'name');
    next_visibility := p_payload->>'visibility';
    password := p_payload->>'password';
    if room_name is null or char_length(room_name) not between 1 and 40 then
      return cc_pages.error(400, 'Enter a room name with 1 to 40 characters.');
    end if;
    if coalesce(next_visibility, '') not in ('public', 'private') then
      return cc_pages.error(400, 'Choose a public or private room.');
    end if;
    if password is not null and (char_length(password) < 8 or octet_length(password) > 72) then
      return cc_pages.error(400, 'Use at least 8 characters and at most 72 UTF-8 bytes for the room password.');
    end if;
    if password is not null and p_payload->'removePassword' = 'true'::jsonb then
      return cc_pages.error(400, 'Choose either a new password or removal of the current one.');
    end if;
    if p_action = 'settings' and expected_revision <> room.revision then
      return cc_pages.error(409, 'Room settings changed. Reload and try again.');
    end if;
    next_password_hash := room.password_hash;
    if next_visibility = 'public' or p_payload->'removePassword' = 'true'::jsonb then
      next_password_hash := null;
    elsif password is not null then
      next_password_hash := extensions.crypt(password, extensions.gen_salt('bf', 12));
    end if;

    if p_action = 'create' then
      insert into cc_pages.rooms (id, name, visibility, password_hash, config)
      values (encode(extensions.gen_random_bytes(12), 'hex'), room_name, next_visibility, next_password_hash,
        '{"tz":"America/New_York","tables":[{"id":"table-01","name":"Table 01","capacity":5,"closedTimes":[]}]}'::jsonb)
      returning * into room;
    else
      update cc_pages.rooms as item
      set name = room_name, visibility = next_visibility, password_hash = next_password_hash,
          invite_hash = case when next_visibility = 'private' then item.invite_hash end,
          invite_expires = case when next_visibility = 'private' then item.invite_expires end,
          revision = item.revision + 1
      where item.id = room.id
      returning * into room;
    end if;
    return jsonb_build_object('room', cc_pages.room_summary(room, guest, organizer));
  end if;

  if p_action = 'invite' then
    if room.visibility <> 'private' then
      return cc_pages.error(400, 'Invite links are available for private rooms.');
    end if;
    if p_payload->'revoke' is distinct from 'true'::jsonb then
      token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
      expiry := now() + interval '24 hours';
    end if;
    update cc_pages.rooms set invite_hash = extensions.digest(token, 'sha256'), invite_expires = expiry
    where id = room.id;
    return jsonb_build_object('token', token, 'expires', expiry);
  end if;

  next_config := p_payload->'config';
  if jsonb_typeof(next_config) is distinct from 'object'
     or jsonb_typeof(next_config->'tables') is distinct from 'array'
     or jsonb_typeof(next_config->'tz') is distinct from 'string'
     or octet_length(next_config::text) > 2000000
     or char_length(next_config->>'tz') > 100 then
    return cc_pages.error(400, 'Invalid room table configuration.');
  end if;
  if jsonb_array_length(next_config->'tables') > 1000 or exists (
    select 1 from jsonb_array_elements(next_config->'tables') as tables(item)
    where jsonb_typeof(item) is distinct from 'object'
       or coalesce(item->>'id', '') !~ '^[a-z0-9-]{1,80}$'
       or (
         item->'meeting' is not null and item->'meeting' <> 'null'::jsonb
         and (coalesce(item->'meeting'->>'url', '') !~ '^https://'
              or char_length(item->'meeting'->>'url') > 4096)
       )
  ) or exists (
    select 1 from jsonb_array_elements(next_config->'tables') as tables(item)
    group by item->>'id' having count(*) > 1
  ) then
    return cc_pages.error(400, 'Use unique table IDs and HTTPS meeting links. Each room supports up to 1,000 tables.');
  end if;

  if room.id = 'commons' then
    update public.cc_directory set config = next_config, revision = revision + 1
    where id = 1 and revision = expected_revision;
    changed := found;
  else
    update cc_pages.rooms set config = next_config, config_revision = config_revision + 1
    where id = room.id and config_revision = expected_revision
    returning * into room;
    changed := found;
  end if;
  if not changed then
    return cc_pages.error(409, 'The tables changed in another tab. Review the latest version and try again.');
  end if;
  return cc_pages.room_snapshot(room, guest, organizer);
end;
$$;

revoke all on all functions in schema cc_pages from public, anon, authenticated;
grant usage on schema cc_pages to anon, authenticated;
grant execute on function cc_pages.legacy_directory_visible() to anon, authenticated;
revoke all on function public.cc_room_request(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cc_room_request(text, text, text, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';

commit;
