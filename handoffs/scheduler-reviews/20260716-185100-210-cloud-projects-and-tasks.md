# Raport workflow: 20260716-185100-210-cloud-projects-and-tasks

## Wykonane

Trasa TierWorkflow: `architect → developer` (pakiet:
`handoffs/scheduler-reviews/210-architect-package.md`,
PKG-20260716-cloud-planner-data, Risk: high, Codex review: required —
finalny reviewer i Codex należą do procesu schedulera).

W trybie Supabase siedem grup danych planera — klienci, projekty, zadania,
przypisania, zmiany statusów zadań/projektów, komentarze i zdarzenia
aktywności — jest teraz zapisywanych do Supabase i hydratowanych po
zalogowaniu, przy zachowaniu `AppStore` jako jedynej granicy mutacji:

- **Nowa migracja** `supabase/migrations/20260716190000_planner_entities.sql`:
  tabele `clients`, `comments`, `activity_events` (RLS włączone i
  `revoke ... from anon` w tym samym pliku, istniejące helpery `app.*`, bez
  nowych funkcji SQL) oraz kolumny planera na `projects`/`tasks` (`client_id`,
  `status_id`, daty, `paid`, `priority`, `estimated_hours`,
  `work_category_id`, `checklist` — nullable/z defaultem, więc wiersze z
  importu 208 pozostają poprawne). Zakres ról: administrator globalnie
  (istniejące polityki `app.is_administrator()`), manager — projekty/zadania
  własnego działu (istniejące `app.manages_*`), pracownik — własne
  przypisania i widoczne projekty; komentarze i aktywność są append-only
  (tylko SELECT+INSERT z `with check`, sprzątanie przez FK cascade), wpisy
  zawsze atrybuowane do `auth.uid()`.
- **Repozytorium** `src/supabase/plannerData.ts` (czyste, testowalne w node):
  interfejs `PlannerDb` (upsert/remove; rozszerzenie wzorca `ImportDb`),
  klasyfikacja błędów zapisu `permission`/`transient` (42501 / komunikaty
  RLS), atomiczny `loadPlannerSnapshot` (odwrotne mapy id: osoby po
  cloud-id→e-mailu, statusy po id→slugu, słowniki po id→nazwie; daty
  null↔`''`; wiersze z chmury łamiące lokalne walidacje — np. okres zadania
  > 92 dni — wykluczane z diagnostyką, nigdy nie mergowane).
- **Lustro** `src/supabase/cloudMirror.ts`: `buildCloudIdMaps`,
  `diffToCloudOps` (diff stanu prev→next po reduktorze, kolejność zależności
  klienci→projekty→zadania→przypisania→komentarze→aktywność; przypisania
  upsertem kompozytowym `task_id,profile_id`; komentarze/aktywność wyłącznie
  append; wiersze z nie-UUID id lub niemapowalnymi referencjami zostają
  lokalne z polską diagnostyką) oraz `applyCloudOps` (błąd przejściowy
  zatrzymuje kolejkę do ponowienia; odmowa uprawnień odrzuca operację z
  komunikatem, praca zostaje lokalnie).
- **AppStore — jedna nowa akcja** `MERGE_CLOUD_ENTITIES` (hydracja): chmura
  wygrywa po id, wiersze tylko-lokalne są zachowywane (nigdy cicho
  usuwane), przypisania uzgadniane po parze `(taskId, personId)` z
  zachowaniem lokalnego id; `workload`, osoby, statusy, słowniki, kamienie
  milowe i filtry przechodzą przez merge z tą samą referencją. Niepoprawny
  payload zwraca oryginalną referencję stanu (inwariant 6). Reduktor
  pozostaje synchroniczny i czysty; dodatkowo cienki wrapper `dispatch`
  wystawia `lastActionRef` dla tłumienia diffów.
- **Most** `src/supabase/CloudSyncProvider.tsx` +
  `src/components/CloudSyncBanner.tsx` (polskie stany): nieblokująca
  hydracja po gotowości snapshotu organizacji (lokalne dane z localStorage
  renderują się od razu; błąd hydracji = komunikat + „Spróbuj ponownie”),
  serializowana kolejka mirrorowania, tłumienie przejść
  `MERGE_CLOUD_ENTITIES`/`REPLACE_FROM_STORAGE`/`LOAD_SAMPLE`/`RESET_ALL`
  (dane przykładowe i reset nigdy nie masowo modyfikują chmury), ręczne
  „Odśwież dane z serwera” dostępne wyłącznie przy pustej kolejce
  oczekujących zapisów (konflikty pozostają jawne, last-write-wins). W trybie
  lokalnym: zero różnic w zachowaniu (brak klienta, banner renderuje `null`).
- **Import/dry-run (etapy 207–208) pozostają prawdziwe**: `dataImport.ts`
  przenosi `clients`/`comments`/`activity` z „Brak tabeli docelowej” do
  wspieranych, idempotentnych kroków insert-only; insercje projektów/zadań
  niosą pełny zestaw kolumn przez mapy referencyjne; `exportDryRun.ts`
  zaktualizowany. `milestones`/`workload`/`savedFilters` nadal niewspierane.
- **Persystencja workload/kalendarza pozostała w 100% lokalna**; localStorage
  nie został osłabiony — nadal zapisuje każdy stan (w tym zhydratowany) i
  pozostaje źródłem odzyskiwania. `storage.ts`, `selectors.ts`,
  `commandValidation.ts` i kod kalendarza/kosza nietknięte.

## Zmiany

- Nowe: migracja `20260716190000_planner_entities.sql`,
  `src/supabase/plannerData.ts(+test)`, `src/supabase/cloudMirror.ts(+test)`,
  `src/supabase/CloudSyncProvider.tsx`, `src/components/CloudSyncBanner.tsx`,
  `src/store/cloudMerge.test.ts`, pakiet architekta
  (`210-architect-package.md`).
- Zmienione: `src/store/AppStore.tsx` (tylko `MERGE_CLOUD_ENTITIES` +
  wrapper `lastActionRef`), `src/supabase/dataImport.ts(+test)`,
  `src/store/exportDryRun.ts(+test)`, `src/supabase/migrations.test.ts`
  (nowy plik migracji + polityki `clients`/`comments`/`activity_events`; bez
  osłabiania asercji), `src/main.tsx`, `src/App.tsx`, `supabase/README.md`,
  wiki `openwiki/n2hub/state-and-persistence.md`, `handoffs/RUN-STATE.md`.
- Odstępstwa od pakietu (zgłoszone przez developera): (1) `CloudOp` ma
  opcjonalne pole `onConflict?` — potrzebne, by kompozytowy cel konfliktu
  przypisań dotarł do `applyCloudOps`; (2) niemapowalna referencja działu w
  diffie spada do `null` (spójnie z fallbackiem importu), podczas gdy
  status/typ usługi/kategoria pracy blokują operację z diagnostyką, zgodnie
  z pakietem. Oba minimalne, bez zmiany semantyki bezpieczeństwa.

## Weryfikacja

- Testy fokusowe developera (`npx vitest run src/supabase
  src/store/cloudMerge.test.ts src/store/commandValidation.test.ts
  src/store/exportDryRun.test.ts`): 198 passed, 0 failed.
- `npm test` (uruchomione niezależnie przez orkiestratora): 29 plików,
  **863 passed / 0 failed**.
- `npm run build` (orkiestrator): **zielony** — `tsc --noEmit` + `vite build`;
  jedynie istniejące wcześniej ostrzeżenie o chunku > 500 kB.
- Browser check: brak — interakcje kalendarza/kosza nietknięte; w trybie
  lokalnym banner renderuje `null`, więc istniejące scenariusze przeglądarkowe
  nie widzą różnicy. Matryca należy do weryfikacji wydaniowej.
- Wiki: **zaktualizowane** — `openwiki/n2hub/state-and-persistence.md`
  (nowa granica: lustro chmurowe + `MERGE_CLOUD_ENTITIES`, workload lokalny).
  Ostateczną decyzję wiki potwierdza reviewer schedulera.

## Ryzyka / rzeczy do sprawdzenia

- Treść nowych polityk RLS (trzy tabele + `with check` na insertach) jest
  weryfikowana statycznie przez `migrations.test.ts` i przegląd tekstu —
  behawioralnie właścicielem jest RLS na hostowanym projekcie; migracja nie
  została tam zastosowana (operator-owned). To główny punkt dla wymaganego
  przeglądu Codex.
- Propagacja usunięć między klientami nie obejmuje wierszy tylko-lokalnych, a
  zdalnie zmienione daty zadań nie są uzgadniane z lokalnym workloadem do
  następnej lokalnej edycji — świadome, udokumentowane ograniczenia etapu
  (pakiet, `supabase/README.md`).
- Banner „stan gotowy + pusta kolejka” stale pokazuje podpowiedź „Dane mogą
  być nieaktualne…” z przyciskiem odświeżenia — zgodne z pakietem, ale warte
  oceny UX przez reviewera.
- `CloudSyncProvider`/`CloudSyncBanner` nie mają testów jednostkowych (vitest
  działa w node bez jsdom; logika jest w czystych, przetestowanych modułach
  `plannerData`/`cloudMirror`/reduktor) — komponenty pokrywa tylko typecheck
  builda.

## Podpis schedulera

- Run: `20260716-185100-210-cloud-projects-and-tasks`
- Prompt: `210-cloud-projects-and-tasks.md`
- Gałąź review: `review-integration`
- Baza: `c4ee02eb18ec2bf371e6087c0630bd52949e61f6`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `c4ee02eb18ec2bf371e6087c0630bd52949e61f6`
- Gałąź review: `review-integration`
- Run: `20260716-185100-210-cloud-projects-and-tasks`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/App.tsx`
- `src/main.tsx`
- `src/store/AppStore.tsx`
- `src/store/exportDryRun.test.ts`
- `src/store/exportDryRun.ts`
- `src/supabase/dataImport.test.ts`
- `src/supabase/dataImport.ts`
- `src/supabase/migrations.test.ts`
- `supabase/README.md`
- `handoffs/scheduler-reviews/20260716-185100-210-cloud-projects-and-tasks.md`
- `handoffs/scheduler-reviews/210-architect-package.md`
- `src/components/CloudSyncBanner.tsx`
- `src/store/cloudMerge.test.ts`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/plannerData.ts`
- `supabase/migrations/20260716190000_planner_entities.sql`
