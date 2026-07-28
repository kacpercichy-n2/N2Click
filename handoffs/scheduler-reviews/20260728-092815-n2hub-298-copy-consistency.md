# Raport workflow: 20260728-092815-n2hub-298-copy-consistency

## Wykonane

Warstwa wyłącznie prezentacyjna/copy — bez zmian w modelu danych, reduktorze,
selektorach ani storage. Tryb wygaszania pozostaje wyłączony, inwariant 6
nietknięty, zero nowych zależności runtime.

Najpierw analiza „czy pozycja nadal występuje w bieżącym buildzie”; wszystkie
cztery występowały.

**SY-08 — formaty dat.** W `src/utils/dates.ts` opisany kontrakt TRZECH
dozwolonych formatów ekranowych (nagłówek pliku + doc na każdym helperze):
1. data treści `formatShortWithWeekday` → „20 lip (pon)”,
2. znacznik czasu `formatTimestamp` → „20 lip 2026, 14:05”,
3. pole formularza — natywne `<input type="date">`, wartość `DATE_FMT`.
Wymienione użycia:
- `EventsPage` — surowe `{e.date}` (`2026-07-24`) → data treści,
- `TicketsPage` — surowe `{t.createdAt.slice(0, 10)}` → znacznik czasu,
- chipy filtrów „Od:/Do:” w `TasksPage` i `ProjectsPage` — `formatShort`
  (bez dnia tygodnia) → data treści,
- dymki osi czasu (kamień milowy, pasek projektu, pasek zadania) — `formatShort`
  → data treści.
Po zmianie surowy ISO NIE renderuje się już nigdzie (sprawdzone grepem).
`formatShort` i `formatRowLabel` zostały udokumentowane jako prymitywy
osi/siatki (linijka osi czasu, nagłówki wierszy gęstych tabel), nie samodzielne
daty treści — patrz „Ograniczenia”.

**SY-20 — postęp.** Nowy czysty moduł `src/utils/progressLabel.ts`
(`itemsProgressLabel` / `blocksProgressLabel`) daje jeden wzór bez czasownika.
Podpięty w trzech miejscach, które miały trzy różne brzmienia:
- modal: „ukończono 2/5” → „2/5 pozycji”; „Wykonane bloki (wykonano 3/7)” →
  „Wykonane bloki (3/7 bloków)”,
- karta listy zadań: `checklistGlyphs.text` „2/3” → „2/3 pozycji”, a etykieta dla
  czytnika ekranu „Lista kontrolna: 2 z 3” → „Lista kontrolna: 2/3 pozycji”,
- podgląd (arkusz szczegółów zadania na telefonie): „2/3” → „2/3 pozycji”.

**SY-19 — licznik.** Nowy `listCounterLabel` w `src/utils/polishPlural.ts`:
`„<widoczne> z <wszystkich> <bytów>”`, rzeczownik w dopełniaczu mnogim, bo
przypadek narzuca przyimek „z”, a nie liczebnik. Podpięty na wszystkich trzech
listach, które już pokazywały licznik, zawsze na końcu paska filtrów:
- `ProjectsPage` — przy okazji naprawiona niepoprawna odmiana: `polishCount`
  dawał „1 z 2 **projekty**”, teraz „1 z 2 projektów”,
- `TasksPage` — bez zmiany brzmienia, ale przez wspólny helper,
- `TicketsPage` — „3 zgłoszeń” (sam licznik widocznych) → „3 z 12 zgłoszeń”.
  Mianownikiem jest ZAKRES WIDOCZNOŚCI (bez `tickets.manage` widać tylko własne
  zgłoszenia), nie wszystkie zgłoszenia w bazie — inaczej licznik zdradzałby
  liczbę cudzych.

**SY-33 — pustki.** Jeden szablon: „Brak <bytów>” + jedno zdanie o przyczynie +
akcja. Przy aktywnym filtrze zdanie zaczyna się od tego faktu i akcją jest
„Wyczyść filtry”:
- `TasksPage` — „Brak pasujących zadań / Zmień lub wyczyść filtry…” (bez akcji)
  → „Brak zadań / Filtry nie przepuszczają żadnego z N zadań.” + „Wyczyść
  filtry” (ten sam `clearFilters`, co `onClearAll` paska),
- `ProjectsPage` — pustka była jednowariantowa (zawsze „Dodaj projekt…”, nawet
  gdy winne były filtry); teraz rozgałęziona po `activeCount`,
- `TicketsPage` — hint mieszał obie przyczyny w jednym zdaniu („Nikt jeszcze nic
  nie zgłosił albo filtry nic nie przepuszczają”); teraz rozdzielony, z akcją
  „Wyczyść filtry” albo „Nowe zgłoszenie”.

**SY-29 — etykieta dostępności.** Wybrany tańszy wariant: podpowiedź cytuje
prawdziwą etykietę pola. `PeoplePage`: „Limit dzienny liczony jest z pola
dostępności.” → „…z pola „Godziny/dzień”.”

## Zmiany

- `src/utils/dates.ts` — kontrakt trzech formatów + doc na prymitywach osi/siatki
- `src/utils/dates.test.ts` — nowy blok testów trzech formatów
- `src/utils/progressLabel.ts` + `src/utils/progressLabel.test.ts` — nowe
- `src/utils/polishPlural.ts` — `listCounterLabel`
- `src/utils/polishPlural.test.ts` — nowy (licznik + istniejące reguły mnogości)
- `src/utils/checklistGlyphs.ts` / `.test.ts` — wzór postępu przez wspólny helper
- `src/components/TaskModal.tsx` — checklista + wykonane bloki
- `src/pages/EventsPage.tsx`, `TicketsPage.tsx`, `TasksPage.tsx`,
  `ProjectsPage.tsx`, `TimelinePage.tsx`, `PeoplePage.tsx`

## Weryfikacja

- `npx vitest run` na czterech dotkniętych plikach testowych: 4 pliki / 72 testy
  — zielone.
- `npm test` (pełny): **99 plików / 2113 testów, wszystko zielone**, brak
  regresji. Testy asertujące stare napisy (`checklistGlyphs.test.ts`) zostały
  ZAKTUALIZOWANE, nie usunięte.
- `npm run build` (`tsc --noEmit && vite build`): zielony. Po drodze build złapał
  jeden błąd składni (komentarz JSX w pozycji wyrażenia w `TaskModal`) — poprawiony,
  ponowny build i pełny `npm test` zielone.
- Nowe testy formatów dat są odporne na strefę czasową: `formatTimestamp` jest
  testowany napisem ISO bez offsetu, więc `new Date` czyta go jako czas lokalny.
- Grep potwierdza, że po zmianie żaden `yyyy-MM-dd` ani `createdAt.slice(0, 10)`
  nie trafia do renderu.
- Checki przeglądarkowe: nie uruchamiane — żadna z pokrywanych przez nie
  interakcji (drag/resize kalendarza, zasobnik, umieszczanie) nie była ruszana.
- Wiki: **bez zmian**. Żadna strona nie opisywała formatów dat, wzoru licznika
  ani szablonu pustki, a `state-and-persistence.md` (persystencja w `yyyy-MM-dd`
  przez `src/utils/dates.ts`) pozostaje prawdziwa.

## Ryzyka / rzeczy do sprawdzenia

- **SY-29 niedokończone w jednym miejscu — świadomie.** Identyczna, wciąż
  nieprawdziwa podpowiedź stoi w `PersonProfilePage.tsx:476` przy tym samym polu
  „Godziny/dzień”. „Profil osoby” jest na liście wykluczeń właściciela (bez
  zawężenia do layoutu), więc pliku nie ruszałem. To jednolinijkowa zmiana copy
  do dołożenia razem z pracą właściciela tej strony.
- **SY-08 nie schodzi do dosłownie trzech formatów w całej aplikacji** — przy
  zadanych wykluczeniach nie da się. `formatRowLabel` („pon 03.08”) żyje w
  Obciążeniu i Profilu osoby (oba wykluczone) oraz w siatce alokacji w
  TaskModalu, gdzie kolumna jest numeryczna (`--n2-font-data`,
  `tabular-nums`); `formatShort` zostaje w linijce/nagłówku Osi czasu
  (wykluczony) i jako cegła `weekRangeLabel`. Oba są teraz udokumentowane jako
  prymitywy osi/siatki, nie samodzielne daty treści, więc kolejny widok nie
  dorobi z nich siódmego wariantu. `formatBirthday` (data urodzenia — rok, bez
  dnia tygodnia) i `dayMonthLabel` (zdanie wyłącznie dla czytnika ekranu) też
  zostają i są opisane.
- **Zgłoszenia**: zmieniałem tam wyłącznie treść (data, licznik, pustka), bez
  ruszania układu strony. Znacznik czasu w kolumnie „Data” jest dłuższy niż
  poprzedni surowy ISO — na wąskim ekranie tabela zgłoszeń może rozjechać się
  o kilka pikseli. `.ticket-table-wrap` scrolluje w poziomie, więc nic nie ginie,
  ale warto rzucić okiem na telefonie.
- **`TicketsPage`**: `visible` liczy się teraz z wydzielonego `scoped`
  (dwa `useMemo` zamiast jednego). Logika filtrowania, sortowania i eksportu CSV
  jest bit w bit ta sama — „Eksportuj” nadal zapisuje dokładnie to, co widać.
- Licznik zgłoszeń pokazuje mianownik zakresu widoczności, nie globalny —
  celowo, ale to zmiana znaczenia liczby względem tego, co było („N zgłoszeń”).

## Podpis schedulera

- Run: `20260728-092815-n2hub-298-copy-consistency`
- Prompt: `298-copy-consistency.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `a41a754f071759f91ab58334ce6e4f58e861f1fb`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `a41a754f071759f91ab58334ce6e4f58e861f1fb`
- Gałąź review: `review-integration`
- Run: `20260728-092815-n2hub-298-copy-consistency`

### Pliki zgłoszone do review

- `src/components/TaskModal.tsx`
- `src/pages/EventsPage.tsx`
- `src/pages/PeoplePage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/pages/TicketsPage.tsx`
- `src/pages/TimelinePage.tsx`
- `src/utils/checklistGlyphs.test.ts`
- `src/utils/checklistGlyphs.ts`
- `src/utils/dates.test.ts`
- `src/utils/dates.ts`
- `src/utils/polishPlural.ts`
- `handoffs/scheduler-reviews/20260728-092815-n2hub-298-copy-consistency.md`
- `src/utils/polishPlural.test.ts`
- `src/utils/progressLabel.test.ts`
- `src/utils/progressLabel.ts`
