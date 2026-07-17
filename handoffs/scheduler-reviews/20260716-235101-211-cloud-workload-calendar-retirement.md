# Raport workflow: 20260716-235101-211-cloud-workload-calendar-retirement

## Wykonane

Trasa TierWorkflow: `architect → developer` (pakiet:
`handoffs/scheduler-reviews/211-architect-package.md`,
PKG-20260717-cloud-workload-retirement, Risk: high, Codex review: required —
finalny reviewer i Codex należą do procesu schedulera).

Domknięta migracja persystencji workload/kalendarza do Supabase oraz
kontrolowane wycofanie aktywnych zapisów localStorage:

- **Nowa migracja** `supabase/migrations/20260717000000_workload_planner_retirement.sql`:
  tabele `workload_entries` (siatka 0,25 h / 15 min jako CHECK-i, sentinel
  kosza `work_date IS NULL`, częściowy unikalny indeks „jeden wiersz kosza na
  parę (task, profil)”), `milestones` i `app_settings` (flaga wycofania).
  RLS + `revoke ... from anon` w tym samym pliku, wyłącznie istniejące helpery
  `app.*` (bez nowych funkcji SQL). Zakres ról: administrator globalnie,
  manager — wiersze zadań własnego działu (zapisy ograniczone do osób
  własnego działu), pracownik — własne wiersze; `app_settings` czytelne dla
  zalogowanych, zapisywalne tylko przez administratora.
- **Repozytorium/lustro (rozszerzenie architektury z etapu 210)**:
  `plannerData.ts` — snapshot i mapery workload/milestones z rewalidacją
  siatki (niepoprawne wiersze z chmury wykluczane z polską diagnostyką, nigdy
  nie mergowane), akcesory flagi wycofania oraz poprawka klasyfikacji błędów:
  naruszenia constraintów Postgresa (23502/23503/23505/23514) odrzucają
  operację z komunikatem zamiast wiecznie blokować kolejkę ponowień;
  `cloudMirror.ts` — rodziny diffów workload i milestones w porządku
  zależności (atomowa para `SCHEDULE_BIN_PART`; niezmieniony `SAVE_TASK`
  emituje zero operacji workload).
- **AppStore — tylko rozszerzenie `MERGE_CLOUD_ENTITIES`**: merge workload i
  kamieni milowych po id (wiersze tylko-lokalne zachowane), uzgodnienie
  inwariantu jednego wiersza kosza — przy duplikacie pary przeżywa wiersz o
  id z chmury, a godziny są sumowane na siatce (zachowanie pracy);
  niepoprawny payload zwraca oryginalną referencję stanu (inwariant 6).
  Reduktor pozostaje synchroniczny i czysty.
- **Brama wycofania (handshake — dwuwarstwowy marker)**: flaga organizacyjna
  w `app_settings` (`local_writes_retired`, ustawiana tylko przez admina) +
  cache per przeglądarka na NOWYM kluczu `n2hub.cloudMigration.v1` poza
  danymi planera, wyłącznie przez nowe helpery `storage.ts` (`clearData` go
  nie dotyka). Czysta logika w `src/store/persistGate.ts`: zapis lokalny jest
  pomijany tylko gdy marker aktywny ∧ skonfigurowany Supabase ∧ lustro
  zweryfikowane-zdrowe ∧ przejście stanu dotyczy wyłącznie kolekcji
  mirrorowanych; `people`/`statuses`/słowniki/`savedFilters` itd. zawsze
  zapisują się lokalnie. Każda degradacja chmury automatycznie przywraca
  zapisy per-akcja. Kopia odzyskiwania odświeżana po hydracji, po opróżnieniu
  kolejki, przy błędzie przejściowym i na `pagehide` z oczekującymi zapisami;
  nic nigdy nie usuwa lokalnych danych planera. Pominięty zapis nie zmienia
  `saveError` — brak fałszywego `Zapisano`.
- **Widok stanu migracji dla administratora**
  (`src/components/MigrationStatusPanel.tsx` + montaż w `AdminPage`, tylko
  tryb supabase, po polsku): tabela pokrycia per grupa danych, stan
  synchronizacji na żywo, obowiązkowe `Pobierz kopię zapasową` przed
  uzbrojeniem, `Zweryfikuj i wyłącz zapisy lokalne` (handshake: czyste
  pokrycie → odczyt snapshotu → sonda zapis/odczyt/usunięcie wiersza
  workload → dopiero wtedy flaga) oraz odwracalne `Przywróć zapisy lokalne`
  z natychmiastowym pełnym zapisem lokalnym. Logika w czystym, testowanym
  `src/supabase/migrationStatus.ts`.
- **Import/dry-run (etapy 207–208) pozostają prawdziwe**: `dataImport.ts`
  wspiera idempotentnie `workload` i `milestones`; w dry-run niewspierane
  pozostają wyłącznie `savedFilters` (świadoma decyzja: preferencja
  per-użytkownik, na zawsze lokalna przez regułę kolekcji niemirrorowanych).
- **Tryb lokalny bez zmian behawioralnych**: brak env Supabase ⇒ brama nigdy
  nie pomija zapisów (przeterminowany marker ignorowany), panel się nie
  renderuje, pełna persystencja localStorage jak dotychczas. Kod interakcji
  kalendarza/kosza (`WeekView.tsx`, `WorkloadPage.tsx`, `selectors.ts`,
  `commandValidation.ts`, `utils/time.ts`) — zero zmian; mutacje płyną
  wyłącznie przez akcje reduktora, lustro podpina się po reduktorze.
- Odstępstwa od pakietu (zgłoszone przez developera, minimalne): (1) sonda
  handshake'u wymaga realnego `taskId` (FK NOT NULL na `workload_entries`) —
  panel podaje pierwsze zadanie z UUID, brak ⇒ krok kończy się polskim
  komunikatem; (2) `isSupabaseConfigured()` czyta `import.meta.env` z
  fallbackiem `globalThis.process?.env`, by czysta brama była testowalna w
  vitest (w przeglądarce autorytatywne pozostaje `import.meta.env`);
  (3) panel/handshake budują `PlannerDb` przez singleton `getSupabaseClient()`
  — ten sam wzorzec co `ExportDryRunPanel`; (4) `ExportDryRunPanel.tsx` —
  wyłącznie 4 nowe etykiety tabel docelowych w liście raportu dry-run.

## Zmiany

- Nowe: migracja `20260717000000_workload_planner_retirement.sql`,
  `src/store/persistGate.ts(+test)`, `src/supabase/migrationStatus.ts(+test)`,
  `src/components/MigrationStatusPanel.tsx`, pakiet architekta
  (`211-architect-package.md`).
- Zmienione: `src/supabase/plannerData.ts(+test)`, `src/supabase/cloudMirror.ts(+test)`,
  `src/supabase/CloudSyncProvider.tsx`, `src/supabase/config.ts`,
  `src/supabase/dataImport.ts(+test)`, `src/supabase/migrations.test.ts`
  (rozszerzone, bez osłabiania asercji), `src/store/AppStore.tsx` (tylko
  `MERGE_CLOUD_ENTITIES` + konsultacja bramy w efekcie persystencji),
  `src/store/storage.ts(+test)` (tylko nowe helpery markera),
  `src/store/cloudMerge.test.ts`, `src/store/exportDryRun.ts(+test)`,
  `src/components/ExportDryRunPanel.tsx`, `src/pages/AdminPage.tsx`,
  `supabase/README.md`, wiki `openwiki/n2hub/state-and-persistence.md`,
  `handoffs/RUN-STATE.md`.

## Weryfikacja

- Testy fokusowe developera (`npx vitest run src/supabase
  src/store/persistGate.test.ts src/store/cloudMerge.test.ts
  src/store/storage.test.ts src/store/blockActions.test.ts
  src/store/commandValidation.test.ts src/store/exportDryRun.test.ts`):
  494 passed, 0 failed.
- `npm test` (uruchomione niezależnie przez orkiestratora): 31 plików,
  **901 passed / 0 failed**.
- `npm run build` (orkiestrator): **zielony** — `tsc` + `vite build`; jedynie
  istniejące wcześniej ostrzeżenie o chunku > 500 kB.
- Browser check: brak — kod interakcji kalendarza/kosza nietknięty, tryb
  lokalny bajt-w-bajt identyczny; inwarianty siatki pokrywają suity
  `blockActions`/`commandValidation`. Matryca należy do weryfikacji
  wydaniowej.
- Wiki: **zaktualizowane** — `openwiki/n2hub/state-and-persistence.md`
  (nowa granica źródła prawdy: workload/milestones w chmurze + brama
  wycofania; localStorage jako pasywna kopia odzyskiwania).
  `scheduling-and-calendar.md` bez zmian — kod interakcji nietknięty, mutacje
  nadal wyłącznie przez akcje reduktora. Ostateczną decyzję wiki potwierdza
  reviewer schedulera.

## Ryzyka / rzeczy do sprawdzenia

- Treść polityk RLS, CHECK-ów i częściowego indeksu unikalnego jest
  weryfikowana statycznie (`migrations.test.ts` + przegląd tekstu);
  behawioralnie właścicielem jest hostowany projekt Supabase, gdzie migracja
  nie została zastosowana (operator-owned). Główny punkt dla wymaganego
  przeglądu Codex.
- Udokumentowane okno rezydualne: twardy crash w podsekundowym oknie między
  akcją tylko-mirrorowaną a potwierdzeniem chmury (przy uzbrojonym
  wycofaniu) może utracić tę jedną akcję. Każda inna degradacja natychmiast
  przywraca zapisy lokalne per-akcja.
- Decyzja merge'u duplikatu pary kosza (przeżywa id z chmury, godziny
  sumowane na siatce — zachowanie pracy) warta oceny reviewera; dotyczy
  wyłącznie hydracji przy rozjeździe dwóch przeglądarek sprzed migracji.
- `MigrationStatusPanel`/`CloudSyncProvider` nie mają testów jednostkowych
  (vitest w node bez jsdom); wszystkie decyzje żyją w czystych, testowanych
  modułach `persistGate`/`migrationStatus`/`plannerData`/`cloudMirror`,
  komponenty pokrywa typecheck builda.
- Sonda handshake'u wymaga istnienia co najmniej jednego zadania o UUID w
  chmurze — w pustej organizacji uzbrojenie wycofania jest niemożliwe
  (komunikat po polsku); świadome ograniczenie, do ewentualnej oceny UX.

## Podpis schedulera

- Run: `20260716-235101-211-cloud-workload-calendar-retirement`
- Prompt: `211-cloud-workload-calendar-retirement.md`
- Gałąź review: `review-integration`
- Baza: `18cae800d2772d2d3e5465c1cd9ae11c5f6f1c5c`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `18cae800d2772d2d3e5465c1cd9ae11c5f6f1c5c`
- Gałąź review: `review-integration`
- Run: `20260716-235101-211-cloud-workload-calendar-retirement`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/components/ExportDryRunPanel.tsx`
- `src/pages/AdminPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/cloudMerge.test.ts`
- `src/store/exportDryRun.test.ts`
- `src/store/exportDryRun.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/config.ts`
- `src/supabase/dataImport.test.ts`
- `src/supabase/dataImport.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/plannerData.ts`
- `supabase/README.md`
- `handoffs/scheduler-reviews/20260716-235101-211-cloud-workload-calendar-retirement.md`
- `handoffs/scheduler-reviews/211-architect-package.md`
- `src/components/MigrationStatusPanel.tsx`
- `src/store/persistGate.test.ts`
- `src/store/persistGate.ts`
- `src/supabase/migrationStatus.test.ts`
- `src/supabase/migrationStatus.ts`
- `supabase/migrations/20260717000000_workload_planner_retirement.sql`
