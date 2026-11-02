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
-- Payload: { taskId, conversationId, messageId, actorId } (+ `count` przy
-- task_message).
--
-- AGREGACJA task_message (R1 finding 4, decyzja koordynatora): najwyżej JEDEN
-- nieprzeczytany task_message na (odbiorca, rozmowa zadania). Kolejna
-- wiadomość, gdy taki wiersz istnieje, AKTUALIZUJE go: `count` + 1,
-- `messageId` i `actorId` ostatniej wiadomości, świeży `created_at`.
-- Przeczytany wiersz jest zamknięty: następna wiadomość zakłada nowy wiersz
-- z count = 1. Gwarancję daje unikalny indeks częściowy, więc dwie równoległe
-- wiadomości nie założą dwóch wierszy.
--
-- „Przeczytany” = te same trzy źródła, z których czyta feed klienta
-- (selectors.notificationsForPerson): `read_at` wiersza, id
-- `notification:<id>` w `core.profiles.notifications_read_ids` (tick przy
-- wpisie, karta zadania) albo `created_at <= core.profiles.notifications_seen_at`
-- („oznacz wszystkie”). Klient oznacza wpis dziś tylko przez dwa ostatnie, więc
-- trigger przed agregacją zamyka (read_at = now()) taki wiersz. Bez tego wiersz
-- oznaczony w kliencie rósłby dalej pod tym samym id i zostałby „przeczytany”
-- na zawsze.
-- task_mention zostaje jeden na wzmiankę (nigdy nie jest aktualizowany).
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

-- Indeks unikalny i polityka biorą blokady na notifications (R1 finding 9).
set local lock_timeout = '5s';

-- Pod `on conflict` agregacji: jeden nieprzeczytany task_message na odbiorcę
-- i rozmowę. Przed aplikacją nie ma ani jednego wiersza task_message, więc
-- indeks zawsze wchodzi.
create unique index if not exists notifications_task_message_unread
  on n2click.notifications (recipient_id, (payload->>'conversationId'))
  where type = 'task_message' and read_at is null;

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

  -- 1. Wzmianki: wiersz na każdą wzmiankę, także dla nieobserwującego.
  insert into n2click.notifications (recipient_id, type, payload, emailed_at)
  select
    m.user_id,
    'task_mention',
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
    and m.user_id = any(new.mention_ids)
    and app.chat_user_can_read_task(m.user_id, v_task)
  order by m.user_id;

  -- 2. Zamknij zbiorcze wiersze, które odbiorca już przeczytał w kliencie
  --    (zbiór id albo watermark na profilu). Szuka po indeksie
  --    notifications_task_message_unread.
  update n2click.notifications n
  set read_at = now()
  from core.profiles p
  where n.type = 'task_message'
    and n.read_at is null
    and n.payload->>'conversationId' = new.conversation_id::text
    and n.recipient_id in (
      select m.user_id from n2click.conversation_members m
      where m.conversation_id = new.conversation_id and m.user_id <> new.author_id
    )
    and p.id = n.recipient_id
    and (
      ('notification:' || n.id::text) = any(p.notifications_read_ids)
      or n.created_at <= p.notifications_seen_at
    );

  -- 3. Obserwujący bez wzmianki (wzmianka wygrywa): jeden zbiorczy
  --    nieprzeczytany task_message na rozmowę.
  insert into n2click.notifications as n (recipient_id, type, payload, emailed_at)
  select
    m.user_id,
    'task_message',
    jsonb_build_object(
      'taskId', v_task,
      'conversationId', new.conversation_id,
      'messageId', new.id,
      'actorId', new.author_id,
      'count', 1
    ),
    now()
  from n2click.conversation_members m
  where m.conversation_id = new.conversation_id
    and m.user_id <> new.author_id
    and not (m.user_id = any(new.mention_ids))
    and (m.muted_until is null or m.muted_until <= now())
    and app.chat_user_can_read_task(m.user_id, v_task)
  order by m.user_id
  on conflict (recipient_id, (payload->>'conversationId'))
    where type = 'task_message' and read_at is null
  do update set
    payload = n.payload || jsonb_build_object(
      'taskId', excluded.payload->'taskId',
      'messageId', excluded.payload->'messageId',
      'actorId', excluded.payload->'actorId',
      'count', coalesce((n.payload->>'count')::integer, 1) + 1
    ),
    created_at = now();

  return null;
end;
$$;

comment on function n2click.chat_notify_task_message() is
  'AFTER INSERT na messages: task_mention na każdą wzmiankę, task_message zbiorczo (jeden nieprzeczytany na odbiorcę i rozmowę, count + ostatnia wiadomość). Odbiorca z wglądem w zadanie, bez autora, bez maila (emailed_at = now()).';

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

-- Granty (R1 finding 8): klient czyta, wstawia trzy typy przeglądarki i
-- ustawia read_at. TRUNCATE omija RLS, a DELETE, TRIGGER i REFERENCES nie
-- mają tu użytku (brak polityki DELETE, klient nie kasuje powiadomień).
revoke truncate, trigger, references, delete on n2click.notifications from authenticated;

revoke all on n2click.notifications from anon;
