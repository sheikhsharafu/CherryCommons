-- Run once in the SQL Editor of the Cherry Commons project.
-- This directory is public. Only publish meeting links intended for public access.
begin;

create table if not exists public.cc_organizers (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.cc_directory (
  id smallint primary key check (id = 1),
  revision integer not null default 0 check (revision >= 0),
  config jsonb not null check (
    jsonb_typeof(config) = 'object'
    and config ? 'tables' and jsonb_typeof(config->'tables') = 'array'
    and config ? 'tz' and jsonb_typeof(config->'tz') = 'string'
  )
);

alter table public.cc_organizers enable row level security;
alter table public.cc_directory enable row level security;

revoke all on public.cc_organizers, public.cc_directory from public, anon, authenticated;
grant select on public.cc_directory to anon, authenticated;
grant select on public.cc_organizers to authenticated;
grant update (config, revision) on public.cc_directory to authenticated;

drop policy if exists "Read own organizer membership" on public.cc_organizers;
create policy "Read own organizer membership"
  on public.cc_organizers for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Read public directory" on public.cc_directory;
create policy "Read public directory"
  on public.cc_directory for select to anon, authenticated
  using (true);

drop policy if exists "Organizers update directory" on public.cc_directory;
create policy "Organizers update directory"
  on public.cc_directory for update to authenticated
  using (exists (select 1 from public.cc_organizers where user_id = (select auth.uid())))
  with check (exists (select 1 from public.cc_organizers where user_id = (select auth.uid())));

insert into public.cc_directory (id, config)
select 1, jsonb_build_object(
  'tz', 'America/New_York',
  'tables', jsonb_agg(jsonb_build_object(
    'id', 'table-' || lpad(n::text, 2, '0'),
    'name', 'Table ' || lpad(n::text, 2, '0'),
    'capacity', 5, 'host', '', 'caption', '', 'meeting', null,
    'closedTimes', jsonb_build_array(), 'forceClosed', false
  ) order by n)
)
from generate_series(1, 12) as starter(n)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cc_directory'
  ) then
    alter publication supabase_realtime add table public.cc_directory;
  end if;
end;
$$;

commit;

-- After creating your email/password user under Authentication → Users,
-- copy its User UID. Replace the placeholder and run these three lines separately:
-- insert into public.cc_organizers (user_id)
-- values ('YOUR_AUTH_USER_UID'::uuid)
-- on conflict do nothing;
