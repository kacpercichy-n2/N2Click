# Raport workflow: 20260718-022729-214-pagination-and-durable-queue

## Wykonane

TierWorkflow: architekt → dwa równoległe pakiety developerskie (rozłączne pliki)
→ finalna weryfikacja orkiestratora. Dwa refaktory domykające luki integralności
danych multi-device:

1. **Paginacja współdzielonego adaptera select (PKG-20260718-select-pagination).**
   `createSupabaseImportDb.select` w `src/supabase/dataImport.ts` iteruje teraz
   stronami `.range(offset, offset + SELECT_PAGE_SIZE - 1)` (eksportowana stała
   `SELECT_PAGE_SIZE = 1000`) aż do wyczerpania (strona krótsza niż limit kończy
   pętlę). Każda strona buduje świeże zapytanie z `.in(...)` (gdy filtr podany)
   oraz deterministycznym `.order(...)` per kolumna listy select — bez ORDER BY
   paginacja PostgREST nie jest stabilna między stronami; każda obecna lista
   kolumn zawiera klucz unikalny (`id`, `key` lub parę złożoną), więc porządek
   jest totalny. Błąd na dowolnej stronie (także ≥ 2) zwraca `{ rows: [], error }`
   — nigdy częściowy wynik. Sygnatury `ImportDb`/`PlannerDb`/`ReferenceDb` bez
   zmian, więc hydracja (`loadPlannerSnapshot`), snapshot organizacji
   (`loadOrgSnapshot`), mapa profili i import dziedziczą poprawkę bez edycji —
   pierwsze 1000 wierszy `workload_entries`/`activity_events` nie jest już
   traktowane jako pełny snapshot, a import nie zgłasza kont powyżej limitu jako
   „brak konta”.

2. **Trwała kolejka mirrora + drenaż przed hydracją (PKG-20260718-durable-cloud-queue).**
   Nowy czysty moduł `src/supabase/opQueue.ts` (wzorzec `hydrationOutcome.ts`,
   testowalny w node): koperta `{ version: 1, userId, ops }` z fail-closed
   `encodeQueue`/`decodeQueue`, `planQueueRestore` (odtworzenie kolejki tego
   samego użytkownika / odrzucenie cudzej z komunikatem), `planDeactivation`
   (kopia trwała NIGDY nie jest czyszczona przy `active → false`),
   `planHydrationStep` (`drain`/`restart`/`merge`/`give-up`,
   `MAX_HYDRATION_RESTARTS = 5`) oraz polskie komunikaty. `src/store/storage.ts`
   pozostaje jedyną granicą localStorage: dedykowany klucz `n2hub.cloudQueue.v1`
   z helperami wg konwencji markera `n2hub.cloudMigration.v1` (poza kluczem
   plannera, `clearData()` go nie dotyka). `CloudSyncProvider.tsx`: kolejka
   utrwalana po każdym enqueue i każdej iteracji `processQueue` (reszta przy
   błędzie), czyszczona po pełnym drenażu; `runHydration` najpierw odtwarza i
   drenuje trwałą kolejkę, dopiero potem czyta snapshot, a pętla
   `planHydrationStep` domyka edycje „w locie” (drenaż + ponowny odczyt) zamiast
   nadpisywać je stanem chmury; edycje w oknie `hydrating` są diffowane i
   kolejkowane zamiast wchłaniane przez `prevRef`; flip `active` czyści tylko
   kolejkę w pamięci i pokazuje komunikat o niewysłanych zmianach.
   `CloudSyncBanner.tsx` renderuje zamykalny komunikat (`notice`/`dismissNotice`
   w kontekście). Multi-tab: last-writer-wins na kluczu — opy to idempotentne
   upsert/remove, powtórzone odtworzenie konwerguje (udokumentowane w kodzie).

Wiki: zaktualizowano `openwiki/n2hub/state-and-persistence.md` (trwała kolejka
na `n2hub.cloudQueue.v1`, gwarancja paginacji odczytów, nowe trasy testowe).
Zadeklarowana w promptcie strona `openwiki/n2hub/cloud-database.md` nie
istnieje w repo — granicę chmurową dokumentuje `state-and-persistence.md`.

## Zmiany

- `src/supabase/dataImport.ts` — pętla `.range()` w adapterze select, stała
  `SELECT_PAGE_SIZE`.
- `src/supabase/dataImport.test.ts` — 5 testów paginacji (2500 wierszy → 3
  strony; równo 1000; pusta tabela; błąd na 2. stronie → `{ rows: [], error }`;
  `.in`/`.order` na każdej stronie).
- `src/supabase/opQueue.ts` (nowy) + `src/supabase/opQueue.test.ts` (nowy) —
  czysty cykl życia trwałej kolejki + testy (round-trip, fail-closed,
  restore/deactivation/hydration-step, dokładne polskie komunikaty).
- `src/store/storage.ts` + `src/store/storage.test.ts` — helpery
  `readCloudQueueRaw`/`writeCloudQueueRaw`/`clearCloudQueue` na
  `n2hub.cloudQueue.v1`; testy round-trip oraz „`clearData()` nie rusza klucza”.
- `src/supabase/CloudSyncProvider.tsx` — okablowanie: utrwalanie kolejki,
  drenaż-przed-hydracją, pętla restartów, diffowanie edycji w oknie
  `hydrating`, zachowanie kopii trwałej przy flipie `active`,
  `notice`/`dismissNotice`.
- `src/components/CloudSyncBanner.tsx` — zamykalny komunikat (stylistyka
  `persistence-banner--info`).
- `openwiki/n2hub/state-and-persistence.md` — aktualizacja granicy i tras
  testowych; `handoffs/RUN-STATE.md` — wpisy przebiegu.

## Weryfikacja

- Workerzy (testy celowane): `npx vitest run src/supabase/dataImport.test.ts
  src/supabase/plannerData.test.ts src/supabase/referenceData.test.ts` →
  3 pliki / 61 testów PASS; `npx vitest run src/supabase/opQueue.test.ts
  src/store/storage.test.ts src/supabase/cloudMirror.test.ts
  src/supabase/hydrationOutcome.test.ts` → 4 pliki / 195 testów PASS.
- Orkiestrator (pełny gate lokalnie): `npm test` → **33 pliki / 944 testy
  PASS**; `npm run build` → **PASS** (`tsc --noEmit` czysty, vite ✓;
  ostrzeżenie o rozmiarze chunka >500 kB istniało wcześniej, bez zmian).
- Grep-clean: brak nowych dostępów do localStorage poza `storage.ts`.
- Obowiązkowy gate `npm test` / `npm run build` uruchomi scheduler po
  zakończeniu procesu (lokalnie oba zielone).

## Ryzyka / rzeczy do sprawdzenia

- Deterministyczny `.order()` po każdej kolumnie listy select zakłada, że
  `columns` pozostaje płaską listą rozdzieloną przecinkami (prawda dla
  wszystkich obecnych wywołań; udokumentowane komentarzem w adapterze). Listy
  z embedded/aliasowanymi kolumnami wymagałyby zmiany parsera.
- Multi-tab dla `n2hub.cloudQueue.v1` to świadome last-writer-wins — opy są
  idempotentne, więc powtórne odtworzenie konwerguje, ale dwie karty zamykane
  jednocześnie z różnymi niewysłanymi opami mogą nadpisać sobie kopię trwałą
  (wąskie okno, brak blokady cross-tab z założenia).
- Odrzucenie kolejki innego użytkownika (`QUEUE_FOREIGN_DROPPED`) jest celowe —
  opy nigdy nie są odtwarzane pod cudzą sesją; zmiany poprzedniego użytkownika
  przepadają z jawnym komunikatem, nie po cichu.
- Zadeklarowana strona wiki `openwiki/n2hub/cloud-database.md` nie istnieje —
  do decyzji recenzenta: utworzyć ją czy dalej prowadzić granicę chmurową w
  `state-and-persistence.md` (na teraz zaktualizowano tę drugą).
- Poza zakresem (osobne prompty w kolejce, nieruszone): batching importu,
  unifikacja row-mapperów.

## Podpis schedulera

- Run: `20260718-022729-214-pagination-and-durable-queue`
- Prompt: `214-pagination-and-durable-queue.md`
- Gałąź review: `review-integration`
- Baza: `ca1c4326fd73fbfac26a392d7442cbec7c2d3cdf`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `ca1c4326fd73fbfac26a392d7442cbec7c2d3cdf`
- Gałąź review: `review-integration`
- Run: `20260718-022729-214-pagination-and-durable-queue`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/components/CloudSyncBanner.tsx`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/dataImport.test.ts`
- `src/supabase/dataImport.ts`
- `handoffs/scheduler-reviews/20260718-022729-214-pagination-and-durable-queue.md`
- `src/supabase/opQueue.test.ts`
- `src/supabase/opQueue.ts`
