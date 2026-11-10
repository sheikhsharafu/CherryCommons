-- Apply after supabase-pages-rooms.sql.
begin;

create table if not exists cc_pages.room_presence (
  room_id text not null references cc_pages.rooms(id) on delete cascade,
  session_hash bytea not null,
  client_hash bytea not null,
  organizer_id uuid,
  display_name text not null,
  table_id text,
  expires_at timestamptz not null,
  primary key (room_id, session_hash, client_hash)
);

create index if not exists room_presence_expiry
  on cc_pages.room_presence (room_id, expires_at);

alter table cc_pages.room_presence enable row level security;
revoke all on cc_pages.room_presence from public, anon, authenticated;

create or replace function cc_pages.presence_table_open(
  selected_table jsonb, zone text, checked_at timestamptz
)
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  local_now timestamp;
  local_day integer;
  local_time time;
  period jsonb;
  days jsonb;
  starts time;
  ends time;
begin
  if selected_table is null or selected_table->'forceClosed' = 'true'::jsonb then
    return false;
  end if;
  if jsonb_typeof(selected_table->'closedTimes') is distinct from 'array' then
    return true;
  end if;
  begin
    local_now := timezone(coalesce(zone, 'UTC'), checked_at);
  exception when invalid_parameter_value then
    local_now := timezone('UTC', checked_at);
  end;
  local_day := extract(dow from local_now);
  local_time := local_now::time;

  for period in select value from jsonb_array_elements(selected_table->'closedTimes') loop
    if coalesce(period->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(period->>'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or jsonb_typeof(period->'days') is distinct from 'array' then
      continue;
    end if;
    starts := (period->>'start')::time;
    ends := (period->>'end')::time;
    days := period->'days';
    if (starts < ends and days @> jsonb_build_array(local_day)
         and local_time >= starts and local_time < ends)
       or (starts > ends and (
         (days @> jsonb_build_array(local_day) and local_time >= starts)
         or (days @> jsonb_build_array((local_day + 6) % 7) and local_time < ends)
       )) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function cc_pages.active_room_presence(
  room cc_pages.rooms, checked_at timestamptz
)
returns setof cc_pages.room_presence
language sql stable
set search_path = ''
as $$
  select visitor.*
  from cc_pages.room_presence as visitor
  where visitor.room_id = room.id and visitor.expires_at > checked_at
    and cc_pages.can_enter(room, visitor.session_hash, exists (
      select 1 from public.cc_organizers where user_id = visitor.organizer_id
    ));
$$;

create or replace function public.cc_room_presence(
  p_action text, p_room text, p_session text, p_client text, p_name text, p_table text
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  room cc_pages.rooms;
  guest bytea;
  client_id bytea;
  organizer boolean := cc_pages.is_organizer();
  checked_at timestamptz;
  room_config jsonb;
  selected_table jsonb;
  own_table text;
  requested_table text;
  capacity integer;
  result text;
begin
  if coalesce(p_action, '') not in ('heartbeat', 'claim', 'release', 'leave')
     or p_session is null or p_session !~ '^[0-9a-f]{64}$'
     or p_client is null or p_client !~ '^[0-9a-f]{64}$' then
    return cc_pages.error(400, 'Invalid presence request.');
  end if;
  guest := extensions.digest(p_session, 'sha256');
  client_id := extensions.digest(p_client, 'sha256');

  select * into room from cc_pages.rooms where id = p_room for share;
  if not found then
    return cc_pages.error(404, 'This room was not found.');
  end if;
  if p_action <> 'leave' and not cc_pages.can_enter(room, guest, organizer) then
    return cc_pages.error(403, 'This private room needs a password or a valid invitation.');
  end if;

  -- A room's presence changes are serialized so two browsers cannot take its last seat.
  perform pg_advisory_xact_lock(hashtextextended('cc_pages.presence/' || room.id, 0));
  checked_at := clock_timestamp();
  delete from cc_pages.room_presence where room_id = room.id and expires_at <= checked_at;

  if p_action = 'leave' then
    delete from cc_pages.room_presence where room_id = room.id
      and session_hash = guest and client_hash = client_id;
    return '{}'::jsonb;
  end if;

  select visitor.table_id into own_table
  from cc_pages.room_presence as visitor
  where visitor.room_id = room.id and visitor.session_hash = guest and visitor.client_hash = client_id;

  if p_action = 'release' then
    own_table := null;
  end if;
  requested_table := case when p_action = 'claim' then p_table else own_table end;
  if requested_table is not null then
    room_config := case when room.id = 'commons'
      then (select config from public.cc_directory where id = 1) else room.config end;
    select item into selected_table
    from jsonb_array_elements(room_config->'tables') as items(item)
    where item->>'id' = requested_table;
  end if;

  if p_action = 'claim' then
    if not cc_pages.presence_table_open(selected_table, room_config->>'tz', checked_at) then
      result := 'closed';
    else
      capacity := case when selected_table->>'capacity' ~ '^[1-9][0-9]{0,2}$'
        then (selected_table->>'capacity')::integer else 5 end;
      if (select count(*) from cc_pages.active_room_presence(room, checked_at) as visitor
          where visitor.table_id = requested_table
          and (visitor.session_hash, visitor.client_hash) <> (guest, client_id)) >= capacity then
        result := 'full';
      else
        own_table := requested_table;
        result := 'joined';
      end if;
    end if;
  elsif own_table is not null
        and not cc_pages.presence_table_open(selected_table, room_config->>'tz', checked_at) then
    own_table := null;
  end if;

  insert into cc_pages.room_presence (room_id, session_hash, client_hash, organizer_id,
    display_name, table_id, expires_at)
  values (room.id, guest, client_id, case when organizer then auth.uid() end,
    coalesce(nullif(left(btrim(p_name), 24), ''), 'Guest'), own_table, checked_at + interval '90 seconds')
  on conflict (room_id, session_hash, client_hash) do update
  set organizer_id = excluded.organizer_id, display_name = excluded.display_name,
      table_id = excluded.table_id, expires_at = excluded.expires_at;

  return (
    with active as materialized (select * from cc_pages.active_room_presence(room, checked_at))
    select jsonb_build_object(
      'visitors', coalesce((select jsonb_agg(display_name order by lower(display_name), display_name)
                           from active), '[]'::jsonb),
      'counts', coalesce((select jsonb_object_agg(table_id, seated) from (
        select table_id, count(*) as seated from active where table_id is not null group by table_id
      ) as table_counts), '{}'::jsonb),
      'tableId', own_table,
      'result', result
    )
  );
end;
$$;

revoke all on function cc_pages.presence_table_open(jsonb, text, timestamptz),
  cc_pages.active_room_presence(cc_pages.rooms, timestamptz) from public, anon, authenticated;
revoke all on function public.cc_room_presence(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.cc_room_presence(text, text, text, text, text, text)
  to anon, authenticated;
notify pgrst, 'reload schema';

commit;
