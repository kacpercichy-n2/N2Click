# Raport workflow: 20260803-180004-n2hub-312-contentplan-domena-i-store

## Wykonane

Faza R2 modułu Content Plan: warstwa domeny i store, bez UI. Analiza wstępna potwierdziła, że zadanie było nadal otwarte (brak `src/contentplan/` i slice'ów w `AppData`; z fazy R1 istniały tylko migracje SQL). Workflow tier: `developer → reviewer` (reviewer po stronie schedulera).

- **`src/contentplan/domain.ts` (nowy)** — czysta domena przeniesiona ze źródłowej appki: 7 polskich statusów, helpery klucza miesiąca (oparte o `utils/dates.ts`, bez duplikacji logiki dat), grupy opisów i tagi, `validatePostForPublication`, `makeEmptyPost`, `flattenCommentReplies`, drafty `ContentPlanBrandDraft`/`ContentPlanPostDraft` oraz dwa poziomy walidacji: `normalize*Draft` (STRICT, dla reduktora) i `sanitize*` (łagodna, dla storage).
- **`src/types.ts`** — encje `ContentPlanBrand`/`ContentPlanPost`/`Channel`/`Media`/`Comment`/`HistoryEntry`/`Platform`/`Status`/`Visibility` + slice'y `contentPlanBrands` i `contentPlanPosts` w `AppData`. Zgodnie z wymogiem media kanału to wyłącznie `{source:'gdrive', fileId, width?, height?, type}` — pola base64 (`assetPreview`/`assetName`) i limit 4 MB usunięte; base64 odrzuca zarówno reduktor, jak i sanitizer (testy na obu granicach).
- **`src/store/storage.ts`** — `emptyData()` z nowymi slice'ami, `repairContentPlan` wpięty po `repairNotifications` w obu ścieżkach wczytania. BEZ bumpu `DATA_VERSION` (kolekcje czysto addytywne, precedens events/tickets/notifications).
- **`src/store/AppStore.tsx`** — 7 akcji: `SAVE_CP_BRAND`, `DELETE_CP_BRAND` (kaskada postów marki), `SAVE_CP_POST`, `DELETE_CP_POST`, `REVIEW_CP_POST`, `PUBLISH_CP_MONTH`, `ADD_CP_COMMENT`; każdy niepoprawny ładunek zwraca tę samą referencję stanu (inwariant 6).
- **`src/store/selectors.ts`** — `contentPlanPostsForMonth` (marka+miesiąc) i `contentPlanMonthStats` (liczniki statusów), oba przez `createKeyedCache`.
- **`src/store/seed.ts`**, **`src/store/persistGate.ts`** — puste slice'y w danych demo; oba klucze w `NON_MIRRORED_KEYS` (brak jeszcze domu w chmurze — do przeniesienia w R8).
- Sync chmurowy (`MERGE_CLOUD_CP_*`), UI, trasy, Supabase i Google świadomie poza zakresem — zgodnie z promptem. Tryb retirement pozostaje wyłączony.

Odstępstwa od źródła: status „Wdrazane poprawki” poprawiony na „Wdrażane poprawki” (string użytkownika); dodane `createdAt`/`updatedAt` na marce i publikacji (precedens `Ticket`/`CalendarEvent`, spójne z tabelami z R1); `PUBLISH_CP_MONTH` stempluje tylko szkice, dzięki czemu ponowna publikacja miesiąca jest czystym no-opem z tą samą referencją; pole `clientId` marki (decyzja 5 planu) odroczone do R1/R8.

## Zmiany

- Nowe: `src/contentplan/domain.ts`, `src/contentplan/domain.test.ts`, `src/store/contentPlanActions.test.ts`, `src/store/contentPlanStorage.test.ts`, `src/store/contentPlanSelectors.test.ts`.
- Zmienione: `src/types.ts`, `src/store/AppStore.tsx`, `src/store/storage.ts`, `src/store/selectors.ts`, `src/store/seed.ts`, `src/store/persistGate.ts`, `openwiki/n2hub/state-and-persistence.md`, `handoffs/RUN-STATE.md`.
- Wiki: **zaktualizowana** — nowy wpis „CONTENT PLAN — DOMENA I STORE (2026-08-03)” w `state-and-persistence.md` (granice modułu, addytywność bez bumpu wersji, zakaz base64, semantyka akcji, selektory) + nowe pliki testów w „Relevant tests”; `npm run check:openwiki` zielony.

## Weryfikacja

- 139 nowych testów w 4 plikach: domena (75, w tym port testów źródłowych `domain.test.ts` z adaptacją do mediów gdrive), reduktor (42 — inwariant 6 dla każdej z 7 akcji: niepoprawny ładunek ⇒ `toBe(state)`, poprawny ⇒ nowa referencja + oczekiwany wynik), storage/sanitizer (10 — repair uszkodzonego slice'a, legacy bez slice'ów, brak echo-write), selektory (12 — wartości i stabilność referencji cache).
- `npm test`: **111 plików / 2476 testów zielone** (baza 107/2337 — zero regresji), zweryfikowane niezależnie przez orkiestratora.
- `npm run build`: **zielony** (`tsc --noEmit` + `vite build`), zweryfikowane niezależnie.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Kształty `ContentPlanPost`/`ContentPlanBrand` są kontraktem dla R1 (SQL) i R8 (mirror) — przed R8 porównać nazewnictwo kolumn (np. `n2click_client_id`, identyfikatory grup opisów); mapowanie zrobi adapter, ale warto to zweryfikować świadomie.
- `ADD_CP_COMMENT` i `REVIEW_CP_POST` wymagają `visibility: 'published'` (parytet ze źródłem). Jeśli R5 ma pozwolić komentować szkice, potrzebna jednolinijkowa zmiana strażnika + test.
- Pierwsze wczytanie starego zapisu wykona jednorazowy write-back (dwa nowe klucze) — zachowanie identyczne jak przy dodaniu events/tickets.

## Podpis schedulera

- Run: `20260803-180004-n2hub-312-contentplan-domena-i-store`
- Prompt: `312-contentplan-domena-i-store.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `2bc7f3a0dd257ffb2e630dfc159eaa7751d3a783`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `2bc7f3a0dd257ffb2e630dfc159eaa7751d3a783`
- Gałąź review: `review-integration`
- Run: `20260803-180004-n2hub-312-contentplan-domena-i-store`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/store/AppStore.tsx`
- `src/store/persistGate.ts`
- `src/store/seed.ts`
- `src/store/selectors.ts`
- `src/store/storage.ts`
- `src/types.ts`
- `handoffs/scheduler-reviews/20260803-180004-n2hub-312-contentplan-domena-i-store.md`
- `src/contentplan/`
- `src/store/contentPlanActions.test.ts`
- `src/store/contentPlanSelectors.test.ts`
- `src/store/contentPlanStorage.test.ts`
