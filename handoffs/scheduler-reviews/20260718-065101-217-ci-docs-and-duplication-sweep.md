# Raport workflow: 20260718-065101-217-ci-docs-and-duplication-sweep

## Wykonane

**1. CI (czerwony krok).** Usunięto z `.github/workflows/openwiki-check.yml` krok
`node --test automation/claude-scheduler/*.test.mjs` — katalog `automation/` nie
istnieje na tej gałęzi, więc krok wywalał każdy push i maskował wynik walidacji
wiki. Nazwę workflow i kroku sprowadzono do faktycznego zakresu („OpenWiki link
check”). `AGENTS.md` poprawiono: CI waliduje już tylko linki wiki, bez
„scheduler prompt contracts”.

**2. Dokumentacja (tylko tam, gdzie była faktycznie błędna).**
- `CLAUDE.md`: usunięto „no backend, real authentication… no multi-user
  synchronization”; opisano granicę Supabase (`src/supabase/` jedyną granicą
  chmury, auth przez `src/auth/`, fallback do trybu lokalnego bez konfiguracji).
  Scope guardrail przeredagowany: Supabase jest jedynym backendem, zakaz
  dokładania innego backendu/kanalu sync; pozostałe zakazy (załączniki,
  powiadomienia, billing itd.) bez zmian; granicą bezpieczeństwa jest RLS.
- `src/supabase/client.ts` i `config.ts`: usunięto nieprawdziwe „uśpiona
  infrastruktura, nic jej nie importuje” — moduły opisane zgodnie z rolą
  (jedyny punkt tworzenia klienta; walidacja używana przez client i persistGate).
- `src/supabase/cloudMirror.ts`: inwariant „godziny nigdy nie są lustrzane — nie
  ma tabeli” zastąpiony stanem faktycznym (upsert/remove do `workload_entries`).
- `src/supabase/CloudSyncProvider.tsx`: nagłówek mówił „siedem grup”, wymieniał
  sześć i twierdził, że localStorage jest źródłem renderowania. Teraz: OSIEM
  lustrzanych i hydratowanych rodzin + wąska, update-only projekcja
  `people → profiles` (bez hydracji); renderowanie ze stanu AppStore,
  localStorage jako kopia odzyskowa pomijalna w trybie wycofanym.
- `openwiki/n2hub/ui-navigation-and-onboarding.md`: usunięto nieaktualne „until
  the data-write migration” (migracja zapisów planera już jest); doprecyzowano,
  że słowniki/statusy/osoby/savedFilters celowo zostają lokalne, a granicą
  bezpieczeństwa w trybie supabase jest RLS.
- `openwiki/n2hub/cloud-database.md` — NOWA strona (granica Supabase: schema,
  RLS, mirror, hydracja, provisioning, import, retirement), podlinkowana z
  `quickstart.md` i `INDEX.md`, dodana do listy w `check-openwiki-links.mjs`.

**Zweryfikowane premisy z review, które NIE odpowiadają obecnemu stanowi**
(zgodnie z ustaleniami runu 213): `applyCloudPeople` nie istnieje nigdzie w
`src/` i żadna ścieżka chmurowa nie usuwa lokalnych osób (`CloudMergePayload`
nie zawiera people; mirror profili jest update-only) — strony wiki nie
twierdziły niczego przeciwnego, więc poprawki ograniczono do realnych dryfów.
`state-and-persistence.md` zweryfikowano punkt po punkcie z kodem (8 rodzin,
workload mirrored, wąska projekcja profiles, `people` w NON_MIRRORED_KEYS
persistGate) — bez sprzeczności; jedyna zmiana to dopisanie nowego testu do
listy „Relevant tests”. `scheduling-and-calendar.md` i
`testing-and-automation.md`: wiki unchanged (poza zakresem zmian).

**3. Deduplikacja (bez zmiany zachowania).**
- `polishCount` (3 kopie: KanbanPage, ProjectsPage, GlobalSearch) →
  `src/utils/polish.ts`.
- `rangeLabel` (2 kopie: ProjectsPage, TasksPage — identyczna logika) →
  `src/utils/dates.ts`; usunięte lokalne importy `date-fns`/`parseDate`.
- `src/store/seed.ts`: literały 480/1440 zastąpione `WORKDAY_START_MIN` oraz
  istniejącym `defaultWorkEndMinutes(DEFAULT_CAPACITY)` ze `storage.ts`
  (formuła identyczna: `min(1440, 480 + capacity*60)`).
- `TodayAgenda.tsx` i `plannerData.ts`: inline `start + hours*60` →
  `blockEndMinutes()` z `utils/time.ts` (hoursToMinutes = `h*60`, tożsame).
- `App.tsx` i `PersonProfilePage.tsx`: ręczne `state.people.find(id ===
  currentUserId)` → selektor `currentUser` z `selectors.ts` (semantyka
  identyczna, także dla pustego `currentUserId`).

**4. Czyszczenie zapisanych filtrów.** Nowy helper `clearSavedFilterRef` w
`AppStore.tsx` (zwraca TĘ SAMĄ referencję tablicy, gdy nic nie pasuje — bez
zbędnego churnu persist/mirror). Podpięty do `DELETE_CLIENT`, `DELETE_STATUS`
(w `deleteStatus`), `DELETE_PERSON` (w kaskadzie `deletePerson`) oraz
istniejącego `DELETE_WORK_CATEGORY` (zastąpił inline'ową mapę). Test:
`src/store/savedFilterCleanup.test.ts` (5 przypadków: po jednym na encję,
zachowanie cudzych referencji, stabilność referencji przy braku trafienia).

## Zmiany

- `.github/workflows/openwiki-check.yml`, `AGENTS.md`, `CLAUDE.md`
- `openwiki/quickstart.md`, `openwiki/n2hub/INDEX.md`,
  `openwiki/n2hub/ui-navigation-and-onboarding.md`,
  `openwiki/n2hub/state-and-persistence.md`,
  `openwiki/n2hub/cloud-database.md` (nowy), `scripts/check-openwiki-links.mjs`
- `src/supabase/{client,config,cloudMirror,plannerData}.ts`,
  `src/supabase/CloudSyncProvider.tsx`
- `src/utils/polish.ts` (nowy), `src/utils/dates.ts`
- `src/pages/{KanbanPage,ProjectsPage,TasksPage,PersonProfilePage}.tsx`,
  `src/components/{GlobalSearch,TodayAgenda}.tsx`, `src/App.tsx`,
  `src/store/{AppStore.tsx,seed.ts}`, `src/store/savedFilterCleanup.test.ts`
  (nowy)

## Weryfikacja

- `npm test`: 36 plików / 981 testów — PASS (w tym nowy
  `savedFilterCleanup.test.ts`).
- `npm run build`: PASS (tsc + vite; tylko znane ostrzeżenie o rozmiarze
  chunka).
- `node scripts/check-openwiki-links.mjs`: PASS („Validated 7 wiki files”, z
  nową stroną cloud-database.md).

## Ryzyka / rzeczy do sprawdzenia

- `DELETE_WORK_CATEGORY` zwraca teraz niezmienioną referencję `savedFilters`,
  gdy żaden preset nie wskazywał kategorii (wcześniej zawsze nowa tablica).
  To celowe (mniej churnu dla persistGate), pozostałe kolekcje w tej akcji
  nadal tworzą nowy stan, więc akcja dalej zapisuje się normalnie.
- Krok CI z testami schedulera usunięto zamiast naprawiać — katalog
  `automation/claude-scheduler` nie istnieje w repo; jeśli scheduler wróci do
  repo, krok trzeba dodać ponownie.
- Nowa strona wiki `cloud-database.md` jest zwięzłym opisem granicy — przy
  kolejnych zmianach schematu wymaga utrzymania jak pozostałe strony
  (dodana do deterministycznego checku linków).

## Podpis schedulera

- Run: `20260718-065101-217-ci-docs-and-duplication-sweep`
- Prompt: `217-ci-docs-and-duplication-sweep.md`
- Gałąź review: `review-integration`
- Baza: `129ac6211218f83897dd8ac8a4946f4abeb4e878`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `129ac6211218f83897dd8ac8a4946f4abeb4e878`
- Gałąź review: `review-integration`
- Run: `20260718-065101-217-ci-docs-and-duplication-sweep`

### Pliki zgłoszone do review

- `.github/workflows/openwiki-check.yml`
- `AGENTS.md`
- `CLAUDE.md`
- `openwiki/n2hub/INDEX.md`
- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/quickstart.md`
- `scripts/check-openwiki-links.mjs`
- `src/App.tsx`
- `src/components/GlobalSearch.tsx`
- `src/components/TodayAgenda.tsx`
- `src/pages/KanbanPage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/seed.ts`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/client.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/config.ts`
- `src/supabase/plannerData.ts`
- `src/utils/dates.ts`
- `handoffs/scheduler-reviews/20260718-065101-217-ci-docs-and-duplication-sweep.md`
- `openwiki/n2hub/cloud-database.md`
- `src/store/savedFilterCleanup.test.ts`
- `src/utils/polish.ts`
