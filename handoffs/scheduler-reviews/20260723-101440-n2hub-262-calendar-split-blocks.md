# Raport workflow: 20260723-101440-n2hub-262-calendar-split-blocks

## Wykonane

Zadanie było nadal aktualne w bieżącym buildzie — potwierdziłem, że kod scala
sąsiadujące bloki bez ochrony przed przykryciem wydarzenia. Zdiagnozowałem i
naprawiłem chirurgicznie.

**Diagnoza (która ścieżka kleiła bloki).** Scalanie żyje wyłącznie w reducerze
`setBlockTime` (`SET_BLOCK_TIME`, `AppStore.tsx` ~1685–1711); `SCHEDULE_BIN_PART`
(`scheduleBinPart`) przechodzi przez `setBlockTime`, więc dziedziczy merge.
Styczność krawędzi produkuje **auto-placement**, nie świadomy drop „na styk":
przepływ „Zaplanuj część" (planowanie 2. bloku z zasobnika) liczy domyślny start
przez `findFreeStart(blocks, dur)` (`WeekView.tsx` `initScheduleForm` ~1604 i
`onSchedDateChange` ~1634). `findFreeStart` **preferuje dostawienie zaraz za
ostatnim blokiem** (`snapped = maxEnd` zaokrąglony w górę). Gdy ostatni blok to
pierwszy blok tego samego zadania, domyślny start ląduje dokładnie na jego końcu
→ styczność → `setBlockTime` fuzuje. Wydarzenia/wystąpienia cykliczne są czysto
prezentacyjne (inwariant 1) i nigdy nie wchodzą do kolizji (`blockCollides`
czyta tylko workload), więc scalony blok po cichu przykrywał spotkanie.

**Naprawy (chirurgiczne):**
1. **Merge nie może przykryć wydarzenia** — nowy predykat
   `mergeCoversEventOrRecurrence(state, personId, date, mergedStart, mergedEnd)`
   w `selectors.ts` (person-scoped: wydarzenia osoby + ogólnofirmowe + zadania
   cykliczne, do których jest przypisana; styk krawędzi nie liczy się jako
   przykrycie). Pętla merge w `setBlockTime` pomija parę, gdy scalony przedział
   `[a.start, blockEnd(b)]` przykryłby wydarzenie/wystąpienie — zostają dwa
   osobne bloki. Restrukturyzacja pętli zachowuje terminację (zablokowana para
   nie ustawia `merged`, więc `for(;;)` się kończy) i nie rusza komunikatu
   aktywności ani `survivorId`/`mergedHours`.
2. **Merge tylko intencjonalny (placement)** — `findFreeStart` dostał opcjonalny
   3. argument `avoidTouch` (w pełni wstecznie zgodny: brak argumentu ⇒ wynik
   bajt-w-bajt jak wcześniej; seed/`SAVE_TASK`/`AppStore.tsx:788` niezmienione).
   Gdy domyślny start dotykałby krawędzi bloku tego samego zadania, preferuje
   najwcześniejszy wolny, niestykający się slot, jeśli istnieje; inaczej zwraca
   dotychczasowy. Podpięte w obu miejscach formularza „Zaplanuj część"
   (`sameTask = blocks.filter(b => b.taskId === entry.taskId)`). Świadomy drop
   „na styk" z afordancją will-merge nadal scala (ścieżka reducera bez zmian).
3. **Mirror afordancji will-merge** — żeby utrzymać kontrakt „mirror the
   reducer's merge predicate exactly" i memoizację z promptu 260, dodałem do
   modelu tygodnia indeks `eventBusyByPersonDate` (per-(person, date), zbudowany
   raz, filter-niezależny, tylko dla par z co najmniej jednym blokiem). Predykat
   will-merge (`WeekView.tsx` ~454–470) po znalezieniu stykającego sąsiada
   sprawdza scalony przedział względem tego indeksu i tłumi afordancję (nie
   uzbraja `setFusedId`), gdy przykrywa wydarzenie — bez skanu per klatkę dragu.

## Zmiany

- `src/store/selectors.ts` — nowy eksport `mergeCoversEventOrRecurrence`; import
  `rangesOverlap`.
- `src/store/AppStore.tsx` — strażnik w pętli merge `setBlockTime`; import
  predykatu.
- `src/utils/time.ts` — `findFreeStart` z opcjonalnym `avoidTouch` (skan luki
  wydzielony do współdzielonej domknięcia, bez duplikacji matematyki kolizji).
- `src/components/weekViewModel.ts` — pole `eventBusyByPersonDate` + builder
  `buildEventBusyByPersonDate`.
- `src/components/WeekView.tsx` — przekazanie same-task do `findFreeStart` w
  formularzu; przewleczenie `eventBusyByPersonDate`; mirror strażnika w
  afordancji will-merge; import `rangesOverlap`.
- `src/store/blockActions.test.ts` — 4 testy (wydarzenie w scalanym przedziale →
  brak merge, drop nadal zastosowany; wystąpienie cykliczne w przedziale → brak
  merge; brak zajętości → nadal scala; wydarzenie tylko stykające krawędź → nadal
  scala).
- `src/utils/time.test.ts` — 2 testy `avoidTouch` (wybór slotu niestykającego +
  wywołanie 2-argumentowe nadal dostawia; brak alternatywy → zostaje przy styku).
- `handoffs/RUN-STATE.md` — dopisany wpis stanu runu (konwencja jak poprzednie
  prompty, np. 259).

## Weryfikacja

- `npm test`: **1412 zielonych / 57 plików**, 0 błędów (uruchomione niezależnie
  po pracy workera).
- `npm run build`: **zielony** (tsc + vite; jedyne ostrzeżenie to istniejące
  wcześniej > 500 kB chunk, bez związku ze zmianą).
- Gate schedulera (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Strażnik merge działa na WSZYSTKICH ścieżkach `setBlockTime` (także świadomy
  drag „na styk"): drop, który przykryłby wydarzenie, nie scali się — celowe i
  zgodne z zadaniem (merge nigdy nie może przykryć wydarzenia). Afordancja
  will-merge jest tego lustrem, więc UI nie obiecuje scalenia, którego reducer
  odmówi.
- `avoidTouch` może przy zapełnionym dniu przesunąć domyślny start planowania do
  slotu nocnego (< 08:00), jeśli jedyną niestykającą opcją jest wolne miejsce
  przed godzinami pracy; użytkownik i tak edytuje start ręcznie, a świadomy drag
  nadal scala. Placementu ani modelu `WorkloadEntry` nie przepisywano.
- `eventBusyByPersonDate` liczony person-scoped i filter-niezależnie (jak
  `blocksByPersonDate`), więc mirror zgadza się z reducerem niezależnie od filtra
  widoku; budowany tylko dla par z blokiem, referencja stabilna z memo — bez
  regresji memoizacji z promptu 260.
- Inwariant 6 zachowany: niepoprawny payload nadal zwraca tę samą referencję
  stanu (strażnik jedynie pomija scalenie, nie zmienia ścieżek odrzucenia).

## Podpis schedulera

- Run: `20260723-101440-n2hub-262-calendar-split-blocks`
- Prompt: `262-calendar-split-blocks.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `4f12f963708a27c7063d51bf4aba2416b13ff9f9`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `4f12f963708a27c7063d51bf4aba2416b13ff9f9`
- Gałąź review: `review-integration`
- Run: `20260723-101440-n2hub-262-calendar-split-blocks`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/WeekView.tsx`
- `src/components/weekViewModel.ts`
- `src/store/AppStore.tsx`
- `src/store/blockActions.test.ts`
- `src/store/selectors.ts`
- `src/utils/time.test.ts`
- `src/utils/time.ts`
- `handoffs/scheduler-reviews/20260723-101440-n2hub-262-calendar-split-blocks.md`
