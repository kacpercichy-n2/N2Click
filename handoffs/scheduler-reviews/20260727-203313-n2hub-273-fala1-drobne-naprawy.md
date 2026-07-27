# Raport workflow: 20260727-203313-n2hub-273-fala1-drobne-naprawy

## Wykonane

Każdy punkt najpierw zweryfikowałem pomiarem na bieżącym buildzie (przeglądarka,
1280×800, dane przykładowe), potem naprawiałem tylko to, co faktycznie zostało.

**S1 — „Ustawienia” chowają się pod stopką sidebara — POTWIERDZONE, naprawione.**
Pomiar przed: `.app-nav` scrollHeight 668 px vs clientHeight 488 px (180 px poza
widokiem), ostatnia pozycja „Ustawienia” na 824–868 px przy dolnej krawędzi
sidebara 776 px, stopka bez tła (`rgba(0,0,0,0)`) i bez sygnału, że lista się
przewija (nakładkowe paski macOS są niewidoczne). Uwaga do opisu z audytu: w
bieżącym kodzie stopka to „Pomoc i samouczki” + blok użytkownika
(avatar/„Wyloguj”); „Zgłoszenia” są zwykłą pozycją NAV.
Zmiany: nowy wrapper `.sidebar-footer` (`src/App.tsx`) skupiający oba elementy —
kryjące tło `--n2-panel`, `position: sticky; bottom: 0`, 12-px gradient nad
stopką jako sygnał „jest tego więcej”; wysokość pozycji NAV 44 → 38 px na
desktopie (≤1180 px wraca 44 px — cel dotykowy), a na ≤1180 px stopka jest
zwykłym blokiem (bez sticky, bez gradientu, przezroczysta), więc szuflada
mobilna zostaje bez zmian. Po zmianie pozycja ma 38 px, stopka jest kryjąca i
przyklejona. Przewijanie listy NIE znika całkowicie (14 pozycji + brand +
szukajka + 125-px stopka nie mieszczą się w 800 px) — znika brak informacji, że
coś jest niżej.

**S2 — sticky stopka modala a treść — POTWIERDZONE INACZEJ NIŻ W AUDYCIE,
naprawione.** Pomiar: pasek `.editor-actions-sticky` ma 65 px, ale przy pełnym
przewinięciu ostatnia sekcja kończy się 16 px NAD paskiem — trwale ukrytych
41 px treści nie odtworzyłem. Realny defekt: `padding-bottom: 24px` w
`.task-modal-body` sprawiał, że przyklejony pasek siadał 24 px nad dolną
krawędzią modala, a w tym pasie przez cały czas przewijała się ucięta treść
(zmierzone `gapUnderBar = 24 px` na każdej pozycji scrolla). Dlatego zamiast
zwiększać padding do ~81 px (co powiększyłoby ten pas do 81 px) padding schodzi
do zera tylko tam, gdzie pasek istnieje
(`.task-modal-body:has(.editor-actions-sticky)`): pasek siada równo na dole
karty (`gapUnderBar = 0`), a odstęp nad nim daje jego własny `margin-top`
(16 px). Doszedł subtelny gradient nad paskiem (`::before`) oraz
`scroll-padding-bottom: 96px` na treści modala, żeby fokus przeniesiony na pole
nie lądował pod paskiem. Modale bez paska (wydarzenie, zgłoszenie, changelog)
zachowują pełny padding.

**S3 — `thead` siatki przydziału przyklejony do złego kontenera — POTWIERDZONE,
naprawione.** Pomiar: `.alloc-wrap` miał `overflow-x: auto` (a więc i
`overflow-y: auto`), ale `max-height: none`, czyli nigdy nie przewijał się w
pionie; przy przewinięciu modala nagłówek uciekał poza ekran (zmierzone
`theadTop = −177 px` przy górze modala 122 px). Wybrałem mniej inwazyjny z
dwóch wariantów: `max-height: 60vh; overflow: auto` WYŁĄCZNIE dla siatki w
modalu (`.task-modal-body .alloc-wrap`) — widok „Obciążenie” zostaje bez zmian.
Po zmianie, przy okresie 92 dni (66+ wierszy), wrapper przewija 3204 px, a
komórki `th` stoją 1 px od jego górnej krawędzi na każdej głębokości. Dodatkowo
`overscroll-behavior: auto` w tym zakresie, żeby dojechanie palcem do końca
tabeli przewijało dalej modal (tło i tak jest zablokowane).

**AT-07 — fałszywy błąd cykliczności — POTWIERDZONE, naprawione.** Otwarty modal
istniejącego zadania bez reguły pokazywał czerwone „Wybierz przynajmniej jeden
dzień tygodnia.” Walidacja rusza teraz dopiero po edycji sekcji (`recurTouched`
ustawiany przez chipy dni, godzinę startu, czas trwania i „do dnia”), a
wyłączony przycisk „Zastosuj cykliczność” niesie powód w `title`. Po dotknięciu
sekcji błąd wraca normalnie (zweryfikowane: zaznaczenie i odznaczenie dnia →
błąd widoczny).

**IA-12 (minimalnie) — martwy „Zapisz i zamknij” — POTWIERDZONE, naprawione.**
Nowy czysty moduł `src/components/taskSaveBlockers.ts`
(`collectTaskSaveBlockers`) zwraca listę konkretnych przyczyn z kotwicą fokusa
zamiast anonimowego boolean-a; `formValid` = pusta lista, więc bramki wysyłane do
reduktora są dokładnie te same co dotąd (invariant 6 — niepoprawny payload nadal
nigdy nie trafia do `SAVE_TASK`). Nieudany zapis: (a) przewija do pierwszego
złego pola i ustawia na nim fokus, (b) wypisuje powody w sticky stopce, przy
przycisku (np. „Okres: maksymalnie 92 dni.”), każdy powód klikalny → skok do
swojego pola, (c) odznaka zapisu staje się przyciskiem „Nie można zapisać —
pokaż przyczynę” (`SaveStatus` prop `blocked`), który skacze do przyczyny. Lista
powodów pokazuje się dopiero po próbie zapisu albo przy brudnej edycji
istniejącego zadania — świeżo otwarty formularz nowego zadania nic nie krzyczy.

## Zmiany

- `src/App.tsx` — stopka sidebara jako jeden blok `.sidebar-footer` (S1).
- `src/components/TaskModal.tsx` — lista blokad zapisu + skok do pola + raport
  do odznaki, `recurTouched` (AT-07), kotwica `t-assignees`.
- `src/components/SaveStatus.tsx` — opcjonalny, klikalny wariant „zablokowany”.
- `src/components/taskSaveBlockers.ts` (nowy) — czysta lista powodów blokady.
- `src/components/taskSaveBlockers.test.ts` (nowy) — 12 testów tej listy.
- `src/styles.css` — `.sidebar-footer` + gradient, 38 px pozycji NAV (desktop),
  `padding-bottom: 0` i `scroll-padding-bottom` treści modala, gradient nad
  sticky paskiem, `max-height` siatki przydziału w modalu, style listy blokad i
  odznaki.
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — kontrakt blokad zapisu i
  reguła „walidacja cykliczności dopiero po edycji”.

## Weryfikacja

- `npm test` — 67 plików, **1540 testów zielonych** (w tym 12 nowych dla
  `collectTaskSaveBlockers`), bez regresji.
- `npm run build` (`tsc --noEmit` + vite) — zielony.
- `node scripts/check-openwiki-links.mjs` — „Validated 6 wiki files.”
- Ręczna weryfikacja w przeglądarce (dev server + Playwright przez MCP) —
  pomiary przed/po dla S1/S2/S3 (liczby wyżej) oraz ścieżki: otwarcie zadania bez
  cykliczności (brak fałszywego błędu), okres > 92 dni → klik „Zapisz i zamknij”
  (modal zostaje otwarty, fokus i przewinięcie na `t-end`, lista powodów w
  stopce, odznaka-przycisk skacze do przyczyny), nowe zadanie z pustym tytułem →
  klik „Utwórz zadanie” (fokus na `t-title`, powód wypisany), poprawny zapis
  nowego zadania (modal zamknięty, zadanie w `localStorage`), sidebar w 1280×800,
  1400×900 (także zwinięty) i 375×812 (szuflada: stopka statyczna, pozycje 44 px).
- Nie uruchamiałem skryptów `scripts/browser-check-*.mjs` — `playwright` nie jest
  zainstalowany w tym worktree ani globalnie (`npm ls playwright` puste);
  korzystałem z przeglądarki dostarczonej przez narzędzie MCP.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- **S1 nie usuwa przewijania listy NAV** — przy 14 pozycjach i 800 px wysokości
  wciąż ~229 px jest poza widokiem, „Ustawienia” trzeba doscrollować. Naprawiony
  jest brak sygnału i ryzyko zlania się listy ze stopką. Pełne zmieszczenie menu
  wymagałoby decyzji produktowej (grupowanie pozycji albo przeniesienie
  „Ustawień” do stopki) — poza zakresem tego promptu.
- `.task-modal-body:has(.editor-actions-sticky)` używa selektora `:has()`
  (Chrome 105+/Safari 15.4+/Firefox 121+). Gdyby nie zadziałał, wraca stary
  24-px pas — degradacja kosmetyczna, nie funkcjonalna.
- `max-height: 60vh` siatki przydziału dodaje zagnieżdżone przewijanie (tylko w
  modalu). Na bardzo niskich oknach siatka dostaje mniej miejsca niż dotąd.
  „Obciążenie” celowo nietknięte, więc tam sticky `thead` nadal ucieka — osobny
  przypadek, świadomie poza zakresem.
- Odznaka „Nie można zapisać” pojawia się tylko przy stanie `dirty`; przy
  `error` (nieudany zapis do pamięci) wygrywa dotychczasowe „Nie zapisano” —
  celowo, bo to komunikat o utracie danych, nie o walidacji.
- Bez zmian: reduktor, storage, model danych, tryb wygaszania. Zero nowych
  zależności runtime.

## Podpis schedulera

- Run: `20260727-203313-n2hub-273-fala1-drobne-naprawy`
- Prompt: `273-fala1-drobne-naprawy.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `c8e5d991f8a5e8c4b868ae6bc4c706a21c385286`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `c8e5d991f8a5e8c4b868ae6bc4c706a21c385286`
- Gałąź review: `review-integration`
- Run: `20260727-203313-n2hub-273-fala1-drobne-naprawy`

### Pliki zgłoszone do review

- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/components/SaveStatus.tsx`
- `src/components/TaskModal.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260727-203313-n2hub-273-fala1-drobne-naprawy.md`
- `src/components/taskSaveBlockers.test.ts`
- `src/components/taskSaveBlockers.ts`
