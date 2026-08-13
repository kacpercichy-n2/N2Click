-- =============================================================================
-- Migracja: 20260813200000_chat_edit_stamp
--
-- Serwerowy STEMPEL REWIZJI edycji wiadomości. Klient scala warianty tej samej
-- wiadomości z dwóch źródeł (broadcast i równoległe pobrania stron) i konflikt
-- rozstrzyga po `edited_at`. Ten znacznik był dotąd dobrowolny: grant kolumnowy
-- pozwala zmienić `body` bez podbicia `edited_at`, a wtedy dwa RÓŻNE warianty
-- treści mają identyczną rewizję i remis jest po stronie klienta
-- NIEROZSTRZYGALNY — dowolny wybór albo cofa edycję starym snapshotem, albo
-- ignoruje prawidłową zmianę (przegląd 2026-08-13, dwie iteracje tego samego
-- błędu). Trigger BEFORE UPDATE gwarantuje: KAŻDA zmiana `body` = nowszy
-- `edited_at` z zegara serwera. Po tej gwarancji remis rewizji oznacza tę samą
-- edycję, więc klient bezpiecznie zostawia wariant już posiadany.
--
-- BEZ `security definer`: funkcja modyfikuje wyłącznie NEW, niczego nie czyta.
-- Stempel serwerowy wygrywa też z wartością `edited_at` podaną przez klienta —
-- jeden zegar (Postgres), zero rozjazdów między urządzeniami.
-- =============================================================================

create or replace function n2click.chat_stamp_message_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists chat_messages_stamp_edit on n2click.messages;
create trigger chat_messages_stamp_edit
  before update on n2click.messages
  for each row execute function n2click.chat_stamp_message_edit();
