# Raport workflow: 20260716-140904-209-cloud-reference-and-organization-reads

## Wykonane

Trasa TierWorkflow: `architect → developer` (pakiet:
`handoffs/scheduler-reviews/209-architect-package.md`,
PKG-20260716-cloud-reference-reads, Risk: high, Codex review: required —
finalny reviewer i Codex należą do procesu schedulera).

W trybie Supabase odczyty referencyjne i organizacyjne pochodzą teraz z
RLS-owanych selectów zamiast z localStorage:

- **Nowa migracja** `supabase/migrations/20260716150000_reference_tables.sql`:
  tabele `statuses`, `service_types`, `work_categories` (RLS włączone w tej
  samej migracji, `revoke ... from anon`, SELECT dla wszystkich
  `authenticated`, zapisy tylko dla administratora przez
  `app.is_administrator()`, trigger `app.set_updated_at`; `sort_order`
  odwzorowuje `Status.order`).
- **Moduł odczytów** `src/supabase/referenceData.ts` (czysty, testowalny w
  node): `ReferenceDb = Pick<ImportDb,'select'>` na istniejącym adapterze,
  atomiczny `loadOrgSnapshot` (profil własny po id użytkownika auth, puste
  kolekcje = poprawny wynik RLS, każdy błąd selecta = jedna polska wiadomość),
  mapowanie ról chmurowych (`manager→pm`, `worker→pracownik`) oraz
  `effectiveAccessRole` — precyzyjna reguła fallbacku uprawnień.
- **Provider** `src/supabase/OrgDataProvider.tsx`: maszyna stanów
  `idle/loading/error/ready`, ładowanie raz na id zalogowanego użytkownika,
  `reload()`; w trybie lokalnym pozostaje `idle` (zero zmian zachowania).
- **UI (tylko tryb Supabase, po polsku)**: `AccountPage` — sekcja „Profil w
  chmurze”; `TeamPage` — hierarchia zespołu budowana wprost z wierszy
  zwróconych przez RLS (bez ponownego filtrowania po stronie klienta);
  `AdminPage` — sekcja „Słowniki w chmurze” (tylko odczyt). Każda powierzchnia
  ma stany ładowania, pustki i błędu z „Spróbuj ponownie”.
- **Uprawnienia jako UX**: `useCan`/`canTeam` używają roli chmurowej, gdy
  snapshot jest gotowy i użytkownik działa jako on sam; podczas ładowania, po
  błędzie, w trybie lokalnym i przy „Występuj jako” obowiązuje rola lokalna.
  Autoryzacją pozostaje RLS.
- **Import (etap 208) rozszerzony**: `statuses`/`serviceTypes`/`workCategories`
  przeniesione z listy „Brak tabeli docelowej” do wspieranych, idempotentnych
  kroków insert-only (skip po id oraz slug/nazwie, diagnostyka nie-UUID);
  raport dry-run (`exportDryRun.ts`) zaktualizowany, żeby pozostał prawdziwy.

**Granica przejściowa (udokumentowana** w nagłówku `referenceData.ts`,
`supabase/README.md` i `openwiki/n2hub/ui-navigation-and-onboarding.md`**)**:
planer (kanban, TaskModal, lokalne edytory słowników) nadal działa na
słownikach z localStorage, bo lokalne zadania/projekty odwołują się do
lokalnych id — do czasu kroku migracji zapisów. Odczyty chmurowe nigdy nie
dispatchują do AppStore; `storage.ts`, `selectors.ts` i reduktor pozostały
nietknięte. Zapisy projektów/zadań/workloadu nie zostały zmigrowane.

## Zmiany

- Nowe: migracja referencyjna, `src/supabase/referenceData.ts(+test)`,
  `src/supabase/OrgDataProvider.tsx`, pakiet architekta.
- Zmienione: `dataImport.ts(+test)`, `exportDryRun.ts(+test)`,
  `ExportDryRunPanel.tsx`, `useCan.ts`, `App.tsx`, `main.tsx`,
  `AccountPage.tsx`, `TeamPage.tsx`, `AdminPage.tsx`, `teamScope.ts(+test)`,
  `auth/profile.ts` (nieaktualny komentarz), `migrations.test.ts`,
  `supabase/README.md`, wiki `ui-navigation-and-onboarding.md`,
  `handoffs/RUN-STATE.md`.
- Odstępstwo od pakietu (zgłoszone przez developera): pakiet zakładał, że
  `src/supabase/migrations.test.ts` „przejdzie bez zmian”, ale test twardo
  koduje listę plików migracji i zamkniętą listę znanych tabel — dodanie
  migracji wymagało minimalnego rozszerzenia (nowy plik na liście, trzy tabele
  w `EXPECTED_POLICIES` z pełnym pokryciem CRUD, kontrola `revoke anon` per
  plik zamiast pojedynczego dopasowania). Żadna asercja nie została osłabiona.

## Weryfikacja

- Testy fokusowe workera (`npx vitest run src/supabase
  src/pages/teamScope.test.ts src/store`): 684 passed, 0 failed.
- `npm test` (uruchomione niezależnie przez orkiestratora): 26 plików,
  **828 passed / 0 failed**.
- `npm run build` (orkiestrator): **zielony** — `tsc --noEmit` + `vite build`;
  jedynie istniejące wcześniej ostrzeżenie o chunku > 500 kB.
- Browser check: brak — żadna interakcja wrażliwa na stabilność
  (kalendarz/kosz) nie została zmieniona; nowe sekcje to czyste odczyty.
- Wiki: **zaktualizowane** — `openwiki/n2hub/ui-navigation-and-onboarding.md`
  (zdanie „rola/dział zawsze z lokalnego Person” przestało być prawdziwe w
  trybie Supabase). Ostateczną decyzję wiki potwierdza reviewer schedulera.

## Ryzyka / rzeczy do sprawdzenia

- Rola `handlowiec` nie ma odpowiednika w chmurze — w trybie Supabase taka
  osoba dostaje UX na poziomie `pracownik` (zgodnie z prawdą RLS; opisane w
  `cloudRoleToAccessRole`). Świadoma decyzja z pakietu, warta uwagi reviewera.
- Formularz zakładania kont na `TeamPage` nadal bramkowany lokalną rolą
  (zgodnie z pakietem „stays as-is”); realną granicą pozostaje RLS/JWT.
- Nowe sekcje (`Profil w chmurze`, `Słowniki w chmurze`) używają istniejących
  klas/utility CSS — bez dedykowanych styli; kwestia czysto kosmetyczna,
  matryca przeglądarkowa należy do weryfikacji wydaniowej.
- Migracja nie została zastosowana na hostowanym projekcie (operator-owned);
  do czasu jej wdrożenia selecty słowników w trybie Supabase zwrócą błąd
  tabeli — UI pokaże polski stan błędu z możliwością ponowienia.

## Podpis schedulera

- Run: `20260716-140904-209-cloud-reference-and-organization-reads`
- Prompt: `209-cloud-reference-and-organization-reads.md`
- Gałąź review: `review-integration`
- Baza: `e30973ffbdfac6f39a38e423f74249d51aea9d7e`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `e30973ffbdfac6f39a38e423f74249d51aea9d7e`
- Gałąź review: `review-integration`
- Run: `20260716-140904-209-cloud-reference-and-organization-reads`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/auth/profile.ts`
- `src/components/ExportDryRunPanel.tsx`
- `src/main.tsx`
- `src/pages/AccountPage.tsx`
- `src/pages/AdminPage.tsx`
- `src/pages/TeamPage.tsx`
- `src/pages/teamScope.test.ts`
- `src/pages/teamScope.ts`
- `src/store/exportDryRun.test.ts`
- `src/store/exportDryRun.ts`
- `src/store/useCan.ts`
- `src/supabase/dataImport.test.ts`
- `src/supabase/dataImport.ts`
- `src/supabase/migrations.test.ts`
- `supabase/README.md`
- `handoffs/scheduler-reviews/20260716-140904-209-cloud-reference-and-organization-reads.md`
- `handoffs/scheduler-reviews/209-architect-package.md`
- `src/supabase/OrgDataProvider.tsx`
- `src/supabase/referenceData.test.ts`
- `src/supabase/referenceData.ts`
- `supabase/migrations/20260716150000_reference_tables.sql`
