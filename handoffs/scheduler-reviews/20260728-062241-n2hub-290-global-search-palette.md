# Raport workflow: 20260728-062241-n2hub-290-global-search-palette

## Wykonane

Najpierw sprawdziłem bieżący kod: wszystkie luki z zadania BYŁY nadal aktualne
w tym worktree (`GlobalSearch.tsx` bez `scrollIntoView`, `searchAll` wołane bez
limitu, `onMouseEnter` bezwarunkowo ustawiające zaznaczenie, brak ogłoszenia
liczby wyników, brak podświetleń, brak szybkich akcji i „ostatnio otwartych”).
Zadanie wykonane w całości — jako rozszerzenie, nie przepisanie: wiersze i style
zostały te same, doszła wspólna arytmetyka listy.

Selektor (`src/store/selectors.ts`):

- `normalize` → wyeksportowane `normalizeSearchText` (JEDNO źródło normalizacji
  dla wyszukiwania i podświetlania).
- `searchAll(state, query, limits)` przyjmuje limit wspólny ALBO per grupa
  (`SearchLimits`, `DEFAULT_SEARCH_LIMIT` = 8, `Infinity` = bez limitu) i nie
  robi już `filter(...).slice(...)`: `collectLimited` PRZERYWA skan po
  przekroczeniu limitu, więc jedna litera nie przemiata całej kolekcji.
- `SearchResults` niesie `hasMore` per grupa (czy coś odpadło przez limit) —
  to zasila wiersz „Pokaż więcej”. Zawartość i kolejność grup bez zmian
  (identyczna z dawnym filtrem uciętym do limitu — pokryte testem).

Nowy czysty moduł `src/components/globalSearchModel.ts` (+ testy w node):

- `quickActionCatalog` — WYŁĄCZNIE istniejące czynności: „Nowe zadanie”
  (`openNewTask`) i nawigacja po trasach z `NAV_ITEMS`; `/admin` i `/team`
  bramkowane tak jak menu (`can('admin.panel')`, `canViewTeam`) — bramka UX,
  nie granica bezpieczeństwa. Zero nowych funkcji produktu.
- `isQuickActionQuery`/`quickActionTerm` (prefiks `>`), `filterQuickActions`
  (etykieta + hasła, normalizacja jak w `searchAll`) oraz `inlineQuickActions`
  (akcje nad wynikami dopiero od 2 znaków — jedna litera pasowała do niemal
  każdej etykiety nawigacji i byłaby czystym szumem).
- `highlightSegments` — rozłączne fragmenty dopasowane/niedopasowane, liczone na
  tekście znormalizowanym (`zolty` podświetla `Żółty`), ale zwracające ORYGINALNE
  znaki (mapa indeksów znak-po-znaku, bo NFD zmienia długość).
- `resultsAnnouncement` — „12 wyników w 3 grupach” z polską odmianą; pusto =
  „Brak wyników”.
- `recentPaletteRefs` + pamięć SESJI palety (`rememberOpenedRef`) — „ostatnio
  otwarte” to najpierw to, co użytkownik otworzył w tej karcie, potem dziennik
  `state.activity` (project/task, najnowsze pierwsze). ŻADNEJ nowej trwałości,
  wpisy wskazujące na usunięte encje odpadają.

Paleta (`src/components/GlobalSearch.tsx`):

- Jedna płaska lista wierszy budowana z grup: „Szybkie akcje” (prefiks `>` =
  wyłącznie akcje) → „Ostatnio otwarte” (pusta fraza) → Projekty/Zadania/
  Klienci/Zespół → wiersz „Pokaż więcej” per ucięta grupa (rozwija limit do 40
  W MIEJSCU, nie zamyka palety, zaznaczenie zostaje na pierwszym doładowanym
  wierszu). Indeksy, `role="option"` i aktywacja mają dzięki temu jedno źródło.
- Klawiatura przewija aktywny wiersz `scrollIntoView({ block: 'nearest' })` —
  robi to TYLKO nawigacja klawiaturą (flaga w ref).
- Mysz nie kradnie zaznaczenia: `onMouseEnter` działa dopiero po pierwszym
  realnym `mousemove`, a każda strzałka znów je blokuje.
- Podświetlenie dopasowania w tytule i w podtytule (klient/projekt/rola).
- Semantyka: `aria-activedescendant` + `aria-autocomplete="list"` przy
  `role="combobox"` (wolne wyszukiwanie, NIE zamknięta lista wyboru), liczba
  wyników ogłaszana przez `announce` (kanał polite `LiveRegionHost`).
- Zachowane bez zmian: skrót Ctrl/Cmd+K i `/`, pojedynczy montaż, wygaszanie
  palety pod modalem zadania, grupowanie, indeks w pamięci, `useDeferredValue`,
  `buildSearchResultMeta`.
- `src/styles.css`: `.gs-mark`, `.gs-row-icon`, `.gs-row-more` (istniejące
  reguły palety nietknięte).

Tryb wygaszania (retirement) NIETKNIĘTY, inwariant 6 nietknięty (zero zmian w
reduktorze), brak nowych zależności runtime.

## Zmiany

- `src/store/selectors.ts` — limit per grupa + wcześniejsze przerwanie skanu,
  `hasMore`, eksport `normalizeSearchText`.
- `src/store/selectors.test.ts` — nowy blok testów limitów/`hasMore`.
- `src/components/globalSearchModel.ts` — NOWY czysty moduł palety.
- `src/components/globalSearchModel.test.ts` — NOWE testy (node).
- `src/components/GlobalSearch.tsx` — rozszerzona paleta.
- `src/styles.css` — trzy nowe klasy palety.
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — akapit o kontrakcie palety
  (nowy moduł, nowa trasa testowa, jawny limit `searchAll`).

## Weryfikacja

- `npm test` — 89 plików, 1972 testy, wszystko zielone (przed zmianą 1970;
  doszło 12 nowych przypadków, nic nie zniknęło ani nie zostało osłabione).
- `npm run build` (tsc --noEmit + vite build) — zielone.
- `npm run check:openwiki` — „Validated 6 wiki files”.
- Ręczny przegląd w przeglądarce (dev server + Playwright MCP, dane
  przykładowe): Ctrl+K otwiera paletę; pusta fraza daje „Szybkie akcje” +
  „Ostatnio otwarte”; `>kal` pokazuje wyłącznie akcje z trafieniem
  „Przejdź do: Kalendarz”; Enter na akcji przechodzi do `/tasks` i zamyka
  paletę; fraza „a” daje 5 grup, `aria-live` czyta „25 wyników w 5 grupach”,
  97 podświetleń, `aria-activedescendant=gs-row-0`; 14× strzałka w dół przesuwa
  zaznaczenie na `gs-row-14` i przewija listę (scrollTop 0 → 267); `mouseenter`
  BEZ ruchu myszy nie zmienia zaznaczenia, po `mousemove` zmienia; „Pokaż
  więcej” dokłada wiersze (25 → 27) bez zamykania palety; otwarcie wyniku
  wpisuje go do „Ostatnio otwarte”; jedna litera nie zaśmieca listy akcjami
  („a” → same wyniki, „ka” → akcje + wyniki); zero błędów konsoli poza brakiem
  `favicon.ico`. Artefakty przeglądarki usunięte, dev server zatrzymany.
- Nie uruchamiałem `check:browser-release` — `playwright` nie jest zainstalowany
  jako zależność tego worktree, a montaż/skrót palety (jedyne, co pokrywa
  `browser-check-ui-keyboard.mjs`) nie był zmieniany.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- `SearchResults` ma nowe POLE `hasMore`; jedynym konsumentem selektora jest
  paleta, ale każdy przyszły kod budujący `SearchResults` ręcznie musi je podać.
- Szybkie akcje stoją NAD wynikami, więc przy frazie ≥ 2 znaków Enter bez
  strzałek może trafić w akcję nawigacyjną zamiast w pierwszy wynik (świadoma
  decyzja wzorca palety; próg 2 znaków ucina najgorszy szum).
- „Ostatnio otwarte” po odświeżeniu strony opiera się na dzienniku
  `state.activity` (czyli de facto „ostatnio zmienione”), bo pamięć otwarć jest
  sesyjna — świadomie, żeby nie dokładać nowej trwałości.
- Bramka `/team` w szybkich akcjach używa LOKALNEJ roli, a nie efektywnej roli
  chmurowej jak sidebar (paleta nie ma kontekstu `OrgData`). Skutek wyłącznie
  kosmetyczny: sama trasa i tak przekierowuje na `/dashboard`.
- `scrollIntoView({ block: 'nearest' })` wołane defensywnie (sprawdzenie typu);
  środowisko testowe `node` go nie dotyka, więc pokrywa je tylko przegląd
  w przeglądarce.

## Podpis schedulera

- Run: `20260728-062241-n2hub-290-global-search-palette`
- Prompt: `290-global-search-palette.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `99728bd64be0b6c3a835c35ef59c739d7a4aaeb9`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `99728bd64be0b6c3a835c35ef59c739d7a4aaeb9`
- Gałąź review: `review-integration`
- Run: `20260728-062241-n2hub-290-global-search-palette`

### Pliki zgłoszone do review

- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/GlobalSearch.tsx`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260728-062241-n2hub-290-global-search-palette.md`
- `src/components/globalSearchModel.test.ts`
- `src/components/globalSearchModel.ts`
