# Raport workflow: 20260728-112328-n2hub-302-kanban-drag-ghost

## Wykonane

Regresja była nadal obecna w bieżącym buildzie i została naprawiona. Stan przed
zmianą: po przepisaniu przeciągania Kanbanu z HTML5 DnD na Pointer Events (run
282) przeglądarka przestała rysować natywny drag image, a jedyną kompensacją
było `.kanban-card.dragging { opacity: 0.55 }` — karta zostawała wyblakła
w miejscu, w powietrzu nie leciało nic, a jedynym sygnałem gestu była linia
`.kanban-drop-indicator`. Dokładnie to zgłosił owner.

Obraz przeciągania rysujemy teraz sami, trzema złożonymi elementami:

1. **Klon karty pod wskaźnikiem.** Renderowany przez istniejący prymityw
   `OverlayLayer` (portal, warstwa nad wszystkim, run 278) jako
   `.kanban-card.kanban-drag-ghost`. Uniesiony wizualnie: nieprzezroczyste tło
   `--n2-panel`, mocniejszy obrys `--n2-border-strong`, cień
   `--n2-shadow-violet`, przechył 2°. Klon trzyma **punkt chwytu** — miejsce,
   w którym użytkownik złapał kartę, zostaje pod palcem/kursorem (bez
   centrowania na wskaźniku). Szerokość bierze się ze zmierzonego prostokąta
   karty źródłowej, więc wymiary i typografia zostają 1:1 (wykluczenie ownera
   z paczki 296 zachowane — świadomie **bez** `scale`).
2. **Karta źródłowa jako puste gniazdo.** `.kanban-card.dragging` to teraz
   `opacity: .4` + przezroczyste tło + przerywany obrys + brak cienia. Zostaje
   na swoim miejscu w kolumnie (zero reflow), ale czyta się jako ślad po wyjętej
   karcie, a nie jako karta wciąż obecna.
3. **Wskaźnik upuszczenia bez zmian funkcjonalnych.** `.kanban-drop-indicator`
   działa jak dotąd — klon go uzupełnia, nie zastępuje.

Geometria wyszła do czystego modułu `src/pages/kanbanDragGhost.ts` (bez Reacta
i bez DOM-u, wzorzec `kanbanBoard.ts` / `kanbanMove.ts`): `ghostGrab`,
`ghostPosition`, `ghostTransform`, `exceedsClickSlop`.

Decyzje warte odnotowania:

- **Pozycja klona jest pisana imperatywnie na węzeł w TEJ SAMEJ klatce rAF, co
  `setDragOver`** — bez drugiego rAF-a i bez animowania `left/top`. Stan Reactowy
  trzyma wyłącznie *istnienie* klona (zmienia się raz na gest); trzymanie w nim
  pozycji przerysowywałoby co klatkę wszystkie karty tablicy, czyli dokładnie ten
  koszt, którego run 292 pozbył się wyrzucając projekcję `layout`.
- **Mysz czeka na próg `CLICK_SLOP_PX`, dotyk nie.** Na dotyku przytrzymanie
  w bramce `useTouchDragGate` jest już deklaracją przeciągania, więc klon wchodzi
  natychmiast po bramce, w spoczynkowej pozycji karty, jeszcze przed pierwszym
  `pointermove`. Na myszy bez progu klon mrugałby przy każdym kliknięciu
  otwierającym zadanie. Klasa `dragging` idzie po stanie klona, a nie po `drag`,
  żeby gniazdo pojawiało się dokładnie wtedy, gdy w powietrzu jest karta.
- **Treść karty wyszła do wspólnego `cardContent(t)`**, używanego i przez kartę
  w kolumnie, i przez klon — żeby klon nie mógł się rozjechać z oryginałem
  wymiarami ani typografią. Klaster `.kanban-card-actions` został **poza** nią:
  niesie `id` uchwytu przenoszenia, którego klon nie może duplikować.
- Klon jest czysto dekoracyjny: `aria-hidden="true"`, `pointer-events: none`
  (nośne — leci dokładnie pod wskaźnikiem, więc inaczej przechwytywałby zdarzenia
  i psuł `targetAt()`), bez klastra akcji i bez żadnego `id`.

Zero nowych zależności. Inwariant 6 nietknięty — jedyną akcją przy upuszczeniu
pozostaje `SET_TASK_STATUS`, żadnego nowego reduktora ani zapisanej kolejności
w kolumnie. Bramka 350 ms, tryb przenoszenia z klawiatury, ogłoszenia `aria-live`
i menu „Przenieś do statusu →" bez zmian.

### Porównanie z zachowaniem sprzed runu 282

Odtworzone: obraz karty pod kursorem od chwili, w której gest jest
przeciąganiem; zachowany punkt chwytu (HTML5 też trzymał offset); nienaruszone
wymiary karty.

Świadomie inaczej:

- klon jest **wyraźnie bardziej czytelny** niż natywny drag image (pełna
  nieprzezroczystość, cień, przechył) — natywny był półprzezroczystym bitmapem
  bez uniesienia, a owner zgłaszał właśnie brak czytelności;
- karta źródłowa czyta się jako puste gniazdo — HTML5 zostawiał ją nietkniętą,
  przez co ginęła informacja „skąd niesiemy";
- klon działa **także na dotyku**, gdzie natywny nie istniał w ogóle;
- mysz ma próg ruchu, którego natywny start nie miał (patrz wyżej).

## Zmiany

- `src/pages/kanbanDragGhost.ts` (nowy) — czysta geometria klona.
- `src/pages/kanbanDragGhost.test.ts` (nowy) — 14 testów jednostkowych.
- `src/pages/KanbanPage.tsx` — klon w `OverlayLayer`, pomiar chwytu w
  `startDrag`, pozycja w istniejącej klatce rAF, sprzątanie w `endDrag`,
  wspólne `cardContent`, klasa gniazda po stanie klona (+141 / −33).
- `src/styles.css` — `.kanban-card.dragging` jako puste gniazdo,
  nowe `.kanban-drag-ghost` (+33 / −2).
- `handoffs/RUN-STATE.md` — dopisek o wyniku etapu.

## Weryfikacja

Uruchomione i zweryfikowane **niezależnie przez orkiestratora**, nie tylko
zaraportowane przez workera:

- `npm test` → **102/102 plików, 2137/2137 testów zielonych**. Zero istniejących
  testów zmienionych lub osłabionych; `kanbanMove.test.ts` i `kanbanBoard.test.ts`
  bez zmian.
- `npm run build` → **zielony** (`✓ built in 5.32s`), bez błędów TypeScriptu.
- `npx tsc --noEmit` → bez błędów.
- Przegląd diffa pod kątem twardych ograniczeń: brak nowych zależności
  (`package.json` nietknięty), `pointer-events: none` na klonie, `aria-hidden`,
  brak duplikatu `id`, brak zmian wymiarów/typografii karty, brak
  `will-change` / `translateZ(0)` / filtrów / bluru dokładanych „dla wydajności".
- Parytet warstw sprawdzony w kodzie: `.kanban-drag-ghost` używa tych samych
  reguł co istniejący duch przeciągania `.week-bin-ghost` (`src/styles.css:2653`)
  — `position: fixed`, `z-index: 1000`, `pointer-events: none`, `transition: none`,
  ten sam token cienia. Wszystkie użyte zmienne CSS istnieją.

Jedna poprawka wymuszona w przeglądzie: pierwsza wersja modułu eksportowała
`ghostVisible`, funkcję pokrytą testami, ale **nigdy nie wołaną w produkcji** —
testy sprawdzały równoległą kopię reguły zamiast działającego kodu. Martwy
eksport został usunięty, a jego wiedza przeniesiona do dokumentacji
`exceedsClickSlop`, czyli funkcji faktycznie wołanej w `onDragMove`. Stąd 2137,
a nie 2138 testów. `grep -rn "ghostVisible" src/` → brak trafień.

## Ryzyka / rzeczy do sprawdzenia

- **Brak weryfikacji w przeglądarce.** Playwright nie jest zainstalowany w tym
  worktree ani globalnie, więc efekt wizualny (czytelność klona pod
  palcem/kursorem, kontrast gniazda `opacity .4` + dashed) **nie został
  sprawdzony na urządzeniu**. Nie twierdzimy inaczej — to jedyne realne ryzyko
  tej zmiany i naturalny punkt do potwierdzenia przez ownera na urządzeniu,
  które zgłosiło problem. Logika geometryczna jest pokryta testami
  jednostkowymi, ale one nie zastępują oceny wizualnej.
- **Inwariant 7 (cykl życia wskaźnika)** — klon wisi na tym samym cyklu co
  reszta gestu: `endDrag()`, jedyna ścieżka wyjścia, zeruje `ghostCardRef`,
  `grabRef` i `setGhost(null)`, więc upuszczenie, `pointercancel`, Escape, blur
  okna, `visibilitychange` i odmontowanie w trakcie gestu sprzątają klon.
  Callback rAF wychodzi wcześnie przy `dragRef.current === null`.
  `cancelRaf`/`releaseCapture` nietknięte, nasłuchy okna nadal wstają raz na
  gest. Nie dołożono ani jednego rAF-a ani nasłuchu.
- **Przechył 2° obraca klon wokół środka**, więc punkt chwytu dryfuje o kilka
  pikseli względem geometrii z modułu. To celowa dekoracja — geometria
  upuszczenia (`targetAt`) czyta punkt wskaźnika, nie klona, więc cel kolumny
  jest niezależny od przechyłu.
- **Drobna zmiana zachowania**: mysz przed przekroczeniem progu ruchu nie
  przygasza już karty źródłowej (klasa `dragging` idzie po stanie klona).
  Świadome, opisane komentarzem w kodzie.
- **Poza zakresem, nieruszone**: przeciąganie Kanbanu nadal nie ma trwałego
  browser checka w `scripts/` — luka istnieje od runu 282 i nie została tu
  zamknięta.

## Wiki

`wiki unchanged`. `openwiki/n2hub/frontend-performance-and-primitives.md` opisuje
granicę prymitywów nakładek i reguły renderowania — żadna się nie zmieniła: klon
używa istniejącego `OverlayLayer` bez zmiany jego API, animuje wyłącznie
`transform`, nie dokłada `will-change` ani filtrów, nie zmienia trasy testowej
(skupione testy jednostkowe → `npm test` → `npm run build`). Nowa granica jest
lokalna dla Kanbanu i udokumentowana w nagłówku `kanbanDragGhost.ts` oraz
`KanbanPage.tsx`.

## Podpis schedulera

- Run: `20260728-112328-n2hub-302-kanban-drag-ghost`
- Prompt: `302-kanban-drag-ghost.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `4eb411fe8089689bcf5ef7a4246d91bc2a207288`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `4eb411fe8089689bcf5ef7a4246d91bc2a207288`
- Gałąź review: `review-integration`
- Run: `20260728-112328-n2hub-302-kanban-drag-ghost`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/pages/KanbanPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260728-112328-n2hub-302-kanban-drag-ghost.md`
- `src/pages/kanbanDragGhost.test.ts`
- `src/pages/kanbanDragGhost.ts`
