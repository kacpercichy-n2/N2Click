# Raport workflow: 20260727-211553-n2hub-275-recurring-occurrence-status

## Wykonane

Analiza wstępna: funkcja NIE istniała w bieżącym buildzie. `tasks.recurrence`
(jsonb) niósł wyjątki tylko w dwóch formach — `{date, skip}` oraz przesunięcie
czasu `{date, startMinutes, durationMinutes}`. Odhaczenie zadania cyklicznego szło
wyłącznie przez `Task.statusId`, czyli zmieniało CAŁĄ serię (zgłoszenie Zuzanny).
Zadanie zostało zrealizowane w całości (workflow tierowy: architect → developer →
reviewer).

Wdrożone (kształt najmniej inwazyjny — wyjątek per data w ISTNIEJĄCEJ kolumnie
jsonb, bez nowej tabeli i bez materializacji wystąpień):

- `src/types.ts` — `RecurrenceOverride.done?: true`; cztery formy kanoniczne
  udokumentowane. DATA_VERSION zostaje **7** (klucz addytywny i opcjonalny,
  dokładnie jak `WorkloadEntry.done` przy per-block „gotowe”).
- `src/utils/recurrence.ts` — `normalizeOverride` akceptuje wyjątek „done-only”
  oraz `done` złożone z przesunięciem czasu; `skip` bije `done`; `done:false` i
  śmieci są odrzucane, ale nie niszczą reszty wyjątku; przesunięcie równe regule
  zwija się do `{date, done:true}`. `RecurrenceOccurrence` niesie `done`,
  `expandOccurrences` je nakłada. **Matematyka generowania (dni tygodnia,
  granice, `until`) nietknięta.**
- `src/store/AppStore.tsx` — nowa akcja `SET_OCCURRENCE_DONE` (wzorowana na
  `SET_BLOCK_DONE`); wszystkie ścieżki odrzucenia i no-opy zwracają TĘ SAMĄ
  referencję stanu (inwariant 6). `setRecurrenceOverride` zachowuje `done` przy
  upsercie przesunięcia czasu (i odwrotnie — `done` nie kasuje przesunięcia).
- `src/store/selectors.ts` — `occurrenceIsDone` (własna flaga LUB status zadania
  `isDone`), analogicznie do `blockIsDone`.
- `src/components/WeekView.tsx` — kafel wystąpienia dostaje znacznik `✓`
  (`.block-done-mark`, reużyty) i klasę `.done`; menu kontekstowe wystąpienia ma
  rozdzielone, jednoznaczne ścieżki PL: „Oznacz to wystąpienie jako zrobione” /
  „Cofnij wykonanie tego wystąpienia” vs „Oznacz całą serię jako zrobioną (status
  zadania)” (z podpowiedzią, gdy seria już jest zrobiona). Żadna ścieżka
  pointer/drag nie została ruszona (inwariant 7).
- `src/components/TaskModal.tsx` — lista wyjątków pokazuje „— zrobione” /
  sufiks „ · zrobione” (usuwa artefakt „00:00, 0 h” dla wyjątku done-only).
- `src/styles.css` — wyłącznie reguły addytywne dla `.week-recur-block.done`.
- Chmura/realtime: bez zmian w warstwie transportu — `done` jedzie jako
  nieprzezroczysta treść istniejącej kolumny `tasks.recurrence` przez
  `MERGE_CLOUD_ENTITIES`; mirror wysyła jsonb verbatim
  (`cloudMirror.ts:274`), a hydracja (`plannerData.ts:494`) i load
  (`storage.ts:972`) re-kanonikalizują przez `normalizeRecurrence`. Dane legacy
  bez `done` degradują się do `done:false` bez echo-write; generowanie pozostaje
  deterministyczne, więc sync nie migocze.
- Wiki zaktualizowane (werdykt recenzenta: `wiki updated`) —
  `openwiki/n2hub/state-and-persistence.md` (cztery formy kanoniczne wyjątku) i
  `openwiki/n2hub/scheduling-and-calendar.md` (nowe akcje menu wystąpienia).
- `handoffs/RUN-STATE.md`: wpis dopisany na końcu, zgodnie z konwencją repo
  (poprzednia wersja pośrednia kasowała historię — przywrócone).

**Migracja Supabase: ŻADNA nie została dodana.** Kolumna `tasks.recurrence jsonb`
już istnieje (`20260721170000_task_recurrence.sql`), a `done` to jej treść —
brak nowej tabeli, kolumny, polityki RLS i zmian w publikacji realtime.
Operator nie ma nic do ręcznego zaaplikowania.

## Zmiany

- `src/types.ts`, `src/utils/recurrence.ts`, `src/store/AppStore.tsx`,
  `src/store/selectors.ts`
- `src/components/WeekView.tsx`, `src/components/TaskModal.tsx`, `src/styles.css`
- Testy: `src/utils/recurrence.test.ts`, `src/store/recurrenceActions.test.ts`,
  `src/store/selectors.test.ts`, `src/store/cloudMerge.test.ts`,
  `src/supabase/plannerData.test.ts`
- Dokumentacja: `openwiki/n2hub/state-and-persistence.md`,
  `openwiki/n2hub/scheduling-and-calendar.md`, `handoffs/RUN-STATE.md`,
  nowy `handoffs/packages/PKG-20260727-recurring-occurrence-done.md`

## Weryfikacja

- `npm test` — **68 plików / 1571 testów PASS**, 0 błędów; brak regresji w
  istniejących suitach (żaden istniejący test nie został usunięty ani osłabiony).
- `npm run build` (`tsc --noEmit && vite build`) — **OK**; jedyne ostrzeżenie to
  znany, wcześniej istniejący komunikat o rozmiarze chunku (>500 kB).
- Nowe testy pokrywają kryteria akceptacji: odhaczenie jednego wystąpienia nie
  rusza pozostałych dat ani samej reguły; przełącznik na poziomie serii (status
  `isDone`) nadal zapala wszystkie wystąpienia; `MERGE_CLOUD_*` z niepoprawnym
  ładunkiem zwraca TĘ SAMĄ referencję (asercje `toBe`, nie deep-equal);
  idempotencja formy kanonicznej, odrzucanie `done:false`, złożenie `done` z
  przesunięciem czasu w obie strony; round-trip mirror → hydracja.
- Recenzja tieru `reviewer` (read-only): kod `approved-with-nits`, zero
  znalezisk wymagających zmiany; jedyny bloker był proceduralny — brak artefaktu
  Codex, który z kontraktu powstaje dopiero po wyjściu tego procesu
  (`scripts/codex-review.sh` uruchamia scheduler). Adjudykacja należy do
  osobnego procesu recenzenta schedulera.
- Bez checku przeglądarkowego: menu wystąpienia to czysty React, żadna ścieżka
  pointer/drag/resize nie została zmieniona.

## Ryzyka / rzeczy do sprawdzenia

- `canonicalEventRecurrence` (wydarzenia) reużywa `normalizeRecurrence`, więc
  wyjątek wydarzenia mógłby teraz kanonicznie nieść `done`. Nigdzie nie jest
  odczytywany, nie psuje `sameRowValue` ani idempotencji — recenzent uznał guard
  za zbędny. Gdyby wydarzenia kiedyś dostały własne „zrobione”, to jest miejsce
  do świadomej decyzji.
- Świadoma asymetria wizualna: `✓` na kaflu wystąpienia zapala się dla
  `occurrenceIsDone` (własna flaga LUB status zadania), a `TimedBlock` na realnym
  bloku pokazuje `✓` tylko dla `entry.done`. Zgodne z pakietem i semantycznie
  poprawne; ewentualne wyrównanie starszego precedensu to osobne zadanie.
- `openRecurMenu` liczy `seriesDone` z zależnościami `[canManageTasks,
  state.statuses]` przy wyciszonym `exhaustive-deps` — callback czyta ze stanu
  wyłącznie statusy (przez `isDoneStatus`), więc stale-closure nie występuje;
  celem było niedewaluowanie memo `RecurBlock` przy każdej zmianie stanu.
  Zweryfikowane przez recenzenta.
- Wyjątek per data mieszka w jsonb zadania, więc rośnie on liniowo z liczbą
  odhaczonych wystąpień. Przy długich, otwartych seriach kolumna może z czasem
  puchnąć — obecna skala (serie do ~92 dni okresu zadania) tego nie wymaga, ale
  to naturalny punkt obserwacji.

## Podpis schedulera

- Run: `20260727-211553-n2hub-275-recurring-occurrence-status`
- Prompt: `275-recurring-occurrence-status.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `93c3f1287ed31f6ac08c2b28dd6ae56dc2e95897`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `93c3f1287ed31f6ac08c2b28dd6ae56dc2e95897`
- Gałąź review: `review-integration`
- Run: `20260727-211553-n2hub-275-recurring-occurrence-status`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/components/TaskModal.tsx`
- `src/components/WeekView.tsx`
- `src/store/AppStore.tsx`
- `src/store/cloudMerge.test.ts`
- `src/store/recurrenceActions.test.ts`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `src/styles.css`
- `src/supabase/plannerData.test.ts`
- `src/types.ts`
- `src/utils/recurrence.test.ts`
- `src/utils/recurrence.ts`
- `handoffs/packages/PKG-20260727-recurring-occurrence-done.md`
- `handoffs/scheduler-reviews/20260727-211553-n2hub-275-recurring-occurrence-status.md`
