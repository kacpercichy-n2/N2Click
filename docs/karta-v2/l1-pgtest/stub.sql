-- Minimalna atrapa środowiska Supabase dla testu migracji L1 (karta-v2).
-- Tylko to, czego dotykają migracje czatu 20260813* / 20260824* /
-- 20260825120000-130000 i 20261102*. Treść helperów `app`/`core` skopiowana
-- 1:1 z migracji produkcyjnych (stan po 20260731084109).

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema core;
create schema app;
create schema n2click;
create schema realtime;
create schema storage;
grant usage on schema auth, core, app, n2click, realtime, storage to anon, authenticated, service_role;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

alter default privileges in schema n2click grant all on tables to anon, authenticated, service_role;
alter default privileges in schema n2click grant execute on functions to anon, authenticated, service_role;

-- core ------------------------------------------------------------------------
create type core.access_role as enum ('administrator', 'manager', 'worker');
create table core.companies (id uuid primary key);
create table core.profiles (
  id uuid primary key,
  access_role core.access_role not null default 'worker',
  first_name text
);
create table core.app_access (
  user_id uuid not null,
  app text not null,
  role text not null default 'member',
  company_id uuid not null references core.companies(id),
  primary key (user_id, app)
);
grant select on core.profiles to authenticated;

create or replace function core.has_app(p_app text)
returns boolean language sql stable
as $$ select (auth.jwt() -> 'app_roles' ->> p_app) is not null $$;
create or replace function core.company_for(p_app text)
returns uuid language sql stable
as $$ select nullif(auth.jwt() -> 'app_company' ->> p_app, '')::uuid $$;
create or replace function core.app_role(p_app text)
returns text language sql stable
as $$ select auth.jwt() -> 'app_roles' ->> p_app $$;
grant execute on all functions in schema core to anon, authenticated, service_role;

-- n2click: planer -------------------------------------------------------------
create table n2click.projects (id uuid primary key, company_id uuid references core.companies(id));
create table n2click.tasks (id uuid primary key, project_id uuid references n2click.projects(id), title text);
create table n2click.task_assignments (
  task_id uuid references n2click.tasks(id) on delete cascade,
  profile_id uuid references core.profiles(id) on delete cascade,
  primary key (task_id, profile_id)
);
create table n2click.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references n2click.projects (id) on delete cascade,
  task_id uuid references n2click.tasks (id) on delete cascade,
  check (num_nonnulls(project_id, task_id) = 1),
  author_id uuid references core.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 10000),
  mention_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create table n2click.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references core.profiles (id) on delete cascade,
  type text not null check (char_length(type) between 1 and 100),
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  emailed_at timestamptz
);
alter table n2click.tasks enable row level security;
alter table n2click.notifications enable row level security;
revoke all on n2click.notifications from anon;
grant select, insert, update on n2click.notifications to authenticated;

-- app: helpery (kopie z produkcji) -------------------------------------------
create or replace function app.current_access_role()
returns core.access_role language sql stable security definer set search_path to ''
as $$ select p.access_role from core.profiles p where p.id = (select auth.uid()); $$;
create or replace function app.is_administrator()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(app.current_access_role() = 'administrator', false); $$;
create or replace function app.is_manager()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(app.current_access_role() = 'manager', false); $$;
create or replace function app.is_assigned_to_task(target_task uuid)
returns boolean language sql stable security definer set search_path to ''
as $$ select exists (select 1 from n2click.task_assignments ta
  where ta.task_id = target_task and ta.profile_id = (select auth.uid())); $$;
create or replace function app.company_ok_project(target_project uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select target_project is null
    or (select core.app_role('n2click')) = 'admin'
    or not exists (
      select 1 from n2click.projects pr
      where pr.id = target_project
        and pr.company_id is not null
        and pr.company_id is distinct from (select core.company_for('n2click'))
    );
$$;
revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated;

-- Polityka tasks_select w stanie produkcyjnym (po bramce has_app i spółce).
create policy "tasks_select" on n2click.tasks for select to authenticated
  using ((select core.has_app('n2click')) and ((app.is_administrator() or app.is_manager() or app.is_assigned_to_task(id))) and app.company_ok_project(project_id));
grant select on n2click.tasks to authenticated;

-- Polityki powiadomień w stanie produkcyjnym.
create policy "notifications_select" on n2click.notifications for select to authenticated
  using ((select core.has_app('n2click')) and (recipient_id = (select auth.uid())));
create policy "notifications_insert" on n2click.notifications for insert to authenticated
  with check ((select core.has_app('n2click')) and (true));
create policy "notifications_update" on n2click.notifications for update to authenticated
  using ((select core.has_app('n2click')) and (recipient_id = (select auth.uid())))
  with check ((select core.has_app('n2click')) and (recipient_id = (select auth.uid())));

-- realtime ------------------------------------------------------------------
create table realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null default 'broadcast',
  event text,
  payload jsonb,
  private boolean
);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;
create or replace function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$
  insert into realtime.messages (topic, extension, event, payload, private)
  values (topic, 'broadcast', event, payload, private);
$$;
create or replace function realtime.broadcast_changes(
  topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record,
  level text default 'ROW')
returns void language plpgsql as $$
begin
  insert into realtime.messages (topic, extension, event, payload, private)
  values (topic_name, 'broadcast', event_name,
    jsonb_build_object('record', to_jsonb(new), 'old_record', to_jsonb(old), 'operation', operation), true);
end;
$$;
grant execute on all functions in schema realtime to authenticated;

-- storage -------------------------------------------------------------------
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner_id text
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
