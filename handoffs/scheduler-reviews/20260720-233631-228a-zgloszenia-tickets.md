# Raport workflow: 20260720-233631-228a-zgloszenia-tickets

## Wykonane

### Analiza wstępna

Najpierw sprawdziłem, czy funkcja jest już w bieżącym buildzie: `grep` po
`Ticket|ticket|zgloszen` w `src/` nie zwrócił NICZEGO, brak `TicketsPage.tsx`
i `TicketModal.tsx`. Zadanie było więc nadal do zrobienia — zaimplementowałem je
w całości, addytywnie, bez refaktoru istniejących kolekcji i bez dotykania
ścieżek pointer/drag kalendarza.

### Model

- `src/types.ts`: `Ticket` + typy `TicketKind` (`blad|usprawnienie|nowa-funkcja|inne`),
  `TicketPriority` (`niski|sredni|wysoki`), `TicketStatus`
  (`nowe|w-trakcie|zrobione|odrzucone`) oraz kolekcja `tickets: Ticket[]` w `AppData`.
  Pola: `id, title, area, description, kind, priority, status, reporterId,
  createdAt, updatedAt`.
- `src/utils/tickets.ts` (nowy): stałe zbiory wartości, wartości domyślne
  (`inne` / `sredni` / `nowe`), polskie etykiety UI i strażniki typów —
  wzorowane na `utils/priority.ts`. Slugi są persystowane, etykiety tylko do UI.
- `src/store/AppStore.tsx`: `TicketDraft` + akcje `ADD_TICKET` / `SAVE_TICKET` /
  `SET_TICKET_STATUS` / `DELETE_TICKET`. Nowe zgłoszenie zawsze startuje jako
  `nowe`; `updatedAt` odświeżany przy każdym zapisie i zmianie statusu;
  `createdAt` nietykalny. Bez kaskad i bez wpisów do dziennika aktywności
  (kolekcja samodzielna).
- `src/store/commandValidation.ts`: `isValidTicketDraft` (wymagane `title` i
  `description` po trim, `reporterId` musi istnieć w `people`, `kind`/`priority`
  z enuma) oraz `isValidTicketStatus`. Każde odrzucenie zwraca **tę samą
  referencję stanu** (inwariant 6) — pokryte testami, w tym `SET_TICKET_STATUS`
  na ten sam status (no-op).

### Storage

- `emptyData()` → `tickets: []`; `coerceArray(parsedRest.tickets, defaults.tickets)`
  w ścieżce wczytania tej samej wersji.
- Nowy pass `repairTickets` wpięty w OBIE ścieżki (`version < 2` i same-version):
  odrzuca wiersze bez `id`/`title`, normalizuje nieznane `kind`/`priority`/`status`
  do wartości domyślnych, koercjonuje pola tekstowe, jest idempotentny.
  Osierocony `reporterId` (osoba usunięta z zespołu) jest ZACHOWYWANY — historia
  zgłoszeń nie znika razem z kontem.
- **`DATA_VERSION` pozostaje 7** — wybrałem trasę addytywną, bo starszy zapis bez
  pola `tickets` dostaje `[]` ze spreadu `emptyData()`, a `migrateV1` też startuje
  z `emptyData()`. Migracja lokalna niczego nie wymaga.

### Uprawnienia

`src/store/permissions.ts`: `tickets.create` w allow-secie **wszystkich czterech
ról** (administrator, pm, handlowiec, pracownik) i `tickets.manage` **wyłącznie
dla administratora**. Oba dopisane do `MATRIX`; istniejący test macierzy
(`permissions.test.ts`) uzupełniony o nowe komórki — spec wymaga jednej komórki
na parę rola×akcja, więc bez tego nie kompilował się typ.

### UI

- `src/App.tsx`: trasa `/zgloszenia` + wiersz `NAV` („Zgłoszenia”, ikona `Inbox`
  re-eksportowana przez `src/components/icons.ts`). Zakładka **nie jest
  bramkowana** — widzi ją każdy, zgodnie z wymaganiem.
- `src/pages/TicketsPage.tsx`: segmentowany przełącznik u góry (reużywa
  `.toggle-btn` z paska kalendarza):
  - **„Zgłoś”** — otwiera modal (`?zgloszenie=new`),
  - **„Zgłoszone”** — tabela: nazwa, funkcja, rodzaj, priorytet, status,
    zgłaszający, data; sort od najnowszych; filtry status + rodzaj; wiersz
    rozwija pełny opis. Bez `tickets.manage` widać WYŁĄCZNIE własne wiersze
    (`reporterId === me.id`); z uprawnieniem — wszystkie plus inline `select`
    statusu i usuwanie z `window.confirm`.
- `src/components/TicketModal.tsx`: dokładnie wzorzec TaskModal —
  `?zgloszenie=new` / `?zgloszenie=<id>` przez `useSearchParams`, eksportowany
  hook `useOpenTicket()`, `role="dialog" aria-modal="true"`, `<AnimatePresence>`,
  rodzina klas `.task-modal-*`, montowany RAZ w `App.tsx` obok `TaskModal`.
  Pola w zadanej kolejności, w pełni kontrolowane, polskie etykiety, wymagane
  oznaczone ` *`, walidacja ręczna przy wysyłce jako
  `<p className="field-error" role="alert">` kasowana przy pisaniu, `.form-actions`
  z `btn primary` / `btn ghost`. Zarejestrowałem strażnik dirty-nawigacji: nowy
  zakres `'ticket-modal'` w `src/utils/dirtyRegistry.ts` (blokuje, gdy zmienia się
  parametr `zgloszenie`).
- `src/styles.css`: jeden modyfikator `.ticket-modal-card` + układ listy/tabeli
  (`.ticket-*`). Żadnej zmiany istniejących klas.

### Eksport

`src/pages/ticketsExport.ts` (czysty moduł, `.ts` — vitest go zbiera):
`buildTicketsCsv`, `csvCell`, `ticketExportDate`, `ticketsCsvFilename`.
Format: separator `;`, prefiks **BOM UTF-8**, końce linii **CRLF**, KAŻDA wartość
w cudzysłowach z podwajaniem `"`, polski nagłówek
(`Nazwa zgłoszenia;Funkcja / czego dotyczy;Rodzaj;Priorytet;Status;Zgłaszający;Data zgłoszenia;Opis`),
nazwa pliku `zgloszenia-${todayStr()}.csv`. Przycisk „Eksportuj” jest widoczny w
widoku „Zgłoszone” przy `tickets.manage` i serializuje **dokładnie aktualnie
przefiltrowany zbiór** (tabela i eksport czytają tę samą, jedną listę `visible`).
Pobranie reużywa istniejącego snippetu blob → `URL.createObjectURL` → anchor.
Zero nowych zależności.

### Chmura

- `supabase/migrations/20260720230000_tickets.sql` (forward-only, idempotentna:
  `create table if not exists`, `create index if not exists`,
  `drop policy if exists` przed każdą polityką, `drop trigger if exists`).
  Tabela `public.tickets`: CHECK-i zamiast typów enum, `reporter_id` → `profiles.id`
  `on delete cascade`, trigger `app.set_updated_at`, indeksy po `reporter_id`
  i `status`. RLS zgodnie ze stylem domu: `enable row level security`,
  `revoke all on public.tickets from anon`, wszystkie polityki `to authenticated`,
  insert/update z `with check`, bez `force row level security`, bez nowych funkcji.
  - `tickets_insert`: `with check (reporter_id = (select auth.uid()))` — wstawienie
    wyłącznie „na siebie”;
  - `tickets_select`: `app.is_administrator() or reporter_id = auth.uid()`;
  - `tickets_update`: administrator ZAWSZE, zgłaszający tylko dopóki
    `status = 'nowe'` (warunek w `using` i w `with check`);
  - `tickets_delete`: wyłącznie administrator.
- `src/supabase/migrations.test.ts`: plik dopisany do listy migracji **oraz**
  wpis `'public.tickets': ['select','insert','update','delete']` w `EXPECTED_POLICIES`.
- `src/supabase/cloudMirror.ts`: `ticketRow()` + sekcja diffu 8b (upsert
  dodanych/zmienionych, remove usuniętych po id; nie-UUID albo niemapowalny
  zgłaszający => diagnostyka, praca zostaje lokalnie).
- `src/supabase/plannerData.ts`: dziewiąty `select`, mapowanie wierszy
  (`reporter_id` przez reverse-resolver osób; brak tytułu albo niedostępny
  zgłaszający => wiersz wykluczony z polską diagnostyką) i grupa w
  `CloudMergePayload`.
- `MERGE_CLOUD_ENTITIES`: kolekcja podmieniana cloud-authoritatively; walidacja
  fail-closed (zgłaszający musi istnieć w finalnym zespole, enumy z zakresu).
  Pole `tickets` w ładunku jest **opcjonalne** (jak istniejące `people?`): brak =>
  reduktor nie rusza kolekcji. Świadoma decyzja, żeby nie wywracać istniejących
  ładunków/testów; `loadPlannerSnapshot` zawsze je podaje.

### Wiki

Zaktualizowane wszystkie trzy deklarowane strony (przeczytane PRZED kodem):
`cloud-database.md` (nowa tabela + polityki + brak realtime),
`state-and-persistence.md` (nowa kolekcja, akcje, repair pass, brak podbicia
wersji, opcjonalność w ładunku chmury) i `ui-navigation-and-onboarding.md`
(nowa zakładka, dwa tryby, zakres widoczności, wzorzec modalu).

## Zmiany

Nowe pliki:

- `src/utils/tickets.ts`, `src/pages/TicketsPage.tsx`, `src/pages/ticketsExport.ts`,
  `src/components/TicketModal.tsx`
- `supabase/migrations/20260720230000_tickets.sql`
- testy: `src/store/ticketActions.test.ts`, `src/store/ticketsStorage.test.ts`,
  `src/pages/ticketsExport.test.ts`

Zmodyfikowane: `src/types.ts`, `src/store/AppStore.tsx`,
`src/store/commandValidation.ts`, `src/store/storage.ts`,
`src/store/permissions.ts`, `src/store/seed.ts`, `src/App.tsx`,
`src/components/icons.ts`, `src/utils/dirtyRegistry.ts`,
`src/supabase/cloudMirror.ts`, `src/supabase/plannerData.ts`,
`src/supabase/migrations.test.ts`, `src/styles.css`,
`src/store/permissions.test.ts`, `src/supabase/plannerData.test.ts`,
trzy strony `openwiki/n2hub/*.md`.

## Weryfikacja

Uruchomione lokalnie przed oddaniem:

| Check | Wynik |
| --- | --- |
| `npx tsc --noEmit` | ✅ bez błędów |
| `npx vitest run src/store/ticketActions.test.ts src/pages/ticketsExport.test.ts` | ✅ 21 passed |
| `npx vitest run src/store/ticketsStorage.test.ts` | ✅ 9 passed |
| `npx vitest run src/supabase/migrations.test.ts` | ✅ 17 passed |
| `npm test` (pełny) | ✅ **37 plików, 998 testów passed, 0 failed** |
| `npm run build` | ✅ zielony (`built in 1.76s`) |

Nowe testy (30):

- `src/store/ticketActions.test.ts` — reduktor: dodanie ze statusem `nowe` i
  trimem, zapis odświeżający `updatedAt` bez ruszania `createdAt`/statusu, zmiana
  statusu, usunięcie oraz **komplet przypadków odrzucenia z asercją `toBe(state)`**
  (pusty tytuł/opis, nieznany `reporterId`, wartość spoza enuma, nieznane id,
  ustawienie tego samego statusu).
- `src/store/ticketsStorage.test.ts` — `emptyData().tickets`, repair (odrzucanie
  wierszy bez `id`/`title`, normalizacja nieznanych enumów, zachowanie
  osieroconego zgłaszającego, nie-tablica → `[]`, idempotencja) oraz macierz
  uprawnień (`tickets.create` dla każdej roli, `tickets.manage` tylko admin).
- `src/pages/ticketsExport.test.ts` — BOM, CRLF, separator `;`, dokładny wiersz
  nagłówka, tłumaczenie slugów na etykiety, escapowanie `"` i wartości ze
  średnikiem/nową linią, pusta lista = sam nagłówek, nazwa pliku.

Zmiany w istniejących testach — obie wymuszone przez typ/kształt, nie przez
osłabienie asercji:

- `src/store/permissions.test.ts` — dwie nowe komórki na rolę (spec macierzy
  wymaga `Record<PermAction, boolean>`).
- `src/supabase/plannerData.test.ts` — „empty payload” dostał `tickets: []`
  (pusty snapshot niesie teraz dziewiątą kolekcję).

## Ryzyka / rzeczy do sprawdzenia

- **Migracja nie jest zaaplikowana na hostowanym projekcie.** Plik jest
  forward-only i idempotentny, ale dopóki nie zostanie wykonany (SQL editor lub
  `db push`), w trybie supabase `select`/`upsert` na `tickets` będzie zwracał błąd:
  hydracja planera fail-closed zwróci `PLANNER_SNAPSHOT_ERROR`, a operacje zapisu
  wylądują w kolejce jako `transient`. **Do wykonania przed deployem** — zgodnie
  z zapisem w pamięci projektu `db push` bywa niedostępny po IPv6, więc realną
  drogą jest SQL editor + ręczny wpis do rejestru migracji.
- **Brak realtime dla zgłoszeń.** Nie dopisałem `public.tickets` do publikacji
  `supabase_realtime` (osobna migracja, poza zakresem zadania). Skutek: nowe
  zgłoszenie kolegi nie pojawi się managerowi „na żywo” — dopiero po odświeżeniu /
  ponownej hydracji. Świadoma decyzja, odwracalna jedną migracją.
- **Zakres widoczności w UI to bramka UX, nie granica bezpieczeństwa.** Filtr
  „tylko własne” w `TicketsPage`/`TicketModal` jest kosmetyką; prawdziwą
  autoryzację niesie RLS. W trybie lokalnym (bez Supabase) `tickets` żyje wyłącznie
  w localStorage i jest, jak reszta danych, edytowalne przez użytkownika.
- **Rozjazd reguł edycji client vs. serwer.** Lokalny reduktor pozwala właścicielowi
  zapisać własne zgłoszenie w każdym statusie, a polityka `tickets_update`
  przepuszcza nie-administratora tylko dopóki status = `nowe`. Późniejsza edycja
  przez zgłaszającego zostanie więc odrzucona przez serwer i wyląduje w `dropped`
  z polskim komunikatem o braku uprawnień (praca zostaje lokalnie) — spójne
  z istniejącym modelem, ale warto o tym wiedzieć.
- `Ticket.description` nie ma limitu długości po stronie kolumny (`text`);
  `title`/`area` mają CHECK 1–300 / ≤300 i `maxLength` w formularzu.
- Bez załączników, bez powiadomień e-mail/Slack, bez nowych paczek npm.
  `DATA_VERSION` bez zmian, tryb wycofania (retirement) nietknięty, ścieżki
  pointer/drag kalendarza nietknięte.

## Podpis schedulera

- Run: `20260720-233631-228a-zgloszenia-tickets`
- Prompt: `228a-zgloszenia-tickets.md`
- Gałąź review: `review-integration`
- Baza: `ff0864c0b49048dbc508fc81f4e02e3b5a340132`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `ff0864c0b49048dbc508fc81f4e02e3b5a340132`
- Gałąź review: `review-integration`
- Run: `20260720-233631-228a-zgloszenia-tickets`

### Pliki zgłoszone do review

- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/components/icons.ts`
- `src/store/AppStore.tsx`
- `src/store/commandValidation.ts`
- `src/store/permissions.test.ts`
- `src/store/permissions.ts`
- `src/store/seed.ts`
- `src/store/storage.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/plannerData.ts`
- `src/types.ts`
- `src/utils/dirtyRegistry.ts`
- `handoffs/scheduler-reviews/20260720-233631-228a-zgloszenia-tickets.md`
- `src/components/TicketModal.tsx`
- `src/pages/TicketsPage.tsx`
- `src/pages/ticketsExport.test.ts`
- `src/pages/ticketsExport.ts`
- `src/store/ticketActions.test.ts`
- `src/store/ticketsStorage.test.ts`
- `src/utils/tickets.ts`
- `supabase/migrations/20260720230000_tickets.sql`
