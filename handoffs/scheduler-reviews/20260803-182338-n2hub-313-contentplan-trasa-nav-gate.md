# Raport workflow: 20260803-182338-n2hub-313-contentplan-trasa-nav-gate

## Wykonane

Faza R3 modułu Content Plan: wpięcie trasy `/content-plan` w nawigację z gatingiem
modułowym (tier workflow, trasa `developer -> reviewer`). Warstwa domeny z promptu 312
(`src/contentplan/domain.ts` + slice'y `contentPlan*` w AppStore/selectors/storage)
została zweryfikowana jako obecna, więc zadanie wykonano w całości.

1. **Trasa i nawigacja**: wpis `['/content-plan', 'Content plan', CalendarRange]`
   w `src/components/navItems.ts` (ikona `CalendarRange` dodana do barrela
   `src/components/icons.ts`), loader `'/content-plan'` + lazy `ContentPlanPage`
   w `src/pages/routeChunks.ts` (osobny chunk 1,46 kB potwierdzony w buildzie),
   `<Route>` w `src/App.tsx` dokładnie wzorcem `/admin`
   (`canContentPlan ? <ContentPlanPage /> : <Navigate ... />`). `NAV_LABELS`
   pobiera etykietę automatycznie z `NAV`.
2. **Gating**: nowy czysty moduł `src/pages/contentPlanScope.ts` z
   `canViewContentPlan(user, moduleAccess)` i stałą `CONTENT_PLAN_ROLES =
   ['administrator']` (decyzja operatora 2026-08-03: wyłącznie administratorzy).
   Rola pochodzi z CloudRole ze snapshotu OrgDataProvider (frontend nie czyta JWT);
   fallbacki jak przy `/team`: tryb lokalny / ładowanie / błąd / brak profilu =>
   lokalna `accessRole` (`pelne` => administrator). Parametr `moduleAccess`
   (rola z `contentplan.my_access` lub `null`) jest przyjmowany, ale świadomie
   nieczytany, więc przyszła zmiana kryterium to zmiana jednej funkcji.
   Świadomie NIE użyto `effectiveAccessRole`, bo mapuje chmurowego `manager` na
   `pelne` i menedżer przeszedłby bramkę wbrew decyzji. Wpięcie: filtr `navPaths`
   w `App.tsx`, `<Navigate>` na trasie oraz samo-guard strony. Cienki hook
   `src/contentplan/useContentPlanAccess.ts` daje jedno wyliczenie bramki dla
   wszystkich powierzchni.
3. **Strona**: `src/pages/ContentPlanPage.tsx` jako szkielet: klasa `.page`,
   nagłówek, pager miesięcy ze stanem w URL `?m=YYYY-MM` (czysty moduł
   `src/pages/contentPlanRoute.ts` oparty o `contentplan/domain.ts` i
   `utils/dates.ts`, nawigacja z `replace: true`), pusty stan `.empty-state`
   po polsku. Zero nowego CSS (reużyte `page-head`, `cal-nav`, `empty-state` itd.).
4. **Rozszerzenie kontekstu (celowe, odnotowane)**: wpis w `NAV` automatycznie
   zasila paletę Ctrl+K (`globalSearchModel.ts`/`GlobalSearch.tsx`) i edytor
   kolejności menu (`NavOrderEditor.tsx`) — obie powierzchnie lustrzanie bramkują
   `/admin` i `/team`, więc bez zmiany worker widziałby w palecie akcję prowadzącą
   do przekierowania. Wpięto tam tę samą bramkę; nowy parametr
   `canContentPlan` w katalogu akcji jest opcjonalny z domyślnym `false`.
5. **Wiki**: `openwiki/n2hub/ui-navigation-and-onboarding.md` zaktualizowane
   (wiki updated) — opis listy `NAV` mówił o dwóch bramkowanych pozycjach na
   końcu, po zmianie są trzy.

Reduktory nietknięte (inwariant 6); dostęp do store wyłącznie do odczytu.
Tryb retirement bez zmian. Bez Supabase i Google (out of scope R3).

## Zmiany

- Nowe: `src/pages/contentPlanScope.ts` + test, `src/pages/contentPlanRoute.ts`
  + test, `src/pages/ContentPlanPage.tsx`, `src/contentplan/useContentPlanAccess.ts`.
- Zmodyfikowane: `src/App.tsx`, `src/components/navItems.ts`,
  `src/components/icons.ts`, `src/pages/routeChunks.ts`,
  `src/components/globalSearchModel.ts` (+test), `src/components/GlobalSearch.tsx`,
  `src/components/NavOrderEditor.tsx`,
  `openwiki/n2hub/ui-navigation-and-onboarding.md`, `handoffs/RUN-STATE.md`.

## Weryfikacja

- Testy celowane: `npx vitest run src/pages/contentPlanScope.test.ts
  src/pages/contentPlanRoute.test.ts src/components/globalSearchModel.test.ts
  src/components/bottomNav.test.ts src/utils/navOrder.test.ts` => 65 passed, 0 failed.
- `npm test` => 113 plików / 2494 testy zielone (po 312 było 111/2476; +18 testów,
  zero regresji).
- `npm run build` (`tsc --noEmit && vite build`) => zielony.
- `npm run check:openwiki` => zielony.
- `navOrder.test.ts` i `bottomNav.test.ts` nie wymagały zmian: asercje relatywne,
  a `applyNavOrder` samo dopisuje nową ścieżkę do zapisanych kolejności
  (migracja `uiPrefs` zbędna).
- Kontrola em/en-dash: występują wyłącznie w komentarzach kodu; wszystkie stringi
  widoczne dla użytkownika po polsku i bez pauz.
- Gate (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Okno fallbacku w trybie supabase: zanim snapshot organizacji będzie `ready`,
  chmurowy menedżer z lokalną rolą `pelne` może przez moment widzieć pozycję menu.
  To identyczne zachowanie jak przy `/team`; trasa i samo-guard strony odsyłają go
  po dojściu snapshotu. Odnotowane w komentarzu modułu.
- Browser check nie uruchamiany: nowa trasa nie zmienia żadnej pokrytej interakcji
  (pełna matryca należy do weryfikacji release).
- Gating jest wyłącznie UX/data-integrity, nie granicą bezpieczeństwa; autoryzacja
  właściwa pozostaje w RLS (`contentplan.*`), poza zakresem tej fazy.

## Podpis schedulera

- Run: `20260803-182338-n2hub-313-contentplan-trasa-nav-gate`
- Prompt: `313-contentplan-trasa-nav-gate.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `799a8fd836936b023e10a3547e828c1145456a42`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `799a8fd836936b023e10a3547e828c1145456a42`
- Gałąź review: `review-integration`
- Run: `20260803-182338-n2hub-313-contentplan-trasa-nav-gate`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/components/GlobalSearch.tsx`
- `src/components/NavOrderEditor.tsx`
- `src/components/globalSearchModel.test.ts`
- `src/components/globalSearchModel.ts`
- `src/components/icons.ts`
- `src/components/navItems.ts`
- `src/pages/routeChunks.ts`
- `handoffs/scheduler-reviews/20260803-182338-n2hub-313-contentplan-trasa-nav-gate.md`
- `src/contentplan/useContentPlanAccess.ts`
- `src/pages/ContentPlanPage.tsx`
- `src/pages/contentPlanRoute.test.ts`
- `src/pages/contentPlanRoute.ts`
- `src/pages/contentPlanScope.test.ts`
- `src/pages/contentPlanScope.ts`
