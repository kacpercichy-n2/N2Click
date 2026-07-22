# Raport workflow: 20260722-161131-n2hub-259-perf-persist-coalescing

## Wykonane

Analiza wstępna potwierdziła, że wszystkie trzy hotspoty z promptu nadal
istniały w bieżącym buildzie. Trasa tier: developer → reviewer (pojedyncza
granica: warstwa persystencji providera).

1. **Koalescencja zapisu localStorage.** Nowy czysty moduł
   `src/store/persistCoalescer.ts` (fabryka `createPersistCoalescer`:
   `schedule`/`flush`/`cancel`/`hasPending`, okno `PERSIST_COALESCE_MS = 1000`,
   trailing bez restartu timera — ograniczona latencja przy seriach dispatchy,
   np. drag). Efekt `[state]` w `AppStore.tsx` zamiast synchronicznego
   `saveData(state)` woła `coalescer.schedule(state)`; zapis wykonuje się raz,
   z NAJNOWSZYM stanem.
2. **Zachowana semantyka save/conflict (identyczna):**
   - `skipPersistRef`/`lastPersistAttemptRef` (pominięcie pierwszego zapisu po
     load/REPLACE_FROM_STORAGE, ochrona StrictMode) — bez zmian, per przejście;
   - bramka `shouldSkipLocalPersist` nadal liczona per przejście; przejście
     bramkowane nie dotyka starszego pending (odpowiada staremu światu, gdzie
     starszy stan był już zapisany);
   - cykl `saveError`: `onResult` robi dokładnie to co stary efekt
     (`setSaveError`, sukces kolapsuje konflikt zewnętrzny do `none` —
     udokumentowany implicit keep-mine); dodatkowo eager zapis do
     `saveErrorRef`, by callback storage-event odczytał wynik synchronicznego
     flusha w tym samym ticku;
   - natychmiastowy flush: `pagehide`, `visibilitychange(hidden)`, cleanup przy
     odmontowaniu (StrictMode-safe — prześledzono double-mount, repair
     writeback zapisany dokładnie raz, brak echa), `retryPersist` i `keepLocal`
     (cancel pending → zapis bieżącego stanu jak dotąd), oraz flush PRZED
     odczytem porównującym storage w callbacku zmiany zewnętrznej
     (`subscribeExternalChanges` max-merguje rewizję przed callbackiem, więc
     flush ląduje ponad rewizją zewnętrzną); `acceptExternal` anuluje pending
     (użytkownik wybrał wersję zewnętrzną).
3. **Tanie porównanie zmiany zewnętrznej:** w `storage.ts` dodatkowo śledzone
   `lastWrittenRaw`/`lastWrittenRevision` (ustawiane tylko przy udanym
   `saveData`, zerowane w `clearData`) + `isOwnLastWrite(newValue)` (bajtowe
   porównanie raw, potem rewizja koperty przez `readEnvelopeRevision`);
   `ExternalChangeInfo` rozszerzone addytywnie o `newValue`. Pełne porównanie
   `JSON.stringify` zostało jako fallback zgodności.
4. **`registerPersonOrder`:** nadal w renderze (kolory poprawne przy pierwszym
   paincie), ale strażowane referencją `state.people` — liczone tylko przy
   zmianie tożsamości tablicy.
5. Wiki: `openwiki/n2hub/state-and-persistence.md` — **wiki updated**
   (granica persystencji realnie się zmieniła: nota o koalescencji, triggerach
   flush i fast-path porównania; reviewer zweryfikował każdą tezę z kodem).

Bez zmian w reducerach, formacie danych (DATA_VERSION 7), `persistGate.ts`,
stringach użytkownika; invariant 6 nietknięty.

## Zmiany

- `src/store/persistCoalescer.ts` (nowy) — koalescer zapisu.
- `src/store/persistCoalescer.test.ts` (nowy) — testy cyklu persystencji.
- `src/store/storage.ts` — śledzenie ostatniego zapisu, `isOwnLastWrite`,
  `ExternalChangeInfo.newValue`.
- `src/store/storage.test.ts` — testy nowych ścieżek.
- `src/store/AppStore.tsx` — okablowanie koalescer + flush triggery, strażnik
  `registerPersonOrder`, fast-path porównania zewnętrznego.
- `openwiki/n2hub/state-and-persistence.md` — nota o koalescencji.

## Weryfikacja

- Testy pisane NAJPIERW (warstwa krytyczna): `persistCoalescer.test.ts`
  pokrywa koalescencję (N schedule → 1 zapis najnowszego, timer bez restartu),
  flush/cancel, błąd zapisu → późniejszy sukces, sekwencje StrictMode-shaped
  i pagehide-shaped; `storage.test.ts` pokrywa śledzenie ostatniego zapisu
  (nieudany zapis NIE aktualizuje, reset w `clearData`) i wszystkie gałęzie
  `isOwnLastWrite`.
- `npm test`: 56 plików, **1393 testy, 0 porażek** (uruchomione przez
  developera i niezależnie przez reviewera).
- `npm run build`: zielony (jedynie istniejące wcześniej ostrzeżenie o chunku
  >500 kB).
- Review (read-only reviewer): **APPROVE, zero blockerów**; wszystkie kryteria
  akceptacji PASS; prześledzone ścieżki data-loss (clearData/ErrorBoundary,
  StrictMode, kolejność rewizji przy flushu w callbacku, bramka retirement).
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Odwrócenie kierunku keep-mine w wąskim oknie (≤1 s): zapis zewnętrzny
  przychodzący, gdy lokalny zapis wisi w koalescerze, jest nadpisywany przez
  flush (wygrywa lokalny), podczas gdy stary świat w analogicznym timingu
  odświeżał do wersji zewnętrznej. Obie ścieżki to ten sam istniejący wyścig
  last-writer-wins; konflikt jawny dla „brudnej” karty w pełni zachowany
  (nieudany flush spada do dirty-check → banner). Zaakceptowane przez review.
- Kolizja rewizji między kartami w oknie doręczenia storage-event
  (fast-path `isOwnLastWrite` po rewizji) — ta sama klasa wyścigu co stary
  świat synchroniczny; rozjazd leczy się jawnie przy następnym zapisie.
- Błąd zapisu wykryty dopiero przy flushu na `pagehide` przychodzi po
  `beforeunload`, więc prompt unload dla tego konkretnego zapisu nie zdąży;
  trwały `saveError` + `retryPersist` nadal ujawniają każdy błąd — `Zapisano`
  nigdy nie zostaje po znanej porażce.

## Podpis schedulera

- Run: `20260722-161131-n2hub-259-perf-persist-coalescing`
- Prompt: `259-perf-persist-coalescing.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `0d5aa68b8f62c866639d06a7beed62ffbfc0b6b0`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `0d5aa68b8f62c866639d06a7beed62ffbfc0b6b0`
- Gałąź review: `review-integration`
- Run: `20260722-161131-n2hub-259-perf-persist-coalescing`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/store/AppStore.tsx`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `handoffs/scheduler-reviews/20260722-161131-n2hub-259-perf-persist-coalescing.md`
- `src/store/persistCoalescer.test.ts`
- `src/store/persistCoalescer.ts`
