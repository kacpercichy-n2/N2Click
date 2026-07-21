# Raport workflow: 20260721-150911-243-companies-scoping-and-visibility

## Wykonane

Workflow tier: `architect → developer → reviewer` (ryzyko: high, zmiana wrażliwa
na bezpieczeństwo — RLS). Weryfikacja wstępna: pojęcie spółki nie istniało w
buildzie (brak `Company`/`companyId` w `src/types.ts`, brak migracji companies)
— zadanie było aktualne i zostało zrealizowane w całości.

Pakiet architekta: `handoffs/packages/companies-scoping.md`
(PKG-20260721-companies-scoping). Kluczowa decyzja projektowa: spółka działa
wyłącznie **zawężająco** — `visible = dotychczasowe warunki AND zakres spółki`,
a zakres spółki jest spełniony automatycznie dla użytkownika bez spółki.

1. **Model lokalny** (wzór: słownik stanowisk z zadania 242): encja
   `Company { id, name }`, kolekcja `AppData.companies`, `Person.companyId?`
   (opcjonalne, repair do `''`). Akcje `ADD_COMPANY` / `RENAME_COMPANY` /
   `DELETE_COMPANY` z pełną walidacją (invariant 6 — nieprawidłowa komenda
   zwraca tę samą referencję stanu; duplikaty case-insensitive pl-PL;
   `DELETE_COMPANY` kaskadowo czyści `companyId` osób). Storage repair:
   `emptyData`, `coerceArray`, `migratePerson`; seed; `persistGate`
   (`NON_MIRRORED_KEYS` += `companies`). `DATA_VERSION` bez zmian (7).
2. **Chmura**: `referenceData.ts` (`CloudProfile.companyId`, `company_id` w
   select profili, `companies` w atomowym `loadOrgSnapshot`,
   `buildCloudPeoplePayload`), `cloudMirror.ts` (szósty wpis słowników
   `companies`/„Spółka”, `company_id` w wierszu UPDATE profilu), `App.tsx`
   (dispatch słowników), rozszerzenia `MERGE_CLOUD_DICTIONARIES` (autorytatywna
   podmiana, walidacja fail-closed) i `MERGE_CLOUD_PEOPLE` (`companyId`).
3. **Migracja** `supabase/migrations/20260721160000_companies.sql`
   (forward-only, idempotentna; żaden zastosowany plik migracji nie został
   zmieniony): tabela `public.companies` z RLS (select: wszyscy zalogowani;
   insert/update/delete: tylko admin), kolumna `profiles.company_id`
   (FK `on delete set null`, indeks), funkcje `app.current_company_id()` i
   `app.project_in_company_scope(uuid)` (obie `stable security definer`,
   `set search_path = ''`, revoke z public + grant execute do authenticated),
   rozszerzony trigger `app.protect_profile_privileges` (spółkę zmienia tylko
   admin), publikacja realtime, oraz podmieniona polityka `projects_select`.
4. **Dokładna zmiana polityki `projects_select`** (baza: wersja z
   `20260720190000_manager_task_management.sql`):
   `app.is_administrator() OR (app.project_in_company_scope(id) AND
   (app.is_manager() OR app.is_project_member(id) OR
   app.has_assignment_in_project(id)))`. Gałąź nie-admina to dokładnie
   dotychczasowy warunek **AND** zakres spółki — konstrukcyjnie nie może
   poszerzyć widoczności. Semantyka zakresu: projekt jest „w spółce X”, gdy
   któryś członek projektu lub osoba przypisana do jego zadań ma spółkę X;
   projekt bez osób ze spółką jest widoczny jak dziś (świeżo utworzony projekt
   nie znika twórcy); użytkownik bez spółki => zakres zawsze spełniony
   (widoczność bajt-w-bajt identyczna z dzisiejszą). Zawężenie realnie dotyka
   tylko gałęzi `is_manager()` — członek/przypisany sam spełnia zakres swojej
   spółki, więc nie może stracić dostępu.
5. **UI (PL)**: sekcja „Spółki” (CRUD) w `AdminPage.tsx` za `admin.panel`
   (po „Działach”, plus lista „Spółki” w bloku słowników w chmurze), select
   „Spółka” w `PersonProfilePage.tsx` obok „Działu”; pole `companyId` w
   `profileEditPolicy` wyłącznie w `ALL_FIELDS` (edycja tylko admin — spójnie
   z triggerem po stronie bazy).
6. **Testy**: nowy `src/store/companies.test.ts` (CRUD, invariant 6, kaskada
   DELETE, blok companies w MERGE_CLOUD_DICTIONARIES) + aktualizacje:
   `migrations.test.ts` (rejestr plików + `EXPECTED_POLICIES` dla
   `public.companies`), `storage`, `cloudMerge`, `referenceData`,
   `cloudMirror`, `plannerData`, `migrationStatus`, `profileEditPolicy` i
   fixtures PersonDraft/CloudProfile.
7. **Wiki updated**: `cloud-database.md` (tabela, kolumna, funkcje, semantyka
   zawężania `projects_select`), `state-and-persistence.md` (akapit SPÓŁKI),
   `ui-navigation-and-onboarding.md` (pole „Spółka” w macierzy edycji profilu).

Review (agent reviewer, read-only) wykrył i zablokował realną regresję
bezpieczeństwa: pierwotny `create or replace` triggera
`app.protect_profile_privileges` gubił strażnika `supervisor_id`
(z `20260717110000_profiles_supervisor.sql`). Poprawione w nowym pliku
migracji (guard `supervisor_id` przywrócony, komunikat wyjątku rozszerzony o
„przełożonego”); ta sama luka była w „exact SQL” pakietu architekta — świadome,
udokumentowane odstępstwo. Po poprawce reviewer zweryfikował ponownie i wydał
werdykt **approve** (trigger jest ścisłym nadzbiorem poprzednich strażników).

## Zmiany

- Nowe: `supabase/migrations/20260721160000_companies.sql`,
  `src/store/companies.test.ts`, pakiet `handoffs/packages/companies-scoping.md`.
- Zmodyfikowane: `src/types.ts`, `src/store/AppStore.tsx`,
  `src/store/storage.ts`, `src/store/seed.ts`, `src/store/persistGate.ts`,
  `src/supabase/referenceData.ts`, `src/supabase/cloudMirror.ts`, `src/App.tsx`,
  `src/pages/profileEditPolicy.ts`, `src/pages/PersonProfilePage.tsx`,
  `src/pages/AdminPage.tsx`, `src/pages/PeoplePage.tsx`, testy wymienione wyżej
  oraz trzy strony wiki.

## Weryfikacja

- Focused vitest (companies, storage, cloudMerge, migrations, referenceData,
  cloudMirror, plannerData, migrationStatus, profileEditPolicy): **337 passed**.
- Pełne `npm test`: **1190 passed (44 pliki)** — zielone.
- `npm run build`: **zielone**; `npx tsc --noEmit`: czysto.
- Brak wycieku widoczności między spółkami — zweryfikowano strukturalnie
  (reviewer): nowa polityka to stary warunek AND-owany z zakresem spółki
  (nie da się nią zyskać wiersza niewidocznego dziś), `project_in_company_scope`
  zwraca `true` dla użytkownika bez spółki (zachowanie identyczne), a
  `company_id` w profilu może zmienić wyłącznie admin (trigger), więc użytkownik
  nie może sam sobie zdjąć zawężenia. Skalowanie po działach/managerach na
  pozostałych tabelach nietknięte.
- `npm test` / `npm run build` gate: oczekuje na scheduler (lokalnie oba zielone).

## Ryzyka / rzeczy do sprawdzenia

- Migracja **nie została zastosowana** na hostowanym projekcie Supabase — krok
  operatora (wg pamięci projektu: MCP `apply_migration` za zgodą usera; `db push`
  wisi na IPv6). Do czasu aplikacji zawężanie po spółkach nie działa w chmurze.
- Świadome ograniczenie zakresu (decyzja pakietu): zawężenie dotyczy tylko
  `projects_select`. Manager ze spółką może nadal odczytać surowe wiersze
  `tasks` innych projektów przez bezpośrednie API (klient i tak je odrzuca
  kaskadą hydracji). Ewentualne zawężenie `tasks_select` — osobne zadanie.
- Odłożone (nie-gate'ujące): kryterium spółki w ujednoliconych filtrach
  (zadanie 240) — oddzielna funkcja addytywna.
- Codex review (`required` wg pakietu) uruchamia scheduler po zakończeniu tego
  procesu — werdykt reviewera nie adjudykuje artefaktu Codex (nie istniał w
  sesji).

## Podpis schedulera

- Run: `20260721-150911-243-companies-scoping-and-visibility`
- Prompt: `243-companies-scoping-and-visibility.md`
- Gałąź review: `review-integration`
- Baza: `a433715bb4eaaee161ba6a675fb5d27a71b6e9e2`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `a433715bb4eaaee161ba6a675fb5d27a71b6e9e2`
- Gałąź review: `review-integration`
- Run: `20260721-150911-243-companies-scoping-and-visibility`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/auth/session.test.ts`
- `src/pages/AdminPage.tsx`
- `src/pages/PeoplePage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/profileEditPolicy.test.ts`
- `src/pages/profileEditPolicy.ts`
- `src/pages/teamScope.test.ts`
- `src/store/AppStore.tsx`
- `src/store/activityAttribution.test.ts`
- `src/store/blockActions.test.ts`
- `src/store/cloudMerge.test.ts`
- `src/store/commandValidation.test.ts`
- `src/store/dateGuards.test.ts`
- `src/store/draftTasks.test.ts`
- `src/store/exportDryRun.test.ts`
- `src/store/jobTitles.test.ts`
- `src/store/permissions.test.ts`
- `src/store/persistGate.ts`
- `src/store/projectDocuments.test.ts`
- `src/store/saveTaskWorkload.test.ts`
- `src/store/seed.ts`
- `src/store/selectors.test.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/store/taskMeta.test.ts`
- `src/store/ticketActions.test.ts`
- `src/store/ticketsStorage.test.ts`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/migrationStatus.test.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/referenceData.test.ts`
- `src/supabase/referenceData.ts`
- `src/types.ts`
- `handoffs/packages/companies-scoping.md`
- `handoffs/scheduler-reviews/20260721-150911-243-companies-scoping-and-visibility.md`
- `src/store/companies.test.ts`
- `supabase/migrations/20260721160000_companies.sql`
