# Handoff: Dodaj wydarzenia urlopowe (kind 'urlop') z twardą blokadą planowania

- Package ID: PKG-20260803-wydarzenia-urlopowe
- Status: ready
- Tier: developer (testy nierozdzielne od implementacji — jeden wykonawca)
- Depends on: none
- Risk: medium (dotyka selektorów kolizji i ścieżek reduktora planowania; zero zmian w cyklu życia wskaźnika)
- Codex review: required — zmiana progów kolizji i reduktora planowania

## Goal

Nowy rodzaj wydarzenia „urlop" w ISTNIEJĄCYM modelu `CalendarEvent`: zakres dat
od–do, jedna osoba (tylko własny urlop), pełnodniowa zajętość blokująca każde
przypisanie czasu tej osobie, czerwony blok z palmą w kalendarzu w godzinach
pracy z profilu oraz palmowy wskaźnik zamiast wykrzyknika przeciążenia w dni
urlopowe.

## Wiki context

- `openwiki/n2hub/scheduling-and-calendar.md` (kolizja termin↔wydarzenie 2026-07-30)
- `openwiki/n2hub/state-and-persistence.md` (sekcja WYDARZENIA / SPOTKANIA)
- `openwiki/n2hub/cloud-database.md` (tabela `events`, po przepięciu schema-per-app: `n2click.events`)

## Expected touchpoints

Model i walidacja:
- `src/types.ts:448-461` — `CalendarEvent`: dodaj `kind?: 'urlop'` i `endDate?: DateStr`
- `src/store/AppStore.tsx` — `interface EventDraft` (szukaj `interface EventDraft`): dodaj `kind?: 'urlop'`, `endDate?: string | null`; `ADD_EVENT` (:4024-4052), `SAVE_EVENT` (:4053-4083) — przenieś nowe pola do encji; próg kolizji urlopu (patrz Prior decisions D4)
- `src/store/commandValidation.ts:314-370` — `normalizeEventDraft`: gałąź urlopu (D2/D3)
- `src/store/storage.ts:1167-1222` — `repairEvents`: kanonikalizacja urlopu (D3)

Selektory / kolizje:
- `src/store/selectors.ts:563-605` — `calendarEventsForDateCache`: wielodniowe rozwinięcie urlopu (D5); NOWY selektor `personVacationOnDate(state, personId, date): CalendarEvent | null` (obok, ten sam plik)
- `src/store/selectors.ts:645-661` — `ScheduleConflictKind` + `ScheduleConflict`: dodaj `'urlop'`
- `src/store/selectors.ts:675-743` — `scheduleConflictsForRange`: wydarzenie `kind==='urlop'` pushuje `kind: 'urlop'`
- `src/store/selectors.ts:769-792` — `eventDraftConflicts`: draft urlopu ⇒ WYŁĄCZNIE `warning`, liczone dla KAŻDEGO dnia zakresu (D4)
- `src/store/selectors.ts:803-817` — `blockCollidesWithEvent`: bez zmian logiki (urlop wchodzi automatycznie jako wystąpienie 0–1440)
- `src/utils/eventConflictMessage.ts:19-38,73-93` — `ConflictLike.kind` + `KIND_NOUN` o `'urlop'`; `describeOne` dla urlopu BEZ zakresu godzin: „Jan Kowalski ma w tym dniu urlop"; nowy `vacationDraftWarningMessage(conflicts)` dla ostrzeżenia przy zapisie urlopu

Reduktor — twarde blokady (D6):
- `src/store/AppStore.tsx:1753` — `setBlockTime`: BEZ zmian (pełnodniowe wystąpienie łapie `blockCollidesWithEvent`); `SCHEDULE_BIN_PART` idzie przez `setBlockTime` — też bez zmian
- `src/store/AppStore.tsx:1465-1590` — `insertBlock`: przed mutacją `if (personVacationOnDate(state, ref.personId, ref.date)) return state;`
- `src/store/AppStore.tsx:1593-1692` — `reassignEntry`, gałąź datowana (po :1649): odrzuć, gdy `personVacationOnDate(state, toPersonId, date)` — ta sama referencja

WeekView / model tygodnia:
- `src/components/weekViewModel.ts:76-82` — `BusyInterval.kind`: dodaj `'urlop'`
- `src/components/weekViewModel.ts:165-197` — `buildEventBusyByPersonDate`: wystąpienie urlopu pushuje `kind: 'urlop'` (start 0, end 1440)
- `src/components/weekViewModel.ts:205-256` — `buildWeekModel`: `WeekDayModel` zyskuje `vacationNames: string[]` (osoby przeciążone, których dzień kryje urlop — wyłączone z `overloadNames`, D8) oraz rozwiązane okno renderu urlopu per wystąpienie (D7)
- `src/components/weekViewLayout.ts` — NOWY czysty helper `vacationRenderWindow(person): { start: number; end: number }` (D7)
- `src/components/WeekView.tsx:1852-1898` — `EventBlockImpl`: gałąź urlopu — klasa `week-event-block urlop`, pozycja z okna renderu, ikona `TreePalm`, tytuł „Urlop", tooltip/aria „Urlop: <imię> …"
- `src/components/WeekView.tsx:620,779,1488` — konsumenci `eventBusyByPersonDate` czytający `kind === 'event'`: rozszerz na `'event' || 'urlop'` (bramka upuszczania + pseudo-sąsiad klawiatury; pseudo-sąsiad urlopu nazywa się „Urlop")
- `src/components/WeekView.tsx:2563-2567` — menu „Zaplanuj część": osobny komunikat „⚠ Ta osoba ma w tym dniu urlop."
- `src/components/WeekView.tsx:2710-2712,2757-2760` — nagłówek dnia: obok `⚠ {overloadNames}` renderuj `TreePalm + {vacationNames}` (tooltip „Urlop: …")
- `src/components/MonthView.tsx:116,170-179,234` — dzień z urlopem: znacznik palmy zamiast/obok 📅 (treść wchodzi do `monthCellName`, znacznik `aria-hidden` — wzorzec 🎂/⟳)
- `src/styles.css:2561` — nowe reguły `.week-event-block.urlop` (czerwony akcent, D7) + `.workload-vacation-flag`

Wskaźnik palmy zamiast wykrzyknika (D8):
- `src/pages/WorkloadPage.tsx:450-480` — flaga przy nazwisku: podziel `overloadedDays` na urlopowe/nieurlopowe (`personVacationOnDate`); nieurlopowe → istniejący `AlertTriangle`, urlopowe → NOWA `.workload-vacation-flag` z `TreePalm` i `aria-label` „Urlop: <dni>"
- `src/pages/WorkloadPage.tsx:482-524` — komórka: `{over && ' ⚠'}` → palma, gdy dzień kryje urlop tej osoby (wykrzyknik w pozostałe dni bez zmian)
- `src/pages/WorkloadPage.tsx:87,119` — bramka `fits` przy przenoszeniu: dołóż `personVacationOnDate === null`; niedostępna osoba dostaje polski powód („Ta osoba ma w tym dniu urlop.")
- `src/pages/PersonProfilePage.tsx:598-618` — pasek tygodnia: `{over && ' ⚠'}` → palma w dzień urlopu

EventModal / wejścia (D9):
- `src/components/EventModal.tsx` — cały plik: parametr `wydarzenieRodzaj=urlop` w `useOpenEvent().openNewEvent`; tryb urlopu w edytorze (pola: Od/Do + Opis; ukryte tytuł/godziny/uczestnicy/link/lokalizacja/cykliczność; tytuł stały „Urlop"; uczestnik = `state.currentUserId`, pokazany jako nieedytowalny wiersz „Osoba: <imię> (Ty)"); reguła pola `endDate` (poprawna data, `>= date`, zakres ≤ 92 dni); żywa linia ostrzeżenia z `vacationDraftWarningMessage`; bramka edycji: `canManageEvents || (urlop && attendee === currentUserId)` (D10)
- `src/pages/EventsPage.tsx:53-141` — przycisk „Dodaj urlop" dla KAŻDEGO zalogowanego (obok „Dodaj wydarzenie" za `events.manage`); wiersz urlopu: zakres dat + „Cały dzień" zamiast `0:00–24:00`, ikona palmy
- `src/store/permissions.ts` — MATRIX: nowy klucz `events.vacationSelf: true` dla OBU ról (`pelne`, `ograniczone`)
- `src/components/icons` — re-eksport `TreePalm` wg istniejącego wzorca (lucide-react 1.23 eksportuje `TreePalm`; `Palmtree` to przestarzały alias — użyj `TreePalm`)

Chmura (D11):
- `new: supabase/migrations/20260803120000_events_vacation.sql` — patrz treść niżej; NIE aplikować do żadnej bazy
- `src/supabase/cloudMirror.ts:346-379` — `eventRow`: `kind: e.kind ?? 'meeting'`, `end_date: e.endDate ?? null`
- `src/supabase/plannerData.ts:369-370,676-726` — select + hydracja `kind`/`end_date` (zła wartość ⇒ spotkanie / brak klucza, NIGDY fail-close całego payloadu — parytet z `intervalWeeks`); kanonikalizacja urlopu jak w `repairEvents`
- `src/store/cloudMerge.ts` — walidacja wiersza wydarzenia w `mergeCloudEntities`: opcjonalne `kind`/`endDate` przechodzą, strukturalnie złe pole ⇒ zachowanie jak dotąd dla złego wiersza
- `src/store/migrations.test.ts` — dopisz plik migracji do rejestru (EXPECTED_POLICIES bez zmian)

Testy (lista w Acceptance):
- `src/store/eventActions.test.ts`, `src/store/blockActions.test.ts`,
  `src/store/selectors.test.ts`, `src/components/weekViewModel.test.ts`,
  `src/components/weekViewLayout.test.ts`, `src/utils/eventConflictMessage.test.ts`,
  `src/store/storage.test.ts`, `src/store/cloudMerge.test.ts`,
  `src/supabase/cloudMirror.test.ts`, `src/supabase/plannerData.test.ts`,
  `src/store/migrations.test.ts`

## Invariants

- Inwariant 1: urlop NIGDY nie tworzy `WorkloadEntry` ani nie zasila sum /
  `dayTotal` / przeciążenia / `packDayBlocks` — wchodzi wyłącznie do kolizji,
  dokładnie jak spotkania od 2026-07-30.
- Inwariant 3: przeciążenie dalej tylko ostrzega; ŚWIADOME edycje alokacji w
  TaskModal / `SAVE_TASK` pozostają NIEBLOKOWANE także w dni urlopowe (patrz
  Out of scope). Kolizja blokuje drag/resize/klawiaturę/auto-umiejscowienie.
- Inwariant 6: każdy odrzucony ładunek (`ADD_EVENT`/`SAVE_EVENT`/`SET_BLOCK_TIME`/
  `INSERT_BLOCK`/`REASSIGN_ENTRY`/`SCHEDULE_BIN_PART`) zwraca TĘ SAMĄ referencję.
- Inwariant 7: ZERO zmian w handlerach wskaźnika, bramce dotyku, czyszczeniu
  drag i trafianiu w wyrenderowaną kolumnę; blok urlopu jest prezentacyjny jak
  `.week-event-block` (klik/klawiatura otwiera modal, brak drag).
- Reference-preserving merge: legacy wydarzenie bez `kind` przechodzi repair
  BEZ zmiany wartości (brak echo-write); `DATA_VERSION` zostaje 7.
- Dotychczasowe zachowanie SPOTKAŃ (progi imienny/ogólnofirmowy, komunikaty,
  ripple-insert i reassign wobec spotkań) bajtowo bez zmian.
- Retirement mode wyłączony; żadnych zmian w `persistGate`.

## Scope

1. Model: `CalendarEvent.kind?: 'urlop'` + `CalendarEvent.endDate?` z formą
   kanoniczną (D2/D3) na TRZECH granicach (reduktor, `repairEvents`, hydracja).
2. Rozwinięcie wielodniowe urlopu w `calendarEventsForDate` (D5) — stąd
   automatycznie: pełnodniowa kolizja w `blockCollidesWithEvent`,
   `scheduleConflictsForRange`, `eventBusyByPersonDate`, straż scalania.
3. Twarde blokady: `insertBlock` i `reassignEntry` przez `personVacationOnDate`;
   bramka UI WorkloadPage; komunikaty polskie (D6).
4. Render: czerwony blok `TreePalm` w oknie godzin pracy z profilu z fallbackiem
   9:00–17:00 (D7); znacznik MonthView; wiersz EventsPage.
5. Wskaźnik palmy zamiast wykrzyknika na CZTERECH powierzchniach (D8).
6. EventModal w trybie urlopu + wejście „Dodaj urlop" dla każdego (D9/D10).
7. Chmura: kolumny `kind`/`end_date` (JEDNA addytywna migracja, nieaplikowana),
   mirror + hydracja + rejestr migracji (D11).
8. Testy jednostkowe z listy Acceptance; focused vitest + build.

## Out of scope

- `SAVE_TASK` / AllocationGrid / AllocationDayList: świadome edycje alokacji NIE
  są blokowane urlopem (inwariant 3); istniejące bloki zaplanowane przed urlopem
  ZOSTAJĄ i renderują się obok (sygnalizuje je ostrzeżenie przy zapisie urlopu
  i wskaźniki).
- `MOVE_TASK` (przesunięcie całego zadania o N dni) nie sprawdza urlopów.
- Menu slotu (prawy klik w kalendarzu) NIE dostaje pozycji „Dodaj urlop" —
  wejście jest na EventsPage; bramka `openSlotMenu` bez zmian.
- Zero zmian Dashboard/TimelinePage/AllocationGrid w zakresie wykrzykników.
- Żadnych wpisów dziennika aktywności dla wydarzeń (parytet z dzisiejszym stanem).
- Cykliczny urlop, urlopy zespołowe, akceptacja urlopów, limity dni — nie teraz.
- Migracja NIE jest aplikowana do żadnej bazy (tylko plik; aplikacja to krok
  operatora przed wdrożeniem klienta — jak 20260803100000).

## Prior decisions (WSZYSTKIE rozstrzygnięte — nie renegocjować w pakiecie)

- D1 — dyskryminator: `kind?: 'urlop'` na `CalendarEvent`; BRAK klucza = spotkanie
  (nigdy nie zapisujemy `kind: 'meeting'` w encji lokalnej — kanoniczny minimalizm,
  zgodny z `sameRowValue`). W chmurze kolumna `kind` z defaultem `'meeting'`.
- D2 — czasy urlopu: encja przechowuje `startMinutes: 0`,
  `durationMinutes: 1440` (kanonicznie WYMUSZONE, `normalizeEventDraft` koercjonuje).
  Dzięki temu KOLIZJA jest pełnodniowa bez żadnej zmiany w interwałowych
  ścieżkach, a mieszczą się w CHECK-ach DB (0..1425, 15..1440). RENDER ignoruje
  te czasy i używa okna godzin pracy (D7).
- D3 — forma kanoniczna urlopu (trzy granice): klucz `endDate` obecny TYLKO gdy
  `kind==='urlop'` i `endDate > date` (urlop jednodniowy = brak klucza); zakres
  `date..endDate` ≤ 92 dni (stała `MAX_VACATION_DAYS = 92`, lustro limitu okresu
  zadania); `recurrence` ZABRONIONE (draft z cyklicznością ⇒ `null`/odrzut w
  normalize; repair i hydracja ZDEJMUJĄ klucz); dokładnie 1 istniejący uczestnik
  w normalize (repair NIE wyrzuca wiersza za złą liczbę uczestników — łagodna
  degradacja jak dangling attendee); `meetingUrl`/`location` puste w drafcie
  urlopu (modal ich nie zbiera). Spotkanie z kluczem `endDate`/`kind` ⇒ odrzut
  draftu; repair/hydracja zdejmują.
- D4 — próg kolizji przy ZAPISIE urlopu: konflikt z istniejącymi
  blokami/spotkaniami w CAŁYM zakresie dat to `warning`, nigdy `blocking`
  (jak ogólnofirmowe). Uzasadnienie: urlop nad tygodniem z istniejącym planem
  musi być zapisywalny — najpierw rejestrujesz urlop, potem przeplanowujesz;
  twarda blokada po wszystkich dniach czyniłaby dłuższy urlop niewstawialnym.
  `eventDraftConflicts` dostaje rozszerzony draft (`kind`, `endDate`) i dla
  urlopu iteruje po dniach zakresu (cap 92 gwarantuje ograniczenie). Kierunek
  ODWROTNY zostaje twardy: spotkanie z imiennym uczestnikiem w dzień jego
  urlopu ⇒ `blocking` (wychodzi samo z pełnodniowego wystąpienia).
- D5 — rozwinięcie: w `calendarEventsForDateCache` wydarzenie `kind==='urlop'`
  pasuje, gdy `event.date <= date <= (event.endDate ?? event.date)` (porównanie
  stringów yyyy-MM-dd); wystąpienie niesie zapisane czasy 0/1440. Urlop dotyczy
  także dni wolnych osoby (bez filtrowania po `workDays` — pokazujemy każdy
  dzień zakresu).
- D6 — mapa blokad: `SET_BLOCK_TIME` + `SCHEDULE_BIN_PART` + klawiatura +
  „Zaplanuj część" dziedziczą z `blockCollidesWithEvent` (zero zmian);
  `INSERT_BLOCK` i `REASSIGN_ENTRY` (gałąź datowana) dostają JAWNĄ straż
  `personVacationOnDate` — TYLKO urlop, żeby nie zmieniać dzisiejszego
  zachowania tych ścieżek wobec zwykłych spotkań.
- D7 — okno renderu: `vacationRenderWindow(person)` = `workStartMinutes`/
  `workEndMinutes`, gdy oba skończone i `0 <= start < end <= 1440`; inaczej
  fallback 540–1020 (9:00–17:00, spójny z `WORK_START_HOUR`/`WORK_END_HOUR`
  w `weekViewLayout.ts`). Kolor: czerwony akcent zdefiniowany jako zmienna
  `--vacation-accent` przy `.week-event-block.urlop` (odcień z istniejącej
  palety czerwieni styles.css, np. ton `.danger`); wypełnienie tintowane,
  lewa belka + obwódka czerwona, ikona `TreePalm` przed tytułem „Urlop".
  Zakresy godzin w nowych tekstach ŁĄCZNIKIEM (nigdy półpauzą).
- D8 — palma zamiast wykrzyknika, semantyka ZASTĄPIENIA: tam gdzie dziś
  renderuje się wykrzyknik przeciążenia dla (osoba, dzień), a dzień kryje urlop
  tej osoby, renderuje się mała palma. Cztery powierzchnie: komórka
  WorkloadPage, flaga `.workload-over-flag` (podział listy dni), pasek tygodnia
  PersonProfilePage, nagłówek dnia WeekView (`vacationNames` obok
  `overloadNames`). Wykrzyknik w pozostałe dni/miejsca bajtowo bez zmian; dni
  urlopowe bez przeciążenia nie dostają nowego wskaźnika (kalendarz i tak
  pokazuje blok). Logika podziału siedzi w czystych helperach
  (selectors/weekViewModel), żeby była testowalna bez DOM.
- D9 — wejście i uprawnienia: nowy klucz `events.vacationSelf` w MATRIX dla obu
  ról; „Dodaj urlop" na EventsPage widoczny za tym kluczem (czyli dla każdego);
  `events.manage` dalej rządzi spotkaniami. Self-only jest bramką UX (modal
  wymusza uczestnika = `currentUserId`); reduktor egzekwuje STRUKTURĘ (dokładnie
  1 znany uczestnik), nie tożsamość — parytet z zasadą „reduktor uprawnień nie
  sprawdza" i brak konfliktu z hydracją cudzych urlopów z chmury.
- D10 — edycja/usuwanie istniejącego urlopu: właściciel (jedyny uczestnik ==
  `currentUserId`) LUB rola z `events.manage`. Pozostali widzą tryb read-only.
- D11 — chmura: kolumny na `n2click.events` (tabele przeniesione 20260731081831).
  Hydracja jest łagodna per-pole: nieznany `kind` ⇒ spotkanie; złe `end_date` ⇒
  brak klucza; NIGDY fail-close payloadu (wymóg hydracji jak przy
  `intervalWeeks`). Mirror pisze `kind`/`end_date` zawsze (default 'meeting').
- D12 — powiadomień, dziennika aktywności i realtime NIE ruszamy: tabela
  `events` już jest w publikacji realtime, więc live-sync działa bez zmian.

## Treść migracji (plik `supabase/migrations/20260803120000_events_vacation.sql`)

```sql
-- =============================================================================
-- Migracja: 20260803120000_events_vacation
--
-- Wydarzenia urlopowe: dyskryminator kind ('meeting' | 'urlop') i data konca
-- zakresu end_date na n2click.events (tabele przepiete ze schematu public
-- migracja 20260731081831_move_n2click_tables). Urlop jest przechowywany jako
-- wydarzenie pelnodniowe (start_minutes 0, duration_minutes 1440 — mieszcza sie
-- w istniejacych CHECK-ach), end_date niesie koniec zakresu (NULL = jeden dzien).
-- Zero zmian RLS (polityki events_* zostaja using(true)/with check(true)).
-- Konwencja: tylko-do-przodu, idempotentna. TYLKO plik — aplikacja to krok
-- operatora PRZED wdrozeniem klienta (select hydracji nazywa kolumny wprost).
-- =============================================================================

alter table n2click.events
  add column if not exists kind text not null default 'meeting';

alter table n2click.events
  add column if not exists end_date date;

do $$ begin
  alter table n2click.events
    add constraint events_kind_check check (kind in ('meeting', 'urlop'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table n2click.events
    add constraint events_end_date_check
    check (end_date is null or end_date >= event_date);
exception when duplicate_object then null; end $$;
```

## Acceptance

- [ ] `ADD_EVENT` urlopu (self, od–do) zapisuje kanonicznie: `kind:'urlop'`,
      czasy 0/1440, `endDate` tylko gdy > `date`; draft z cyklicznością, złym
      `endDate` (przed `date`, >92 dni, śmieć) albo liczbą uczestników ≠ 1
      zwraca TĘ SAMĄ referencję.
- [ ] Urlop wielodniowy: `calendarEventsForDate` zwraca wystąpienie dla KAŻDEGO
      dnia zakresu włącznie i dla żadnego poza nim.
- [ ] Blokada przypisań: `SET_BLOCK_TIME` w dzień urlopu (także środkowy dzień
      zakresu i godzina POZA oknem pracy, np. 18:00) ⇒ ta sama referencja;
      `INSERT_BLOCK` i `REASSIGN_ENTRY` na osobę z urlopem ⇒ ta sama
      referencja; `SCHEDULE_BIN_PART` ⇒ odrzut; spotkanie z imiennym
      uczestnikiem w jego dzień urlopu ⇒ `blocking`.
- [ ] Zapis urlopu nad istniejącym blokiem w zakresie PRZECHODZI i zwraca
      `warning` (nigdy `blocking`); EventModal pokazuje polską linię ostrzeżenia.
- [ ] `eventBusyByPersonDate` niesie interwał `kind:'urlop'` 0–1440; bramka
      upuszczania czyta `'event' | 'urlop'`; straż scalania bez zmian.
- [ ] Okno renderu: godziny z profilu (`workStartMinutes/workEndMinutes`), a
      przy zdegenerowanym oknie (start >= end, wartości nieskończone) fallback
      540–1020 — test jednostkowy `vacationRenderWindow`.
- [ ] Wskaźnik: helper podziału dni przeciążonych na urlopowe/nieurlopowe ma
      testy (palma zastępuje wykrzyknik TYLKO w dni urlopowe; pozostałe dni
      niezmienione); `WeekDayModel.vacationNames` testowane w weekViewModel.
- [ ] Komunikaty: `describeOne`/nowa wiadomość urlopowa bez zakresu godzin,
      z łącznikiem w ewentualnych zakresach; „Zaplanuj część" pokazuje
      „⚠ Ta osoba ma w tym dniu urlop.".
- [ ] `repairEvents`: wymusza czasy 0/1440 i zdejmuje `recurrence`/złe `endDate`
      dla urlopu; legacy spotkanie bez `kind` przechodzi bez echo-write.
- [ ] Chmura: `eventRow` mapuje `kind`/`end_date`; hydracja czyta łagodnie
      (nieznany kind ⇒ spotkanie); `mergeCloudEntities` przyjmuje opcjonalne
      pola; rejestr migracji w `migrations.test.ts` zawiera nowy plik;
      migracja NIE zaaplikowana.
- [ ] Wszystkie nowe stringi widoczne dla użytkownika po polsku; ikona
      `TreePalm` przez `src/components/icons`.
- [ ] Zero zmian w handlerach wskaźnika/drag i w zachowaniu spotkań.

## Verification

- Worker: `npx vitest run src/store/eventActions.test.ts src/store/blockActions.test.ts src/store/selectors.test.ts src/components/weekViewModel.test.ts src/components/weekViewLayout.test.ts src/utils/eventConflictMessage.test.ts src/store/storage.test.ts src/store/cloudMerge.test.ts src/supabase src/store/migrations.test.ts`
  a następnie pełne `npm test` i `npm run build`.
- Browser: none — blok urlopu jest prezentacyjny bez ścieżek pointer/drag
  (inwariant 7 nienaruszony), a bramki blokad są reduktorowe i pokryte
  jednostkowo; playwright w tym środowisku i tak bywa niezainstalowany.
- Scheduler owns final `npm test && npm run build` (brak skryptu `test:scheduler`).

## External reference patterns

- Nie dotyczy współdzielonych prymitywów UI (żaden nowy dialog/popover/select —
  reużywamy EventModal, Tooltip, OverlayLayer). Model „urlop jako wydarzenie
  pełnodniowe z zakresem dat" odwzorowuje wzorzec all-day/date-range z
  Google Calendar API (`start.date`/`end.date` dla all-day) i RFC 5545 VEVENT
  z DTSTART/DTEND typu DATE — przyjęty: zakres dat bez czasu dnia; odrzucony:
  osobna encja „absence" (duplikowałaby mechanizm kolizji wbrew wymaganiu).
