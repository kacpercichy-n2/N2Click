# Raport workflow: 20260721-124104-239-task-card-hours-and-publish

## Wykonane

Workflow tier: `architect → developer` (pakiet
`handoffs/scheduler-reviews/239-architect-package.md`,
PKG-20260721-task-card-hours-publish, Risk: high, Codex review: required).
Wszystkie trzy zgłoszenia z karty były nadal niezrealizowane w bieżącym buildzie
i zostały wdrożone:

1. **Godziny przy szkicu.** Sekcja `.sold-hours` („Przypisane osoby”) jest teraz
   widoczna także dla szkiców (zasobnik i siatka alokacji pozostają ukryte).
   Wpisane godziny zapisują się w nowym addytywnym polu
   `Task.draftHours?: {personId, hours}[]` (forma kanoniczna: klucz obecny tylko
   dla szkicu z ≥1 wpisem > 0 na siatce 0.25h; publikacja i naprawa przy
   odczycie usuwają klucz). `saveTask` dla szkicu nadal pomija rekonsyliację
   workloadu — jedynie utrwala/czyści `draftHours` z `binTotals`. Przy
   publikacji (`PUBLISH_TASK` / `PUBLISH_PROJECT_DRAFTS`) wspólny helper
   `materializeDraftBin` tworzy dokładnie jeden wiersz zasobnika na
   `(taskId, personId)` (invariant 4), z pominięciem wpisów osieroconych /
   nieprzypisanych; nieprawidłowe komendy zwracają tę samą referencję stanu
   (invariant 6). Pole jest lustrzane do Supabase
   (`tasks.draft_hours jsonb`, migracja `20260721130000_task_draft_hours.sql`
   — tylko plik, nie aplikowano zdalnie), z mapowaniem profile_id w
   `cloudMirror`/`plannerData`/`dataImport`, bo odświeżanie live-sync zastępuje
   kolekcję zadań i pole lokalne zostałoby utracone.
2. **Dostępność przypisanych osób.** Pod sumą `.sold-hours-total` nowy, czysto
   informacyjny panel: per przypisana osoba „Dostępność w okresie: dostępne X /
   zajęte Y” liczone `rangeAvailabilityForPerson` z `src/store/selectors.ts`
   w zakresie dat zadania, z wyróżnieniem przeciążenia (liczba dni
   overbookingu). Bez zmian w logice zapisu.
3. **Publikacja z karty zadania.** W sticky pasku akcji szkicu rozdzielone
   akcje: istniejący szkic — „Zapisz szkic” + „Opublikuj” (zapis, a po sukcesie
   `PUBLISH_TASK` i zamknięcie); nowy szkic — „Utwórz szkic” + „Utwórz
   i opublikuj” (pojedynczy `SAVE_TASK` z `isDraft: false`). Gate: istniejące
   `tasks.manage` (`readOnly`). Zbiorczy przycisk na `ProjectDetailPage`
   pozostaje bez zmian jako skrót.

## Zmiany

- `src/types.ts` — addytywne pole `Task.draftHours`.
- `src/store/AppStore.tsx` — helpery `draftHoursFromBinTotals`,
  `materializeDraftBin`, `publishedTask`; zapis szkicu i materializacja godzin
  przy publikacji.
- `src/store/storage.ts` — naprawa `normalizeTaskMeta` (idempotentna
  normalizacja / usuwanie pola).
- `src/supabase/cloudMirror.ts`, `src/supabase/plannerData.ts`,
  `src/supabase/dataImport.ts` — lustro `draft_hours` (push, select+hydracja,
  import) z zachowaniem formy kanonicznej dla `sameRowValue`.
- `supabase/migrations/20260721130000_task_draft_hours.sql` (nowy) +
  `src/supabase/migrations.test.ts` — kolumna `tasks.draft_hours jsonb`.
- `src/components/TaskModal.tsx` — godziny dla szkiców, panel dostępności,
  rozdzielone akcje publikacji; `src/styles.css` — drobne addytywne style
  panelu.
- Testy: `src/store/draftTasks.test.ts`, `src/store/storage.test.ts`,
  `src/supabase/cloudMirror.test.ts`, `src/supabase/plannerData.test.ts`.
- Dokumentacja runu: `handoffs/scheduler-reviews/239-architect-package.md`,
  `handoffs/RUN-STATE.md`.

## Weryfikacja

- Focused (worker): `npx vitest run src/store/draftTasks.test.ts
  src/store/storage.test.ts src/store/saveTaskWorkload.test.ts
  src/store/cloudMerge.test.ts src/supabase/cloudMirror.test.ts
  src/supabase/plannerData.test.ts src/supabase/migrations.test.ts` —
  287 passed / 0 failed.
- Pełny `npm test`: 1116 passed / 1116 (41 plików; baza z prompta „933+new”
  była nieaktualna — liczy się zero porażek).
- `npm run build`: zielony (czysty TypeScript, bundle zbudowany).
- Browser: brak — żaden istniejący scenariusz nie pokrywa modala szkicu;
  matryca przeglądarkowa należy do weryfikacji release.
- `npm test` / `npm run build` gate: oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Migracja `20260721130000_task_draft_hours.sql` nie została zaaplikowana do
  zdalnego Supabase (zgodnie z konwencją: aplikacja za zgodą operatora);
  do czasu aplikacji push `draft_hours` na środowisku bez kolumny by się nie
  powiódł — kolumna musi trafić do bazy przed wdrożeniem.
- Ścieżka edycji zadania opublikowanego w `saveTask` celowo nietknięta
  (spread `...t`); gdyby opublikowane zadanie kiedyś niosło `draftHours`,
  klucz usunie `normalizeTaskMeta` przy odczycie — w praktyce stan nieosiągalny.
- Wiki: `wiki unchanged` na tym etapie — decyzja należy do reviewera;
  prawdopodobnie nieaktualne miejsca: `state-and-persistence.md` (sekcja
  „SZKICE ZADAŃ” — zdania o godzinach) i `cloud-database.md` (kolumny tabeli
  `tasks`).

## Podpis schedulera

- Run: `20260721-124104-239-task-card-hours-and-publish`
- Prompt: `239-task-card-hours-and-publish.md`
- Gałąź review: `review-integration`
- Baza: `77195b37394a787f63ac65a697fac9cc62cc6adf`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `77195b37394a787f63ac65a697fac9cc62cc6adf`
- Gałąź review: `review-integration`
- Run: `20260721-124104-239-task-card-hours-and-publish`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/TaskModal.tsx`
- `src/store/AppStore.tsx`
- `src/store/draftTasks.test.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/dataImport.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/plannerData.ts`
- `src/types.ts`
- `handoffs/scheduler-reviews/20260721-124104-239-task-card-hours-and-publish.md`
- `handoffs/scheduler-reviews/239-architect-package.md`
- `supabase/migrations/20260721130000_task_draft_hours.sql`
