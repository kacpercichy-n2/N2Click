# Raport workflow: 20260727-221857-n2hub-277-modalframe-focus-cycle

## Analiza wstępna: czy problem nadal istnieje?

Prompt kazał najpierw sprawdzić, czy zadanie jest jeszcze aktualne. **Częściowo
nie — i to zmieniło kształt pracy**, więc opisuję to wprost.

Prompt zakłada istnienie `src/components/ModalFrame.tsx` (~83–100), który
portaluje kartę, ustawia `inert` na `#root`, trzyma stos modali z jednym nasłuchem
Escape, licznik blokady scrolla i migawkę tła przez html2canvas. **W tym buildzie
nie ma ani `ModalFrame`, ani portalu dla tych modali, ani stosu modali, ani
html2canvas, ani licznika blokady scrolla.** Punkt 7 promptu („PRESERVE
untouched") odnosi się więc do maszynerii, która tu nie istnieje — audyty
D01/M01/P0.2 opisywały inny stan kodu.

Natomiast **wszystkie wymienione defekty są realne i obecne** — tyle że
zduplikowane cztery razy zamiast scentralizowane. Ten sam wzorzec
(`.task-modal-scrim` + `.task-modal-viewport` + `.task-modal-card`) był wklejony
w `TaskModal.tsx`, `TicketModal.tsx`, `EventModal.tsx` i `ChangelogModal.tsx`;
każdy z nich miał własny nasłuch Escape, własne `document.body.style.overflow`,
`aria-label` zamiast `aria-labelledby` i `onClick={requestClose}` na viewporcie.
Brakowało wejścia fokusa, pułapki Tab, powrotu fokusa i kompensacji paska
przewijania. `IconButton` nie miał `forwardRef`.

Decyzja: **naprawiamy defekty**, nie dobudowujemy nieistniejącej maszynerii
(portal / stos / migawka). Zamiast dużego przepisania czterech modali na nowy
komponent ramy powstała wspólna, chirurgiczna warstwa zachowań.

## Wykonane

### Nowe pliki

- `src/components/modalShell.ts` — **czysta, bez-DOM-owa** logika powłoki nad
  deskryptorami `FocusCandidate`: `isFocusableCandidate`, `isTabbableCandidate`,
  `tabbableIndexes`, `resolveInitialFocusIndex`, `resolveTrapAction`,
  `shouldHandleTrapKey`, `shouldCloseOnBackdrop`, `scrollbarCompensation`,
  `createScrollLockCounter`.
- `src/components/useModalShell.ts` — cienki adapter DOM (`querySelectorAll`,
  `.focus()`, jeden nasłuch `keydown`, styl `body`). Zwraca
  `{ cardRef, cardProps, viewportProps }`.
- `src/components/modalShell.test.ts` — 23 testy jednostkowe.

### Realizacja punktów 1–7 promptu

1. **Wejście fokusa** — `resolveInitialFocusIndex`: pierwszy fokusowalny
   `[data-autofocus]` → pierwszy tabbable → `null`, czyli fokus na samą kartę
   (`tabIndex={-1}` idzie z `cardProps`). Hook pomija wejście, jeśli fokus już
   jest w karcie, więc nie ma walki dwóch `.focus()`. Ręczny
   `titleRef.current?.focus()` w `TaskModal` zastąpiony przez `data-autofocus`.
   `disabled` cel autofokusa (read-only `EventModal`) poprawnie spada na pierwszy
   tabbable.
2. **Pułapka Tab** — jeden nasłuch `keydown`;
   `resolveTrapAction(currentIndex, count, shift)` zwraca `{type:'card'}` (zero
   tabbable → fokus zostaje na karcie, Tab pochłonięty), `{type:'focus',index}`
   dla zawinięcia oraz dla przypadku „fokus uciekł z dialogu" (`currentIndex === -1`
   lub poza zakresem → pierwszy/ostatni), `{type:'none'}` w środku listy, żeby
   przeglądarka zachowała natywną kolejność. `shouldHandleTrapKey` ignoruje
   Ctrl/Alt/Meta.
3. **Powrót fokusa** — pierwszy efekt hooka zapamiętuje `document.activeElement`
   przed wejściem fokusa i przywraca go przy odmontowaniu, ze strażnikiem
   `instanceof HTMLElement && isConnected`. Pokrywa **każdą** drogę zamknięcia
   (Escape, tło, przyciski, nawigacja) bez przeprowadzania refów przez modale.
   `IconButton` dostał `forwardRef<HTMLButtonElement, Props>` zgodnie z promptem
   (zmiana czysto addytywna, API bez zmian), choć przy tym mechanizmie nie jest do
   powrotu fokusa konieczny.
4. **Semantyka tytułu** — `aria-labelledby` na `id` z `useId()`, wskazujące
   widoczny `<h1 className="task-modal-title">`. `aria-describedby` jest
   obsługiwane przez hook, ale **nieużywane**: żaden z czterech modali nie ma
   stabilnego widocznego opisu, a treści nie wymyślałem.
5. **Tło zamyka dopiero na parę `pointerdown` + `click`** —
   `viewportProps.onPointerDown` uzbraja tylko gdy `target === currentTarget`;
   każdy `pointerdown` w potomku karty rozbraja (bąbelkuje do viewportu);
   `onClick` zamyka wyłącznie przez `shouldCloseOnBackdrop(armed, klikNaTle)`
   i zawsze rozbraja. `onClick={(e) => e.stopPropagation()}` z karty usunięte —
   zastąpione sprawdzeniem targetu. Zaznaczanie tekstu zaczęte w karcie
   i puszczone na tle **nie zamyka już modala i nie kasuje edycji**.
6. **Kompensacja paska przewijania** — jeden modułowy `createScrollLockCounter()`;
   `overflow` i `paddingRight` zapamiętywane raz przy przejściu 0→1 i przywracane
   raz przy 1→0; padding =
   `scrollbarCompensation(window.innerWidth, documentElement.clientWidth)`.
   Licznik naprawia przy okazji utajony błąd: dotąd każdy modal zapisywał
   i przywracał `overflow` niezależnie, co przy nałożeniu dwóch modali gubiło
   oryginalną wartość.
7. **Zachowane bez zmian** — Escape deleguje do własnego `requestClose` każdego
   modala, więc pytanie o niezapisane zmiany (`window.confirm`),
   `setNavGuard`/`clearNavGuard` i `bypassNavGuardOnce` działają jak dotąd.
   Znaczniki i przejścia `motion`/`AnimatePresence`, wszystkie nazwy klas CSS
   i ciało `TaskModal` nietknięte. Tryb wygaszania pozostaje wyłączony. Zero
   nowych zależności — cała maszyneria fokusa napisana ręcznie.

## Zmiany

Nowe:

- `src/components/modalShell.ts`
- `src/components/useModalShell.ts`
- `src/components/modalShell.test.ts`

Zmienione:

- `src/components/TaskModal.tsx`, `src/components/TicketModal.tsx`,
  `src/components/EventModal.tsx`, `src/components/ChangelogModal.tsx` — wpięcie
  powłoki, usunięcie zduplikowanych efektów Escape/scroll-lock, `data-autofocus`
  na polu startowym, `id` na widocznym `<h1>`.
- `src/components/IconButton.tsx` — `forwardRef`.
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — jeden punkt o nowej granicy.
- `handoffs/RUN-STATE.md` — wpis runu.

## Weryfikacja

| Check | Wynik |
| --- | --- |
| `npm test` | **zielony** — Test Files 70 passed (70), Tests **1630 passed (1630)**, 5,91 s |
| `npm run build` (`tsc --noEmit && vite build`) | **zielony** — 3180 modułów, build 3,79 s; jedyne ostrzeżenie to preegzystujące „chunk > 500 kB" |
| `npm run check:openwiki` | **zielony** — `Validated 6 wiki files.` |

Nowe `src/components/modalShell.test.ts` (23 testy) pokrywa: pustą listę
kandydatów, zawijanie przy jednym kandydacie w obie strony, wykluczanie
`disabled` / `tabindex="-1"` / ukrytych, przypadek „fokus poza dialogiem",
niezbalansowany `release` licznika scrolla, wyliczenie kompensacji paska oraz
kluczowy przypadek tła: `pointerdown` w karcie + `click` na tle → **nie zamyka**.

Środowisko testowe to `environment: 'node'` z `include: ['src/**/*.test.ts']` —
bez DOM. Dlatego logika jest celowo wydzielona jako funkcje czyste nad prostymi
deskryptorami, a nie nad węzłami DOM; `jsdom` ani `@testing-library` **nie** były
dodawane (zakaz nowych zależności).

- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- **Checki przeglądarkowe nie zostały uruchomione** — `playwright` nie jest
  zależnością tego repo/worktree, a instalacja łamałaby zakaz nowych zależności.
  `browser-check-savetask-multiblock.mjs`, `browser-check-bin-drag.mjs`,
  `browser-check-ui-keyboard.mjs` i `browser-check-date-hardening.mjs` sięgają po
  `.task-modal-card[role="dialog"]` i zamykają przez Escape albo przycisk
  „Zamknij" — oba selektory i obie ścieżki są zachowane, ale **weryfikacja
  wydaniowa powinna je przepuścić**, bo ruszony został wzorzec modali.
- **Kompensacja paska wymaga sprawdzenia na Windows.** Na macOS (nakładkowe paski)
  `window.innerWidth - documentElement.clientWidth` daje 0, więc efekt jest tu
  nieobserwowalny; test jednostkowy pokrywa samo wyliczenie, nie render.
- **Przeciągnięcie w drugą stronę**: `pointerdown` na tle, puszczenie w karcie
  nadal zamyka (`click` odpala się na viewporcie jako wspólnym przodku). Zgodne
  z literą punktu 5 i nieszkodliwe dla niezapisanych edycji; pełne uszczelnienie
  wymagałoby sprawdzenia targetu `pointerup`.
- **Filtr widoczności nie używa `getComputedStyle`** (inaczej niż pułapka szuflady
  w `App.tsx`) — mierzy `getClientRects().length` i `aria-hidden`. Powód: siatka
  alokacji `TaskModal` potrafi mieć setki pól, a odczyt stylu wyliczonego per
  element przy każdym Tabie byłby odczuwalny. Kompromis: element
  `visibility: hidden` byłby wciąż uznany za tabbable — w tych czterech modalach
  taki przypadek nie występuje.
- **`App.tsx` (szuflada mobilna) nadal zapisuje i przywraca
  `document.body.style.overflow` poza nowym licznikiem.** Gdyby szuflada i modal
  kiedyś się nałożyły, przywracania mogą się przepleść. Poza zakresem tego runu;
  naturalny follow-up to przepięcie szuflady na ten sam licznik.
- **Poza zakresem świadomie**: `src/onboarding/OnboardingRoot.tsx` (własny portal
  i własna obsługa fokusa) oraz `src/components/GlobalSearch.tsx` (Escape
  z własnym `stopPropagation`, semantyka bliższa combobox). Oba to kandydaci na
  kolejne wpięcie wspólnej powłoki.
- **Zmiana nazwy dostępnej `ChangelogModal`** — z `aria-label="Dziennik zmian"` na
  widoczny nagłówek „Co nowego". Celowe (punkt 4 wymaga wiązania do widocznego
  nagłówka), ale jest to zmiana widoczna dla czytników ekranu.
- **Wiki**: `openwiki/n2hub/ui-navigation-and-onboarding.md` zaktualizowano
  o nową granicę (wspólna powłoka modala) — powstała realnie nowa granica
  architektoniczna, więc `wiki unchanged` byłoby nieprawdziwe. Ostateczna decyzja
  `wiki updated` / `wiki unchanged` należy do reviewera; zmiana jest do jego
  akceptacji lub cofnięcia.

## Podpis schedulera

- Run: `20260727-221857-n2hub-277-modalframe-focus-cycle`
- Prompt: `277-modalframe-focus-cycle.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `657f4cccb92078c765f4417849ad7b14d41a748e`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `657f4cccb92078c765f4417849ad7b14d41a748e`
- Gałąź review: `review-integration`
- Run: `20260727-221857-n2hub-277-modalframe-focus-cycle`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/ChangelogModal.tsx`
- `src/components/EventModal.tsx`
- `src/components/IconButton.tsx`
- `src/components/TaskModal.tsx`
- `src/components/TicketModal.tsx`
- `handoffs/scheduler-reviews/20260727-221857-n2hub-277-modalframe-focus-cycle.md`
- `src/components/modalShell.test.ts`
- `src/components/modalShell.ts`
- `src/components/useModalShell.ts`
