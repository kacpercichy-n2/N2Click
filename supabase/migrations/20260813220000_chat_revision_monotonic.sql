-- =============================================================================
-- Migracja: 20260813220000_chat_revision_monotonic
--
-- Monotoniczność rewizji per wiadomość. `clock_timestamp()` z 20260813210000
-- to zegar ŚCIENNY: korekta NTP wstecz (albo skok zegara przy failoverze)
-- mogłaby dać PÓŹNIEJSZEJ edycji WCZEŚNIEJSZY znacznik — a wtedy klientowe
-- scalanie („ściśle nowszy `edited_at` wygrywa") znów cofałoby treść do
-- starszego wariantu. Klient porównuje rewizje wyłącznie W OBRĘBIE jednej
-- wiadomości, więc wystarczy monotoniczność per wiersz i tę właśnie wymuszamy:
-- stempel to `greatest(zegar, poprzednia rewizja + 1 µs, created_at + 1 µs)`,
-- czyli NIGDY nie mniejszy ani równy poprzedniemu znacznikowi (GREATEST
-- w Postgresie ignoruje NULL-e, więc pierwsza edycja opiera się o `created_at`,
-- a każda kolejna o poprzedni `edited_at`). Efekt uboczny w pożądaną stronę:
-- edycja zawsze przebija wariant nieedytowany tej samej wiadomości.
--
-- `create or replace` podmienia funkcję w miejscu — trigger
-- `chat_messages_stamp_edit` wskazuje ją po oid i nie wymaga odtworzenia.
-- =============================================================================

create or replace function n2click.chat_stamp_message_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := greatest(
      clock_timestamp(),
      old.edited_at + interval '1 microsecond',
      old.created_at + interval '1 microsecond'
    );
  else
    new.edited_at := old.edited_at;
  end if;

  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;

  return new;
end;
$$;
