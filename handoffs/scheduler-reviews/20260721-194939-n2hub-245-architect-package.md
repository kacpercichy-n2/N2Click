# Handoff: Dodaj wydarzenia/spotkania — model, kalendarz, panel „Wydarzenia”, chmura

- Package ID: PKG-20260721-events-panel
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium (dotyka WeekView — zmiany WYŁĄCZNIE prezentacyjne, inwariant 7)
- Codex review: required — nowa encja przez wszystkie granice (reduktor, storage, mirror, RLS)

## Goal

Jedna nowa, ADDYTYWNA encja `CalendarEvent` (spotkanie/wydarzenie) dostępna z
menu kontekstowego kalendarza, renderowana w WeekView/MonthView innym kolorem
niż zadania, zarządzana w nowym panelu `/wydarzenia` (modal URL-driven), z
kolekcją `events` w `AppData`, repairem wczytania, mirrorowaniem do
`public.events` (RLS) i autorytatywną hydracją przez `MERGE_CLOUD_ENTITIES`.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`

## Expected touchpoints

- `src/types.ts` — `CalendarEvent` po `Ticket` (~l. 341); `events: CalendarEvent[]` w `AppData` po `tickets` (~l. 403)
- `src/store/AppStore.tsx` — Action union (~l. 266–269), casy reduktora obok ticketów (~l. 3528–3586), `mergeCloudEntities` (l. 2588–2723; wzorzec opcjonalnych `tickets`: l. 2600–2602, 2622, 2677–2684, 2717–2719)
- `src/store/commandValidation.ts` — `EventDraft`, `isValidEventDraft` (wzorzec `isValidTicketDraft`)
- `src/store/selectors.ts` — `calendarEventsForDate` (wzorzec `recurrenceOccurrencesForDate`, l. 357)
- `src/store/storage.ts` — `emptyData()` + KAŻDY literał `AppData` (l. ~122, ~222, ~451) dostaje `events: []`; `coerceArray(parsedRest.events, …)` w bloku l. 1433–1449; nowy `repairEvents` (wzorzec `repairTickets`, l. 1070–1094) wpięty po `repairProjectDocuments` (l. 1479) — obejmuje OBIE ścieżki wczytania; `DATA_VERSION` ZOSTAJE 7
- `src/store/permissions.ts` — `events.manage` w `PermAction` (l. 23–37) i `MATRIX` (l. 40–85)
- `src/utils/recurrence.ts` — REUŻYCIE (bez zmian): `normalizeRecurrence`, `isOccurrenceDate`, `expandOccurrences`, `isoWeekday`
- `src/utils/projectDocuments.ts` — REUŻYCIE `normalizeProjectDocumentUrl` dla `meetingUrl`
- `src/components/WeekView.tsx` — `canManageTasks` (l. 1022), `openSlotMenu` (l. 1181–1197), `addTaskInSlot` (l. 1201–1206), `onContextMenu` kolumny (l. 1612), render slotMenu (l. 1968–1991), wzorzec `RecurBlock` (l. 961–1011) + render overlay (l. 1621–1634)
- `src/components/MonthView.tsx` — znacznik dnia (wzorzec `month-cell-recur`, l. 67–111)
- `new: src/components/EventModal.tsx` — wzorzec `TicketModal` (`?zgloszenie=`, l. 24, 30) + prefill jak `useOpenTask` (`TaskModal.tsx` l. 82–118)
- `new: src/pages/EventsPage.tsx`
- `src/App.tsx` — NAV (l. 87–102), route (l. 494–528), montaż modala obok `<TicketModal />` (l. 534–536)
- `src/components/icons.ts` — eksport `CalendarClock`
- `src/utils/dirtyRegistry.ts` — scope `'event-modal'` (`NavGuardScope` l. 37, `navGuardBlocks` l. 76–78)
- `src/styles.css` — tokeny w `:root` (l. 11–150), klasy `.week-event-block` (obok `.week-recur-block`, l. 1867) i `.month-cell-event` (obok `.month-cell-recur`, l. 2141)
- `src/supabase/cloudMirror.ts` — `eventRow` (wzorce: `ticketRow` l. 307–333, mapowanie osób `draftHoursRow` l. 278–292), diff jako DZIESIĄTA rodzina (wzorzec ticketów l. 604–615)
- `src/supabase/plannerData.ts` — `CloudMergePayload.events?` (wzorzec `tickets?` l. 180), select + mapowanie wierszy (l. 312–347, 609–646)
- `new: supabase/migrations/20260721210000_events.sql`
- `src/supabase/migrations.test.ts` — lista plików (l. 101–124) + `EXPECTED_POLICIES` (l. 36–74)
- `new: src/store/eventActions.test.ts`; rozszerzenia: `storage.test.ts`, `cloudMerge.test.ts`, `cloudMirror.test.ts`, `plannerData.test.ts`

## Invariants

- Inwariant 1: wydarzenia NIGDY nie tworzą wierszy `WorkloadEntry` i nie zasilają
  sum/`dayTotal`/przeciążenia/kolizji/`packDayBlocks` — są czysto prezentacyjne.
- Inwariant 6: każda niepoprawna komenda (`ADD_EVENT`/`SAVE_EVENT`/`DELETE_EVENT`,
  niepoprawny ładunek `MERGE_CLOUD_ENTITIES`) zwraca TĘ SAMĄ referencję stanu.
- Inwariant 7: ZERO zmian w pointer/drag/resize, hit-teście gridu,
  `packDayBlocks`, cleanupie wskaźnika i targetowaniu kolumn. Blok wydarzenia nie
  ma ŻADNYCH handlerów pointer poza click/keyboard/contextmenu-guard.
- `DATA_VERSION` zostaje 7 (kolekcja ADDYTYWNA — wzorzec `tickets`); czysty load
  bieżącej wersji nie może echo-write'ować (`repairEvents` idempotentny po wartości).
- Kanoniczna forma pól (patrz decyzje) jest nośna dla reference-preserving merge:
  wiersz identyczny po wartości zachowuje obiekt, no-op merge zwraca oryginalną
  referencję stanu.
- Wszystkie stringi UI po polsku; zero nowych zależności npm; migracja tylko jako
  plik w repo (NIE aplikować na zdalną bazę); retirement/persistGate bez zmian
  (`events` to kolekcja MIRRORED — NIE dodawać do `NON_MIRRORED_KEYS`).

## Prior decisions (wszystkie rozstrzygnięte — nie otwierać ponownie)

1. **Model** (`src/types.ts`):

   ```ts
   export interface CalendarEvent {
     id: string;
     title: string;            // wymagane (trim niepusty)
     description: string;      // '' gdy brak
     location: string;         // biuro/lokalizacja; '' gdy brak
     meetingUrl: string;       // '' albo znormalizowany http(s) URL
     date: DateStr;            // kotwica; dla cyklicznych = anchor reguły
     startMinutes: number;     // 0..1425, wielokrotność 15
     durationMinutes: number;  // 15..1440, wielokrotność 15; start+dur <= 1440
     attendeeIds: string[];    // ids z people, zdeduplikowane; [] = ogólnofirmowe
     recurrence?: TaskRecurrence; // REUŻYTY typ; brak klucza = jednorazowe
     createdAt: string;
     updatedAt: string;
   }
   ```

   `AppData.events: CalendarEvent[]` tuż po `tickets`.

2. **Cykliczność — reużycie, nie nowa implementacja.** `recurrence` waliduje
   `normalizeRecurrence(raw, event.date)` z `src/utils/recurrence.ts`. Forma
   kanoniczna dla WYDARZEŃ (egzekwowana na trzech granicach: reduktor,
   `repairEvents`, hydracja `plannerData`):
   - `rule.startMinutes === event.startMinutes` i `rule.durationMinutes ===
     event.durationMinutes` (czas wydarzenia JEST czasem reguły; reduktor
     NADPISUJE pola reguły wartościami wydarzenia przed normalizacją; repair i
     hydracja przepisują rozjechane wartości na czasy wydarzenia),
   - `daysOfWeek` MUSI zawierać `isoWeekday(event.date)` (baza zawsze widoczna);
     reduktor odrzuca draft bez tego; repair/hydracja przy braku USUWAJĄ klucz
     `recurrence` (wydarzenie zostaje jednorazowe),
   - `overrides`: UI ich NIE tworzy (brak menu wystąpień w v1), ale wartości
     kanoniczne z storage/chmury przechodzą przez `normalizeRecurrence` i są
     honorowane przez `expandOccurrences` bez dodatkowego kodu.

3. **Akcje reduktora**: `ADD_EVENT { draft: EventDraft }`,
   `SAVE_EVENT { eventId: string; draft: EventDraft }`,
   `DELETE_EVENT { eventId: string }`. `EventDraft` = pola modelu bez
   id/createdAt/updatedAt, `recurrence: unknown | null`. Walidacja
   `isValidEventDraft` w `commandValidation.ts`: pusty tytuł, zła data, czas poza
   siatką 15 min / poza dobą, `attendeeIds` niebędące tablicą stringów istniejących
   w `people`, `meetingUrl` odrzucony przez `normalizeProjectDocumentUrl`
   (niepusty, ale nie-http(s) — `javascript:`/`data:` itd.), cykliczność bez
   weekday kotwicy albo strukturalnie zła ⇒ TA SAMA referencja. Reduktor zapisuje
   wartości znormalizowane (trim, dedupe attendees, URL znormalizowany, recurrence
   kanoniczna). `SAVE_EVENT` na nieznanym id i `DELETE_EVENT` na nieznanym id ⇒ ta
   sama referencja. Bez wpisów dziennika aktywności (parytet z ticketami).

4. **Uprawnienia**: NOWA akcja `events.manage` w `PermAction`, przyznana
   `administrator` + `pm` + `handlowiec` (parytet z dzisiejszym `tasks.manage`;
   handlowiec umawia spotkania z klientami). `pracownik` tylko ogląda. Gate w UI:
   pozycja menu slotu, przycisk „+ Dodaj wydarzenie”, edycja/usuwanie w
   modalu/panelu. Reduktor NIE sprawdza uprawnień (permissions są UX-only —
   CLAUDE.md).

5. **WeekView/MonthView — czysto prezentacyjne**:
   - Nowy `EventBlock` (kopiuj strukturę `RecurBlock`, l. 961–1011): pozycja
     `top = startMinutes/60*HOUR_PX`, wysokość ∝ `durationMinutes`, klasa
     `.week-event-block`, brak handlerów pointer; click/Enter/Space otwiera
     `?wydarzenie=<id>`. Renderowany w kolumnie dnia PRZED `RecurBlock`ami
     (tree-order; realne bloki zawsze malują się NA wierzchu, jak overlay
     cykliczności — patrz komentarz l. 1621–1624).
   - Źródło: nowy selektor `calendarEventsForDate(state, date, filter?)` →
     `Array<{ event; startMinutes; durationMinutes }>`: jednorazowe po
     `event.date === date`; cykliczne przez `expandOccurrences(rule, event.date,
     date, date)` (honoruje overrides). Filtr osób: pusty/brak = wszystko;
     niepusty = przecięcie z `attendeeIds` LUB `attendeeIds.length === 0`
     (wydarzenie ogólnofirmowe widać zawsze).
   - `openSlotMenu` (l. 1181–1197): dodatkowy guard
     `closest('.week-event-block') → return` (jak `.week-recur-block`, l. 1186);
     gate zmienia się z `canManageTasks` na `canManageTasks || canManageEvents`
     (także w `onContextMenu` kolumny, l. 1612). W slotMenu (l. 1979–1988) druga
     pozycja „+ Dodaj spotkanie (HH:mm)” renderowana przy `canManageEvents`,
     dotychczasowa „+ Dodaj zadanie” przy `canManageTasks`. Handler
     `addEventInSlot` (wzorzec `addTaskInSlot`, l. 1201–1206): prefill data slotu,
     `startMinutes` ze snapu, osoba gdy filtr == 1 osoba.
   - MonthView: znacznik `.month-cell-event` „📅” z `title="Wydarzenia: …"`
     (wzorzec `month-cell-recur`, l. 102–111); przy kolizji ze znacznikami 🎂/⟳
     przesuwaj inline `right` o kolejne 18 px (wzorzec l. 105). Bez bloków i menu.
   - ZAKAZ: dotykania `packDayBlocks`, `TimedBlock`, drag/pointer, hit-testu.

6. **Tokeny CSS** (`:root`): `--event-accent: var(--n2-info);`
   `--event-accent-soft: var(--n2-info-soft);` (cyjan — wyraźnie inny niż
   fioletowo-lawendowa paleta zadań). `.week-event-block`: solidna ramka
   `1px solid var(--event-accent)` + lewy pasek 3px, tło `var(--event-accent-soft)`,
   `z-index: 0`, layout/typografia jak `.week-recur-block` (l. 1867–1911), bez
   przerywanej ramki (to nie ghost). `.month-cell-event` jak `.month-cell-recur`.

7. **Panel i modal**:
   - Route `/wydarzenia`, NAV po `/calendar`: `['/wydarzenia', 'Wydarzenia',
     CalendarClock]` (dodać `CalendarClock` do `src/components/icons.ts`).
   - `EventsPage`: przełącznik segmentowy „Nadchodzące” / „Minione” (default
     Nadchodzące; granica: `date >= dziś` po dacie bazowej), sort rosnąco po
     `(date, startMinutes)` (Minione malejąco), wiersz: data, zakres godzin,
     tytuł, uczestnicy (imiona/awatary), lokalizacja, link „Dołącz” renderowany
     jako `href` WYŁĄCZNIE gdy `normalizeProjectDocumentUrl` przepuści (granica
     renderu — parytet z dokumentami projektu), badge „Cykliczne: pon, śr …” gdy
     reguła. Klik wiersza otwiera modal; „+ Dodaj wydarzenie” przy `events.manage`.
   - `EventModal.tsx` (wzorzec `TicketModal`): montowany RAZ w App (obok
     `<TicketModal />`, l. 536), sterowany `?wydarzenie=new|<id>`; prefill przez
     parametry `wydarzenieData` (yyyy-MM-dd), `wydarzenieStart` (minuty),
     `wydarzenieOsoba` (personId) — nazwy celowo rozłączne z `date`/`assignee`
     TaskModala; hook `useOpenEvent()` czyści je przy otwarciu istniejącego.
     Scope strażnika nawigacji: `'event-modal'` (`NavGuardScope` + warunek
     `wydarzenieChanged` w `navGuardBlocks`, wzorzec `ticket-modal`).
   - Pola (polskie, kontrolowane, wymagane z „ *”): „Tytuł *”, „Data *”,
     „Początek *” i „Koniec *” (inputy czasu, krok 15 min; duration pochodna),
     „Osoby” (checkboxy zespołu), „Link do spotkania”, „Biuro / lokalizacja”,
     „Opis”, sekcja „Cykliczność”: radio „Jednorazowo” / „Cyklicznie” + chipy dni
     tygodnia (weekday daty zawsze zaznaczony i nieodznaczalny) + opcjonalne
     „Do” (until). Zapis ręczny przyciskiem (bez auto-save w v1); walidacyjny
     komunikat inline po polsku; usuwanie w modalu przy `events.manage`.

8. **Chmura** — migracja `20260721210000_events.sql` (konwencja domu, wzorzec
   `20260720230000_tickets.sql`; idempotentnie `if not exists` / `drop policy if
   exists`):

   ```sql
   create table if not exists public.events (
     id uuid primary key default gen_random_uuid(),
     title text not null check (char_length(title) between 1 and 300),
     description text not null default '',
     location text not null default '' check (char_length(location) <= 300),
     meeting_url text not null default '' check (char_length(meeting_url) <= 2048),
     event_date date not null,
     start_minutes integer not null check (start_minutes between 0 and 1425 and start_minutes % 15 = 0),
     duration_minutes integer not null check (duration_minutes between 15 and 1440 and duration_minutes % 15 = 0),
     attendee_ids uuid[] not null default '{}',
     recurrence jsonb,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now(),
     check (start_minutes + duration_minutes <= 1440)
   );
   ```

   + trigger `events_set_updated_at` (`app.set_updated_at()`), index na
   `event_date`, `enable row level security`, `revoke all on public.events from
   anon`, polityki `events_select/insert/update/delete` — WSZYSTKIE `to
   authenticated`, `using (true)` / insert-update z `with check (true)`.
   UZASADNIENIE (zamknięte): kalendarz spotkań jest ogólnofirmowy, a lokalna
   rola `handlowiec` mapuje się w chmurze na `worker`
   (`referenceData.ts` l. 81–104), więc bramka po `app.is_manager()` odcięłaby
   handlowca; bramka `events.manage` pozostaje UX-em (jak cały system uprawnień
   client-side). ŚWIADOMIE bez tabeli `event_attendees` — `attendee_ids uuid[]`
   nie steruje RLS-em, bez FK (czyszczenie po stronie klienta przy hydracji).
   Na końcu pliku: idempotentne `alter publication supabase_realtime add table
   public.events` w bloku `do $$ … exception when duplicate_object …` (wzorzec
   `20260718091000`) — kalendarze odświeżają się live. Rejestr:
   `migrations.test.ts` — plik w liście (po `20260721170000`) + `'public.events':
   ['select','insert','update','delete']` w `EXPECTED_POLICIES`. Migracji NIE
   aplikować na zdalną bazę w tym runie.

9. **Mirror + hydracja** (dziesiąta rodzina, wzorzec ticketów):
   - `cloudMirror.eventRow`: `id` musi być UUID; `attendee_ids` mapowane per-id
     jak w `draftHoursRow` (l. 278–292) — wpis niemapowalny ODPADA (bez zerowania
     wiersza); kolumny snake_case (`event_date`, `start_minutes`,
     `duration_minutes`, `meeting_url`, `recurrence: e.recurrence ?? null`);
     diff po id → upsert/remove na tabeli `'events'`, label
     `Wydarzenie „<tytuł>”` (blok wzorcowy l. 604–615).
   - `plannerData.loadPlannerSnapshot`: select `('events', 'id, title,
     description, location, meeting_url, event_date, start_minutes,
     duration_minutes, attendee_ids, recurrence, created_at, updated_at')`,
     błąd ⇒ `PLANNER_SNAPSHOT_ERROR` jak inne rodziny; mapowanie: `personOf` na
     attendees, `meetingUrl` przez `normalizeProjectDocumentUrl` (zły ⇒ ''),
     `recurrence` przez `normalizeRecurrence(row.recurrence, date)` + wymuszenie
     formy kanonicznej z decyzji 2; `CloudMergePayload.events?: CalendarEvent[]`
     (OPCJONALNE — brak pola ⇒ reduktor nie rusza kolekcji).
   - `mergeCloudEntities`: `events` opcjonalne; fail-closed strukturalnie
     (tablica, `isObjWithId`, poprawna data, czasy na siatce jak dla workload
     l. 2657–2672); attendee wskazujący osobę spoza finalnego zespołu jest
     FILTROWANY per-wiersz (NIE fail-close — kolumna-tablica nie ma FK, stary id
     nie może blokować całej hydracji; filtr deterministyczny ⇒ merge zostaje
     idempotentny i reference-preserving); podmiana przez `reconcileRows`.

10. **Repair wczytania** (`repairEvents`, idempotentny po wartości): wiersz bez
    stringowego `id`, z pustym `title` po trim albo z niepoprawną `date` jest
    ODRZUCANY; stringi koercjonowane (`str()`), `meetingUrl` przez
    `normalizeProjectDocumentUrl` (zły ⇒ ''); `startMinutes` nie-finite ⇒ wiersz
    ODPADA, poza siatką ⇒ snap w dół do wielokrotności 15 i clamp do [0, 1425];
    `durationMinutes` analogicznie z clampem do [15, 1440 − startMinutes];
    `attendeeIds` ⇒ tylko stringi, dedupe (dangling id ZOSTAJE — czyści go
    dopiero hydracja chmury / filtr renderu); `recurrence` przez
    `normalizeRecurrence` + forma kanoniczna (decyzja 2; rozjazd czasów ⇒
    przepisanie, brak weekday kotwicy ⇒ usunięcie klucza). Zapis legacy bez
    `events` wychodzi z `[]` bez echo-write.

11. **Poza dataImport**: `dataImport.ts` nie obsługuje ticketów i NIE obsługuje
    wydarzeń (parytet) — nie ruszać.

## Scope

1. Model + reduktor + walidacja + selektor (decyzje 1–3; `calendarEventsForDate`).
2. Storage: literały `AppData` (TypeScript strict wskaże wszystkie), `coerceArray`,
   `repairEvents`, brak bumpa wersji (decyzja 10).
3. Uprawnienia `events.manage` (decyzja 4).
4. WeekView slot menu + `EventBlock`, MonthView znacznik, tokeny CSS (decyzje 5–6).
5. Panel `/wydarzenia` + `EventModal` + NAV + ikona + dirty scope (decyzja 7).
6. Migracja SQL + `migrations.test.ts` + mirror + hydracja (decyzje 8–9).
7. Testy (lista niżej) i aktualizacja czterech stron wiki (sekcje analogiczne do
   wpisów „ZGŁOSZENIA”/„CYKLICZNOŚĆ ZADAŃ” w state-and-persistence.md; w
   cloud-database.md tabela `events` + polityki + publikacja; w
   scheduling-and-calendar.md akapit o `.week-event-block` jako czysto
   prezentacyjnym; w ui-navigation-and-onboarding.md route/modal/scope).

## Out of scope

- Edycja pojedynczych wystąpień wydarzeń (menu jak `recurMenu`) — v2.
- Powiadomienia, zaproszenia, sync z zewnętrznymi kalendarzami, załączniki.
- Zmiany w `packDayBlocks`, drag/pointer, hit-test, `WorkloadEntry`, sumach godzin.
- `dataImport.ts`, onboarding/tours, auto-save w EventModal, aplikowanie migracji
  na zdalną bazę, zmiany w `persistGate`/retirement.

## Acceptance

- [ ] Prawy klik w pustą kolumnę WeekView pokazuje „+ Dodaj zadanie (HH:mm)”
      (przy `tasks.manage`) ORAZ „+ Dodaj spotkanie (HH:mm)” (przy
      `events.manage`); pozycja otwiera EventModal z prefill datą/godziną/osobą
      z filtra; `pracownik` nie widzi żadnej pozycji, a prawy klik na bloku
      wydarzenia nie otwiera menu slotu.
- [ ] Wydarzenie (jednorazowe i cykliczne wg reguły) renderuje się w WeekView
      jako `.week-event-block` w kolorze `--event-accent`, pozycjonowane po
      `startMinutes`, wysokość ∝ `durationMinutes`, POD realnymi blokami zadań;
      w MonthView jako znacznik `.month-cell-event`; klik otwiera modal; żadne
      sumy/przeciążenia/kolizje się nie zmieniają.
- [ ] `/wydarzenia` w NAV („Wydarzenia”) listuje nadchodzące/minione wydarzenia;
      `?wydarzenie=new|<id>` tworzy/edytuje; wymagane pola oznaczone „ *”;
      wszystkie stringi po polsku; link do spotkania renderuje się jako `href`
      tylko dla http(s).
- [ ] Reduktor: każdy niepoprawny draft/id zwraca tę samą referencję stanu;
      poprawny zapis trzyma formę kanoniczną (czasy reguły == czasy wydarzenia,
      weekday kotwicy w `daysOfWeek`, dedupe attendees, URL znormalizowany).
- [ ] Storage: legacy payload bez `events` ładuje się z `[]` bez echo-write;
      `repairEvents` idempotentny; `DATA_VERSION` == 7.
- [ ] Chmura: `mergeCloudEntities` bez pola `events` nie rusza kolekcji; zły
      ładunek fail-closed (ta sama referencja); no-op merge zwraca oryginalną
      referencję; mirror emituje upsert/remove dla `events`; migracja przechodzi
      `migrations.test.ts` (lista + polityki + anon revoke).
- [ ] Cztery strony wiki zaktualizowane (albo raport dlaczego nie).

## Tests (vitest — wzorowane na istniejących)

- `new: src/store/eventActions.test.ts` — ADD/SAVE/DELETE: sukcesy + wszystkie
  gałęzie odrzuceń z decyzji 3 (wzorzec `ticketActions.test.ts` /
  `recurrenceActions.test.ts`); kanonikalizacja recurrence (wymuszenie czasów,
  odrzucenie bez weekday kotwicy); `calendarEventsForDate` (jednorazowe,
  cykliczne w oknie, filtr osób, wydarzenie bez uczestników widoczne przy
  filtrze, `dayTotal` NIE rośnie).
- `src/store/storage.test.ts` (rozszerzenie) — repairEvents: drop bez id/title/
  daty, snap czasów, dedupe attendees, URL, recurrence; legacy bez `events` ⇒
  `[]` bez writebacku; idempotencja.
- `src/store/cloudMerge.test.ts` (rozszerzenie) — `events` nieobecne ⇒ kolekcja
  nietknięta po referencji; fail-closed na złej dacie/czasach; filtr dangling
  attendee; no-op merge ⇒ oryginalna referencja stanu.
- `src/supabase/cloudMirror.test.ts` (rozszerzenie) — `eventRow` mapowanie
  attendees→profile ids (niemapowalny odpada), diff upsert/remove.
- `src/supabase/plannerData.test.ts` (rozszerzenie) — select kolumn, mapowanie
  wiersza (data/minuty/attendees/recurrence/meeting_url), błąd selecta ⇒ fail.
- `src/supabase/migrations.test.ts` — nowy plik w liście + `public.events` w
  `EXPECTED_POLICIES` (testy konwencji przejdą same, jeśli SQL trzyma wzorzec).

## Verification

- Worker: `npx vitest run src/store/eventActions.test.ts src/store/storage.test.ts src/store/cloudMerge.test.ts src/supabase/cloudMirror.test.ts src/supabase/plannerData.test.ts src/supabase/migrations.test.ts`
  potem pełne `npm test` i `npm run build`.
- Browser: none — ścieżki pointer/drag nietknięte (zmiany w WeekView są
  addytywne i prezentacyjne; parytet z paczką recurrence-ui, która swoje checki
  już przeszła). Jeśli worker MUSI dotknąć czegokolwiek w lifecycle wskaźnika —
  STOP i raport zamiast zmiany.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.
