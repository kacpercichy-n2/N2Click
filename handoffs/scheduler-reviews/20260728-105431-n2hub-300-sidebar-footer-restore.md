# Raport workflow: 20260728-105431-n2hub-300-sidebar-footer-restore

## Weryfikacja wstępna: regresja NADAL obecna

Tak — usterka żyła w bieżącym worktree, więc zadanie wykonane w całości.

Źródło regresji ustalone dokładnie. `.sidebar-footer` istniało w DWÓCH
niezgodnych wariantach, po jednym z każdej scalanej gałęzi:

- **main (`28f9c88`)** — stopka to POZIOMY wiersz: przypięte „Zgłoszenia”
  (`flex: 1`, wys. 44 px) obok okrągłego przycisku pomocy 44×44 px, tylko
  z ikoną. Blok użytkownika (`.sidebar-user`) był osobnym **rodzeństwem**
  stopki, dociąganym do dołu przez `margin-top: auto`.
- **gałąź równoległa (run 273, `813c37b`, „S1”)** — stopka to KOLUMNA
  (`flex-direction: column`) z `position: sticky`, kryjącym tłem
  `--n2-panel` i gradientem `::before`, obejmująca przycisk pomocy
  z widoczną etykietą tekstową ORAZ blok użytkownika w środku.

Merge `11ec13c` zrobił z tego unię zamiast wyboru:

- **CSS** — obie reguły trafiły do `styles.css` (linie ~461 i ~7677). Późniejsza
  wygrywała `gap` i `align-items`, ale NIE kasowała `flex-direction: column`
  ani `background` z wcześniejszej. Efekt: stopka renderowała się jako kolumna
  z `align-items: center`, więc dzieci kurczyły się do szerokości treści
  (**„przyciski wyraźnie mniejsze”**), a pod nimi świeciło tło `--n2-panel`
  z gradientem (**„jaśniejsze, obce tło”**).
- **JSX** — została kolumnowa stopka run 273 (z `.sidebar-user` w środku),
  a link „Zgłoszenia” z maina został do niej dołożony. Przycisk pomocy zachował
  `<span className="nav-label">Pomoc i samouczki</span>`, ale CSS maina nadaje
  mu sztywne `width: 44px` — stąd **etykieta łamana na dwie linie**.

## Wykonane

Zmiana chirurgiczna, wyłącznie `src/App.tsx` + `src/styles.css`
(46 wstawień / 73 usunięcia). Odrzucono wariant run 273, przywrócono wariant
z `28f9c88`.

**`src/App.tsx`** (stopka sidebara):

1. `.sidebar-user` wyjęty ze stopki z powrotem na poziom rodzeństwa, bezpośrednio
   pod `.sidebar-footer` wewnątrz `<aside>` — jak w `28f9c88`. Dociąganie do dołu
   znów robi `margin-top: auto` na `.sidebar-user`.
2. Przycisk pomocy wrócił do postaci „tylko ikona”: usunięty
   `<span className="nav-label">Pomoc i samouczki</span>`, w zamian
   `aria-label="Pomoc i samouczki"` + `title="Pomoc i samouczki"` (dokładnie
   jak przed merge). Klasa `.sidebar-help` i kotwica `data-tour="shell.help"`
   nietknięte.

**`src/styles.css`**:

3. Usunięty kolidujący blok `.sidebar-footer` z run 273 (`sticky`, `z-index`,
   `margin-top`, `flex-direction: column`, `gap`, `background: var(--n2-panel)`)
   wraz z gradientem `.sidebar-footer::before`. W jego miejsce komentarz
   ostrzegawczy, żeby druga reguła nie wróciła.
4. Usunięty jego neutralizator z `@media (max-width: 1180px)`
   (`position: static` / `margin-top: 0` / `background: transparent` /
   `::before { display: none }`) — bez reguły bazowej nie miał już czego cofać.

Po zmianie `.sidebar-footer` opisuje **jedna** reguła (wiersz, `gap: space-2`)
plus override `.sidebar-collapsed .sidebar-footer` (kolumna dwóch kółek 44 px).
Stan CSS jest zbieżny z `28f9c88`.

### Funkcje z paczki zachowane

Żadna nie wymuszała zepsutego układu, więc wszystkie zostają:

- prefetch tras na `onPointerEnter` / `onFocus` — „Zgłoszenia” (`/zgloszenia`)
  i oba linki do profilu (`/people/:id`);
- dymki `Tooltip` na awatarach (prymityw używa `cloneElement` bez opakowania,
  więc jest neutralny dla flexa);
- dostępność: `aria-label` na przycisku pomocy i obu linkach profilowych.

Nie ruszano reszty nawigacji, kolejności menu per użytkownik,
`.app-nav-link { min-height: 38px }` z run 273, architektury cloud-authoritative
ani inwariantu 6. Tryb retirement bez zmian.

## Zmiany

- `src/App.tsx` — stopka sidebara: `.sidebar-user` wyprowadzony poza
  `.sidebar-footer`, przycisk pomocy z powrotem tylko z ikoną (`aria-label` +
  `title` zamiast widocznej etykiety).
- `src/styles.css` — usunięta druga, kolumnowa reguła `.sidebar-footer`
  + `::before` oraz jej override w `@media (max-width: 1180px)`.

## Weryfikacja

| Check | Wynik |
| --- | --- |
| `npm test` (vitest) | **zielony** — 101 plików, 2119 testów, 0 błędów |
| `npm run build` | **zielony** — `built in 7.51s` |
| `npx tsc --noEmit` | **zielony** — `No errors found` |

- Gate (`npm test && npm run build`): oczekuje na scheduler

### Weryfikacja wizualna w przeglądarce (MCP Playwright, dev server 5173)

Pomiary DOM/CSSOM po zmianie, 1440×900, dane przykładowe wczytane:

- `.sidebar-footer`: `display: flex`, **`flex-direction: row`**,
  `position: static`, `background: rgba(0,0,0,0)`, `gap: 8px`,
  `::before` → `content: none` (brak gradientu i obcego tła);
- liczba reguł `.sidebar-footer` w arkuszu: **1** (było 2);
- `.sidebar-tickets` 186×44 px (wypełnia wolną szerokość),
  `.sidebar-help` **44×44 px**, `innerText: ""` (brak łamanego tekstu),
  `aria-label` i `title` = „Pomoc i samouczki”;
- `.sidebar-user` poza stopką (`footer.contains(user) === false`), rodzeństwo
  w `.app-sidebar`, pełna szerokość 238 px, `.logout-btn` 198 px,
  `border-top` wiersza 1 px;
- tryb zwinięty: stopka wraca do kolumny dwóch wyśrodkowanych kółek 44 px,
  etykieta „Zgłoszenia” ukryta — zgodnie z `.sidebar-collapsed` override;
- 1000×900 (`≤1180 px`): stopka nadal statyczny wiersz, przezroczysta, bez
  gradientu — brak regresji po usunięciu neutralizatora.

Zrzuty stopki (rozwinięta i zwinięta) obejrzane: jeden wiersz „Zgłoszenia” +
okrągła pomoc, pod nim linia i wiersz awatar + „Wyloguj”. Zgodne z `28f9c88`.

### Check onboardingowy

`scripts/browser-check-onboarding.mjs` **nie dał się uruchomić** —
pakiet `playwright` nie jest zależnością projektu ani nie ma go w
`node_modules` tego worktree (`ERR_MODULE_NOT_FOUND`). Skrypt korzysta
z globalnej instalacji, której w środowisku runu nie ma. To ograniczenie
środowiska, nie skutek zmiany.

Zamiast tego odtworzono jego kluczową interakcję (linie 49 i 71:
`page.locator('.sidebar-help').click()`) przez serwer MCP Playwright:
selektor `.sidebar-help` nadal się rozwiązuje, kliknięcie otwiera centrum
samouczków (`.tutorial-center`, nagłówek „Samouczki N2Hub”), kotwica
`[data-tour="shell.help"]` obecna, nazwa dostępna przycisku = „Pomoc
i samouczki”. Pełny check zostaje dla weryfikacji wydaniowej.

## Ryzyka / rzeczy do sprawdzenia

- **Świadomie cofnięta funkcja run 273.** Stopka nie jest już `sticky`
  i nie ma kryjącego tła. Przy bardzo niskim oknie, gdy `.app-nav` zaczyna się
  przewijać, pozycje listy mogą znów prześwitywać pod stopką (lista ma tylko
  półprzezroczyste `--n2-surface`) i znika gradient „jest tego więcej”.
  To dokładnie stan sprzed merge, a prompt daje priorytet wyglądowi z `28f9c88`.
  Gdyby ten sygnał miał wrócić, trzeba go zrobić bez `flex-direction: column`
  i bez tła na całej stopce.
- **Przerwa między stopką a blokiem użytkownika na wysokich ekranach.**
  `margin-top: auto` siedzi na `.sidebar-user`, więc wolna przestrzeń ląduje
  MIĘDZY stopką a blokiem użytkownika, nie nad stopką. Zachowanie identyczne
  jak w `28f9c88` — celowo nieruszane.
- **Dymek pomocy jest natywny (`title`), nie prymitywem `Tooltip`.** Tak było
  przed merge; w obecnym kodzie przycisk nie miał ŻADNEGO dymka (miał widoczną
  etykietę), więc jest to poprawa, nie regresja. Świadomie nie owijano go
  w `Tooltip`, żeby nie wychodzić poza odtworzenie stanu referencyjnego.
- **Nie ruszono `.app-nav-link { min-height: 38px }`** z run 273. Zgłoszenie
  „przyciski mniejsze” dotyczyło stopki, a prompt zabrania przebudowy reszty
  nawigacji. Pozycje listy nawigacji zostają 38 px na desktopie / 44 px poniżej
  1180 px.
- **Wiki bez zmian.** `openwiki/n2hub/ui-navigation-and-onboarding.md` (linie
  32–36) opisuje stopkę dokładnie jako wiersz z „Zgłoszeniami” obok okrągłego
  przycisku pomocy i dwa kółka 44 px w trybie zwiniętym — czyli stan po tej
  zmianie. Opis był NIEZGODNY z kodem przed tym runem, a teraz jest zgodny;
  nic do poprawienia. (Poboczna, wcześniejsza nieścisłość tej samej listy —
  wzmianka o mobilnej pułapce fokusa w `#app-drawer`, choć szuflada zniknęła
  w runie 287 — leży poza granicą tego zadania i została nietknięta.)

## Podpis schedulera

- Run: `20260728-105431-n2hub-300-sidebar-footer-restore`
- Prompt: `300-sidebar-footer-restore.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `38b48225a3bb837ce71b276f9ff8a992bc9e1201`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `38b48225a3bb837ce71b276f9ff8a992bc9e1201`
- Gałąź review: `review-integration`
- Run: `20260728-105431-n2hub-300-sidebar-footer-restore`

### Pliki zgłoszone do review

- `src/App.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260728-105431-n2hub-300-sidebar-footer-restore.md`
