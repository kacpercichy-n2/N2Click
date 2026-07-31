# Faza 0 — Audyt bazy N2Hub przed przebudową schema-per-app (2026-07-31)

Projekt: `rclcndcgxbpndpmuemww` (eu-central-1). Stan przed jakimkolwiek DDL.

## 1. Tabele w `public` (22)

activity_events (771), app_settings (0), bingo_lines (5), bingo_marks (54),
clients (11), comments (13), companies (5), departments (5), events (14),
job_titles (1), milestones (0), notifications (0), profiles (9), project_members (0),
projects (25), service_types (0), statuses (4), task_assignments (77), tasks (74),
tickets (34), work_categories (0), workload_entries (143). Wszystkie z RLS enabled.

Podział docelowy: `core` ← profiles, companies; `n2click` ← pozostałe 20.

## 2. Polityki RLS (`public`)

76 polityk. Wzorce:

- Większość dla roli `authenticated`, warunki przez funkcje `app.*`
  (is_administrator, is_manager, manages_project, is_project_member,
  is_assigned_to_task, manages_task, can_view_profile, project_in_company_scope,
  is_department_manager_of, current_department_id, current_access_role).
- Polityki z gołym `using (true)` dla `authenticated` (wymagają gatingu `has_app`):
  app_settings_select, clients_select, companies_select, events_* (wszystkie 4!),
  job_titles_select, notifications_insert, service_types_select, statuses_select,
  work_categories_select.
- **WYJĄTEK: bingo_lines / bingo_marks** — polityki dla `anon, authenticated`
  (celowo, migracja `bingo_harden_realtime_and_rls`; gra działa bez logowania).
  NIE dostają gatingu `has_app` — udokumentowany wyjątek od kryterium odbioru.

## 3. Funkcje

- `public.bingo_today()` — jedyna funkcja w `public`; STABLE, search_path='',
  używana w politykach bingo. → przenieść do `n2click`.
- Schemat `app`: 18 funkcji pomocniczych RLS. 14 z nich SECURITY DEFINER,
  wszystkie z `SET search_path TO ''` i twardymi odwołaniami `public.profiles`,
  `public.tasks`, `public.projects`, `public.project_members`,
  `public.task_assignments`. **Każde odwołanie wymaga przepisania na
  `core.`/`n2click.` po SET SCHEMA.** Triggerowe: set_updated_at,
  protect_profile_privileges, protect_task_project (nie-DEFINER).
  `storage_object_owner` — czysta, bez odwołań do tabel.

## 4. Triggery

- Na tabelach `public`: set_updated_at (13 tabel), protect_profile_privileges
  (profiles), protect_task_project (tasks). Jadą razem z SET SCHEMA; ciała
  funkcji w `app` — bez zmian nazw, tylko odwołania w ciałach.
- **Na `auth.users` NIE MA triggera** (brak klasycznego handle_new_user).
  Profile tworzy wyłącznie Edge Function `provision-account` (service_role,
  INSERT do profiles). Handoff 5.3 pkt 2 → trzeba DODAĆ trigger tworzący
  `core.profiles` przy signupie, bez wpisu w app_access; edge function musi
  przejść na UPSERT, żeby nie kolidować z triggerem (inaczej rollback skasuje
  użytkownika).

## 5. Model spółek w danych

- `profiles.company_id` NOT NULL w danych (0 nulli, 9 profili) → seed
  `core.app_access.company_id` z `profiles.company_id`.
- **Wszystkie 9 profili ma `access_role='administrator'`** → seed roli:
  administrator→'admin' (pozostali dostaliby 'member').
- `projects.company_id`: 24 z 25 wierszy NULL → gating per spółka na projects
  musi przepuszczać NULL (wspólne) + wyjątek dla roli admin, inaczej odcina
  wszystkich. Obecna funkcja `app.project_in_company_scope` już realizuje
  miękki podział przez ludzi projektu.

## 6. Realtime

Publikacja `supabase_realtime`: 20 tabel `public` (wszystkie poza tickets
i project_members). Po SET SCHEMA publikację trzeba przepiąć. Frontend:
`CloudSyncProvider.tsx:370` subskrybuje `postgres_changes` z `schema: 'public'`
→ zmiana na `'n2click'`.

## 7. Storage

Jeden bucket `avatars` (private). 4 polityki na storage.objects używają
`app.is_administrator()`, `app.can_view_profile()`, `app.storage_object_owner()`
— zostają; wymagana tylko poprawka ciał funkcji `app.*`. Konwencja prefiksów
per appka do wprowadzenia przy nowych bucketach.

## 8. Edge Functions

`provision-account` (ACTIVE, verify_jwt). Odwołuje się do `profiles` i
`departments` przez klienta service_role na DOMYŚLNYM schemacie `public` →
po przenosinach wymaga `.schema('core')` (profiles) i `.schema('n2click')`
(departments) + zmiana INSERT→UPSERT profilu (koegzystencja z nowym triggerem).

## 9. Widoki / materialized views

Brak w `public` i `app`.

## 10. Rozszerzenia

pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp.
Brak pg_cron / pg_net — nic do przepinania.

## 11. FK do auth.users

Tylko `public.profiles.id → auth.users(id) ON DELETE CASCADE`. Zostaje bez zmian.

## 12. Typy

Enum `public.access_role` (administrator/manager/worker) — używany przez
profiles i funkcje. → `ALTER TYPE ... SET SCHEMA core` (referencje po OID, bezpieczne).

## 13. Frontend (warstwa Supabase)

- `src/supabase/client.ts` — createClient bez `db.schema` → dodać `'n2click'`.
- Cała warstwa danych (plannerData/dataImport/referenceData/OrgDataProvider)
  używa jednego klienta i nazw tabel bez schematu → pokryte przez `db.schema`.
- `profiles` (7 użyć) i `companies` przejdą przez widoki-mostki
  `n2click.profiles`/`n2click.companies` (security_invoker; proste widoki są
  auto-updatable, więc UPDATE profilu działa).
- `CloudSyncProvider.tsx` — filtr `schema: 'public'` → `'n2click'`.

## 14. Kroki wykonalne wyłącznie z Dashboardu (poza moim zasięgiem)

1. Settings → API → Exposed schemas: dodać `n2click`, `clarity`, `blogoapp`;
   po weryfikacji usunąć `public`. (`core` NIE wystawiać.)
2. Authentication → Hooks → Custom Access Token → `core.custom_access_token`.
3. Upgrade planu na Pro + Spend Cap (decyzja właściciela, niezależna od DDL).

Do czasu wykonania 1–2: aplikacja nie zobaczy danych (PostgREST nie wystawia
`n2click`), a JWT nie ma claimów `app_roles`/`app_company`.

## 15. Backup

Brak dostępu do connection stringa (pg_dump; db push wisi po IPv6 — patrz
pamięć projektu). Zabezpieczenie: automatyczne backupy Supabase + pełny
snapshot definicji (polityki, funkcje, triggery) zapisany w tym raporcie i w
transkrypcie sesji; wszystkie operacje to odwracalne SET SCHEMA + CREATE.

---

## Aneks: wynik weryfikacji adwersaryjnej (Opus 5, 2026-07-31) i poprawki

Werdykt pierwotny: „warunkowo niezgodne". Reakcja na znaleziska:

- **BLOKER 1 (naprawione)** — provision-account v5: `company_id` wywołującego
  admina trafia do UPSERT-u profilu (wcześniej tylko do app_access; rozjazd
  wyłączał scoping spółki dla nowych kont, a protect_profile_privileges
  blokował samodzielną korektę).
- **WAŻNE 2 (naprawione)** — CloudSyncProvider subskrybuje DWA filtry
  postgres_changes na jednym kanale: `n2click` + `core` (profiles/companies są
  w publikacji jako tabele bazowe w core, nie widoki).
- **WAŻNE 3 (naprawione)** — migracja `company_scope_via_relations`:
  `app.company_ok_project/company_ok_task` (claimy; NULL company = wspólne,
  claim admin = wszystko) doklejone do polityk tasks, milestones, comments,
  workload_entries, task_assignments. Odstępstwa udokumentowane: clients (brak
  relacji spółki w modelu), tickets (prywatne per reporter). Test SQL 6/6.
- **WAŻNE 4 (bez zmian, świadomie)** — seed role='admin' dla 9/9 kont wiernie
  odzwierciedla `access_role='administrator'` (kolaps ról 2026-07-22). Test
  „spółka A nie widzi B" wymaga dedykowanych kont testowych.
- **WAŻNE 5 (operacyjne)** — do czasu ustawienia Exposed schemas + włączenia
  hooka appka nie pokaże danych NIKOMU; komunikat do zespołu przed wdrożeniem.
- **WAŻNE 6 (przygotowane)** — `.github/workflows/db-backup.yml`: nocne dumpy
  per schemat jako artefakty (30 dni); aktywacja = sekret repo
  `SUPABASE_DB_URL` (Session pooler, IPv4).
- **DROBNE 7 (odnotowane)** — FK `core.profiles.department_id → n2click.departments`
  wiąże core z N2Click; przeniesienie departments poza zakres handoffu.
- **DROBNE 8 (odnotowane)** — bucket `avatars` bez prefiksu `n2click-`;
  konwencja prefiksów obowiązuje NOWE buckety (handoff 8.6).
- **DROBNE 9, 10 (naprawione)** — revoke anon na widokach tożsamości; default
  privileges w core dla sekwencji/funkcji (service_role).

Advisors po poprawkach: INFO `rls_enabled_no_policy` na core.app_access
(celowe) + pre-existing WARN leaked password protection (przełącznik w
Dashboardzie: Authentication -> Passwords). npm test 2209/2209, build zielony.
