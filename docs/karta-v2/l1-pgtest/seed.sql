-- Dane testowe + helpery asercji (schemat `t`, tylko w klastrze testowym).
create schema t;
grant usage on schema t to authenticated, anon;

-- Logowanie: claimy JWT budowane z core.app_access tak jak hook produkcyjny.
create or replace function t.login(p_user uuid) returns void language plpgsql as $$
declare v_claims jsonb := jsonb_build_object('sub', p_user, 'role', 'authenticated');
begin
  select v_claims
    || jsonb_build_object('app_roles', coalesce(jsonb_object_agg(app, role), '{}'::jsonb))
    || jsonb_build_object('app_company', coalesce(jsonb_object_agg(app, company_id), '{}'::jsonb))
  into v_claims
  from core.app_access where user_id = p_user;
  perform set_config('request.jwt.claims', v_claims::text, false);
end;
$$;

create or replace function t.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'ASSERT FAILED: %', p_msg;
  end if;
  raise notice 'ok: %', p_msg;
end;
$$;

-- Wykonuje SQL i oczekuje błędu (dowolnego albo o danym SQLSTATE).
create or replace function t.fails(p_sql text, p_msg text, p_state text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_state is not null and sqlstate <> p_state then
      raise exception 'ASSERT FAILED: % (oczekiwano %, jest % %)', p_msg, p_state, sqlstate, sqlerrm;
    end if;
    raise notice 'ok (odrzucone %): %', sqlstate, p_msg;
    return;
  end;
  raise exception 'ASSERT FAILED: % (przeszło, a miało być odrzucone)', p_msg;
end;
$$;
grant execute on all functions in schema t to authenticated;

-- Spółki, osoby, projekty, zadania.
insert into core.companies values
  ('c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002');

-- A, W2: wykonawcy T1 (C1). B: pracownik C1 bez przypisania do T1.
-- M: menedżer C1. X: menedżer innej spółki (C2). R: administrator z rolą
-- aplikacji 'admin' w C2. N: menedżer bez dostępu do aplikacji n2click.
insert into core.profiles (id, access_role, first_name) values
  ('a0000000-0000-4000-8000-00000000000a', 'worker', 'A'),
  ('b0000000-0000-4000-8000-00000000000b', 'worker', 'B'),
  ('d0000000-0000-4000-8000-00000000000d', 'worker', 'W2'),
  ('e0000000-0000-4000-8000-00000000000e', 'manager', 'M'),
  ('f0000000-0000-4000-8000-00000000000f', 'manager', 'X'),
  ('10000000-0000-4000-8000-000000000010', 'administrator', 'R'),
  ('11000000-0000-4000-8000-000000000011', 'manager', 'N');
insert into core.app_access (user_id, app, role, company_id) values
  ('a0000000-0000-4000-8000-00000000000a', 'n2click', 'member', 'c1000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-00000000000b', 'n2click', 'member', 'c1000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-00000000000d', 'n2click', 'member', 'c1000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-00000000000e', 'n2click', 'manager', 'c1000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-00000000000f', 'n2click', 'manager', 'c2000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000010', 'n2click', 'admin', 'c2000000-0000-4000-8000-000000000002');

insert into n2click.projects values
  ('9a000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-000000000001'),
  ('9a000000-0000-4000-8000-0000000000a2', 'c2000000-0000-4000-8000-000000000002');
insert into n2click.tasks values
  ('7a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-0000000000a1', 'T1'),
  ('7a000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-0000000000a2', 'T2'),
  ('7a000000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-0000000000a1', 'T3');
insert into n2click.task_assignments values
  ('7a000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a'),
  ('7a000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000d'),
  ('7a000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-00000000000b');

-- Komentarze sprzed migracji (import 20261102102000).
insert into n2click.comments (id, task_id, project_id, author_id, body, mention_ids, created_at) values
  ('cc000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', null,
   'a0000000-0000-4000-8000-00000000000a', 'Pierwszy @W2 @B',
   '{d0000000-0000-4000-8000-00000000000d,b0000000-0000-4000-8000-00000000000b}', '2026-10-01 10:00+00'),
  ('cc000000-0000-4000-8000-000000000002', '7a000000-0000-4000-8000-000000000001', null,
   'd0000000-0000-4000-8000-00000000000d', 'Drugi', '{}', '2026-10-02 10:00+00'),
  ('cc000000-0000-4000-8000-000000000003', '7a000000-0000-4000-8000-000000000001', null,
   null, 'Autor usunięty', '{}', '2026-10-03 10:00+00'),
  ('cc000000-0000-4000-8000-000000000004', '7a000000-0000-4000-8000-000000000001', null,
   'a0000000-0000-4000-8000-00000000000a', repeat('x', 4001), '{}', '2026-10-04 10:00+00'),
  ('cc000000-0000-4000-8000-000000000005', '7a000000-0000-4000-8000-000000000003', null,
   'b0000000-0000-4000-8000-00000000000b', 'Na T3', '{}', '2026-10-05 10:00+00'),
  ('cc000000-0000-4000-8000-000000000006', null, '9a000000-0000-4000-8000-0000000000a1',
   'a0000000-0000-4000-8000-00000000000a', 'Komentarz projektu', '{}', '2026-10-06 10:00+00');

create table t.u (name text primary key, id uuid not null);
insert into t.u values
  ('A', 'a0000000-0000-4000-8000-00000000000a'), ('B', 'b0000000-0000-4000-8000-00000000000b'),
  ('W2', 'd0000000-0000-4000-8000-00000000000d'), ('M', 'e0000000-0000-4000-8000-00000000000e'),
  ('X', 'f0000000-0000-4000-8000-00000000000f'), ('R', '10000000-0000-4000-8000-000000000010'),
  ('N', '11000000-0000-4000-8000-000000000011'),
  ('T1', '7a000000-0000-4000-8000-000000000001'), ('T2', '7a000000-0000-4000-8000-000000000002'),
  ('T3', '7a000000-0000-4000-8000-000000000003');
create or replace function t.id(p text) returns uuid language sql stable security definer set search_path = ''
  as $$ select id from t.u where name = p $$;
create or replace function t.conv(p_task text) returns uuid language sql stable security definer set search_path = ''
  as $$ select c.id from n2click.conversations c where c.context_type = 'task' and c.context_id = t.id(p_task) $$;
create or replace function t.notes(p_user text, p_type text default null) returns bigint language sql stable security definer set search_path = ''
  as $$ select count(*) from n2click.notifications n where n.recipient_id = t.id(p_user) and (p_type is null or n.type = p_type) $$;
create or replace function t.is_member(p_user text, p_task text) returns boolean language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from n2click.conversation_members m where m.conversation_id = t.conv(p_task) and m.user_id = t.id(p_user)) $$;
grant execute on all functions in schema t to authenticated;
create or replace function t.notes_for(p_user text, p_body text, p_type text default null) returns bigint language sql stable security definer set search_path = ''
  as $$ select count(*) from n2click.notifications n join n2click.messages m on m.id::text = n.payload->>'messageId'
        where n.recipient_id = t.id(p_user) and m.body = p_body and (p_type is null or n.type = p_type) $$;
grant execute on function t.notes_for(text, text, text) to authenticated;
grant execute on function t.fails(text, text, text) to anon;
