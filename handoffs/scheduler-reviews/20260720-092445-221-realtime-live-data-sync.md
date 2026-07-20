# Raport workflow: 20260720-092445-221-realtime-live-data-sync

## Wykonane

Workflow tier: architect → developer → reviewer (pakiet
`handoffs/packages/PKG-20260720-realtime-live-sync.md`, ryzyko: high, Codex
review: required — uruchamia scheduler po zakończeniu tego procesu).

1. **Weryfikacja ręcznego odświeżania** — wszystkie poprawki z promptu 220 są
   obecne w kodzie (reset `mountedRef`, filtrowanie sierot kaskady, status
   zależny od wyniku merge, trwała/drenowana kolejka). Ręczne odświeżanie nie
   wymagało naprawy; domknięto jedynie lukę reentrancji (`refresh()` w trakcie
   `'hydrating'`) nowym guardem `hydratingRef`.
2. **Supabase Realtime** — nowy czysty moduł `src/supabase/realtimeSync.ts`
   (wzorzec opQueue/mirrorGate): jeden kanał `postgres_changes` na 13 tabel
   (8 planera: clients, projects, milestones, tasks, task_assignments,
   workload_entries, comments, activity_events + 5 słownikowych: profiles,
   departments, statuses, service_types, work_categories). Zdarzenia DB są
   koalescowane debouncerem (trailing 1000 ms, max-wait 5000 ms) w jedno ciche
   ponowne pobranie snapshotu przez istniejącą ścieżkę
   `loadPlannerSnapshot` → `planHydrationOutcome` → `MERGE_CLOUD_ENTITIES`
   (`origin: 'cloud'`) — bez patchowania wierszy, więc walidacja, filtrowanie
   kaskad i inwariant 6 (niepoprawny payload = ta sama referencja stanu) są
   reużyte. Ciche odświeżenie nie miga statusem `'hydrating'`, gdy stan jest
   już `'ready'`.
3. **Zapisy optymistyczne i echo** — lokalne edycje idą jak dotąd przez cloud
   mirror; odświeżenie realtime jest odraczane, dopóki własne operacje są w
   kolejce/drenowane, i ponownie uzbrajane po drenie. Merge `origin:'cloud'`
   jest idempotentny (testy echo w `cloudMerge.test.ts`), a `mirrorGate`
   zatrzymuje re-propagację. W trakcie cichej hydratacji dren kolejki po
   stronie mirrora jest bramkowany (`shouldMirrorProcessQueue`), więc jedyną
   ścieżką merge snapshotu pozostaje pętla dren-przed-merge — edycja w trakcie
   odświeżenia nie może zostać nadpisana starym snapshotem.
4. **Zdarzenia słownikowe** — nieniszczący reload w tle: nowa czysta maszyna
   stanów `src/supabase/orgReload.ts` + `backgroundReload()` w
   `OrgDataProvider.tsx` (poprzedni snapshot `'ready'` zostaje do czasu
   atomowej podmiany; `active` nie miga, kolejka/kanał nietknięte); zmiana
   referencji snapshotu wyzwala jedno ciche ponowne zhydratowanie.
5. **Baner** — komunikat „Dane mogą być nieaktualne — odśwież dane z serwera”
   jest ukryty, gdy kanał realtime jest aktywny (`SUBSCRIBED` → `live`);
   przy CHANNEL_ERROR/TIMED_OUT/CLOSED baner i ręczne odświeżanie wracają jako
   fallback; ponowna subskrypcja po przerwie wykonuje jedno odświeżenie
   nadrabiające. Kanał jest odtwarzany wyłącznie przy zmianie użytkownika,
   dezaktywacji i unmount (handlery za refami — brak migotania `live=false`).
6. **Migracja publikacji** — idempotentna
   `supabase/migrations/20260720120000_realtime_publication.sql` dodaje 13
   tabel do publikacji `supabase_realtime` (tylko publikacja, bez zmian
   schematu/RLS).

**Wymagane działanie operatora (aktywacja Realtime na projekcie Supabase)** —
jedno z:

- `supabase db push` (lub własny runner migracji) — migracja jest idempotentna;
- SQL editor w dashboardzie: `alter publication supabase_realtime add table
  public.<tabela>;` dla 13 tabel wymienionych wyżej;
- Dashboard → Database → Publications → `supabase_realtime` → włączyć te same
  13 tabel.

Do czasu włączenia publikacji aplikacja degraduje się łagodnie: kanał nie
przechodzi w `SUBSCRIBED`, `live` pozostaje false, baner i ręczne odświeżanie
działają jak dotychczas — bez crasha. Realtime respektuje RLS (klient dostaje
tylko wiersze, które i tak może czytać).

## Zmiany

- `src/supabase/realtimeSync.ts` + `realtimeSync.test.ts` (nowe) — czyste
  decyzje realtime: tabele, mapowanie statusu kanału, predykat banera,
  debounce/koalescencja/odraczanie, `shouldMirrorProcessQueue`, adapter
  `subscribePlannerChannel` (testowany z mockiem kanału).
- `src/supabase/orgReload.ts` + `orgReload.test.ts` (nowe) — maszyna stanów
  cichego reloadu słowników.
- `src/supabase/CloudSyncProvider.tsx` — kanał na użytkownika, ciche
  odświeżenie w tle, guard reentrancji hydratacji, bramka drenu mirrora,
  `live` w `CloudSyncValue`, odświeżenie nadrabiające po re-subskrypcji.
- `src/supabase/OrgDataProvider.tsx` — `backgroundReload()` (zadeklarowane
  rozszerzenie kontekstu, zapisane w RUN-STATE.md).
- `src/components/CloudSyncBanner.tsx` — baner nieaktualności bramkowany
  `showStaleHint({status, pendingCount, live})`; pozostałe warianty bez zmian.
- `supabase/migrations/20260720120000_realtime_publication.sql` (nowa) —
  idempotentna publikacja realtime.
- `src/supabase/migrations.test.ts`, `src/store/cloudMerge.test.ts` — testy
  (lista migracji; idempotencja echa merge).
- `openwiki/n2hub/cloud-database.md` — zaktualizowana granica odczytu (kanał
  realtime, degradacja, migracja publikacji). Decyzja recenzenta: `wiki
  updated`; `state-and-persistence.md` celowo bez zmian.
- `handoffs/packages/PKG-20260720-realtime-live-sync.md`, `handoffs/RUN-STATE.md`
  — pakiet i indeks bieżącego runu.

## Weryfikacja

- Worker/reviewer: `npx vitest run src/supabase src/store` → 858 pass / 0 fail
  (przebieg powtórzony niezależnie przez recenzenta).
- Worker: `npm test` → 40 plików, 1044 pass / 0 fail (baza przed zmianą była
  już powyżej 912 z promptu; ~45 nowych testów, zero regresji).
- Worker: `npm run build` (`tsc --noEmit && vite build`) → czysty.
- Recenzent (Fable, read-only): pierwsza runda `changes-required` (2 blokery:
  wyścig drenu przy cichej hydratacji; niszczący reload słowników) — oba
  naprawione i potwierdzone w re-review → werdykt `approve`, brak blokerów.
- Testy przeglądarkowe pominięte świadomie: brak żywego backendu Supabase w
  środowisku workera; matryca należy do weryfikacji wydaniowej.
- `npm test` / `npm run build` w gate: oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- **Aktywacja po stronie operatora**: bez zastosowania migracji publikacji
  live-sync się nie włączy (aplikacja świadomie degraduje się do banera +
  ręcznego odświeżania). To jedyne działanie wymagane poza repo.
- **Brak testu end-to-end z żywym kanałem**: pełne potwierdzenie
  „zdarzenie `postgres_changes` → dokładnie jeden cichy merge bez migotania”
  wymaga żywego Supabase; logika jest pokryta testami czystych modułów.
- **Usunięcia zdalne**: istniejący `mergeById` zachowuje wiersze lokalne
  nieobecne w snapshot'cie, więc DELETE z innego klienta nie znika na żywo u
  odbiorcy (zachowanie identyczne jak dotychczasowe ręczne odświeżanie; warte
  osobnej decyzji produktowej).
- **Koszt echa**: każda własna edycja wyzwala po debounce jedno pełne pobranie
  snapshotu (13 tabel, paginowane) ~1–6 s później; przy obecnej skali danych
  akceptowalne, warte obserwacji.
- **Ciche błędy reloadu słowników w tle**: przy błędzie w tle zostaje stary,
  używalny snapshot bez banera — sygnałem nieaktualności pozostaje status
  kanału (`live`).
- Punkty do niezależnego przeglądu Codex (wymagany, uruchamia scheduler):
  kompletność bramki drenu B1 (okno mikrotasków `retry()`), kolejność trybów
  `orgReload` przy seriach `backgroundReload` i wylogowaniu, poleganie na
  bail-out `setState` przy tej samej referencji, okno zdarzeń przed pierwszym
  `SUBSCRIBED` (pokrywane przez hydratację startową).

## Podpis schedulera

- Run: `20260720-092445-221-realtime-live-data-sync`
- Prompt: `221-realtime-live-data-sync.md`
- Gałąź review: `review-integration`
- Baza: `84bf2115cf2f6c942a67057f205748fdaa635a2f`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `84bf2115cf2f6c942a67057f205748fdaa635a2f`
- Gałąź review: `review-integration`
- Run: `20260720-092445-221-realtime-live-data-sync`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `src/components/CloudSyncBanner.tsx`
- `src/store/cloudMerge.test.ts`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/OrgDataProvider.tsx`
- `src/supabase/migrations.test.ts`
- `handoffs/packages/PKG-20260720-realtime-live-sync.md`
- `handoffs/scheduler-reviews/20260720-092445-221-realtime-live-data-sync.md`
- `src/supabase/orgReload.test.ts`
- `src/supabase/orgReload.ts`
- `src/supabase/realtimeSync.test.ts`
- `src/supabase/realtimeSync.ts`
- `supabase/migrations/20260720120000_realtime_publication.sql`
