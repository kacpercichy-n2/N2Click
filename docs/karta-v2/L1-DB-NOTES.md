# L1: notatki bazy dla koordynatora (karta zadania v2)

Stan: 4 migracje w repo, NIEZAAPLIKOWANE. Przetestowane na prawdziwym
Postgresie 17 z atrapą Supabase (`zsh docs/karta-v2/l1-pgtest/run.sh`, 88 asercji,
w tym ponowne uruchomienie wszystkich plików). Nie testowane na hostowanej bazie.

## Kolejność aplikacji

Każdy plik osobno, w tej kolejności, każdy jako jedna transakcja (MCP
`apply_migration` i `supabase db push` owijają plik same; pliki nie mają
`begin/commit`).

| # | Plik | Co robi |
|---|---|---|
| 1 | `20261102100000_task_conversations.sql` | Kolumny `messages.attachments / mention_ids / pinned_at / pinned_by`, nowe CHECK-i, unikalny kontekst rozmowy, helpery widoczności zadania, nowa wersja `app.is_conversation_member`, polityki (rozmowy, członkowie, UPDATE wiadomości), trigger walidacji treści, stempel rewizji przy pinie, auto-obserwujący, broadcast `read` + clamp `last_read_at`, RPC `chat_open_task` / `chat_set_pin` / `chat_set_follow`, `chat_overview()` z `muted_until` i `attachments_count`. |
| 2 | `20261102101000_task_chat_storage.sql` | Prywatny bucket `chat-attachments` (10 MB, webp/png/jpeg/gif) + helper `app.chat_attachment_member` + polityki select/insert/delete na `storage.objects`. |
| 3 | `20261102102000_task_chat_backfill.sql` | Import komentarzy zadań do rozmów zadań (te same id), bez powiadomień, bez broadcastów, bez kasowania. NOTICE z liczbą pominiętych i zaimportowanych. |
| 4 | `20261102103000_task_chat_notifications.sql` | Trigger powiadomień `task_message` / `task_mention` + zawężona polityka `notifications_insert`. |

Plik 3 MUSI iść przed 4 (inaczej import by powiadamiał; plik 3 i tak wyłącza
trigger, jeśli go zastanie, ale kolejność jest kontraktem).

Klient: stare wersje aplikacji pomijają nieznane typy powiadomień
(`loadNotificationsSnapshot`), więc migracje można zaaplikować przed wdrożeniem
frontu. Odwrotnie nie: nowy front bez migracji 1 dostaje błąd `chat_open_task`
i karta pokazuje błąd rozmowy.

## Smoke checki PRZED aplikacją (tylko odczyt)

```sql
-- A. Ile komentarzy zadań wejdzie i ile zostanie pominiętych (oczekiwane ~18 / 0).
select
  count(*) filter (where author_id is not null and char_length(body) between 1 and 4000) as do_importu,
  count(*) filter (where author_id is null) as bez_autora,
  count(*) filter (where author_id is not null and char_length(body) > 4000) as za_dlugie
from n2click.comments where task_id is not null;

-- B. Polityka tasks_select musi odpowiadać app.chat_can_read_task:
--    has_app('n2click') AND (is_administrator() OR is_manager() OR is_assigned_to_task(id))
--    AND company_ok_project(project_id). Inna treść = STOP, popraw funkcję w pliku 1.
select policyname, qual from pg_policies
where schemaname = 'n2click' and tablename = 'tasks' and cmd = 'SELECT';

-- C. Nazwa CHECK treści, którą plik 1 podmienia (oczekiwane: messages_body_check).
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'n2click.messages'::regclass and contype = 'c';

-- D. Brak rozmów z kontekstem (oczekiwane 0; inaczej unikalny indeks może nie wejść).
select context_type, context_id, count(*) from n2click.conversations
where context_type is not null group by 1, 2 having count(*) > 1;
select count(*) from n2click.conversations where context_type is not null;

-- E. Typ owner_id w Storage (oczekiwane: text).
select data_type from information_schema.columns
where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id';

-- F. Bieżąca polityka INSERT powiadomień (oczekiwane: has_app AND true).
select policyname, with_check from pg_policies
where schemaname = 'n2click' and tablename = 'notifications' and cmd = 'INSERT';

-- G. Typy wierszy powiadomień wstawianych dziś (nic poza task_assigned / project_comment / bin_item).
select type, count(*) from n2click.notifications group by 1;
```

## Smoke checki PO aplikacji (tylko odczyt)

```sql
-- 1. Kolumny.
select column_name, data_type, is_nullable, column_default from information_schema.columns
where table_schema = 'n2click' and table_name = 'messages'
  and column_name in ('attachments', 'mention_ids', 'pinned_at', 'pinned_by');

-- 2. Funkcje: definer + search_path ''.
select n.nspname || '.' || p.proname as fn, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
  ('n2click','chat_open_task'), ('n2click','chat_set_pin'), ('n2click','chat_set_follow'),
  ('n2click','chat_notify_task_message'), ('n2click','chat_message_auto_members'),
  ('n2click','chat_broadcast_read'), ('n2click','chat_validate_message_content'),
  ('app','chat_can_read_task'), ('app','chat_user_can_read_task'),
  ('app','chat_is_task_conversation'), ('app','chat_attachment_member'), ('app','is_conversation_member'));

-- 3. Uprawnienia (wszystkie oczekiwane wartości w komentarzu).
select
  has_function_privilege('anon', 'n2click.chat_open_task(uuid)', 'execute')               as anon_open,      -- false
  has_function_privilege('authenticated', 'n2click.chat_open_task(uuid)', 'execute')      as auth_open,      -- true
  has_function_privilege('authenticated', 'app.chat_user_can_read_task(uuid,uuid)', 'execute') as oracle,    -- false
  has_function_privilege('authenticated', 'app.chat_can_read_task(uuid)', 'execute')      as can_read,       -- false
  has_column_privilege('authenticated', 'n2click.messages', 'attachments', 'update')      as upd_att,        -- false
  has_column_privilege('authenticated', 'n2click.messages', 'pinned_at', 'update')        as upd_pin,        -- false
  has_column_privilege('authenticated', 'n2click.messages', 'body', 'update')             as upd_body,       -- true
  has_table_privilege('anon', 'n2click.messages', 'select')                               as anon_msg;       -- false

-- 4. Triggery na messages (AFTER INSERT alfabetycznie: auto_members, broadcast,
--    bump_conversation, notify_task) i wszystkie włączone (tgenabled = 'O').
select tgname, tgenabled from pg_trigger
where tgrelid in ('n2click.messages'::regclass, 'n2click.conversation_members'::regclass,
                  'n2click.conversations'::regclass) and not tgisinternal
order by tgrelid, tgname;

-- 5. Bucket i polityki Storage (oczekiwane: false, 10485760, 4 typy; 3 polityki).
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'chat-attachments';
select policyname, cmd from pg_policies where schemaname = 'storage' and policyname like 'chat_attachments_%';

-- 6. Import: rozmowy zadań, wiadomości z id komentarzy (= wynik A), komentarze nietknięte.
select count(*) as rozmowy_zadan from n2click.conversations where context_type = 'task';
select count(*) as zaimportowane from n2click.messages m join n2click.comments c on c.id = m.id;
select count(*) as komentarze_zadan from n2click.comments where task_id is not null;  -- jak przed
select count(*) as zle_daty from n2click.messages m join n2click.comments c on c.id = m.id
where m.created_at <> c.created_at or m.author_id <> c.author_id or m.body <> c.body;   -- 0

-- 7. Import nie powiadomił (oczekiwane 0).
select count(*) from n2click.notifications n join n2click.comments c on c.id::text = n.payload->>'messageId';
select count(*) from n2click.notifications where type in ('task_message', 'task_mention');  -- 0 tuż po aplikacji

-- 8. Obserwujący zaimportowanych rozmów: każdy z wglądem w zadanie (oczekiwane 0 wierszy).
select m.conversation_id, m.user_id from n2click.conversation_members m
join n2click.conversations c on c.id = m.conversation_id and c.context_type = 'task'
where not app.chat_user_can_read_task(m.user_id, c.context_id);

-- 9. Doradca bezpieczeństwa Supabase: get_advisors(type = 'security'), szukaj
--    nowych ostrzeżeń dla funkcji chat_* / bucketu chat-attachments.
```

Test ręczny po wdrożeniu frontu (dwa konta, ta sama spółka): A otwiera kartę
zadania, pisze `@B` (B przypisany) -> B ma `task_mention` w dzwonku, klik otwiera
kartę. C bez przypisania (pracownik) nie widzi rozmowy ani obrazu z podpisanego
URL-a starszego niż godzina.

## Rollback

Migracje są tylko-do-przodu; cofnięcie = nowa migracja. Szkic per plik:

- Plik 4: `drop trigger chat_messages_notify_task on n2click.messages;`
  `drop function n2click.chat_notify_task_message();` i polityka
  `notifications_insert` z powrotem na `with check ((select core.has_app('n2click')) and true)`.
  Wiersze `task_message` / `task_mention` można zostawić (stary front je pomija)
  albo usunąć `delete ... where type in (...)`.
- Plik 3: tylko gdy po imporcie nikt nie pisał w rozmowach zadań:
  `delete from n2click.messages m using n2click.comments c where c.id = m.id;`
  potem rozmowy zadań bez wiadomości. Komentarze są nietknięte, więc nic nie ginie.
- Plik 2: `drop policy chat_attachments_select|insert|delete on storage.objects;`
  bucket usuwa się przez API Storage (najpierw obiekty), nie SQL-em.
- Plik 1: przywrócić poprzednie wersje funkcji z plików źródłowych:
  `app.is_conversation_member` (20260813180000), `n2click.chat_stamp_message_edit`
  (20260813220000), `n2click.chat_overview` (20260825130000), polityki
  `chat_conversations_select/insert`, `chat_conversation_members_insert`
  (20260813180000), `chat_messages_update` (20260825130000); `drop trigger`
  `chat_messages_validate_content`, `chat_messages_auto_members`,
  `chat_members_read`, `chat_members_clamp_last_read`; `drop function` nowych RPC
  i helperów. Kolumny i CHECK-i można zostawić (addytywne, stary front ich nie
  czyta). Cofnięcie `messages_body_check` do `1..4000` zadziała tylko bez
  wiadomości z pustą treścią.

## Przegląd bezpieczeństwa (atakujący z ważnym JWT innej spółki albo bez przypisania)

| Element | Kto przechodzi | Atak i dlaczego nie działa |
|---|---|---|
| `chat_open_task` | `app.chat_can_read_task` = `tasks_select` | Cudze zadanie, inna spółka, losowe uuid: zawsze `42501`, nic nie powstaje (brak wyroczni istnienia). Test parytetu: 7 osób x 3 zadania, funkcja == RLS `tasks`. |
| `app.is_conversation_member` | członek + (dla zadania) bieżący wgląd | Odpięty od zadania członek traci SELECT wiadomości, kanał realtime, załączniki, edycję i powiadomienia, choć wiersz członkostwa zostaje (test „utrata wglądu”). |
| `chat_conversations_select` | członek; twórca tylko spoza zadań | Twórca rozmowy zadania po odpięciu nie widzi nawet wiersza z `context_id`. |
| `chat_conversations_insert` | `created_by` = ja, kontekst nie-zadanie | Rezerwacja rozmowy cudzego zadania przez API: odrzucona. |
| `chat_conversation_members_insert` | twórca, rozmowa nie-zadanie | Twórca rozmowy zadania nie dopisze obcej osoby (np. z innej spółki) bezpośrednio. |
| `chat_messages_insert` (bez zmian) + trigger walidacji | członek, `kind='text'` | Ścieżka załącznika z cudzej rozmowy, `../`, SVG, >10 MB, obce pola, >50 wzmianek, `reply_to` z innej rozmowy, `pinned_at` przy INSERT: odrzucone albo wyzerowane. |
| `chat_messages_update` | autor + członek | Granty kolumnowe bez zmian: `attachments`, `mention_ids`, `pinned_*`, `reply_to` nieedytowalne. |
| `chat_set_pin` | członek | Nie-członek i nieistniejąca wiadomość: ten sam `42501`. Pin nie zmienia autora ani treści. |
| `chat_set_follow` | członek, tylko własny wiersz | Nie zmieni obserwowania innej osoby. |
| Auto-obserwujący | autor, wspomniani, wykonawcy z wglądem | Wzmianka osoby bez wglądu jej nie dopisuje i nie powiadamia. W zwykłej grupie wzmianka nikogo nie dopisuje (inaczej byłby to sposób na wpuszczenie osoby do prywatnej historii). |
| `read` broadcast + clamp | własny wiersz członkostwa | Odczyt w przyszłości obcinany do teraz; cudzego odczytu nie zmienisz (polityka UPDATE). Payload to tylko id i czas. |
| Bucket `chat-attachments` | członek rozmowy z nazwy obiektu | Upload do cudzej rozmowy, podszycie `owner_id`, zła nazwa: odrzucone. Odczyt tylko członkowie. Usuwa tylko wgrywający. Brak UPDATE (nie nadpiszesz cudzego pliku). |
| `notifications_insert` | `has_app` + typy przeglądarki | Klient nie podrobi `task_message` / `task_mention`. |
| `app.chat_user_can_read_task` | tylko definery i service_role | Brak EXECUTE dla `authenticated`: nie da się odpytać „czy X widzi zadanie Y”. |

Ryzyka świadomie zostawione:

1. Podpisany URL obrazu działa do 1 h po utracie dostępu (cache L2 też 1 h).
2. Miękko skasowana wiadomość zachowuje `body` i `attachments` w API (tak było
   dotąd z treścią). Klient ukrywa, członek z narzędziem odczyta. Decyzja
   produktowa: czyścić przy kasowaniu wymagałoby zmiany CHECK-a treści.
3. `notifications_insert` dalej przyjmuje dowolny `payload` / `recipient_id` dla
   trzech starych typów (stan sprzed L1).
4. `app.chat_user_can_read_task` czyta tabele, `chat_can_read_task` czyta JWT.
   Różnią się tylko w oknie nieodświeżonego tokena po zmianie `app_access`.
5. Każdy wiersz powiadomienia wywołuje u odbiorcy pełną rehydrację planera
   (`notifications` jest w publikacji `supabase_realtime`, CloudSyncProvider
   słucha całego schematu, debounce 1,2 s). Aktywna rozmowa z 5 osobami = 4
   rehydracje na wiadomość. Do obserwacji po wdrożeniu (poza L1).
6. Powiadomień nie ubywa: `loadNotificationsSnapshot` czyta wszystkie wiersze
   odbiorcy bez okna czasu. Przy czacie przyrost jest szybszy niż dotąd.
