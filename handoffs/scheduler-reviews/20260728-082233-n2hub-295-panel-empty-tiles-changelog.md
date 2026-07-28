# Raport workflow: 20260728-082233-n2hub-295-panel-empty-tiles-changelog

## Wykonane

Najpierw sprawdziłem bieżący kod (`src/pages/DashboardPage.tsx`,
`src/pages/dashboardPanels.ts`, `src/styles.css`) — wszystkie trzy punkty były
nadal aktualne w buildzie. Prompt mobilny (288/289) dotykał wyłącznie stosu
`.dash-m-*`, więc go nie duplikuję: zmiany są desktopowe, a na telefonie pusty
kafelek nadal w ogóle nie trafia do DOM-u (`mobileDashboardOrder`).

**OP-01 — puste kafle jako belki.**

- Nowa czysta reguła `dashTileView(id, hasContent)` w `dashboardPanels.ts`: z
  treścią → pełna karta z samym tytułem, bez treści → belka z opisem stanu
  („Powiadomienia — brak nowych", „Alerty — czysto ✓").
- `DashboardPage` renderuje wtedy `.dash-card.dash-card-bar` (jedna linia,
  `min-height: 40px`). Kotwice `data-tour` (`home.alerts`) zostają na belce, więc
  onboarding znajduje kafelek niezależnie od jego stanu.
- TY-33: `.dash-card-bar { align-self: start }` bije `align-items: stretch`
  siatki — pusty kafelek nie rozciąga się do wysokości rzędu.
- Odzyskana wysokość idzie do „Zadania na dziś"/„Twój tydzień"; zmierzone w
  przeglądarce (1440×900, dane przykładowe): belki dokładnie 40 px, „Zasobnik"
  wchodzi nad zgięcie.

**AT-17 — changelog jedna linia.**

- Pasek `.changelog-bar` (ikona + tekst + dwa CTA + akcentowa ramka i gradient)
  zastąpiony jedną cichą linią `.changelog-line` z JEDNYM CTA
  („Nowości 20–21.07 →", `changelogCtaLabel`) — bez ramki i tła.
- Linia widoczna tylko dopóki najnowszy wpis jest nieprzeczytany
  (`changelogUnread`); potwierdzeniem jest otwarcie popoutu, a stan trzyma
  urządzeniowa preferencja `changelogSeenId` w `src/utils/uiPrefs.ts` (nie stan
  aplikacji i nie `storage.ts` — to chrome urządzenia, nie dane planera).
- „Zadania na dziś" są PIERWSZYM elementem treści Panelu: rzędy siatki to
  `today workload`, `notifications team`, `week`, `bin alerts`. Kolejność w
  DOM-ie jest ta sama, więc jednokolumnowy fallback (≤1180 px) czyta się
  identycznie.
- Skoro z paska znikł link „Zobacz pełną historię", dołożyłem go pod listą
  wpisów w popoucie — trasa `/changelog` nie zostaje bez wejścia z aplikacji.
- Nieużywane już `isSameDayRange` (jedynym konsumentem był stary pasek) usunięte
  wraz z jego testami, żeby nie zostawiać martwego kodu.

**AT-19 — konkretne CTA planowania i pasek tygodnia.**

- CTA zasobnika to prawdziwy przycisk akcentowy (`.btn primary .dash-plan-cta`;
  `.btn` ma `min-height: 40px`, czyli ponad wymagane 36) z konkretem z pierwszego
  wiersza zasobnika: „Zaplanuj 2h — Wywiady z partnerami instalacyjnymi →"
  (`binPlanCtaLabel`; pusty zasobnik / brak godzin → etykieta ogólna, długi tytuł
  skracany wielokropkiem). Cel („/calendar") bez zmian.
- Pasek tygodnia: pięć kolumn dni roboczych + wąska kolumna weekendu z dwiema
  belkami 24 px (zmierzone: 24 px). Wpisy dni roboczych ZAWIJAJĄ się do dwóch
  linii (`line-clamp: 2`) zamiast urywać się wielokropkiem.
- „+N więcej" oraz belki weekendu są linkami do TEGO dnia (`calendarDayTarget` →
  `/calendar?dzien=YYYY-MM-DD`). `CalendarPage` konsumuje parametr, ustawia
  kotwicę i czyści go (`replace`), więc kotwica ma nadal jedno źródło prawdy, a
  cofnięcie nie przywraca dnia.

Tryb emerytalny nietknięty. Niezmiennik 6 nietknięty — żadnej zmiany reducera,
jedyny zapis to urządzeniowa preferencja UI. Dwa pierścienie obciążenia (OP-02,
wykluczone przez ownera) nietknięte. Bez nowych zależności runtime.

## Zmiany

- `src/pages/dashboardPanels.ts` — `dashTileView`, `binPlanCtaLabel` (+ typy).
- `src/pages/DashboardPage.tsx` — belki pustych kafli, nowa kolejność rzędów,
  jednolinijkowy changelog z potwierdzeniem, akcentowe CTA zasobnika, pasek
  tygodnia (weekend/zawijanie/„+N więcej").
- `src/data/changelog.ts` — `changelogUnread`, `changelogCtaLabel`; usunięte
  `isSameDayRange`.
- `src/utils/uiPrefs.ts` — `changelogSeenId` (odczyt sanityzowany).
- `src/components/bottomNav.ts` — `CALENDAR_DAY_PARAM`, `calendarDayTarget`.
- `src/pages/CalendarPage.tsx` — konsumpcja i czyszczenie `?dzien=`.
- `src/components/ChangelogModal.tsx` — link do pełnej historii w popoucie.
- `src/styles.css` — `.dash-card-bar`, `.changelog-line`, `.dash-plan-cta`,
  pasek tygodnia; usunięte style starego `.changelog-bar`.
- Testy: `dashboardPanels.test.ts`, `changelog.test.ts`, `bottomNav.test.ts`.
- Wiki: `openwiki/n2hub/ui-navigation-and-onboarding.md`.

## Weryfikacja

- `npm test` — **94 pliki / 2054 testy zielone**, bez regresji. Nowe testy:
  - `dashTileView` (5) — wymagana logika zwinięcia/rozwinięcia kafelka i teksty
    belek dla obu kafelków;
  - `binPlanCtaLabel` (6) — konkret z godzinami i tytułem, kwadranse, degradacja
    do etykiety ogólnej (pusty tytuł / 0 h / wartość ujemna), skracanie długiego
    tytułu, tytuł na granicy długości;
  - `changelogUnread` (4) i `changelogCtaLabel` (3);
  - `calendarDayTarget` (1).
- `npm run build` — zielony (`tsc --noEmit` + vite build).
- `node scripts/check-openwiki-links.mjs` — „Validated 6 wiki files."
- Ręczna weryfikacja w przeglądarce (Playwright MCP + dev server, dane
  przykładowe), desktop 1440×900 i telefon 390×844: belki 40 px z zachowanymi
  kotwicami `data-tour`, „Zadania na dziś" jako pierwszy element treści, CTA
  „Nowości 20–21.07 →" znika po otwarciu popoutu i NIE wraca po przeładowaniu
  (`changelogSeenId` w `n2hub.ui.v1`), belki weekendu 24 px z `href`
  `/calendar?dzien=…`, deep-link przestawia kalendarz na właściwy tydzień i
  czyści parametr, mobilny stos bez zmian. W konsoli wyłącznie 404 favicony.
- `npm run check:onboarding` NIE poszedł: w tym worktree brak pakietu
  `playwright` (nie ma go w devDependencies) — pełna matryca przeglądarkowa
  należy do weryfikacji release'owej. Kotwice onboardingu sprawdziłem zamiast
  tego wprost w DOM-ie: `home.today`, `home.workload`, `home.bin`, `home.alerts`
  obecne (ta ostatnia także na zwiniętej belce).
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- W rzędzie z belką (np. pusta belka Powiadomień obok karty Zespołu) wysokość
  rzędu nadal wyznacza sąsiad, więc obok belki zostaje puste pole. Wynika to
  wprost z wymagania („belka" + `align-self: start` zamiast przelewania kafli);
  likwidacja tej luki wymagałaby innego układu (dwie niezależne kolumny), czego
  prompt nie zamawiał.
- Potwierdzenie changelogu jest URZĄDZENIOWE (`uiPrefs`/localStorage), nie
  per-użytkownik w danych: na innym urządzeniu ta sama osoba zobaczy linię
  ponownie. Świadomy wybór — to chrome UI, a `storage.ts` pozostaje jedyną
  granicą danych aplikacji.
- `line-clamp: 2` przycina wpis dłuższy niż dwie linie (zamiast urywać go w
  połowie pierwszej); pełna treść jest w kalendarzu, do którego prowadzi
  „+N więcej".
- Belki weekendu pokazują sumę godzin dnia, nie listę bloków — szczegół jest o
  jeden klik dalej (deep-link dnia). To celowa kompresja z AT-19.
- Uwaga proceduralna: przy weryfikacji liczby testów wykonałem `git stash`, a
  zaraz po tym `git stash pop`. Drzewo robocze zostało w pełni odtworzone
  (`git diff --stat` = 12 plików, lista stashy sprzed runu nietknięta), a gate
  (`npm test && npm run build`) przebiegłem PONOWNIE na odtworzonym drzewie —
  zielony. Poza tym żadnych operacji na stanie gita: bez commitów, zmian gałęzi,
  merge'y i pushy.

## Podpis schedulera

- Run: `20260728-082233-n2hub-295-panel-empty-tiles-changelog`
- Prompt: `295-panel-empty-tiles-changelog.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `657b9af49ec34ef925299dc52986c2a6d204b4e1`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `657b9af49ec34ef925299dc52986c2a6d204b4e1`
- Gałąź review: `review-integration`
- Run: `20260728-082233-n2hub-295-panel-empty-tiles-changelog`

### Pliki zgłoszone do review

- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/ChangelogModal.tsx`
- `src/components/bottomNav.test.ts`
- `src/components/bottomNav.ts`
- `src/data/changelog.test.ts`
- `src/data/changelog.ts`
- `src/pages/CalendarPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/dashboardPanels.test.ts`
- `src/pages/dashboardPanels.ts`
- `src/styles.css`
- `src/utils/uiPrefs.ts`
- `handoffs/scheduler-reviews/20260728-082233-n2hub-295-panel-empty-tiles-changelog.md`
