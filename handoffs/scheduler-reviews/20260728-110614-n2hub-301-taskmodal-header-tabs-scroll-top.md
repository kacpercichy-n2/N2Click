# Raport workflow: 20260728-110614-n2hub-301-taskmodal-header-tabs-scroll-top

## Wykonane

Feedback ownera do struktury karty zadania z runu 285. Wszystkie trzy punkty
były jeszcze obecne w bieżącym buildzie — potwierdzone pomiarami w przeglądarce
przed zmianą. Poprawki są czysto prezentacyjne plus jedno zerowanie pozycji
przewinięcia; kolejność sekcji z 285 i logika zapisu nietknięte. Obie
powierzchnie (modal `?task=` i pełna strona `/tasks/:id`) dzielą ten sam
`TaskEditor`, więc punkty 1 i 3 naprawiają się jednym arkuszem stylów, a punkt 2
wymagał osobnej naprawy per powierzchnia — bo przyczyny były różne.

**1. Nagłówek kontekstu przestał być przyklejony** (`src/styles.css`,
`.task-context-header`). Zdjęte `position: sticky; top: 0; z-index: 4`; karta
zostaje wizualnie bez zmian (tło, ramka, cień, odstępy), ale przewija się razem
z treścią. Wersja sticky zajmowała ~200 px nad panelem „Zadanie" i zasłaniała
pola pod spodem. Za stałą orientację odpowiadają teraz nagłówek karty modala
(tytuł + wskaźnik zapisu) i pasek zakładek. Zaktualizowany opis sekcji
`'context'` w `taskModalSections.ts` („Przyklejona głowa" → „Statyczna").

**2. Otwarcie karty zawsze na górze treści.** Znalezione dwie różne przyczyny
źródłowe:

- *Pełna strona* (`src/pages/TaskFullPage.tsx`) — to był GŁÓWNY objaw. React
  Router nie zeruje pozycji przewinięcia przy zmianie trasy, a aplikacja nie ma
  `ScrollRestoration`. Wejście z przewiniętej listy zadań albo z modala linkiem
  „Otwórz pełny widok ↗" przenosiło `window.scrollY` 1:1 na nową trasę
  (zmierzone: 854 px przed i po nawigacji), czyli karta otwierała się w środku
  albo na dole formularza. Dołożony `useLayoutEffect` zerujący `window.scrollTo`
  na id zadania — efekt układu, więc zerowanie leci przed malowaniem i nie widać
  skoku. Strona nie przekazuje `focusBlockId` do edytora, więc nie ma tu
  deep-linku i nie ma wyjątku od reguły.
- *Modal* (`src/components/TaskModal.tsx`) — `.task-modal-body` PRZEŻYWA zmianę
  `?task=` (remontuje się tylko `TaskEditor`, przez `key={taskParam}`), więc
  przejście na inne zadanie przy przewiniętym modalu wpadało w środek nowego
  formularza. Zmierzone: przed zmianą `scrollTop` 500 → 500 po podmianie
  parametru. Dołożony `ref` na `.task-modal-body` + `useLayoutEffect` zerujący
  `scrollTop`, bramkowany nową czystą funkcją `opensAtTop`.
- *Fokus startowy* (`src/components/useModalShell.ts`) — `focusInitialIn` woła
  teraz `.focus({ preventScroll: true })` (tak samo jak `focusFieldById`
  w `Field.tsx`). Świeżo otwarta karta stoi na górze i to fokus mógłby ją stamtąd
  ściągnąć, a nie odwrotnie; pole startowe (`data-autofocus` na `t-title`) i tak
  leży w pierwszej sekcji, więc nie ma czego dosuwać. Zmiana obejmuje wszystkie
  modale na wspólnej powłoce (Task/Event/Ticket/potwierdzenie) oraz arkusz
  filtrów — w każdym z nich pole startowe jest u góry, więc to poprawa, nie
  regresja.

Jawne deep-linki zostały nienaruszone: `?task=<id>&block=<id>` dalej otwiera
zakładkę „Planowanie", rozwija „Wykonane bloki" i przewija do podświetlanego
wiersza (`scrollIntoView`). Bramkuje to `opensAtTop` w
`src/components/taskModalSections.ts` — jedna czysta funkcja obok `initialTab`,
żeby decyzja „zakładka startowa" i „pozycja przewinięcia" nie mogły się
rozjechać.

**3. Pasek zakładek wycentrowany** (`src/styles.css`). Centrowanie zrobione
marginesami `auto` na skrajnych zakładkach, a NIE przez `justify-content: center`:
pasek jest scrollportem (`overflow-x: auto`), a wyśrodkowana treść w kontenerze
przewijanym ucieka pierwszym elementem poza lewą krawędź, gdy się nie mieści.
Przy marginesach `auto` wolna przestrzeń schodzi do zera i pierwsza zakładka
zostaje osiągalna. Zweryfikowane w obu stanach (patrz niżej).

## Zmiany

- `src/styles.css` — `.task-context-header` statyczny; centrowanie
  `.task-editor-tab:first-child` / `:last-child` marginesami `auto`.
- `src/components/taskModalSections.ts` — nowa czysta funkcja `opensAtTop`;
  poprawiony opis sekcji `'context'`.
- `src/components/taskModalSections.test.ts` — testy `opensAtTop` (w tym
  spójność z `initialTab`) oraz kontrakt „kontekst jest PIERWSZĄ sekcją w każdym
  trybie", czyli pole startowe zawsze leży na górze.
- `src/components/useModalShell.ts` — `focusInitialIn` z `preventScroll: true`.
- `src/components/TaskModal.tsx` — `ref` na `.task-modal-body` + zerowanie
  przewinięcia przy otwarciu/zmianie `?task=`, bramkowane `opensAtTop`.
- `src/pages/TaskFullPage.tsx` — zerowanie `window.scrollTo` przy wejściu na
  kartę zadania.

## Weryfikacja

- `npm test`: **zielone** — 101 plików, 2123 testy, 0 błędów (w tym nowe
  asercje w `taskModalSections.test.ts`).
- `npm run build` (`tsc --noEmit && vite build`): **zielony**.
- Ręczna weryfikacja w Chromium (Playwright, dev server, dane przykładowe,
  1280×800 oraz 360/280 px). Wszystkie liczby zmierzone `getBoundingClientRect`
  / `scrollTop`, przed i po zmianie:
  - Nagłówek kontekstu: `getComputedStyle().position === 'static'`; przy
    przewinięciu o 600 px jego `top` schodzi ze 142 px na −457 px, czyli jedzie
    z treścią (przed zmianą zostawał przyklejony).
  - Pełna strona: wejście z listy przewiniętej na 854 px → `window.scrollY === 0`
    po nawigacji (przed zmianą: 854).
  - Modal: otwarcie → `scrollTop === 0`, fokus na `#t-title`; podmiana `?task=`
    przy `scrollTop === 500` → `0` na TYM SAMYM węźle DOM (przed zmianą: 500).
  - Deep-link `?task=…&block=…`: zakładka „Planowanie", `scrollTop === 586`,
    podświetlony wiersz w polu widzenia — bez zmian względem stanu sprzed runu.
  - Zakładki: odstęp lewy === prawy (302/302 px w modalu, 274/274 px na stronie).
    Przy wymuszonym przepełnieniu (280 px) pasek się przewija, a pierwsza
    zakładka startuje 4 px od lewej krawędzi, czyli nie jest ucinana.
  - Kontrola regresji powłoki: `EventModal` otwiera się z fokusem na
    `#event-title`, pole w polu widzenia — `preventScroll` niczego nie zepsuło.
- Browser checki z `scripts/` nie były uruchamiane: żaden z nich nie pokrywa
  nagłówka/zakładek TaskModala ani pozycji przewinięcia przy otwarciu, a zmiana
  nie dotyka kalendarza, zasobnika, persystencji ani onboardingu.

## Ryzyka / rzeczy do sprawdzenia

- `preventScroll: true` w `focusInitialIn` jest zmianą WSPÓLNEJ powłoki, więc
  dotyka też EventModala, TicketModala, potwierdzenia i arkusza filtrów. W
  każdym z nich pole startowe leży u góry karty, więc nie ma czego dosuwać —
  sprawdzone ręcznie dla EventModala. Gdyby kiedyś powstał modal z
  `data-autofocus` PONIŻEJ zgięcia, jego pole startowe trzeba by dosunąć jawnie.
- Zerowanie `window.scrollTo` w `TaskFullPage` nadpisuje natywne przywracanie
  pozycji przy odświeżeniu `/tasks/:id` (F5 wraca na górę zamiast tam, gdzie
  było). To jest wprost wymagane przez punkt 2 („po otwarciu widok ma być
  przewinięty na samą górę"), ale warto wiedzieć, że dotyczy też przeładowania.
- Marginesy `auto` centrują względem CAŁEJ szerokości paska; gdyby w przyszłości
  doszła czwarta zakładka albo dłuższa etykieta, pasek najpierw przestanie być
  wyśrodkowany (przepełnienie), a dopiero potem zacznie się przewijać — to
  zachowanie zamierzone, alternatywa ucinałaby pierwszą zakładkę.
- `?comment=` z opisu zadania NIE ISTNIEJE w kodzie (jedyny deep-link do treści
  karty to `?block=`), więc `opensAtTop` bramkuje tylko blok. Gdy taki parametr
  powstanie, trzeba go dopisać do tej jednej funkcji.
- Wiki: **bez zmian**. `openwiki/n2hub/ui-navigation-and-onboarding.md` nigdy nie
  opisywała struktury zakładek ani przyklejonego nagłówka kontekstu z runu 285
  (jedyne wystąpienia „sticky" dotyczą paska akcji edytora, który zostaje
  przyklejony), więc żadna udokumentowana granica ani inwariant nie stały się
  nieaktualne.

## Podpis schedulera

- Run: `20260728-110614-n2hub-301-taskmodal-header-tabs-scroll-top`
- Prompt: `301-taskmodal-header-tabs-scroll-top.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `0bcd76e66a77bcb288ad6caadf3906223ea2df78`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `0bcd76e66a77bcb288ad6caadf3906223ea2df78`
- Gałąź review: `review-integration`
- Run: `20260728-110614-n2hub-301-taskmodal-header-tabs-scroll-top`

### Pliki zgłoszone do review

- `src/components/TaskModal.tsx`
- `src/components/taskModalSections.test.ts`
- `src/components/taskModalSections.ts`
- `src/components/useModalShell.ts`
- `src/pages/TaskFullPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260728-110614-n2hub-301-taskmodal-header-tabs-scroll-top.md`
