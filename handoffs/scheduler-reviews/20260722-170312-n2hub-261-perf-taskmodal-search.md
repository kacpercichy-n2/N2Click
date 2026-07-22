# Raport workflow: 20260722-170312-n2hub-261-perf-taskmodal-search

## Wykonane

Analiza wstępna potwierdziła, że oba hotspoty z promptu nadal istniały w
bieżącym buildzie, więc zadanie wykonano (workflow tier:
developer → reviewer, bez architekta — prompt był gotową specyfikacją).

Czysta optymalizacja wydajności, zachowanie i wygląd identyczne:

- **GlobalSearch** — ewaluacja zapytania przez `useDeferredValue` (wpisywanie
  nie blokuje się na `searchAll`); metadane wyników (mapy klientów/projektów/
  statusów + liczby projektów klienta) preliczane raz per rewizję stanu przez
  nowy czysty helper `buildSearchResultMeta` w `src/store/selectors.ts`,
  zamiast lookupów per wynik w renderze (wcześniej liczonych też przy każdej
  zmianie aktywnego wiersza strzałkami/hoverem). `searchAll` nietknięty —
  wyniki i kolejność identyczne.
- **TaskModal** — `AllocationGrid` (najcięższy skan per komórka:
  dostępność/przeciążenie O(dni×osoby×workload)) owinięty w `React.memo`;
  handlery `setCell`/`fillWeekdays`/`clearPerson` przez `useCallback`, więc
  wpisywanie w pola formularza nie re-renderuje i nie reskanuje siatki.
  Zależności `availabilityByPerson` zawężone z całego `state` do
  `state.people`/`state.workload` — jedyne wycinki, które
  `rangeAvailabilityForPerson` przechodnio czyta (zweryfikowane w źródle
  selektorów przez developera i niezależnie przez reviewera).
- Logika zapisu, walidacji, dirty-tracking, kolejność sekcji (prompt 250)
  i reduktory — nietknięte. Zero zmian modelu danych.

Odchylenie od promptu (zaadjudykowane przez reviewera jako zasadne): nie
dzielono edytora na osobne komponenty per sekcja ani nie dodano leniwego
doliczania — w TaskModal nie ma sekcji zwiniętych/niewidocznych na starcie,
a szeroki podział dotykałby delikatnej maszynerii save/dirty/auto-save
(inwariant 6). Dominujący koszt per klawisz (reskan AllocationGrid) został
wyeliminowany mniejszym cięciem.

## Zmiany

- `src/components/GlobalSearch.tsx` — deferred query + mapy metadanych.
- `src/store/selectors.ts` — nowy helper `buildSearchResultMeta` (jeden
  przebieg, parytet z `getClient`/`getProject`/`getStatus`/`projectsOfClient`).
- `src/components/AllocationGrid.tsx` — `React.memo`.
- `src/components/TaskModal.tsx` — stabilne handlery, zawężone zależności
  `availabilityByPerson`.
- `src/store/selectors.test.ts` — testy parytetu preliczonych metadanych
  (w tym brakujący klient, klient bez projektów, parytet na żywych wynikach
  `searchAll`).

## Weryfikacja

- Fokusowe: `npx vitest run src/store/selectors.test.ts` — PASS (102 testy).
- Pełne: `npm test` — 57 plików, 1406 testów, wszystkie zielone.
- `npm run build` (`tsc --noEmit && vite build`) — zielony (tylko istniejące
  wcześniej ostrzeżenie o chunku >500 kB).
- Review (tier reviewer, read-only): **approve**, zero blockerów; zweryfikował
  poprawność zawężonych zależności, stabilność propsów `React.memo`,
  identyczność wyników wyszukiwania i brak zmian w ścieżkach reducer/save.
  Bez wniosku o dodatkowy przebieg Codex (`codex-requested` niewymagane).
- Wiki: **unchanged** — czysta optymalizacja warstwy renderu;
  `buildSearchResultMeta` mieści się w udokumentowanej granicy „selectors.ts
  owns derived reads”, a zadeklarowane strony wiki nie opisują wewnętrznych
  szczegółów renderu, które się zmieniły.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Brak funkcjonalnych. `useDeferredValue` daje przejściowe (jedna klatka)
  okno, w którym lista wyników odpowiada poprzedniemu zapytaniu — Enter w tym
  oknie jest zabezpieczony (`if (item)`), stan końcowy zawsze identyczny;
  to inherentna cecha podejścia wskazanego w prompcie.

## Podpis schedulera

- Run: `20260722-170312-n2hub-261-perf-taskmodal-search`
- Prompt: `261-perf-taskmodal-search.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `ac1094d2d7d045e578d32003671e0038732d1a43`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `ac1094d2d7d045e578d32003671e0038732d1a43`
- Gałąź review: `review-integration`
- Run: `20260722-170312-n2hub-261-perf-taskmodal-search`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/AllocationGrid.tsx`
- `src/components/GlobalSearch.tsx`
- `src/components/TaskModal.tsx`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `handoffs/scheduler-reviews/20260722-170312-n2hub-261-perf-taskmodal-search.md`
