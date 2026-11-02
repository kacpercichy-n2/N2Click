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
select t.ok((select mention_ids from n2click.messages where body = 'Hej @M @B') = array[t.id('M')],
  'wzmianki zdeduplikowane, bez autora, bez osoby bez wglądu (B)');
select t.ok((select revised_at = created_at and edited_at is null from n2click.messages where body = 'Hej @M @B'),
  'revised_at przy INSERT = created_at, edited_at puste');
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
-- R1 finding 7: wzmianki muszą być w treści jako @Imię.
insert into n2click.messages (conversation_id, author_id, body, mention_ids)
select t.conv('T1'), t.id('A'), 'spam bez imion', array_agg(gen_random_uuid()) from generate_series(1, 51);
select t.ok((select mention_ids = '{}' from n2click.messages where body = 'spam bez imion'),
  'F7: 51 losowych id bez @Imienia w treści odpada (brak wzmianek)');
insert into n2click.messages (conversation_id, author_id, body, mention_ids)
values (t.conv('T1'), t.id('A'), 'zwykły tekst bez @', array[t.id('M'), t.id('R'), t.id('X')]);
select t.ok((select mention_ids = '{}' from n2click.messages where body = 'zwykły tekst bez @'),
  'F7: wzmianki spoza treści odpadają (repro R1)');
insert into n2click.messages (conversation_id, author_id, body, mention_ids)
values (t.conv('T1'), t.id('A'), 'cc @m, @Mx i @X', array[t.id('M'), t.id('X')]);
select t.ok((select mention_ids = array[t.id('M')] from n2click.messages where body = 'cc @m, @Mx i @X'),
  'F7: @m (wielkość liter) zostaje, X nazwany ale bez wglądu w T1 odpada');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, reply_to) values (%L, %L, 'cytat', %L)$q$,
  t.conv('T1'), t.id('A'), 'cc000000-0000-4000-8000-000000000005'), 'odpowiedź na wiadomość z innej rozmowy odrzucona', '22023');
reset role;
-- R1 finding 6: nie-członek dostaje 42501 niezależnie od reply_to (brak wyroczni).
select t.login(t.id('X')); set role authenticated;
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, reply_to) values (%L, %L, 'x', %L)$q$,
  t.conv('T1'), t.id('X'), 'cc000000-0000-4000-8000-000000000001'), 'F6: nie-członek + istniejące reply_to = 42501', '42501');
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, reply_to) values (%L, %L, 'x', %L)$q$,
  t.conv('T1'), t.id('X'), gen_random_uuid()), 'F6: nie-członek + losowe reply_to = też 42501', '42501');
reset role;
select t.login(t.id('A')); set role authenticated;
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
select t.ok((select pinned_at is not null and pinned_by = t.id('M') and edited_at is null and revised_at > created_at
  from n2click.messages where id = (select id from pin_before)), 'M przypiął: pinned_at, pinned_by, revised_at; edited_at nietknięte (BACKLOG 1)');
select t.ok((select count(*) from realtime.messages where event = 'UPDATE' and topic = 'chat:conv:' || t.conv('T1')
  and (payload->'record'->>'pinned_at') is not null) = 1, 'pin nadany jako UPDATE na kanale rozmowy');
create temp table pin_rev as select revised_at from n2click.messages where id = (select id from pin_before);
grant select on pin_rev to authenticated;
select t.login(t.id('M')); set role authenticated;
select n2click.chat_set_pin((select id from pin_before), true);
reset role;
select t.ok((select revised_at from n2click.messages where id = (select id from pin_before)) = (select revised_at from pin_rev),
  'ponowne przypięcie to no-op');
select t.login(t.id('B')); set role authenticated;
select t.fails(format('select n2click.chat_set_pin(%L, false)', (select id from pin_before)), 'B nie odepnie w cudzej rozmowie', '42501');
reset role;
select t.login(t.id('A')); set role authenticated;
select n2click.chat_set_pin((select id from pin_before), false);
reset role;
select t.ok((select pinned_at is null and edited_at is null and revised_at > (select revised_at from pin_rev) from n2click.messages where id = (select id from pin_before)),
  'odpięcie podbija revised_at, nie edited_at');
truncate pin_rev;
insert into pin_rev select revised_at from n2click.messages where id = (select id from pin_before);
select t.login(t.id('A')); set role authenticated;
update n2click.messages set body = 'Hej @M @B (poprawione)' where id = (select id from pin_before);
reset role;
select t.ok((select edited_at is not null and revised_at > (select revised_at from pin_rev) and revised_at >= edited_at
  from n2click.messages where id = (select id from pin_before)), 'edycja treści podbija edited_at i revised_at');
truncate pin_rev;
insert into pin_rev select revised_at from n2click.messages where id = (select id from pin_before);
select t.login(t.id('A')); set role authenticated;
update n2click.messages set body = body where id = (select id from pin_before);
reset role;
select t.ok((select revised_at = (select revised_at from pin_rev) from n2click.messages where id = (select id from pin_before)),
  'UPDATE bez zmiany nie podbija rewizji');
select t.login(t.id('M')); set role authenticated;
select n2click.chat_set_pin((select id from pin_before), true);
reset role;
select t.login(t.id('A')); set role authenticated;
update n2click.messages set deleted_at = now() where id = (select id from pin_before);
reset role;
select t.ok((select pinned_at is null and deleted_at is not null and revised_at > (select revised_at from pin_rev)
  from n2click.messages where id = (select id from pin_before)), 'kasowanie zdejmuje przypięcie i podbija revised_at');
select t.ok((select count(*) from realtime.messages where event = 'UPDATE' and topic = 'chat:conv:' || t.conv('T1')
  and payload->'record' ? 'revised_at') >= 1, 'broadcast UPDATE niesie revised_at w record');

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
reset role;
-- R1 finding 3: kontekst projektu / klienta też nie przez API (repro R1).
select t.login(t.id('X')); set role authenticated;
select t.fails($$insert into n2click.conversations (kind, context_type, context_id, created_by)
  values ('group', 'project', '9a000000-0000-4000-8000-0000000000a1', 'f0000000-0000-4000-8000-00000000000f')$$,
  'F3: X nie zajmie tożsamości projektu innej spółki', '42501');
select t.fails($$insert into n2click.conversations (kind, context_type, context_id, created_by)
  values ('group', 'client', gen_random_uuid(), 'f0000000-0000-4000-8000-00000000000f')$$,
  'F3: kontekst klienta też odrzucony', '42501');
select t.fails($$insert into n2click.conversations (kind, context_id, created_by)
  values ('group', gen_random_uuid(), 'f0000000-0000-4000-8000-00000000000f')$$,
  'F3: samo context_id też odrzucone', '42501');
reset role;
select t.ok((select count(*) from n2click.conversations where context_type in ('project', 'client')) = 0, 'F3: zero rozmów projektu/klienta');
select t.login(t.id('A')); set role authenticated;
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

-- 12. R1 finding 1: klient nie nadaje na chat:conv (tylko typing na chat:typing) ----
-- Hostowany Realtime sprawdza zapis przy dołączeniu próbnym wierszem z samym
-- topic + extension (bez event); tu sprawdzamy dokładnie taki wiersz i pełne
-- podróbki z raportu R1.
select t.login(t.id('A')); set role authenticated;
select from set_config('realtime.topic', 'chat:conv:' || t.conv('T1'), false);
select t.fails(format($q$insert into realtime.messages (topic, extension) values (%L, 'broadcast')$q$, 'chat:conv:' || t.conv('T1')),
  'F1: próba zapisu przy dołączeniu do chat:conv odrzucona (kanał tylko do słuchania)', '42501');
select t.fails(format($q$insert into realtime.messages (topic, extension, event, payload, private) values (%L, 'broadcast', 'INSERT',
  jsonb_build_object('record', jsonb_build_object('id', gen_random_uuid(), 'conversation_id', %L, 'author_id', %L, 'body', 'forged')), true)$q$,
  'chat:conv:' || t.conv('T1'), t.conv('T3'), t.id('M')), 'F1: podrobiony INSERT wiadomości odrzucony', '42501');
select t.fails(format($q$insert into realtime.messages (topic, extension, event, payload, private) values (%L, 'broadcast', 'read',
  jsonb_build_object('conversationId', %L, 'userId', %L, 'lastReadAt', now() + interval '1 year'), true)$q$,
  'chat:conv:' || t.conv('T1'), t.conv('T1'), t.id('W2')), 'F1: podrobiony read odrzucony', '42501');
select t.fails(format($q$insert into realtime.messages (topic, extension, event, payload, private) values (%L, 'presence', 'x', '{}', true)$q$,
  'chat:conv:' || t.conv('T1')), 'F1: presence na chat:conv odrzucone', '42501');
select t.ok(app.chat_topic_member('chat:conv:' || t.conv('T1')), 'F1: członek dalej słucha chat:conv');
-- typing: jedyny broadcast klienta, na własnym topicu
select from set_config('realtime.topic', 'chat:typing:' || t.conv('T1'), false);
insert into realtime.messages (topic, extension) values ('chat:typing:' || t.conv('T1'), 'broadcast');
insert into realtime.messages (topic, extension, event, payload, private)
values ('chat:typing:' || t.conv('T1'), 'broadcast', 'typing', jsonb_build_object('userId', t.id('A')), true);
select t.ok((select count(*) from realtime.messages where topic = 'chat:typing:' || t.conv('T1') and event = 'typing') = 1,
  'F1: członek nadaje typing na chat:typing:<id> i go odbiera');
select from set_config('realtime.topic', 'chat:typing:' || t.conv('T3'), false);
select t.fails(format($q$insert into realtime.messages (topic, extension) values (%L, 'broadcast')$q$, 'chat:typing:' || t.conv('T3')),
  'F1: typing do cudzej rozmowy odrzucone', '42501');
select from set_config('realtime.topic', 'chat:typing:zly', false);
select t.fails($$insert into realtime.messages (topic, extension) values ('chat:typing:zly', 'broadcast')$$, 'F1: zły uuid w chat:typing = brak, nie wyjątek', '42501');
select from set_config('realtime.topic', 'chat:presence', false);
insert into realtime.messages (topic, extension) values ('chat:presence', 'presence');
select t.fails($$insert into realtime.messages (topic, extension) values ('chat:presence', 'broadcast')$$, 'F1: broadcast na chat:presence odrzucony', '42501');
select from set_config('realtime.topic', 'chat:user:' || t.id('A'), false);
select t.fails(format($q$insert into realtime.messages (topic, extension) values (%L, 'broadcast')$q$, 'chat:user:' || t.id('A')),
  'F1: chat:user tylko do słuchania', '42501');
select t.ok(app.chat_topic_member('chat:user:' || t.id('A')), 'F1: właściciel dalej słucha chat:user');
select from set_config('realtime.topic', '', false);
reset role;
-- Zdarzenia serwera dalej przechodzą (definery omijają RLS): reakcja i read.
truncate realtime.messages;
select t.login(t.id('M')); set role authenticated;
select from n2click.chat_set_reaction((select id from n2click.messages where body = 'Bez wzmianki'), '😀');
update n2click.conversation_members set last_read_at = now() where conversation_id = t.conv('T1') and user_id = t.id('M');
reset role;
select t.ok((select count(*) from realtime.messages where topic = 'chat:conv:' || t.conv('T1') and event in ('reaction', 'read')) = 2,
  'F1: reaction i read z serwera dalej nadawane na chat:conv');
select t.login(t.id('W2')); set role authenticated;
select t.ok((select count(*) from n2click.message_reactions where conversation_id = t.conv('T1')) = 1, 'F2: członek widzi reakcję (polityka zbiorowa)');
reset role;
select t.login(t.id('B')); set role authenticated;
select t.ok((select count(*) from n2click.message_reactions where conversation_id = t.conv('T1')) = 0, 'F2: nie-członek nie widzi reakcji');
reset role;
select t.login(t.id('X')); set role authenticated;
select t.ok((select count(*) from n2click.messages) = 0 and (select count(*) from app.chat_my_conversation_ids()) = 1,
  'F2: X widzi tylko swoją rozmowę T2 (pustą)');
reset role;

-- 13. R1 finding 4: zbiorczy task_message ---------------------------------------
truncate n2click.notifications;
select t.login(t.id('A')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body) values (t.conv('T1'), t.id('A'), 'agg 1');
reset role;
create temp table agg_first as select id, created_at from n2click.notifications where recipient_id = t.id('M') and type = 'task_message';
select pg_sleep(0.01);
select t.login(t.id('A')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body) values (t.conv('T1'), t.id('A'), 'agg 2');
insert into n2click.messages (conversation_id, author_id, body) values (t.conv('T1'), t.id('A'), 'agg 3');
reset role;
select t.ok((select count(*) from n2click.notifications where recipient_id = t.id('M') and type = 'task_message') = 1,
  'F4: 3 wiadomości = jeden nieprzeczytany task_message u M');
select t.ok((select (payload->>'count')::int = 3 and id = (select id from agg_first) and created_at > (select created_at from agg_first)
  and payload->>'messageId' = (select id::text from n2click.messages where body = 'agg 3') and payload->>'actorId' = t.id('A')::text
  and payload->>'taskId' = t.id('T1')::text and payload->>'conversationId' = t.conv('T1')::text
  from n2click.notifications where recipient_id = t.id('M') and type = 'task_message'),
  'F4: ten sam wiersz: count 3, ostatnia wiadomość, aktor, świeży created_at');
select t.login(t.id('R')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body) values (t.conv('T1'), t.id('R'), 'agg 4 od R');
reset role;
select t.ok((select (payload->>'count')::int = 4 and payload->>'actorId' = t.id('R')::text
  from n2click.notifications where recipient_id = t.id('M') and type = 'task_message'), 'F4: ostatni aktor = R, count 4');
select t.ok((select (payload->>'count')::int = 3 from n2click.notifications where recipient_id = t.id('R') and type = 'task_message'),
  'F4: R ma swój wiersz z count 3 (bez własnej wiadomości)');
select t.login(t.id('A')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body, mention_ids) values (t.conv('T1'), t.id('A'), 'agg @M', array[t.id('M')]);
insert into n2click.messages (conversation_id, author_id, body, mention_ids) values (t.conv('T1'), t.id('A'), 'agg znowu @M', array[t.id('M')]);
reset role;
select t.ok(t.notes('M', 'task_mention') = 2 and (select (payload->>'count')::int from n2click.notifications
  where recipient_id = t.id('M') and type = 'task_message') = 4, 'F4: wzmianka = osobny wiersz na każdą, zbiorczy bez zmian');
-- M czyta (klient ustawia read_at przez politykę UPDATE)
select t.login(t.id('M')); set role authenticated;
update n2click.notifications set read_at = now() where type = 'task_message';
reset role;
select t.login(t.id('A')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body) values (t.conv('T1'), t.id('A'), 'agg po odczycie');
reset role;
select t.ok((select count(*) from n2click.notifications where recipient_id = t.id('M') and type = 'task_message') = 2
  and (select (payload->>'count')::int from n2click.notifications where recipient_id = t.id('M') and type = 'task_message' and read_at is null) = 1,
  'F4: po odczycie następna wiadomość zakłada nowy wiersz z count 1');
-- Odczyt w kliencie przez zbiór id na profilu (tick, karta zadania): wiersz
-- zamknięty przy następnej wiadomości, nowy zbiorczy od 1.
create temp table agg_open as select id from n2click.notifications where recipient_id = t.id('M') and type = 'task_message' and read_at is null;
update core.profiles set notifications_read_ids = array['notification:' || (select id from agg_open)] where id = t.id('M');
select t.login(t.id('A')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body) values (t.conv('T1'), t.id('A'), 'agg po ticku');
reset role;
select t.ok((select read_at is not null from n2click.notifications where id = (select id from agg_open))
  and (select count(*) from n2click.notifications where recipient_id = t.id('M') and type = 'task_message' and read_at is null) = 1
  and (select (payload->>'count')::int from n2click.notifications where recipient_id = t.id('M') and type = 'task_message' and read_at is null) = 1,
  'F4: wpis oznaczony w kliencie (notifications_read_ids) zamknięty, nowy wiersz count 1');
-- Odczyt przez watermark („oznacz wszystkie”).
select pg_sleep(0.01);
update core.profiles set notifications_read_ids = '{}', notifications_seen_at = clock_timestamp() where id = t.id('M');
select pg_sleep(0.01);
select t.login(t.id('A')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body) values (t.conv('T1'), t.id('A'), 'agg po watermarku');
reset role;
select t.ok((select count(*) from n2click.notifications where recipient_id = t.id('M') and type = 'task_message' and read_at is null) = 1
  and (select (payload->>'count')::int from n2click.notifications where recipient_id = t.id('M') and type = 'task_message' and read_at is null) = 1
  and (select count(*) from n2click.notifications where recipient_id = t.id('M') and type = 'task_message') = 4,
  'F4: watermark zamyka wiersz, nowy count 1 (wiersze M: 4)');
update core.profiles set notifications_seen_at = null where id = t.id('M');
-- E2 z raportu R1: 20 zwykłych wiadomości = jeden wiersz na odbiorcę
truncate n2click.notifications;
select t.login(t.id('A')); set role authenticated;
insert into n2click.messages (conversation_id, author_id, body) select t.conv('T1'), t.id('A'), 'seria ' || g from generate_series(1, 20) g;
reset role;
select t.ok(t.notes('M') = 1 and t.notes('R') = 1 and (select bool_and((payload->>'count')::int = 20) from n2click.notifications),
  'F4: 20 wiadomości -> M=1, R=1 wiersz (count 20); wcześniej 20 i 20');
select t.ok(t.notes('W2') = 0, 'F4: nieobserwujący W2 dalej bez task_message');

-- 14. R1 finding 8: granty powiadomień -----------------------------------------
select t.ok(not has_table_privilege('authenticated', 'n2click.notifications', 'truncate')
  and not has_table_privilege('authenticated', 'n2click.notifications', 'delete')
  and not has_table_privilege('authenticated', 'n2click.notifications', 'trigger')
  and not has_table_privilege('authenticated', 'n2click.notifications', 'references')
  and has_table_privilege('authenticated', 'n2click.notifications', 'select')
  and has_table_privilege('authenticated', 'n2click.notifications', 'insert')
  and has_table_privilege('authenticated', 'n2click.notifications', 'update'),
  'F8: authenticated ma tylko select/insert/update na notifications');

-- 15. R1 finding 7: limit wzmianek w CHECK (20); bez triggerów, żeby dotrzeć do CHECK
set session_replication_role = replica;
select t.fails(format($q$insert into n2click.messages (conversation_id, author_id, body, revised_at, mention_ids)
  select %L, %L, 'x', now(), array_agg(gen_random_uuid()) from generate_series(1, 21)$q$, t.conv('T1'), t.id('A')),
  'F7: ponad 20 wzmianek odrzucone przez CHECK', '23514');
set session_replication_role = origin;

-- 16. Import: rewizja i wzmianki starych komentarzy
select t.ok((select bool_and(m.revised_at = m.created_at) from n2click.messages m join n2click.comments c on c.id = m.id),
  'import: revised_at = created_at');
select t.ok((select mention_ids = array[t.id('W2')] from n2click.messages where id = 'cc000000-0000-4000-8000-000000000001'),
  'import: wzmianka B bez wglądu odfiltrowana, W2 zostaje');
