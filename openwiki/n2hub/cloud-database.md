# Cloud database (Supabase)

## Schema-per-app (2026-07-31, handoff n2hub-db-restructure)

- Jeden projekt Supabase hostuje wiele aplikacji rozdzielonych SCHEMATAMI:
  `core` (tożsamość: `profiles`, `companies`, `app_access` + hook JWT
  `core.custom_access_token`), `n2click` (20 tabel domenowych + bingo),
  `clarity` i `blogoapp` (puste, przygotowane pod migracje innych appek),
  `public` (puste, nic tam nie tworzyć). Enum `access_role` żyje w `core`.
- Klient wybiera schemat na połączeniu: `createClient(..., { db: { schema:
  'n2click' } })` w `src/supabase/client.ts`; realtime w `CloudSyncProvider`
  nasłuchuje DWÓCH schematów — `n2click` i `core` — bo `profiles`/`companies`
  są w publikacji jako tabele bazowe, a widok-mostek nie emituje zdarzeń.
  Nazwy tabel w kodzie się nie zmieniają.
- `core` NIE jest wystawiony w PostgREST — appka czyta/pisze tożsamość przez
  widoki-mostki `n2click.profiles`, `n2click.companies` (security_invoker,
  auto-updatable, wspierają nawet upsert ON CONFLICT) oraz `n2click.app_access`
  (tylko service_role). Exposed schemas (Dashboard, USTAWIONE 2026-07-31):
  `graphql_public`, `n2click`, `clarity`, `blogoapp` — bez `core` i bez
  `public`. `graphql_public` to platformowy domyślny endpoint GraphQL, nie
  schemat aplikacji. W panelu „Exposed tables" tabele `n2click` świecą się
  na pomarańczowo („custom grants") — to nasze zawężone granty z migracji,
  NIE klikać ich, bo kliknięcie nadpisuje je szerokimi domyślnymi.
- Dostępu do appki NIE daje samo konto: wpis `core.app_access(user_id, app,
  role, company_id)` → claimy `app_roles`/`app_company` w JWT (hook Custom
  Access Token → `core.custom_access_token`, WŁĄCZONY 2026-07-31) → każda
  polityka RLS n2click/core wymaga
  `core.has_app('n2click')` (wyjątek: bingo_lines/bingo_marks — gra anon).
  Trigger `on_auth_user_created` tworzy profil w `core` przy signupie, ale ZERO
  wpisów w `app_access`.
- Funkcje pomocnicze `app.*` odwołują się do `core.*`/`n2click.*` — nowa
  funkcja definer NIE może używać `public.*`.

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

UWAGA CZYTELNIKU: wszystkie tabele domenowe opisane niżej żyją od 2026-07-31 w
schemacie `n2click`, a `profiles`/`companies` w `core` (w `n2click` są jako
widoki-mostki). Gdzie w tekście pada `public.<tabela>` w kontekście
`EXPECTED_POLICIES`, to HISTORYCZNY klucz testu — nie lokalizacja tabeli.

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
  `MERGE_CLOUD_PEOPLE`), `birth_date` (20260721030000),
  `notifications_seen_at` (20260723120000_profiles_notifications_seen —
  watermark „przeczytane" feedu powiadomień Panelu; owner/admin-editable, poza
  `protect_profile_privileges`. Scalenie `applyCloudPeople` bierze PÓŹNIEJSZY z
  lokalnego i chmurowego znacznika — watermark jest MONOTONICZNY, przeczytane
  nie cofa się przy wyścigu urządzeń),
  `notifications_read_ids` (20260803100000_profiles_notifications_read_ids —
  `text[] not null default '{}'`: przeczytane PER WPIS pochodnego feedu, id
  postaci `mention:<commentId>` / `assignment:<assignmentId>`. Wpis jest
  przeczytany gdy `created_at <= notifications_seen_at` LUB jego id jest w tej
  tablicy. Scalenie robi UNIĘ lokalnego i chmurowego zbioru — monotonicznie, jak
  watermark; zbiorcze „Oznacz jako przeczytane" bije watermark i CZYŚCI tablicę.
  Poza `protect_profile_privileges`, bez zmian RLS. UWAGA: `n2click.profiles` to
  widok `select *` zamrożony przy tworzeniu, więc migracja ODTWARZA go
  (`create or replace view`, granty zachowane) — inaczej PostgREST nie wystawi
  nowej kolumny),
  `supervisor_id` → `profiles.id` (przełożony; nullable, `on delete set null`,
  no self-reference; only administrators may change it — enforced by the
  `app.protect_profile_privileges` trigger, same as `access_role`,
  `department_id` and `company_id`). Od 20260731082129 trigger
  `on_auth_user_created` (→ `core.handle_new_user`) tworzy SZKIELET profilu w
  `core.profiles` przy każdym signupie (bez wpisu w `core.app_access`);
  Edge Function `provision-account` robi UPSERT pełnych danych po utworzeniu
  konta i nadaje `app_access(app='n2click')` ze spółką wywołującego admina.
- `clients` also carries contact columns (`contact_name`, `contact_email`,
  `contact_phone`, `notes`; 20260718090000) and the published tables are in the
  `supabase_realtime` publication (20260718091000) — RLS applies to Realtime
  (WALRUS), clients treat events only as a "something changed" signal.
  `clients.contacts` (20260722130000_client_contacts) — jsonb not null default
  `'[]'`, CHECK `jsonb_typeof(contacts) = 'array'`: DODATKOWE osoby kontaktowe
  (`{id, firstName, lastName, phone, email}`), osadzone jak `projects.documents`
  (20260721010000). Świadomie BEZ tabeli: widoczność osób ≡ widoczność klienta,
  RLS dziedziczy z wiersza `n2click.clients` — ZERO nowych polityk, `clients` już
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
- `tasks.created_by` (kolumna istniała od core; OŻYWIONA
  20260723130000_tasks_created_by_default_backfill) — autor zadania (FK
  `profiles.id`), STRUKTURALNY sygnał dla feedu powiadomień („X przypisał(a) Ci
  zadanie"), czystszy niż parsowanie treści „utworzył(a) …" z activity log.
  Wcześniej NULL na wszystkich wierszach; migracja nadaje `default auth.uid()`
  (mirror CELOWO pomija kolumnę w `taskRow`, więc serwer wypełnia autora =
  zalogowany twórca; polityki tasks nie odwołują się do `created_by`, więc
  default jest bezpieczny) i backfilluje historię z najstarszego zdarzenia
  „utworzył%". Reduktor stempluje `Task.createdBy = currentUserId` przy tworzeniu
  (offline + natychmiastowy stan); hydracja `plannerData` czyta `row.created_by`
  przez `personOf` (niemapowalny/NULL => brak klucza). Selektor
  `notificationsForPerson` używa `task.createdBy`, fallback: activity log.
  UWAGA: dormant `n2click.notifications` + `profiles.email_notifications` +
  `notifications.emailed_at` NIE są podpięte — feed jest kliencko-pochodny
  (świadoma decyzja; e-mail poza zakresem). Patrz pamięć
  „dormant-cloud-notifications-infra".
- `tasks.recurrence` (20260721170000_task_recurrence) — jsonb nullable
  (NULL/legacy = brak reguły): cykliczność zadania (RRULE-lite) + per-datowe
  wyjątki, osadzona jak `tasks.checklist`/`tasks.draft_hours`. Kształt kanoniczny:
  `{ daysOfWeek:[1..7], startMinutes, durationMinutes, intervalWeeks?, until?,
  overrides? }` (`intervalWeeks` = „co X tygodni", klucz TYLKO dla całkowitych
  2..8, brak ≡ 1; zła wartość w kolumnie NIGDY nie unieważnia reguły — hydracja
  czyta ją jako cotygodniową);
  wyjątki niosą TYLKO daty/minuty — żadnych id profili, więc bez mapowania id.
  Świadomie BEZ osobnej tabeli: widoczność ma być identyczna z widocznością
  zadania, więc RLS dziedziczy się z wiersza `n2click.tasks` — ZERO nowych polityk,
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
  `n2click.projects` i migracja nie dodaje ani jednej polityki. To WYŁĄCZNIE
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
  dziesiąta rodzina (`eventRow` + diff po id → `n2click.events`, attendee mapowany
  per-id, niemapowalny odpada); hydracja filtruje dangling uczestnika per-wiersz.
  Rejestr: plik w liście migracji + `public.events` w `EXPECTED_POLICIES`
  (`migrations.test.ts`).
- `events.kind` / `events.end_date` (20260803120000, WYDARZENIA URLOPOWE) —
  `kind text not null default 'meeting'` z CHECK `in ('meeting','urlop')` oraz
  `end_date date` z CHECK `end_date is null or end_date >= event_date`, obie na
  `n2click.events`. Urlop to wydarzenie PEŁNODNIOWE (`start_minutes` 0,
  `duration_minutes` 1440 — mieści się w istniejących CHECK-ach), `end_date` =
  koniec zakresu (NULL = jeden dzień). ZERO zmian RLS i publikacji realtime.
  Mirror pisze oba pola ZAWSZE (`kind: e.kind ?? 'meeting'`,
  `end_date: e.endDate ?? null`); hydracja jest ŁAGODNA per-pole (nieznany
  `kind` ⇒ spotkanie, złe `end_date` ⇒ brak klucza, NIGDY fail-close ładunku —
  parytet z `intervalWeeks`), a `mergeCloudEntities` fail-closuje tylko na
  strukturalnie złym polu. Migracja NIE jest zaaplikowana — to krok operatora
  PRZED wdrożeniem klienta (select hydracji nazywa kolumny wprost).
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
- SCHEMAT `contentplan` (20260803160000 + polityki 160100, widok 160200, seedy
  160300/170000) — moduł Content Plan „żyje z boku”, jak blogoapp/bingo: tabele
  `brands`, `posts`, `post_channels`, `comments`, `post_history`,
  `drive_folders`; RLS na każdej, granty tylko na używane verby (`comments` i
  `post_history` BEZ update/delete = dopisywalne), `brands.n2click_client_id`
  bez FK między schematami. KROK OPERATORA: `contentplan` musi być w Exposed
  schemas (Dashboard) — bez tego PostgREST odpowiada PGRST205 i moduł działa
  wyłącznie lokalnie.
  KLIENT (faza R8, 2026-08-03): główny `createClient` zostaje przypięty do
  `n2click`, a moduł dostaje DRUGI ADAPTER na tym samym kliencie —
  `createSupabaseContentPlanDb` = `createSupabasePlannerDb(client.schema('contentplan'))`
  (żadnego drugiego `createClient`; ta sama decyzja co `contentplan/driveFolders`).
  Lustro: `diffContentPlanToCloudOps` (osobna rodzina, bez `CloudIdMaps` — moduł
  nie mapuje osób) emituje opsy ze znacznikiem `schema: 'contentplan'`, a
  `applyCloudOps(db, ops, { contentplan: cpDb })` kieruje je do właściwego
  adaptera (brak adaptera => cichy drop, NIGDY zapis do `n2click`). Kolejność:
  marki → publikacje → kanały → komentarze → historia; komentarze i historia są
  DOPISYWALNE (tylko nowe id), a wiersze zależne od usuniętej publikacji/marki
  sprząta kaskada FK (zero własnych `remove`). Id `uuid`: marka utworzona
  lokalnie nosi SLUG (`uniqueBrandId`), więc NIE jedzie do chmury (diagnostyka)
  razem ze swoimi publikacjami — dopiero hydracja daje jej id chmury. Tagi:
  lokalny string ↔ `text[]` przez `splitContentPlanTags`/`joinContentPlanTags`.
  Hydracja: `loadContentPlanSnapshot` (osobny, degradujący się loader) składa
  pięć tabel w zagnieżdżony kształt lokalny i przepuszcza go przez łagodne
  `sanitizeContentPlan*`; brak schematu/tabel (42P01/PGRST205) => `available`
  z PUSTYMI kolekcjami (podmiana autorytatywna), błąd przejściowy => `available:
  false` (poprzedni stan zostaje). Zapis w martwym schemacie jest cicho
  porzucany (`isMissingCloudTable`), żeby JEDEN taki op nie zamroził kolejki
  planera. REALTIME: świadomie POMINIĘTY w tej fazie — kanał słucha wyłącznie
  `n2click` i `core`; subskrypcja modułu musiałaby literalnie podać schemat
  `contentplan` (`db.schema` nie jest dziedziczone). Rejestr: pliki migracji w
  `migrations.test.ts`; testy klienta: `cloudMirror.test.ts` (rodzina diff +
  routing schematu w `applyCloudOps`), `plannerData.test.ts`
  (`loadContentPlanSnapshot` + degradacja + adapter).
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
  Nowe tabele N2Click tworzy się w schemacie `n2click` (współdzielona tożsamość
  wyłącznie w `core`); klucze `EXPECTED_POLICIES` w `migrations.test.ts` zostają
  `public.*` HISTORYCZNIE — test parsuje statyczny tekst starych migracji, nie
  żywą bazę.
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
