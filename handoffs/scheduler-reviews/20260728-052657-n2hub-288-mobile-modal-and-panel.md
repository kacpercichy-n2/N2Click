# Raport workflow: 20260728-052657-n2hub-288-mobile-modal-and-panel

## Wykonane

Najpierw analiza, czy każdy z czterech punktów faktycznie został jeszcze w
buildzie. **Wszystkie cztery pozostawały niezrobione** i wszystkie cztery
zostały zaimplementowane:

| Punkt | Stan przed | Dowód |
| --- | --- | --- |
| MO-03/04 lista dni | brak | `allocationGridView.ts` miał tylko grupowanie i migawkę kolumny |
| MO-22 klawiatura | brak | zero wystąpień `visualViewport` w `src/` |
| MO-10 karta zadania | brak | żadnej reguły `.task-card` w bloku `@media (max-width: 760px)` |
| MO-18 kolejność Panelu | brak | `DashboardPage.tsx` bez gałęzi mobilnej, `dashboardPanels.ts` bez modelu kolejności |

Praca poszła trasą **architekt → 4 pakiety deweloperskie → przegląd**. Pakiety
leżą w `handoffs/packages/`.

**1. MO-03/MO-04 — siatka godzin jako lista dni (<760 px).**
Nowy czysty model `src/components/allocationDayListView.ts` (`allocationDayRows`,
`allocationPersonTotals`, `stepAllocationHours`, `parseAllocationInput`,
`formatAllocationInput`) i bliźniak prezentacyjny
`src/components/AllocationDayList.tsx`: jeden wiersz na dzień z sumą po
wszystkich osobach, rozwijany panel ze stepperem −/+ o krok 0,25 h,
`inputMode="decimal"`, przełącznik osoby tylko przy ≥ 2 przypisanych, zero
przewijania poziomego. Wybór formy to jeden warunek w `TaskModal.tsx`
(`useMediaQuery(MOBILE_NAV_QUERY)`). **`AllocationGrid.tsx` nie została ruszona
ani o bajt** — lista zapisuje wyłącznie przez te same `onChange`/`onChangeStart`
do tych samych map `allocations`/`startTimes`, więc druga ścieżka mutacji nie
powstała (niezmiennik 1), a krok 0,25 h / 15 min idzie przez `snapHours`
z `utils/time` (niezmiennik 2).

**2. MO-22 — klawiatura ekranowa.**
Czysta arytmetyka w `src/components/keyboardInset.ts`: `resolveKeyboardInset`
z progiem `KEYBOARD_INSET_MIN_PX = 80` (odsiewa drganie paska adresu od
prawdziwej klawiatury) i `shouldScrollFieldIntoView`. Podpięcie w WSPÓLNYM
`useModalShell.ts` — jedno miejsce obsługuje TaskModal, EventModal i
TicketModal. Nasłuch `visualViewport` (`resize`/`scroll`) plus `focusin` karty;
wysokość klawiatury ląduje w zmiennej `--n2-kb-inset` konsumowanej przez jedną
linię CSS: `max-height: calc(94dvh - var(--n2-kb-inset, 0px))`. Pole z fokusem
dostaje `scrollIntoView({ block: 'nearest' })`. Efekt nie startuje bez
`visualViewport` ani powyżej breakpointu.

**3. MO-10 — karta zadania na telefonie.**
Czyste `src/pages/taskCardMobile.ts` (`visibleAssignees` z limitem 3 + „+N”,
`taskCardPath`) i osobna gałąź mobilna w `TasksPage.tsx`: rytm trzech rzędów —
tytuł 15 px przycięty do dwóch linii na pełnej szerokości → ścieżka projektu
12 px (zwykły tekst zamiast przepełniającego się mono/uppercase) → rząd
metadanych (kropka statusu, godziny, awatary). Pozostałe pigułki przeniesione
do arkusza szczegółów zbudowanego na istniejącym `useOverlay` (czwarty arkusz
na tej powłoce, nie nowy mechanizm). Wyzwalacz arkusza jest RODZEŃSTWEM
przycisku karty, nie zagnieżdżonym `<button>`.

**4. MO-18 — kolejność Panelu na telefonie.**
Model kolejności i pustki w czystym `dashboardPanels.ts` (`mobileDashboardOrder`,
`workloadSummaryLine`). Poniżej 760 px Panel renderuje stos `.dash-m-stack`:
Zadania na dziś → Alerty/Powiadomienia (tylko gdy niepuste) → jedna zwarta linia
obciążenia zamiast dwóch pierścieni → Zasobnik → tydzień jako siedem pigułek →
Zespół zwinięty (`aria-expanded`/`aria-controls`). Kafelek, którego cała treść
byłaby komunikatem pustego stanu, **nie istnieje w DOM-ie** — zrobione
renderowaniem warunkowym, nie CSS `order`, bo `order` zostawiłby puste kafelki
w drzewie. Linia obciążenia liczy się z tych samych selektorów co pierścienie,
niczego nowego nie zapisujemy (niezmiennik 1).

Wspólne: brak nowych zależności runtime, wszystkie napisy po polsku, tryb
wygaszania nietknięty, reduktor nietknięty (niezmiennik 6).

## Zmiany

Nowe: `src/components/allocationDayListView.ts` (+ test),
`src/components/AllocationDayList.tsx`, `src/components/keyboardInset.ts`
(+ test), `src/pages/taskCardMobile.ts` (+ test),
`handoffs/packages/PKG-20260728-*.md` (4 pakiety).

Zmienione: `src/components/TaskModal.tsx`, `src/components/useModalShell.ts`,
`src/pages/TasksPage.tsx`, `src/pages/DashboardPage.tsx`,
`src/pages/dashboardPanels.ts` (+ test), `src/styles.css`,
`openwiki/n2hub/ui-navigation-and-onboarding.md`, `handoffs/RUN-STATE.md`.

## Weryfikacja

- `npm test` → **88 plików, 1939 testów, 0 błędów**. Nowe testy jednostkowe:
  `allocationDayListView.test.ts` (20 przypadków — round-trip sum dziennych
  i per-osoba z modelem siatki, komórka spoza okresu pominięta, krańce
  steppera 0/24, snap 1,3 → 1,25, parsowanie `'1,75'`/`'1.3'`/`'25'`/`''`
  i odrzucenie `abc`/`-1`/`1e3`/`0x10`), `keyboardInset.test.ts` (12),
  `taskCardMobile.test.ts`, `dashboardPanels.test.ts` (rozszerzony o 13
  przypadków kolejności i linii obciążenia; dotychczasowe testy nietknięte).
- `npm run build` (`tsc --noEmit && vite build`) → **zielony**, strict czysty,
  jedyne ostrzeżenie to istniejące wcześniej `chunk > 500 kB`.
- `npm run check:openwiki` → 6 plików wiki zwalidowanych.
- Kontrola „desktop bit w bit”, zrobiona na diffie a nie na deklaracji:
  `src/styles.css` ma **dokładnie 2 usunięte linie** (`max-height: 94dvh`
  zamienione na `calc(...)` oraz `.cal-jump-sheet {` scalone w grupę trzech
  selektorów) przy 421 dodanych; `TaskModal.tsx` i `useModalShell.ts` są
  czysto addytywne (31/0 i 65/0); `TasksPage.tsx` ma 2 usunięcia i oba to
  linie `import`. `DashboardPage.tsx` (385/206) to jedyna prawdziwa
  restrukturyzacja — kafelki wyciągnięto do wspólnych funkcji renderujących,
  a gałąź desktopowa woła je z ORYGINALNYMI pełnymi stringami klas
  (`dash-card dash-area-notifications` itd.); porównałem ciało
  `renderNotificationsTile` z wersją z `HEAD` — identyczne poza
  parametryzacją `className` i jednym złączeniem linii `onClick`.

## Ryzyka / rzeczy do sprawdzenia

- **Największe ryzyko: identyczność DOM-u Panelu na desktopie.** Opiera się na
  argumencie „wspólne funkcje renderujące + te same stringi klas”, nie na
  teście. Zweryfikowałem to ręcznie na jednym z pięciu kafelków; pozostałe
  cztery warte spojrzenia recenzenta.
- `isOverloaded(booked, available, overbookedDates)` zostało wyciągnięte
  z `WorkloadDonut` i współdzielone z linią mobilną. Logicznie równoważne
  (`loadPercent === null && booked > 0` zawiera się w `booked > available`),
  ale to jedyna zmiana logiki na ścieżce desktopowej.
- Wcięcie klawiatury działa na WSPÓLNEJ powłoce, więc efekt uruchamia się też
  dla ConfirmProvider i ChangelogModal na telefonie. Jest bezczynny bez
  klawiatury (inset 0 → zmienna usuwana), a `--n2-kb-inset` konsumuje wyłącznie
  `.task-modal-card`.
- `scrollIntoView` przy `focusin` to jedyne miejsce, gdzie może wystąpić
  przewinięcie, którego wcześniej nie było. `block: 'nearest'` czyni je
  bezczynnym dla pól już widocznych; tylko mobile, nieweryfikowalne w CI.
- Odstępstwo wymuszone: model listy dni nazywa się `allocationDayListView.ts`,
  nie `allocationDayList.ts` jak w pakiecie — na tym systemie plików
  (case-insensitive) para `allocationDayList.ts` / `AllocationDayList.tsx`
  wywala TypeScript (TS1149). Nazwa odwzorowuje istniejącą parę
  `AllocationGrid.tsx` / `allocationGridView.ts`.
- Odstępstwo produktowe: na mobile przycisk „Szczegóły zadania” renderuje się
  także bez uprawnienia `tasks.manage` (usuwanie nadal za `canManageTasks`) —
  inaczej użytkownik tylko-do-odczytu nie miałby jak dotrzeć do arkusza.
  Desktop zachowuje oryginalną bramkę.
- Arkusz szczegółów to JEDNA instancja na stronę z `triggerRef` wskazującym
  przycisk wybranej karty; powrót fokusu zależy od przekazywania `ref` przez
  `Tooltip` (`cloneElement`). Działa w kodzie, ale warte dotknięcia palcem.
- Wysokości mobilne (~96 px karta, ~98–101 px przy dwuliniowym tytule na
  390 px) policzone arytmetycznie, nie zmierzone w przeglądarce. Żaden bieg
  przeglądarkowy nie był w zakresie tych pakietów — realne sprawdzenie na
  390 px oraz zachowanie progu 80 px wobec paska URL iOS/Android należą do
  weryfikacji wydaniowej.

## Podpis schedulera

- Run: `20260728-052657-n2hub-288-mobile-modal-and-panel`
- Prompt: `288-mobile-modal-and-panel.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `a5136817a1cf2ba344397f696e25f67924e6d6db`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `a5136817a1cf2ba344397f696e25f67924e6d6db`
- Gałąź review: `review-integration`
- Run: `20260728-052657-n2hub-288-mobile-modal-and-panel`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/TaskModal.tsx`
- `src/components/useModalShell.ts`
- `src/pages/DashboardPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/pages/dashboardPanels.test.ts`
- `src/pages/dashboardPanels.ts`
- `src/styles.css`
- `handoffs/packages/PKG-20260728-alloc-day-list.md`
- `handoffs/packages/PKG-20260728-keyboard-inset.md`
- `handoffs/packages/PKG-20260728-panel-mobile-order.md`
- `handoffs/packages/PKG-20260728-task-card-mobile.md`
- `handoffs/scheduler-reviews/20260728-052657-n2hub-288-mobile-modal-and-panel.md`
- `src/components/AllocationDayList.tsx`
- `src/components/allocationDayListView.test.ts`
- `src/components/allocationDayListView.ts`
- `src/components/keyboardInset.test.ts`
- `src/components/keyboardInset.ts`
- `src/pages/taskCardMobile.test.ts`
- `src/pages/taskCardMobile.ts`
