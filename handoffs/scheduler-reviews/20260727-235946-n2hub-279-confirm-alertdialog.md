# Raport workflow: 20260727-235946-n2hub-279-confirm-alertdialog

## Wykonane

Zadanie było **nadal aktualne** — przed startem `grep -rn "window\.confirm" src/`
zwracał dokładnie 29 wywołań produkcyjnych w 17 plikach. Zweryfikowano też
warunek wstępny z promptu 277: pułapka fokusa istnieje (`src/components/modalShell.ts`
— czysta logika cyklu Tab, fokus startowy po `data-autofocus`, wspólny licznik
blokady scrolla — plus warstwa DOM `src/components/useModalShell.ts`).

Zbudowano wspólne okno potwierdzenia i **zmigrowano 28 z 29 wywołań**:

- **`src/components/confirmDialog.ts` (nowy)** — cała decyzyjność bez DOM-u:
  kolejka FIFO żądań (`enqueueConfirm` / `activeConfirm` / `resolveConfirm` /
  `drainConfirms`), bramka `requireAck` (`confirmIsBlocked`) i budowniczy treści
  skutków (`buildDeleteConsequence`, `joinPolishList`). `resolveConfirm` dla
  nieznanego `id` zwraca tę samą referencję stanu, więc jedna obietnica nie może
  rozstrzygnąć się dwa razy; samo `resolve` woła warstwa React, moduł zostaje
  wolny od efektów ubocznych.
- **`src/components/ConfirmProvider.tsx` (nowy)** — `useConfirm()` zwracające
  `(opts) => Promise<boolean>`; jedna instancja dialogu na całą aplikację,
  renderowana przez `useModalShell` z `role="alertdialog"`, `aria-labelledby` na
  tytule, `aria-describedby` na tekście skutków i fokusem startowym na „Anuluj”
  (przez istniejący mechanizm `data-autofocus`). Escape i tło = anulowanie.
  Dostawca zamontowany raz w `src/main.tsx`, ponad całym drzewem konsumentów.
- **`src/utils/polishPlural.ts` (nowy)** — `polishCount` wyciągnięty z **trzech**
  identycznych kopii (`ClientsPage`, `ProjectsPage`, `GlobalSearch`), plus
  `polishAmount` / `formatPolishNumber` dla godzin ułamkowych.
- **`src/components/useModalShell.ts`** — dwie nowe opcje: `role`
  (`dialog` | `alertdialog`) oraz `stacked`. `stacked` przenosi nasłuch klawiatury
  do fazy **capture** i zatrzymuje propagację Escape oraz Tab (także przy
  `action.type === 'none'`), więc dialog nad otwartym TaskModalem/EventModalem nie
  zamknie modala pod spodem ani nie odda mu fokusa. Bez tego Tab w środku listy
  uciekał do pułapki rodzica.
- **`src/styles.css`** — `--n2-z-confirm: 1200` (nad banerem trwałości 1050 i
  onboardingiem 1100), `.btn.danger` oraz `.confirm-*`. Czerwony styl jest
  zarezerwowany wyłącznie dla przycisku niszczącego i jest spójny we wszystkich
  wywołaniach. Wejście karty to keyframe CSS, nie `motion.div` — dostawca stoi
  ponad `MotionConfig reducedMotion="user"`, więc tylko CSS respektuje globalną
  regułę `prefers-reduced-motion`.

Treść skutków podaje nazwę celu i **prawdziwe** liczby z istniejących selektorów,
np. „Usunąć „Kampania lipiec”?” + „To usunie 3 przypisania i 12 zaplanowanych
godzin." (`ClientsPage` korzysta z policzonego już `projectCounts`, `TasksPage`
z `assigneeIdsOfTask` + `taskPlannedTotal`). Sumy godzin pozostają derywowane z
`WorkloadEntry` — nic nie jest przechowywane osobno (inwariant 1). `requireAck`
włącza się wyłącznie tam, gdzie faktycznie giną dane (kaskadowe usunięcie
klienta, usunięcie zadania z zaplanowanymi godzinami); pytania o niezapisane
zmiany zostają jednym kliknięciem. Wszędzie, gdzie wynik potwierdzenia zasilał
istniejącą logikę, logika jest niezmieniona — zmienił się wyłącznie mechanizm
pytania.

### Świadome decyzje w miejscach ryzykownych

- **`ErrorBoundary.tsx:68` — jedyne pozostawione `window.confirm`.** Ekran awarii
  renderuje się dopiero po tym, jak poddrzewo już rzuciło wyjątkiem, więc nie może
  zależeć od drzewa Reacta, które właśnie padło; ta sama klasa jest w `main.tsx`
  zamontowana także **ponad** `ConfirmProvider`, więc w jednej ze swoich dwóch
  pozycji nie ma dostępu do kontekstu, a komponent klasowy i tak nie użyje hooka.
  Powód zapisany w komentarzu w pliku. `scripts/browser-check-date-hardening.mjs`
  (flow4/flow5) nadal steruje tym natywnym dialogiem i pozostaje poprawny.
- **`WeekView` — usuwanie bloku z zasobnika (inwariant 7).** Wpis pobierany, a
  `setMenu(null)` wołane **przed** `await`; cykl życia nakładki i wskaźnika nigdy
  nie przechodzi przez await. `DELETE_BLOCK` z tym samym `entryId` bez zmian.
- **`App.tsx` — strażnik nawigacji.** `proceed`/`reset` destrukturyzowane z
  blokera przed `await`, plus `askingRef`, żeby ponowny render w trakcie blokady
  nie postawił drugiego pytania (natywny, blokujący confirm czynił oba
  scenariusze niemożliwymi).
- **`bypassNavGuardOnce` + nawigacja** pozostają nieprzerwaną parą synchroniczną
  we wszystkich czterech miejscach (`closeDeliberately` w TaskModal/TicketModal/
  EventModal oraz `remove` i „Wróć” w ProjectDetailPage).
- **`PersistenceBanner` i `OnboardingRoot`** renderują się wewnątrz `App`, czyli
  poniżej dostawcy — sprawdzone, bez zmian w montażu.

### Odstępstwa od treści promptu

1. Sformułowanie skutków to „To usunie 3 przypisania i 12 zaplanowanych godzin.",
   a nie proponowane w promptzie „Usunięte zostaną …". Ta druga forma wymaga
   uzgodnienia rodzaju i liczby z pierwszym rzeczownikiem („Usunięty zostanie
   1 projekt", „Usunięta zostanie 1 zaplanowana godzina"), co dla generowanego
   ciągu jest pułapką gramatyczną. „To usunie …" bierze biernik i jest poprawne
   dla każdej liczby i rodzaju — dodatkowo zgadza się z dotychczasowym brzmieniem
   w `TasksPage`. Godziny ułamkowe biorą dopełniacz liczby pojedynczej
   („2,5 zaplanowanej godziny"), czego samo `polishCount` nie obsługuje.
2. `polishCount` zdeduplikowany w 3 plikach zamiast 1 — kopie w `ProjectsPage`
   i `GlobalSearch` były bajt w bajt identyczne, zostawienie ich dałoby cztery.
3. Zaktualizowano `scripts/browser-check-onboarding.mjs` (poza `src/`): sprawdzał
   `page.waitForEvent('dialog')` dla ujawnienia planu na żywo, które właśnie
   zmigrowano, więc bez zmiany by nie przeszedł. Teraz steruje
   `.confirm-card[role="alertdialog"]`.

## Zmiany

- Nowe: `src/components/confirmDialog.ts`, `src/components/confirmDialog.test.ts`,
  `src/components/ConfirmProvider.tsx`, `src/utils/polishPlural.ts`.
- Zmienione: `src/main.tsx`, `src/App.tsx`, `src/styles.css`,
  `src/components/useModalShell.ts`, `TaskModal.tsx`, `EventModal.tsx`,
  `TicketModal.tsx`, `WeekView.tsx`, `PersistenceBanner.tsx`, `FilterPresets.tsx`,
  `ErrorBoundary.tsx` (tylko komentarz), `GlobalSearch.tsx`, `AdminPage.tsx`,
  `ProjectDetailPage.tsx`, `PersonProfilePage.tsx`, `PeoplePage.tsx`,
  `ClientsPage.tsx`, `TasksPage.tsx`, `TicketsPage.tsx`, `ProjectsPage.tsx`,
  `OnboardingRoot.tsx`, `scripts/browser-check-onboarding.mjs`,
  `openwiki/n2hub/ui-navigation-and-onboarding.md`, `handoffs/RUN-STATE.md`.
- Łącznie 24 pliki zmienione, 4 nowe; +645 / −182.
- Bez nowych zależności runtime. Tryb wygaszania pozostaje wyłączony.

## Weryfikacja

Uruchomione przez orkiestratora **niezależnie** od raportu workera, po jego
zakończeniu:

- `npm test` → **72 pliki testowe, 1684 testy — wszystkie zielone**, brak
  wcześniej istniejących błędów.
- `npm run build` → `tsc --noEmit` czysty, `✓ 3185 modules transformed`,
  `✓ built in 3.84s`. Ostrzeżenie o chunku > 500 kB jest wcześniejsze i
  niezwiązane z tą zmianą.
- `grep -rn "window\.confirm" src/ | grep -v "\.test\."` → 6 trafień, z czego
  **1 realne wywołanie** (`ErrorBoundary.tsx:68`, uzasadnione wyżej); pozostałe 5
  to wystąpienia w komentarzach.

Nowe testy — `src/components/confirmDialog.test.ts`, 17 przypadków, w stylu
`modalShell.test.ts` (harness to vitest w `environment: 'node'`, zbiera wyłącznie
`src/**/*.test.ts`, bez jsdom, więc logika musiała trafić do modułu czystego):

- **budowniczy treści skutków** — liczba pojedyncza / 2–4 / mnoga / zero,
  odmiana polska, godziny ułamkowe (dopełniacz + przecinek dziesiętny), łączenie
  wielu liczników, pomijanie `NaN` / wartości ujemnych / `Infinity`, ścieżka
  „brak skutków";
- **bramka `requireAck`**;
- **kolejkowanie dostawcy** — drugie żądanie czeka, dwa potwierdzenia pod rząd
  rozstrzygają się niezależnie i w kolejności, unikalne `id`, nieznane `id`
  zachowuje referencję stanu, podwójne rozstrzygnięcie odpala raz, rozstrzygnięcie
  wpisu nieaktywnego trafia we właściwą obietnicę, `drain` rozstrzyga wszystkie
  oczekujące na `false`.

## Ryzyka / rzeczy do sprawdzenia

- **Brak weryfikacji w przeglądarce** — playwright nie jest zainstalowany w tym
  worktree. Nakładkowa pułapka fokusa (`stacked`), powrót fokusa **do** wciąż
  otwartego modala rodzica i drabinka `z-index` są przemyślane i sprawdzone
  typami, ale nie zaobserwowane w przeglądarce. Edycja
  `scripts/browser-check-onboarding.mjs` jest z tego samego powodu
  **niezweryfikowana wykonaniem** — to główny kandydat do sprawdzenia przy
  weryfikacji wydania.
- `useConfirm()` rzuca poza dostawcą (ta sama polityka co `useStore`). Wszyscy
  obecni konsumenci są poniżej montażu w `main.tsx`, ale komponent dodany w
  przyszłości ponad nim wywali się zamiast zdegradować.
- `ConfirmProvider` czyta kolejkę z refa w trakcie renderu (z jawnym
  `forceRender`). Poprawne pod StrictMode, ale nieodporne na rozerwanie przy
  funkcjach współbieżnych, których aplikacja obecnie nie używa.
- Odłożone, świadomie nienaprawione: `.task-modal-scrim` / `.task-modal-viewport`
  nadal mają zaszyte `z-index: 1000/1001` zamiast `var(--n2-z-modal)`; dodano
  wyłącznie stokenizowaną warstwę samego potwierdzenia.
- Inwarianty chmurowe (inwariant 6) nietknięte — zmiana dotyczy mechanizmu
  pytania, nie reduktora.

Wiki: zaktualizowano `openwiki/n2hub/ui-navigation-and-onboarding.md` (nowa
wspólna granica potwierdzeń, dwie nowe opcje `useModalShell`, wyjątek
`ErrorBoundary`) — poprzedni opis „każdy modal pyta natywnym `window.confirm`"
przestał być prawdziwy.

## Podpis schedulera

- Run: `20260727-235946-n2hub-279-confirm-alertdialog`
- Prompt: `279-confirm-alertdialog.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `6d85b01ee23308e444db4952a707a7ab856c49bb`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `6d85b01ee23308e444db4952a707a7ab856c49bb`
- Gałąź review: `review-integration`
- Run: `20260727-235946-n2hub-279-confirm-alertdialog`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `scripts/browser-check-onboarding.mjs`
- `src/App.tsx`
- `src/components/ErrorBoundary.tsx`
- `src/components/EventModal.tsx`
- `src/components/FilterPresets.tsx`
- `src/components/GlobalSearch.tsx`
- `src/components/PersistenceBanner.tsx`
- `src/components/TaskModal.tsx`
- `src/components/TicketModal.tsx`
- `src/components/WeekView.tsx`
- `src/components/useModalShell.ts`
- `src/main.tsx`
- `src/onboarding/OnboardingRoot.tsx`
- `src/pages/AdminPage.tsx`
- `src/pages/ClientsPage.tsx`
- `src/pages/PeoplePage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/ProjectDetailPage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/pages/TicketsPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260727-235946-n2hub-279-confirm-alertdialog.md`
- `src/components/ConfirmProvider.tsx`
- `src/components/confirmDialog.test.ts`
- `src/components/confirmDialog.ts`
- `src/utils/polishPlural.ts`
