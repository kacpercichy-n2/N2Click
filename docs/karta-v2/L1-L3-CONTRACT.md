# L1 -> L3: kontrakt bazy dla silnika czatu (stan po migracjach 20261102*)

Odpowiedź na `L3-NEEDS-FROM-L1.md`. Wszystko poniżej sprawdzone na Postgresie 17
(`docs/karta-v2/l1-pgtest`), niesprawdzone na hostowanej bazie.

## Zgodne z oczekiwaniami L3

- Topic `chat:conv:<id>`, eventy `INSERT` / `UPDATE` z `realtime.broadcast_changes`
  (`payload.record`) bez zmian.
- Pin i odpin podbijają `edited_at` monotonicznie, nawet gdy `body` się nie
  zmienia. Ponowny pin w tym samym stanie to no-op (bez rewizji, bez eventu).
  Kasowanie miękkie zdejmuje przypięcie (event UPDATE z `pinned_at: null`).
- Event `read` na tym samym topicu: `{ conversationId, userId, lastReadAt }`
  przez `realtime.send` (koperta jak `reaction`). `last_read_at` w przyszłości
  serwer obcina do teraz, więc broadcast może nieść wcześniejszy czas niż wysłany.
- `chat_overview()` zwraca `context_type`, `context_id` i w `members`
  `user_id, role, last_read_at, muted_until`. `muted_until` przy
  „Przestań obserwować” to string `"infinity"`.
- RPC: `chat_open_task(p_task_id) -> uuid`, `chat_set_pin(p_message_id, p_pinned) -> void`,
  `chat_set_follow(p_conversation_id, p_follow) -> void`. Odmowa = `42501` (`forbidden`).
- Edycja: `body`, serwer stempluje `edited_at`; kasowanie: `deleted_at`.
  `attachments`, `mention_ids`, `reply_to`, `pinned_*` są zapisywalne tylko przy INSERT
  (brak grantu kolumnowego UPDATE).

## Nowe rzeczy, które L3 może wykorzystać

- `last_message.attachments_count` w `chat_overview()`: podgląd w doku dla
  wiadomości z samym obrazem (`body` = '').
- Serwer deduplikuje `mention_ids` i usuwa z nich autora. Wspomniana osoba bez
  wglądu w zadanie NIE zostaje członkiem i nie dostaje powiadomienia.
- Rozmowa zadania ma `kind = 'group'`; rozpoznawać po `context_type === 'task'`
  (L3 już to robi w `isTaskConversation`).
- Indeks `messages_pinned (conversation_id, pinned_at desc) where pinned_at is not null`:
  pasek „Przypięte” może pobrać przypięte osobno
  (`.not('pinned_at', 'is', null)`), także spoza wczytanej strony.

## Uwagi i możliwe niezgodności

1. Brak eventu na zmianę obserwowania (`chat_set_follow`): awatary obserwujących
   u innych osób odświeżą się dopiero przy kolejnym `chat_overview` / select
   członków. Jeśli potrzebne na żywo, L1 może dodać event `follow` na topicu.
2. Dopisanie obserwującego przez wzmiankę / wykonawcę nadaje INSERT na
   `chat:user:<id>` (istniejący trigger), więc nowy obserwujący odświeży overview.
3. Błąd walidacji wiadomości ma SQLSTATE `22023` (ścieżka, typ, rozmiar, obce pola,
   ponad 10 obrazów, `reply_to` z innej rozmowy) albo `23514` (CHECK: pusta treść
   bez obrazu, ponad 50 wzmianek). Warto mapować oba na komunikat o niewysłaniu.
4. Członek, który stracił wgląd w zadanie, dostaje puste wyniki / `42501`
   przy pisaniu. `chat_open_task` też zwraca `42501`; karta powinna pokazać stan
   „brak dostępu”, a nie pętlę ponowień.
5. Powiadomienia `task_message` / `task_mention` nie oznaczają się same po
   przeczytaniu rozmowy w karcie. Jeśli karta ma je gasić, wystarczy dispatch
   `MARK_NOTIFICATION_ENTRY_READ` z id `taskConversationNotificationId(row.id)`
   (`src/store/selectors.ts`) dla wierszy z `payload.taskId` otwartego zadania.
   Decyzja dla L3/L4 i koordynatora; L1 tego nie wpina.
