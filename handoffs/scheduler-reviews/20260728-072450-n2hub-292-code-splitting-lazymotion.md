# Raport workflow: 20260728-072450-n2hub-292-code-splitting-lazymotion

Ścieżka tierowa: `developer → reviewer`. Ryzyko: `medium`.
Codex review: `conditional` — nie uruchomiony (reviewer nie zgłosił
`codex-requested`: brak niezadeklarowanego rozszerzenia granic, wszystkie
wątpliwości rozstrzygnięte read-only).

## Wykonane

Analiza wstępna: **żaden** z sześciu punktów nie był obecny w bieżącym buildzie
(brak `React.lazy`/`Suspense`, `vite.config.ts` zawierał wyłącznie plugin
`react()`, zero `LazyMotion`/`domAnimation`, `layout` nadal na karcie Kanbanu).
Zaimplementowano wszystkie sześć.

Uwaga terminologiczna: biblioteką animacji w tym repozytorium jest pakiet
`motion` v12 (import z `motion/react`), nie `framer-motion` — audyt opisywał ten
sam kod pod starą nazwą.

1. **Leniwe trasy + Suspense + prefetch.** Nowy plik `src/pages/routeChunks.ts`
   trzyma jedno źródło prawdy: mapę `ROUTE_LOADERS` (ścieżka → `() => import()`),
   18 eksportów `lazy()` zbudowanych z tej mapy oraz `prefetchRoute(path)`
   używające **tego samego** thunka (rejestr ESM deduplikuje; `.catch(() => {})`,
   więc rozgrzewka offline nigdy nie daje nieobsłużonego odrzucenia).
   W `src/App.tsx` 18 statycznych importów stron zastąpiono re-eksportami z
   `routeChunks`, a `<Routes>` opakowano w `<Suspense>` z lekkim fallbackiem
   `RouteFallback` — zero nowego CSS-u, reużyte istniejące klasy
   `.empty-state`/`.empty-title`, `role="status"`, polski tekst `Wczytywanie…`
   (spójny z `AuthLoading`: `Wczytywanie sesji…`).
   Prefetch na `onPointerEnter`/`onFocus` podpięty do wszystkich powierzchni
   nawigacji: NavLinki sidebara, „Ustawienia”, oba awatary profilu, 3 zakładki
   dolnego paska, „Zasobnik” (jawnie `/calendar`, bo `BIN_TAB_TARGET` niesie
   query string), każdy wpis arkusza „Więcej”, `/account` i „Mój profil”.
   `LoginPage` i `auth/AuthScreens` **celowo pozostają eager** — renderują się
   przed powłoką i przed granicą `Suspense`, więc leniwe ładowanie migałoby
   pustym fallbackiem przy pierwszym malowaniu niezalogowanej wizyty.
2. **`vite.config.ts` — `manualChunks` wyłącznie dla `react`, `motion`,
   `@supabase`.** Matcher `vendorChunk(id)` kotwiczy wzorce na
   `node_modules/(nazwa)/`, więc `lucide-react` czy `react-is` nie mogą zostać
   przypadkiem złapane. `react-router` / `react-router-dom` / `@remix-run/router`
   trafiają do chunku `react`, żeby React rozwiązywał się spójnie (jedna kopia).
   **`build.cssCodeSplit: false`** — `styles.css` zostaje JEDNYM arkuszem;
   przy domyślnym `true` leniwe trasy wstrzykiwałyby arkusze w runtime (przed
   czym audyt wprost ostrzegał).
3. **`LazyMotion features={domAnimation} strict`** w `src/main.tsx`, pomiędzy
   `MotionConfig` a `RouterProvider`. Wszystkie pliki przeniesione z `motion.*`
   na `m.*` (11 plików: `App.tsx`, `OverflowMenu`, `EventModal`, `WeekView`,
   `TaskModal`, `ChangelogModal`, `TicketModal`, `GlobalSearch`,
   `DashboardPage`, `KanbanPage`, `OnboardingRoot`). Semantyka animacji bez
   zmian — te same propsy, te same przejścia, te same `AnimatePresence`.
   `strict` włączone, bo po konwersji nie ma już ani jednego użycia `motion.*`.
4. **Usunięty `layout` z kart Kanbanu** (`src/pages/KanbanPage.tsx`) — koszt
   projekcji FLIP wskazany w audycie. **Odstępstwo:** nie dodano
   `transition: transform` do `.kanban-card`, bo transform tej karty jest już
   sterowany przez `whileHover={{ y: -2 }}` — przejście CSS na `transform`
   walczyłoby z animacją silnika przy każdym najechaniu. Karta zachowuje swoje
   dotychczasowe `transition` na `border-color`/`background`. Karty przeskakują
   do nowej kolumny zamiast płynnie przesuwać się FLIP-em; wszystkie trzy
   ścieżki przenoszenia (wskaźnik, klawiatura, menu karty) są nietknięte i nadal
   kończą się `SET_TASK_STATUS`. Prompt dopuszczał CSS „gdzie przejście nadal
   jest pożądane” — reviewer uznał odstępstwo za uzasadnione.
5. **`optimizeDeps.include: ['lucide-react']`** — przyspieszenie dev-servera.
6. **Założenia kontekstowe tras.** `<Suspense>` stoi wewnątrz całego stosu
   providerów i wewnątrz trasowego `ErrorBoundary`, w `<main>` powłoki:
   sidebar, dolny pasek, modale i strażnik `useBlocker`/`dirtyRegistry`
   pozostają zamontowane podczas ładowania trasy. Nieudane pobranie chunku
   wpada do istniejącego ekranu odzyskiwania. Bramkowanie uprawnień `/admin`
   i `/team` bez zmian.

## Zmiany

Nowy plik:

- `src/pages/routeChunks.ts` — mapa `ROUTE_LOADERS`, eksporty `lazy()`,
  `prefetchRoute`.

Zmodyfikowane:

- `src/App.tsx` — leniwe trasy, `<Suspense>` + `RouteFallback`, prefetch na
  nawigacji, `motion.div` → `m.div`.
- `src/main.tsx` — `<LazyMotion features={domAnimation} strict>`.
- `vite.config.ts` — `manualChunks` (react/motion/supabase),
  `build.cssCodeSplit: false`, `optimizeDeps.include: ['lucide-react']`.
- `src/pages/KanbanPage.tsx` — usunięty `layout` (+ komentarz z uzasadnieniem).
- `motion.*` → `m.*`: `src/components/OverflowMenu.tsx`, `EventModal.tsx`,
  `WeekView.tsx`, `TaskModal.tsx`, `ChangelogModal.tsx`, `TicketModal.tsx`,
  `GlobalSearch.tsx`, `src/pages/DashboardPage.tsx`,
  `src/onboarding/OnboardingRoot.tsx`; nieaktualne wzmianki `motion.div` w
  komentarzach `useOverlay.ts` i `ConfirmProvider.tsx` zaktualizowane.
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — rozszerzony punkt granic.
- `handoffs/RUN-STATE.md` — sekcja wyniku.

Bez zmian w `package.json` (zero nowych zależności runtime), w reduktorze,
`storage.ts` i selektorach. Tryb wygaszania pozostaje wyłączony.

## Weryfikacja

Uruchomione niezależnie przez developera i ponownie przez reviewera — te same
wyniki:

- `npm test` — **91 plików / 2003 testy, wszystkie zielone**. Baseline zdjęty
  przed edycjami: identyczny (91 / 2003). Zero regresji.
- `npm run build` — zielony, **ostrzeżenie o chunku > 500 kB zniknęło**.
- `npx tsc --noEmit` — czysty (biegnie też wewnątrz `npm run build`).
- `npm run check:openwiki` — zielony.
- Weryfikacja artefaktów: `ls dist/assets/*.css` → dokładnie jeden plik;
  `dist/index.html` → dokładnie jeden `<link rel="stylesheet">`.
- Matryca przeglądarkowa **nie** uruchamiana — należy do weryfikacji wydania.
- Gate (`npm test && npm run build`): oczekuje na scheduler.

### Rozmiary chunków — przed / po

Przed (jeden chunk JS):

```
dist/assets/index-BPwGMSRS.css    132.31 kB │ gzip:  22.07 kB
dist/assets/index-BBtNz5k8.js   1 213.86 kB │ gzip: 355.80 kB
```

Po (3213 modułów, 34 assety):

```
dist/assets/style-BPwGMSRS.css    132.31 kB │ gzip:  22.07 kB   <- JEDYNY .css
dist/assets/index-DQ15kXlA.js     412.78 kB │ gzip: 120.40 kB   <- entry
dist/assets/supabase-….js         214.77 kB │ gzip:  55.57 kB
dist/assets/react-….js            209.75 kB │ gzip:  68.26 kB
dist/assets/motion-….js            81.55 kB │ gzip:  28.69 kB
dist/assets/CalendarPage-….js      55.25 kB │ gzip:  17.66 kB
dist/assets/AdminPage-….js         33.34 kB │ gzip:   9.66 kB
dist/assets/PersonProfilePage-….js 19.34 kB │ gzip:   5.57 kB
dist/assets/DashboardPage-….js     16.58 kB │ gzip:   5.15 kB
dist/assets/KanbanPage-….js        16.52 kB │ gzip:   6.33 kB
dist/assets/TimelinePage-….js      15.42 kB │ gzip:   5.41 kB
… + pozostałe chunki tras i współdzielone (TeamPage 4.37, ProjectDetailPage 3.94,
   WorkloadPage 3.84, ClientsPage 3.79, TasksPage 3.61, ProjectsPage 3.24,
   ChangelogModal 2.53, PeoplePage 2.34, TicketsPage 2.32, FilterPanel 1.62,
   AccountPage 1.51, FilterPresets 1.22, EventsPage 1.20, TaskFullPage 0.98,
   useTouchDragGate 0.75, Coin 0.69, PersonFilter 0.68, personFields 0.40,
   FilterBar 0.38, ChangelogPage 0.37, roleTitles 0.29, PersonChip 0.29,
   PriorityBadge 0.18 — wszystko gzip)
```

**Delta krytyczna: chunk wejściowy 355.80 kB → 120.40 kB gzip (−235.4 kB,
−66 %).** Pierwsze wejście pobiera entry + `react` + potrzebne vendory zamiast
całej aplikacji; `supabase` (55.57 kB gz) i chunki nieodwiedzonych tras nie
blokują już pierwszego renderu. CSS bez zmian bajtowych — ten sam hash treści
`BPwGMSRS`, zmieniła się wyłącznie nazwa bazowa pliku (`index-` → `style-`),
bo `cssCodeSplit:false` inaczej nazywa pojedynczy arkusz.

## Ryzyka / rzeczy do sprawdzenia

- **`LazyMotion strict` to ryzyko runtime'owe, nie kompilacyjne.** Każde
  przyszłe użycie `motion.*` (zamiast `m.*`) rzuci wyjątek dopiero w
  przeglądarce i wpadnie do `ErrorBoundary`. Grep po całym `src/` (JSX, forma
  HOC `motion(`, `motion.create`) jest czysty, ale strażnik jest runtime'owy.
  Reguła jest teraz zapisana w wiki jako kontrakt.
- **`domAnimation` nie obsługuje** `layout`/`layoutId`, `drag`, `whileInView`,
  `useScroll`, `Reorder`, `mode="popLayout"` ani animacji SVG `pathLength`.
  Dziś repozytorium nie używa żadnej z nich (jedyną była właśnie usunięta
  projekcja Kanbanu). Wprowadzenie którejkolwiek wymaga świadomej zmiany na
  `domMax`.
- **Karty Kanbanu przeskakują** przy zmianie kolumny zamiast płynnie się
  przesuwać — świadome, uzgodnione odstępstwo (patrz pkt 4). Zmiana wyłącznie
  wizualna, logika przenoszenia nietknięta.
- **Vitest jest node-only** (`environment: 'node'`, `include:
  ['src/**/*.test.ts']`), więc żaden test nie dotyka DOM-u. Dwie rzeczy warte
  potwierdzenia w matrycy przeglądarkowej przy weryfikacji wydania: (a) jedna
  nawigacja do nieodwiedzonej leniwej trasy (fallback + brak crashu `strict`),
  (b) scenariusze przenoszenia kart Kanbanu wskaźnikiem/dotykiem/klawiaturą ze
  stage'a 282 po usunięciu `layout`.
- **`prefetchRoute(path: string)`** przyjmuje zwykły `string` — literówka
  cicho nic nie zrobi (typ `RouteChunkPath` jest wyeksportowany, ale
  nieegzekwowany). Wszystkie obecne wywołania reviewer sprawdził jeden po
  drugim względem kluczy `ROUTE_LOADERS`; trasy parametryczne prefetchowane są
  wzorcem (`/people/:id`), nie konkretnym href-em.
- **Pierwsza nawigacja do niezcache'owanej trasy** odtwarza animację wejścia
  nad fallbackiem — zachowanie wyłącznie ładowania, dopuszczone przez prompt.
- **Odłożone (odnotowane, nie routowane):** chunk wejściowy nadal niesie całą
  warstwę modali (`TaskModal`, `TicketModal`, `EventModal`, `GlobalSearch`,
  `OnboardingRoot` — montowane bezwarunkowo w `App`). Ich leniwe ładowanie to
  kolejny oczywisty zysk, ale poza zakresem tego promptu.

## Werdykt reviewera

`approve` — brak blokerów, brak rozszerzeń kontekstu, Codex niepotrzebny.
Decyzja wiki: **`wiki updated`** —
`openwiki/n2hub/ui-navigation-and-onboarding.md` zaktualizowane trafnie i
wystarczająco (leniwe trasy przez `routeChunks.ts` jako jedna mapa, kontrakt
prefetchu, reguła „tylko `m.*`” pod `LazyMotion strict`, polityka trzech chunków
vendorowych oraz inwariant `cssCodeSplit:false`).

## Podpis schedulera

- Run: `20260728-072450-n2hub-292-code-splitting-lazymotion`
- Prompt: `292-code-splitting-lazymotion.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `1046d573573dbd63716dd95ec6c0a3b0a71aff8b`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `1046d573573dbd63716dd95ec6c0a3b0a71aff8b`
- Gałąź review: `review-integration`
- Run: `20260728-072450-n2hub-292-code-splitting-lazymotion`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/components/ChangelogModal.tsx`
- `src/components/ConfirmProvider.tsx`
- `src/components/EventModal.tsx`
- `src/components/GlobalSearch.tsx`
- `src/components/OverflowMenu.tsx`
- `src/components/TaskModal.tsx`
- `src/components/TicketModal.tsx`
- `src/components/WeekView.tsx`
- `src/components/useOverlay.ts`
- `src/main.tsx`
- `src/onboarding/OnboardingRoot.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/KanbanPage.tsx`
- `vite.config.ts`
- `handoffs/scheduler-reviews/20260728-072450-n2hub-292-code-splitting-lazymotion.md`
- `src/pages/routeChunks.ts`
