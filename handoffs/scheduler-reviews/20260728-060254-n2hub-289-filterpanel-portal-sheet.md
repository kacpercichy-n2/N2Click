# Raport workflow: 20260728-060254-n2hub-289-filterpanel-portal-sheet

Routing tierowy: **developer → reviewer** (jedna spójna granica prezentacyjna,
testy nierozdzielne od implementacji). Reviewer i Codex są własnością schedulera.

## Wykonane

### Analiza wstępna — czy zadanie jest jeszcze aktualne

**Tak, było aktualne.** Stan zastany w `review-integration`:

- `FilterPanel.tsx` wołał `useOverlay` BEZ `getAnchorRect`, a nagłówkowy komentarz
  deklarował wprost: „Popover CELOWO nie idzie do portalu ani nie jest mierzony”.
- `.filter-popover` był `position: absolute; top: calc(100% + 6px)` wewnątrz
  `.filter-panel-wrap` — zero obsługi kolizji z viewportem.
- `@media (max-width: 760px)` przestawiał popover na `position: static; width: 100%`,
  czyli dokładnie ten statyczny rozrost paska opisany w zadaniu.
- Radia były domyślnymi kontrolkami przeglądarki (~13 px) w wierszach
  `padding: 4px 6px` bez `min-height`.

Nic z tego nie było wcześniej zrobione, więc zadanie wykonano w całości.

### Desktop — portal + kolizje

- Panel renderuje się przez `OverlayLayer` (portal na `document.body`), z
  `getAnchorRect` z prostokąta przycisku „Filtry”, `placement: 'bottom-start'`,
  `offset: 6`. Flip/shift z `resolveOverlayPosition` działa więc tak samo jak w
  menu kontekstowym `WeekView`; przycinanie przez `overflow` rodzica znika.
- `.filter-popover` → `position: fixed`,
  `max-height: min(70dvh, var(--overlay-avail, 70dvh))`,
  `min-width: max(260px, var(--anchor-width, 260px))`.
- `useOverlay` wystawia teraz w zwracanym stylu `--anchor-width` (osobny stan
  szerokości ustawiany w `measure()`; sygnatura czystego `resolveOverlayPosition`
  nietknięta).
- Nowa **czysta** funkcja `isAnchorOutOfView(anchor, viewport, margin?)` w
  `overlayShell.ts` plus opcja `closeOnAnchorOutOfView` w `useOverlay`
  (**domyślnie `false`**, więc pozostali konsumenci powłoki zachowują dzisiejsze
  zachowanie). `FilterPanel` włącza ją tylko w wariancie desktopowym — panel
  zamyka się, gdy przycisk wyjedzie całkowicie poza widok.
- Fokus wchodzi do panelu po otwarciu i **krąży w nim** (Tab/Shift+Tab), bo portal
  na końcu `<body>` wyprowadziłby fokus poza treść strony. Decyzje bierze czysty
  `modalShell.ts` (`resolveInitialFocusIndex`, `resolveTrapAction`,
  `shouldHandleTrapKey`); powrót fokusa na trigger robi jak dotąd `useOverlay`.
- Live apply, chipy, presety i licznik wyników bez zmian funkcjonalnych.

### Mobile (≤ 760 px) — arkusz od dołu

- `useMediaQuery(MOBILE_NAV_QUERY)` przełącza na wariant arkusza: portal,
  `.app-sheet-scrim` (przyciemnione tło) i `.app-sheet-handle` (uchwyt wizualny,
  `aria-hidden`) — obie klasy to istniejący szkielet arkuszy z etapu 288, nie nowy byt.
- `.filter-sheet`: `position: fixed; inset: auto 0 0 0`, `max-height: 85dvh`,
  `overflow-y: auto`, `overscroll-behavior: contain`, zaokrąglona górna krawędź.
  Arkusz jest NIEPOZYCJONOWANY (bez `getAnchorRect`) — kotwiczy go CSS, tak jak
  arkusz „Więcej” i szybki skok kalendarza.
- Lepka stopka „Wyczyść · Pokaż N”: `position: sticky` na tym samym
  `.filter-popover-foot` (markup identyczny w obu wariantach, różni je wyłącznie
  CSS). Nowy opcjonalny prop `resultCount` na `FilterPanel`; bez niego przycisk
  mówi „Pokaż wyniki”. Podłączony na `ProjectsPage` i `TasksPage` — jedynych
  stronach z gotową, jednoznaczną liczbą wyników (tą samą, którą pokazuje slot
  `trailing`).
- Blokada scrolla tła przez **wspólny** licznik modali: `useModalShell.ts`
  wystawia `useBodyScrollLock` (oraz `focusInitialIn` / `tabbableElementsIn`), a
  sam hook modala używa teraz tych samych funkcji. Blokada to `overflow: hidden`
  na `<body>`, więc po zamknięciu pozycja przewijania strony wraca sama.
- `aria-modal` ustawiane **tylko** w arkuszu (tam tło jest faktycznie zasłonięte);
  desktopowy popover zostawia stronę do czytania.

### Hierarchia i cele dotykowe (TY-07)

- `.filter-option input` → 16 × 16 px, `flex-shrink: 0`, `accent-color` zachowane.
- `.filter-option` → `min-height: 28px` na desktopie, `48px` w arkuszu.
- W arkuszu chipy osób (`.filter-chip`) i pola dat dostały cele ≥ 44 px — bez
  żadnej zmiany markupu `PersonFilter.tsx`.
- `.filter-group legend` i odstęp 16 px między grupami sprawdzone: już były zgodne
  (11 px / 600 / `--n2-text-faint` / `letter-spacing: 0.02em`,
  `gap: var(--n2-space-4)`), zostawione bez zmian.

### Zachowane bez zmian

`dataTour` (siedzi na `.filter-toolbar` w `FilterBar`, portal go nie rusza),
zapisane presety, sekcja osób (chipy + „+N”), model stanu filtrów. Tryb wygaszania
nadal wyłączony, inwariant 6 nietknięty, zero nowych zależności runtime.

## Zmiany

| Plik | Zmiana |
| --- | --- |
| `src/components/FilterPanel.tsx` | portal, dwa warianty, wejście fokusa + pułapka Tab, prop `resultCount` |
| `src/components/overlayShell.ts` | nowa czysta `isAnchorOutOfView` |
| `src/components/overlayShell.test.ts` | 5 nowych testów `isAnchorOutOfView` |
| `src/components/useOverlay.ts` | opcja `closeOnAnchorOutOfView` (domyślnie `false`), `--anchor-width` w stylu |
| `src/components/useModalShell.ts` | wydzielone `focusInitialIn` / `tabbableElementsIn` / `useBodyScrollLock` |
| `src/utils/useMediaQuery.ts` | strażnik `typeof window !== 'undefined'` w inicjalizatorze stanu |
| `src/styles.css` | `.filter-popover` → `fixed`, nowy blok `.filter-sheet`, cele TY-07, usunięte martwe `.cal-toolbar-phone .filter-popover` |
| `src/pages/ProjectsPage.tsx`, `src/pages/TasksPage.tsx` | przekazanie `resultCount` |
| `src/App.tsx`, `src/pages/CalendarPage.tsx` | tylko komentarze (nie opisują już FilterPanela jako niepozycjonowanego) |
| `openwiki/n2hub/ui-navigation-and-onboarding.md` | opis powłoki nakładek po zmianie |
| `handoffs/RUN-STATE.md` | wpis do logu etapów |

## Weryfikacja

Uruchomione na finalnym stanie worktree (wyniki zaobserwowane, nie założone):

| Polecenie | Wynik |
| --- | --- |
| `npm test` | **zielony** — `Test Files 88 passed (88)`, `Tests 1944 passed (1944)` |
| `npm run build` | **zielony** — `tsc --noEmit` czysty, `✓ built in 3.69s`, `dist/assets/index-p5gf70q8.css 132.11 kB` |
| `npx vitest run src/components/overlayShell.test.ts` | **zielony** — 42 testy (było 37) |
| `npm run check:openwiki` | **zielony** — `Validated 6 wiki files.` |

Brak regresji: `FilterBar.test.ts`, `PersonFilter.test.ts` i `filterState.test.ts`
przechodzą **bez modyfikacji** — renderują panel zamknięty, więc portal w ogóle nie
powstaje w `react-dom/server`.

Nowe testy dotyczą jedynej wydzielonej czystej logiki (`isAnchorOutOfView`):
kotwica w środku okna, obie krawędzie pionowe, oś pozioma, wariant z marginesem
i przypadek graniczny „1 px jeszcze widać”.

- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

1. **Brak pokrycia automatycznego dla warstwy DOM.** Repozytorium testuje wyłącznie
   w środowisku `node`, więc portal, arkusz, pułapka Tab i blokada scrolla nie mają
   testów — pokryta jest tylko wydzielona czysta logika. Żaden istniejący
   `browser-check-*` nie dotyka panelu filtrów, więc matryca przeglądarkowa nie była
   uruchamiana. Warto obejrzeć panel ręcznie na desktopie (kolizja z dolną krawędzią
   → flip w górę) i na wąskim ekranie (arkusz, lepka stopka).
2. **Zmiana we wspólnym `useModalShell.ts`.** Refaktor jest czysto ekstrakcyjny (te
   same funkcje, ten sam licznik `scrollLock`, ten sam zapamiętany styl `body`), ale
   dotyka granicy wrażliwej na stabilność modali — wart osobnego spojrzenia w review.
3. **Pułapka Tab słucha na oknie przez cały czas otwarcia panelu.** Świadome, bo
   panel siedzi w portalu na końcu `<body>`. Gdyby kiedyś panel filtrów otworzył się
   nad modalem, obie pułapki konkurowałyby — dziś taka kombinacja nie występuje.
4. **`closeOnAnchorOutOfView` zamyka panel także wtedy, gdy przycisk „Filtry” zniknie
   z układu** (zerowy prostokąt). Zachowanie pożądane i dotyczy wyłącznie
   `FilterPanel` — pozostali konsumenci powłoki mają domyślne `false`.
5. **`resultCount` tylko na dwóch stronach.** Kanban, Obciążenie i Oś czasu nie mają
   jednej sensownej liczby wyników, więc ich stopka mówi „Pokaż wyniki”. Jeśli
   produkt chce tam konkretną liczbę, trzeba najpierw ustalić, co ma liczyć.
6. **Wiki zaktualizowana przez workera.** `openwiki/n2hub/ui-navigation-and-onboarding.md`
   twierdziła wprost, że „`FilterPanel` świadomie NIE jest portalowany”, co po tej
   zmianie jest nieprawdą — stąd korekta. Ostateczna decyzja
   `wiki updated` / `wiki unchanged` należy do reviewera schedulera.

## Podpis schedulera

- Run: `20260728-060254-n2hub-289-filterpanel-portal-sheet`
- Prompt: `289-filterpanel-portal-sheet.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `325fb0fb6550ae5cb764a13bd288775dc5489e7f`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `325fb0fb6550ae5cb764a13bd288775dc5489e7f`
- Gałąź review: `review-integration`
- Run: `20260728-060254-n2hub-289-filterpanel-portal-sheet`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/components/FilterPanel.tsx`
- `src/components/overlayShell.test.ts`
- `src/components/overlayShell.ts`
- `src/components/useModalShell.ts`
- `src/components/useOverlay.ts`
- `src/pages/CalendarPage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/styles.css`
- `src/utils/useMediaQuery.ts`
- `handoffs/scheduler-reviews/20260728-060254-n2hub-289-filterpanel-portal-sheet.md`
