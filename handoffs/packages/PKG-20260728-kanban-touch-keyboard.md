# Handoff: Kanban — przeciąganie wskaźnikiem (dotyk + mysz) i pełna ścieżka klawiaturowa

- Package ID: PKG-20260728-kanban-touch-keyboard
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: conditional — jedna strona + jeden nowy czysty moduł, ale dotyka
  cyklu życia wskaźnika (inwariant 7) i dodaje nową ścieżkę wywołania
  `SET_TASK_STATUS`.

## Goal

Tablica Kanban ma być w pełni obsługiwalna na dotyku i z klawiatury: natywne
HTML5 DnD (`draggable` + `dataTransfer`) znika, zastępuje je przeciąganie na
Pointer Events zgodne z konwencjami WeekView/TimelinePage, a obok niego istnieje
równoprawny tryb przenoszenia z klawiatury oraz akcja „Przenieś do statusu” w
menu karty. Zmiana statusu nadal idze WYŁĄCZNIE przez `SET_TASK_STATUS`.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md` (deklarowana strona obszaru)
- `openwiki/n2hub/scheduling-and-calendar.md` — TYLKO jako źródło konwencji
  wskaźnika (bramka dotyku, sprzątanie przechwycenia); Kanban nie jest
  kalendarzem i nie dotyka `WorkloadEntry`.

## Expected touchpoints

- `src/pages/KanbanPage.tsx`
- `new: src/pages/kanbanMove.ts` — czysty automat trybu przenoszenia
- `new: src/pages/kanbanMove.test.ts` — testy jednostkowe automatu
- `src/pages/kanbanBoard.ts` — wyłącznie `export` istniejącego `compareTasks`
  (bez zmiany zachowania; `kanbanBoard.test.ts` musi przejść bez zmian)
- `src/styles.css` — sekcja `/* ---------- Kanban ---------- */`
- `src/components/icons.ts` — dołożenie brakujących nazw ikon z lucide

## Invariants

1. Inwariant 6: jedyną mutacją tablicy jest istniejąca akcja
   `{ type: 'SET_TASK_STATUS', taskId, statusId }`. Nie wolno dodawać nowej akcji
   reduktora, nowego pola w `AppData` ani zapisu kolejności w kolumnie.
2. Inwariant 7: przechwycenie wskaźnika, timery i nasłuchy okna muszą być
   sprzątane na KAŻDEJ ścieżce (drop, `pointercancel`, Escape, blur okna,
   `visibilitychange`, odmontowanie w trakcie gestu). Wzorzec: `WeekView.tsx`
   ~330–435 oraz `TimelinePage.tsx` ~90–140.
3. `buildKanbanColumns` i jego kolejność `(orderIndex, startDate, id)` pozostają
   nietknięte poza samym `export` komparatora.
4. Uprawnienia bez zmian: przenoszenie (drag, klawiatura, menu) tylko gdy
   `can('tasks.manage')`. Bez tego karta zachowuje się jak dziś (otwarcie
   `TaskModal`).
5. Kliknięcie/dotknięcie bez przeciągnięcia nadal otwiera `TaskModal`
   (`moved`-ref jak w `TimelinePage.Bar`).

## Scope

### 1. Przeciąganie na Pointer Events (dotyk + mysz)

- Usuń z karty `draggable`, `onDragStartCapture` i z kolumn `onDragOver`,
  `onDragLeave`, `onDrop` wraz z `dataTransfer`.
- `onPointerDown` na karcie: `e.button !== 0` → return; zbierz `init`
  SYNCHRONICZNIE (element, `pointerId`, `clientX/Y`), następnie
  `if (gate.arm(e.pointerType, e.clientX, e.clientY, () => startDrag(init))) return;`
  i dopiero potem `startDrag(init)`. Bramka to istniejący
  `useTouchDragGate()` z `src/utils/useTouchDragGate.ts` — NIE pisz własnej.
- `startDrag`: `setPointerCapture` w `try/catch` (jak WeekView), zapamiętaj
  przechwycenie w refie, wyzeruj `moved`, ZMIERZ raz prostokąty kolumn.
- Cel upuszczenia licz z ZMIERZONYCH prostokątów renderowanych kolumn
  (`data-status-id` na `.kanban-col` + `getBoundingClientRect()`), nie z
  `elementFromPoint` — przechwycenie wskaźnika przekierowuje zdarzenia na kartę.
- Ruch: jedno `requestAnimationFrame` na klatkę (koalescencja jak w WeekView);
  najświeższy cel trzymaj w refie, żeby `pointerup` widział aktualną projekcję.
- `pointerup`: jeśli cel istnieje, jest kolumną aktywnego statusu i różni się od
  źródła → `dispatch({ type: 'SET_TASK_STATUS', ... })`. W przeciwnym razie brak
  wysyłki.
- Anulowanie bez wysyłki: `pointercancel`, Escape, `blur` okna,
  `visibilitychange` na `hidden`, mysz z `buttons === 0` w `pointermove`.
- CSS: karta NIE dostaje `touch-action: none` (blokadę przewijania zakłada sama
  bramka po uzbrojeniu — patrz komentarz w `useTouchDragGate.ts`).
- Kolumna archiwum pozostaje NIE-celem upuszczenia; karty wyciąga się z niej do
  kolumn aktywnych (dziś to samo).

### 2. Tryb przenoszenia z klawiatury — czysty automat `kanbanMove.ts`

Moduł BEZ Reacta i bez dostępu do store'u (wzorzec `touchDrag.ts` /
`kanbanBoard.ts`). Minimalny kształt (nazwy do Twojej decyzji, kontrakt nie):

- wejście: lista kolumn-celów `{ statusId, name, tasks }` (tylko statusy
  aktywne) + przenoszone zadanie;
- stan: `null` (brak trybu) albo `{ taskId, sourceStatusId, targetIndex }`;
- zdarzenia: `pickup`, `move(-1 | 1)`, `first`, `last`, `drop`, `cancel`;
- **zdarzenie bez skutku zwraca TĘ SAMĄ referencję stanu** (jak
  `touchHoldReducer`) — na krawędziach listy `move` się nie zawija;
- `drop` zwraca intencję `{ taskId, statusId }` albo `null`, gdy cel = źródło;
  wysyłkę robi warstwa Reactowa;
- pozycja docelowa: funkcja licząca INDEKS, na którym karta wyląduje w kolumnie
  celu, użyj `compareTasks` wyeksportowanego z `kanbanBoard.ts` (nie duplikuj
  klucza sortowania — reguła z `CLAUDE.md`);
- budowniczowie komunikatów po polsku, np.
  `„Podniesiono: Nazwa zadania. Kolumna W toku, pozycja 2 z 4."`,
  `„Cel: kolumna Gotowe, pozycja 1 z 3."`,
  `„Przeniesiono: Nazwa zadania do kolumny Gotowe."`,
  `„Anulowano przenoszenie. Nazwa zadania zostaje w kolumnie W toku."`.

Warstwa Reactowa (`KanbanPage.tsx`):

- w karcie dodaj UCHWYT PRZENOSZENIA — `<button>` z dostępną etykietą
  (np. „Przenieś zadanie: <tytuł>”), `aria-pressed` w trybie przenoszenia;
- Spacja/Enter na uchwycie: podnieś / upuść; Escape: anuluj i przywróć (żadnej
  wysyłki); strzałki: zmiana kolumny celu; `Home`/`End`: pierwsza/ostatnia
  kolumna; `Tab` w trybie przenoszenia: anuluj (nie zostawiaj wiszącego trybu);
- po `drop`/`cancel` fokus wraca na uchwyt tej samej karty;
- `preventDefault` na obsłużonych klawiszach (Spacja nie może przewinąć strony);
- ukryty opis (`sr-only`, wzorzec `kanban-quick-status-hint`) z instrukcją
  skrótów, podpięty przez `aria-describedby` uchwytu.

### 3. Akcja „Przenieś do statusu →” w menu karty

- Menu na współdzielonej powłoce `useOverlay` + `OverlayLayer`
  (`menuKeyboard: true`, `role="menu"` / `role="menuitem"`) — wzorzec:
  `WeekView.tsx` ~1500–1545 i ~2400–2540.
- Zawartość: pozycja „Przenieś do statusu” otwierająca drugi krok z listą
  aktywnych statusów; wybór wysyła `SET_TASK_STATUS`. Bieżący status oznaczony
  (`aria-checked` lub wyłączony) — nie wysyłaj no-opa.
- Wyzwalacz: `IconButton` (`size="sm"`, `expanded`), ikona z `icons.ts`
  (dołóż `MoreVertical`/`GripVertical` do curated exportu, jeśli brak).
- Menu i uchwyt renderuj TYLKO gdy `can('tasks.manage')`.

### 4. Komunikaty na żywo i wskaźnik upuszczenia

- Jeden region `role="status" aria-live="polite" aria-atomic="true"` w klasie
  `sr-only` na stronie; komunikaty z buildera z `kanbanMove.ts`.
- Ogłaszamy: podniesienie, każdą zmianę kolumny celu, upuszczenie, anulowanie.
- WIDOCZNY wskaźnik upuszczenia: kolumna celu podświetlona (istniejące
  `.kanban-col.drag-over`) ORAZ pozioma kreska `.kanban-drop-indicator`
  wstawiona w `.kanban-col-body` na wyliczonym indeksie docelowym. Ten sam
  wskaźnik obsługuje przeciąganie wskaźnikiem i tryb klawiaturowy.

## Out of scope

- **Wygląd karty.** Treść, rozmiar, gęstość i awatary `.kanban-card` zostają
  1:1. Uchwyt przenoszenia i wyzwalacz menu to absolutnie pozycjonowany klaster
  w prawym górnym rogu karty: w spoczynku niewidoczny (`opacity: 0`,
  `pointer-events: none`), ujawniany na `:hover`, `:focus-within` i w trybie
  przenoszenia. Jedyny dopuszczony wyjątek: w `@media (pointer: coarse)` klaster
  jest widoczny stale (na dotyku nie ma hovera, a bez tego ścieżka bez
  przeciągania nie istnieje) — opisz to komentarzem w CSS.
- Zmiana kolejności zadań wewnątrz kolumny (patrz „Prior decisions”).
- Jakakolwiek biblioteka DnD (dnd-kit i pochodne) oraz nowa zależność runtime.
- Zmiany w `buildKanbanColumns`, filtrach, presetach, `TaskModal`.
- Tryb wygaszania (retirement mode) zostaje wyłączony.

## Acceptance

- [ ] W `KanbanPage.tsx` nie ma już `draggable`, `dataTransfer`, `onDragOver`,
      `onDrop`, `onDragStartCapture`.
- [ ] Przeciąganie myszą przenosi kartę między kolumnami dokładnie jak dotąd.
- [ ] Na wskaźniku `touch`/`pen` przeciąganie startuje dopiero po przytrzymaniu
      (`useTouchDragGate`); ruch przed czasem przewija tablicę.
- [ ] Uchwyt karty: Spacja/Enter podnosi, strzałki zmieniają kolumnę,
      Spacja/Enter upuszcza, Escape anuluje BEZ wysyłki; fokus wraca na uchwyt.
- [ ] Menu karty ma działającą pozycję „Przenieś do statusu” z listą aktywnych
      statusów.
- [ ] Region `aria-live` ogłasza podniesienie, zmianę celu, upuszczenie i
      anulowanie po polsku; wskaźnik pozycji jest widoczny.
- [ ] W spoczynku (bez hovera i fokusa) karta wygląda identycznie jak przed
      zmianą.
- [ ] `kanbanMove.test.ts` pokrywa: podniesienie z kolumny aktywnej i z
      archiwum, clamp na obu krawędziach, no-op zwracający tę samą referencję,
      `drop` na źródle → `null`, `cancel` → stan `null`, zdarzenia w stanie
      spoczynku, pustą listę kolumn, wyliczanie „pozycja N z M”.
- [ ] `npm run build` (czyli `tsc --noEmit` + vite) przechodzi.

## Verification

- Worker: `npx vitest run src/pages/kanbanMove.test.ts src/pages/kanbanBoard.test.ts`
  oraz `npm run typecheck`; na koniec `npm test`.
- Browser: none — brak skryptu pokrywającego tablicę Kanban w `scripts/`;
  pełna matryca należy do weryfikacji wydania.
- Scheduler owns final `npm test && npm run build`.

## Prior decisions

- **Pozycja w kolumnie jest POCHODNA, nie zapisywana.** Kolejność w kolumnie
  wynika z `(orderIndex, startDate, id)` i miesza projekty; jedyna istniejąca
  akcja kolejności, `REORDER_PROJECT_TASK`, działa w obrębie PROJEKTU, więc nie
  da się nią deterministycznie ustawić karty względem sąsiada z innego projektu.
  Dlatego: tryb klawiaturowy wybiera KOLUMNĘ, a „pozycja N z M” to wyliczone
  miejsce, w którym karta faktycznie wyląduje. Strzałki lewo/prawo ORAZ
  góra/dół zmieniają kolumnę (tablica to jeden poziomy pas `overflow-x`);
  nie udajemy swobodnego ustawiania pozycji, bo model tego nie utrwali.
  Powód nadrzędny: inwariant 6 i zakaz nowych ścieżek mutacji.
- Bramka dotyku jest istniejącym, przetestowanym `useTouchDragGate` (350 ms,
  slop 10 px) — Kanban ma jej UŻYĆ, nie kopiować.
- Menu korzysta z istniejącej powłoki `useOverlay`; nie powstaje druga
  implementacja popovera.
