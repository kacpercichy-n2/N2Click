# Handoff: Dolny pasek nawigacji na telefonie + kalendarz jako widok dnia

- Package ID: PKG-20260728-mobile-nav-day-view
- Status: ready
- Tier: developer
- Depends on: none
- Risk: high
- Codex review: required — dotyka ścieżek wskaźnika kalendarza/zasobnika (inwariant 7)
  i powłoki nawigacji całej aplikacji; desktop musi zostać identyczny.

## Goal

Na ekranach `≤760 px` (istniejący breakpoint `MOBILE_NAV_QUERY`) aplikacja dostaje
dolny pasek pięciu zakładek zamiast szuflady z hamburgerem, a `/calendar` renderuje
JEDEN pełnoszerokościowy dzień z paskiem 7 dat, zasobnikiem jako arkuszem od dołu i
jednym 56 px rzędem sterowania. Desktop (>760 px) zostaje bez zmian wizualnych i
behawioralnych. Cała nowa logika bezstanowa siedzi w dwóch czystych modułach z
testami w node.

## Analiza stanu (wykonana przez architekta — NIE powtarzaj jej od zera)

Werdykt per punkt zlecenia; dowody to `plik:linia` w BIEŻĄCYM worktree.

1. **Dolny pasek zakładek — REMAINING (całość).** W `src` nie istnieje ŻADEN
   identyfikator `bottom-nav`/`bottomNav`. `src/App.tsx:299-311` renderuje
   hamburger `.app-hamburger`, `src/App.tsx:313-319` scrim, `src/App.tsx:321-442`
   szufladę `.app-sidebar` (wysuwaną z LEWEJ: `src/styles.css:6124-6138`), podczas
   gdy pasek górny stoi po prawej (`src/styles.css:6103-6118`).
2. **Kalendarz jako widok dnia — REMAINING (całość).** Brak `day-view`/`dayView` w
   `src`. `src/components/WeekView.tsx:1759` liczy zawsze `weekDays(anchor)` (7 dni),
   `src/components/WeekView.tsx:124` twardo `DAY_COLS = 7`, a
   `src/styles.css:1865-1870` daje siatce `repeat(7, …)` i `width: max(calc(100%/5*7), 672px)`
   (stąd 1,5 kolumny na 390 px po osi 52 px i zasobniku 160 px —
   `src/styles.css:5350-5354`).
3. **Zasobnik jako arkusz — REMAINING (całość).** `.week-bin-pane` to stały panel
   `flex: 0 0 200px` (`src/styles.css:1872-1882`), na telefonie zwężony do 160 px
   (`src/styles.css:5351-5354`). Brak arkusza, uchwytu i peeku.
4. **Jeden rząd kontrolek — CZĘŚCIOWO ZROBIONE, faza telefonu REMAINING.**
   `src/pages/CalendarPage.tsx:83-145` scalił dawne trzy rzędy w JEDEN
   `.cal-toolbar` (tytuł + Tydzień/Miesiąc + ‹ Dzisiaj › + etykieta okresu +
   `FilterBar` + `NowClockBadge`), więc **nie twórz tego scalenia od nowa**. Na
   telefonie ten rząd nadal zawija się na 3–4 linie: jedyne mobilne reguły to
   `src/styles.css:5355-5363` (`justify-content` + gap + ukrycie daty w plakietce).
   Brakuje: wariantu 56 px (‹ · przycisk zakresu · › · Filtry), szybkiego skoku i
   pływającej pigułki „Dzisiaj”. **Przycisku „Filtry” z odznaką liczby NIE pisz od
   nowa** — istnieje w `src/components/FilterPanel.tsx:70-76` (`.filter-btn` +
   `.filter-badge`), a wybór osób siedzi w popoverze (`FilterBar.tsx:43-55`).

Dodatkowo: hook `useMediaQuery` NIE istnieje (wbrew opisowi w zleceniu) — jest
tylko wbudowany `matchMedia` w `src/App.tsx:110` i `184-189`.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/n2hub/scheduling-and-calendar.md`

## Expected touchpoints

- `src/App.tsx` — dolny pasek, arkusz „Więcej”, górny pasek na telefonie, usunięcie
  szuflady/hamburgera z bramki `mobileNav`.
- `new: src/components/bottomNav.ts` — czysta logika zakładek (bez Reacta).
- `new: src/components/bottomNav.test.ts`
- `new: src/components/dayStrip.ts` — czysty pasek 7 dat + pigułka „Dzisiaj”.
- `new: src/components/dayStrip.test.ts`
- `new: src/components/dayStack.ts` — czyste grupowanie nakładających się bloków.
- `new: src/components/dayStack.test.ts`
- `new: src/utils/useMediaQuery.ts` — jeden hook `matchMedia` + eksport
  `MOBILE_NAV_QUERY` (App importuje go zamiast własnej stałej/efektu).
- `src/components/WeekView.tsx` — prop `mode`, pasek dat, arkusz zasobnika,
  stackowanie bloków, `DAY_COLS` → `days.length`.
- `src/pages/CalendarPage.tsx` — telefonowy rząd sterowania, szybki skok, pigułka.
- `src/components/icons.ts` — dołóż `Archive` (i tylko to) do re-eksportu.
- `src/styles.css` — WYŁĄCZNIE nowe reguły w `@media (max-width: 760px)` /
  `@media (pointer: coarse)` oraz nowe klasy nieużywane na desktopie.

Poza tymi plikami nie ruszaj niczego.

## Invariants

- **Desktop bit-identical.** Każda zmiana wizualna wchodzi albo przez CSS w
  `@media (max-width: 760px)`, albo przez gałąź zależną od jednego booleana
  (`mobileNav` / `mode === 'day'`). Przy `mode === 'week'` drzewo DOM WeekView,
  klasy i style inline muszą być takie same jak dziś (jedyny dopuszczalny wyjątek:
  `.app-topbar`, dziś renderowany i ukrywany `display:none` powyżej 760 px — może
  przestać się renderować, bo i tak jest niewidoczny).
- **Inwariant 7 (najważniejszy).** Cykl życia wskaźnika bloku i karty zasobnika
  (`begin` / `startDrag` / `projectMove` / `projectPointer` / `finish` / `cancelDrag`,
  nasłuchy okna, `setPointerCapture`, sprzątanie) NIE zmienia się. Jedyne dozwolone
  dotknięcia tych plików to: (a) zamiana stałej `DAY_COLS` na `days.length` w
  czterech miejscach wymienionych niżej, (b) DODANIE wywołania obserwatora w
  ISTNIEJĄCYM efekcie `useEffect([dragging])`, który dziś woła `setLiveSyncHold`
  (`WeekView.tsx:386-390` i `WeekView.tsx:1249-1252`). Żadnego nowego
  `preventDefault`, `stopPropagation`, `setPointerCapture` ani nasłuchu w fazie
  gestu.
- Inwariant 3: kolizja tej samej osoby nadal blokuje drag/resize i automatyczne
  wstawienie; widok dnia niczego nie rozluźnia.
- Inwariant 4: jeden wiersz zasobnika na `(taskId, personId)`; arkusz to tylko
  opakowanie prezentacyjne tej samej listy.
- Inwariant 6 i cały `src/store/` — ZERO zmian. Żadnej nowej akcji reduktora,
  żadnego nowego pola w `AppData`, żadnego zapisu do `localStorage`.
- Bramka dotyku (`src/utils/touchDrag.ts`, `useTouchDragGate.ts`) zostaje bez zmian:
  długie przytrzymanie nadal uzbraja drag, krótkie dotknięcie nadal otwiera zadanie.
- Wszystkie napisy po polsku. Zero nowych zależności runtime (`package.json` bez
  zmian). Tryb wygaszania (retirement) zostaje wyłączony i nietknięty.

## Scope

### A. Współdzielony breakpoint (`src/utils/useMediaQuery.ts`)

```ts
export const MOBILE_NAV_QUERY = '(max-width: 760px)';
export function useMediaQuery(query: string): boolean;
```
Zachowanie 1:1 jak dziś w `App.tsx:110,184-189` (stan startowy z `matches`,
`addEventListener('change')`, sprzątanie). `App.tsx` przestaje trzymać własną stałą
i własny efekt; `CalendarPage` używa tego samego hooka. Bez testu jednostkowego
(warstwa DOM) — poprawność potwierdza `npm run build` i użycie.

### B. Czysta logika zakładek (`src/components/bottomNav.ts` + test)

React-free, importuje najwyżej typy. Dokładne API:

```ts
/** Ścieżki trzech zakładek-tras, w kolejności wyświetlania. */
export const BOTTOM_NAV_PRIMARY: readonly string[]; // ['/dashboard', '/calendar', '/tasks']
/** Deep-link zakładki „Zasobnik” — kalendarz z otwartym arkuszem. */
export const BIN_TAB_TARGET: string;               // '/calendar?zasobnik=1'
export const BIN_SHEET_PARAM: string;              // 'zasobnik'

/**
 * Trasy do arkusza „Więcej”: `orderedPaths` (wynik `orderNavPaths`, już po
 * filtrach uprawnień) minus ścieżki podstawowe, z zachowaną kolejnością.
 */
export function moreNavPaths(orderedPaths: string[]): string[];

/**
 * Etykieta w górnym pasku dla bieżącej ścieżki. Dopasowanie po najdłuższym
 * pasującym prefiksie z `labels` (`'/tasks/42'` → 'Zadania'), `'/'` i nieznane
 * trasy → `'N2Hub'`. `labels` budujesz z `NAV_ITEMS` w App.
 */
export function topBarTitle(pathname: string, labels: ReadonlyMap<string, string>): string;

/** Która zakładka ma stan aktywny (`null` = żadna, np. w „Więcej”). */
export function activeTabPath(pathname: string): string | null;
```

Test `bottomNav.test.ts` musi pokrywać: kolejność zapisana przez użytkownika
przetrwa w `moreNavPaths`; ścieżki podstawowe nie duplikują się w „Więcej”;
`topBarTitle` dla `/tasks/42`, `/`, `/nieznane`, `/calendar`; `activeTabPath` dla
zagnieżdżonej trasy i dla trasy spoza zakładek.

### C. Powłoka telefonu w `src/App.tsx`

Przy `mobileNav === true`:

- NIE renderuj `<aside className="app-sidebar">`, `.app-drawer-scrim` ani
  `.app-hamburger`. Usuń stan `menuOpen` i całą martwą maszynerię szuflady
  (`DRAWER_FOCUSABLE`, `visibleDrawerControls`, pułapka Tab, `hamburgerRef`,
  `closedMobileDrawerProps`, `openMobileMainProps`, `onClick={() => setMenuOpen(false)}`
  w linkach) — po tej zmianie `menuOpen` nie może już stać się `true` na ŻADNEJ
  szerokości, więc zostawianie tego kodu byłoby kłamstwem. Reguły CSS
  `.app-sidebar.open`, `.app-drawer-scrim`, `.app-hamburger` i `padding-top: 76px`
  w bloku ≤760 px usuń razem z nimi.
- `<header className="app-topbar">` renderuj TYLKO przy `mobileNav`: po lewej
  `<h2 class="app-topbar-title">` z `topBarTitle(location.pathname, …)`, po prawej
  JEDNA akcja kontekstowa = `<GlobalSearch />`.
- `<GlobalSearch />` musi być zamontowany DOKŁADNIE RAZ (dwa egzemplarze = dwa
  nasłuchy `Ctrl+K`, które wzajemnie się znoszą — `GlobalSearch.tsx:57-79`):
  w pasku górnym przy `mobileNav`, w sidebarze w przeciwnym razie.
- Dolny pasek `<nav className="app-bottom-nav" data-tour="shell.nav">` z pięcioma
  pozycjami (`.app-bottom-nav-item`, ikona + `.app-bottom-nav-label`):
  Panel (`/dashboard`, `LayoutDashboard`), Kalendarz (`/calendar`, `CalendarDays`),
  Zadania (`/tasks`, `ListChecks`) jako `NavLink` z klasą `active`;
  Zasobnik (`Archive`) jako zwykły `<Link to={BIN_TAB_TARGET}>` BEZ stanu aktywnego
  (inaczej podświetlałby się razem z „Kalendarz”); „Więcej” (`MoreHorizontal`) jako
  `<button>` z `aria-expanded`, `aria-haspopup="menu"` i `data-tour="shell.help"`.
- Arkusz „Więcej”: `OverlayLayer` + `useOverlay({ open, onClose, overlayRef,
  triggerRef, menuKeyboard: true })` BEZ `getAnchorRect` (wariant nieporcjonowany,
  jak `FilterPanel` — patrz `useOverlay.ts:78-80`). Kontener
  `.app-more-sheet` z `role="menu"` i `aria-label="Więcej"`, pozycjonowany CSS-em
  przy dolnej krawędzi; pozycje mają `role="menuitem"` (wymóg
  `menuItemsIn`, `useOverlay.ts:100`). Zawartość, w tej kolejności:
  `moreNavPaths(...)` (te same etykiety i ikony co `NAV_ITEMS`, z tymi samymi
  bramkami `/admin` → `canAdmin`, `/team` → `canTeam`), „Ustawienia” (`/account`),
  „Pomoc i samouczki” (dispatch `new Event('n2hub:open-tutorials')`), „Mój profil”
  (`/people/<id>`), „Wyloguj”. Arkusz zamyka się po zmianie trasy, Escape i
  kliknięciem poza (obsługa z hooka); fokus wraca na przycisk „Więcej”
  (`triggerRef`).
- `.app-main` dostaje na telefonie dolny odstęp
  `calc(var(--n2-bottom-nav-h) + env(safe-area-inset-bottom) + var(--n2-space-3))`,
  żeby treść nie chowała się pod paskiem.

CSS: `:root` zyskuje `--n2-bottom-nav-h: 56px` i `--n2-z-bottom-nav: 880`
(pod `--n2-z-search: 990` i `--n2-z-modal: 1000`). Pasek: `position: fixed`,
`inset: auto 0 0 0`, wysokość `calc(var(--n2-bottom-nav-h) + env(safe-area-inset-bottom))`,
`padding-bottom: env(safe-area-inset-bottom)`, pole trafienia każdej zakładki ≥44 px.
Arkusze (`.app-more-sheet`, `.week-bin-sheet`) stoją na `--n2-z-drawer` (900) ze
scrimem `.app-sheet-scrim` tuż pod nimi.

### D. Czysty pasek dat (`src/components/dayStrip.ts` + test)

React-free; daty licz WYŁĄCZNIE przez `src/utils/dates.ts` (`addDaysStr`,
`isTodayStr`, `isWeekend`, `isInMonth`) — nie duplikuj matematyki dat i nie
formatuj tu etykiet (widok użyje `weekdayAbbr` / `dayOfMonthLabel` z `dates.ts`).

```ts
/** Ile dat pokazuje pasek (nieparzyste — aktywna data stoi w środku). */
export const DAY_STRIP_LENGTH = 7;

export interface DayStripEntry {
  date: DateStr;
  active: boolean;   // === anchor
  today: boolean;
  weekend: boolean;
}

/** 7 dat wyśrodkowanych na kotwicy: anchor-3 … anchor+3 (dla anchor = dziś
 *  „dziś” wypada w środku). Zawsze DAY_STRIP_LENGTH pozycji, rosnąco. */
export function dayStripEntries(anchor: DateStr, today: DateStr): DayStripEntry[];

/** Czy pokazać pływającą pigułkę „Dzisiaj”: widoczny zakres NIE zawiera dziś. */
export function todayPillVisible(
  mode: 'day' | 'month',
  anchor: DateStr,
  today: DateStr,
): boolean;
```
Test: długość i kolejność, dokładnie jedna pozycja `active`, `today` na właściwej
pozycji przy kotwicy = dziś i brak `today` przy kotwicy odległej, przełom miesiąca
i roku, `todayPillVisible` dla `mode: 'day'` (anchor = dziś → `false`) i
`mode: 'month'` (inny miesiąc → `true`).

### E. Czyste stackowanie bloków (`src/components/dayStack.ts` + test)

React-free, bez importu typów store'a:

```ts
/** Maksymalne wcięcie karty w stosie (dalsze karty nie wcinają się głębiej). */
export const MAX_STACK_INSET_STEPS = 3;

export interface StackInput { id: string; startMinutes: number; durationMinutes: number }
export interface StackSlot {
  id: string;
  stackIndex: number;  // pozycja w klastrze (0 = pierwsza)
  stackSize: number;   // ile bloków liczy klaster (1 = brak nakładania)
  insetSteps: number;  // min(stackIndex, MAX_STACK_INSET_STEPS)
}

/**
 * Grupuje bloki jednego dnia w klastry PRZECHODNIEGO nakładania czasowego
 * (`aStart < bEnd && bStart < aEnd`; sam styk krawędzi NIE nakłada się) i nadaje
 * im pozycję w stosie. Sortowanie deterministyczne: (startMinutes, dłuższy
 * pierwszy, id). Wynik w kolejności wejścia? NIE — w kolejności posortowanej;
 * konsument mapuje po `id`. Pusta lista → pusta lista.
 */
export function stackDayBlocks(blocks: StackInput[]): StackSlot[];
```
Test: brak nakładania → każdy `stackSize: 1, stackIndex: 0`; dwa nakładające się →
`stackSize: 2` i indeksy 0/1; łańcuch A∩B, B∩C, A∌C → JEDEN klaster o rozmiarze 3
(przechodniość); dokładny styk 10:00–11:00 i 11:00–12:00 → dwa osobne klastry;
`insetSteps` przycięte do `MAX_STACK_INSET_STEPS` przy 5 blokach; wynik
deterministyczny niezależnie od kolejności wejścia.

### F. WeekView — tryb dnia bez forka ścieżki przeciągania

**Decyzja architektoniczna (wiążąca): gałąź renderowania w JEDNYM `WeekView`, nie
równoległy komponent.** Powód: cały model przeciągania, kolizji, scalania i
zasobnika (≈1000 linii `TimedBlock` + `BinCard`) jest jednym organizmem
stanowiącym inwariant 7; osobny „DayView” zduplikowałby go i pierwszy rozjazd
byłby cichy. Cała różnica trybu dnia daje się wyrazić przez DŁUGOŚĆ tablicy
`days`, jedną klasę-modyfikator i dwa dodatkowe węzły prezentacyjne.

1. Prop: `mode?: 'week' | 'day'` (domyślnie `'week'`) oraz `onPickDay?: (date: DateStr) => void`.
   `CalendarPage` podaje `mode={phone ? 'day' : 'week'}` i istniejące `pickDay`.
2. `WeekView.tsx:1759`: `const days = useMemo(() => (mode === 'day' ? [anchor] : weekDays(anchor)), [mode, anchor])`.
   `buildWeekModel(state, days, filter)` przyjmuje dowolną długość
   (`weekViewModel.ts:169`) — nic więcej tam nie zmieniaj.
3. Zamień stałą `DAY_COLS` na `days.length` DOKŁADNIE w czterech miejscach, w
   których komponent ma prop `days`: `WeekView.tsx:411` (`colWidth`), `:496`
   (clamp `projDayIndex`), `:675` (`dayCount` dla `calendarBlockKeyboard` — jest
   już parametryzowane i przy 1 poprawnie clampuje: `calendarBlockKeyboard.ts:169`),
   `:826` (`kbColWidth`) oraz `:1310` (`hitIndex < DAY_COLS` w `BinCard`). W trybie
   tygodnia `days.length === 7`, więc arytmetyka jest identyczna. Stałą `DAY_COLS`
   zostaw wyłącznie jako domyślną liczbę kolumn tygodnia albo usuń, jeśli nie ma
   już konsumenta.
4. Klasa korzenia: `.week-cal` + `day-mode` przy `mode === 'day'`. CSS:
   `.week-cal.day-mode .week-days-grid { grid-template-columns: 1fr; width: 100%; }`
   (przebija `styles.css:1865-1870`, więc znika poziome przewijanie i przycięcie do
   1,5 kolumny).
5. W trybie dnia zamiast `.week-head-row` renderuj `.week-day-strip`
   (`role="tablist"`-podobny pasek przycisków, `overflow-x: auto`,
   `scroll-snap-type: x mandatory`, każdy element ≥44 px): dla każdego wpisu
   `dayStripEntries(anchor, todayStr())` przycisk `.week-day-strip-item` z klasami
   `active`/`today`/`weekend`, treścią `weekdayAbbr(date)` + `dayOfMonthLabel(date)`,
   `aria-current="date"` na aktywnym i `onClick={() => onPickDay?.(date)}`. Po
   zmianie kotwicy przewiń aktywny element do środka (`scrollIntoView({ inline: 'center', block: 'nearest' })`).
6. Stackowanie: przy `mode === 'day'` policz
   `stackDayBlocks(model.days[0].blocks.map(b => ({ id: b.block.id, startMinutes: b.block.startMinutes, durationMinutes: hoursToMinutes(b.block.plannedHours) })))`
   w `useMemo` i przekaż do `TimedBlock` NOWY, opcjonalny prop
   `stack?: { stackIndex: number; stackSize: number; insetSteps: number }`.
   W `TimedBlock` (`WeekView.tsx:945-952`) styl pozycji rozgałęzia się:
   - `stack === undefined` (desktop) → dzisiejsze `left: calc(col/cols*100% + 1px)`,
     `width: calc(100%/cols - 3px)` — bajt w bajt;
   - `stack !== undefined` → `left: calc(var(--stack-inset) * ${insetSteps})`,
     `width: calc(100% - var(--stack-inset) * ${insetSteps} - 3px)`,
     `zIndex: stackIndex + 1`, klasa dodatkowa `stacked` (i `stack-lead` przy
     `stackIndex === 0 && stackSize > 1`). `--n2-day-stack-inset: 28px` w `:root`.
     `top`/`height` i `transform` pozostają bez zmian — geometria czasu MUSI zostać
     zgodna z osią, bo przeciąganie liczy minuty z `dy` (`WeekView.tsx:482-483`).
   `MIN_BLOCK_H` i reszta stałych bez zmian.
7. Zasobnik jako arkusz. **`binRef` MUSI zostać na tym samym `.week-bin-pane`** —
   to on daje prostokąt testu `overBin` (`WeekView.tsx:499-505`). Wyodrębnij dzisiejsze
   `.week-bin-head` (`:2363-2369`) i `.week-bin-pane` (`:2482-2524`) do zmiennych JSX
   i renderuj:
   - `mode === 'week'` → dokładnie tam, gdzie dziś (identyczne drzewo);
   - `mode === 'day'` → oba wewnątrz `<div className={'week-bin-sheet ' + sheetState}>`
     z `.week-bin-sheet-handle` (uchwyt, `aria-hidden`) nad nagłówkiem.
   Stan: `const [binSheet, setBinSheet] = useState<'closed'|'peek'|'open'>('closed')`.
   Wyzwalacz `.week-bin-trigger` (renderowany tylko w trybie dnia, pływający nad
   dolnym paskiem) z etykietą `` `Zasobnik · ${formatDuration(binGrandTotal)}` ``
   i `aria-expanded`. Arkusz bierze z `useOverlay` (bez `getAnchorRect`,
   z `triggerRef`) stos Escape, zamykanie kliknięciem poza i powrót fokusa;
   `onClose` MUSI zignorować żądanie w trakcie przeciągania:
   `const closeBinSheet = useCallback(() => { if (dragActiveRef.current) return; setBinSheet('closed'); }, [])`.
   CSS: `.week-bin-sheet` `position: fixed; inset: auto 0 0 0; z-index: var(--n2-z-drawer);
   max-height: 85dvh; overscroll-behavior: contain; padding-bottom: env(safe-area-inset-bottom)`;
   `.closed { display: none }` (brak prostokąta → `overBin === false`, poprawnie),
   `.peek { height: 120px }`, `.open { height: 85dvh }`. **Peek realizuj wysokością,
   nigdy `transform: translateY`** — prostokąt `getBoundingClientRect` musi
   odpowiadać temu, co widać, inaczej strefa upuszczenia wyjdzie poza ekran.
8. Auto-peek podczas przeciągania — BEZ dotykania cyklu życia wskaźnika. Dodaj
   opcjonalny prop `onDragActiveChange?: (active: boolean) => void` do `TimedBlock`
   i `BinCard` i wołaj go w ISTNIEJĄCYM efekcie `useEffect([dragging])` obok
   `setLiveSyncHold` (`WeekView.tsx:386-390`, `:1249-1252`) — to obserwator, nie
   uczestnik gestu. W `WeekView` trzymaj licznik w refie (nakładające się
   montowania/odmontowania) plus `dragActiveRef`; przy przejściu 0→1 zapamiętaj
   poprzedni stan arkusza i ustaw `'peek'` (o ile był `'closed'`), przy 1→0 przywróć.
   **Bramka wydajności/identyczności:** callback musi natychmiast wyjść, gdy
   `modeRef.current !== 'day'` — na desktopie żaden dodatkowy `setState` nie może
   wystrzelić w trakcie przeciągania. Callback owiń `useCallback` (stabilna
   referencja — `TimedBlock`/`BinCard` są `memo`).
9. Deep-link zakładki „Zasobnik”: w trybie dnia `WeekView` czyta `useSearchParams()`;
   gdy `BIN_SHEET_PARAM === '1'`, ustaw `binSheet = 'open'` i ZDEJMIJ parametr
   przez `setSearchParams(next, { replace: true })` (jednorazowy efekt na zmianę
   parametru; nie ruszaj parametrów `task`/`wydarzenie`/`zgloszenie`).

### G. CalendarPage — telefonowy rząd 56 px

- `const phone = useMediaQuery(MOBILE_NAV_QUERY)`.
- `phone === false` → renderuj DZISIEJSZY `.cal-toolbar` bez żadnej zmiany.
- `phone === true` → `.cal-toolbar.cal-toolbar-phone` (kotwica
  `data-tour="calendar.toolbar"` ZOSTAJE na tym samym elemencie), wysokość 56 px,
  jeden rząd, cztery kontrolki: `‹` (`.nav-btn`), `.cal-range-btn`
  (widoczna etykieta okresu = ten sam tekst `label`, `id={CAL_RANGE_LABEL_ID}`,
  `role="status" aria-live="polite"` musi zostać — czyta go siatka miesiąca przez
  `aria-labelledby`), `›`, oraz istniejący `<FilterBar …>` z NIEZMIENIONYMI propsami.
  `NowClockBadge` i tytuł „Kalendarz” chowasz na telefonie (tytuł niesie górny pasek).
- W trybie `week` na telefonie ‹/› przesuwają o JEDEN DZIEŃ (`addDaysStr(a, ±1)`),
  bo widok pokazuje jeden dzień; w trybie `month` bez zmian (`shiftMonth`).
- Szybki skok: klik `.cal-range-btn` otwiera `.cal-jump-sheet` przez `useOverlay`
  (bez `getAnchorRect`, z `triggerRef`, `role="dialog"`, `aria-label="Skok do daty"`),
  zawierający: segment „Dzień” / „Miesiąc” (przestawia istniejący `view` —
  na telefonie `week` renderuje się jako dzień, więc etykieta brzmi „Dzień”),
  `<input type="date">` z etykietą „Skocz do dnia” (`setAnchor` na poprawnej dacie,
  walidacja przez `isValidDateStr`) i przycisk „Dzisiaj”. Arkusz zamyka się po
  wyborze.
- Pigułka: gdy `todayPillVisible(view === 'month' ? 'month' : 'day', anchor, todayStr())`,
  renderuj `<button className="cal-today-pill">Dzisiaj</button>` (pływająca nad
  dolnym paskiem, `bottom: calc(var(--n2-bottom-nav-h) + env(safe-area-inset-bottom) + 12px)`),
  wołającą istniejące `goToday`.
- CSS popovera filtrów NA TYM RZĘDZIE: `.cal-toolbar-phone .filter-popover`
  dostaje `position: fixed; left: 8px; right: 8px; top: auto;
  bottom: calc(var(--n2-bottom-nav-h) + env(safe-area-inset-bottom) + 8px);
  max-height: 70dvh; overflow: auto` — inaczej `position: static` z mobilnego
  breakpointu rozepchnie rząd 56 px. Reguła musi być zawężona do
  `.cal-toolbar-phone`, żeby mobilne filtry na innych stronach zostały bez zmian.
  `.cal-toolbar-phone .filter-toolbar-people { display: none }` — aktywne chipy
  osób nie mieszczą się w rzędzie, a wybór osób i tak żyje w popoverze.

## Out of scope

- Jakakolwiek zmiana w `src/store/**`, `src/utils/time.ts`, `src/utils/touchDrag.ts`,
  `useTouchDragGate.ts`, `src/utils/dates.ts`, `weekViewModel.ts`, `weekViewLayout.ts`,
  `MonthView.tsx`, `FilterPanel.tsx`, `FilterBar.tsx`, `PersonFilter.tsx`.
- Nowa akcja reduktora, nowe pole trwałe, migracja wersji danych, retirement mode.
- Zmiana zachowania filtrów, uprawnień, onboardingu (kotwice `data-tour` mają
  wyłącznie PRZETRWAĆ: `shell.nav`, `shell.help`, `shell.search`, `shell.main`,
  `calendar.toolbar`, `calendar.week`, `calendar.bin`, `calendar.block`,
  `calendar.overload`).
- Widok miesiąca na telefonie (zostaje jak jest), oś czasu, Kanban, TaskModal.
- Nowa biblioteka gestów/arkuszy — arkusz to CSS + istniejący `useOverlay`.
- Refaktor `WeekView` wykraczający poza wymienione punkty (bez wydzielania
  `TimedBlock`/`BinCard` do osobnych plików).

## Acceptance

- [ ] `≤760 px`: widoczny dolny pasek pięciu zakładek o wysokości 56 px +
      `env(safe-area-inset-bottom)`; hamburger, scrim i szuflada nie istnieją w DOM.
- [ ] `≤760 px`: „Więcej” otwiera arkusz z POZOSTAŁYMI trasami (w kolejności z
      `UiPrefs.navOrder`, z bramkami `/admin` i `/team`) oraz Ustawieniami, Pomocą,
      Moim profilem i Wyloguj; Escape i klik poza zamykają, fokus wraca na „Więcej”.
- [ ] `≤760 px`: `Ctrl+K` nadal otwiera wyszukiwarkę DOKŁADNIE raz (jeden
      zamontowany `GlobalSearch`), a jej wyzwalacz stoi w górnym pasku obok tytułu
      trasy.
- [ ] `≤760 px` na `/calendar`: renderuje się JEDNA pełnoszerokościowa kolumna dnia
      (brak poziomego przewijania siatki) i pasek 7 dat z aktywnym dniem w środku;
      klik daty przestawia dzień.
- [ ] Bloki nakładające się w widoku dnia rysują się jako kaskada kart pełnej
      szerokości (wcięcie ≤ `MAX_STACK_INSET_STEPS`), nie jako wąskie kolumny; każdy
      blok nadal otwiera zadanie dotknięciem i daje się przeciągnąć po
      przytrzymaniu.
- [ ] `≤760 px`: „Zasobnik · Xh” otwiera arkusz `max-height: 85dvh` z uchwytem i
      `overscroll-behavior: contain`; podczas przeciągania bloku z siatki arkusz sam
      wychodzi w stan `peek` i upuszczenie do zasobnika działa; po zakończeniu
      przeciągania wraca do stanu sprzed.
- [ ] `≤760 px` na `/calendar`: JEDEN rząd 56 px (‹ · zakres · › · Filtry z odznaką);
      „Dzisiaj” pojawia się jako pływająca pigułka wyłącznie wtedy, gdy widoczny
      zakres nie zawiera dzisiejszego dnia; przycisk zakresu otwiera szybki skok
      (Dzień/Miesiąc + wybór daty + Dzisiaj).
- [ ] `>760 px`: kalendarz, siatka tygodnia, zasobnik, drag, resize, scalanie,
      menu kontekstowe, klawiatura bloku i pasek sterowania są niezmienione — te same
      klasy, ten sam DOM, te same style inline (`stack === undefined`,
      `days.length === 7`).
- [ ] Zero zmian w `src/store/**` i w `package.json`; `git diff --stat` nie pokazuje
      innych plików niż wymienione w „Expected touchpoints”.
- [ ] Wszystkie nowe napisy są po polsku; nowe moduły `.ts` nie importują Reacta.

## Verification

- Worker (kolejno, wszystkie muszą przejść):
  - `npx vitest run src/components/bottomNav.test.ts src/components/dayStrip.test.ts src/components/dayStack.test.ts`
  - `npx vitest run src/components/calendarBlockKeyboard.test.ts src/components/weekViewLayout.test.ts src/utils/time.test.ts src/utils/touchDrag.test.ts`
  - `npm run typecheck`
- Browser: WYMAGANY — `node scripts/browser-check-bin-drag.mjs chromium free`
  oraz `node scripts/browser-check-bin-drag.mjs chromium collision`
  (wymaga `npm run dev` na :5173 w tle; zatrzymaj serwer po teście).
  Uzasadnienie: pakiet zmienia kod OBJĘTY tym scenariuszem — warunek trafienia
  kolumny w `BinCard` (`hitIndex < DAY_COLS` → `days.length`) i efekt przy stanie
  `dragging` w obu komponentach przeciągania. Skrypt jedzie na szerokości desktopu,
  więc jest dokładnie regresją „desktop bit-identical” dla inwariantu 7. Pozostałe
  skrypty przeglądarkowe (placement, bin-split, ui-keyboard) należą do
  weryfikacji wydania, nie do tego pakietu.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.
  Nie zakładaj żadnej stałej liczby testów — ma być zielono i bez regresji.

## Prior decisions

- Tryb dnia to GAŁĄŹ RENDEROWANIA w `WeekView` sterowana propem `mode`, a nie
  równoległy komponent — kod przeciągania/kolizji/scalania nie może się rozwidlić.
- Różnicę „7 kolumn vs 1” niesie DŁUGOŚĆ tablicy `days`; `DAY_COLS` znika z
  arytmetyki na rzecz `days.length` (w tygodniu = 7, więc wynik identyczny).
- Arkusze (Więcej, zasobnik, szybki skok) używają ISTNIEJĄCEJ powłoki `useOverlay`
  w wariancie nieporcjonowanym (jak `FilterPanel`) — nie powstaje nowy prymityw.
- Peek zasobnika realizuje WYSOKOŚĆ, nie `translateY`, bo prostokąt panelu jest
  strefą upuszczenia; `binRef` zostaje na `.week-bin-pane`.
- Sygnał „trwa przeciąganie” płynie z ISTNIEJĄCEGO efektu `[dragging]`
  (obok `setLiveSyncHold`), nigdy z handlerów wskaźnika; na desktopie callback
  wychodzi natychmiast.
- Zakładka „Zasobnik” to deep-link `/calendar?zasobnik=1` konsumowany i czyszczony
  w `WeekView` (`replace: true`) — bez nowego stanu globalnego i bez przeciągania
  propów przez `CalendarPage`.
- Przycisk „Filtry” z odznaką JUŻ ISTNIEJE (`FilterPanel`); telefonowy rząd go
  reużywa, a wybór osób zostaje w popoverze.
- Scalenie kontrolek kalendarza w jeden rząd (punkt 4 zlecenia) jest już zrobione
  na desktopie — pakiet dokłada wyłącznie wariant telefonowy.
- Ikona zakładki „Zasobnik” to `Archive` dodany do `src/components/icons.ts`
  (lucide-react jest już zależnością — to nie jest nowa zależność runtime).

## Report back

Zgłoś PO POLSKU: co zrobione per punkt 1–4, wyniki komend z sekcji Verification,
listę zmienionych plików, ryzyka. Zaznacz WYRAŹNIE, czy zdanie z
`ui-navigation-and-onboarding.md` („On mobile, a closed drawer is inert, and an open
drawer contains keyboard focus until it closes and restores focus to its trigger”)
przestało być prawdziwe — decyzję o zapisie wiki podejmuje recenzent/orkiestrator.
