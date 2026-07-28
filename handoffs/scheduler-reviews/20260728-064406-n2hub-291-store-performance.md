# Raport workflow: 20260728-064406-n2hub-291-store-performance

## Wykonane

Analiza wstępna potwierdziła, że zadanie NIE było jeszcze zrobione w bieżącym
buildzie: `AppStore.tsx` miał jeden `StoreContext` z wartością przebudowywaną co
akcję (`const value = useMemo(() => ({ state, dispatch, lastActionRef }), [state, dispatch])`),
a `selectors.ts` nie miał żadnego cache'u po referencji. Praca poszła tierem
`architect → developer` (reviewer należy do schedulera).

Zrealizowano wszystkie cztery kroki w OBOWIĄZKOWEJ kolejności; po każdym kroku
osobno przechodził `npx tsc --noEmit` i `npx vitest run src/store`.

**W02 — pamięć selektorów (najpierw).**
- `new: src/store/selectorCache.ts` — czysty moduł bez Reacta: `createRefCache`
  (WeakMap po referencji kolekcji), `createKeyedCache` (WeakMap po referencji
  `AppData` + klucz-string), `argsKey` i `filterKey` (`undefined` ≡ pusty zbiór).
- `src/store/selectors.ts` — prywatne indeksy per-rewizja kluczowane NAJWĘŻSZĄ
  tablicą kolekcji (`tasks`/`people`/`projects`/`clients`/`statuses` + zbiór
  done, słowniki; `workload` → po dacie, po (osoba, data), po zadaniu, zasobnik
  po osobie; `assignments` → w obie strony), więc akcja dotykająca innej
  kolekcji nie wychładza indeksu. Przepięto dokładnie nazwane w pakiecie hot
  selektory: 8 lookupów `...ById` (`getTask`/`getPerson`/`getProject`/…), szóstkę
  MonthView (`entriesForDate`, `dayTotal`, `overloadedPeopleOnDate`,
  `peopleWithBirthdayOnDate`, `recurrenceOccurrencesForDate`,
  `calendarEventsForDate`), `blocksForPersonDate`, selektory
  przypisań/zasobnika/wpisów zadania oraz pięć selektorów list Dashboardu.
  Reszta selektorów NIETKNIĘTA.
- Poprawność stoi na inwariancie 6 — zweryfikowane w kodzie: odrzucona komenda
  reduktora zwraca TĘ SAMĄ referencję stanu (`default: return state` + ~191
  miejsc `return state;`), a `mergeCloudEntities` (AppStore.tsx ~2822–2862)
  zwraca dosłownie `state` na każdej gałęzi niepoprawnego payloadu. Inwariant nie
  został osłabiony.

**W01a — split kontekstu (nie mnożenie providerów).**
`StateContext` (zmienny stan) + `StoreApiContext` (obiekt STAŁY: `dispatch`,
`lastActionRef`, `getState`, `subscribe`). Jeden provider jak dotąd.
`useStore()` zostaje jako fasada składająca oba konteksty i zachowuje sygnaturę
`{ state, dispatch, lastActionRef }`, więc niezmigrowani konsumenci zachowują się
identycznie. `lastActionRef` nadal ustawiany PRZED wejściem w reduktor.

**W01b — `useSelector` na sklepie poza Reactem.**
`new: src/store/externalStore.ts` — `createExternalStore` (instancja per
provider trzymana w ref, nigdy singleton modułu) uruchamiający TEN SAM `reducer`;
dispatch, którego wynik jest referencyjnie równy poprzedniemu stanowi, nie
powiadamia nikogo (inwariant 6 czyni odrzuconą komendę darmową). Provider czyta
przez wbudowany `useSyncExternalStore` (`useReducer` usunięty). Dodano
`useDispatch()`, `useStoreApi()` i `useSelector(selector, isEqual)` z domyślnym
`Object.is` oraz eksportowanym `shallowEqual`. Zero nowych zależności — bez
`use-sync-external-store/with-selector`.

**W01c — koniec z całym `state` w propsach memoizowanych bloków.**
`WeekView.tsx`: `state` usunięte z `BlockProps` i `BinCardProps`; zamiast niego
rodzic liczy prymitywy `status` (`taskDisplayStatus`) i `done` (`blockIsDone`) —
dokładnie tak, jak `RecurBlock` robił to już wcześniej. Odczyty stanu w
handlerach (`growAllowanceHours`, tytuł w komunikacie kolizji) idą przez
`useStoreApi().getState()`, co w momencie zdarzenia daje tę samą (lub świeższą)
wartość co dotychczasowy prop. Struktura pointer/drag, capture, cleanup,
hit-testing, payloady dispatchu, klasy CSS i DOM bez zmian.

**Zmigrowani konsumenci:** `src/store/useCan.ts`, `src/components/TodayAgenda.tsx`,
`src/components/SampleBanner.tsx` oraz trzy dispatch-only miejsca w
`WeekView.tsx` (+ `TimedBlockImpl`/`BinCardImpl` na `useDispatch`/`useStoreApi`).
**Świadomie zostają na `useStore()`:** `DashboardPage`, `CalendarPage`,
`MonthView`, `App.tsx`, `CloudSyncProvider` i pozostałe strony — pełny sweep 48
miejsc nie był wymagany w tym przejściu.

## Zmiany

Nowe pliki:
- `src/store/selectorCache.ts`, `src/store/selectorCache.test.ts`
- `src/store/externalStore.ts`, `src/store/externalStore.test.ts`
- `handoffs/PKG-20260728-store-performance.md` (pakiet architekta)

Zmodyfikowane:
- `src/store/selectors.ts`, `src/store/AppStore.tsx` (tylko region providera
  ~3940–4340; ciało reduktora nietknięte), `src/store/useCan.ts`
- `src/components/WeekView.tsx`, `src/components/TodayAgenda.tsx`,
  `src/components/SampleBanner.tsx`
- `openwiki/n2hub/state-and-persistence.md`, `handoffs/RUN-STATE.md`

`package.json` nietknięty → brak nowych zależności runtime. Reduktor bez zmian
semantycznych.

## Weryfikacja

Uruchomione i zweryfikowane bezpośrednio w tym worktree (nie tylko raport workera):

- `npm test`: **91 plików / 2003 testy — 2003 passed, 0 failed.**
  Przed zmianą było 1972; przyrost to 31 nowych przypadków w dwóch nowych
  plikach (potwierdzone: `npx vitest run src/store/selectorCache.test.ts src/store/externalStore.test.ts`
  → PASS 31 / FAIL 0).
- `npm run build`: **zielony** (`tsc --noEmit` + vite, 3211 modułów).
- `git diff --stat -- 'src/**/*.test.ts'` → **puste**: żaden istniejący plik
  testowy nie został zmodyfikowany, więc zielone suity (m.in. `selectors.test.ts`,
  `commandValidation.test.ts`, `cloudMerge.test.ts`, `blockActions.test.ts`,
  `saveTaskWorkload.test.ts`) są dowodem na niezmienioną semantykę.
- `npm run check:openwiki`: 6 plików wiki zwalidowanych.
- Grep kontrolny: żaden konsument nie mutuje wyniku cache'owanego selektora
  (`.sort(`/`.push(`/`.splice(`/`.reverse(` na wyniku) — `packDayBlocks`,
  `findFreeStart`, `planRippleInsert`, `kanbanBoard` kopiują przed sortowaniem.
- Gate (`npm test && npm run build`): oczekuje na scheduler.

Nowe testy pokrywają wymagania promptu: trafienia/chybienia cache'u przez
kolejne rewizje stanu, ten sam input → ta sama REFERENCJA wyniku, parytet z
naiwnym `.filter`/`.sort`, oraz notify tylko przy zmianie referencji, bezpieczne
wypisanie subskrybenta w trakcie powiadamiania i `shallowEqual`.

## Ryzyka / rzeczy do sprawdzenia

1. **Checki przeglądarkowe NIE zostały uruchomione.** `playwright` nie jest
   zainstalowany w tym worktree — `node scripts/browser-check-bin-drag.mjs`
   kończy się `ERR_MODULE_NOT_FOUND: playwright`. Ani `browser-check-bin-drag.mjs`,
   ani `browser-check-placement.mjs` nie wykonano i NIE twierdzimy, że przechodzą.
   W01c dotyka powierzchni inwariantu 7 (pointer/drag w `WeekView`), więc to jest
   główna zaległa weryfikacja przed release'em. Zmiana jest strukturalnie
   zachowawcza (usunięcie propa + odczyt przez `getState()` w handlerze), ale
   ryzyko jest realne i celowo zgłoszone.
2. **Cache'owane selektory oddają WSPÓŁDZIELONE tablice/zbiory.** Dziś nikt ich
   nie mutuje (zweryfikowane grepem), ale przyszły konsument, który zrobi
   `.sort()` w miejscu na wyniku selektora, uszkodzi linię cache'u. Zasada
   zapisana w wiki.
3. **Znika deweloperskie podwójne wołanie reduktora**, które robił `useReducer` w
   StrictMode. Świadomy kompromis udokumentowany w kodzie i wiki: ewentualna
   przyszła nieczystość reduktora nie zostanie już złapana przez Reacta w dev.
4. **`TodayAgenda` nadal re-renderuje się przy każdej akcji** —
   `todayAgendaForPerson` przebudowuje `timed`/`dateless` co rewizję stanu, więc
   zarówno obiekt zewnętrzny, jak i obie listy są świeżymi referencjami. To nie
   regresja, tylko brak zysku w tym jednym miejscu; `useCan` i `SampleBanner`
   korzystają w pełni.
5. **Klucze cache'u są parsowane z powrotem na argumenty** (`key.split(' ')`,
   `personFilterFromKey`). Bezpieczne, bo id to UUID-y, daty mają format
   `yyyy-MM-dd`, a filtr osób jest czytany wyłącznie przez `.has` — ale to
   nietypowy wzorzec i warto, by reviewer na niego spojrzał.
6. **Wiki zaktualizowane przez workera, nie odłożone do reviewera.**
   `openwiki/n2hub/state-and-persistence.md` dostało dwa punkty o nowych
   granicach (pamięć selektorów, granica subskrypcji) i dwie nowe trasy testowe —
   zgodnie z regułą CLAUDE.md, bo dotychczasowy opis granicy store'a stał się
   nieaktualny. Reviewer schedulera ma finalną decyzję i może to cofnąć.
7. `useSyncExternalStore` wymusza synchroniczne re-rendery aktualizacji store'a;
   jedyna funkcja concurrent w aplikacji to `useDeferredValue` na lokalnym query
   `GlobalSearch`, którego to nie dotyczy.

## Podpis schedulera

- Run: `20260728-064406-n2hub-291-store-performance`
- Prompt: `291-store-performance.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `3a61b6b58ab2945471158fabee7fe0456bd4191d`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `3a61b6b58ab2945471158fabee7fe0456bd4191d`
- Gałąź review: `review-integration`
- Run: `20260728-064406-n2hub-291-store-performance`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/components/SampleBanner.tsx`
- `src/components/TodayAgenda.tsx`
- `src/components/WeekView.tsx`
- `src/store/AppStore.tsx`
- `src/store/selectors.ts`
- `src/store/useCan.ts`
- `handoffs/PKG-20260728-store-performance.md`
- `handoffs/scheduler-reviews/20260728-064406-n2hub-291-store-performance.md`
- `src/store/externalStore.test.ts`
- `src/store/externalStore.ts`
- `src/store/selectorCache.test.ts`
- `src/store/selectorCache.ts`
