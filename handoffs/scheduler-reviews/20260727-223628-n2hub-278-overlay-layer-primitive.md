# Raport workflow: 20260727-223628-n2hub-278-overlay-layer-primitive

## Wykonane

Najpierw sprawdziłem, czy zadanie jest nadal aktualne w bieżącym buildzie: **jest**.
W worktree nie istniał żaden prymityw nakładek, a wszystkie cztery kopie logiki
„Escape / klik poza / scroll” były na miejscu (`WeekView.tsx` 1462–1476, 1482–1501,
1505–1524 oraz `FilterPanel.tsx` 54–68), razem z magicznymi liczbami
`window.innerWidth - 240/280` i `window.innerHeight - 100/240/260`.

Zadanie przeszło ścieżką tier `architect → developer → reviewer` (wiele granic
naraz + nierozstrzygnięte decyzje projektowe: portal kontra `AnimatePresence`,
repozycjonowanie zamiast zamykania, semantyka „triggera” dla menu z prawego
klika, skala `z-index`). Architekt rozstrzygnął siedem decyzji i wydał pakiet
`handoffs/PKG-20260727-overlay-layer-primitive.md` (Status: ready, Risk: high).

Zrealizowane punkty 1–5 zadania:

1. **Nowy prymityw, bez nowej zależności.** Czysta logika w
   `src/components/overlayShell.ts` (`resolveOverlayPosition` — flip/shift +
   `availableHeight`; `createOverlayStack` — Escape tylko dla wierzchniej
   warstwy; `createDismissState`/`resolveDismissEvent`; `resolveMenuNavKey`,
   `matchTypeahead`) i cienka warstwa DOM w `src/components/useOverlay.ts`
   (`useOverlay` + `OverlayLayer` portalujący do leniwie tworzonego
   `#n2hub-overlay-root`). Podział czysty moduł + cienki hook jest równoległy do
   istniejącego `modalShell.ts` / `useModalShell.ts`. Dostępna wysokość wychodzi
   jako zmienna CSS `--overlay-avail` i zasila `max-height` w `.context-menu` —
   to ona zastąpiła stare docinanie do dołu ekranu.
2. **Zasady zamykania.** Nasłuchy wstają jedną turę po otwarciu; zamknięcie
   wymaga PARY `pointerdown` → `click` poza nakładką (naprawia „zamyka się w tej
   samej klatce” i „przeciąganie paska przewijania zamyka warstwę”); `contextmenu`
   poza nakładką zamyka od razu, bo prawy klik nigdy nie generuje `click`;
   zdarzenia na triggerze są klasyfikowane osobno, więc `onClick` przycisku
   „Filtry” przełącza bez wyścigu zamknij-otwórz.
3. **Klawiatura menu** (roving tabindex, strzałki, Home/End, typeahead, powrót
   fokusa) włącza się wyłącznie przez jawną flagę `menuKeyboard`: kroki
   `role="menu"` trzech menu `WeekView`. Kroki formularzy i `FilterPanel`
   (`role="dialog"` z radiami) jej NIE dostają.
4. **Migracja czterech miejsc.** Trzy menu `WeekView` + popover `FilterPanel`.
   Zmieniła się wyłącznie powłoka — dispatche, guardy, osobne ścieżki
   rekurencji i cała logika przeciągania są nietknięte. `FilterPanel` świadomie
   NIE jest portalowany: przy mobilnym breakpoincie jego popover jest
   `position: static` w normalnym flow, więc portal zepsułby układ; bierze z
   hooka tylko stos, zamykanie i powrót fokusa.
5. **z-index.** Osiem tokenów `--n2-z-*` w `:root` z DZISIEJSZYMI wartościami
   (drabina bez zmian numerycznych); na `var()` przeszły tylko `.context-menu`
   i `.filter-popover`.

Zmiana zachowania zgodna z zadaniem: wszystkie trzy menu `WeekView` teraz
REPOZYCJONUJĄ się przy scrollu/resize zamiast się zamykać (kotwica = element +
offset kliknięcia, `getBoundingClientRect` przez rAF, aktualizacja tylko stylu
na tym samym elemencie — bez remountu, więc fokus i karetka w krokach
`form`/`schedule`/`edit` nie uciekają). Odpięta kotwica zamyka menu.

## Zmiany

- `src/components/overlayShell.ts` (nowy) — czysta logika, zero importów DOM.
- `src/components/overlayShell.test.ts` (nowy) — 37 testów.
- `src/components/useOverlay.ts` (nowy) — hook + `OverlayLayer`.
- `src/components/WeekView.tsx` — usunięte trzy efekty zamykania i wszystkie
  magiczne docinania; menu kotwiczone elementem; każdy `AnimatePresence`
  owinięty w `OverlayLayer`. JSX menu, dispatche i guardy bez zmian.
- `src/components/FilterPanel.tsx` — efekt 54–68 zastąpiony przez `useOverlay`.
- `src/styles.css` — tokeny `--n2-z-*`, `.context-menu` + `.filter-popover` na
  `var()`, `max-height: var(--overlay-avail, 80vh)`.
- `openwiki/n2hub/ui-navigation-and-onboarding.md`,
  `openwiki/n2hub/scheduling-and-calendar.md` — **wiki updated** (decyzja
  reviewera): dopisana równoległa powłoka nakładek i nowy plik testowy.
- `handoffs/PKG-20260727-overlay-layer-primitive.md`, `handoffs/RUN-STATE.md`.

`git diff` na `package.json` / `package-lock.json` jest pusty — **zero nowych
zależności** (Radix/Base UI/Floating UI wyłącznie jako lektura).

## Weryfikacja

- `npm test`: **71 plików / 1667 testów zielonych**. Baseline przed zmianą:
  70 / 1630 — brak regresji, przyrost to 37 nowych testów `overlayShell.test.ts`
  (flip / brak flipa / docinanie w poziomie i pionie z marginesem /
  `availableHeight` przed i po flipie; stos: `isTop` tylko dla ostatniego,
  re-push na wierzch, usunięcie ze środka; zamykanie: para zamyka, sam
  `click-outside` NIE zamyka, `pointerdown-inside` + `click-outside` NIE zamyka,
  trigger nigdy nie zamyka, `contextmenu-outside` zamyka; klawiatura: zawijanie
  strzałek, Home/End, wejście z `-1`, typeahead na polskich etykietach).
- `npm run build` (`tsc --noEmit && vite build`): **zielony**.
- `npm run check:openwiki`: zwalidowano 6 plików wiki.
- Uruchomiłem oba gate'y sam, po nałożeniu poprawek wiki i nita — nie polegam
  wyłącznie na raporcie workera.
- Reviewer (read-only, na strukturalnym diffie): **approved-with-findings** —
  zero blockerów, trzy nity. Zastosowałem jeden (`event.isComposing` w handlerze
  typeahead). Dwa pozostałe świadomie zostawione: prefiks typeahead dopasowuje
  surowy `textContent`, więc pozycje z wiodącym glifem („↑ Dodaj przed”) nie są
  osiągalne literą „d” — to jest zgodne ze specyfikacją pakietu.

## Ryzyka / rzeczy do sprawdzenia

- **Checki przeglądarkowe nie mogły się uruchomić.** Pakiet npm `playwright`
  nie jest zainstalowany, a `scripts/browser-check-*.mjs` wywala się na
  `import { chromium } from 'playwright'`. Instalacja złamałaby zakaz nowych
  zależności, więc `browser-check-bin-split`, `browser-check-bin-drag` i
  `browser-check-ui-keyboard` pozostają **niezweryfikowane**. To ograniczenie
  jest wcześniejsze niż ten run — identycznie zaraportował run 277. Developer
  zrobił zastępczy smoke po surowym CDP na Chrome for Testing (z `/tmp`, nic nie
  trafiło do repo) i przeszły: render w `#n2hub-overlay-root`, roving tabindex,
  strzałki/End, repozycjonowanie przy scrollu bez zamknięcia, Escape z powrotem
  fokusa, brak zamknięcia przy samym kliknięciu poza, re-anchor przy drugim
  prawym kliku, menu przy krawędzi ekranu, `autoFocus` w formularzu „Zaplanuj
  część”, `FilterPanel`. Traktuję to jako materialnie słabsze niż nazwane
  checki — **release verification musi je przepuścić przed wydaniem**.
- Ryzyko regresji samego przeciągania oceniam jako niskie: w diffie `WeekView`
  nie występuje żaden symbol ścieżki drag (`gate.arm`, `startDrag`,
  `useTouchDragGate`, `pointermove/up/cancel`, `setPointerCapture`, `.begin`,
  logika kolizji), a nowe nasłuchy wskaźnika są wyłącznie obserwatorami — nie
  wołają `preventDefault`, `stopPropagation` ani nie przejmują wskaźnika.
  Jedyny `stopPropagation` siedzi na Escape wierzchniej warstwy, a dwa
  `preventDefault` na nawigacji klawiaturą menu.
- **Odstępstwo od pakietu (świadome, zaadjudykowane przez reviewera):** nasłuchy
  `click`/`auxclick`/`contextmenu` są w fazie CAPTURE, nie bubble. Bubble byłoby
  błędne dwukrotnie — reactowe handlery na `.week-block`, kartach zasobnika i
  przycisku „Zaplanuj część” wołają `stopPropagation()`, więc nasłuch na oknie
  nigdy by ich nie zobaczył (menu zostawałoby otwarte), a przy bubble `openMenu`
  z tego samego zdarzenia wykonałby się PRZED zamknięciem i zbatchowany
  `setMenu(null)` skasowałby świeżo otwarte menu.
- Niezweryfikowana w pełni pozostaje powłoka menu „w locie”: pierwsze malowanie
  w portalu, wyjście `AnimatePresence` przez portal i wyścig pary
  `pointerdown`+`click` z realnymi klikami w pozycje menu. Dokładnie to łapią
  nazwane checki przeglądarkowe.
- Ceremonia Codex: pakiet deklaruje `Codex review: required`, ale w tym worktree
  nie ma ani `scripts/codex-review.sh`, ani `automation/claude-scheduler/`, więc
  niezależny przebieg Codex **nie odbył się**. Odnotowuję to jako lukę, nie jako
  ciche odpuszczenie; reviewer nie znalazł blockera, który Codex mógłby dołożyć.

## Podpis schedulera

- Run: `20260727-223628-n2hub-278-overlay-layer-primitive`
- Prompt: `278-overlay-layer-primitive.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `4c5257280f953d2556ec863ca6b8c31a69600b08`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `4c5257280f953d2556ec863ca6b8c31a69600b08`
- Gałąź review: `review-integration`
- Run: `20260727-223628-n2hub-278-overlay-layer-primitive`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/FilterPanel.tsx`
- `src/components/WeekView.tsx`
- `src/styles.css`
- `handoffs/PKG-20260727-overlay-layer-primitive.md`
- `handoffs/scheduler-reviews/20260727-223628-n2hub-278-overlay-layer-primitive.md`
- `src/components/overlayShell.test.ts`
- `src/components/overlayShell.ts`
- `src/components/useOverlay.ts`
