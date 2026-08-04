# Raport workflow: 20260803-210302-n2hub-321-kalendarz-typografia-i-segmenty

## Wykonane

Tier workflow `developer -> reviewer` (orkiestrator nie implementował). Wszystkie
trzy punkty feedbacku operatora nadal występowały w bieżącym buildzie i zostały
naprawione wyłącznie w `src/styles.css` (zero zmian w JSX, stanie, handlerach,
`aria-*`/`data-*`).

1. **Strzałki pagera (`button.nav-btn`).** Glify `‹`/`›` centrował dotąd
   domyślny padding przeglądarki i metryki fontu (linia bazowa ~1,5 px pod
   środkiem). `.nav-btn` dostał `display: inline-flex` z centrowaniem w obu
   osiach, `padding: 0 0 3px` jako korektę optyczną glifu oraz rozmiar ze
   wspólnego tokenu. Korekta jest zerowana tam, gdzie treść jest symetryczna
   (`.admin-status-actions`, `.nav-order-controls`, `.project-task-reorder`,
   `.timeline-zoom` — strzałki pionowe i ikony SVG); zduplikowana lokalna łatka
   centrowania w `.timeline-zoom .nav-btn` usunięta. Recenzent zweryfikował
   wszystkie 18 użyć `.nav-btn`, w tym wariant telefoniczny 44x44.
2. **Typografia i wysokości belki kalendarza.** Przed zmianą belka miała sześć
   wysokości i trzy rozmiary tekstu. Nowy token `:root --n2-control-h: 36px`
   scala wysokość kontrolek tab-podobnych: przycisk „Filtry" i chip osoby
   (`.cal-toolbar:not(.cal-toolbar-phone) .btn/.person-active-chip`),
   przełącznik tydzień/miesiąc (`.toggle-btn`, waga 500 -> 600 jak reszta
   przycisków), plakietka zegara (`.cal-now-badge`). Zegar już się nie
   odznacza: data z `--n2-type-xs` na `--n2-type-sm`, czas w wadze 500 i
   rozmiarze sm (zostaje mono + tabular-nums), zakres dat
   (`.cal-range-label`) sprowadzony do `--n2-type-sm`. Telefonowy rząd 56 px
   chroniony selektorem `:not(.cal-toolbar-phone)`, a segmenty w arkuszu
   szybkiego skoku podniesione do 44 px celu dotykowego.
3. **Sklejony segmented control (globalnie).** Wystąpienia wzorca:
   `.cal-view-toggle` w CalendarPage (belka desktop + arkusz telefonu),
   TeamTabs (`a.toggle-btn`), TeamPage, TimelinePage oraz `.ticket-mode-toggle`
   w EventsPage i TicketsPage; innych kopii wzorca w repo nie ma
   (`.task-editor-tabs`, `.weekday-chips`, `.filter-chip` to celowo inne
   wzorce). Rozklejenie brało się ze wspólnej reguły `.cal-view-toggle,
   .cal-nav { gap: 8px }`. Reguła rozdzielona: `.cal-nav` zachowuje gap 8 px
   (strzałki + etykieta), a `.cal-view-toggle, .ticket-mode-toggle` mają jedną
   wspólną, sklejoną regułę bez gapu. `border-left: none` przeniesione z
   `.toggle-btn:last-child` na `.toggle-btn + .toggle-btn`, więc krawędź
   działa też przy 3+ segmentach bez podwójnej linii.

## Zmiany

- `src/styles.css` — całość zmian wizualnych (121 linii zmienionych).
- `handoffs/RUN-STATE.md` — dopisany wynik developera (konwencja z
  poprzednich runów).

## Weryfikacja

- `npm test`: 119 plików testowych, 2663 testy, 0 porażek (w tym kontrakt CSS
  `stylesheetContract.test.ts`).
- `npm run build` (`tsc --noEmit` + vite build): zielony.
- Recenzja read-only (tier reviewer): **APPROVED**, zweryfikowane w kodzie
  m.in. pokrycie wszystkich użyć `.nav-btn`, zachowanie `align-items` po
  rozdzieleniu reguł, brak podwójnych krawędzi segmentów, ochrona mobile,
  brak em/en-dash w widocznych stringach. Werdykt wiki: **wiki unchanged**
  (zmiana czysto wizualna, żadna granica, inwariant ani ścieżka testowa z
  openwiki nie stała się nieaktualna).
- Gate (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Korekta optyczna 1,5 px (`padding: 0 0 3px` w `.nav-btn`) wyliczona z metryk
  fontu, nie potwierdzona zrzutem z przeglądarki (brak Playwrighta w
  node_modules worktree). Do potwierdzenia okiem na `/calendar`; korekta jest
  jednoliniowa.
- Waga `.toggle-btn` 500 -> 600 działa globalnie (także Zespół, Oś czasu,
  Wydarzenia, Zgłoszenia) — spójne z celem ujednolicenia, ale widoczne poza
  `/calendar`.
- `.toggle-btn` na telefonie w widokach Zgłoszenia/Wydarzenia/Zespół ma 36 px
  (przed zmianą ~38 px) — nadal poniżej 44 px celu dotyku, jak dotychczas;
  podniesiono tylko arkusz szybkiego skoku kalendarza.
- `.nav-btn` nadal nie dziedziczy `font-family` (glify renderuje font
  systemowy) — istniejąca wcześniej niespójność, świadomie nieruszana.

## Podpis schedulera

- Run: `20260803-210302-n2hub-321-kalendarz-typografia-i-segmenty`
- Prompt: `321-kalendarz-typografia-i-segmenty.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `6d244df5aa76a4309b792e43393a1938cbf34b19`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `6d244df5aa76a4309b792e43393a1938cbf34b19`
- Gałąź review: `review-integration`
- Run: `20260803-210302-n2hub-321-kalendarz-typografia-i-segmenty`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260803-210302-n2hub-321-kalendarz-typografia-i-segmenty.md`
