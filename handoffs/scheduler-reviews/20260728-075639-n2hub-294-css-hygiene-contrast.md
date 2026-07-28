# Raport workflow: 20260728-075639-n2hub-294-css-hygiene-contrast

## Wykonane

Najpierw sprawdziłem każdy z czterech punktów w bieżącym worktree — **wszystkie
cztery były nadal aktualne**, żadnego nie pominąłem.

### 1. Reduced-motion: wzorzec odwrócony na opt-in (W08)

Istniały DWA globalne resety `0.01ms !important` (`src/styles.css`: reguła na
`*, *::before, *::after` oraz węższa na `.onboarding-layer *, .sidebar-help`).
Oba usunięte. W ich miejsce wszedł mnożnik:

- `:root { --n2-motion: 0 }` — domyślnie BRAK ruchu;
- `@media (prefers-reduced-motion: no-preference) { :root { --n2-motion: 1 } }`
  — jedyne miejsce, w którym ruch jest włączany. Przeglądarka, która nie zna
  tego media query, również zostaje na 0;
- `--n2-transition: calc(180ms * var(--n2-motion)) ease` oraz **wszystkie
  pozostałe czasy trwania** w pliku przepisane na
  `calc(<czas> * var(--n2-motion))` (`.15s` ×5, `1.2s`, `900ms`, `280ms`,
  `260ms`, `180ms`, `160ms`). W zbudowanym CSS potwierdzone 11 wystąpień
  `calc(… * var(--n2-motion))` i zero `0.01ms`.

Różnica jakościowa: `calc(180ms * 0)` = `0s`, więc przejście naprawdę się nie
uruchamia, zamiast lecieć w 0,01 ms i strzelać `transitionend`.

Strona JS: `MotionConfig reducedMotion="user"` w `src/main.tsx` już istniał i
obsługuje wszystkie komponenty `m.*` (wszystkie animują wyłącznie
`opacity`/`scale`/`y`), więc nie dodawałem tam redundantnego `useReducedMotion`.
Jedna REALNA luka: `MotionConfig` nie zdejmuje kaskady `staggerChildren`, więc
kafelki Panelu wciąż wchodziłyby jeden po drugim — `src/pages/DashboardPage.tsx`
dostał `useReducedMotion()` i przy tej preferencji siatka pojawia się naraz.
Zaktualizowałem też nieaktualny komentarz w `.confirm-card` (odwoływał się do
usuniętej reguły).

### 2. Kontrast (TY-06)

- `--n2-text-faint`: `0.34` → `0.46`.
- Nowy token `--n2-text-disabled: rgba(251, 248, 255, 0.3)` z komentarzem
  ograniczającym użycie do stanów nieaktywnych i ikon ≥ 16 px. Zastosowany w
  4 miejscach: `.gs-row-chevron` i `.card-chevron` (ikony 16 px, `aria-hidden`)
  oraz `.presence-offline` / `.chat-popup-presence.presence-offline::before`
  (kropka „poza siecią" = stan nieaktywny, nie tekst).
- `.gs-group-head` (nagłówki grup w wyszukiwaniu) i `.filter-group legend`
  (legendy filtrów) przeniesione na `--n2-text-muted`, zgodnie z zadaniem.
- Pozostałe użycia `faint` (oś godzin kalendarza, puste stany zasobnika i
  kanbanu, podpowiedzi pól, `.filter-date`, `.cal-now-badge-date`,
  `.workload-cell.free`, dolna nawigacja telefonu) korzystają z podniesionej
  wartości.

### 3. Bug kolorów statusów (D17/M13)

Sklejanie sufiksu alfa usunięte ze wszystkich trzech miejsc w repo
(`StatusBadge.tsx` ×1 z `1a`, `PersonFilter.tsx` ×2 z `22`; grep za innymi
wariantami — `${…}NN`, `color + 'NN'` — nie znajduje już nic poza komentarzami
i testami).

- Nowy `tintVar(name, color)` w `src/utils/colors.ts` przekazuje kolor do CSS
  JEDNĄ zmienną (`--status` / `--person`), verbatim, a dla pustego/braku koloru
  zwraca pusty styl, żeby zadziałał fallback `var(--status, …)`.
- Odcienie liczy arkusz: `.status-badge` →
  `color-mix(in oklab, var(--status, transparent) 10.196%, transparent)`
  (10,196% = dawne `1a`, czyli 26/255), `.filter-chip.person-tint` /
  `.person-active-chip.person-tint` → `13.333%` (dawne `22`, 34/255). Dla
  poprawnego 6-znakowego hexa wygląd jest ten sam.
- Osobna klasa `person-tint` (a nie tylko `var()` z fallbackiem) po to, żeby chip
  „Wszyscy" i chip „+N", które koloru osoby nie mają, zostały przy dotychczasowym
  tle.

### 4. „(archived)" po angielsku (SY-31)

Nowy `src/utils/archivedLabel.ts` z jedną polską etykietą
(`ARCHIVED_LABEL` / `ARCHIVED_SUFFIX` / `archivedSuffix()` / `archivedAttr()`).
`StatusBadge` renderuje teraz `data-archived="true"` + „ (zarchiwizowany)", a
dotychczasowe trzy miejsca z ręcznie wpisanym stringiem (`TaskModal`,
`ProjectDetailPage`, `ClientsPage`) korzystają z tej samej stałej. Aria-label w
`AdminPage` („, zarchiwizowany" — inna forma zdania) pozostawiony bez zmian.

### Infrastruktura testów

`vitest.config.ts` dostał wirtualny moduł `virtual:styles-css` (Vitest podstawia
pod każdy import CSS pusty moduł, także przy `?raw`), z deklaracją typu w
`src/vite-env.d.ts`. Bez nowych zależności.

## Zmiany

- `src/styles.css` — mnożnik `--n2-motion` + usunięcie dwóch resetów, tokeny
  kontrastu, `color-mix` dla `--status` / `--person`.
- `src/utils/colors.ts` — nowy `tintVar()`.
- `src/utils/archivedLabel.ts` (nowy) — jedna polska etykieta „zarchiwizowany".
- `src/components/StatusBadge.tsx`, `src/components/PersonFilter.tsx` — jedna
  zmienna koloru zamiast sklejanego tła; `data-archived`.
- `src/components/TaskModal.tsx`, `src/pages/ProjectDetailPage.tsx`,
  `src/pages/ClientsPage.tsx` — wspólna etykieta.
- `src/pages/DashboardPage.tsx` — `useReducedMotion()` dla kaskady kafelków.
- `vitest.config.ts`, `src/vite-env.d.ts` — wirtualny moduł z treścią arkusza.
- Testy: `src/utils/colors.test.ts` (nowy),
  `src/components/StatusBadge.test.ts` (nowy),
  `src/utils/stylesheetContract.test.ts` (nowy),
  `src/components/PersonFilter.test.ts` (zaktualizowany — chipy nie mają już
  sklejanego tła).

## Weryfikacja

- `npm test` — **94 pliki / 2038 testów, wszystkie zielone**, zero pominiętych.
  Nowe przypadki: 12 × `tintVar` (hex 6-znakowy, `#c9f`, hex 8-znakowy, `rgb()`
  w dwóch składniach, `rgba()`, `hsl()`, `oklch()`, kolor nazwany, obcięcie
  spacji, `undefined`/`null`/`''`/spacje → pusty styl, brak
  `background`/`borderColor` w wyniku), 6 × SSR `StatusBadge` (`--status`
  zamiast `background`, cztery notacje nie-hex, brak stylu dla pustego koloru,
  `data-archived` + polska etykieta, brak „(archived)"), 8 × kontrakt arkusza
  (brak `0.01ms` i `!important`, obecność bramki `no-preference`, KAŻDY czas
  trwania owinięty mnożnikiem, wyliczony kontrast WCAG obu tokenów, `color-mix`
  dla obu zmiennych), 1 × `PersonFilter` (chip „Wszyscy" bez `person-tint`).
- `npm run build` (`tsc --noEmit && vite build`) — **zielone**.
- Kontrola zbudowanego CSS: 11 × `calc(… * var(--n2-motion))`,
  `color-mix(in oklab, …)` dla `--status` i `--person` obecne po minifikacji,
  zero `0.01ms`.
- Testy przeglądarkowe nie uruchamiane — żadna objęta nimi interakcja się nie
  zmieniła (`scripts/browser-check-*` nie odwołują się do tekstu plakietki, styli
  inline chipów ani preferencji ruchu); pełna matryca należy do weryfikacji
  wydania.
- Wiki: **niezmienione** — żadna strona w `openwiki/n2hub/` nie opisuje reguły
  reduced-motion, tokenów tekstu, kolorów statusów ani etykiety archiwizacji
  (sprawdzone grepem), więc nie ma tam nieaktualnej granicy ani inwariantu.

## Ryzyka / rzeczy do sprawdzenia

1. **`--n2-text-faint: .46` nie daje deklarowanych w zadaniu ~4,6:1.** Zmierzone
   (WCAG 2.1, tekst `#fbf8ff`): **4,51:1 na `--card-bg`** i **4,41:1 na samym
   `--n2-bg` (#010101)**. Każda reguła używająca tego tokenu leży faktycznie na
   karcie lub jaśniejszym szkle, więc AA (4,5:1) jest spełnione tam, gdzie ten
   kolor się pojawia; na czystym tle strony brakowałoby 0,09. Zrealizowałem
   wartość wskazaną w zadaniu (`.46`) — jeśli chcemy AA bezwarunkowo, na każdym
   podkładzie, potrzeba `.48` (4,73–4,80:1). Jedna linia, do decyzji.
2. **`color-mix()` wymaga Chrome 111+ / Safari 16.2+ / Firefox 113+** (baseline
   2023). Na starszej przeglądarce deklaracja `background` stanie się nieważna i
   plakietka/chip zostanie bez tła (obramowanie i tekst nadal kolorowe) —
   degradacja jest łagodna, ale nie jest to piksel w piksel to samo. Projekt nie
   deklaruje wsparcia starszych silników i nie ma polyfilla.
3. **Brak wsparcia `prefers-reduced-motion`** — celowo wybrałem bezpieczny stan
   domyślny: przeglądarka, która nie zna tego media query, dostaje
   `--n2-motion: 0`, czyli aplikację bez animacji. Wsparcie jest od 2018
   (Chrome 74, Safari 10.1, Firefox 63), więc w praktyce dotyczy to tylko bardzo
   starych silników.
4. **Animacja `week-block-fuse` przy zerowym czasie.** Zeruje się czas trwania, a
   nie sama animacja, więc `animationend` (czyszczące `fusedId` w `WeekView`)
   powinno padać jak dotąd; niezależnie od tego istniejący fallback
   `setTimeout(…, 400)` nadal czyści stan. Nie ma tu regresji względem
   poprzedniego `0.01ms`, ale to jedyne miejsce w kodzie zależne od zdarzenia
   animacji — warte spojrzenia w przeglądarkowej weryfikacji wydania z włączoną
   preferencją ograniczenia ruchu.
5. **`.card-chevron` / `.gs-row-chevron` są o włos ciemniejsze** (0,34 → 0,30),
   bo przeszły na `--n2-text-disabled`. To celowy skutek rozdzielenia tokenów, a
   nie regresja; poza tym i poza samym podniesieniem kontrastu nic nie zmienia
   wyglądu dla poprawnych 6-znakowych hexów.
6. **`--status`/`--person` przechodzą do CSS bez walidacji.** Nie ma tu wektora
   wstrzyknięcia (React ustawia własne właściwości przez CSSOM, wartość nie może
   wyjść z deklaracji), a niepoprawny kolor kończy się nieważną deklaracją, czyli
   brakiem tła. Walidacja koloru pozostaje zadaniem panelu administratora —
   `<input type="color">` daje dziś wyłącznie 6-znakowy hex, więc realną drogą
   wejścia nietypowej notacji jest import lub dane z chmury (i to właśnie tam ten
   bug był widoczny).
7. Tryb wycofania (retirement) nietknięty; brak nowych zależności runtime.

## Podpis schedulera

- Run: `20260728-075639-n2hub-294-css-hygiene-contrast`
- Prompt: `294-css-hygiene-contrast.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `5e48b4ee705d88e24e2b26e56915b6b1d1acb02e`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `5e48b4ee705d88e24e2b26e56915b6b1d1acb02e`
- Gałąź review: `review-integration`
- Run: `20260728-075639-n2hub-294-css-hygiene-contrast`

### Pliki zgłoszone do review

- `src/components/PersonFilter.test.ts`
- `src/components/PersonFilter.tsx`
- `src/components/StatusBadge.tsx`
- `src/components/TaskModal.tsx`
- `src/pages/ClientsPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/ProjectDetailPage.tsx`
- `src/styles.css`
- `src/utils/colors.ts`
- `src/vite-env.d.ts`
- `vitest.config.ts`
- `handoffs/scheduler-reviews/20260728-075639-n2hub-294-css-hygiene-contrast.md`
- `src/components/StatusBadge.test.ts`
- `src/utils/archivedLabel.ts`
- `src/utils/colors.test.ts`
- `src/utils/stylesheetContract.test.ts`
