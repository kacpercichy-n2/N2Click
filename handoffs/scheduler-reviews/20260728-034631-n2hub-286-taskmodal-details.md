# Raport workflow: 20260728-034631-n2hub-286-taskmodal-details

## Wykonane

**Analiza wstępna: wszystkie 6 pozycji było NADAL otwartych w bieżącym buildzie.**
Prompt 285 przebudował strukturę modala (zakładki `Zadanie | Planowanie |
Dyskusja`, model `taskModalSections.ts`), ale żadnej z poniższych rzeczy nie
dotknął. Dowody z kodu przed zmianą:

| Pozycja | Stan | Kotwica |
| --- | --- | --- |
| AT-05 siatka | otwarte | `AllocationGrid.tsx:158` renderował `days.map` bez wyjątku; `placeholder="0"`; weekend to była wyłącznie klasa `alloc-weekend` |
| AT-13 cele / „Wyczyść" | otwarte | `AllocationGrid.tsx:139–149` — „Wypełnij dni robocze" i „Wyczyść" jako dwa gołe `link-btn`; `onClearPerson` bez potwierdzenia i bez cofnięcia |
| AT-08 „Usuń" | otwarte | `TaskModal.tsx:383–388` — `btn danger-ghost` wewnątrz `.task-modal-head-actions`, obok „✕" |
| AT-10 zakładki | otwarte | `CommentsPanel.tsx:160–181` — para `toggle-btn` „Komentarze (n)" / „Aktywność (n)" z `role="tab"` |
| IA-08 odhaczanie | otwarte | `WeekView.tsx:972/1427/1609` — `block-done-mark` był biernym `<span>`, nie kontrolką |
| IA-15 pełna strona | otwarte | `App.tsx:598` — `/tasks/:id` istniało wyłącznie jako `<Navigate to="/tasks?task=…">` (`TaskRedirect`) |

Praca przeszła ścieżką tier `architect → developer` (recenzja jest własnością
schedulera). Pakiet: `handoffs/PKG-20260728-taskmodal-details.md`, jeden pakiet
dla jednego developera — `TaskModal.tsx` jest dotykany przez pięć z sześciu
pozycji, więc równoległe pakiety by się zderzyły.

### 0. Wspólny prymityw — menu ⋯

W repo nie było żadnego menu przepełnienia (grep: zero trafień), a potrzebują go
pozycje AT-13, AT-08 i AT-10. Powstał `src/components/OverflowMenu.tsx`:
wyzwalacz `IconButton` + `MoreHorizontal` i popover na `useOverlay` /
`OverlayLayer` (`role="menu"`, `menuKeyboard: true`, `positionedBox`,
`triggerRef` dla przełączania kliknięciem). Zero własnej logiki a11y — Escape,
zamknięcie kliknięciem poza, roving focus, typeahead i powrót fokusa pochodzą
z przetestowanego `overlayShell.ts`, więc nowy moduł czysty nie był potrzebny.
`IconButton` dostał jedno opcjonalne pole `haspopup?: 'menu' | 'dialog'`
(→ `aria-haspopup`).

### 1. AT-08 — „Usuń" znika z nagłówka

Czerwony `btn danger-ghost` usunięty z `.task-modal-head-actions`. „Usuń
zadanie" jest teraz pozycją danger w `<OverflowMenu label="Więcej działań">`
między `SaveStatus` a „✕". Nagłówek to tytuł + status zapisu + ⋯ + zamknij;
czerwień wraca do roli koloru ostrzeżeń. Cały dotychczasowy przepływ
potwierdzenia (lista konsekwencji, `requireAck`, `tone: 'danger'`) został
przeniesiony dosłownie do nowego, eksportowanego hooka `useDeleteTaskConfirm`.

### 2. AT-10 — kolizja zakładek

`role="tablist"` i obie `toggle-btn` skasowane z `CommentsPanel`. Stan `tab`
zmieniony na `view`, doszła `.comments-head` (tytuł + ⋯ z pozycją „Historia
zmian (n)"), a widok aktywności ma „← Wróć do komentarzy". Nie ma już dwóch
stykających się celów — jest jeden widok domyślny i log systemowy schowany pod
⋯, zgodnie z treścią zadania. **Zasięg poza modalem:** ten sam panel renderuje
`ProjectDetailPage`, więc zmiana widoczna jest też tam (świadome, opisane
w pakiecie). Reguły `.toggle-btn` w CSS nietknięte.

### 3. AT-13 — cele i „Wyczyść"

Checkboxy (`.checklist-row`, używane przez „Checklistę" i „Wykonane bloki")
z 13 px na 20 px, wiersz `min-height: 40px`, etykieta klikalna: wiersze dostały
`id="chk-<id>"` / `id="blk-<id>"`, a `<span class="checklist-text">` zamienił się
w `<label htmlFor>`. „Usuń" celowo stoi poza etykietą, żeby kliknięcie w nią nie
kasowało pozycji.

„Wyczyść" wyszło z paska: każda kolumna osoby ma teraz `OverflowMenu size="sm"`
z pozycją „Wyczyść kolumnę" (bez dialogu potwierdzenia — zgodnie z zadaniem)
oraz link „Cofnij", widoczny dopóki dla tej osoby żyje migawka. Migawka siedzi
w lokalnym stanie `TaskEditor` (`clearUndo` + refy, żeby `clearPerson`
i `undoClear` zostały stabilnymi `useCallback`), **nie** w reduktorze —
przydziały są stanem szkicu uzgadnianym dopiero przez `SAVE_TASK`, więc nowa
akcja reduktora byłaby zmianą granicy mutacji bez powodu. Migawka jest
unieważniana przez: kolejne czyszczenie, użycie „Cofnij", ręczną edycję komórki,
„Wypełnij dni robocze", zmianę `startDate`/`endDate` i odpięcie osoby.

### 4. AT-05 — siatka pełna zer

Nowy czysty moduł `src/components/allocationGridView.ts`: `groupAllocationDays`
(zwija ciągi ≥ 2 dni o zerowej sumie w segment), `collapsedGroupLabel` (etykieta
przez `polishCount`, w kształcie „14 pustych dni roboczych + 6 weekendowych —
pokaż"), `snapshotPersonColumn` / `restorePersonColumn` (dla AT-13) oraz
`allocKey`, przeniesiony tu i re-eksportowany z `AllocationGrid.tsx`, żeby
importy konsumentów się nie zmieniły.

Siatka renderuje segmenty zamiast `days.map`. Znacznik wiersza dnia jest poza
trzema rzeczami identyczny: doszła klasa `has-value` z `borderLeftColor`
w kolorze osoby, `placeholder="—"` zamiast `"0"` (zero ma wyglądać jak brak,
nie jak dana) i zaczep `data-date`. **Logika edycji nietknięta**: `onChange`
z klamrowaniem 0–24, krok 0.25, pole godziny startu, ostrzeżenie o przeciążeniu,
badge ×N i propsy `memo` bez zmian.

### 5. IA-08 — odhaczanie bloku na kafelku

Bierny `block-done-mark` zostaje tylko dla bloków nieedytowalnych. Blok
edytowalny dostaje **rodzeństwo** — `<button class="week-block-done-btn">` tuż
za przyciskiem zasobnika, dokładnie wg doktryny `week-block-bin-btn`, a nie
dziecko kafelka. `onPointerDown` robi `stopPropagation`, więc ✓ nigdy nie
zaczyna przeciągania ani zmiany rozmiaru (inwariant 7); `onClick` też zatrzymuje
propagację i wysyła **ten sam** `SET_BLOCK_DONE`. Dostępność: `aria-pressed`,
polskie `aria-label`, `onBlur={onKbFocusOut}` i uwzględnienie w `kbFocusStays`
przez `doneBtnRef`, żeby wyjście fokusa na ✓ nie gubiło edycji klawiaturowej.
Widoczność: domyślnie ukryty z `pointer-events: none`, pokazywany na hover
kafelka (nasłuch wyłącznie obserwujący, `onPointerEnter/Leave`), na
`:focus-visible`, gdy blok jest wykonany, i zawsze przy `pointer: coarse`.

`aria-pressed` i przełącznik czytają `entry.done`, a nie złożone
`blockIsDone` (które liczy też status zadania) — inaczej stan wciśnięcia
kłamałby o tym, co zrobi dispatch.

W modalu `done-blocks` ma `collapsible: true` w `taskModalSections.ts`, a sekcja
jest zwiniętym disclosure „Wykonane bloki (wykonano d/n)", rozwijanym
automatycznie, gdy w URL jest `?block=`.

### 6. IA-15 — pełna strona zadania

`TaskEditor` był już rozdzielalny (`TaskModal.tsx:492`), więc został po prostu
wyeksportowany — bez przenoszenia pliku i bez duplikowania edytora. Nowa strona
`src/pages/TaskFullPage.tsx` renderuje **ten sam** komponent, te same zakładki
i tę samą siatkę na pełnej szerokości; `TaskRedirect` skasowany z `App.tsx`,
`/tasks/:id` prowadzi teraz do strony. `/tasks/new` działa jak dotąd, a brakujące
id nadal daje istniejący stan „Nie znaleziono zadania". Doszły: czysty
`src/pages/taskPageRoute.ts` (rozstrzyganie trasy, testowalne bez DOM), zakres
`'task-page'` w `dirtyRegistry.ts` (semantyka pathname, jak `project-detail`)
i link „Otwórz pełny widok ↗" w nagłówku modala. Usunięcie ze strony uzbraja
`bypassNavGuardOnce()`, żeby strażnik nawigacji nie pytał drugi raz. Modal
pozostaje ścieżką szybkiej edycji.

## Zmiany

Nowe pliki:

- `src/components/OverflowMenu.tsx` — prymityw menu ⋯ na `useOverlay`/`OverlayLayer`.
- `src/components/allocationGridView.ts` + `.test.ts` — czyste grupowanie dni, etykieta zwinięcia, migawka kolumny, `allocKey`.
- `src/pages/TaskFullPage.tsx` — pełna strona `/tasks/:id`.
- `src/pages/taskPageRoute.ts` + `.test.ts` — rozstrzyganie trasy zadania.
- `handoffs/PKG-20260728-taskmodal-details.md` — pakiet architekta.

Zmodyfikowane:

- `src/components/TaskModal.tsx` — AT-08, „Otwórz pełny widok ↗", eksport `TaskEditor` i `useDeleteTaskConfirm`, stan cofania AT-13, zwinięte „Wykonane bloki".
- `src/components/AllocationGrid.tsx` — AT-05 (segmenty, kolor osoby, „—") i AT-13 (menu ⋯ + „Cofnij").
- `src/components/CommentsPanel.tsx` — AT-10.
- `src/components/WeekView.tsx` — IA-08.
- `src/components/taskModalSections.ts` + `.test.ts` — `done-blocks` zwijalne.
- `src/components/IconButton.tsx`, `src/components/icons.ts` — `haspopup`, `MoreHorizontal`.
- `src/utils/dirtyRegistry.ts` + `.test.ts` — zakres `'task-page'`.
- `src/styles.css` — cele 20 px / wiersz 40 px, `.overflow-menu`, `.week-block-done-btn`, `.comments-head`, `has-value`.
- `scripts/browser-check-savetask-multiblock.mjs` — selektor wiersza po `data-date` zamiast `.nth(index)`.
- `handoffs/RUN-STATE.md` — wpis runu.

## Weryfikacja

Uruchomione i zweryfikowane niezależnie przez orkiestratora, nie tylko przez workera:

- `npm test` → **82 pliki, 1845 testów, wszystkie zielone, 0 nieudanych**.
- `npm run build` (`tsc --noEmit && vite build`) → **zielony**; jedyne ostrzeżenie to istniejący wcześniej komunikat o chunku > 500 kB.
- Testy skupione w trakcie pracy: `npx vitest run src/components/allocationGridView.test.ts src/components/taskModalSections.test.ts src/utils/dirtyRegistry.test.ts src/pages/taskPageRoute.test.ts` → 4 pliki, 57 testów zielonych.

Nowe pokrycie jednostkowe (Vitest, `environment: 'node'`): grupowanie i zwijanie
dni siatki wraz z etykietą po polsku, migawka/przywrócenie kolumny osoby,
zwijalność `done-blocks` w modelu sekcji, rozstrzyganie trasy `/tasks/:id`
i zakres `'task-page'` w rejestrze „dirty". `vitest.config.ts` to
`environment: 'node'` z `include: src/**/*.test.ts` — w repo nie ma jsdom ani
RTL, więc testów renderujących DOM nie da się napisać; pokrycie trasy i siatki
idzie przez czyste funkcje, zgodnie z decyzją zapisaną w pakiecie.

**Czego NIE udało się zweryfikować:** checki przeglądarkowe nie ruszyły —
pakiet `playwright` nie jest zainstalowany w tym worktree
(`node scripts/browser-check-savetask-multiblock.mjs chromium` →
`ERR_MODULE_NOT_FOUND: Cannot find package 'playwright'`). Żadnej asercji nie
osłabiono i nic nie zostało udane za przejście.
`browser-check-savetask-multiblock.mjs` i `browser-check-ui-keyboard.mjs`
pozostają niezweryfikowane.

## Ryzyka / rzeczy do sprawdzenia

1. **Zmiana w checku przeglądarkowym jest niezweryfikowana.** AT-05 zwija ciągi
   pustych dni, więc dotychczasowe celowanie `.alloc-grid tbody tr` + `.nth(dayIndex)`
   przestaje wskazywać zasiany dzień. Zastosowano dopuszczoną w pakiecie
   minimalną poprawkę: wiersz niesie `data-date`, a check wybiera
   `tr[data-date="…"]` (zasiany dzień ma godziny, więc nigdy nie jest zwinięty).
   Asercje bez zmian, `node --check` przechodzi, ale **wymaga to prawdziwego
   uruchomienia** — to jedyna zmiana w repo, której nie potwierdza żaden zielony
   przebieg.
2. **Nowy poziom z-index, rozszerzenie kontekstu.** Popover ⋯ portaluje się do
   `<body>`, więc na wspólnym z-index `.context-menu` (100) rysowałby się POD
   modalem zadania (1001). Doszedł token `--n2-z-menu-over-modal: 1095`,
   nakładany wyłącznie przez `.context-menu.overflow-menu` (nad modalem
   i banerami, pod onboardingiem 1100, potwierdzeniem 1200 i tooltipem 1300).
   Skutek uboczny: `OverflowMenu` otwarte na zwykłej stronie przebija też szufladę
   i wyszukiwarkę globalną. `styles.css` był zadeklarowanym dotknięciem, ale sama
   decyzja o drabince z-index nie — to świadome rozszerzenie kontekstu do oceny
   przez recenzenta.
3. **Tab wewnątrz menu ⋯ przy otwartym modalu** wciąga fokus z powrotem do karty
   modala (pułapka `useModalShell`) bez zamknięcia popovera; Escape i kliknięcie
   poza nadal zamykają. To ta sama klasa zachowania, co istniejące menu na
   Kanbanie — świadomie nienaprawiane, żeby zostać w zakresie.
4. **AT-10 dotyka też strony projektu.** `ProjectDetailPage` renderuje ten sam
   `CommentsPanel`, więc „Aktywność" chowa się pod ⋯ również tam. Opisane
   w pakiecie i zaakceptowane, ale warto to zobaczyć na własne oczy.
5. **Najbardziej widoczna zmiana zachowania siatki:** okres bez ani jednej
   godziny zwija się teraz do jednego paska, dopóki użytkownik go nie rozwinie.
   Zamierzone i objęte asercją w teście, ale to zmiana pierwszego wrażenia
   przy nowym zadaniu.
6. Inwariant 6 nietknięty — nie dodano żadnej akcji reduktora; cofanie AT-13
   żyje w stanie szkicu `TaskEditor`. Inwariant 7: ✓ na kafelku jest rodzeństwem
   bloku i zatrzymuje propagację `pointerdown`, więc nie wchodzi w ścieżkę
   przeciągania — ale to powierzchnia wrażliwa na stabilność i tylko check
   przeglądarkowy (patrz ryzyko 1) potwierdziłby to twardo.

Decyzję `wiki updated` / `wiki unchanged` podejmuje recenzent schedulera.

## Podpis schedulera

- Run: `20260728-034631-n2hub-286-taskmodal-details`
- Prompt: `286-taskmodal-details.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `10d9295a5b1132db38d1f6fbb332c2a2849f0024`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `10d9295a5b1132db38d1f6fbb332c2a2849f0024`
- Gałąź review: `review-integration`
- Run: `20260728-034631-n2hub-286-taskmodal-details`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `scripts/browser-check-savetask-multiblock.mjs`
- `src/App.tsx`
- `src/components/AllocationGrid.tsx`
- `src/components/CommentsPanel.tsx`
- `src/components/IconButton.tsx`
- `src/components/TaskModal.tsx`
- `src/components/WeekView.tsx`
- `src/components/icons.ts`
- `src/components/taskModalSections.test.ts`
- `src/components/taskModalSections.ts`
- `src/styles.css`
- `src/utils/dirtyRegistry.test.ts`
- `src/utils/dirtyRegistry.ts`
- `handoffs/PKG-20260728-taskmodal-details.md`
- `handoffs/scheduler-reviews/20260728-034631-n2hub-286-taskmodal-details.md`
- `src/components/OverflowMenu.tsx`
- `src/components/allocationGridView.test.ts`
- `src/components/allocationGridView.ts`
- `src/pages/TaskFullPage.tsx`
- `src/pages/taskPageRoute.test.ts`
- `src/pages/taskPageRoute.ts`
