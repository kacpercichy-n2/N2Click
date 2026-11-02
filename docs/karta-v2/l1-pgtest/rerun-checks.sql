-- Po ponownym uruchomieniu wszystkich czterech plików.
select t.ok((select count(*) from n2click.messages where id::text like 'cc000000-%') = 3, 'ponowny import nie dubluje wiadomości');
select t.ok((select count(*) from n2click.notifications where payload->>'messageId' like 'cc000000-%') = 0,
  'ponowny import (z istniejącym triggerem powiadomień) nie powiadamia');
select t.ok((select count(*) from n2click.comments) = 6, 'komentarze nietknięte');
select t.ok((select count(*) from pg_trigger where tgrelid in ('n2click.messages'::regclass, 'n2click.conversations'::regclass,
  'n2click.conversation_members'::regclass) and not tgisinternal and tgenabled <> 'O') = 0, 'triggery włączone po ponownym imporcie');
select t.ok((select count(*) from pg_policies where tablename = 'objects' and policyname like 'chat_attachments_%') = 3, 'polityki bucketu bez duplikatów');
