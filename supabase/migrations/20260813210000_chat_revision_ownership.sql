-- =============================================================================
-- Migracja: 20260813210000_chat_revision_ownership
--
-- Domknięcie gwarancji rewizji z 20260813200000_chat_edit_stamp. Tamten trigger
-- stemplował `edited_at` przy zmianie `body`, ale NIE odbierał klientowi władzy
-- nad samym znacznikiem: grant kolumnowy obejmuje `edited_at`, więc UPDATE bez
-- zmiany treści mógł ten znacznik przestawić albo wyczyścić — a wtedy
-- „identyczna rewizja = identyczna treść" przestaje być prawdą i klientowy
-- reduktor scalania znów nie ma na czym się oprzeć. Do tego `now()` to znacznik
-- POCZĄTKU transakcji: dwie edycje w jednej transakcji dostałyby ten sam
-- stempel przy różnej treści.
--
-- Po tej migracji `edited_at` jest w CAŁOŚCI własnością serwera:
--   * zmiana `body`  => stempel `clock_timestamp()` (realny zegar wywołania,
--     różny dla kolejnych edycji także w obrębie jednej transakcji),
--   * brak zmiany    => znacznik PRZEPISANY ze starego wiersza — wartość
--     podana przez klienta nigdy nie ląduje w tabeli.
-- Przy okazji trigger egzekwuje TERMINALNOŚĆ kasowania miękkiego, na której
-- opiera się klientowe rozstrzyganie konfliktów: raz ustawionego `deleted_at`
-- nie można cofnąć ani przestawić.
--
-- `create or replace` podmienia funkcję w miejscu — trigger
-- `chat_messages_stamp_edit` na `n2click.messages` wskazuje ją po oid i nie
-- wymaga odtworzenia.
-- =============================================================================

create or replace function n2click.chat_stamp_message_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := clock_timestamp();
  else
    new.edited_at := old.edited_at;
  end if;

  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;

  return new;
end;
$$;
