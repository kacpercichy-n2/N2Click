# Raport workflow: 20260721-135536-240-unified-and-persistent-filters

## Wykonane

Workflow tier `architect → developer → reviewer`. Wszystkie trzy pozycje z promptu były nadal brakujące w buildzie i zostały zaimplementowane:

1. **Filtr po projekcie na zadaniach** — `SavedFilterCriteria` dostało nowe kryterium `projectId` (default `''` w `DEFAULT_FILTER_CRITERIA`, sanityzacja wiszących id przy każdym load w `storage.ts`, walidacja w `SAVE_FILTER_PRESET`, kaskada czyszcząca przy `deleteProject`). Na `TasksPage` doszła grupa filtra „Projekt”.
2. **Spójne filtrowanie kanban/projekty/zadania** — `FilterPage` rozszerzone addytywnie o `'kanban'`; `KanbanPage` dostał grupę „Projekt” oraz `FilterPresets page="kanban"` (osoby były już wcześniej przez `PersonFilter` — zakres skorygowany względem promptu); `ProjectsPage` dostał grupę „Osoba”. Istniejące presety `projects|tasks` przechodzą migrację bez utraty (dostają tylko `projectId: ''`).
3. **Trwałość ostatnio użytego filtra per widok** — nowe pole `AppData.lastFilters` (mapa widok → `LastViewFilter`: criteria + `personIds` + wymiary specyficzne dla widoku), akcja reduktora `SET_LAST_FILTER`, naprawa/sanityzacja przy load w `storage.ts` (addytywnie, bez podbicia wersji 7). Sześć widoków (`tasks`, `projects`, `kanban`, `workload`, `calendar`, `timeline` — w tym `PersonFilter` na kalendarzu i timeline) przeszło z lokalnego `useState` na stan ze store'a, więc filtry przeżywają nawigację i reload.

**Gdzie trzymana trwałość i odnotowane odstępstwo od promptu:** prompt mówił o persystencji cloud-authoritative przez `MERGE_CLOUD_*`, ale `savedFilters` w tym kodzie jest celowo lokalne (brak ścieżki cloud, zapis w wiki). `lastFilters` leży więc obok `savedFilters` w `AppData` i jest persystowane lokalnie przez `storage.ts`; `'lastFilters'` dodane do `NON_MIRRORED_KEYS` w `persistGate.ts` (zmiana samego filtra zawsze zapisuje się lokalnie), a testy assertują, że każdy `MERGE_CLOUD_*` zostawia `savedFilters` i `lastFilters` po referencji. Bez nowej schemy Supabase — zgodnie z zapisaną architekturą i bez scope creep.

Inwariant 6 zachowany: nieprawidłowy payload `SET_LAST_FILTER`/`SAVE_FILTER_PRESET` oraz zapis identyczny wartościowo zwracają tę samą referencję stanu (pokryte testami). Ścieżki pointer/drag kalendarza nietknięte (inwariant 7) — zmienione tylko źródło zbioru wybranych osób.

Główne pliki: `src/types.ts`, `src/store/AppStore.tsx`, `src/store/storage.ts`, `src/store/commandValidation.ts` (nowe współdzielone sanityzatory), `src/store/persistGate.ts`, `src/store/seed.ts`, `src/components/FilterPresets.tsx`, sześć stron w `src/pages/`.

## Zmiany

- Model danych: `SavedFilterCriteria.projectId`, `FilterPage + 'kanban'`, `AppData.lastFilters` (`FilterViewKey`/`LastViewFilter`).
- Reduktor: `SET_LAST_FILTER`, walidacja `SAVE_FILTER_PRESET`, kaskady `deleteProject`/`DELETE_WORK_CATEGORY` czyszczą też `lastFilters`.
- Persystencja: naprawa idempotentna w `storage.ts` (bez bump wersji), `lastFilters` w `NON_MIRRORED_KEYS`.
- UI: grupy filtrów „Projekt” (zadania, kanban), „Osoba” (projekty), presety na kanbanie; filtry store-backed na 6 widokach.
- Wiki: `openwiki/n2hub/state-and-persistence.md` zaktualizowane (lokalna granica `lastFilters`, `FilterPage 'kanban'`) — **wiki updated**, potwierdzone przez reviewera jako zgodne z diffem.
- Testy: nowy `src/store/filterState.test.ts` (20 przypadków) + rozszerzone `storage.test.ts`, `cloudMerge.test.ts`, `persistGate.test.ts`; dwa istniejące testowe literały kryteriów uzupełnione o `projectId: ''` (wymuszone przez typ).

## Weryfikacja

- `npm test`: **1142 passed / 0 failed** (42 pliki; było 1116, +26 nowych testów) — u developera.
- `npm run build`: **zielony** (`tsc --noEmit` czysty; ostrzeżenie o chunku >500 kB jest pre-existing).
- Reviewer (read-only): **APPROVED**, zero blockerów; potwierdzone inwarianty 6 i 7, kompatybilność presetów, poprawność zapisu w wiki.

## Ryzyka / rzeczy do sprawdzenia

- Minor (reviewer, nieblokujące): w `normalizeDates` ręcznie uszkodzony wpis `lastFilters: {tasks: null}` poszedłby ścieżką fail-closed zamiast naprawy w izolacji — ta sama ekspozycja istnieje już dla `savedFilters`, spójne z obecną posturą kodu.
- Minor (kosmetyczne): deep link `?client=` na `ProjectsPage` aplikuje się teraz efektem po montażu — możliwa jedna klatka z zapamiętanym filtrem zanim parametr wygra; parametr nadal wygrywa jako efektywna wartość początkowa.
- Wartości `planning` zduplikowane w `commandValidation.ts` (uniknięcie cyklu importów ze `selectors.ts`); ryzyko dryfu opisane komentarzem z odnośnikiem.

## Podpis schedulera

- Run: `20260721-135536-240-unified-and-persistent-filters`
- Prompt: `240-unified-and-persistent-filters.md`
- Gałąź review: `review-integration`
- Baza: `184e84d901d526dedefc695f1ba5aee89bd7bc15`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `184e84d901d526dedefc695f1ba5aee89bd7bc15`
- Gałąź review: `review-integration`
- Run: `20260721-135536-240-unified-and-persistent-filters`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/components/FilterPresets.tsx`
- `src/pages/CalendarPage.tsx`
- `src/pages/KanbanPage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/pages/TimelinePage.tsx`
- `src/pages/WorkloadPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/cloudMerge.test.ts`
- `src/store/commandValidation.ts`
- `src/store/exportDryRun.test.ts`
- `src/store/persistGate.test.ts`
- `src/store/persistGate.ts`
- `src/store/seed.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/store/taskMeta.test.ts`
- `src/types.ts`
- `handoffs/scheduler-reviews/20260721-135536-240-unified-and-persistent-filters.md`
- `handoffs/scheduler-reviews/240-architect-package.md`
- `src/store/filterState.test.ts`
