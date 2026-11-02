-- R1 finding 2: koszt RLS wiadomości przy dużej rozmowie zadania.
-- 20 000 wiadomości w T1 (wstawione bez triggerów), mierzone jako A (wykonawca,
-- członek od importu z last_read_at). Próg 500 ms jest szeroki celowo: R1
-- zmierzył 2,5 s per wiersz i 3,8 ms dla formy zbiorczej.
set session_replication_role = replica;
insert into n2click.messages (conversation_id, author_id, body, created_at, revised_at)
select t.conv('T1'), t.id('M'), 'obciążenie ' || g, now() - (g || ' seconds')::interval, now() - (g || ' seconds')::interval
from generate_series(1, 20000) g;
set session_replication_role = origin;
analyze n2click.messages;
-- Jak u R1: obserwujący bez odczytu liczy całą historię jako nieprzeczytaną.
update n2click.conversation_members set last_read_at = 'epoch' where conversation_id = t.conv('T1') and user_id = t.id('A');

select t.login(t.id('A')); set role authenticated;
do $$
declare
  t0 timestamptz; v_count bigint; v_new_ms numeric; v_old_ms numeric; v_overview_ms numeric; v_unread integer;
begin
  t0 := clock_timestamp();
  select count(*) into v_count from n2click.messages where conversation_id = t.conv('T1');
  v_new_ms := extract(epoch from clock_timestamp() - t0) * 1000;

  t0 := clock_timestamp();
  select unread_count into v_unread from n2click.chat_overview() where id = t.conv('T1');
  v_overview_ms := extract(epoch from clock_timestamp() - t0) * 1000;

  -- Dla porównania stara forma: is_conversation_member wołane per wiersz.
  t0 := clock_timestamp();
  perform count(*) from n2click.messages m where app.is_conversation_member(m.conversation_id);
  v_old_ms := extract(epoch from clock_timestamp() - t0) * 1000;

  raise notice 'pomiar F2: count(*) % wierszy = % ms, chat_overview() = % ms (unread %), stara forma per wiersz = % ms',
    v_count, round(v_new_ms, 1), round(v_overview_ms, 1), v_unread, round(v_old_ms, 1);
  perform t.ok(v_unread >= 20000, 'F2: chat_overview liczy 20 tys. nieprzeczytanych');
  perform t.ok(v_count >= 20000, 'F2: A czyta wszystkie wiadomości T1 przez nową politykę');
  perform t.ok(v_new_ms < 500, format('F2: count(*) przez RLS poniżej 500 ms (%s ms)', round(v_new_ms, 1)));
  perform t.ok(v_overview_ms < 500, format('F2: chat_overview() poniżej 500 ms (%s ms)', round(v_overview_ms, 1)));
  perform t.ok(v_new_ms * 5 < v_old_ms, 'F2: forma zbiorcza co najmniej 5x szybsza niż per wiersz');
end;
$$;
reset role;

-- Utrata wglądu działa tak samo przy dużej rozmowie.
delete from n2click.task_assignments where task_id = t.id('T1') and profile_id = t.id('A');
select t.login(t.id('A')); set role authenticated;
select t.ok((select count(*) from n2click.messages where conversation_id = t.conv('T1')) = 0, 'F2: odpięty A nie widzi 20 tys. wiadomości');
reset role;
insert into n2click.task_assignments values (t.id('T1'), t.id('A'));
