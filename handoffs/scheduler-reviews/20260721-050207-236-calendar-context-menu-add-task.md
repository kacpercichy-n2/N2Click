# Raport workflow: 20260721-050207-236-calendar-context-menu-add-task

## Wykonane

### Analiza stanu wyjściowego

Zadanie miało dwie części — sprawdziłem, co realnie zostało do zrobienia:

- **Część 3 (panel bloku z podziałem) — JUŻ ISTNIAŁA.** Menu kontekstowe bloku
  (`openMenu` w `WeekView.tsx`) ma już oba działania: ripple-insert
  (`INSERT_BLOCK`: „↑ Dodaj przed / ↓ Dodaj po”) oraz podział bloku
  (`SPLIT_BLOCK`: „Podziel na pół / Podziel na ćwiartki”). Reduktor `SPLIT_BLOCK`
  i jego testy w `blockActions.test.ts` też już były na gałęzi. Nie tworzyłem
  więc nowej akcji reduktora ani nowego afordansu podziału.
- **Część 2 (menu na pustym slocie) — BRAKOWAŁO.** `.week-day-col` nie miało
  żadnego `onContextMenu`; puste sloty nie oferowały nic. To była jedyna
  pozostała praca i ją zrealizowałem.

### Implementacja

1. **`src/utils/time.ts`** — czysta, testowalna funkcja
   `slotStartFromOffset(offsetPx, pxPerHour)`: liczy zsnapowany do 15 minut start
   dnia z pionowego offsetu piksela w kolumnie, klamruje do
   `[0, DAY_MINUTES - MINUTE_STEP]`, a przy niepoprawnej geometrii (nieskończona /
   ≤0) zwraca 0. Reużywa `snapToStep` i geometrię `HOUR_PX` (84 px/h) — całość
   matematyki idzie przez helpery `utils/time`.

2. **`src/components/WeekView.tsx`**
   - Nowy stan `slotMenu` (x, y, date, startMinutes) + `slotMenuRef`, oddzielny od
     istniejącego `menu` (kluczowanego po `WorkloadEntry`).
   - `openSlotMenu(date, e)` na `.week-day-col`: pomija zdarzenie, gdy cel leży
     w `.week-block` (bloki mają własne menu), liczy start przez
     `slotStartFromOffset(e.clientY - rect.top, HOUR_PX)`, zamyka menu bloku i
     otwiera małe menu „+ Dodaj zadanie (HH:mm)”.
   - `addTaskInSlot()` woła `openNewTask(undefined, { date, personId })`; gdy tydzień
     jest przefiltrowany do dokładnie jednej osoby (`filter.size === 1`),
     przekazuje jej id do preselekcji wykonawcy.
   - Menu gate’owane uprawnieniem `tasks.manage` (spójnie z read-only TaskModal) —
     `onContextMenu` nie jest podpinane, gdy rola nie może tworzyć zadań.
   - Dyscyplina zamykania jak przy dragu: dedykowany `useEffect` (aktywny tylko gdy
     menu otwarte) nasłuchuje Escape, mousedown poza menu oraz `scroll`
     (`capture: true`, by złapać wewnętrzny scroll `.week-days-viewport`), i odpina
     wszystkie listenery przy zamknięciu — brak wycieków. Ścieżki dragu bloków/karty
     zasobnika i hit-testu kolumn nie ruszałem (invariant 7).

3. **`src/components/TaskModal.tsx`** — prefill przy tworzeniu:
   - `openNewTask` przyjmuje opcjonalny `prefill { date?, personId? }` i zapisuje je
     jako parametry URL `date` / `assignee` (kompatybilne wstecz — `openNewTask()` /
     `openNewTask(id)` działają bez zmian).
   - `openTask` (istniejące zadanie) oraz `close()` czyszczą `date`/`assignee`, by
     podpowiedzi nie „wyciekły” na inne zadanie.
   - `TaskEditor` seeduje z prefillu tylko dla NOWEGO zadania: `startDate`+`endDate`
     z klikniętego dnia (walidacja `isValidDateStr` — spreparowany URL spada do
     dziś), `assigneeIds` z `initialPersonId`, o ile osoba nadal istnieje w stanie.

4. **`src/utils/time.test.ts`** — 3 nowe testy `slotStartFromOffset`.

## Zmiany

- `src/utils/time.ts` — nowy helper `slotStartFromOffset`.
- `src/utils/time.test.ts` — 3 testy jednostkowe helpera.
- `src/components/WeekView.tsx` — menu kontekstowe pustego slotu (stan, handlery,
  dyscyplina zamykania, render, podpięcie `onContextMenu` na `.week-day-col`).
- `src/components/TaskModal.tsx` — prefill daty/osoby przy tworzeniu zadania
  (`openNewTask`/`openTask`/`close`/`TaskEditor`).

## Weryfikacja

- `npm test` — **zielono, 1086 przeszło (41 plików)**; wcześniej 1083, +3 nowe.
- `npm run build` (`tsc --noEmit && vite build`) — **zielono**.
- `node scripts/browser-check-bin-drag.mjs chromium` — **PASS**.
- `node scripts/browser-check-bin-drag.mjs webkit` — **PASS**.
- `node scripts/browser-check-bin-split.mjs chromium` — **PASS** (ta sama jednostka
  menu, dotknięta zmianami).
- Ukierunkowana weryfikacja Playwright (skrypt tymczasowy, usunięty; local-mode na
  :5173, dane przykładowe, rola administratora):
  - prawy klik na pustym slocie → „+ Dodaj zadanie (8:30)” ze zsnapowanym czasem;
  - Escape zamyka menu;
  - klik pozycji otwiera modal nowego zadania z prefillem daty (`2026-07-20`
    == nagłówek klikniętej kolumny „20 lip”, start i koniec);
  - po przefiltrowaniu tygodnia do „Ola Nowak” slot-add preselekcjonuje dokładnie
    `["Ola Nowak"]` jako wykonawcę;
  - prawy klik na bloku nadal daje pełne menu bloku (tytuł + „↑ Dodaj przed / ↓
    Dodaj po / Podziel na pół / Podziel na ćwiartki”), bez wycieku pozycji slotowej;
  - brak błędów konsoli / `pageerror`.
- Playwright doinstalowałem lokalnie przez `npm i --no-save` (nie jest zależnością
  repo; `package.json`/`package-lock.json` niezmienione, `node_modules`
  gitignorowany). Regeneracje PNG z browser-checków przywróciłem (`git checkout`),
  więc diff to wyłącznie 4 pliki źródłowe + ten raport.

## Ryzyka / rzeczy do sprawdzenia

- Menu slotu prefiluje wyłącznie DZIEŃ i (warunkowo) osobę — nie zakłada bloku
  workload o konkretnej godzinie. Zadania nie mają pory dnia (żyje ona w
  `WorkloadEntry`), więc kliknięty czas służy tylko jako czytelna etykieta „(HH:mm)”.
  Świadomie nie seeduję alokacji, by nie zwiększać złożoności ani nie ruszać modelu
  godzin (invarianty 1–4 nietknięte).
- Nie dodano nowej akcji reduktora (część 3 już istniała), więc brak nowego testu
  reduktora — pokrycie jednostkowe dodane dla czystego helpera `slotStartFromOffset`.
- Reguły kolizji tej samej osoby i cykl życia dragu (invarianty 3 i 7) nie były
  modyfikowane; browser-checki bin-drag/bin-split to potwierdzają.
- Wiki `scheduling-and-calendar.md` bez zmian: granice i invarianty pozostają
  aktualne, nowe menu to dodatkowy afordans wewnątrz tych samych granic.

## Podpis schedulera

- Run: `20260721-050207-236-calendar-context-menu-add-task`
- Prompt: `236-calendar-context-menu-add-task.md`
- Gałąź review: `review-integration`
- Baza: `8c06c6726c1637f96d0fb1fcab0662ab2a1cad9b`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `8c06c6726c1637f96d0fb1fcab0662ab2a1cad9b`
- Gałąź review: `review-integration`
- Run: `20260721-050207-236-calendar-context-menu-add-task`

### Pliki zgłoszone do review

- `src/components/TaskModal.tsx`
- `src/components/WeekView.tsx`
- `src/utils/time.test.ts`
- `src/utils/time.ts`
- `handoffs/scheduler-reviews/20260721-050207-236-calendar-context-menu-add-task.md`
