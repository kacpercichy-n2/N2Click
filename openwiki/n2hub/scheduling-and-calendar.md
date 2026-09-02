# Scheduling and calendar

## Boundaries

- `src/components/WeekView.tsx` owns timed-grid interaction and bin-card UI, w
  DWÓCH trybach renderowania za jednym propem `mode` (`'week'` domyślnie,
  `'day'` na telefonie ≤760 px). Różnicę niesie WYŁĄCZNIE długość tablicy
  `days` — stała `DAY_COLS` zniknęła na rzecz `days.length`. Tryb dnia dokłada
  tylko warstwę prezentacji: pasek 7 dat i pigułkę „Dzisiaj” (czysty
  `dayStrip.ts`), kaskadę nakładających się kart zamiast wąskich kolumn (czysty
  `dayStack.ts`, prop `stack`; `undefined` = dotychczasowa arytmetyka kolumn co
  do bajta) oraz zasobnik jako arkusz od dołu (`binRef` ZOSTAJE na
  `.week-bin-pane`; stany `closed`/`peek`/`open` różnią się WYSOKOŚCIĄ, nigdy
  `translateY`). Sygnał „trwa przeciąganie” dla auto-peeku płynie z ISTNIEJĄCEGO
  efektu `[dragging]` (`onDragActiveChange` obok `setLiveSyncHold`) i wychodzi
  natychmiast poza trybem dnia — żaden handler wskaźnika się nie zmienia
  (inwariant 7).
- `src/components/DayTrackerView.tsx` + `TimeTrackerBar.tsx` (2026-08-19) own
  widok „Dzień" kalendarza (desktop, przełącznik Tydzień | Dzień | Miesiąc w
  `CalendarPage`; na telefonie „Dzień" nadal znaczy `WeekView mode="day"`):
  PLAN zalogowanej osoby (datowane bloki + spotkania, przez `dayPlanForPerson`)
  obok WYKONANIA (`timeEntries`) na wspólnej osi godzin. Plan jest tu TYLKO DO
  ODCZYTU — przeciąganie, zasobnik i zmiana bloków zostają w WeekView (żadna
  ścieżka wskaźnika WeekView nie jest dotykana, inwariant 7) — z JEDNYM
  wyjątkiem formularzowym (2026-08-20, decyzja usera): „+ Z zasobnika"
  (przycisk w nagłówku Planu + pusty stan `.tt-plan-empty`) otwiera popover
  `.tt-bin-popover` na wspólnej powłoce (`useOverlay`/`OverlayLayer`) z
  wyborem wiersza zasobnika osoby (bez szkiców i „zrobionych"), startem
  podpowiedzianym `findFreeStart`+pseudo-bloki wydarzeń (wzór „Zaplanuj
  część") i zapisem ISTNIEJĄCĄ akcją `SCHEDULE_BIN_PART` na oglądany dzień
  (reduktor autorytatywny; bramka `blocks.editAny || blocks.editOwn`). Zero
  nowych ścieżek wskaźnika. Po dodaniu na dzień miniony dismiss popoutu
  rozliczenia jest zdejmowany, żeby świeży blok od razu dostał pytanie. Jeden formularz
  (pasek) dla trzech wejść: wpis ręczny od-do z podpowiedziami (combobox inline
  wzorem `mention-autocomplete`), przeciągnięcie/klik po osi wykonania
  (wypełnia godziny w pasku; gest w refie, `setPointerCapture` w try/catch),
  klik w spotkanie (wypełnia tytuł + godziny + `eventId`; spotkanie NIGDY nie
  liczy się samo; drugi klik na zaliczonym kasuje wpis). Kółko na kaflu planu
  = `SET_BLOCK_DONE` (ten sam reduktor, co „✓ Oznacz jako wykonane" w menu
  WeekView): blok wykonany + wpis 1:1 w jego godzinach; cofnięcie kasuje wpis.
  Status zadania zmienia się sam przez `autoCompleteTask` (wszystko wykonane,
  zasobnik pusty, brak wolnych sprzedanych; od 2026-08-24 działa też bez wpisu
  1:1 i dla zadań bez estymaty — ale bez estymaty domyka tylko jawne
  `SET_BLOCK_DONE`, nie sam wpis czasu; serii cyklicznych nie domyka). Przekroczenie sprzedanych godzin
  pyta dialogiem (`useConfirm`) przed zapisem; kolejność przełącznika
  Dzień | Tydzień | Miesiąc. Rozliczenie `SETTLE_TRACKED_DAY` (patrz
  state-and-persistence) NIGDY nie biegnie samo (2026-09-02, decyzja usera:
  dawny automat „15 min po końcu bloku → zasobnik" dla dzisiaj zniknął z
  `CalendarPage` i `DayTrackerView`). DZISIAJ popout `.tt-settle` pojawia
  się dopiero po końcu dnia pracy osoby (`workEndMinutes` + 15 min karencji)
  i wylicza tylko bloki, które już minęły (+15 min); „Oddaj do zasobnika"
  wysyła `{nowMinutes, explicit: true}`. Do końca dnia pracy plan zostaje
  nietknięty, nawet gdy wpisy już są. Dzień MINIONY (2026-08-20, decyzja
  usera — rzeczy ustawiane wstecz nie mogą znikać bez pytania): niewykonane bloki
  (`unsettledPlanBlocks`, timeTracking.ts) czekają w popoucie `.tt-settle` nad
  siatką z trzema wyjściami — „Zalicz jako wykonane" (blok bez pokrycia:
  `SET_BLOCK_DONE`, wpis 1:1 gdzie godziny wolne; blok CZĘŚCIOWO pokryty:
  `ADD_TIME_ENTRY` wyłącznie na resztę w wolnym kawałku godzin bloku —
  `freeRemainderRange`, utils/timeTracking — bo pełny wpis 1:1 zdublowałby
  pokrycie liczone pulą dnia; `resyncBlockDone` domyka blok sam), „Oddaj do
  zasobnika" (jawny dispatch
  `SETTLE_TRACKED_DAY` z `nowMinutes: null, explicit: true`), „Zostaw plan" (dismiss per
  osoba+dzień, stan sesyjny). Popout pokazuje się na KAŻDYM minionym dniu z
  niewykonanym blokiem, także bez wpisów (blok dodany wstecz na pusty dzień) —
  bramka „dzień śledzony" dotyczy w reduktorze wyłącznie automatu z podanym
  `nowMinutes`; jawne `null` rozlicza też dzień bez wpisów.
  Czysta arytmetyka osi i kolumn w `dayTrackerLayout.ts` (oś 7-19 rozszerzana
  do danych, 84 px/h od 2026-09-02 = 21 px na kwadrans jak `HOUR_PX` tygodnia,
  siatka 15 min, kolumny dla nachodzących kafli, `trackerDensityClass` z minut:
  `h-quarter` jedna linia „○ tytuł … godziny", `h-half` tytuł + godziny,
  `h-threeq` + klient/projekt, `h-hour` + pasek postępu bez tekstu, dłuższe
  pełna treść; te same progi dla wpisów wykonania). Klasy CSS z prefiksem
  `tt-`. PANEL BOCZNY (2026-09-02, zgłoszenie „Podsumowanie w widoku dnia"):
  przełączniki Projekty | Zadania (`clientTimeSummary` / `taskTimeSummary`) i
  Dzień | Tydzień (zakres dat), stan sesyjny, domyślnie projekty za tydzień.
  WCIĘCIE PLANU POD FAKT (2026-09-02, zgłoszenie „duży task w planie a
  krótki"): wpis INNEGO zadania w godzinach datowanego bloku tej osoby tnie
  blok na głowę i ogon (`carvePlanAroundEntry` w AppStore, geometria
  `carveSpan` w timeTrackingSync), wycięte minuty wracają do jednego wiersza
  zasobnika pary (inwariant 4), głowa zachowuje id, ogon dostaje nowe, oba
  dziedziczą `done`; wpisy tego samego zadania nie wcinają; jednokierunkowo
  (kasowanie wpisu nie skleja). Biegnie na początku `materializeTracking`
  (ADD/UPDATE_TIME_ENTRY), więc blok wzrostu pary ląduje w wycięciu, nie
  obok. `SET_BLOCK_DONE true` na bloku CZĘŚCIOWO zajętym cudzymi wpisami:
  wcięcie + wpis „z bloku" w KAŻDYM wolnym kawałku (`freeRangesWithin`);
  całość zajęta = blok wykonany bez wpisu jak dotąd; odznaczenie kasuje
  wszystkie wpisy `source 'block'` tego bloku. Zamknięte zadania (status
  `isDone`) PRZYJMUJĄ czas (patrz state-and-persistence). Kafelki tygodnia
  są kontenerem szerokości (`container-type: inline-size`): poniżej 150 px
  znika nazwisko (kropka i czas zostają), poniżej 120 px kwadrans chowa
  godziny, poniżej 96 px monetę; CSS-only, inwariant 7 nietknięty. Widok
  kalendarza (Dzień | Tydzień | Miesiąc) jest ZAPAMIĘTANY w
  `lastFilters.calendar.calendarView` (2026-09-02, zgłoszenie
  „Zapamiętywanie widoku"; sanityzacja w commandValidation do
  `CALENDAR_VIEW_MODES`, brak = Tydzień). Stoper i lustro chmury: do
  zrobienia.
- `src/gcal/` (2026-08-25) owns the GOOGLE CALENDAR layer: `GoogleCalendarProvider`
  trzyma wydarzenia z widoku `google_calendar_events_visible` (okno −30/+90
  dni, odświeżanie co 5 min i po powrocie karty), `gcalData.ts` (pure) mapuje
  wiersze i rozwija wielodniowe na dni. WeekView renderuje `GoogleEventBlock`
  (własny, memo, tylko odczyt: bez przeciągania, bez menu, bez
  `getState().events`, z-index pod `.week-event-block`, poza pakowaniem
  kolumn — inwariant 7 nietknięty) i `GoogleEventDialog`; MonthView dokłada
  znacznik „G" + tytuły w dymku/nazwie komórki. Warstwa NIE wchodzi do
  `calendarEventsForDate`, sum dnia ani kolizji (inwariant 1).
  WŁASNOŚĆ (2026-08-26): wydarzenie Google NALEŻY do właściciela kalendarza
  (`ownerProfileId`). `occurrencesFor(date, filter)` → `visibleOccurrences`
  (pure, `gcalData.ts`): własne (`access === 'owner'`) zawsze, cudze tylko gdy
  filtr osób obejmuje właściciela; pusty filtr = tylko własne (INACZEJ niż
  spotkania N2Hub, gdzie pusty filtr = wszyscy). Bycie zaproszonym nie
  wystarcza. Kafel i dymek Miesiąca niosą imię właściciela. Maska „Zajęty"
  zostaje sprawą widoku bazy; klient decyduje tylko o obecności kafla.
  ID: widok niesie id PROFILI chmury, a osoba dopasowana po e-mailu przy
  hydracji zachowuje lokalne id — provider tłumaczy je przez
  `buildProfileToPersonMap` (po id, potem po e-mailu ze snapshotu
  `useOrgData`) + `resolveEventPeople`, więc `ownerProfileId` /
  `attendeeProfileIds` w widokach to już id OSÓB planera. Nie porównuj
  surowych id profili z filtrem.
- `src/components/weekViewLayout.ts` (pure) owns the PRESENTATIONAL working
  window: `WORK_START_HOUR`/`WORK_END_HOUR` (9–17), the default scroll offset and
  the px bounds fed to CSS as `--week-work-top`/`--week-work-bottom`.
- `src/utils/time.ts` owns pure time calculations, collision checks, packing,
  free-slot search and quarter-hour math.
- `src/utils/eventConflictMessage.ts` (pure, zero importu store'u) owns POLSKIE
  komunikaty kolizji terminu wraz z odmianą przez liczebnik („1 osoba ma",
  „22 osoby mają", „21 osób ma"). Zakresy godzin łącznikiem, nigdy półpauzą.
- `src/utils/touchDrag.ts` (pure state machine) + `src/utils/useTouchDragGate.ts`
  (React wrapper) own the touch long-press gate in FRONT of every drag entry.
- `src/components/calendarBlockKeyboard.ts` (pure state machine + polskie
  komunikaty) owns the KEYBOARD entry into the block-edit model.
- `src/components/monthGrid.ts` (pure) owns MonthView grid navigation math and
  the Polish accessible name of a day cell.
- `src/utils/blockLabel.ts` (pure) owns the ONE sentence describing a work block
  (TaskModal rows + WeekView tile `aria-label`).
- `src/store/AppStore.tsx` applies scheduling mutations atomically.
- `src/pages/WorkloadPage.tsx` owns workload reassignment UI. Treść komórki
  „osoba × dzień” (lista bloków + bilans dnia) NIE jest liczona na stronie —
  daje ją czysty `workloadCellDetail`/`workloadCellBlocks` (selectors.ts,
  nadbudowa nad `blocksForPersonDate` + `dayAvailabilityForPerson`).

## Non-negotiable behavior

- UTAJNIONA TREŚĆ (2026-08-05). Kalendarz ZAWSZE pokazuje, że blok istnieje
  (czas, osoba, godziny) — maskuje się wyłącznie treść: kafelki
  (`TimedBlock`/`BinCard`/`RecurBlock`/`EventBlock`) dostają z rodzica
  PRYMITYW `displayTitle` (z `taskDisplayTitle`/`eventDisplayTitle`,
  `src/store/confidentiality.ts`) zamiast czytać `task.title` — jak `status`/
  `done`, żeby `React.memo` trzymał. Komunikaty liczone w czasie zdarzenia
  (kolizje, ogłoszenia klawiatury, dymek odrzucenia) idą przez
  `eventTimeTaskTitle(getState(), …)`; tytuły pseudo-sąsiadów w
  `weekViewModel.buildEventBusyByPersonDate` też są maskowane. Czyste moduły
  `blockLabel`/`calendarBlockKeyboard`/`monthGrid` pozostają store-free —
  maska wchodzi na ich GRANICY. Urlop (`kind: 'urlop'`) nigdy nie niesie
  `isConfidential` (tytuł i tak jest stałe „Urlop"). Żadna ścieżka wskaźnika
  ani cykl życia przeciągania nie zależy od maski (inwariant 7 nietknięty).

- Obciążenie — DWA ROZDZIELONE SYGNAŁY (2026-07-28, OP-21): pasek `.load-bar`
  koduje WYŁĄCZNIE wykorzystanie tygodnia (`loadTone(pct)`, jedna monotoniczna
  skala `low/mid/high/over` → klasy `.tone-*`), więc 84% nigdy nie wygląda
  spokojniej niż 75%. „Któryś dzień ponad dostępnością” to OSOBNA ikona
  `.workload-over-flag` przy nazwisku (pełna lista dni w `aria-label`);
  dawnego podpisu „⚠ N dni” nie ma — powtarzał czerwoną komórkę. Kliknięcie
  komórki (myszą albo Enter/spacją) otwiera POPOVER `.wr-popover` na wspólnej
  powłoce nakładek (`useOverlay` + `OverlayLayer`: pozycja z flipem, stos
  Escape, zamknięcie kliknięciem poza, powrót fokusa na komórkę; kotwicą jest
  sama komórka, `closeOnAnchorOutOfView`), a nie rozwijany wiersz tabeli.
  Popover niesie zadanie, zakres godzin, długość, dotychczasowe akcje
  (`REASSIGN_ENTRY`, `MOVE_TASK`, otwarcie zadania) i „Otwórz w kalendarzu” =
  istniejący deep-link `calendarDayTarget` + zapamiętany filtr osób kalendarza
  (`SET_LAST_FILTER` view `calendar`), bez nowego parametru trasy. Lista bloków
  jest PEŁNA (filtry klienta/typu usługi zawężają tylko sumy w tabeli), a pusty
  dzień zamyka popover.
- Time uses 15-minute steps; hours use 0.25-hour steps; a block must fit in one
  day. A task period is at most 92 days.
- Same-person collisions block calendar drag/resize and automatic placement.
  Intentional TaskModal allocation edits may overlap and render side-by-side.
  Od 2026-07-30 „kolizja" obejmuje też WYDARZENIE tej osoby — patrz niżej.
- Bin work uses exactly one row per `(taskId, personId)`. `SCHEDULE_BIN_PART`
  keeps that row identity, decrements it atomically and removes it only at zero.
- Sold-hours model (2026-07-17): TaskModal edits per-person TOTAL hours
  (`binTotals` in SAVE_TASK — absolute bin target per person, row identity
  kept, 0 removes the row); `task.estimatedHours` is the SUM of per-person
  hours, and the bin is derived (sold − calendar). Zeroing/shrinking a grid
  cell RETURNS hours to the person's bin (the sold total is the contract);
  growing a cell consumes the bin. Od 2026-08-11 (CAL-01) także `SET_TASK_DATES`
  (resize na Timeline) trzyma ten kontrakt: datowane bloki wypadające z nowego
  okresu NIE znikają — ich godziny są sumowane per osoba i scalane do wiersza
  zasobnika pary (task, person) (istniejący bin absorbuje sumę z zachowaniem
  id; brakujący powstaje z pierwszego usuwanego wpisu osoby). Inwariant 4 bez
  zmian. Dodatkowo `MOVE_TASK`/`SET_TASK_DATES` re-kanonikalizują `recurrence`
  względem nowej kotwicy (CAL-03): move przesuwa `until` o deltę, resize działa
  jak SAVE_TASK — reduktor nigdy nie wypuszcza stanu, który loader odrzuci po
  reloadzie. `MOVE_TASK` odrzuca deltę > 3650 dni (inwariant 6 zamiast
  RangeError z `format(Invalid Date)`). TaskModal auto-saves valid edited drafts
  (debounced ~0.9 s; paused during an explicit tab conflict; creation stays
  manual).
- RSVP PER WYSTĄPIENIE (2026-08-11, jak w Google Meet): wydarzenie CYKLICZNE
  niesie `rsvps?: EventRsvp[]` ({date, personId, status 'yes'|'no'}; BRAK
  wpisu = „oczekuje"; forma kanoniczna w `normalizeEventRsvps` — tylko realne
  dni wystąpień żywej reguły, dedup+sort, pusto = klucz znika, wpis legacy bez
  `status` czyta się jako 'no'; wspólna dla reduktora, `repairEvents` i
  hydracji). `SET_EVENT_RSVP` (yes/no/null=wyczyść; WeekView: prawy klik na
  kaflu wystąpienia → menu z opcjami Potwierdzam/Nie biorę udziału + LISTA
  odpowiedzi tego dnia — imienne: wszyscy uczestnicy, ogólnofirmowe: tylko
  odpowiedzi + licznik oczekujących; decyzja OSOBISTA działającego
  użytkownika, bez bramki `events.manage`; imienne tylko dla uczestnika,
  ogólnofirmowe dla każdego). WYŁĄCZNIE status 'no' ZWALNIA slot osoby
  ('yes'/oczekuje zajmują jak dotąd) w: `blockCollidesWithEvent`,
  `scheduleConflictsForRange`, `mergeCoversEventOrRecurrence`,
  `buildEventBusyByPersonDate` i odejmuje głowę w `calendarDayVolume`
  (helpery: `personRsvpForEventOccurrence` / `personAbsentFromEventOccurrence`);
  render odmowy = kafel-duch (`.week-event-block.absent`). `SAVE_EVENT`
  re-kanonikalizuje odpowiedzi względem nowej reguły (zdjęcie cykliczności =
  klucz znika). Chmura: kolumna `n2click.events.rsvps` (jsonb; 20260811160000
  utworzyła `absences`, 20260811170000 rename na `rsvps`), personId mapowane
  profil↔osoba jak `attendee_ids`.
  żadnego `WorkloadEntry`, więc para (zadanie, osoba) z zerem godzin nie ma ani
  bloku w kalendarzu, ani wiersza w zasobniku i znika z planowania. Dlatego
  świeżo zaznaczona osoba dostaje bazowo `DEFAULT_ASSIGNEE_HOURS`
  (`assigneeHours.ts` = `HOURS_STEP`, 15 min) w polu godzin sprzedanych —
  zarówno przez checkbox, jak i przy osobie podpowiedzianej filtrem kalendarza
  dla NOWEGO zadania. Wartość już wpisana (w tym świadome „0” i godziny
  istniejącego zadania) zostaje nietknięta, a stan „ani sprzedanych, ani
  w kalendarzu” (`assigneeHasNoHours`) zapala WIDOCZNE ostrzeżenie w wierszu
  osoby zamiast cichej pustki. Reduktor bez zmian: `binTotals` nadal usuwa
  wiersz przy celu 0 (to zwykły przypadek „wszystko już w kalendarzu”).
- Bin drag is window-owned: preserve its pointer-up/cancel/blur/Escape/visibility
  cleanup, synchronous refs and rendered-column hit-testing.
- Upuszczenie karty zasobnika kotwiczy się do KURSORA (2026-08-03): start bloku
  to slot pod wskaźnikiem (`dropStartFromAnchor(clientY - gridRect.top, …)`),
  NIE górna krawędź ducha karty. Poprzednia kotwica (fix n2hub-253) lądowała
  blok do ~53 min POWYŻEJ celu (wysokość karty ≈ 75 px w skali 84 px/h), co po
  wejściu spotkań (2026-07-30) i urlopów (2026-08-03) do kolizji kończyło się
  cichym odrzuceniem tuż pod istniejącym blokiem — najczęstszym realnym celem.
  Duch karty nadal trzyma punkt chwytu (czysta prezentacja); prawdą o lądowaniu
  jest pasek `.week-drop-preview`. Scalanie przez styk krawędzi liczy się z tego
  samego startu, więc kursor na krawędzi bloku tej samej pary = merge.
- Touch drag gate (2026-07-27, invariant 7): on `pointerType` touch/pen the four
  drag entries (WeekView `TimedBlock.begin`, `BinCard.begin`, TimelinePage
  `Bar.begin`, `MilestoneMark`) do NOT start a drag on `pointerdown` — they call
  `useTouchDragGate().arm(...)`, which starts a drag only after `TOUCH_HOLD_MS`
  (350 ms) of near-stillness (`TOUCH_HOLD_SLOP_PX` = 10 px); drift past the slop,
  `pointerup` or `pointercancel` aborts and the page scrolls. A late timer must
  never engage after an abort. Mouse is untouched: `arm` returns false without
  registering a timer or listener, so the drag layer runs byte-identically. Each
  `begin` captures its `init` (element/pointerId/client coords) SYNCHRONOUSLY —
  the deferred `startDrag` may not read the React event — and resets
  `moved.current` before the gate so a tap that never engages still opens the
  entity. On engage the gate holds a non-passive `touchmove` preventDefault lock
  for the life of the gesture, because `@media (pointer: coarse)` relaxes
  `.week-block`/`.week-bin-block`/`.timeline-bar`/`.timeline-milestone` to
  `touch-action: pan-x pan-y` (both axes: `.week-days-viewport` scrolls both) and
  `touch-action` cannot be tightened mid-gesture. The SAME engaged-only lock also
  suppresses the browser's own long-press: a capture-phase `contextmenu` listener
  on `document` (`preventDefault` + `stopPropagation`, so React's delegated
  `onContextMenu` never fires on a live drag), plus `user-select`/
  `-webkit-touch-callout: none` on the coarse-pointer selectors. A short press
  that never engages keeps today's context menu. Coarse pointers also hide
  `.week-block-handle` (6 px, untargetable), so touch gets move-only; `.bar-handle`
  is unchanged.
- Working window (2026-07-27) is PRESENTATION ONLY (invariant 1 + 7): the week
  grid opens scrolled to `WORK_START_HOUR` and slots outside 9:00–17:00 get a
  dimming `linear-gradient` LAYER on `.week-day-col` plus faded axis labels.
  No DOM node, no `pointer-events`, no z-index — snapping, collisions, drag and
  data are untouched, and off-window slots stay fully usable. The date+clock
  badge lives OUTSIDE the grid (`NowClockBadge` in the calendar toolbar row,
  `useNowTick` 30 s); the `.week-now-line` in today's column is unchanged.
- Znacznik ✓ ukończenia na kafelku (2026-07-28, inwariant 7; ZMIANA
  2026-08-05; ZMIANA 2026-08-07, decyzja usera): ✓ i klasa `has-done-tick`
  idą z EFEKTYWNEGO wykonania (`blockIsDone` = `entry.done` ∨ done-status
  zadania) — zadanie utworzone od razu ze statusem „Gotowe" jest zielone na
  wszystkich blokach bez ręcznego odhaczania (poprzednia węższa reguła
  „tylko `entry.done`" była świadoma i została odwrócona). Przy done-STATUSIE
  zadania interaktywny przycisk ✓ oraz pozycja menu „Oznacz jako wykonane"
  ZNIKAJĄ (przełącznik nic by nie zmienił — status wygrywa): kafelek nosi
  bierny `.block-done-mark.corner`, a menu podpowiedź `.context-menu-hint`
  (parytet z „już zrobioną serią" cyklicznych). Karta zasobnika analogicznie
  czyta prop `done`. Per-blokowe odhaczanie przy statusach AKTYWNYCH bez
  zmian (decyzja z dzielonych bloków, c1d54ea6). Pozycjonowanie: na blokach
  ≥45 min ✓ stoi w PRAWYM DOLNYM rogu — pion liczy
  `doneTickTopPx` w `weekViewLayout.ts` (`weekViewLayout.test.ts`),
  a `DONE_TICK_BOTTOM_PX = 8` (6 px uchwytu `.week-block-handle.bottom`
  + 2 px luzu) ma swoje lustro w CSS jako `bottom: 8px` — zmiana jednej
  wartości wymaga zmiany drugiej. Wysokość kafelka jest od 2026-08-05
  PROPORCJONALNA do czasu (21 px/kwadrans, bez minimum 50 px); bloki 15/30 min
  noszą klasy gęstości `.h-quarter`/`.h-half` (`blockDensityClass` z
  WYŚWIETLANYCH godzin) i stawiają ✓ PRZY TYTULE (`top + 2`, z pominięciem
  `doneTickTopPx`), a rezerwę miejsca robi tekst przez `padding-right` na
  hoverze/`has-done-tick` — każdy stan w OSOBNEJ regule CSS (lista z `:has`
  unieważniłaby całość). Rezerwa 22 px pod ✓ w wierszu godzin (`.has-done-tick
  .week-block-meta`) jest od 2026-08-10 ZAWĘŻONA do bloków 45 min (klasa
  `.h-threeq`, celowo POZA `density` — density steruje też pozycją ✓): na
  blokach ≥1h ostatni wiersz treści kończy się nad ✓, a bezwarunkowa rezerwa
  psuła wyrównanie „1h" do prawej krawędzi względem kafelków 30 min.
  `DONE_TICK_SIZE_PX = 16` z 3 px marginesu od prawej
  krawędzi. Tytuł elipsuje się w spanie `.week-block-title-text` (goły tekst
  we fleksie nie umie się elipsować). Dolny uchwyt zmiany rozmiaru zostaje
  w całości trafialny, a znaczniki bierne są `pointer-events: none`, więc
  `elementFromPoint` i cykl życia wskaźnika zostają bez zmian.
- Podpowiedzi na powierzchniach przeciągania (2026-07-28, inwariant 7): bloki
  siatki, karty zasobnika, nakładki cykliczne/wydarzeń, plakietki nagłówka oraz
  paski i kamienie milowe osi czasu nie mają już natywnego `title` — otacza je
  `Tooltip` (`tooltipShell.ts`), który KLONUJE ten sam element (zero opakowań,
  zero zmian układu), dokłada WYŁĄCZNIE obserwatorów (nigdy `preventDefault`,
  `stopPropagation` ani przejęcia wskaźnika, zawsze woła istniejący handler) i
  chowa dymek na `pointerdown`, więc podczas przeciągania/rozciągania nic nie
  wisi nad siatką. Karta jest `pointer-events: none` w portalu, więc nie wpływa
  na `elementFromPoint` ani na trafianie w wyrenderowaną kolumnę. Znaczniki
  MonthView i plakietka „Wykonane” niosą informację `aria-label` (dymek komórki
  miesiąca jest czysto wizualny), a powody blokady pozycji menu kontekstowego
  („Podziel…”) są WIDOCZNĄ linijką `.context-menu-hint` + `aria-describedby`,
  nie dymkiem. `browser-check-bin-drag.mjs` czyta podpowiedź karty zasobnika
  przez `aria-describedby`, a nie przez atrybut `title`.
- Automatic placement uses a real free-slot search and rejects when no slot fits;
  it must not clamp into an overlap near midnight.
- Free-slot search rejects non-finite, non-positive, off-grid and over-day
  durations. Keyboard-activatable week blocks and bin cards respond to both
  Enter and Space without changing their pointer lifecycle.
- Klawiatura na bloku siatki (2026-07-28, inwariant 7) jest DODATKOWYM WEJŚCIEM
  do modelu przeciągania, nigdy równoległym uproszczeniem: ↑/↓ przesuwa start
  o 15 min, Shift+↑/↓ zmienia długość, ←/→ przenosi o dzień, Escape cofa CAŁĄ
  wystawioną edycję bez wysyłki, a Enter/spacja ZATWIERDZA ją (bez rozpoczętej
  edycji Enter/spacja nadal otwierają zadanie). Projekcja jest wystawiona jak
  `dragRef` i idzie przez te same granice (`snapToStep`, `clampBlockStart`,
  doba, `hasCollision`, sufit `baseHours + growAllowanceHours`) do TEJ SAMEJ
  akcji `SET_BLOCK_TIME`; kolizja blokuje zapis (inwariant 3). Wyjście fokusa
  zatwierdza (edycja nie ginie po cichu). Decyzyjność siedzi w czystym
  `calendarBlockKeyboard.ts`, a `.week-block` nosi wtedy `kb-editing` obok
  istniejących `colliding`/`at-cap`. Akcja „Przenieś do zasobnika”
  (`MOVE_BLOCK_TO_BIN`) jest RODZEŃSTWEM kafelka (dzieci `role="button"` są
  prezentacyjne), widoczna dopiero przy fokusie i `pointer-events: none` poza
  nim, więc `elementFromPoint`, bramka dotyku i cały cykl życia wskaźnika
  (`begin`/`startDrag`/`projectMove`/`finish`/`cancelDrag`) zostają bez zmian.
  Kafelek niesie pełne zdanie `aria-label` z `blockLabel`, a WeekView ma jeden
  region `sr-only role="status" aria-live="polite"` — kolizja jest ZDANIEM
  („Koliduje z „Montaż filmu” 12:00–13:00”), nie samą czerwoną obwódką.
  Klawiaturowy zapis NIE odpala animacji scalenia (`setFusedId`) — reduktor
  scala tak samo, animacja zostaje przy przeciąganiu.
- MonthView (2026-07-28) jest siatką APG: `role="grid"` na `.month-grid-wrap`,
  wiersz `columnheader` z dniami tygodnia, `.month-grid` jako `rowgroup` i
  wiersze `.month-week-row` (`display: contents` — układ CSS bez zmian).
  Wędrujący `tabindex` trzyma DATĘ (jedna komórka fokusowalna), strzałki chodzą
  po dniach/tygodniach bez zawijania, Home/End po wierszu (z Ctrl po siatce),
  PageUp/PageDown = ±1 miesiąc, z Shiftem ±1 rok — i te dwa ostatnie przestawiają
  kotwicę `CalendarPage` (`onShiftMonth`/`onShiftYear`), która nie dubluje
  matematyki dat. Widoczna etykieta okresu (`.cal-range-label`) jest naraz
  `aria-live` i nazwą siatki. Nazwa komórki („30 lipca, 6 zaplanowanych godzin,
  2 osoby”) pochodzi z `monthCellName`, więc znaczniki 🎂/⟳/📅 są `aria-hidden` —
  ich treść wchodzi do nazwy i nie czyta się dwa razy.
- OBJĘTOŚĆ GODZINOWA DNIA W KALENDARZU (2026-08-07, zgłoszenie 77d10f85,
  decyzja usera): sumy WYŚWIETLANE w nagłówkach dni WeekView (tryb tygodnia
  i dnia) oraz w komórkach MonthView (intensywność, dymek, nazwa dostępna)
  liczy `calendarDayVolume` (selectors.ts) = `dayTotal` + roboczogodziny
  spotkań i wystąpień cyklicznych: spotkanie imienne × uczestnicy (∩ filtr),
  spotkanie OGÓLNOFIRMOWE × osoby w zakresie (rozmiar filtra, bez filtra cały
  zespół), wystąpienie cykliczne × przypisani do zadania (∩ filtr; bez
  przypisanych = 0). URLOP celowo NIE wchodzi (nieobecność to nie praca).
  `WeekDayModel.empty` = `total === 0` (dzień z samym spotkaniem pokazuje
  sumę, nie „—"). To zmiana WYŁĄCZNIE pochodnej sumy prezentacyjnej:
  `dayTotal`, przeciążenie, kolizje, `packDayBlocks` i wszystkie ścieżki
  planowania nadal czytają wyłącznie `WorkloadEntry` (inwariant 1 dla logiki
  planowania nietknięty). Testy: `src/store/calendarDayVolume.test.ts`.
- WSPÓLNE PAKOWANIE WARSTWY DNIA (2026-08-06, decyzja usera): w trybie tygodnia
  bloki, spotkania (bez urlopu) i wystąpienia cykliczne wchodzą RAZEM do JEDNEGO
  wywołania `packDayBlocks` w `buildWeekModel`, więc dwie rzeczy w tym samym
  czasie dzielą kolumnę (kafelki OBOK siebie, ta sama arytmetyka
  `left/width` co `.week-block`) zamiast malować się jedna na drugiej. To
  WYŁĄCZNIE geometria (`col`/`cols` w `ResolvedBlock`/`ResolvedRecurrence` +
  `WeekDayModel.eventLanes`): kolizje, sumy, `dayTotal` i przeciążenie nadal nie
  widzą nakładek (inwariant 1), żadna ścieżka wskaźnika się nie zmienia
  (inwariant 7). URLOP celowo nie wchodzi (pełnoszerokie tło doby), a widok dnia
  (telefon) zostaje kaskadą `dayStack` — nakładki dostają tam `0/1`.
- Recurring-task occurrences are PRESENTATIONAL ONLY (invariant 1): WeekView
  renders them as additive `.week-recur-block` overlays (dashed/striped, ⟳),
  positioned by time and painted BEHIND real blocks; they never enter
  collisions or overload (into `packDayBlocks` they enter ONLY as layout
  geometry — see „wspólne pakowanie" above; do WYŚWIETLANEJ sumy dnia wchodzą
  przez `calendarDayVolume` — patrz „objętość godzinowa" above) and carry NO pointer/drag
  handlers — only click/keyboard opens the task and right-click opens the
  `recurMenu`. Menu actions map only to reducer actions: „Pomiń ten
  dzień"/„Edytuj to wystąpienie" → `SET_RECURRENCE_OVERRIDE`, „Oznacz to
  wystąpienie jako zrobione"/„Cofnij wykonanie tego wystąpienia" →
  `SET_OCCURRENCE_DONE`, „Oznacz całą serię jako zrobioną (status zadania)" →
  `SET_TASK_STATUS` (PIERWSZY `isDone` w kolejności `state.statuses`; przy już
  zrobionej serii menu pokazuje samą podpowiedź zamiast przełącznika),
  „Edytuj wszystkie" → TaskModal's „Cykliczność" section (`SET_TASK_RECURRENCE`).
  A done occurrence (`occurrenceIsDone`) only adds the additive `.done` class +
  the shared `.block-done-mark` tick — no handler or pointer path changes. `openSlotMenu`
  guards `.week-recur-block` alongside `.week-block`. MonthView shows only a
  `.month-cell-recur` ⟳ marker (no blocks/menu). The rule is edited in TaskModal
  via explicit dispatch, never through the SAVE_TASK draft/auto-save. All bin
  drag, pointer lifecycle and rendered-column hit-testing paths are untouched.
- Kolizja termin↔termin (2026-07-30, ZMIANA reguły z 2026-07-21): wydarzenia
  WCHODZĄ do kolizji — ale WYŁĄCZNIE do nich. Nadal nie zasilają `packDayBlocks`,
  sum, `dayTotal` ani przeciążenia, więc inwariant 1 (godziny żyją tylko
  w `WorkloadEntry`) zostaje nietknięty. Dwa kierunki, dwa progi:
  - „wydarzenie → zajęty czas": `eventDraftConflicts` (selectors.ts) liczy kolizje
    draftu z blokami, wydarzeniami I wystąpieniami cyklicznymi wskazanych osób.
    Uczestnicy IMIENNI (ZMIANA 2026-08-06, decyzja usera — poprzednio każda
    kolizja blokowała): kolizja z zajęciami => `warning`, którego zapis wymaga
    ŚWIADOMEGO POTWIERDZENIA w EventModal (dialog ConfirmProvider „Dodaj/Zapisz
    mimo kolizji", treść z `eventConflictConfirmMessage`; żywa linia
    `namedConflictWarningMessage` zapowiada dialog). Reduktor PRZEPUSZCZA taki
    zapis — bramka potwierdzenia jest wyłącznie UX-owa. `blocking` (odrzucenie
    tą samą referencją stanu, inwariant 6, zdanie z
    `eventConflictBlockingMessage`) niesie dla imiennych WYŁĄCZNIE urlop
    uczestnika. Wydarzenie OGÓLNOFIRMOWE (`attendeeIds` puste)
    => `warning`: zapis PRZECHODZI bez dialogu, a modal pokazuje żywą linię
    `.event-conflict-warn` z licznikiem osób. Twarda blokada liczona po wszystkich
    czyniłaby spotkanie całofirmowe niewstawialnym w godzinach pracy.
    ZAKRES: dla wydarzenia JEDNORAZOWEGO sprawdzana jest data draftu. SERIA
    CYKLICZNA (2026-08-04, decyzja usera) NIE jest blokowana przez kolizje —
    czyjś urlop w jednym tygodniu nie może uniemożliwić serii na pół roku.
    `eventDraftConflicts` SYMULUJE wtedy wystąpienia w horyzoncie
    `RECURRING_CONFLICT_HORIZON_DAYS` (183 dni; `until` przycina go naturalnie)
    i zwraca WSZYSTKIE kolizje jako `warning` z polem `date`; modal pokazuje
    żywą listę terminów (`recurringConflictWarningMessage`: „8 lip (śro): Jarek
    ma w tym dniu urlop… Wydarzenie zapisze się mimo to."), a reduktor — to
    samo źródło prawdy — przepuszcza zapis.
  - „zadanie → wydarzenie": `blockCollidesWithEvent` blokuje blok wchodzący na
    SPOTKANIE tej osoby. Autorytatywnie w `setBlockTime`; w UI zapala `colliding`
    przy przeciąganiu bloku i karty zasobnika, daje osobny komunikat w menu
    „Zaplanuj część" („⚠ Koliduje z wydarzeniem tej osoby w tym dniu.") i wchodzi
    do ścieżki klawiaturowej jako PSEUDO-SĄSIAD w `blocksOnDay` (czysty
    `calendarBlockKeyboard.ts` bez zmian, a `findBlockConflict` nazywa spotkanie).
    Wystąpienia cyklicznych zadań świadomie NIE blokują tego kierunku.
    Od 2026-08-03 (decyzja usera) blokada dotyczy WYŁĄCZNIE osób imiennie
    przypisanych: wydarzenie OGÓLNOFIRMOWE (`attendeeIds` puste) nie blokuje
    NIKOMU planowania — `blockCollidesWithEvent` je pomija, `BusyInterval` niesie
    flagę `companyWide` (bramka upuszczania `overlapsEvent` i pseudo-sąsiedzi
    klawiatury ją filtrują; straż scalania czyta dalej WSZYSTKIE przedziały).
    Symetria z progiem przy zapisie (ogólnofirmowe tylko ostrzega).
  - ODRZUCONE upuszczenie ma widoczny POWÓD (2026-08-03): oba modele
    przeciągania (blok i karta zasobnika) pokazują przy punkcie zwolnienia
    ulotny dymek `.week-drop-notice` (czysta prezentacja: portal do body,
    `pointer-events: none`, timeout ~2,6 s) ze zdaniem z `dropRejectReason`
    (priorytet: urlop → spotkanie → blok; urlop blokuje dobę, a rysuje się
    tylko w oknie pracy, więc bez zdania odbicie na „pustym" polu było
    niezrozumiałe). To samo zdanie idzie kanałem `announce` do regionu
    `role="status"`. Cykl życia wskaźnika bez zmian (inwariant 7).
  - „Zaplanuj część" PODPOWIADA start omijający zajętości wydarzeniowe:
    `findFreeStart`/`nextFreeStart` dostają obok bloków PSEUDO-BLOKI z
    `calendarEventsForDate` (spotkania imienne + urlop; ogólnofirmowe nie —
    nie blokują zapisu). To wyłącznie propozycja UI — decyzja zostaje w
    strażach reduktora.
  - Menu slotu (prawy klik): kafel URLOPU nie zjada już prawego kliku —
    strażnik `openSlotMenu` przepuszcza `.week-event-block.urlop` (lewy klik
    dalej otwiera urlop; spotkania zostają wykluczone jak dotąd). Przy
    AKTYWNYM filtrze osób pozycja „+ Dodaj zadanie" renderuje się PER OSOBA
    („… — {imię}", prefill `openNewTask` tą osobą), a urlopowicz dnia jest
    `disabled` z widoczną linijką `.context-menu-hint` („{imię} ma w tym dniu
    urlop."); bez filtra zostaje jedna ogólna pozycja.
  - Styk krawędzi nie jest kolizją w żadnym z kierunków (`rangesOverlap`).
  - `eventBusyByPersonDate` niesie teraz `kind` i `title`, a POKRYCIE poszerzyło
    się z „par z co najmniej jednym blokiem" na „właściciele wierszy
    `state.workload` × renderowane dni" — dzień z samym spotkaniem jest legalnym
    celem upuszczenia. Straż scalania czyta WSZYSTKIE rodzaje, bramka upuszczania
    tylko `kind: 'event'`.
  - URLOP (2026-08-03) wchodzi tą samą drogą: to `CalendarEvent` z
    `kind: 'urlop'` i zakresem `date..endDate`, zapisany jako PEŁNA DOBA
    (0/1440), więc pełnodniowa blokada wypada z istniejących ścieżek —
    `blockCollidesWithEvent` (a przez nie `SET_BLOCK_TIME`, `SCHEDULE_BIN_PART`,
    klawiatura i „Zaplanuj część"), `scheduleConflictsForRange` (rodzaj
    `'urlop'`, opis BEZ zakresu godzin) i `eventBusyByPersonDate` (`kind:
    'urlop'`; bramka upuszczania czyta teraz `'event' | 'urlop'`). DWIE ścieżki
    dostają JAWNĄ straż `personVacationOnDate`, bo nie idą przez `setBlockTime`:
    `INSERT_BLOCK` i datowany `REASSIGN_ENTRY` (zasobnikowy przechodzi — nie ma
    daty). PRÓG przy ZAPISIE urlopu jest odwrotny niż przy spotkaniu imiennym:
    kolizje z całego zakresu dat są WYŁĄCZNIE `warning` (`eventDraftConflicts`
    iteruje po dniach), bo urlop nad zaplanowanym tygodniem musi być
    zapisywalny; kierunek odwrotny (spotkanie w czyjś dzień urlopu) zostaje
    twardo `blocking`. RENDER świadomie IGNORUJE zapisane czasy: blok
    `.week-event-block.urlop` stoi w oknie `vacationRenderWindow(person)`
    (godziny pracy z profilu, fallback 9:00-17:00 w `weekViewLayout.ts`), więc
    pokazuje MNIEJ, niż faktycznie zajmuje. Wskaźnik: tam gdzie dzień kryje
    urlop osoby, PALMA zastępuje wykrzyknik przeciążenia na czterech
    powierzchniach (komórka i flaga WorkloadPage, pasek tygodnia
    PersonProfilePage, `WeekDayModel.vacationNames` w nagłówku dnia — imiona są
    wtedy wyłączone z `overloadNames`). Godziny zaplanowane PRZED zgłoszeniem
    urlopu zostają (inwariant 3: świadome edycje alokacji nie są blokowane).
  - URLOP GODZINOWY (2026-08-24, zgłoszenie „Urlopy"): urlop JEDNODNIOWY może
    nieść okno od-do na siatce 15 min (odbiór nadgodzin, wyjście na część
    dnia); zakres dat `endDate` WYMUSZA pełną dobę. Forma kanoniczna na trzech
    granicach: reduktor waliduje okno jak spotkanie (`normalizeEventDraft`),
    repair i hydracja koercjonują śmieci do pełnej doby
    (`canonicalVacationTimes` w `commandValidation.ts`). Kolizje okna wychodzą
    z istniejących ścieżek interwałowych (czasy wystąpienia są prawdą), a
    PEŁNODNIOWE przywileje ma wyłącznie 0/1440 (`isFullDayVacation`):
    `personVacationOnDate` zwraca TYLKO pełną dobę, więc palma, straż CAŁEGO
    dnia, wpis „urlopowicza dnia" i blokada slot-menu godzinowego nie
    obejmują. Samo OKNO godzinowe jest jednak tą samą twardą blokadą, tylko
    krótszą — dwie jawne ścieżki mają własny rachunek przez
    `personHourlyVacationIntervals`: `INSERT_BLOCK` odrzuca wstawkę, gdy nowy
    albo PRZEPCHNIĘTY blok wylądowałby na oknie (bloki nieruszane pomijane —
    stan zastany sprzed urlopu), a datowany `REASSIGN_ENTRY` liczy DWUETAPOWO:
    najpierw zwykłe `findFreeStart` po samych blokach (okno kończące się późno
    nie przesuwa bloku, gdy normalny slot jest wolny), a dopiero gdy wynik
    wpada w okno — ponownie z oknami jako pseudo-blokami (blok ląduje poza
    oknem albo wcale).
    Spotkań te straże celowo nadal nie obejmują. Render: blok godzinowego stoi
    w SWOIM oknie (weekViewModel podaje `occ.startMinutes`), pełnodniowy dalej
    w `vacationRenderWindow`; lista Wydarzeń pokazuje okno zamiast „Cały
    dzień", a `describeOne` w `eventConflictMessage.ts` wymienia zakres godzin.
    Modal: checkbox „Cały dzień" (domyślnie tak); odznaczenie pokazuje pola
    od-do i CZYŚCI zakres dat. Kafelek „Urlop" na /account
    (`pages/accountHr.ts`): godzinowy NIE zdejmuje dnia z limitu 26 dni
    (`VacationRange.window`, pomijany w `vacationWorkDaysInYear`), a na liście
    nadchodzących pokazuje się z godzinami.
  - Skutek uboczny wart pamięci: wydarzeniowa połowa
    `mergeCoversEventOrRecurrence` jest przez `SET_BLOCK_TIME` praktycznie
    nieosiągalna (dwa stykające się bloki szczelnie wypełniają scalony przedział,
    więc wydarzenie w środku nachodzi na jeden z nich i upuszczenie pada
    wcześniej). Połowa cykliczna zostaje w pełni żywa.
- Calendar events / meetings (2026-07-21) stay PRESENTATIONAL FOR PLANNING
  (invariant 1): WeekView renders each `calendarEventsForDate` occurrence as an
  additive `.week-event-block` overlay (solid cyan border + left bar,
  `--event-accent`, 📅), positioned by `startMinutes`, height ∝
  `durationMinutes`, painted BEHIND real task blocks (tree order, `z-index: 0`);
  events never enter `dayTotal` or overload (into `packDayBlocks` they enter
  ONLY as layout geometry — see „wspólne pakowanie" above; do WYŚWIETLANEJ sumy
  dnia wchodzą przez `calendarDayVolume` — patrz „objętość godzinowa" above).
  Click/keyboard still opens `EventModal` (`?wydarzenie=<id>`). `openSlotMenu`
  guards `.week-event-block` alongside `.week-recur-block`/`.week-block`, and its
  gate widens to `canManageTasks || canManageEvents`: the slot menu shows „+ Dodaj
  zadanie" at `tasks.manage` and „+ Dodaj spotkanie" at `events.manage`.
  MonthView shows only a `.month-cell-event` 📅 marker (no blocks/menu; inline
  `right` offset avoids collision with 🎂/⟳).
- PRZECIĄGANIE SPOTKANIA ZA BRAMKĄ POTWIERDZENIA (2026-08-18) — dawne zdanie
  „kafel wydarzenia nie niesie ŻADNYCH handlerów pointer/drag" JUŻ NIE OBOWIĄZUJE
  dla spotkań. Co dokładnie się zmieniło:
  - CO jest przeciągalne: WYŁĄCZNIE spotkanie (`event.kind !== 'urlop'`) i
    wyłącznie przy `can('events.manage')`. Ciało kafla przenosi (pion = czas co
    15 min, poziom = kolumna dnia), a uchwyty `.week-event-handle.top/.bottom`
    (6 px, geometria `.week-block-handle`, na `pointer: coarse` obie klasy
    znikają) zmieniają czas trwania. URLOP i widz bez prawa noszą klasę
    `.readonly`: zero handlerów, `cursor: pointer`, `touch-action: auto` — czyli
    dokładnie dotychczasowe zachowanie. Utajnione wydarzenie zamaskowane dla
    bieżącego widza jest tylko do odczytu dla gestu i klawiatury dokładnie jak
    w `EventModal`, nawet gdy widz ma `events.manage`. Odebranie uprawnienia albo
    wglądu w trakcie edycji natychmiast cofa gest i wystawioną zmianę
    klawiaturową oraz zamyka oczekujący dialog potwierdzenia przez jego
    `AbortSignal` — w `useLayoutEffect`, więc PRZED malowaniem ramki: utajniony
    tytuł nie pojawia się ani na jedną klatkę po utracie wglądu; żywa bramka
    przed wysyłką nadal blokuje zmianę.
  - BRAMKA: żaden gest ani klawisz nie wysyła niczego sam z siebie. Najpierw
    idzie `useConfirm()` z jawnym zdaniem, że zmiana obowiązuje GLOBALNIE
    (`EVENT_DRAG_GLOBAL_SENTENCE`), a dla serii dochodzi
    `EVENT_DRAG_SERIES_SENTENCE`. „Zmień dla wszystkich" wysyła JEDNĄ istniejącą
    akcję `SAVE_EVENT` (inwariant 6 — żadnej nowej akcji); „Anuluj"/Escape
    cofają podgląd bez wysyłki. Podgląd JEST TRZYMANY na czas pytania (klasa
    `.dragging`), więc okno opisuje to, co widać.
  - DRAFT powstaje z ŻYWEGO wydarzenia (`getState()`) w chwili akceptacji —
    zmienia się tylko `date`/`startMinutes`/`durationMinutes`; `isConfidential`
    świadomie NIE jedzie w draftcie (brak pola zachowuje flagę), a
    `recurrence`/`rsvps` re-kanonikalizuje reduktor. Odmowa reduktora poznaje
    się po TEJ SAMEJ referencji stanu (inwariant 6) — kafel wraca na miejsce,
    a powód idzie dymkiem `.week-drop-notice` i regionem `aria-live`.
  - KOLIZJE: `eventDraftConflicts(getState(), draftLike, id)` liczy się PRZED
    oknem. `blocking` (urlop uczestnika) odbija od razu, BEZ pytania, z tekstem
    `eventConflictBlockingMessage`. `warning` wchodzi JEDNYM zdaniem do TEGO
    SAMEGO okna (`recurringConflictWarningMessage` dla serii,
    `eventConflictWarningMessage` dla ogólnofirmowego, `Termin koliduje: ` +
    `eventConflictConfirmMessage` dla imiennego) — nigdy drugim dialogiem.
  - SERIA: wydarzenie cykliczne wolno przesuwać w PIONIE i rozciągać (zmiana
    dotyczy CAŁEJ serii — reduktor wymusza `rule.startMinutes/durationMinutes`
    równe czasom wydarzenia), ale NIE wolno mu zmienić dnia: projekcja twardo
    trzyma `dayIndex` bazowy, bo `canonicalEventRecurrence` odrzuca kotwicę,
    której dzień tygodnia wypadł z `daysOfWeek`. Zapis zachowuje oryginalne
    `event.date` jako kotwicę serii (data oglądanego wystąpienia nie może uciąć
    wcześniejszych terminów ani przesunąć fazy `intervalWeeks`), a symulacja
    ostrzeżeń dostaje już projektowany czas reguły.
  - OGŁOSZENIA nigdy nie mówią „Zapisano" (2026-08-18, poprawka po przeglądzie).
    Reduktor commituje SYNCHRONICZNIE, ale zapis do `localStorage` leci dopiero
    w efekcie i potrafi paść (quota, tryb prywatny), a upsert w chmurze jeszcze
    później — w takcie dispatchu o sukcesie zapisu NIC nie wiadomo. Dlatego
    `eventAppliedAnnouncement` mówi WYŁĄCZNIE o tym, co widać na siatce
    („Przeniesiono: …" / „Zmieniono czas trwania: …"), a słowo „Zapisano"
    zostaje zarezerwowane dla POTWIERDZONEGO zapisu (`useSaveStatus` stawia
    „Zapisano HH:mm" po 350 ms i tylko gdy `persistFailed` jest fałszywe —
    inwariant „A failed save must never report `Zapisano`" z CLAUDE.md). Za
    nieudany zapis lokalny odpowiada trwały `PersistenceBanner`, za nieudany
    zapis w chmurze istniejący baner synchronizacji. Test pilnujący tego:
    `eventAppliedAnnouncement` w `eventBlockDrag.test.ts`. UWAGA — dotychczasowy
    `blockCommitAnnouncement` (blok ZADANIA, `calendarBlockKeyboard.ts`) nadal
    ogłasza „Zapisano: …" w tym samym takcie i ma ten sam problem; NIE zmieniono
    go razem z tą zmianą (osobny moduł, własne testy, poza zakresem zadania) —
    do rozstrzygnięcia osobno.
  - KLAWIATURA (parytet z blokiem zadania): strzałki góra/dół = 15 min, z
    Shiftem czas trwania, lewo/prawo = dzień (tylko jednorazowe), Enter
    zatwierdza TĄ SAMĄ drogą (czyli otwiera okno potwierdzenia), Escape cofa
    wystawioną edycję, wyjście fokusa też ją COFA (a nie zapisuje — dialog na
    samym Tabie byłby pułapką). Bez wystawionej edycji Enter/spacja nadal
    otwierają `EventModal`. Opis `aria-describedby` idzie z osobnego
    `WEEK_EVENT_KB_HINT_ID`, a nazwa dostępna (`eventBlockAriaLabel`) podąża za
    wystawioną projekcją.
  - CAŁA decyzyjność (projekcja, clamp, automat klawiatury, teksty okna i
    ogłoszeń) siedzi w CZYSTYM `src/components/eventBlockDrag.ts`; WeekView
    trzyma tylko cykl życia wskaźnika — KOPIĘ tego z `TimedBlockImpl`:
    synchroniczny `dragRef` + rAF, `setPointerCapture` ze zwolnieniem PRZED
    wysyłką, `useTouchDragGate().arm(...)` przed każdym wejściem, anulowanie na
    Escape / `blur` okna / `visibilitychange` hidden / `pointercancel` / mysz z
    `buttons === 0`, `setLiveSyncHold` + `onDragActiveChange` na czas gestu.
    `begin` odpuszcza `e.button !== 0`, więc prawy klik nadal otwiera menu RSVP
    wystąpienia. `TimedBlockImpl`, `BinCard`, menu slotu, przeciąganie zasobnika
    i trafianie w wyrenderowaną kolumnę NIE zostały zmienione (inwariant 7).

## Start here for

Calendar blocks, bin recovery, collisions, ripple insertion, reassignment,
availability/overload calculations, drag lifecycle and time utilities.

## Relevant tests and checks

`src/utils/time.test.ts`, `src/utils/touchDrag.test.ts`,
`src/utils/blockLabel.test.ts`, `src/utils/eventConflictMessage.test.ts`,
`src/store/eventActions.test.ts` (progi kolizji terminu, forma kanoniczna urlopu),
`src/components/assigneeHours.test.ts` (domyślne 15 min osoby przypisanej),
`src/components/weekViewModel.test.ts` (pokrycie `eventBusyByPersonDate`),
`src/components/calendarBlockKeyboard.test.ts`,
`src/components/monthGrid.test.ts`,
`src/components/weekViewLayout.test.ts`,
`src/components/eventBlockDrag.test.ts` (projekcja przeciągania spotkania,
uchwyty, blokada dnia serii, treść okna potwierdzenia),
`src/components/overlayShell.test.ts`,
`src/store/blockActions.test.ts`,
`scripts/browser-check-bin-drag.mjs`, `browser-check-bin-split.mjs`, and
`browser-check-placement.mjs`.
