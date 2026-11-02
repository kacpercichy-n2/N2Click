-- Scenariusze L1: import, widoczność, wiadomości, powiadomienia, pin, odczyt,
-- utrata wglądu, próby podrobienia, Storage. Każde `t.ok` / `t.fails` przerywa
-- przebieg przy pierwszym niespełnionym warunku (ON_ERROR_STOP).

-- 1. Import komentarzy -------------------------------------------------------
select t.ok((select count(*) from n2click.comments) = 6, 'import nie kasuje komentarzy');
select t.ok((select count(*) from n2click.notifications) = 0, 'import nie tworzy powiadomień');
select t.ok((select count(*) from realtime.messages) = 0, 'import nie nadaje broadcastów');
select t.ok(t.conv('T1') is not null and t.conv('T3') is not null and t.conv('T2') is null, 'rozmowy dla zadań z komentarzami');
select t.ok((select array_agg(id order by created_at) from n2click.messages where conversation_id = t.conv('T1'))
  = array['cc000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000002']::uuid[],
  'T1: dwa importowalne komentarze (bez autora i >4000 pominięte), te same id');
select t.ok((select created_at from n2click.messages where id = 'cc000000-0000-4000-8000-000000000001') = '2026-10-01 10:00+00',
  'created_at zachowane');
select t.ok((select created_by = t.id('A') and created_at = '2026-10-01 10:00+00' and last_message_at = '2026-10-02 10:00+00'
  from n2click.conversations where id = t.conv('T1')), 'rozmowa T1: twórca, created_at i last_message_at z komentarzy');
select t.ok(t.is_member('A', 'T1') and t.is_member('W2', 'T1') and not t.is_member('B', 'T1'),
  'obserwujący T1: autorzy i wykonawcy; wspomniany B bez wglądu nie dołączył');
select t.ok(t.is_member('B', 'T3'), 'obserwujący T3: autor');
select t.ok((select bool_and(last_read_at = 'epoch') from n2click.conversation_members), 'import nie udaje odczytów');
select t.ok((select count(*) from pg_trigger where tgrelid in ('n2click.messages'::regclass, 'n2click.conversations'::regclass,
  'n2click.conversation_members'::regclass) and not tgisinternal and tgenabled <> 'O') = 0, 'wszystkie triggery z powrotem włączone');

-- 2. Parytet widoczności: chat_can_read_task == tasks_select, dla każdej osoby
do $$
declare
  u record; tk record; v_rls boolean; v_fn boolean; v_user_fn boolean;
begin
  for u in select name, id from t.u where name in ('A','B','W2','M','X','R','N') loop
    perform t.login(u.id);
    for tk in select name, id from t.u where name like 'T%' loop
      perform set_config('role', 'authenticated', true);
      select exists (select 1 from n2click.tasks where id = tk.id) into v_rls;
      perform set_config('role', 'postgres', true);
      v_fn := app.chat_can_read_task(tk.id);
      v_user_fn := app.chat_user_can_read_task(u.id, tk.id);
      if v_rls is distinct from v_fn or v_rls is distinct from v_user_fn then
        raise exception 'ASSERT FAILED: parytet % / %: tasks_select=% chat_can_read_task=% chat_user_can_read_task=%',
          u.name, tk.name, v_rls, v_fn, v_user_fn;
      end if;
    end loop;
  end loop;
  raise notice 'ok: parytet widoczności 7 osób x 3 zadania';
end;
$$;

-- 3. chat_open_task -----------------------------------------------------------
select t.login(t.id('A')); set role authenticated;
select t.ok(n2click.chat_open_task(t.id('T1')) = t.conv('T1'), 'A otwiera T1: ta sama rozmowa co import');
select t.fails($$select n2click.chat_open_task('7a000000-0000-4000-8000-000000000002')$$, 'A nie otworzy T2 (inna spółka)', '42501');
select t.fails($$select n2click.chat_open_task(gen_random_uuid())$$, 'nieistniejące zadanie = 42501, bez wyroczni', '42501');
select t.fails($$select app.chat_user_can_read_task('a0000000-0000-4000-8000-00000000000a', '7a000000-0000-4000-8000-000000000001')$$,
  'wyrocznia widoczności niedostępna dla klienta', '42501');
reset role;
select t.login(t.id('B')); set role authenticated;
select t.fails($$select n2click.chat_open_task('7a000000-0000-4000-8000-000000000001')$$, 'B (bez przypisania) nie otworzy T1', '42501');
select t.ok((select count(*) from n2click.conversations) = 1, 'B widzi tylko swoją rozmowę T3');
reset role;
select t.login(t.id('X')); set role authenticated;
select t.fails($$select n2click.chat_open_task('7a000000-0000-4000-8000-000000000001')$$, 'X (menedżer innej spółki) nie otworzy T1', '42501');
select t.ok(n2click.chat_open_task(t.id('T2')) is not null, 'X otwiera T2 swojej spółki (zadanie bez komentarzy)');
reset role;
select t.login(t.id('N')); set role authenticated;
select t.fails($$select n2click.chat_open_task('7a000000-0000-4000-8000-000000000001')$$, 'N bez dostępu do n2click', '42501');
reset role;
select t.login(t.id('M')); set role authenticated;
select n2click.chat_open_task(t.id('T1'));
reset role;
select t.login(t.id('R')); set role authenticated;
select n2click.chat_open_task(t.id('T1'));
reset role;
select t.ok(t.is_member('M', 'T1') and t.is_member('R', 'T1') and not t.is_member('X', 'T1'), 'M i R dołączyli przez otwarcie, X nie');
select t.ok((select count(*) from n2click.conversations where context_type = 'task' and context_id = t.id('T1')) = 1, 'jedna rozmowa na zadanie');

-- 4. Wiadomości i powiadomienia -----------------------------------------------
select t.login(t.id('A')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body, mention_ids)
values (t.conv('T1'), t.id('A'), 'Hej @M @B', array[t.id('M'), t.id('B'), t.id('A'), t.id('M')]);
reset role;
select t.ok(t.notes('M', 'task_mention') = 1 and t.notes('M') = 1, 'M: jedna task_mention (wzmianka wygrywa, bez duplikatu)');
select t.ok(t.notes_for('W2', 'Hej @M @B', 'task_message') = 1 and t.notes_for('R', 'Hej @M @B', 'task_message') = 1, 'W2 i R: task_message');
select t.ok(t.notes('A') = 0 and t.notes('B') = 0, 'autor bez powiadomienia; B bez wglądu bez powiadomienia');
select t.ok(not t.is_member('B', 'T1'), 'wzmianka nie wpuszcza osoby bez wglądu');
select t.ok((select mention_ids from n2click.messages where body = 'Hej @M @B') = array[t.id('B'), t.id('M')]
  or (select mention_ids from n2click.messages where body = 'Hej @M @B') = array[t.id('M'), t.id('B')],
  'wzmianki zdeduplikowane, bez autora');
select t.ok((select payload ?& array['taskId','conversationId','messageId','actorId'] and payload->>'taskId' = t.id('T1')::text
  and payload->>'actorId' = t.id('A')::text from n2click.notifications where recipient_id = t.id('M')), 'payload powiadomienia');
select t.ok((select bool_and(emailed_at is not null) from n2click.notifications), 'powiadomienia czatu pominięte przez maile');

select t.login(t.id('A')); set role authenticated;
-- załączniki
insert into n2click.messages (conversation_id, author_id, body, attachments)
select t.conv('T1'), t.id('A'), '', jsonb_build_array(jsonb_build_object(
  'path', t.conv('T1')::text || '/' || gen_random_uuid()::text || '.png', 'mime', 'image/png',
  'width', 100, 'height', 50, 'size', 1234, 'name', 'Zrzut ekranu'));
select t.ok((select count(*) from n2click.messages where body = '' and jsonb_array_length(attachments) = 1) = 1, 'pusta treść z obrazem przechodzi');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body) values (%L, %L, '')$q$, t.conv('T1'), t.id('A')),
  'pusta treść bez obrazu odrzucona', '23514');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, attachments) values (%L, %L, 'x',
  jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/png', 'width', 1, 'height', 1, 'size', 1, 'name', 'a')))$q$,
  t.conv('T1'), t.id('A'), t.conv('T3')::text || '/' || gen_random_uuid()::text || '.png'),
  'ścieżka z cudzej rozmowy odrzucona', '22023');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, attachments) values (%L, %L, 'x',
  jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/png', 'width', 1, 'height', 1, 'size', 1, 'name', 'a')))$q$,
  t.conv('T1'), t.id('A'), t.conv('T1')::text || '/../' || t.conv('T3')::text || '/x.png'),
  'ścieżka z ../ odrzucona', '22023');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, attachments) values (%L, %L, 'x',
  jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/svg+xml', 'width', 1, 'height', 1, 'size', 1, 'name', 'a')))$q$,
  t.conv('T1'), t.id('A'), t.conv('T1')::text || '/' || gen_random_uuid()::text || '.png'),
  'SVG odrzucone', '22023');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, attachments) values (%L, %L, 'x',
  jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/png', 'width', 1, 'height', 1, 'size', 20000000, 'name', 'a')))$q$,
  t.conv('T1'), t.id('A'), t.conv('T1')::text || '/' || gen_random_uuid()::text || '.png'),
  'rozmiar ponad 10 MB odrzucony', '22023');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, attachments) values (%L, %L, 'x',
  jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/png', 'width', 1, 'height', 1, 'size', 1, 'name', 'a', 'evil', 1)))$q$,
  t.conv('T1'), t.id('A'), t.conv('T1')::text || '/' || gen_random_uuid()::text || '.png'),
  'nieznane pole załącznika odrzucone', '22023');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, mention_ids)
  select %L, %L, 'spam', array_agg(gen_random_uuid()) from generate_series(1, 51)$q$, t.conv('T1'), t.id('A')),
  'ponad 50 wzmianek odrzucone', '23514');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, reply_to) values (%L, %L, 'cytat', %L)$q$,
  t.conv('T1'), t.id('A'), 'cc000000-0000-4000-8000-000000000005'), 'odpowiedź na wiadomość z innej rozmowy odrzucona', '22023');
insert into n2click.messages (conversation_id, author_id, body, pinned_at, pinned_by)
values (t.conv('T1'), t.id('A'), 'próba przypięcia przy wstawieniu', now(), t.id('A'));
select t.ok((select pinned_at is null and pinned_by is null from n2click.messages where body = 'próba przypięcia przy wstawieniu'),
  'pinned_at przy INSERT wyzerowane');
select t.fails($$update n2click.messages set pinned_at = now() where body = 'Hej @M @B'$$, 'pinned_at bez grantu kolumnowego', '42501');
select t.fails($$update n2click.messages set attachments = '[]' where body = 'Hej @M @B'$$, 'attachments bez grantu kolumnowego', '42501');
reset role;

select t.login(t.id('B')); set role authenticated;
select t.ok((select count(*) from n2click.messages where conversation_id = t.conv('T1')) = 0, 'B nie czyta wiadomości T1');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body) values (%L, %L, 'wtargnięcie')$q$,
  t.conv('T1'), t.id('B')), 'B nie pisze do T1', '42501');
select t.fails(format($q$select n2click.chat_set_follow(%L, true)$q$, t.conv('T1')), 'B nie zmieni obserwowania T1', '42501');
reset role;

-- 5. Obserwowanie -------------------------------------------------------------
select t.login(t.id('W2')); set role authenticated;
select n2click.chat_set_follow(t.conv('T1'), false);
reset role;
select t.ok((select muted_until = 'infinity' from n2click.conversation_members where conversation_id = t.conv('T1') and user_id = t.id('W2')),
  'przestań obserwować = infinity');
select t.login(t.id('A')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body) values (t.conv('T1'), t.id('A'), 'Bez wzmianki');
reset role;
select t.ok(t.notes_for('W2', 'Bez wzmianki') = 0 and t.notes_for('M', 'Bez wzmianki') = 1, 'nieobserwujący W2 bez task_message, obserwujący M dostał');
select t.login(t.id('A')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body, mention_ids) values (t.conv('T1'), t.id('A'), '@W2 pilne', array[t.id('W2')]);
reset role;
select t.ok(t.notes_for('W2', '@W2 pilne', 'task_mention') = 1 and t.notes_for('W2', '@W2 pilne') = 1, 'wzmianka dociera do nieobserwującego');
select t.ok((select muted_until = 'infinity' from n2click.conversation_members where conversation_id = t.conv('T1') and user_id = t.id('W2')),
  'wzmianka nie nadpisuje decyzji o obserwowaniu');

-- 6. Przypięcie -------------------------------------------------------------
create temp table pin_before as select id, edited_at from n2click.messages where body = 'Hej @M @B';
grant select on pin_before to authenticated;
truncate realtime.messages;
select t.login(t.id('M')); set role authenticated;
select n2click.chat_set_pin((select id from pin_before), true);
reset role;
select t.ok((select pinned_at is not null and pinned_by = t.id('M') and edited_at is not null
  from n2click.messages where id = (select id from pin_before)), 'M przypiął: pinned_at, pinned_by, edited_at');
select t.ok((select count(*) from realtime.messages where event = 'UPDATE' and topic = 'chat:conv:' || t.conv('T1')
  and (payload->'record'->>'pinned_at') is not null) = 1, 'pin nadany jako UPDATE na kanale rozmowy');
create temp table pin_rev as select edited_at from n2click.messages where id = (select id from pin_before);
grant select on pin_rev to authenticated;
select t.login(t.id('M')); set role authenticated;
select n2click.chat_set_pin((select id from pin_before), true);
reset role;
select t.ok((select edited_at from n2click.messages where id = (select id from pin_before)) = (select edited_at from pin_rev),
  'ponowne przypięcie to no-op');
select t.login(t.id('B')); set role authenticated;
select t.fails(format('select n2click.chat_set_pin(%L, false)', (select id from pin_before)), 'B nie odepnie w cudzej rozmowie', '42501');
reset role;
select t.login(t.id('A')); set role authenticated;
select n2click.chat_set_pin((select id from pin_before), false);
reset role;
select t.ok((select pinned_at is null and edited_at > (select edited_at from pin_rev) from n2click.messages where id = (select id from pin_before)),
  'odpięcie podbija rewizję');
select t.login(t.id('M')); set role authenticated;
select n2click.chat_set_pin((select id from pin_before), true);
reset role;
select t.login(t.id('A')); set role authenticated;
update n2click.messages set deleted_at = now() where id = (select id from pin_before);
reset role;
select t.ok((select pinned_at is null and deleted_at is not null from n2click.messages where id = (select id from pin_before)),
  'kasowanie zdejmuje przypięcie');

-- 7. Odczyt na żywo -----------------------------------------------------------
truncate realtime.messages;
select t.login(t.id('A')); set role authenticated;
update n2click.conversation_members set last_read_at = now() where conversation_id = t.conv('T1') and user_id = t.id('A');
update n2click.conversation_members set last_read_at = now() + interval '1 day' where conversation_id = t.conv('T1') and user_id = t.id('A');
update n2click.conversation_members set last_read_at = now() where conversation_id = t.conv('T1') and user_id = t.id('W2');
reset role;
select t.ok((select count(*) from realtime.messages where event = 'read' and topic = 'chat:conv:' || t.conv('T1')
  and payload->>'userId' = t.id('A')::text and payload ? 'lastReadAt' and payload->>'conversationId' = t.conv('T1')::text) >= 1,
  'event read z camelCase payloadem');
select t.ok((select last_read_at <= clock_timestamp() from n2click.conversation_members where conversation_id = t.conv('T1') and user_id = t.id('A')),
  'last_read_at nie wybiega w przyszłość');
select t.ok((select last_read_at = 'epoch' from n2click.conversation_members where conversation_id = t.conv('T1') and user_id = t.id('W2')),
  'A nie zmieni odczytu W2');

-- 8. chat_overview -----------------------------------------------------------
select t.login(t.id('W2')); set role authenticated;
select t.ok((select m->>'muted_until' from n2click.chat_overview() o, jsonb_array_elements(o.members) m
  where o.id = t.conv('T1') and m->>'user_id' = t.id('W2')::text) = 'infinity', 'chat_overview: muted_until członka');
select t.ok((select context_type = 'task' and context_id = t.id('T1') from n2click.chat_overview() where id = t.conv('T1')),
  'chat_overview: kontekst zadania');
reset role;

-- 9. Próby obejścia ---------------------------------------------------------
select t.login(t.id('A')); set role authenticated;
select t.fails(format($q$insert into n2click.conversations (kind, context_type, context_id, created_by) values ('group', 'task', %L, %L)$q$,
  t.id('T2'), t.id('A')), 'rezerwacja rozmowy zadania przez API', '42501');
select t.fails(format($q$insert into n2click.conversation_members (conversation_id, user_id) values (%L, %L)$q$,
  t.conv('T1'), t.id('X')), 'twórca rozmowy zadania nie dopisze obcej osoby', '42501');
select t.fails(format($q$insert into n2click.notifications (recipient_id, type, payload) values (%L, 'task_mention', '{}')$q$,
  t.id('W2')), 'podrobione task_mention', '42501');
insert into n2click.notifications (recipient_id, type, payload) values (t.id('W2'), 'task_assigned', '{}');
reset role;
set role anon;
select t.fails($$select 1 from n2click.messages limit 1$$, 'anon nie czyta wiadomości', '42501');
reset role;

-- zwykła grupa: wzmianka nie dopisuje osoby i nie tworzy powiadomień
select t.login(t.id('A')); set role authenticated;
create temp table g as select n2click.chat_create_group('Grupa', array[t.id('W2')]) as id;
insert into n2click.messages (conversation_id, author_id, body, mention_ids) select id, t.id('A'), '@B hej', array[t.id('B')] from g;
reset role;
select t.ok(not exists (select 1 from n2click.conversation_members where conversation_id = (select id from g) and user_id = t.id('B')),
  'wzmianka w zwykłej grupie nie dopisuje osoby');
select t.ok(t.notes('B') = 0, 'zwykła grupa bez powiadomień zadania');

-- 10. Storage ---------------------------------------------------------------
select t.ok((select public = false and file_size_limit = 10485760 and allowed_mime_types = array['image/webp','image/png','image/jpeg','image/gif']
  from storage.buckets where id = 'chat-attachments'), 'bucket prywatny, 10 MB, allowlista');
create temp table obj as select t.conv('T1')::text || '/' || gen_random_uuid()::text || '.webp' as name;
grant select on obj to authenticated;
select t.login(t.id('A')); set role authenticated;
insert into storage.objects (bucket_id, name, owner_id) select 'chat-attachments', name, t.id('A')::text from obj;
select t.fails(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('chat-attachments', %L, %L)$q$,
  t.conv('T1')::text || '/' || gen_random_uuid()::text || '.png', t.id('W2')), 'podszycie owner_id', '42501');
select t.fails(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('chat-attachments', %L, %L)$q$,
  t.conv('T1')::text || '/zly.png', t.id('A')), 'nazwa spoza formatu', '42501');
select t.fails(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('chat-attachments', %L, %L)$q$,
  t.conv('T3')::text || '/' || gen_random_uuid()::text || '.png', t.id('A')), 'upload do cudzej rozmowy', '42501');
reset role;
select t.login(t.id('B')); set role authenticated;
select t.ok((select count(*) from storage.objects where name = (select name from obj)) = 0, 'B nie widzi obrazu T1');
reset role;
select t.login(t.id('W2')); set role authenticated;
select t.ok((select count(*) from storage.objects where name = (select name from obj)) = 1, 'członek W2 widzi obraz');
with d as (delete from storage.objects where name = (select name from obj) returning 1) select t.ok((select count(*) from d) = 0, 'W2 nie skasuje cudzego obrazu');
with u as (update storage.objects set name = name where name = (select name from obj) returning 1) select t.ok((select count(*) from u) = 0, 'brak UPDATE');
reset role;

-- 11. Utrata wglądu w zadanie -------------------------------------------------
delete from n2click.task_assignments where task_id = t.id('T1') and profile_id = t.id('A');
truncate n2click.notifications;
select t.login(t.id('A')); set role authenticated;
select t.ok((select count(*) from n2click.messages where conversation_id = t.conv('T1')) = 0, 'odpięty A nie czyta T1');
select t.ok((select count(*) from n2click.conversations where id = t.conv('T1')) = 0, 'odpięty A (twórca) nie widzi nawet wiersza rozmowy');
select t.ok((select count(*) from n2click.chat_overview() where id = t.conv('T1')) = 0, 'odpięty A: T1 znika z chat_overview');
select t.ok(not app.chat_topic_member('chat:conv:' || t.conv('T1')), 'odpięty A traci kanał realtime');
select t.ok((select count(*) from storage.objects where name = (select name from obj)) = 0, 'odpięty A traci załączniki');
select t.fails($$select n2click.chat_open_task('7a000000-0000-4000-8000-000000000001')$$, 'odpięty A nie otworzy T1', '42501');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body) values (%L, %L, 'po odpięciu')$q$,
  t.conv('T1'), t.id('A')), 'odpięty A nie pisze', '42501');
with u as (update n2click.messages set body = 'edycja po odpięciu' where author_id = t.id('A') and conversation_id = t.conv('T1') returning 1)
  select t.ok((select count(*) from u) = 0, 'odpięty A nie edytuje starych wiadomości');
reset role;
select t.login(t.id('M')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body) values (t.conv('T1'), t.id('M'), 'Po odpięciu A');
reset role;
select t.ok(t.notes('A') = 0, 'odpięty A nie dostaje powiadomień (nadal ma wiersz członkostwa)');
insert into n2click.task_assignments values (t.id('T1'), t.id('A'));
