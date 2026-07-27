# Raport workflow: 20260728-010300-n2hub-281-tooltip-iconbutton

## Wykonane

Najpierw analiza stanu bieżącego builda pod kątem każdego punktu zadania:

- **Już zrobione — pominięte:** `IconButton` miał `forwardRef` (dorobiony w
  n2hub-277). Wspólna prymitywa nakładek istnieje i jest zdrowa
  (`overlayShell.ts` + `useOverlay.ts`), więc tooltip ją reużywa, a nie duplikuje.
- **Nieaktualne fakty z promptu:** natywnych `title=` było **111**, nie 95 (25
  plików `.tsx`). `QuickAddModal` nie istnieje — surowy glif `×` siedział w
  `src/onboarding/OnboardingRoot.tsx`. Oba punkty zrealizowano na faktycznym
  kodzie, nie na opisie z promptu.
- **Do zrobienia — zrobione:** cała reszta.

### 1. Prymitywa `Tooltip`

- `src/components/tooltipShell.ts` — czysta, DOM-free logika (wzorzec
  `overlayShell.ts` / `modalShell.ts` / `fieldContract.ts`): opóźnienie grupowe
  (zimne 500 ms, ciepłe 0 ms, okno łaski 500 ms po schowaniu), maszyna decyzji
  `resolveTooltipTrigger` (hover tylko `pointerType === 'mouse'`, `focus-visible`
  natychmiast, dotyk/rysik nigdy, `pointerdown`/`blur`/Escape chowają),
  `tooltipDescribes` (kontrakt a11y), `buildTooltipText` (skrót klawiszowy
  słownie), `mergeDescribedBy`.
- `src/components/Tooltip.tsx` — cienka warstwa DOM: `cloneElement` bez
  opakowania (układ bajt w bajt taki sam), portal przez `OverlayLayer`,
  pozycjonowanie przez `resolveOverlayPosition` (flip + shift), karta
  `aria-hidden`, ukryty opis `.sr-only` zamontowany na stałe w portalu.
  Handlery są **wyłącznie obserwatorami** — zero `preventDefault`,
  `stopPropagation` i przejmowania wskaźnika; zawsze wołają handler dziecka.
  Escape chowa dymek, ale **nie konsumuje klawisza**, więc stos nakładek i
  modali działa jak dotąd.
- Kontrakt a11y: `aria-describedby` podpina się **tylko** gdy tekst dymka nie
  zawiera się w nazwie dostępnej — nigdy `aria-label` + opis o tej samej treści.
- Eksportowany `DisabledHint` dla kontrolek wyłączonych **natywnie** (`disabled`
  połyka zdarzenia wskaźnika, więc dymek wisi na minimalnym `inline-flex`).

### 2. Migracja 111 × `title=`

Zastosowano regułę trzech przypadków; wszystkie 111 wystąpień okazało się
prawdziwymi tooltipami (brak fałszywych trafień typu prop domenowy / SVG
`<title>`):

- (a) `title` == `aria-label` → `title` usunięty (m.in. `block-done-mark` ×3,
  `Avatar`, `Coin`, znaczniki `MonthView`),
- (b) `title` niesie treść dodatkową → `Tooltip` + `aria-describedby`
  (bloki i karty zasobnika `WeekView`, paski `TimelinePage`, komórki
  `AllocationGrid`),
- (c) `title` na elemencie nieinteraktywnym → widoczny podpis lub nic
  (instrukcja kolumny archiwum w `KanbanPage`, powody blokady w menu
  kontekstowym `WeekView` jako widoczne linie `.context-menu-hint`).

Skupiska powodów blokady zostały skonsolidowane: `TaskModal` (17 × `roTitle`),
`PersonProfilePage` (16), `ProjectDetailPage` (7) mają dziś jeden wspólny ukryty
opis na widok zamiast powtarzanego atrybutu.

### 3. `IconButton`

Nowe API: `tooltip` (domyślnie `label`, `null` = bez dymka), `shortcut`,
`size` jako `data-size` (`md` = 32 px, `sm` = 24 px), `disabled` +
`disabledReason`, `busy`, `pressed` (`aria-pressed`), `expanded`
(`aria-expanded`). Prop `title` i atrybut `title` **zniknęły całkowicie**.
Pole trafienia ≥ 44 × 44 px przez `.icon-btn::after` (`max(100%, 44px)`,
wycentrowane) — wygląd w spoczynku bez zmian. Blokada jest **miękka**
(`aria-disabled`, nie natywne `disabled`), więc przycisk zostaje w cyklu Tab i
czytnik ekranu odczyta powód zamiast trafić na element niewidoczny dla fokusa.
Surowy `×` w `OnboardingRoot.tsx` zastąpiony `IconButton` — w `src` nie ma już
żadnego surowego glifu `×`.

### 4. Naprawa harness'u przeglądarkowego (praca poza pierwotnym zakresem)

Usunięcie atrybutów `title` zepsułoby 4 skrypty `scripts/browser-check-*.mjs`,
które asercjonowały je przez `getAttribute('title')`. Wszystkie naprawiono tak,
by sprawdzały **ten sam fakt** przez nowy mechanizm (`aria-describedby` → ukryty
tekst albo `aria-label`): `browser-check-placement.mjs`,
`browser-check-status-semantics.mjs`, `browser-check-tab-sync.mjs`,
`browser-check-onboarding.mjs`, wcześniej `browser-check-bin-drag.mjs`.
Żadna asercja nie została osłabiona ani usunięta; dwie są dziś ostrzejsze.
Przy okazji wyłapano dwie rzeczy, których nikt nie szukał:

- `browser-check-placement.mjs` czytał `.donut-pct` przez `innerText()`, a nowy
  `span.sr-only` w środku tego elementu (klipowany, nie `display:none`) wszedłby
  do wyniku — asercję rozbito na widoczny tekst i osobno tekst dla czytnika;
- `WorkloadPage` — komórka przeciążenia miała `aria-describedby` wskazujące na
  `span.sr-only` **wewnątrz siebie**, a że jest `role="button"` nazwany treścią,
  ten sam tekst byłby ogłoszony dwa razy. `aria-describedby` usunięte.

### Routing (workflow tier)

`architect → developer → developer (pakiet zależny) → reviewer`. Architekt
wykonał analizę luk i zapisał dwa pakiety: `handoffs/PKG-20260728-tooltip-primitive-iconbutton.md`
(prymitywa + `IconButton` + 87 miejsc niekalendarzowych) i
`handoffs/PKG-20260728-title-migration-calendar.md` (24 miejsca na
`WeekView`/`MonthView`/`TimelinePage`, wydzielone z powodu inwariantu 7).

## Zmiany

- Nowe: `src/components/tooltipShell.ts`, `src/components/tooltipShell.test.ts`,
  `src/components/Tooltip.tsx`.
- Zmienione: `src/components/IconButton.tsx`, `src/styles.css`,
  `src/onboarding/OnboardingRoot.tsx`, `src/App.tsx` oraz 24 pliki
  komponentów i stron objęte migracją (`TaskModal`, `AllocationGrid`,
  `WeekView`, `MonthView`, `TimelinePage`, `WorkloadPage`, `PersonProfilePage`,
  `ProjectDetailPage`, `TasksPage`, `KanbanPage`, `TicketsPage`,
  `DashboardPage`, `TeamPage`, `TeamStructureTree`, `AdminPage`,
  `ProjectsPage`, `FilterPresets`, `SaveStatus`, `Avatar`, `Coin`,
  `PersistenceBanner`, `CommentsPanel`, `PersonChip`).
- Skrypty: `browser-check-bin-drag.mjs`, `browser-check-placement.mjs`,
  `browser-check-status-semantics.mjs`, `browser-check-tab-sync.mjs`,
  `browser-check-onboarding.mjs`.
- Wiki: `openwiki/n2hub/ui-navigation-and-onboarding.md` (nowa wspólna
  prymitywa) i `openwiki/n2hub/scheduling-and-calendar.md` (obserwatorskie
  dymki na powierzchniach przeciągania, chowanie na `pointerdown`, nowa trasa
  sprawdzenia) — strony były niekompletne po tej zmianie granicy.
- **Nietknięte:** `src/store/` (reducer, selektory, storage), `overlayShell.ts`,
  `useOverlay.ts`, `automation/`, kolejka promptów. Zero operacji zmieniających
  stan Gita, zero commitów.

## Weryfikacja

Uruchomione i potwierdzone niezależnie przez orkiestratora po zakończeniu obu
pakietów:

- `npm test` → **74 pliki, 1726 testów, 0 błędów** (bazowo 1710; +16 nowych
  testów `tooltipShell.test.ts` pokrywających opóźnienie grupowe, okno łaski,
  reguły wyzwalaczy, `tooltipDescribes`, `buildTooltipText`, `mergeDescribedBy`).
  Żaden istniejący test nie został zmodyfikowany ani wyłączony.
- `npm run build` → zielony (tsc czysty, vite 3.73 s).
- `grep -rn 'title=' src` (`.ts` + `.tsx`) → **0 trafień**.
- `grep -rn "getAttribute('title')\|getByTitle" scripts/` → **0 trafień**.
- `node --check` na wszystkich 11 skryptach w `scripts/` → parsują się.
- `npm run test:scheduler` **nie istnieje** w tym repo (`Missing script`) —
  gate projektu to `npm test && npm run build`.
- Sprawdzenia przeglądarkowe: **NIE uruchomione**. `playwright` nie jest
  zainstalowany w tym worktree (`Cannot find package 'playwright'`), nie ma też
  binarki przeglądarki. Naprawione selektory i `id` zweryfikowano wyłącznie
  statycznie, przez odczyt renderującego JSX. To jedyna nieprzeprowadzona
  weryfikacja i najważniejsze ograniczenie tego raportu.

## Ryzyka / rzeczy do sprawdzenia

1. **Inwariant 7 (najwyższe ryzyko).** Dymki wchodzą na powierzchnie
   przeciągania kalendarza i osi czasu. Zabezpieczenia: `cloneElement` zamiast
   opakowania (żaden nowy węzeł DOM między kolumną a jej pozycjonowanymi
   absolutnie dziećmi), handlery czysto obserwatorskie wołające handler dziecka,
   chowanie na `pointerdown` (dymek nigdy nie żyje w trakcie przeciągania),
   karta w portalu z `pointer-events: none` (nie psuje `elementFromPoint`).
   Mimo to **ta ścieżka nie została sprawdzona w przeglądarce** — recenzent
   powinien potwierdzić `browser-check-bin-drag` i `browser-check-placement`
   w środowisku z playwrightem.
2. **Nakładanie się pól trafienia 44 px.** Jedno realne miejsce: `.task-delete`
   w `TasksPage` (32 px, pozycjonowany absolutnie nad przyciskiem karty) — halo
   wychodzi ~6 px na kartę, więc kliknięcie tuż obok ikony usuwa zamiast otwierać
   zadanie. Dialog potwierdzenia nadal chroni operację, a to jest wprost
   zamawiane zachowanie 44 px, ale to jedyny punkt, gdzie halo nachodzi na inną
   powierzchnię interaktywną. `.task-modal-head-actions` ma 4 px zapasu (bezpieczne).
3. **`DisabledHint` wstawia `<span class="tooltip-holder">`** w `.recur-actions`,
   `.admin-status-actions`, `.filter-presets` i wiersze akcji `WorkloadPage`.
   `display: inline-flex` powinno być neutralne dla układu, ale to jedyna
   strukturalna zmiana DOM w tej dostawie i nie ma jak jej sprawdzić wizualnie.
4. **Zmiany widocznej treści (świadome, przypadek (c)).** Instrukcja kolumny
   archiwum w `KanbanPage` jest dziś widoczna (`.kanban-col-note`), powody
   blokady w menu kontekstowym `WeekView` są widocznymi liniami, a paski
   `TimelinePage` w trybie edycji dostały **nową** podpowiedź o przeciąganiu
   („Przeciągnij, aby przesunąć…"), której wcześniej nie było. Do akceptacji
   produktowej.
5. **Zmiana kopii:** komunikat przeciążenia w `WorkloadPage` brzmi teraz
   „X: 4h **ponad** 0h dostępności" zamiast „4h > 0h" — `>` czytane na głos było
   bezużyteczne. Asercja w skrypcie zaktualizowana do nowej kopii.
6. **`aria-describedby` pojawia się jedno renderowanie po zamontowaniu**
   (nazwa dostępna kotwicy jest czytana z DOM w efekcie układu). To zmiana samego
   atrybutu, bez przesunięcia układu, ale test asercjonujący `aria-describedby`
   synchronicznie wymagałby flusha.
7. **`PersonDot` — prop `title` usunięty, nie zmigrowany.** Komponent nie ma
   dziś ani jednego konsumenta (`grep` po `src`), a pozostawienie nieużywanego
   propu łamie `noUnusedLocals`. Komponent zachowany i eksportowany.
8. **Tryb wygaszania (retirement) pozostaje wyłączony.** Zero nowych zależności
   runtime. Wszystkie nowe łańcuchy interfejsu po polsku.

## Podpis schedulera

- Run: `20260728-010300-n2hub-281-tooltip-iconbutton`
- Prompt: `281-tooltip-iconbutton.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `f5b38f1326a2408167351fadd98c71e33ded6a62`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `f5b38f1326a2408167351fadd98c71e33ded6a62`
- Gałąź review: `review-integration`
- Run: `20260728-010300-n2hub-281-tooltip-iconbutton`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `scripts/browser-check-bin-drag.mjs`
- `scripts/browser-check-onboarding.mjs`
- `scripts/browser-check-placement.mjs`
- `scripts/browser-check-status-semantics.mjs`
- `scripts/browser-check-tab-sync.mjs`
- `src/App.tsx`
- `src/components/AllocationGrid.tsx`
- `src/components/Avatar.tsx`
- `src/components/Coin.tsx`
- `src/components/CommentsPanel.tsx`
- `src/components/FilterPresets.tsx`
- `src/components/IconButton.tsx`
- `src/components/MonthView.tsx`
- `src/components/PersistenceBanner.tsx`
- `src/components/PersonChip.tsx`
- `src/components/SaveStatus.tsx`
- `src/components/TaskModal.tsx`
- `src/components/WeekView.tsx`
- `src/onboarding/OnboardingRoot.tsx`
- `src/pages/AdminPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/KanbanPage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/ProjectDetailPage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/pages/TeamPage.tsx`
- `src/pages/TeamStructureTree.tsx`
- `src/pages/TicketsPage.tsx`
- `src/pages/TimelinePage.tsx`
- `src/pages/WorkloadPage.tsx`
- `src/styles.css`
- `handoffs/PKG-20260728-title-migration-calendar.md`
- `handoffs/PKG-20260728-tooltip-primitive-iconbutton.md`
- `handoffs/scheduler-reviews/20260728-010300-n2hub-281-tooltip-iconbutton.md`
- `src/components/Tooltip.tsx`
- `src/components/tooltipShell.test.ts`
- `src/components/tooltipShell.ts`
