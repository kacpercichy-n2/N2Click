-- =============================================================================
-- Migracja: 20261102102000_task_chat_backfill
--
-- Jednorazowe przeniesienie komentarzy ZADAŃ (`n2click.comments` z task_id,
-- ok. 18 wierszy) do rozmów zadań. Komentarze projektów (task_id null) zostają
-- tam, gdzie są. NIC nie jest kasowane: `n2click.comments` zostaje nietknięte.
--
-- Zasady:
--   * wiadomość dostaje TO SAMO id co komentarz (klucz idempotencji: ponowne
--     uruchomienie nie dubluje), tego samego autora, treść, wzmianki i
--     created_at (stempel INSERT jest na czas importu wyłączony),
--   * rozmowa zadania: twórca = autor pierwszego komentarza, created_at =
--     pierwszy komentarz, last_message_at = ostatni,
--   * obserwujący: trigger chat_messages_auto_members (autor, wspomniani,
--     wykonawcy; każdy z wglądem w zadanie). `last_read_at` zostaje 'epoch'
--     (nikt nie „widział” starych komentarzy w nowym czacie; rozmowy zadań
--     nie liczą się do licznika doku),
--   * ZERO powiadomień i ZERO broadcastów: trigger powiadomień (następny plik)
--     jeszcze nie istnieje, a gdyby ktoś odpalił ten plik ponownie po nim,
--     blok wyłącza go tak samo jak broadcasty,
--   * pomijane (z NOTICE i bez błędu): komentarz bez autora (konto usunięte)
--     oraz treść pusta albo dłuższa niż 4000 znaków (limit wiadomości).
--     Zostają w `n2click.comments`; smoke check w L1-DB-NOTES.md liczy je
--     PRZED aplikacją.
--
-- Cały import to JEDEN blok DO: wyłączenie i ponowne włączenie triggerów
-- jest atomowe z danymi (błąd w środku cofa wszystko, triggery nie zostają
-- wyłączone).
-- =============================================================================

do $$
declare
  v_skipped_author integer;
  v_skipped_body integer;
  v_has_notify boolean;
  v_conversations integer;
  v_messages integer;
begin
  select
    count(*) filter (where c.author_id is null),
    count(*) filter (where c.author_id is not null
                       and char_length(c.body) not between 1 and 4000)
  into v_skipped_author, v_skipped_body
  from n2click.comments c
  where c.task_id is not null;

  if v_skipped_author > 0 or v_skipped_body > 0 then
    raise notice 'task_chat_backfill: pominięto % komentarzy bez autora i % z treścią poza 1..4000 znaków (zostają w n2click.comments)',
      v_skipped_author, v_skipped_body;
  end if;

  select exists (
    select 1 from pg_trigger
    where tgrelid = 'n2click.messages'::regclass
      and tgname = 'chat_messages_notify_task'
      and not tgisinternal
  ) into v_has_notify;

  alter table n2click.messages disable trigger chat_messages_stamp_insert;
  alter table n2click.messages disable trigger chat_messages_broadcast;
  alter table n2click.messages disable trigger chat_messages_bump_conversation;
  alter table n2click.conversations disable trigger chat_conversations_stamp_insert;
  alter table n2click.conversation_members disable trigger chat_members_broadcast;
  if v_has_notify then
    alter table n2click.messages disable trigger chat_messages_notify_task;
  end if;

  -- 1. Rozmowa na każde zadanie z co najmniej jednym importowalnym komentarzem.
  insert into n2click.conversations
    (kind, context_type, context_id, created_by, created_at, last_message_at, company_id)
  select
    'group',
    'task',
    s.task_id,
    s.first_author,
    s.first_at,
    s.last_at,
    pr.company_id
  from (
    select
      c.task_id,
      (array_agg(c.author_id order by c.created_at, c.id))[1] as first_author,
      min(c.created_at) as first_at,
      max(c.created_at) as last_at
    from n2click.comments c
    where c.task_id is not null
      and c.author_id is not null
      and char_length(c.body) between 1 and 4000
    group by c.task_id
  ) s
  join n2click.tasks t on t.id = s.task_id
  left join n2click.projects pr on pr.id = t.project_id
  order by s.task_id
  on conflict (context_type, context_id)
    where context_type is not null and context_id is not null
    do nothing;
  get diagnostics v_conversations = row_count;

  -- 2. Wiadomości (id komentarza = id wiadomości).
  insert into n2click.messages
    (id, conversation_id, author_id, body, mention_ids, created_at)
  select
    c.id,
    conv.id,
    c.author_id,
    c.body,
    c.mention_ids,
    c.created_at
  from n2click.comments c
  join n2click.conversations conv
    on conv.context_type = 'task' and conv.context_id = c.task_id
  where c.task_id is not null
    and c.author_id is not null
    and char_length(c.body) between 1 and 4000
  order by c.created_at, c.id
  on conflict (id) do nothing;
  get diagnostics v_messages = row_count;

  -- 3. Porządek listy: rozmowa założona wcześniej przez chat_open_task (między
  --    aplikacją pliku 1 i tego) też dostaje znacznik najnowszej wiadomości.
  update n2click.conversations conv
  set last_message_at = greatest(conv.last_message_at, latest.at)
  from (
    select m.conversation_id, max(m.created_at) as at
    from n2click.messages m
    group by m.conversation_id
  ) latest
  where latest.conversation_id = conv.id
    and conv.context_type = 'task'
    and latest.at > conv.last_message_at;

  alter table n2click.messages enable trigger chat_messages_stamp_insert;
  alter table n2click.messages enable trigger chat_messages_broadcast;
  alter table n2click.messages enable trigger chat_messages_bump_conversation;
  alter table n2click.conversations enable trigger chat_conversations_stamp_insert;
  alter table n2click.conversation_members enable trigger chat_members_broadcast;
  if v_has_notify then
    alter table n2click.messages enable trigger chat_messages_notify_task;
  end if;

  raise notice 'task_chat_backfill: nowe rozmowy zadań: %, nowe wiadomości: %',
    v_conversations, v_messages;
end;
$$;
