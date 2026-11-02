-- R1 finding 5: id komentarza zajęte przez wiadomość spoza rozmowy zadania.
-- Nowy komentarz zadania T3 + A zakłada zwykłą grupę i wstawia wiadomość z
-- tym samym id (repro R1). Następny krok run.sh: backfill MUSI paść.
insert into n2click.comments (id, task_id, author_id, body, created_at)
values ('cc000000-0000-4000-8000-0000000000f5', t.id('T3'), t.id('B'), 'Komentarz do zajęcia', now());
select t.login(t.id('A')); set role authenticated;
insert into n2click.conversations (id, kind, created_by) values ('5a000000-0000-4000-8000-000000000001', 'group', t.id('A'));
insert into n2click.conversation_members (conversation_id, user_id, role)
values ('5a000000-0000-4000-8000-000000000001', t.id('A'), 'owner');
insert into n2click.messages (id, conversation_id, author_id, body)
values ('cc000000-0000-4000-8000-0000000000f5', '5a000000-0000-4000-8000-000000000001', t.id('A'), 'squat');
reset role;
-- Smoke check H z L1-DB-NOTES.md wykrywa to przed aplikacją.
select t.ok((select count(*) from n2click.messages m join n2click.comments c on c.id = m.id
  where not exists (select 1 from n2click.conversations conv where conv.id = m.conversation_id
    and conv.context_type = 'task' and conv.context_id = c.task_id)) = 1, 'F5: smoke check H pokazuje zajęte id');
