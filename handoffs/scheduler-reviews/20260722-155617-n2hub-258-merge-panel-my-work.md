# Raport workflow: 20260722-155617-n2hub-258-merge-panel-my-work

## Wykonane

Scalono widoki „Panel" (`/dashboard`) i „Moja praca" (`/my-work`) w jeden Panel.
Analiza wstępna potwierdziła, że zadanie było nadal aktualne w bieżącym buildzie
(MyWorkPage istniał, był w routingu i nawigacji). Tier workflow: trasa
`developer → reviewer` (jedna granica, testy nierozdzielne od implementacji);
werdykt reviewera: **approved, bez blockerów**.

## Zmiany

- `src/pages/DashboardPage.tsx` — sekcje „Zasobnik (nierozplanowane)" i „Alerty"
  przeniesione 1:1 z MyWorkPage jako kafle nowego rzędu 5 pod „Twój tydzień"
  (Zasobnik 2fr | Alerty 1fr, na ≤1180px jednokolumnowo). Logika/selektory
  nieprzepisane: wiersze zasobnika dalej otwierają taska przez `useOpenTask`,
  badge planowania (`PlanningBadge`) zachowany, „Zadania na dziś" niezdublowane
  (Panel już renderuje współdzielony `TodayAgendaList`). Zachowane kotwice
  onboardingu `data-tour="home.bin"` / `home.alerts`.
- `src/pages/homeRoute.ts` (nowy) — pure helper: `HOME_PATH='/dashboard'`,
  `LEGACY_MY_WORK_PATH`, `redirectTargetForPath()`.
- `src/App.tsx` — `/my-work` → `<Navigate to={HOME_PATH} replace />` (stare
  linki nie pękają); `HomeRedirect` zawsze na `HOME_PATH`; usunięte importy
  `MyWorkPage` / `landingPathForRole` / `currentUserSel`.
- `src/pages/LoginPage.tsx` — usunięty `landingPathForRole` (role homes);
  login nawiguje do `HOME_PATH`.
- `src/onboarding/OnboardingRoot.tsx` + `src/onboarding/catalog.ts` — `@home`
  zawsze na `HOME_PATH`; opisy kroków touru zaktualizowane („Panel i moja
  praca" → „Panel"); żaden krok nie prowadzi na `/my-work`.
- `src/components/navItems.ts` — usunięta pozycja „Moja praca" i nieużywany
  import ikony.
- `src/styles.css` — obszary siatki `bin`/`alerts` (grid-template-areas +
  reset mobilny); usunięty martwy `.my-work-grid`; komentarz nagłówkowy
  sekcji zaktualizowany (rząd 5 nie jest już „zarezerwowany"). Klasy
  `my-work-*` celowo zachowane jako współdzielone (chirurgiczność).
- `src/pages/MyWorkPage.tsx` — **usunięty**.
- `src/pages/homeRoute.test.ts` (nowy) — testy: jeden home `/dashboard`,
  redirect `/my-work` → `/dashboard`, inne ścieżki bez redirectu.
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — **wiki updated**: reguła
  „role homes" zastąpiona opisem jednego wspólnego Panelu (potwierdzone przez
  reviewera jako zgodne z diffem).

Store/reducer/selektory nietknięte (invariant 6 bez ryzyka); selektory sekcji
„Moja praca" w `selectors.ts` zostają — zasilają nowe kafle Panelu. Brak nowych
zależności, brak operacji git.

## Weryfikacja

- `npm test`: **1373 pass / 0 fail** (55 plików) — w tym nowy test redirectu.
- `npm run build` (tsc + vite): **zielony** (jedyne ostrzeżenie: istniejący
  rozmiar chunku, niezwiązane z zadaniem).
- Review (agent reviewer, read-only): approved; zweryfikowano identyczność
  przeniesionego JSX z `git show HEAD:src/pages/MyWorkPage.tsx`, kolejność
  hooków (`useOpenTask` przed early-return), spójność onboardingu, brak
  referencji do `/my-work` poza redirectem/CSS/komentarzami historycznymi,
  zgodność grid-template-areas z markupem. Codex: skip — brak zadeklarowanej
  polityki w pakiecie i brak artefaktu schedulera.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- `src/pages/ProjectDetailPage.tsx:213,491` — copy widoczne dla użytkownika
  nadal wspomina nazwę „Moja praca"; poza zakresem tego zadania (akceptacja
  zakazywała tylko referencji do ścieżki `/my-work`), do przyszłego przejścia
  po tekstach.
- `redirectTargetForPath()` w `homeRoute.ts` jest konsumowany tylko przez test
  (App.tsx wpina redirect bezpośrednio przez `<Navigate>`); `HOME_PATH` jest
  realnie współdzielony. Świadoma decyzja zgodna z repo-wzorcem pure-helperów.
- Poza tym: Brak.

## Podpis schedulera

- Run: `20260722-155617-n2hub-258-merge-panel-my-work`
- Prompt: `258-merge-panel-my-work.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `9cbc621d3eb8832688175bc4271ee61ddd76bb1b`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `9cbc621d3eb8832688175bc4271ee61ddd76bb1b`
- Gałąź review: `review-integration`
- Run: `20260722-155617-n2hub-258-merge-panel-my-work`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/components/navItems.ts`
- `src/onboarding/OnboardingRoot.tsx`
- `src/onboarding/catalog.ts`
- `src/pages/DashboardPage.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/MyWorkPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260722-155617-n2hub-258-merge-panel-my-work.md`
- `src/pages/homeRoute.test.ts`
- `src/pages/homeRoute.ts`
