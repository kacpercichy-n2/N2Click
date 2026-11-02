# L1 -> L3: kontrakt bazy dla silnika czatu (stan po migracjach 20261102*, runda F1)

Odpowiedź na `L3-NEEDS-FROM-L1.md`, zaktualizowana po przeglądzie R1 i BACKLOG 1
(F1, 2026-11-02). Wszystko poniżej sprawdzone na Postgresie 17
(`docs/karta-v2/l1-pgtest`), niesprawdzone na hostowanej bazie.

## ZMIANA 1: rewizja wiersza `messages.revised_at` (BACKLOG 1)

Klient czatu (F2) implementuje to równolegle. Dokładny kontrakt:

| Kolumna | Kiedy się zmienia | Do czego w kliencie |
|---|---|---|
| `revised_at timestamptz NOT NULL` | INSERT: `= created_at`. Potem podbijana MONOTONICZNIE (zawsze > poprzednia) przy każdej zmianie `body` (edycja), `pinned_at` (pin, odpin) i `deleted_at` (kasowanie miękkie). UPDATE bez zmiany tych pól nie zmienia rewizji. | Scalanie stron i broadcastów: wiersz z `revised_at` nie nowszym niż znany odrzucić; nowszy zastępuje. |
| `edited_at timestamptz NULL` | WYŁĄCZNIE gdy zmienia się `body`. Pin, odpin i kasowanie NIE ruszają `edited_at`. | Etykieta „(edytowana)” = `edited_at !== null`. |
| `deleted_at` | Kasowanie miękkie, terminalne (nie da się cofnąć). Zdejmuje przypięcie w tym samym UPDATE. | Bez zmian. |

- Broadcast `UPDATE` i `INSERT` na `chat:conv:<id>` niesie pełny wiersz w
  `payload.record`, więc `record.revised_at` jest zawsze obecne (string ISO).
  Select wiadomości (`select('*')` albo lista kolumn) musi dołożyć `revised_at`.
- Wiersze sprzed migracji: `revised_at` = najpóźniejszy z `created_at`,
  `edited_at`, `deleted_at`. Nigdy NULL.
- Klient NIE pisze `revised_at` (brak grantu UPDATE; przy INSERT trigger nadpisuje).
- Optymistyczny pin w kliencie (bez nowej rewizji) jest zastępowany przez
  broadcast UPDATE z nowszą `revised_at`.
- Okno przejściowe: stary front scala po `edited_at`, więc po aplikacji
  migracji, a przed wdrożeniem frontu F2, pin u innych osób pojawi się dopiero
  po przeładowaniu. Migracja i front F2 powinny wejść razem.

## ZMIANA 2: kanały Realtime (R1 finding 1, połowa bazy)

Hostowany Realtime sprawdza prawo NADAWANIA raz, przy dołączeniu do kanału
(próbny wiersz `realtime.messages` z samym `topic` i `extension`, bez `event`;
źródło: `supabase/realtime` `lib/realtime/tenants/authorization.ex` i docs
„Realtime Authorization”: „Client access policies are cached for the duration
of the connection”). Polityka nie odróżni więc `typing` od `INSERT` na tym
samym topicu. Dlatego topiki są rozdzielone:

| Topic | Klient słucha | Klient nadaje |
|---|---|---|
| `chat:conv:<conversationId>` | `INSERT`, `UPDATE` (wiersz wiadomości), `read`, `reaction`, `theme_changed` | NIC (każda próba = brak prawa zapisu) |
| `chat:typing:<conversationId>` (NOWY) | `typing` | WYŁĄCZNIE broadcast `typing`, payload `{ userId }` |
| `chat:presence` | presence `sync` | WYŁĄCZNIE presence `track({ userId })` |
| `chat:user:<selfId>` | `INSERT`, `DELETE` członkostwa | NIC |

Do zrobienia w kliencie (F2, `src/chat/ChatProvider.tsx`):

1. `sendTyping` nadaje na kanale `chat:typing:<id>` (`private: true`), nie na
   `chat:conv:<id>`; `.on('broadcast', { event: 'typing' })` przenieść na ten kanał.
   Autoryzacja odbioru i nadawania: ta sama co rozmowa (`app.chat_topic_member`,
   członek + dla zadania bieżący wgląd).
2. Na `chat:conv:<id>` zostają tylko słuchacze. Dalej obowiązuje poprawka
   kliencka z R1 (odrzucać event, którego `conversationId` /
   `record.conversation_id` różni się od kanału; INSERT/UPDATE traktować jako
   wskazówkę i scalać wiersz pobrany przez PostgREST). Po tej migracji podróbka
   na `chat:conv` jest niemożliwa z klienta, ale obrona w głąb zostaje tania.
3. Podrobione `typing` na `chat:typing` daje najwyżej fałszywe „pisze…” w
   rozmowie, do której nadawca należy. Ignorować `userId` równe własnemu.

Okno przejściowe: stary front nadaje „pisze…” na `chat:conv`, więc po aplikacji
migracji, a przed frontem F2, wskaźnik pisania milknie (reszta czatu działa).

## ZMIANA 3: wzmianki (R1 finding 7)

Trigger `chat_messages_validate_content` zostawia w `mention_ids` tylko:
osoby nazwane w treści jako `@Imię` (`core.profiles.first_name`, bez
rozróżniania wielkości liter, granica słowa jak `parseChatMentions`), bez
autora, a w rozmowie zadania tylko osoby z wglądem w zadanie. Reszta odpada po
cichu (wiadomość przechodzi). Limit: 20 wzmianek (CHECK, SQLSTATE `23514`).
Klient wysyłający `mention_ids` z `parseChatMentions` nie musi nic zmieniać.

## ZMIANA 4: kolejność błędów przy INSERT wiadomości (R1 finding 6)

Nie-członek (także członek, który stracił wgląd w zadanie) dostaje `42501`
zanim trigger sprawdzi `reply_to`, załączniki czy treść. Członek dalej dostaje
`22023` za zły `reply_to`, ścieżkę, typ i rozmiar załącznika.

## Bez zmian (zgodne z oczekiwaniami L3)

- Topic `chat:conv:<id>`, eventy `INSERT` / `UPDATE` z `realtime.broadcast_changes`
  (`payload.record`). Ponowny pin w tym samym stanie to no-op (bez rewizji,
  bez eventu). Kasowanie miękkie zdejmuje przypięcie (event UPDATE z `pinned_at: null`).
- Event `read` na `chat:conv:<id>`: `{ conversationId, userId, lastReadAt }`
  przez `realtime.send`. `last_read_at` w przyszłości serwer obcina do teraz.
- `chat_overview()` zwraca `context_type`, `context_id`, w `members`
  `user_id, role, last_read_at, muted_until` (`"infinity"` = nie obserwuje) i
  `last_message.attachments_count`.
- RPC: `chat_open_task(p_task_id) -> uuid`, `chat_set_pin(p_message_id, p_pinned) -> void`,
  `chat_set_follow(p_conversation_id, p_follow) -> void`. Odmowa = `42501` (`forbidden`).
- Edycja: `body`; kasowanie: `deleted_at`. `attachments`, `mention_ids`,
  `reply_to`, `pinned_*`, `revised_at` nie są zapisywalne z klienta przy UPDATE.
- Zwykły INSERT rozmowy nie może ustawić `context_type` / `context_id`
  (ani zadanie, ani projekt, ani klient). Klient tego nie robi.
- Rozmowa zadania ma `kind = 'group'`; rozpoznawać po `context_type === 'task'`.
- Indeks `messages_pinned (conversation_id, pinned_at desc) where pinned_at is not null`
  dla paska „Przypięte” spoza wczytanej strony.

## Powiadomienia rozmowy zadania (dla karty i dzwonka)

- `task_mention`: jeden wiersz na wzmiankę.
- `task_message`: ZBIORCZY, najwyżej jeden nieprzeczytany na (odbiorca, rozmowa).
  Kolejna wiadomość aktualizuje ten sam wiersz: `payload.count` + 1,
  `payload.messageId` / `payload.actorId` ostatniej wiadomości, świeży `created_at`.
- Wiersz jest „przeczytany”, gdy ma `read_at` ALBO jego wpis
  `notification:<id>` jest w `notifications_read_ids` profilu ALBO
  `created_at <= notifications_seen_at`. Następna wiadomość zamyka taki wiersz
  (`read_at = now()`) i zakłada nowy z `count = 1`. Karta gasi powiadomienia jak
  dotąd (`MARK_NOTIFICATION_ENTRY_READ` z `taskConversationNotificationId(row.id)`).
- Zdanie w dzwonku i Panelu: „Nowa wiadomość od Ola Nowak w zadaniu: Key visual”,
  „3 nowe wiadomości w zadaniu: Key visual”, „5 nowych wiadomości …”,
  „Ola Nowak wspomniał(a) Cię w zadaniu: …”.

## Uwagi i możliwe niezgodności

1. Brak eventu na zmianę obserwowania (`chat_set_follow`): awatary obserwujących
   u innych osób odświeżą się przy kolejnym `chat_overview` / select członków.
2. Dopisanie obserwującego przez wzmiankę / wykonawcę nadaje INSERT na
   `chat:user:<id>` (istniejący trigger), więc nowy obserwujący odświeży overview.
3. Błąd walidacji wiadomości: `22023` (ścieżka, typ, rozmiar, obce pola, ponad
   10 obrazów, `reply_to` z innej rozmowy), `23514` (pusta treść bez obrazu,
   ponad 20 wzmianek), `42501` (brak członkostwa).
4. Członek, który stracił wgląd w zadanie, dostaje puste wyniki / `42501`.
   `chat_open_task` też zwraca `42501`; karta pokazuje stan „brak dostępu”.
5. Realtime pamięta autoryzację kanału do końca połączenia albo odświeżenia
   tokena: osoba odpięta od zadania słyszy `chat:conv:<id>` do reconnectu albo
   `setAuth` z nowym tokenem (do 1 h). Zapytania PostgREST odcina od razu.
