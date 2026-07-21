# State and persistence

## Boundaries

- `src/types.ts` owns persisted model types.
- `src/store/AppStore.tsx` is the sole reducer and mutation boundary.
- `src/store/selectors.ts` owns derived reads; pages must not duplicate them.
- `src/store/storage.ts` owns localStorage, migrations, validation/repair on
  load, save outcomes and the same-browser revision envelope.
- In supabase mode the CLOUD IS AUTHORITATIVE. A diff-based cloud mirror
  (`src/supabase/cloudMirror.ts` + `src/supabase/plannerData.ts`, driven by
  `src/supabase/CloudSyncProvider.tsx`) sits BEHIND the reducer: it mirrors
  EIGHT planner families
  (clients/projects/milestones/tasks/assignments/workload/comments/activity) to
  Supabase from state diffs AFTER each action, and hydrates them on sign-in via
  the single `MERGE_CLOUD_ENTITIES` reducer action, which REPLACES those
  collections with the payload (local-only rows — e.g. demo/sample planner data
  — are dropped; hydration runs once per sign-in with an empty push queue, so
  no unsynced edit is lost; assignment row ids stay stable by
  (taskId, personId) pair). The same payload carries the RLS profile set
  (`people`), merged FIRST. Independently, every ready org snapshot is merged
  from App via `MERGE_CLOUD_DICTIONARIES` (departments/statuses/service
  types/work categories replaced; fail-closed if the cloud status set would
  violate the ≥1-active + ≥1-done invariant) and `MERGE_CLOUD_PEOPLE`
  (authoritative team: upsert by email keeps local id/password, new people get
  the cloud profile UUID, people without a cloud account are removed, session
  identity pointing at a removed person is cleared). The mirror also carries
  the WRITE path for dictionaries (statuses/departments/service types/work
  categories → their tables; RLS: admin-only) and for PERSON PROFILE UPDATES
  (profiles UPDATE only — account creation stays with provisioning and
  deletion with the Supabase operator; PeoplePage hides add/delete in supabase
  mode). Only per-user saved filters, per-view last-used filters
  (`AppData.lastFilters`) and sample/reset remain local-only concepts
  (SampleBanner never renders in supabase mode).
  Constraint-violation write errors (23502/23503/23505/23514) drop the op with
  the Polish permission notice rather than stalling the retry queue. Local mode:
  zero diff.
- LIVE SYNC (2026-07-17): CloudSyncProvider subscribes one Realtime channel to
  `postgres_changes` on the published tables (migration
  20260718091000_realtime_publication). Any DB change schedules a debounced
  (~1.2 s) full sync: a SILENT org refetch (`OrgDataProvider.refreshSilently` —
  stale-while-revalidate, state never drops to `loading`, so the mirror queue
  and `active` survive) followed by planner rehydration. While the channel is
  SUBSCRIBED (`live` in `useCloudSync()`), CloudSyncBanner renders nothing; the
  manual-refresh hint banner is the fallback when live is down. Guards that
  keep this safe: `loadPlannerSnapshot` filters dependents of skipped
  projects/tasks (one orphan must not no-op the whole fail-closed merge), an
  EMPTY cloud people payload fail-closes when local people exist (RLS anomaly
  must not wipe the team), the queue is cleared only on sign-out, and edits
  made during a ready-state rehydration keep queueing (maps exist) and are
  pushed right after the merge.
- ZGŁOSZENIA (2026-07-20): kolekcja `tickets` w `AppData` (`Ticket` w
  `src/types.ts`; slugi `kind`/`priority`/`status` + polskie etykiety w
  `src/utils/tickets.ts`). Mutacje: `ADD_TICKET` / `SAVE_TICKET` /
  `SET_TICKET_STATUS` / `DELETE_TICKET`, walidacja w `commandValidation.ts`
  (`isValidTicketDraft`, `isValidTicketStatus`) — pusty tytuł/opis, nieznany
  `reporterId` lub wartość spoza enuma zwracają TĘ SAMĄ referencję stanu.
  Kolekcja jest ADDYTYWNA: `DATA_VERSION` zostaje na 7, `emptyData()` daje `[]`,
  a ścieżka wczytania ma `coerceArray(parsedRest.tickets, …)` i pass `repairTickets`
  (odrzuca wiersze bez `id`/`title`, normalizuje nieznane `kind`/`priority`/
  `status` do 'inne'/'sredni'/'nowe', zachowuje osieroconego zgłaszającego).
  W chmurze mirroruje się jako dziewiąta rodzina (`ticketRow` + diff po id →
  `public.tickets`), a hydracja podmienia kolekcję autorytatywnie — `tickets` w
  `CloudMergePayload` jest OPCJONALNE (brak pola => reduktor nie rusza kolekcji).
- DOKUMENTY PROJEKTU (2026-07-21): `Project.documents` — osadzona lista
  odnośników (`ProjectDocument` w `src/types.ts`; slug `kind` + polskie etykiety
  w `src/utils/projectDocuments.ts`). Tylko ADRESY, żadnych plików. Mutacje:
  `ADD_PROJECT_DOCUMENT` / `SAVE_PROJECT_DOCUMENT` / `DELETE_PROJECT_DOCUMENT`,
  walidacja w `commandValidation.ts` (`normalizeProjectDocumentDraft` +
  `isValidProjectDocumentDraft`) — pusty `url`, nieznany `kind` albo
  nieistniejący projekt/dokument zwracają TĘ SAMĄ referencję stanu; zapis bez
  zmiany wartości to no-op. SCHEMAT ADRESU jest regułą bezpieczeństwa, nie UX:
  projekty są współdzielone w organizacji, więc adres jednej osoby renderuje się
  jako `href` u innych. `normalizeProjectDocumentUrl` (parsowanie przez
  `new URL`, bez regexów) przepuszcza wyłącznie `http:`/`https:`, adres bez
  schematu normalizuje do `https://`, a resztę (`javascript:`, `data:`, `file:`,
  `mailto:`) odrzuca — na TRZECH granicach: reduktor (zapisuje wartość
  znormalizowaną), `repairProjectDocuments` i RENDER w ProjectDetailPage (zły
  adres z chmury/starszego zapisu ląduje jako tekst, nigdy w `href`).
  Pole jest ADDYTYWNE: `DATA_VERSION` zostaje na 7, a `repairProjectDocuments`
  (biegnie na wyniku OBU ścieżek wczytania) daje `[]` zapisom sprzed pola,
  odrzuca wiersze o niedozwolonym adresie i normalizuje nieznany `kind` do
  'link'. Usunięcie projektu zabiera
  listę bez osobnej kaskady; w chmurze to kolumna jsonb `projects.documents`.
- SZKICE ZADAŃ (2026-07-21): `Task.isDraft?: boolean` (OPCJONALNE, ADDYTYWNE —
  brak/`false` = opublikowane; `DATA_VERSION` zostaje na 7). Zadanie utworzone
  WEWNĄTRZ projektu (modal otwarty z `initialProjectId`) startuje jako szkic;
  bezpośrednie tworzenie gdzie indziej (Zadania/kalendarz/kanban) publikuje
  natychmiast. Szkic NIE materializuje godzin: `saveTask` zapisuje zadanie +
  przypisania, ale pomija CAŁĄ rekoncyliację workload (allocations/binTotals/
  newUnassigned ignorowane) — planowane godziny żyją wyłącznie w `WorkloadEntry`
  i powstają dopiero po publikacji (inwariant 1 + 4). Edycja NIGDY nie zmienia
  `isDraft` (zachowuje stan zadania). Publikacja: `PUBLISH_PROJECT_DRAFTS`
  (atomowo cały projekt; nieistniejący projekt/brak szkiców => ta sama
  referencja, inwariant 6) i `PUBLISH_TASK` (pojedynczy; nie-szkic/nieistniejące
  => ta sama referencja). `INSERT_BLOCK` na szkicu jest odrzucane (ta sama
  referencja). Wykluczenia w widokach planowania są dwutorowe: selektory oparte o
  `workload` (sumy/kalendarz/zasobnik/przeciążenie) wykluczają szkice
  SAMOCZYNNIE (brak wierszy), a listy oparte o PRZYPISANIA filtrują jawnie —
  `overdueTasksForPerson`, `unplannedTasksForPerson`, `todayAgendaForPerson`
  (dateless), `projectsOfPerson` (selectors: `isDraftTask`/`isPublishedTask`),
  plus kanban (`kanbanBoard.buildKanbanColumns`), lista „Zadania”
  (`TasksPage`), oś czasu (`TimelinePage`) i profil osoby
  (`PersonProfilePage`). Widok projektu POKAZUJE szkice (badge „szkic” +
  „Zapisz i opublikuj”). Repair wczytania: `normalizeTaskMeta` ustawia
  `isDraft: raw.isDraft === true`, więc każdy legacy zapis i chmura bez kolumny =
  opublikowane. W chmurze to kolumna `tasks.is_draft` (patrz cloud-database).
- DATA URODZENIA (2026-07-21): `Person.birthDate` (yyyy-MM-dd, '' = brak;
  OPCJONALNE, ADDYTYWNE — `DATA_VERSION` zostaje na 7). Repair biegnie w
  `migratePerson` (wołany przez `migrateV4toV5` na KAŻDYM wczytaniu, nie tylko
  version<5): brak pola albo wartość niebędąca poprawną 'yyyy-MM-dd' spada na ''.
  Edytowalne w profilu (input „Data urodzenia”) wg `profileEditPolicy` — self i
  menedżer własnego działu mają je w macierzy (jak telefon; NIE jest to
  eskalacja uprawnień). Czysto prezentacyjne: `peopleWithBirthdayOnDate`
  (selectors, dopasowanie miesiąc+dzień przez `isBirthdayOn`) zasila znacznik 🎂
  w nagłówkach WeekView i komórkach MonthView (bez zmian ścieżek wskaźnika —
  inwariant 7). W chmurze kolumna `profiles.birth_date date` (NIE objęta
  triggerem `protect_profile_privileges`); mapowana przez
  referenceData/cloudMirror i hydrowana przez MERGE_CLOUD_PEOPLE (patrz
  cloud-database).
- FILTRY UJEDNOLICONE I TRWAŁE (2026-07-21): `SavedFilterCriteria.projectId`
  (''=wszystkie) i `AppData.lastFilters` (`Partial<Record<FilterViewKey,
  LastViewFilter>>` — ostatnio użyty filtr per widok: projects/tasks/kanban/
  workload/calendar/timeline). Oba ADDYTYWNE (`DATA_VERSION` zostaje na 7) i
  LOKALNE ONLY (jak `savedFilters` — brak domu w chmurze; per-użytkownik).
  `FilterPage` zyskuje `'kanban'`. Repair na KAŻDYM wczytaniu: `normalizeTaskMeta`
  daje presetom brakujący `projectId` (dangling → ''), a `lastFilters` odrzuca
  nieznane klucze widoków i sanityzuje wpisy współdzielonym
  `sanitizeLastViewFilter` (commandValidation: kryteria wypełnione, dangling
  projectId/workCategoryId → '', priority/planning spoza enuma → '', personIds
  zdeduplikowane); `normalizeDates` czyści from/to także w `lastFilters`. Zapis:
  reduktor `SET_LAST_FILTER` (sanityzuj → porównaj po wartości → no-op zwraca tę
  samą referencję; nieznany widok / strukturalnie zły ładunek → ta sama
  referencja, inwariant 6). `SAVE_FILTER_PRESET` waliduje `page` i kryteria;
  kaskady `deleteProject`/`DELETE_WORK_CATEGORY` czyszczą pole w savedFilters
  ORAZ lastFilters. `MERGE_CLOUD_*` zostawiają `lastFilters` i `savedFilters` po
  referencji; `persistGate.NON_MIRRORED_KEYS` zawiera `lastFilters` (zmiana
  samych filtrów NIGDY nie pomija zapisu lokalnego). Testy: `filterState.test.ts`,
  rozszerzenia w `storage.test.ts`/`cloudMerge.test.ts`/`persistGate.test.ts`.
- STANOWISKA (2026-07-21): kolekcja `jobTitles` w `AppData` (`JobTitle` w
  `src/types.ts`, tuż po `workCategories`) — słownik stanowisk zarządzany w
  Administracji („Stanowiska”). Mutacje: `ADD_JOB_TITLE` / `RENAME_JOB_TITLE` /
  `DELETE_JOB_TITLE` w reduktorze — trim; pusta nazwa, nieznane id oraz DUPLIKAT
  bez rozróżniania wielkości liter (`toLocaleLowerCase('pl-PL')`, reguła TYLKO dla
  stanowisk; działy zachowują historyczne zachowanie) zwracają TĘ SAMĄ referencję
  (inwariant 6); rename na własną dokładną nazwę to no-op; DELETE bez kaskady —
  `Person.role` (wolny tekst) zachowuje wartość. Kolekcja ADDYTYWNA: `DATA_VERSION`
  zostaje na 7, `emptyData()`/seed dają `[]`, a wczytanie ma
  `coerceArray(parsedRest.jobTitles, …)` (bez osobnego repair per-wiersz, parytet z
  `departments`). `MERGE_CLOUD_DICTIONARIES` teraz zastępuje też `jobTitles`
  (Array.isArray + isValidNamedRow, pusta chmura POPRAWNA, zniekształcony wiersz →
  ta sama referencja); `MERGE_CLOUD_ENTITIES` nadal ich nie rusza (po referencji).
  `persistGate.NON_MIRRORED_KEYS` zawiera `jobTitles`. Select „Stanowisko” w
  profilu scala je przez `jobTitleSelectOptions` (słownik → opcje działowe →
  bieżąca zaszłościowa wartość na końcu). W chmurze to tabela `public.job_titles`
  (patrz cloud-database). Testy: `jobTitles.test.ts`, rozszerzenia w
  `storage.test.ts`/`roleTitles.test.ts`/`referenceData.test.ts`/`cloudMirror.test.ts`.
- `Client` carries contact fields (contactName/contactEmail/contactPhone/notes;
  columns from 20260718090000_clients_contact_fields, '' or missing = none — no
  repair pass, use-sites coalesce), edited on the `/clients` page via
  `SAVE_CLIENT`/`SET_CLIENT_ARCHIVED`. WYMAGANE POLA (2026-07-21): every NEW
  write via `ADD_CLIENT`/`SAVE_CLIENT` must carry name + contactName + (email OR
  phone) — `isValidClientDraft` in `commandValidation.ts`; a shortfall returns
  the SAME state reference (invariant 6). Presence only, NO e-mail regex. The
  rule gates the reducer only: load/repair/migration never routes through it, so
  legacy clients without contact data stay readable and are asked for the
  missing fields on their next edit (ClientsPage shows a live Polish message and
  auto-save stays paused). The AdminPage name-only client quick-add is gone
  (link to `/clients`); `seed.ts` demo clients satisfy the rule.
- AUTO-SAVE (2026-07-17): clients (edit form), ProjectDetailPage and TaskModal
  (existing tasks) auto-commit VALID dirty drafts after ~0.9 s idle
  (`src/utils/useAutoSave.ts`); invalid drafts wait for the inline fix and an
  explicit tab conflict pauses auto-save (resolution stays the banner's
  decision). `withActivity` collapses consecutive identical update entries
  (same entity+message+actor) so auto-save cannot spam the activity log.
  SAVE_TASK accepts `binTotals` — see the scheduling page for the sold-hours
  model.
- Retirement gate (supabase mode only). After an admin runs the reversible
  handshake in `MigrationStatusPanel` (coverage clean → snapshot read → probe
  write/read/remove → backup downloaded), the org flag `local_writes_retired`
  lands in `public.app_settings` and a per-browser cache marker on the dedicated
  key `n2hub.cloudMigration.v1` (via `storage.ts` helpers, OUTSIDE the planner
  key; `clearData()` never touches it). `src/store/persistGate.ts`
  (`shouldSkipLocalPersist`) then lets a mirrored-only state transition skip the
  per-action `saveData` ONLY while the cache marker is enabled, Supabase env is
  configured and the mirror is verified-healthy right now
  (`setCloudMirrorHealthy`). Any change to a non-mirrored collection, any mirror
  degradation (transient error, hydration failure, sign-out, idle) or local mode
  resumes per-action local writes automatically. While retired, localStorage is
  still refreshed as a passive, never-deleted recovery copy on hydration, queue
  drain, transient error and `pagehide` with pending ops; the same-browser
  storage/conflict protocol keeps firing on every real divergence. A failed save
  never reports `Zapisano`; skipping leaves `saveError` unchanged.

## Rules that change work

- Persisted dates are `yyyy-MM-dd`; use `src/utils/dates.ts`. `''` is allowed
  only for the bin (`BIN_DATE`) workload sentinel.
- Status completion comes from `Status.isDone`, never status order. At least one
  active and one done status must survive all status mutations.
- Task/project writes preserve existing valid behavior. Reducer commands that
  reject input must return the original state reference. This includes
  `MERGE_CLOUD_ENTITIES`: an invalid cloud payload (including an off-grid or
  dangling workload row, or a milestone with a bad date/missing project) returns
  the prior state reference; a valid merge replaces same-id rows, keeps local-only
  rows and reconciles a duplicate bin pair to the cloud-id row with grid-snapped
  summed hours. It never touches people/statuses/savedFilters/lastFilters/
  dictionaries (by reference); workload and milestones ARE now merged.
- SEAMLESS BACKGROUND REFRESH (Realtime). A `postgres_changes` event is only a
  "something changed" signal: `CloudSyncProvider` debounces bursts (1200 ms) into
  ONE full snapshot + `MERGE_CLOUD_ENTITIES`. Three rules keep it invisible:
  (a) the merge is REFERENCE-PRESERVING — a value-identical row keeps its object,
  an unchanged collection keeps its array, and a no-op merge returns the ORIGINAL
  state reference, so view memoization is not invalidated and nothing remounts;
  (b) a BACKGROUND refresh never sets status `hydrating`, so the
  "Wczytywanie danych z serwera…" banner is reserved for initial hydration,
  manual refresh and retry (error/conflict banners are unaffected);
  (c) `src/utils/liveSyncGate.ts` lets a stability-sensitive interaction
  (calendar/bin drag) HOLD the background refresh — it is deferred by
  rescheduling, never dropped, so a merge can never yank the dragged row or
  unmount a component holding pointer capture (invariant 7).
- `SAVE_TASK` reconciles workload by identity-preserving deltas. Do not replace
  all workload rows when editing a task.
- `saveData` reports success or a classified failure. Failed persistence must
  never surface as `Zapisano` and same-browser conflicts must remain explicit.
- Storage loading is fail-closed. A missing key starts with empty data, but
  unavailable, malformed or structurally invalid stored data must reach the
  recovery screen without replacing the raw payload. The user can export that
  payload before resetting it.
- Successful migrations and deterministic repairs are written back once so
  repaired IDs remain stable. A clean current-version load must not echo-write.
- Workload repaired on load still obeys the day boundary and 0.25-hour grid.
  Positive off-grid hours are snapped to the grid; dated rows above 24 hours
  move to the bin instead of being silently truncated. Non-finite, null or
  non-positive stored hours fail closed.

## Start here for

- reducers, validation, activities, statuses, projects, tasks, people;
- localStorage migrations, write failures, tab conflicts and recovery UI;
- selectors, derived planning/completion/overload state.

## Relevant tests

`src/store/activityAttribution.test.ts`, `blockActions.test.ts`,
`commandValidation.test.ts`, `cloudMerge.test.ts`,
`saveTaskWorkload.test.ts`,
`selectors.test.ts`, `statusActions.test.ts`, `storage.test.ts`,
`dateGuards.test.ts`, `taskMeta.test.ts`, `persistGate.test.ts` (retirement
gate), `ticketActions.test.ts` + `ticketsStorage.test.ts` (zgłoszenia: reduktor,
repair, uprawnienia), `draftTasks.test.ts` (szkice: saveTask pomija workload,
PUBLISH_*, wykluczenia selektorów/kanban). Cloud mirror: `src/supabase/cloudMirror.test.ts`, `plannerData.test.ts`,
`migrationStatus.test.ts` (coverage + handshake), `migrations.test.ts`.
Bezszwowe odświeżanie w tle: `cloudMerge.test.ts` (blok „referencje”) +
`src/utils/liveSyncGate.test.ts`.
