# Raport workflow: 20260721-144300-242-job-titles-dictionary-from-ui

## Wykonane

Workflow tier: `architect → developer → reviewer` (wielo-granicowe zadanie medium/high). Najpierw zweryfikowano, że funkcja nadal nie istnieje w buildzie (brak `jobTitle`/`job_titles` w `src/` i `supabase/`, brak sekcji „Stanowiska" w AdminPage) — zadanie było aktualne i zostało zaimplementowane.

1. **Model i reducer.** Encja `JobTitle { id, name }` + wymagana kolekcja `AppData.jobTitles` (`src/types.ts`). Akcje `ADD_JOB_TITLE`/`RENAME_JOB_TITLE`/`DELETE_JOB_TITLE` w `src/store/AppStore.tsx`: trim, odrzucenie pustej nazwy, duplikatu (case-insensitive `pl-PL`) i nieznanego id przez zwrot tej samej referencji stanu (invariant 6); usunięcie stanowiska nie nadpisuje `Person.role`. `mergeCloudDictionaries` rozszerzone o `jobTitles` (cloud-authoritative zastąpienie kolekcji przy hydracji, no-op przy identycznych danych).
2. **Persystencja.** `emptyData()` + `coerceArray` w `src/store/storage.ts` (naprawa starych payloadów bez `jobTitles`, bez podbicia wersji danych), `persistGate.NON_MIRRORED_KEYS`, `src/store/seed.ts`.
3. **CRUD w Admin.** Sekcja „Stanowiska" w `src/pages/AdminPage.tsx` obok „Działów", z ponownym użyciem istniejącego `SimpleList`/`SimpleListRow` (bez duplikacji CRUD), gated `admin.panel`, polskie komunikaty + podgląd danych z chmury.
4. **Profil.** Nowy czysty helper `jobTitleSelectOptions` w `src/utils/roleTitles.ts`: scala słownik zarządzany → opcje wyliczane z działów (`roleTitleOptions`) → bieżącą, ręcznie wpisaną wartość `role` (zawsze obecna na liście — wsteczna zgodność). Select „Stanowisko" w `src/pages/PersonProfilePage.tsx` przełączony na helper; `roleTitleOptions` i `accessRoleForTitle` nietknięte (pola chronione triggerem bez zmian).
5. **Chmura.** Migracja `supabase/migrations/20260721150000_job_titles.sql` — forward-only, idempotentna (`if not exists`/`drop policy if exists`), `enable row level security`, `revoke all … from anon`, polityki `to authenticated`/`with check`: select dla authenticated, insert/update/delete tylko `app.is_administrator()`; dodanie do publikacji realtime. Plik dopisany do listy w `src/supabase/migrations.test.ts` oraz wpis w `EXPECTED_POLICIES`. Wpięcie: `referenceData.loadOrgSnapshot` (atomowy select `job_titles`), dispatch w `App.tsx`, piąty wpis słownikowy (row builder + diff ops) w `src/supabase/cloudMirror.ts`. Migracja NIE została zastosowana na zdalnym Supabase — tylko plik SQL (zgodnie z pamięcią projektu: apply za zgodą usera przez MCP).
6. **Wiki.** `wiki updated`: `openwiki/n2hub/state-and-persistence.md` (nowa kolekcja, akcje, repair, merge) i `openwiki/n2hub/cloud-database.md` (tabela `job_titles`, polityki, rejestr migracji).

Świadome odstępstwo od treści promptu (zapisane w pakiecie architekta): hydracja słownika idzie ścieżką `referenceData.loadOrgSnapshot` → `MERGE_CLOUD_DICTIONARIES` (tak jak `departments`), a nie przez `plannerData.ts`/`CloudMergePayload` — `plannerData.ts` nie obsługuje słowników organizacyjnych i pozostał nietknięty.

## Zmiany

- Produkcyjne: `src/types.ts`, `src/store/AppStore.tsx`, `src/store/storage.ts`, `src/store/persistGate.ts`, `src/store/seed.ts`, `src/utils/roleTitles.ts`, `src/pages/AdminPage.tsx`, `src/pages/PersonProfilePage.tsx`, `src/supabase/referenceData.ts`, `src/supabase/cloudMirror.ts`, `src/App.tsx`, `supabase/migrations/20260721150000_job_titles.sql`.
- Testy: nowy `src/store/jobTitles.test.ts`; rozszerzone `storage.test.ts`, `roleTitles.test.ts`, `referenceData.test.ts`, `cloudMirror.test.ts`, `migrations.test.ts`; fixupy literałów `OrgSnapshot` (nowe wymagane pole) w `plannerData.test.ts`, `migrationStatus.test.ts`, `projectDocuments.test.ts`.
- Wiki: `openwiki/n2hub/state-and-persistence.md`, `openwiki/n2hub/cloud-database.md`.
- Artefakty workflow: `handoffs/scheduler-reviews/242-architect-package.md`, `handoffs/RUN-STATE.md`.

## Weryfikacja

- Focused vitest (reducer stanowisk, storage repair, scalanie opcji w profilu, migracje, referenceData, cloudMirror — 11 plików): **PASS** (341 testów).
- `npm test`: **zielony** — 43 pliki, 1166 testów (baza 933 + nowe), 0 fail.
- `npm run build` (`tsc --noEmit` + vite build): **zielony**.
- Review (agent reviewer, read-only): **APPROVED**, 0 blockerów; potwierdzone m.in. asercje invariant 6 przez `toBe`, zgodność SQL z każdą statyczną asercją `migrations.test.ts`, brak możliwości zniknięcia bieżącej wartości `role` z selecta.

## Ryzyka / rzeczy do sprawdzenia

- Migracja `20260721150000_job_titles.sql` czeka na zastosowanie na zdalnym Supabase (MCP `apply_migration` za zgodą usera). Do czasu aplikacji select `job_titles` w `loadOrgSnapshot` zwróci błąd tabeli — snapshot jest atomowy, więc hydracja słowników zgłosi błąd zamiast cichej utraty danych; to istniejące, zamierzone zachowanie dla nowych migracji w tej kolejce.
- Duplikaty stanowisk odrzucane case-insensitive (`pl-PL`) — celowo ostrzejsze niż historyczne zachowanie działów; zapisane w pakiecie architekta i w wiki.
- Pakiet architekta deklarował „Codex review: required" — w tej sesji nie było artefaktu Codex; decyzja należy do schedulera zgodnie z kontraktem (`scripts/codex-review.sh` po zakończeniu procesu implementacyjnego).

## Podpis schedulera

- Run: `20260721-144300-242-job-titles-dictionary-from-ui`
- Prompt: `242-job-titles-dictionary-from-ui.md`
- Gałąź review: `review-integration`
- Baza: `2e4e9a14472dbe00b6a049a4f5347729017fe88c`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `2e4e9a14472dbe00b6a049a4f5347729017fe88c`
- Gałąź review: `review-integration`
- Run: `20260721-144300-242-job-titles-dictionary-from-ui`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/App.tsx`
- `src/pages/AdminPage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/store/AppStore.tsx`
- `src/store/persistGate.ts`
- `src/store/projectDocuments.test.ts`
- `src/store/seed.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/migrationStatus.test.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/referenceData.test.ts`
- `src/supabase/referenceData.ts`
- `src/types.ts`
- `src/utils/roleTitles.test.ts`
- `src/utils/roleTitles.ts`
- `handoffs/scheduler-reviews/20260721-144300-242-job-titles-dictionary-from-ui.md`
- `handoffs/scheduler-reviews/242-architect-package.md`
- `src/store/jobTitles.test.ts`
- `supabase/migrations/20260721150000_job_titles.sql`
