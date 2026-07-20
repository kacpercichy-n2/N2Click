# Raport workflow: 20260720-091840-220-cloud-sync-data-loss-verification

## Wykonane

Przebieg weryfikacyjny (tier: architect → reviewer, bez pakietu deweloperskiego).
Architekt zweryfikował read-only wszystkie 9 pozycji z promptu względem bieżącego
worktree; orkiestrator dodatkowo wyrywkowo potwierdził w kodzie trzy pozycje
o najwyższym ryzyku utraty danych (1, 2, 6). Werdykt per pozycja —
**wszystkie 9 już naprawione** przez wcześniejsze prompty 211–219,
**żadna poprawka nie była potrzebna teraz**; brak zmian w kodzie źródłowym.

| # | Pozycja | Werdykt | Dowód |
| --- | --- | --- | --- |
| 1 | Mirror effect gubi diagnostykę (`diffToCloudOps`) | już naprawione | `src/supabase/CloudSyncProvider.tsx:386-395` — `diagnostics` zasilają banner (`setDropped`) i bezwarunkowo wymuszają `retryPersistRef.current()` PRZED wczesnym `return` przy `ops.length === 0` |
| 2 | Pominięty (skip) zapis lokalny nie liczony jako „dirty” | już naprawione | `src/store/AppStore.tsx:2556-2560` (`markLocalPersistSkipped`), check czystości zawiera `wasLocalPersistSkipped()` (`:2589`) — cicha podmiana `REPLACE_FROM_STORAGE` staje się jawnym konfliktem; czyszczenie flagi po udanym zapisie i zaakceptowanym replace |
| 6 | Kolejka lustra nie przeżywa reload/flip `active` | już naprawione | `CloudSyncProvider.tsx:161-169` — trwała kolejka `n2hub.cloudQueue.v1`, `persistQueue()` po każdej mutacji (`:399`) i iteracji drenażu (`:196,205`); restore-and-drain w FAZIE 1 PRZED odczytem snapshotu (`:223-243`); dezaktywacja czyści tylko pamięć („NIE clearCloudQueue()”, `:311`) z komunikatem `planDeactivation`/`QUEUE_RESTORED_NOTICE` |
| 3 | Sonda zapisu: `work_date: null` vs częściowy unikalny indeks; osierocony wiersz 0.25h | już naprawione | `src/supabase/migrationStatus.ts:177` — `PROBE_WORK_DATE = '1970-01-01'` (wiersz datowany omija `workload_entries_bin_pair`); sprzątanie sieroty przed sondą (`:242-254`) i `remove()` niezależnie od wyniku (`:266,274`) |
| 4 | Sierota z niepoprawnym okresem odrzuca CAŁĄ hydrację; fałszywe „ready” | już naprawione | `src/supabase/plannerData.ts:295-296,310-364,392-414` — kaskadowe wykluczanie potomków; `src/supabase/hydrationOutcome.ts:33-35` wykrywa odrzucony merge po tożsamości referencji (inwariant 6), `CloudSyncProvider.tsx:280-285` ustawia wtedy `status: 'error'`, nigdy „ready” |
| 5 | Paginacja `.range()` (obcięcie na 1000 wierszy) | już naprawione | `src/supabase/dataImport.ts:79-89` — pętla `SELECT_PAGE_SIZE = 1000` ze stabilnym sortowaniem aż do wyczerpania; współdzielona przez `plannerData.ts:84-86` |
| 7 | Rozjazd polityki `impersonatorId` (coverage vs mirror) | już naprawione | `src/supabase/cloudMirror.ts:342-348` — niemapowalny impersonator jest nullowany jak przy imporcie („NIGDY porzucenie wiersza”), spójnie z coverage sprawdzającym tylko `actorId` (`migrationStatus.ts:136-141`) |
| 8 | `status_id` NULL → `''` (cicha utrata statusu) | już naprawione | `plannerData.ts:280-289` — `resolveStatus` z fallbackiem na pierwszy aktywny status lokalny; jedna strategia dla projektów (`:320`) i zadań (`:373`) |
| 9 | Denylist SUPPRESSED zamiast metadanych pochodzenia akcji | już naprawione | `src/supabase/mirrorGate.ts:19-23` — decyzja `last?.origin !== 'cloud'` (metadane, brak listy nazw); dispatche hydracji i `REPLACE_FROM_STORAGE` niosą `origin: 'cloud'` (`CloudSyncProvider.tsx:286`, `AppStore.tsx:2597,2620`) |

Tryb wycofania (retirement) pozostaje wyłączony produkcyjnie — nic go nie
włącza automatycznie; znacznik ustawia wyłącznie handshake administratora
(`applyRetirement`), a bramka dodatkowo wymaga zdrowego lustra.

Wiki: **wiki unchanged** — zero zmian w kodzie, żadna granica, inwariant ani
ścieżka testowa opisana w `openwiki/n2hub/cloud-database.md` /
`state-and-persistence.md` nie stała się nieaktualna.

## Zmiany

- Brak zmian w plikach śledzonych przez Git (tylko niniejszy raport).

## Weryfikacja

- `npm test`: **zielone — 38 plików, 1006 testów przeszło** (suita urosła
  względem 912 z treści promptu przez prompty 215–219; bez regresji).
- `npm run build`: **przeszedł** (Vite, ostrzeżenie o rozmiarze chunka >500 kB
  jak dotychczas — bez zmian względem bazy).

## Ryzyka / rzeczy do sprawdzenia

- Brak SQL-owych CHECK-ów okresu na `projects`/`tasks`
  (`supabase/migrations/20260716190000_planner_entities.sql:101-108`) —
  ryzyko utraty danych jest w pełni domknięte po stronie klienta (kaskadowe
  wykluczanie + fail-closed reduktora), więc to wyłącznie defense-in-depth;
  ewentualna przyszła migracja może dodać CHECK-i analogicznie do workload.
- Diagnostyka wykluczeń hydracji nie jest pokazywana w bannerze UI podczas
  zwykłej hydracji (`planHydrationOutcome` pomija `result.diagnostics`;
  widoczna tylko w kroku odczytu handshake'u). Bez utraty danych — wiersz w
  chmurze pozostaje nietknięty, a diff nie może wyemitować delete dla wiersza
  nieobecnego po obu stronach — to jedynie luka widoczności; opcjonalny
  mikro-follow-up.

## Podpis schedulera

- Run: `20260720-091840-220-cloud-sync-data-loss-verification`
- Prompt: `220-cloud-sync-data-loss-verification.md`
- Gałąź review: `review-integration`
- Baza: `2b14004f55fa9ab85877bac5af3741c787015c29`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `2b14004f55fa9ab85877bac5af3741c787015c29`
- Gałąź review: `review-integration`
- Run: `20260720-091840-220-cloud-sync-data-loss-verification`

### Pliki zgłoszone do review

- `handoffs/scheduler-reviews/20260720-091840-220-cloud-sync-data-loss-verification.md`
