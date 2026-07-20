# Raport workflow: 20260720-193430-227-manual-task-order-in-project

## Wykonane

Funkcja nie istniała w bieżącym buildzie (ProjectDetailPage sortował zadania
wyłącznie po `startDate`), więc zadanie zrealizowano w całości. Workflow tier:
`architect → developer` (ryzyko high: schemat persystowany + integralność
reducera; Codex review wymagany — uruchamia go scheduler po zakończeniu tego
procesu). Pakiet architekta:
`handoffs/scheduler-reviews/227-architect-package.md`.

- **Wybrany model kolejności: pole `orderIndex: number` na `Task`** (nie lista
  id na projekcie). Mirror chmurowy diffuje per-encyjne wiersze, a
  `MERGE_CLOUD_ENTITIES` podmienia zadania hurtowo — pole na zadaniu czyni
  reorder zwykłymi upsertami zadań i hydratuje się „za darmo”. Lista id na
  projekcie sprzęgałaby każde utworzenie/usunięcie zadania z zapisem wiersza
  projektu i wymagała naprawy osieroconych id w jsonb. Precedens:
  `Status.order` + `reorderStatus`. Nazwa celowo `orderIndex`, NIE `sortIndex`
  — `WorkloadEntry.sortIndex` oznacza już kolejność per osobo-dzień/bin.
- **Reducer**: nowa akcja `REORDER_PROJECT_TASK { taskId, direction: -1 | 1 }`
  wzorowana na `REORDER_STATUS`. Nieprawidłowe wejście (nieznane id, ruch poza
  krawędź, kierunek spoza {-1,1}) zwraca tę samą referencję stanu
  (invariant 6). Renumeracja 0..n-1 tylko w projekcie zadania; obiekty o
  niezmienionej randze zachowują tożsamość (minimalne upserty mirrora). Bez
  wiersza aktywności i bez zmiany `updatedAt` (kosmetyka, jak reorderStatus).
- **Dopisywanie na końcu**: `saveTask` przy tworzeniu nadaje
  `max(orderIndex projektu) + 1`; edycja ze zmianą projektu dopisuje na końcu
  projektu docelowego, bez zmiany projektu zachowuje rangę.
- **UI**: `ProjectDetailPage` używa nowego selektora `orderedTasksOfProject`
  (kanoniczny klucz `orderIndex, startDate, id` — wiersze same-0 wyglądają jak
  dotychczasowy sort po startDate). Strzałki ↑/↓ przy każdym zadaniu, widoczne
  tylko z uprawnieniem `tasks.manage`, `disabled` na krawędziach, polskie
  aria-labels („Przesuń zadanie „X” wyżej/niżej”).
- **Naprawa legacy**: `normalizeTaskMeta` w `storage.ts` nadaje brakującym /
  nieskończonym wartościom deterministyczny domyślny porządek per projekt
  (kolejność `startDate, createdAt, id`), idempotentnie po wartości; bez
  podbicia `DATA_VERSION` (precedens `departmentId`). Naprawa nigdy nie
  wyzwala zapisów do chmury (mirror jest oparty o diff reducera).
- **Supabase — plik migracji: `supabase/migrations/20260720200000_task_order_index.sql`**
  — idempotentne `add column if not exists order_index integer not null
  default 0` + zabezpieczony backfill (rangowanie tylko w projektach, gdzie
  KAŻDE zadanie ma jeszcze 0; ponowne uruchomienie nie nadpisze ręcznej
  kolejności). Bez zmian RLS/polityk. Plik dopisany do listy w
  `migrations.test.ts`. Hydracja: select + mapowanie w `plannerData.ts`
  (koercja nie-skończonych do 0), wiersz diffa w `cloudMirror.ts` (`taskRow`),
  insert w `dataImport.ts`.
- Ukończenie (`Status.isDone`), kalendarz i workload są od kolejności w pełni
  niezależne (testy to jawnie asertują).

## Zmiany

- `src/types.ts`, `src/store/AppStore.tsx`, `src/store/selectors.ts`,
  `src/store/storage.ts`, `src/store/seed.ts`,
  `src/pages/ProjectDetailPage.tsx`, `src/styles.css`
- `src/supabase/plannerData.ts`, `src/supabase/cloudMirror.ts`,
  `src/supabase/dataImport.ts`, `src/supabase/migrations.test.ts`
- Nowe: `supabase/migrations/20260720200000_task_order_index.sql`,
  `src/store/taskOrder.test.ts` (12 przypadków),
  `handoffs/scheduler-reviews/227-architect-package.md`
- Testy rozszerzone/naprawione fixtures (TS strict, wymagane pole):
  storage, plannerData, cloudMirror, activityAttribution i in.
- Wiki: `openwiki/n2hub/cloud-database.md` **zaktualizowana** (nowa kolumna
  `tasks.order_index`); `state-and-persistence.md` i
  `ui-navigation-and-onboarding.md` bez zmian (granice/inwarianty nadal
  aktualne).

## Weryfikacja

- Developer, komenda skupiona (taskOrder, commandValidation, saveTaskWorkload,
  taskMeta, storage, cloudMerge, activityAttribution, plannerData, cloudMirror,
  migrations, dataImport): **PASS 381/381**.
- Developer, pełny `vitest run`: **PASS 960/960** (933 przed zadaniem + nowe);
  `npx tsc --noEmit` i `npm run build` czyste.
- Orkiestrator, niezależny smoke (`taskOrder` + `migrations` + `cloudMirror`):
  **PASS 51/51**.
- Browser: brak — żaden scenariusz nie pokrywa kolejności listy zadań
  (`browser-check-date-hardening.mjs` odwiedza `/projects/:id` tylko dla dat);
  matryca release'owa jest właścicielem.
- `npm test`: oczekuje na scheduler
- `npm run build`: oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Trigger `set_updated_at` na `public.tasks` podbija chmurowe `updated_at`
  przy każdym upsercie, podczas gdy reorder nie zmienia lokalnego `updatedAt`
  — zachowanie istniejące dla wszystkich upsertów zadań; Codex/reviewer
  powinien potwierdzić brak churnu diffa po hydracji.
- Pierwszy reorder w projekcie z samymi domyślnymi 0 renumeruje cały projekt
  (jednorazowo do N upsertów zadań) — zaakceptowane w pakiecie, mieści się w
  istniejącym batchowaniu mirrora.
- Backfill SQL sprawdzony tylko strukturalnie przez `migrations.test.ts`
  (brak żywej bazy w tym środowisku); zgodnie z pamięcią projektu migracje
  aplikuje się ręcznie przez SQL editor + wpis do rejestru.
- Wymagany Codex review (schemat + reducer) uruchamia scheduler po wyjściu
  tego procesu — nie był częścią tej sesji.

## Podpis schedulera

- Run: `20260720-193430-227-manual-task-order-in-project`
- Prompt: `227-manual-task-order-in-project.md`
- Gałąź review: `review-integration`
- Baza: `4168341aaed315cc487eec414d0cba721f80cb29`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `4168341aaed315cc487eec414d0cba721f80cb29`
- Gałąź review: `review-integration`
- Run: `20260720-193430-227-manual-task-order-in-project`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `src/pages/ProjectDetailPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/activityAttribution.test.ts`
- `src/store/blockActions.test.ts`
- `src/store/cloudMerge.test.ts`
- `src/store/commandValidation.test.ts`
- `src/store/dateGuards.test.ts`
- `src/store/exportDryRun.test.ts`
- `src/store/saveTaskWorkload.test.ts`
- `src/store/seed.ts`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `src/store/statusActions.test.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/store/taskMeta.test.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/dataImport.test.ts`
- `src/supabase/dataImport.ts`
- `src/supabase/migrationStatus.test.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/plannerData.ts`
- `src/types.ts`
- `handoffs/scheduler-reviews/20260720-193430-227-manual-task-order-in-project.md`
- `handoffs/scheduler-reviews/227-architect-package.md`
- `src/store/taskOrder.test.ts`
- `supabase/migrations/20260720200000_task_order_index.sql`
