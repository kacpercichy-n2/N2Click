# Raport workflow: 20260718-021229-213-hydration-and-people-merge-safety

## Wykonane

Routing TierWorkflow: `developer → reviewer` (zadanie w pełni zdekomponowane w promptcie,
testy nierozłączne z implementacją). Werdykt reviewera: **approve**, bez blokerów.

Zrealizowano 3 z 5 poprawek; poprawki 3 i 4 mają **nieaktualne przesłanki** (szczegóły niżej).

1. **Kaskadowe wykluczanie potomków w hydracji** (`src/supabase/plannerData.ts`,
   `loadPlannerSnapshot`): projekt wykluczony z powodu niepoprawnego okresu odrzuca teraz
   także swoje kamienie milowe i zadania, a wykluczone zadanie (zły okres lub kaskada z
   projektu) — swoje przypisania i wiersze workload. Wcześniej osierocone wiersze potomne
   powodowały odrzucenie CAŁEGO payloadu przez walidację referencyjną reduktora, więc jeden
   zły wiersz zerował hydrację całej organizacji. Ograniczenia CHECK w SQL nie były dodawane
   (opcjonalne wg zadania); wymagana kaskada w TypeScript jest kompletna.
2. **Status hydracji świadomy wyniku merge'a** (nowy moduł `src/supabase/hydrationOutcome.ts`
   + `src/supabase/CloudSyncProvider.tsx`): czysta funkcja `planHydrationOutcome` wykrywa
   odrzucenie payloadu przez `MERGE_CLOUD_ENTITIES` po zwrocie tej samej referencji stanu
   (zaakceptowany merge zawsze zwraca nowy obiekt — detekcja jednoznaczna, potwierdzona przez
   reviewera). `runHydration` ustawia wtedy `status:'error'` z polskim komunikatem zamiast
   fałszywego `'ready'`.
3. **Fallback `statusId` przy hydracji** (`src/supabase/plannerData.ts`): `status_id`
   null/niemapowalny dostaje pierwszy aktywny (niezarchiwizowany, najniższy `order`) status
   lokalny — spójnie dla projektów i zadań. Wcześniej wiersz lądował ze `statusId: ''`
   (isDone=false), łamiąc „ukończenie z Status.isDone”. Definicja „aktywny = !archived”
   zgodna z `isOnlyActiveStatus` w AppStore.

**Poprawki 3 i 4 z promptu (empty-people fail-close, kaskada mergeCloudPeople) — przesłanki
nieaktualne, zweryfikowane niezależnie przez developera, orkiestratora i reviewera:**
`applyCloudPeople`, `mergeCloudPeople` ani `isValidCloudPersonRow` nie istnieją nigdzie w
`src/` (AppStore.tsx ma 2607 linii — wskazane ~1721/~1817 nie odpowiadają żadnemu kodowi);
`CloudMergePayload` nie zawiera kolekcji people; osoby mutują wyłącznie lokalne akcje
`ADD/UPDATE/DELETE_PERSON`; dispatch w `App.tsx` ~163 to bezpayloadowy `LOGOUT`;
`openwiki/n2hub/cloud-database.md` nie istnieje. Żadna ścieżka chmurowa nie opróżnia
`state.people`, więc opisana podatność nie ma ścieżki kodu w tej gałęzi. Dobudowanie
merge'a osób z chmury byłoby zabronionym rozszerzeniem zakresu (guardrail: people zostają
lokalne wg `state-and-persistence.md`).

## Zmiany

- `src/supabase/plannerData.ts` — kaskada wykluczeń + fallback statusu (`resolveStatus`).
- `src/supabase/hydrationOutcome.ts` — NOWY: czysta decyzja o wyniku hydracji.
- `src/supabase/CloudSyncProvider.tsx` — `runHydration` używa `planHydrationOutcome`;
  jawny polski błąd przy odrzuconym merge'u.
- `src/supabase/plannerData.test.ts` — testy regresyjne: kaskada wykluczeń (przetrwanie
  poprawnej gałęzi + dokładne zbiory ocalałych), fallback statusu (null i niemapowalny).
- `src/supabase/hydrationOutcome.test.ts` — NOWY: błąd ładowania, poprawny pusty payload
  → ready, odrzucony merge → błąd (fail-close ujawniony, nie przemilczany).

## Weryfikacja

- `npx vitest run src/supabase/plannerData.test.ts src/supabase/hydrationOutcome.test.ts
  src/store/cloudMerge.test.ts` → 37 passed, 0 failed.
- `npm test` → 32 pliki, 915 passed, 0 failed.
- `npm run build` (tsc strict + vite) → pass.
- Reviewer potwierdził, że nowe testy oblewają na starym kodzie (stary kod zachowywał
  poddrzewo wykluczonego projektu; stare `statusOf(null)` dawało `''`).
- Wiki: `wiki unchanged` — `state-and-persistence.md` pozostaje aktualne (kaskada i
  fallback to szczegóły snapshotu poniżej udokumentowanej granicy `MERGE_CLOUD_ENTITIES`;
  jawny błąd hydracji mieści się w opisanej ścieżce degradacji).

## Ryzyka / rzeczy do sprawdzenia

- Zadanie wskazujące projekt nieobecny z innego powodu niż wykluczenie okresu (naruszenie
  integralności FK upstream) nadal fail-close'uje cały payload — poza zadeklarowanym
  zakresem, ale dzięki poprawce 2 jest teraz jawnym błędem, nie cichym `ready`.
- Fallback statusu może wybrać status z `isDone=true`, jeśli najniższy niezarchiwizowany
  status jest „done” — ukończenie nadal wynika wyłącznie ze `Status.isDone`, brak złamania
  inwariantu; strategia scentralizowana w `resolveStatus`, łatwa do zaostrzenia.
- `planHydrationOutcome` uruchamia czysty reduktor dodatkowo przed dispatchem (koszt
  pomijalny, brak efektów ubocznych); teoretyczny wyścig stale-stateRef w asynchronicznej
  luce `runHydration` to wzorzec istniejący wcześniej, nie regresja.
- Prompty przyszłej kolejki dotyczące „cloud people merge” powinny najpierw zweryfikować,
  że taki podsystem w ogóle istnieje w gałęzi (przesłanki 3/4 pochodziły z innego stanu
  kodu).

## Podpis schedulera

- Run: `20260718-021229-213-hydration-and-people-merge-safety`
- Prompt: `213-hydration-and-people-merge-safety.md`
- Gałąź review: `review-integration`
- Baza: `36658896af563a57eb0bab5ceb0e6f07b1d6a475`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `36658896af563a57eb0bab5ceb0e6f07b1d6a475`
- Gałąź review: `review-integration`
- Run: `20260718-021229-213-hydration-and-people-merge-safety`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/plannerData.test.ts`
- `src/supabase/plannerData.ts`
- `handoffs/scheduler-reviews/20260718-021229-213-hydration-and-people-merge-safety.md`
- `src/supabase/hydrationOutcome.test.ts`
- `src/supabase/hydrationOutcome.ts`
