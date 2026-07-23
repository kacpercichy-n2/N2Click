# Cloud database (Supabase)

## Boundaries

- Hosted project: `rclcndcgxbpndpmuemww` (region-default, production alias
  `n2click.vercel.app`). Frontend reaches it only through
  `src/supabase/client.ts` (lazy singleton) with `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_PUBLISHABLE_KEY`; missing/invalid env falls back to local mode
  (`src/auth/mode.ts` `detectAuthMode`, silent by design).
- Schema truth lives in `supabase/migrations/` (forward-only,
  `YYYYMMDDHHMMSS_opis.sql`, applied files are immutable). Applied versions are
  recorded in `supabase_migrations.schema_migrations` on the hosted project.
  `src/supabase/migrations.test.ts` pins the expected file list and the RLS
  deny-by-default convention — a new migration must be added there.
- All authorization lives in SQL (RLS policies + `app.*` SECURITY DEFINER
  helpers + protective triggers). Client-side checks are UX only.

## Tables and relations

- `departments` — dictionary. `profiles.department_id`,
  `projects.department_id` → `on delete set null`.
- `profiles` — 1:1 with `auth.users` (same id, `on delete cascade`). Fields:
  `first_name` (required 1–100), `last_name`, `email`, `role_title`
  (stanowisko), `access_role` (enum `administrator|manager|worker`),
  `department_id`, `company_id` (20260721160000 → `companies.id`,
  `on delete set null`; admin-only via `app.protect_profile_privileges`),
  `avatar_path` (private `avatars` bucket,
  `<profile id>/<file>`), `must_change_password` (UX gate: forced first-login
  password change, self-cleared after a successful change), planner fields
  `phone`, `avatar` (emoji), `capacity` (0–24), `work_days` (smallint[] ⊂ 1–7),
  `work_start_minutes`/`work_end_minutes` (migration
  20260717130000_profiles_planner_fields; hydrated into local people via
  `MERGE_CLOUD_PEOPLE`),
  `supervisor_id` → `profiles.id` (przełożony; nullable, `on delete set null`,
  no self-reference; only administrators may change it — enforced by the
  `app.protect_profile_privileges` trigger, same as `access_role`,
  `department_id` and `company_id`). There is NO auto-provisioning trigger on `auth.users`:
  profiles are created by the provisioning Edge Function or operator SQL.
- `clients` also carries contact columns (`contact_name`, `contact_email`,
  `contact_phone`, `notes`; 20260718090000) and the published tables are in the
  `supabase_realtime` publication (20260718091000) — RLS applies to Realtime
  (WALRUS), clients treat events only as a "something changed" signal.
  `clients.contacts` (20260722130000_client_contacts) — jsonb not null default
  `'[]'`, CHECK `jsonb_typeof(contacts) = 'array'`: DODATKOWE osoby kontaktowe
  (`{id, firstName, lastName, phone, email}`), osadzone jak `projects.documents`
  (20260721010000). Świadomie BEZ tabeli: widoczność osób ≡ widoczność klienta,
  RLS dziedziczy z wiersza `public.clients` — ZERO nowych polityk, `clients` już
  w publikacji realtime (bez zmian). Główna osoba zostaje w kolumnach
  `contact_*` — kolumna trzyma tylko dodatkowe. Mirror `clientRow.contacts =
  c.contacts ?? []`; hydracja `plannerData` sanityzuje przez
  `sanitizeClientContacts` (klucz pomijany dla `[]`/null/zniekształconych).
  Rejestr: `migrations.test.ts` (lista; `EXPECTED_POLICIES` bez zmian).
- `clients`, `statuses`, `service_types`, `work_categories`, `job_titles`
  (20260721150000, słownik „Stanowiska”) — org-wide dictionaries; read by every
  authenticated user, mutations admin-only (clients: insert also manager).
  `job_titles` jest w publikacji `supabase_realtime` (parytet z `departments`),
  mirrorowany jak zwykły słownik (`cloudMirror` piąty wpis `dicts`) i hydrowany
  przez `referenceData.loadOrgSnapshot` → `OrgSnapshot.jobTitles` → App.tsx
  `MERGE_CLOUD_DICTIONARIES`. Rejestr: `migrations.test.ts` (lista +
  `public.job_titles` w `EXPECTED_POLICIES`).
- `companies` (20260721160000, słownik „Spółki”) — org-wide dictionary, ten sam
  wzorzec co `job_titles`: odczyt dla każdego zalogowanego, zapis admin-only,
  w publikacji `supabase_realtime`, mirrorowany jako SZÓSTY wpis `dicts`
  (`cloudMirror`) i hydrowany `loadOrgSnapshot` → `OrgSnapshot.companies` →
  App.tsx `MERGE_CLOUD_DICTIONARIES`. Rejestr: `migrations.test.ts` (lista +
  `public.companies` w `EXPECTED_POLICIES`). Osoba dostaje spółkę przez
  `profiles.company_id` (admin-only). UWAGA (2026-07-22): poniższe zawężanie
  widoczności projektów po spółce jest MARTWĄ GAŁĘZIĄ — po 20260722121000 każdy
  profil ma `access_role=administrator`, więc `projects_select` przepuszcza
  wszystko gałęzią admina; spółka steruje wyłącznie DOMYŚLNYM filtrem widoków
  po stronie klienta. Predykaty zostają w SQL nietknięte (zero ryzyka
  regresji), do ewentualnego sprzątnięcia osobną migracją:
  - `app.current_company_id()` (definer, stable) — spółka zalogowanego (null =
    bez spółki => brak zawężenia);
  - `app.project_in_company_scope(project)` (definer, stable) — true gdy
    użytkownik bez spółki, LUB projekt „neutralny” (żaden członek/przypisany nie
    ma spółki — świeży/nieobsadzony projekt nie znika twórcy), LUB jakiś
    członek/przypisany ma spółkę użytkownika;
  - `projects_select` (przepisana z 20260720190000) = `admin OR
    (project_in_company_scope(id) AND <dotychczasowe warunki nie-admina>)`.
    Predykat jest starym predykatem AND-owanym z zakresem spółki, a zakres ≡
    true przy null — użytkownik bez spółki widzi bajt-w-bajt to co dziś, nikt nie
    zyskuje wiersza. Zawężenie realnie dotyka wyłącznie gałęzi `is_manager()`:
    członek/przypisany ze spółką X sam spełnia zakres X, więc nie traci dostępu.
    ŻADNA inna polityka (tasks/workload) się nie zmienia — zależne wiersze
    ukrytego projektu odpada kaskada hydracji `loadPlannerSnapshot`.
- `projects` → `client_id`, `status_id`, `service_type_id`, `department_id`
  (LEGACY — see below); `project_members (project_id, profile_id)` is the
  explicit worker access list. `tasks` → `project_id` (cascade), `status_id`,
  `work_category_id`, `department_id` (20260720170000 — the department is
  assigned ON THE TASK), `created_by`, `order_index` (20260720200000 — integer
  not null default 0; per-PROJECT manual display rank for the project-detail
  task list, cosmetic — completion/calendar/hours are independent; migration
  backfills 0..n-1 only for projects still all-default, so a re-run never
  clobbers manual order); `task_assignments (task_id, profile_id)`
  is task ownership.
- `tasks.is_draft` (20260721020000_task_is_draft) — boolean not null default
  `false`: szkic zadania (utworzone w projekcie, jeszcze nieopublikowane).
  Domyślnie FALSE, więc każdy istniejący wiersz i wiersz bez jawnej flagi jest
  opublikowany — bez migracji danych/backfillu. Nie tworzy tabeli, więc bez zmian
  RLS/polityk ani publikacji realtime; klient mirroruje ją jak zwykłe pole
  zadania (`cloudMirror.taskRow.is_draft = t.isDraft === true`; hydracja
  `plannerData` czyta `row.is_draft === true`, spoza `true` => opublikowane).
- `tasks.recurrence` (20260721170000_task_recurrence) — jsonb nullable
  (NULL/legacy = brak reguły): cykliczność zadania (RRULE-lite) + per-datowe
  wyjątki, osadzona jak `tasks.checklist`/`tasks.draft_hours`. Kształt kanoniczny:
  `{ daysOfWeek:[1..7], startMinutes, durationMinutes, until?, overrides? }`;
  wyjątki niosą TYLKO daty/minuty — żadnych id profili, więc bez mapowania id.
  Świadomie BEZ osobnej tabeli: widoczność ma być identyczna z widocznością
  zadania, więc RLS dziedziczy się z wiersza `public.tasks` — ZERO nowych polityk,
  bez zmian w publikacji realtime. Klient mirroruje ją jak zwykłe pole
  (`cloudMirror.taskRow.recurrence = t.recurrence ?? null`), a hydracja
  `plannerData` kanonikalizuje przez `normalizeRecurrence` WYŁĄCZNIE dla wierszy
  opublikowanych (`is_draft !== true`). Rejestr: `migrations.test.ts` (lista;
  `EXPECTED_POLICIES` bez zmian).
- `projects.documents` (20260721010000) — jsonb not null default `'[]'`, CHECK
  `jsonb_typeof(documents) = 'array'`: odnośniki do dokumentów handlowych
  (`{id, kind: oferta|wycena|brief|link, label, url}`). Kolumna osadzona jak
  `tasks.checklist` — świadomie BEZ tabeli `project_documents`: widoczność ma
  być identyczna z widocznością projektu, więc RLS dziedziczy się z wiersza
  `public.projects` i migracja nie dodaje ani jednej polityki. To WYŁĄCZNIE
  adresy — Supabase Storage nie jest tu używany (żadnych plików). Wiersze są
  współdzielone, więc `url` musi mieć schemat `http:`/`https:` — klient wymusza
  to przy zapisie, przy wczytaniu i przy renderowaniu `href`
  (`src/utils/projectDocuments.ts` → `normalizeProjectDocumentUrl`); kolumna nie
  waliduje treści wpisów poza kształtem tablicy.
- Project departments are DERIVED: the unique set of its tasks' departments
  (client: `selectors.departmentsOfProject`, fallback to the legacy
  `projects.department_id` when no task has one). A project may span several
  departments; the project form no longer edits a department.
- `workload_entries` — planned hours; `task_id` + `profile_id` cascade,
  `work_date NULL` = bin sentinel (unique partial index per
  `(task_id, profile_id)`), grid CHECKs (0.25h, 15-minute starts, day
  boundary). `workload_entries.done` (20260721220000_workload_entry_done) —
  boolean not null default `false`: per-BLOK znacznik „wykonane” (niezależny od
  `tasks.status_id`). DEFAULT FALSE, więc każdy istniejący/legacy wiersz jest
  niewykonany — bez backfillu. Nie tworzy tabeli: RLS dziedziczy z istniejących
  polityk `workload_entries_*` (ZERO nowych polityk), tabela już w publikacji
  realtime. Mirror `workloadRow.done = w.done === true`; hydracja `plannerData`
  czyta `row.done === true`. Rejestr: `migrations.test.ts` (lista;
  `EXPECTED_POLICIES` bez zmian). `milestones` → `project_id`. `comments` and `activity_events`
  are append-only (no UPDATE/DELETE policies). `app_settings` — org runtime
  flags (`local_writes_retired`).
- `tickets` (20260720230000) — zgłoszenia zespołu („Zgłoszenia”), SAMODZIELNA
  tabela bez powiązań z projektami/zadaniami: `title`, `area`, `description`,
  `kind` (blad|usprawnienie|nowa-funkcja|inne), `priority` (niski|sredni|wysoki),
  `status` (nowe|w-trakcie|zrobione|odrzucone) — wszystkie trzy jako CHECK-i, nie
  typy enum — oraz `reporter_id` → `profiles.id` (`on delete cascade`) i
  `created_at`/`updated_at` (trigger `app.set_updated_at`). RLS: INSERT dla
  KAŻDEGO zalogowanego, ale wyłącznie `reporter_id = auth.uid()`; SELECT własne
  wiersze lub `app.is_administrator()`; UPDATE administrator albo zgłaszający
  dopóki status = 'nowe' (using + with check); DELETE wyłącznie administrator.
  Tabela NIE jest w publikacji realtime — zmiany zgłoszeń nie wyzwalają
  live-syncu, lista odświeża się przy hydracji.
- `events` (20260721210000) — wydarzenia / spotkania kalendarza („Wydarzenia”),
  SAMODZIELNA tabela bez powiązań z projektami/zadaniami: `title` (CHECK 1..300),
  `description`, `location`, `meeting_url` (CHECK ≤2048), `event_date`,
  `start_minutes` (CHECK 0..1425, %15), `duration_minutes` (CHECK 15..1440, %15),
  CHECK `start_minutes + duration_minutes <= 1440`, `attendee_ids uuid[]`
  (BEZ FK — czyszczenie danglingów po stronie klienta), `recurrence jsonb`
  (nullable, forma kanoniczna wydarzenia), `created_at`/`updated_at` (trigger
  `app.set_updated_at`), index na `event_date`. RLS: kalendarz spotkań jest
  OGÓLNOFIRMOWY, więc WSZYSTKIE polityki (`events_select/insert/update/delete`)
  są `to authenticated` z `using (true)` / `with check (true)`. UZASADNIENIE:
  lokalna rola `handlowiec` mapuje się w chmurze na `worker`, więc bramka po
  `app.is_manager()` odcięłaby handlowca, który umawia spotkania — bramka
  `events.manage` pozostaje UX-em po stronie klienta (jak cały system uprawnień).
  Tabela JEST w publikacji `supabase_realtime` (idempotentny blok `do $$ …
  exception when duplicate_object`) — kalendarze odświeżają się live. Mirror:
  dziesiąta rodzina (`eventRow` + diff po id → `public.events`, attendee mapowany
  per-id, niemapowalny odpada); hydracja filtruje dangling uczestnika per-wiersz.
  Rejestr: plik w liście migracji + `public.events` w `EXPECTED_POLICIES`
  (`migrations.test.ts`).
- `projects.company_id` (20260722120000, spółka WYKONAWCZA projektu) — FK →
  `companies.id`, `on delete set null`, nullable; ZERO zmian polityk RLS i
  publikacji realtime (projects już tam jest). Mirror: `cloudMirror.projectRow`
  pisze lokalne id słownika (`'' → NULL` — companies mirrorują się po id, jak
  `profiles.company_id`); hydracja `plannerData` czyta NULL/brak kolumny jako
  `''`. Jednorazowy `dataImport` celowo NIE niesie kolumny (nullable). Rejestr:
  `migrations.test.ts` (lista; `EXPECTED_POLICIES` bez zmian).
- KOLAPS RÓL (20260722121000_full_access_for_all_profiles) — migracja DANYCH:
  wszystkie profile dostają `access_role='administrator'` (decyzja 2026-07-22:
  każdy pracownik ma pełne uprawnienia; lokalny model to `pelne`↔administrator,
  `ograniczone`↔worker — patrz state-and-persistence). Enum i polityki RLS
  NIETKNIĘTE (manager/worker zostają jako reprezentacja kont „ograniczonych”);
  trigger `app.protect_profile_privileges` przepuszcza operatora
  (`auth.uid() IS NULL`). Provisioning nowych kont domyślnie `administrator`
  (frontend `teamScope.emptyProvisionForm`). Opisany niżej model
  manager/worker obowiązuje więc tylko dla przyszłych kont „ograniczonych”.
- `notifications` (20260723120000) — powiadomienia in-app, SAMODZIELNA tabela
  per-użytkownik: `recipient_id` → `profiles.id` (`on delete cascade`), `type`
  (text, CHECK 1..100), `payload` (jsonb default `'{}'` — np. taskId/projectId/
  commentId/actorId), `read_at` (timestamptz null = nieprzeczytane), `created_at`.
  RLS PER-UŻYTKOWNIK: SELECT/UPDATE wyłącznie własnych wierszy
  (`recipient_id = auth.uid()`; UPDATE służy TYLKO oznaczeniu `read_at`, with
  check pilnuje odbiorcy), INSERT dla KAŻDEGO zalogowanego (`with check (true)`)
  — inaczej niż tickets, bo zdarzenia generuje klient DZIAŁAJĄCEGO użytkownika
  W IMIENIU innych odbiorców; widoczność chroni SELECT. BEZ polityki DELETE.
  Tabela JEST w publikacji `supabase_realtime` (świeże powiadomienie odbiorcy
  pojawia się live; WALRUS respektuje RLS). Rozszerzenie WYŁĄCZNIE addytywne —
  zero zmian w istniejących tabelach. Hydracja przez OSOBNY, degradujący się
  loader (`loadNotificationsSnapshot` — zwraca `{available}`: brak tabeli
  (42P01/PGRST205) => `available` z pustą listą (autorytatywna podmiana), błąd
  PRZEJŚCIOWY => `available:false`, wołający POMIJA dispatch
  `MERGE_CLOUD_NOTIFICATIONS` i ZOSTAWIA poprzedni panel (nie miga pustką); nie
  blokuje reszty syncu); mirror lustruje WYŁĄCZNIE `read_at` (UPDATE),
  wstawienia idą warstwą zdarzeń (`notificationEvents`, nie diff). Rejestr:
  `migrations.test.ts` (lista + `public.notifications` w `EXPECTED_POLICIES` =
  `['select','insert','update']`).
- `notifications.emailed_at` (20260723130000, ADDYTYWNA kolumna `timestamptz
  null` + częściowy indeks `where emailed_at is null`) + `profiles.
  email_notifications` (20260723131000, `boolean not null default false`) —
  opcjonalne dublowanie powiadomień in-app MAILEM. Druga Edge Function
  `send-notification-emails` (czysty `contract.ts` + `index.ts` w Deno, wzorzec
  jak `provision-account`) wybiera wsad `emailed_at is null` (limit 50), grupuje
  per odbiorca, pomija opt-out (`email_notifications = false`, DOMYŚLNIE) i bez
  adresu. CLAIM-BEFORE-SEND: JEDNYM UPDATE-em stempluje `emailed_at` (where
  `emailed_at is null`, `.select()` zwraca REALNIE zaklaśnięte wiersze) PRZED
  wysyłką, i dopiero zaklaśnięte wiersze idą jednym polskim mailem zbiorczym
  (Resend, czysty `fetch`). Porażka wysyłki po zaklaśnięciu = najwyżej brak
  jednego maila, NIGDY zbiorczy duplikat; nakładające się cykle dostają rozłączne
  podzbiory. Bez sekretów
  (`RESEND_API_KEY`/`NOTIFY_FROM_EMAIL`) — czysty no-op. Wołanie CYKLICZNE to
  krok operatora (cron ~5 min), nie kod aplikacji. Preferencja round-trip przez
  model profilu jak `birth_date`: `Person.emailNotifications?` (opcjonalne, brak
  => false) ↔ `profiles.email_notifications` (mirror UPDATE / hydracja
  `referenceData`), edytowalna w profilu (`profileEditPolicy` SELF/ALL). Logika
  selekcji/treści testowana w repo (`src/supabase/notificationEmails.test.ts`:
  opt-out + no-op bez sekretów). Rejestr: oba pliki w liście `migrations.test.ts`
  (ALTER-y, bez nowych polityk).
- Access model: administrator = everything; manager = own department
  (profiles incl. UPDATE of non-admin members, memberships/assignments
  restricted to own-department people) — and since 20260720170000 the manager
  scope FOLLOWS TASK DEPARTMENTS: `app.manages_task` also matches the task's
  own `department_id`, tasks_* policies admit the task-department manager,
  projects select/update admit a manager with a task of their department in
  the project (`app.manages_any_task_in_project`), and projects_insert admits
  any manager (projects are no longer department-owned); worker = own profile
  (read + self-UPDATE), member projects (read), projects of tasks assigned to
  them (read, `app.has_assignment_in_project` — 20260720150000; without it
  client hydration cascade-dropped the task and its workload rows), assigned
  tasks (read/update), own workload rows.
- Profile edits mirror as UPDATE, never upsert: `INSERT ... ON CONFLICT`
  must pass the admin-only INSERT policy even when it resolves to an update,
  which rejected every non-admin self-edit. `PlannerDb.update` classifies an
  RLS-silenced 0-row UPDATE as `permission` (no false „Zapisano”).

## Rules that change work

- New tables/columns arrive ONLY via a new forward-only migration file +
  registry insert + `migrations.test.ts` list update; never edit applied files.
- Every new table: enable RLS in the same file, `revoke all ... from anon`,
  policies `to authenticated` with `with check`, no
  `force row level security` (definer-helper recursion).
- `anon` (publishable) key has no data access — everything requires an
  authenticated session; the key is safe to expose in the client bundle.
- Cloud reads/writes go through the injected-adapter pure modules
  (`src/supabase/referenceData.ts`, `plannerData.ts`, `cloudMirror.ts`,
  `dataImport.ts`) — never raw SDK calls scattered in components (thin page
  wiring like TeamPage supervisor update is the exception and must rely on RLS
  for the real guarantee).

## Relevant tests

`src/supabase/migrations.test.ts` (file list + RLS conventions),
`referenceData.test.ts` (org snapshot mapping incl. `supervisor_id`),
`plannerData.test.ts`, `cloudMirror.test.ts`, `dataImport.test.ts`,
`migrationStatus.test.ts`, `src/auth/session.test.ts`,
`passwordChange.test.ts` (forced-change flow), `src/store/persistGate.test.ts`.
Zgłoszenia: `src/pages/ticketsExport.test.ts` (format CSV) oraz wpis
`public.tickets` w `EXPECTED_POLICIES` w `migrations.test.ts`.
Dokumenty projektu: `src/store/projectDocuments.test.ts` (reduktor, repair
wczytania i round-trip mirror → snapshot kolumny `projects.documents`).
