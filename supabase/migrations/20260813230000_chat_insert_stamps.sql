-- =============================================================================
-- Migracja: 20260813230000_chat_insert_stamps
--
-- Domknięcie własności znaczników czasu od strony INSERT. Hardening
-- 20260813190000/210000/220000 odebrał klientowi władzę nad znacznikami przy
-- UPDATE (granty kolumnowe + trigger stempla), ale INSERT pozostał z grantem
-- TABELOWYM — klient mógł więc WSTAWIĆ wiersz z dowolnymi wartościami:
--   * `messages.created_at` z przyszłości/przeszłości rozjeżdża porządek feedu,
--     kursory paginacji i punkt startu `loadMessagesSince` (dociąganie luki
--     liczy „nowsze niż ostatni znany created_at" — sfałszowany znacznik robi
--     w nadrabianiu dziurę), a preset `edited_at`/`deleted_at` fałszuje rewizję
--     od narodzin wiersza;
--   * `conversation_members`: twórca rozmowy wstawia CUDZE wiersze członkostwa,
--     więc preset `last_read_at` kasowałby komuś nieprzeczytane, a
--     `muted_until` wyciszał rozmowę bez jego wiedzy (jedyna para kolumn,
--     którymi wolno pisać cudzy stan — tym ważniejsze, żeby startowała czysto);
--   * `conversations.last_message_at` z przyszłości przypina rozmowę na
--     szczycie listy na zawsze.
-- Klient żadnego z tych pól przy INSERT nie wysyła (chatData.ts: wiadomość =
-- conversation_id/author_id/body/reply_to, rozmowa = kind/title/direct_key/
-- created_by, członkostwo = conversation_id/user_id/role), więc stemple niżej
-- niczego nie łamią — po prostu wartość klienta nigdy nie ląduje w tabeli.
--
-- Konwencja jak w 20260813210000: BEFORE-triggery bez `security definer`
-- (modyfikują wyłącznie NEW), `set search_path = ''`, idempotentnie.
-- =============================================================================

-- Wiadomość rodzi się z zegara serwera, nieedytowana i nieskasowana.
create or replace function n2click.chat_stamp_message_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  return new;
end;
$$;

drop trigger if exists chat_messages_stamp_insert on n2click.messages;
create trigger chat_messages_stamp_insert
  before insert on n2click.messages
  for each row execute function n2click.chat_stamp_message_insert();

-- Rozmowa startuje „teraz"; `last_message_at` podbija wyłącznie trigger
-- `chat_messages_bump_conversation`.
create or replace function n2click.chat_stamp_conversation_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.last_message_at := now();
  return new;
end;
$$;

drop trigger if exists chat_conversations_stamp_insert on n2click.conversations;
create trigger chat_conversations_stamp_insert
  before insert on n2click.conversations
  for each row execute function n2click.chat_stamp_conversation_insert();

-- Członkostwo startuje czyste: pełna historia nieprzeczytana ('epoch' — jak
-- default kolumny), bez wyciszenia, dołączenie z zegara serwera.
create or replace function n2click.chat_stamp_member_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.joined_at := now();
  new.last_read_at := 'epoch'::timestamptz;
  new.muted_until := null;
  return new;
end;
$$;

drop trigger if exists chat_members_stamp_insert on n2click.conversation_members;
create trigger chat_members_stamp_insert
  before insert on n2click.conversation_members
  for each row execute function n2click.chat_stamp_member_insert();
