# Raport workflow: 20260727-200109-n2hub-271-calendar-touch-drag-guard

## Wykonane

**Analiza wstępna: usterka NADAL istniała w bieżącym buildzie**, więc zadanie
zostało wykonane, a nie pominięte. Potwierdzenie na kodzie z worktree:
`touch-action: none` w czterech miejscach `src/styles.css` (`.week-block`
~1778, `.week-bin-block` ~2113, `.timeline-bar` ~3283, `.timeline-milestone`
~3332), a wszystkie cztery wejścia do przeciągania startowały drag natychmiast
na `pointerdown`, bez progu. Na telefonie każda próba przewinięcia kalendarza
palcem po bloku przesuwała pracę co 15 minut — cicha utrata danych w planie
zespołu.

Rozwiązanie: **bramka „przytrzymaj, żeby przeciągnąć”** przed istniejącą
warstwą dragu. Warstwa dragu NIE była refaktoryzowana — zmienione jest wyłącznie
jej wejście.

1. **Nowy czysty automat stanu** `src/utils/touchDrag.ts` (bez Reacta, na wzór
   `liveSyncGate`): fazy `idle → pending → engaged`, `TOUCH_HOLD_MS = 350`,
   `TOUCH_HOLD_SLOP_PX = 10`, `needsTouchHold` (dotyk/pióro — mysz nie),
   `exceedsHoldSlop`, `touchHoldReducer`. Zgodnie z dyscypliną invariantu 6
   zdarzenie bez skutku zwraca **tę samą referencję stanu**, nigdy świeżego
   obiektu. Nośna reguła: `holdElapsed` uzbraja przeciąganie WYŁĄCZNIE z fazy
   `pending`, więc timer, który wystrzelił po przerwaniu przytrzymania, nie może
   już nic ruszyć.
2. **Nowy hook** `src/utils/useTouchDragGate.ts` — jedna bramka dla wszystkich
   czterech wejść. `arm(pointerType, x, y, engage)` zwraca `false` dla myszy
   **zanim** dotknie jakiegokolwiek timera czy nasłuchu. Dla dotyku: pasywne
   nasłuchy okna (`pointermove`/`pointerup`/`pointercancel`) przez czas
   przytrzymania, więc realne przewijanie (dryf > 10 px albo `pointercancel`,
   gdy przeglądarka zabiera gest) po prostu przewija stronę. Po uzbrojeniu
   wchodzą dwie blokady na czas gestu: niepasywny `touchmove` z `preventDefault`
   (bo `touch-action` jest zatrzaśnięte w chwili `touchstart` i nie da się go
   zawęzić w locie — anulowanie `touchmove` działa, bo przytrzymanie wymagało
   bezruchu, więc przeglądarka jeszcze nie zaczęła panoramować) oraz blokada
   natywnego `contextmenu` w fazie przechwytywania. Pełne sprzątanie na
   przerwaniu, puszczeniu i odmontowaniu.
3. **Cztery wejścia obramkowane**: `WeekView` `TimedBlock.begin` i
   `BinCard.begin`, `TimelinePage` `Bar.begin` i `MilestoneMark`. Każde dzieli
   się teraz na handler (zbiera `init` — element/`pointerId`/współrzędne —
   **synchronicznie**, bo React zeruje `currentTarget` po dispatchu, a ścieżka
   dotykowa czyta to dopiero po 350 ms) i `startDrag(init)`. Wnętrze `startDrag`
   jest niezmienione: `setPointerCapture`/`captureRef`, kształt `DragState` /
   `BinDragState`, `growAllowanceHours`, kolejność `dragRef`/`setDrag`, cały
   blok `BinDragListeners` z `removeWindowListeners`, odzysk
   `pointerType === 'mouse' && buttons === 0`, `mouseUp`/`blur`/`keydown`/
   `visibilitychange`.
4. **CSS** — `touch-action: none` dla wskaźnika precyzyjnego zostaje bez zmian
   (mysz działa jak dotąd). Nowy blok `@media (pointer: coarse)`:
   `touch-action: pan-x pan-y` na czterech selektorach (obie osie, bo
   `.week-days-viewport` przewija się w pionie i w poziomie), `user-select: none`
   + `-webkit-touch-callout: none` (żeby przytrzymanie nie wywoływało dymka
   zaznaczania tekstu) oraz `.week-block-handle { display: none }` — uchwyty 6 px
   przy ~30 px wysokości bloku są palcem nietrafialne. `.bar-handle` osi czasu
   (poziomy, inna geometria) celowo zostaje.

Wymaganie „zwykłe dotknięcie otwiera zadanie, nie startuje dragu" wymusiło jedną
świadomą zmianę poza literą zadania: `moved.current = false` jest teraz
resetowane także w handlerze, przed bramką. Bez tego dotknięcie, które nigdy nie
uzbroiło dragu, niosłoby `moved.current === true` z poprzedniego zakończonego
przeciągnięcia (nic innego tego nie zeruje — `finish`/`finishDrag` nie), a
`onClick` po cichu połknąłby otwarcie zadania. Na myszy obie instrukcje są
sąsiednie i identyczne, więc ścieżka myszy nie zmienia zachowania.

Wiki: zaktualizowana `openwiki/n2hub/scheduling-and-calendar.md` — kontrakt
wejścia do przeciągania i ścieżka testowa są nowe, więc strona byłaby nieaktualna
(nowa granica modułowa, nowy wpis w „Non-negotiable behavior”, `touchDrag.test.ts`
w liście testów).

## Zmiany

- `src/utils/touchDrag.ts` — NOWY. Czysty automat bramki przytrzymania.
- `src/utils/useTouchDragGate.ts` — NOWY. Hook Reactowy: timer, nasłuchy okna,
  blokady przewijania i natywnego menu, sprzątanie.
- `src/utils/touchDrag.test.ts` — NOWY. 20 testów jednostkowych automatu.
- `src/components/WeekView.tsx` — `TimedBlock.begin` i `BinCard.begin`
  rozdzielone na `init` + `startDrag`, obramkowane przez `gate.arm`.
- `src/pages/TimelinePage.tsx` — to samo dla `Bar.begin` i `MilestoneMark`.
- `src/styles.css` — blok `@media (pointer: coarse)` z komentarzem po polsku.
- `openwiki/n2hub/scheduling-and-calendar.md` — nowa granica, nowa reguła
  zachowania, nowa ścieżka testowa.

## Weryfikacja

- `npm test` → **66 plików / 1528 testów, wszystko zielone** (3.11 s). Bez
  regresji; liczby zmierzone, nie założone.
- `npm run build` → **zielony**, `✓ 2657 modules transformed`, `✓ built in 1.89s`.
  Jedyne ostrzeżenie to istniejące wcześniej „chunks larger than 500 kB”.
- `npx tsc --noEmit` → `TypeScript: No errors found`.
- `npm run check:openwiki` → `Validated 6 wiki files.`
- Testy jednostkowe automatu pokrywają: mysz nigdy nie uzbraja bramki; dotyk
  uzbraja; dryf ponad próg przerywa; dryf poniżej progu zwraca TĘ SAMĄ
  referencję; `holdElapsed` uzbraja tylko z `pending`; spóźniony timer po
  przerwaniu nie uzbraja; `release` resetuje; granice `needsTouchHold`
  i `exceedsHoldSlop`.
- Gate (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- **Brak weryfikacji na realnym urządzeniu dotykowym.** Logika progu jest
  pokryta testami jednostkowo, ale zachowanie przeglądarki mobilnej
  (`touch-action` zatrzaskiwane na `touchstart`, anulowalność `touchmove`,
  moment `pointercancel`) da się potwierdzić tylko na telefonie. Jeśli Android
  Chrome zabierze gest i wyśle `pointercancel` przed uzbrojeniem, przytrzymanie
  po prostu nic nie zrobi — bezpieczna porażka, nie utrata danych.
- **`scripts/browser-check-bin-drag.mjs` nie dało się uruchomić** w tym
  worktree: `Cannot find package 'playwright'` — playwright nie jest w
  `package.json` ani zainstalowany, a dodawanie zależności jest zabronione.
  Ścieżka myszy dla dragu z zasobnika jest więc pokryta tylko typami i testami
  jednostkowymi; potwierdzenie należy do macierzy przeglądarkowej wydania.
- **Na dotyku nie ma zmiany czasu trwania bloku** — uchwyty są ukryte, zostaje
  samo przeniesienie. Zgodnie z zadaniem (resize na dotyku poza zakresem).
- **Na dotyku menu kontekstowe bloku nie jest osiągalne przytrzymaniem** — ten
  gest należy teraz do przeciągania, a po uzbrojeniu bramka blokuje `contextmenu`
  (inaczej natywne menu Androida ~500 ms otwierałoby się nad żywym dragiem).
  Krótkie dotknięcie zachowuje dzisiejsze zachowanie. Menu kontekstowe pozostaje
  w pełni dostępne na myszy.
- **`pen` jest bramkowane jak dotyk** (zgodnie ze specyfikacją „coarse pointer").
  Użytkownik rysika na Surface potrzebuje teraz 350 ms przytrzymania — celowe,
  ale to widoczna zmiana zachowania.
- **Nasłuchy `pointerup`/`pointercancel` bramki nie są filtrowane po
  `pointerId`**: przy geście dwoma palcami puszczenie drugiego palca zdejmuje
  blokady pierwszego wcześniej. Decyzja świadoma — niefiltrowany wariant myli się
  w stronę ZWALNIANIA blokad (najgorszy skutek: przeciągnięcie się nie uzbroi,
  użytkownik powtarza gest), a filtrowany myliłby się w stronę ICH ZATRZYMANIA:
  niedostarczony `pointerup` zostawiłby na `document` niepasywny bloker
  `touchmove` i bloker `contextmenu`, czyli całą aplikację bez przewijania aż do
  odmontowania. Przy invariancie 7 to znacznie gorsza regresja. Dodatkowo dwa
  palce na bloku kalendarza to intencja przewijania/pinch, a nie przeciągania.
- Ścieżka myszy: bez zmian semantyki przechwytywania wskaźnika, pojedynczego rAF
  w obsłudze ruchu i ścieżek anulowania (Escape/`pointercancel`/`blur`/
  `visibilitychange`). Bramka na myszy nie rejestruje żadnego timera ani nasłuchu.

## Podpis schedulera

- Run: `20260727-200109-n2hub-271-calendar-touch-drag-guard`
- Prompt: `271-calendar-touch-drag-guard.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `c6cf45068c991362843a8b10600ae06c5c70de40`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `c6cf45068c991362843a8b10600ae06c5c70de40`
- Gałąź review: `review-integration`
- Run: `20260727-200109-n2hub-271-calendar-touch-drag-guard`

### Pliki zgłoszone do review

- `openwiki/n2hub/scheduling-and-calendar.md`
- `src/components/WeekView.tsx`
- `src/pages/TimelinePage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260727-200109-n2hub-271-calendar-touch-drag-guard.md`
- `src/utils/touchDrag.test.ts`
- `src/utils/touchDrag.ts`
- `src/utils/useTouchDragGate.ts`
