-- =============================================================================
-- Migracja: 20261102103000_task_chat_notifications
--
-- Powiadomienia o nowych wiadomościach w rozmowie zadania. Dwa nowe typy
-- `n2click.notifications.type` (kolumna text z CHECK długości, bez enuma,
-- więc DDL kolumny nie jest potrzebny):
--   * task_message — nowa wiadomość, dla obserwującego (muted_until NULL
--     albo w przeszłości),
--   * task_mention — wzmianka; wygrywa z task_message dla tej samej osoby
--     (jeden wiersz na osobę i wiadomość) i dociera także do osoby, która
--     przestała obserwować.
-- Payload: { taskId, conversationId, messageId, actorId }.
--
-- Odbiorca musi mieć BIEŻĄCY wgląd w zadanie (app.chat_user_can_read_task),
-- więc osoba odpięta od zadania nie dostaje nawet id zadania.
--
-- MAIL: wiersze rodzą się z `emailed_at = now()`, czyli funkcja
-- `send-notification-emails` je pomija. Ona zna tylko task_assigned /
-- project_comment / bin_item (`notificationLine` zwróciłby undefined), a mail
-- na każdą wiadomość czatu to spam. Włączenie maili dla wzmianek = osobna
-- decyzja + zmiana funkcji Edge (poza linią L1).
--
-- Plik idzie PO backfillu (20261102102000), więc import starych komentarzy
-- nie tworzy powiadomień.
-- =============================================================================

create or replace function n2click.chat_notify_task_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task uuid;
begin
  if new.kind <> 'text' then
    return null;
  end if;

  select c.context_id into v_task
  from n2click.conversations c
  where c.id = new.conversation_id and c.context_type = 'task';
  if v_task is null then
    return null;
  end if;

  insert into n2click.notifications (recipient_id, type, payload, emailed_at)
  select
    m.user_id,
    case when m.user_id = any(new.mention_ids) then 'task_mention' else 'task_message' end,
    jsonb_build_object(
      'taskId', v_task,
      'conversationId', new.conversation_id,
      'messageId', new.id,
      'actorId', new.author_id
    ),
    now()
  from n2click.conversation_members m
  where m.conversation_id = new.conversation_id
    and m.user_id <> new.author_id
    and (
      m.user_id = any(new.mention_ids)
      or m.muted_until is null
      or m.muted_until <= now()
    )
    and app.chat_user_can_read_task(m.user_id, v_task)
  order by m.user_id;

  return null;
end;
$$;

comment on function n2click.chat_notify_task_message() is
  'AFTER INSERT na messages: task_message dla obserwujących rozmowy zadania, task_mention dla wspomnianych (wzmianka wygrywa). Odbiorca z wglądem w zadanie, bez autora, bez maila (emailed_at = now()).';

revoke all on function n2click.chat_notify_task_message() from public, anon, authenticated;

-- AFTER triggery odpalają alfabetycznie: chat_messages_auto_members (dopisuje
-- wspomnianych) < chat_messages_notify_task.
drop trigger if exists chat_messages_notify_task on n2click.messages;
create trigger chat_messages_notify_task
  after insert on n2click.messages
  for each row execute function n2click.chat_notify_task_message();

-- Klient nie podrobi powiadomienia z rozmowy zadania: INSERT z klienta
-- dopuszcza wyłącznie typy generowane w przeglądarce
-- (src/supabase/notificationEvents.ts). task_message / task_mention pisze
-- tylko trigger (definer). Wcześniej: `with check (true)` + bramka has_app.
drop policy if exists "notifications_insert" on n2click.notifications;
create policy "notifications_insert" on n2click.notifications
  for insert to authenticated
  with check (
    (select core.has_app('n2click'))
    and type in ('task_assigned', 'project_comment', 'bin_item')
  );

revoke all on n2click.notifications from anon;
