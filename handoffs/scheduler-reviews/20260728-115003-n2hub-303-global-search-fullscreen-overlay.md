# Raport workflow: 20260728-115003-n2hub-303-global-search-fullscreen-overlay

## Wykonane

Problem był nadal obecny — i zdiagnozowany u źródła. `SearchOverlay` renderował
się inline wewnątrz `<aside class="app-sidebar">`, a sidebar ma
`backdrop-filter` (tworzy containing block dla `position: fixed` wg specyfikacji
Filter Effects) oraz `overflow-y: auto`. „Fixed” overlay palety liczył się więc
względem sidebara i był przycinany do lewego panelu, mimo że CSS wyglądał na
pełnoekranowy.

Naprawa (chirurgiczna, tylko `GlobalSearch.tsx` + `styles.css`):

1. **Portal przez prymityw z runu 278**: paleta idzie przez `OverlayLayer`
   (portal do `#n2hub-overlay-root` na `<body>`), zgodnie z jego kontraktem —
   portal OWIJA `AnimatePresence`, więc animacja wyjścia dogrywa się do końca.
   Scrim i viewport pokrywają teraz cały ekran niezależnie od miejsca montażu
   (sidebar na desktopie, topbar na telefonie).
2. **Tokeny drabiny nakładek**: `.gs-scrim` → `var(--n2-z-search)` (990),
   `.gs-viewport` → `calc(var(--n2-z-search) + 1)` (991); wartości identyczne z
   dotychczasowymi literałami, modal zadania (1000/1001) nadal stoi wyżej.
3. **Szerszy, czytelny panel**: `width: min(680px, 92vw)` (było `94vw` /
   `max-width: 620px`), wycentrowany poziomo, osadzony `clamp(48px, 12vh, 140px)`
   od góry; lista wyników zachowuje własny scroll `max-height: min(60vh, 480px)`.
4. **≤760 px**: nowa reguła media — panel na `width: 100%` przy wąskim paddingu
   viewportu (niemal cała szerokość ekranu, mniejszy odstęp od góry).
5. **Scrim bez `backdrop-filter`**: dotąd `blur(6px)` był de facto ograniczony
   do sidebara; po portalu stałby się ŻYWYM pełnoekranowym blur-em, czego
   wprost zakazuje kontrakt prymitywów (frontend-performance-and-primitives.md).
   Zamiast tego przyciemnienie `rgba(4,3,8,0.72)` (było 0.66).
6. **Fokus wraca po zamknięciu**: overlay zapamiętuje `document.activeElement`
   przy otwarciu i przywraca go przy odmontowaniu (standard dialogów Radix /
   React Aria). Wcześniej fokus spadał na `<body>`; po portalu przywrócenie jest
   konieczne, a gdy nad paletą otwiera się modal zadania, `#root` jest `inert`,
   więc przywrócenie jest bezpiecznym no-opem i nie kradnie fokusa modalowi.

Cała funkcjonalność z runu 290 nietknięta: szybkie akcje `>`, ostatnio otwarte,
podświetlanie, „Pokaż więcej”, nawigacja klawiaturą, aria-live — logika w
`globalSearchModel.ts` bez zmian.

## Zmiany

- `src/components/GlobalSearch.tsx` — render przez `OverlayLayer`, przywracanie
  fokusa, aktualizacja komentarza nagłówkowego (powód portalu).
- `src/styles.css` — tokeny `--n2-z-search`, szerokość panelu `min(680px, 92vw)`,
  scrim bez `backdrop-filter`, reguła `@media (max-width: 760px)` dla palety,
  drobna korekta komentarza przy drabinie `--n2-z-*`.

## Weryfikacja

- `npm test` — **2137/2137 zielone** (102 pliki).
- `npm run build` (tsc --noEmit + vite build) — **zielony**.
- Przeglądarkowo (Playwright MCP, Chromium, dev server):
  - 1440×900: panel wycentrowany (left 381, szerokość 677), scrim i viewport
    pełne 1440×900, DOM w `#n2hub-overlay-root`, poza `.app-sidebar`;
  - autofokus inputu po otwarciu; Escape zamyka i **fokus wraca na trigger**;
  - klik w przyciemnione tło zamyka paletę;
  - `>` pokazuje 14 wierszy szybkich akcji;
  - 390×844: panel 365 px z 390 px (niemal pełna szerokość), scrim pełnoekranowy;
  - zero błędów `pageerror` przy cyklach otwórz/zamknij (jedyne wpisy konsoli to
    404 favicon dev-serwera, niezwiązane).
- `scripts/browser-check-ui-keyboard.mjs` nie dał się uruchomić lokalnie (brak
  pakietu `playwright` w worktree) — pokryłem jego asercje palety (Ctrl+K
  otwiera `.gs-panel`, Escape chowa) ręcznie przez Playwright MCP, wynik j.w.

## Ryzyka / rzeczy do sprawdzenia

- Scrim stracił rozmycie tła (świadomie — pełnoekranowy żywy `backdrop-filter`
  łamie kontrakt prymitywów); wizualnie rekompensowane mocniejszym
  przyciemnieniem. Gdyby owner chciał efekt mrożonego szkła, właściwą drogą jest
  snapshotowe tło jak w `ModalFrame`.
- Wiki: **wiki unchanged** — `frontend-performance-and-primitives.md` nie
  wymienia konsumentów `OverlayLayer`, a kontrakt prymitywu i drabina `--n2-z-*`
  pozostały dokładnie takie, jak opisane.

## Podpis schedulera

- Run: `20260728-115003-n2hub-303-global-search-fullscreen-overlay`
- Prompt: `303-global-search-fullscreen-overlay.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `02425b1e2cad6e7cc04f9b2e36eee796f62a41ff`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `02425b1e2cad6e7cc04f9b2e36eee796f62a41ff`
- Gałąź review: `review-integration`
- Run: `20260728-115003-n2hub-303-global-search-fullscreen-overlay`

### Pliki zgłoszone do review

- `src/components/GlobalSearch.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260728-115003-n2hub-303-global-search-fullscreen-overlay.md`
